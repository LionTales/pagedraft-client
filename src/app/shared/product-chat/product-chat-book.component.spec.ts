/**
 * ProductChatComponent, BOOK-AWARE (chatbot phase B, c2).
 *
 * Its own file rather than another 350 lines on `product-chat.component.spec.ts`, which already covers
 * phase A's surface and is at this repo's file-size ceiling. The split is by SUBJECT, not by
 * convenience: everything here is about the drawer knowing which book it is in.
 *
 * The four things the todo names as specs are the four describes below: the context line's lifecycle
 * (enter / leave / switch), citation chip routing per artifact type, mixed-direction rendering BOTH
 * ways round, and the no-book path being unchanged.
 *
 * The book context is driven through a STUB of `BookContextService` with a subject the test pushes to.
 * The service's own derivation from the router is covered by its own spec; what matters here is what
 * the drawer does with each state, and driving it by real navigation would make every assertion in
 * this file depend on a router fixture it does not otherwise need.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';

import { ProductChatComponent } from './product-chat.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { BookContextService, CurrentBook } from '../../core/services/book-context.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { AmbientChapterService } from '../../core/services/ambient-chapter.service';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { ProductChatResponseDto } from '../../core/models/product-chat';
import { CHAT_STRINGS_EN, CHAT_STRINGS_HE } from '../../core/i18n/chat-strings';

const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

const HEBREW_BLOCK = 'הפרק נפתח בשיחה בין שתי הדמויות';
const ENGLISH_BLOCK = 'The chapter opens on a conversation between two characters';

/** A stub with the two members the drawer reads, plus a push handle for the test. */
class BookContextStub {
  readonly subject = new BehaviorSubject<CurrentBook | null>(null);
  readonly currentBook$ = this.subject.asObservable();
  get currentBook(): CurrentBook | null {
    return this.subject.value;
  }
  readonly bookId$ = new BehaviorSubject<string | null>(null);
}

function grounded(over: Partial<ProductChatResponseDto> = {}): ProductChatResponseDto {
  return {
    answer: 'Chapter 7 opens on a conversation.',
    guideIds: [],
    language: 'en',
    isGrounded: true,
    faultReason: null,
    ...over,
  };
}

describe('ProductChatComponent, book-aware (chatbot phase B)', () => {
  let fixture: ComponentFixture<ProductChatComponent>;
  let component: ProductChatComponent;
  let http: HttpTestingController;
  let overlays: AppOverlayService;
  let books: BookContextStub;

  beforeEach(async () => {
    books = new BookContextStub();
    await TestBed.configureTestingModule({
      imports: [ProductChatComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BookContextService, useValue: books },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductChatComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    overlays = TestBed.inject(AppOverlayService);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function openDrawer(): void {
    overlays.openTab('assistant');
    fixture.detectChanges();
  }

  /** Put the drawer inside a book, and answer the briefs-status read it makes on arrival. */
  function enterBook(
    bookId: string,
    title: string | null = 'A Study in Drafts',
    opts: { hasSummary?: boolean; builtChapters?: number } = {}
  ): void {
    books.subject.next({ bookId, title, language: 'he' });
    fixture.detectChanges();
    http.expectOne(r => r.url.includes(`/api/books/${bookId}/summary`)).flush({
      hasSummary: opts.hasSummary ?? true,
      builtChapters: opts.builtChapters ?? 12,
    });
    fixture.detectChanges();
  }

  function leaveBook(): void {
    books.subject.next(null);
    fixture.detectChanges();
  }

  function ask(question: string): void {
    component.draft = question;
    fixture.detectChanges();
    fixture.debugElement
      .query(By.css('.pc-composer'))
      .triggerEventHandler('submit', new Event('submit'));
    fixture.detectChanges();
  }

  /** Answer the in-flight chat POST. */
  function answer(res: ProductChatResponseDto = grounded()): void {
    http.expectOne('/api/product-chat').flush(res);
    fixture.detectChanges();
  }

  function useEnglish(): void {
    (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
    fixture.detectChanges();
  }

  // ── 1. The context line's lifecycle ─────────────────────────────────────────────────────────────

  describe('the context line (enter / leave / switch)', () => {
    it('is ABSENT outside a book: there is no fact to state', () => {
      openDrawer();
      expect(fixture.debugElement.query(By.css('.pc-book-context'))).toBeNull();
    });

    it('states the book on ENTERING one, naming it', () => {
      openDrawer();
      enterBook(BOOK_A, 'A Study in Drafts');

      const line = fixture.debugElement.query(By.css('.pc-book-context'));
      expect(line).not.toBeNull();
      expect((line.nativeElement as HTMLElement).textContent)
        .toContain(CHAT_STRINGS_HE['bookContextLabel']);
      expect((line.nativeElement as HTMLElement).textContent).toContain('A Study in Drafts');
    });

    it('carries NO control: it is a fact, not a setting', () => {
      // The way to change which book Show sees is to be in a different book. An affordance here would
      // promise a book picker this drawer does not have.
      openDrawer();
      enterBook(BOOK_A);
      const line = fixture.debugElement.query(By.css('.pc-book-context')).nativeElement as HTMLElement;
      expect(line.querySelector('button')).toBeNull();
      expect(line.querySelector('a')).toBeNull();
    });

    it('renders the TITLE with its own direction, since the book need not be in the chrome language', () => {
      openDrawer();
      enterBook(BOOK_A);
      const title = fixture.debugElement.query(By.css('.pc-book-context-title'))
        .nativeElement as HTMLElement;
      expect(title.getAttribute('dir')).toBe('auto');
    });

    it('still states the fact while the TITLE is unknown, rather than flickering in later', () => {
      openDrawer();
      enterBook(BOOK_A, null);
      const line = fixture.debugElement.query(By.css('.pc-book-context'));
      expect(line).not.toBeNull();
      expect((line.nativeElement as HTMLElement).textContent)
        .toContain(CHAT_STRINGS_HE['bookContextUnnamed']);
    });

    it('SWAPS on a book switch', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      enterBook(BOOK_B, 'Book B');

      const line = (fixture.debugElement.query(By.css('.pc-book-context'))
        .nativeElement as HTMLElement).textContent ?? '';
      expect(line).toContain('Book B');
      expect(line).not.toContain('Book A');
    });

    it('CLEARS on leaving every book', () => {
      openDrawer();
      enterBook(BOOK_A);
      leaveBook();
      expect(fixture.debugElement.query(By.css('.pc-book-context'))).toBeNull();
    });
  });

  // ── 2. The book-switch decision: keep the transcript, mark it, scope the wire ────────────────────

  describe('a book switch', () => {
    it('KEEPS the transcript and inserts a visible context-change marker', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('what happens in chapter 3?');
      answer();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn--user')).length).toBe(1);

      enterBook(BOOK_B, 'Book B');

      expect(fixture.debugElement.queryAll(By.css('.pc-turn--user')).length)
        .withContext('a hard reset would throw away product Q&A that is still valid')
        .toBe(1);
      const marker = fixture.debugElement.query(By.css('[data-testid="pc-book-marker"]'));
      expect(marker).not.toBeNull();
      expect((marker.nativeElement as HTMLElement).textContent).toContain('Book B');
    });

    it('writes NO marker for the first book of an empty transcript', () => {
      // There is nothing above it to separate from, and a conversation opening with a boundary reads
      // as noise rather than as a boundary.
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      expect(fixture.debugElement.query(By.css('[data-testid="pc-book-marker"]'))).toBeNull();
    });

    it('marks LEAVING a book too, saying what is answerable from here on', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer();
      leaveBook();

      const marker = fixture.debugElement.query(By.css('[data-testid="pc-book-marker"]'));
      expect((marker.nativeElement as HTMLElement).textContent?.trim())
        .toBe(CHAT_STRINGS_HE['bookMarkerLeft']);
    });

    it('STOPS the previous book\'s turns going up to the server', () => {
      // The marker alone would leave the model reading book A's summaries while answering about book
      // B, which is fabrication with a receipt. This is the half of the decision that is on the wire.
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('what happens in chapter 3?');
      http.expectOne('/api/product-chat').flush(grounded({ answer: 'Book A answer.' }));
      fixture.detectChanges();

      enterBook(BOOK_B, 'Book B');
      ask('and in this one?');

      const req = http.expectOne('/api/product-chat');
      expect(req.request.body.bookId).toBe(BOOK_B);
      expect(req.request.body.history)
        .withContext('book A\'s turns must not condition an answer about book B')
        .toEqual([]);
      req.flush(grounded());
      fixture.detectChanges();
    });

    it('KEEPS turns taken OUTSIDE any book, which is the reason the transcript survives at all', () => {
      openDrawer();
      ask('how do I export?');
      http.expectOne('/api/product-chat').flush(grounded({ answer: 'Export writes a DOCX.' }));
      fixture.detectChanges();

      enterBook(BOOK_A, 'Book A');
      ask('what happens in chapter 3?');

      const req = http.expectOne('/api/product-chat');
      expect(req.request.body.history.map((t: { content: string }) => t.content))
        .toEqual(['how do I export?', 'Export writes a DOCX.']);
      req.flush(grounded());
      fixture.detectChanges();
    });
  });

  // ── 3. Citation chip routing per artifact type ──────────────────────────────────────────────────

  describe('book-artifact citation chips', () => {
    function chipsFor(refs: string[]): HTMLElement[] {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({ artifactRefs: refs }));
      return fixture.debugElement
        .queryAll(By.css('.pc-citation-chip--book'))
        .map(d => d.nativeElement as HTMLElement);
    }

    it('renders one chip per cited artifact, under its own label', () => {
      const chips = chipsFor(['chapter-brief:6', 'status:review']);
      expect(chips.length).toBe(2);
      const row = fixture.debugElement.query(By.css('[data-testid="pc-book-citation"]'))
        .nativeElement as HTMLElement;
      expect(row.textContent).toContain(CHAT_STRINGS_HE['citationBook']);
    });

    it('names a chapter by the number the AUTHOR counts by, not the 0-based wire order', () => {
      const [chip] = chipsFor(['chapter-brief:6']);
      expect(chip.textContent?.trim()).toBe('תקציר פרק 7');
    });

    it('LINKS a chip that has a surface, into the book the ANSWER was about', () => {
      const [chip] = chipsFor(['status:review']);
      expect(chip.tagName).toBe('A');
      expect(chip.getAttribute('href')).toBe(`/books/${BOOK_A}?focus=status-review`);
    });

    it('routes each artifact type to its own surface', () => {
      const chips = chipsFor([
        'finding:2f1c8b30-0000-4000-8000-000000000001',
        'chapter-brief:6',
        'chapter-text:6',
        'register',
        'book-brief',
        'status:summary',
      ]);
      expect(chips.map(c => c.getAttribute('href'))).toEqual([
        `/books/${BOOK_A}?focus=findings`,
        `/books/${BOOK_A}?focus=chapter-briefs`,
        `/books/${BOOK_A}?focus=chapter&chapter=6`,
        `/books/${BOOK_A}?focus=register`,
        `/books/${BOOK_A}?focus=story-bible`,
        `/books/${BOOK_A}?focus=status-summary`,
      ]);
    });

    it('renders a chip with NO destination UNLINKED rather than dead', () => {
      const chips = chipsFor(['history', 'sudoku:7']);
      expect(chips.length).toBe(2);
      for (const chip of chips) {
        expect(chip.tagName).withContext(chip.textContent ?? '').not.toBe('A');
        expect(chip.classList).toContain('pc-citation-chip--plain');
      }
    });

    it('shows the RAW ref for an artifact type this build has never heard of', () => {
      // Hiding it would delete the only provenance the author has for that part of the answer.
      const chips = chipsFor(['sudoku:7']);
      expect(chips[0].textContent?.trim()).toBe('sudoku:7');
    });

    it('keeps pointing at the ANSWER\'s book after the author moves to another one', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({ artifactRefs: ['register'] }));

      enterBook(BOOK_B, 'Book B');

      const chip = fixture.debugElement.query(By.css('.pc-citation-chip--book'))
        .nativeElement as HTMLElement;
      expect(chip.getAttribute('href'))
        .withContext('a transcript must not rewrite its own provenance as the author walks around')
        .toBe(`/books/${BOOK_A}?focus=register`);
    });

    it('renders NO book-citation row when the answer cited none', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({ guideIds: ['export'] }));
      expect(fixture.debugElement.query(By.css('[data-testid="pc-book-citation"]'))).toBeNull();
    });
  });

  // ── 4. A book half that came back thin ──────────────────────────────────────────────────────────

  describe('a PARTIAL book fault', () => {
    it('renders a note ON the answer, and NOT as a failure', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({ bookFaultReason: 'findings-unreadable' }));

      expect(fixture.debugElement.query(By.css('.pc-fault')))
        .withContext('the server said isGrounded: dressing this as a failure misreports a good answer')
        .toBeNull();
      const note = fixture.debugElement.query(By.css('[data-testid="pc-book-thin"]'));
      expect((note.nativeElement as HTMLElement).textContent?.trim())
        .toBe(CHAT_STRINGS_HE['bookThinNote']);
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).not.toBeNull();
    });

    it('a COMPLETE book failure is a fault entry with the book fault\'s own sentence', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer({
        answer: 'I cannot see your book right now.',
        guideIds: [],
        language: 'he',
        isGrounded: false,
        faultReason: 'book-unavailable',
        bookFaultReason: 'book-unavailable',
      });

      const fault = fixture.debugElement.query(By.css('.pc-fault'));
      expect(fault).not.toBeNull();
      expect((fault.nativeElement as HTMLElement).textContent)
        .withContext('a documented book code must not fall through to the unknown-code sentence')
        .toContain(CHAT_STRINGS_HE['faultBookUnavailable']);
    });
  });

  // ── 5. Mixed-direction rendering, BOTH ways round ───────────────────────────────────────────────

  describe('mixed-direction answers', () => {
    /** The rendered answer's block elements, with whatever dir each ended up carrying. */
    function answerBlocks(): { text: string; dir: string | null }[] {
      return fixture.debugElement
        .queryAll(By.css('.pc-answer p'))
        .map(d => d.nativeElement as HTMLElement)
        .map(el => ({ text: el.textContent ?? '', dir: el.getAttribute('dir') }));
    }

    it('a HEBREW answer quoting an ENGLISH block turns that block LTR and leaves the rest alone', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({
        language: 'he',
        answer: `${HEBREW_BLOCK}\n\n${ENGLISH_BLOCK}\n\n${HEBREW_BLOCK}`,
      }));

      expect(fixture.debugElement.query(By.css('.pc-answer')).nativeElement.getAttribute('dir'))
        .toBe('rtl');
      expect(answerBlocks().map(b => b.dir))
        .withContext('only the quoted block switches; the answer stays in the answer\'s language')
        .toEqual([null, 'ltr', null]);
    });

    it('an ENGLISH answer quoting a HEBREW block turns that block RTL', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({
        language: 'en',
        answer: `${ENGLISH_BLOCK}\n\n${HEBREW_BLOCK}\n\n${ENGLISH_BLOCK}`,
      }));

      expect(fixture.debugElement.query(By.css('.pc-answer')).nativeElement.getAttribute('dir'))
        .toBe('ltr');
      expect(answerBlocks().map(b => b.dir)).toEqual([null, 'rtl', null]);
    });

    it('does NOT flip a Hebrew block that merely OPENS with a Latin word', () => {
      // The failure mode dir="auto" would have: it resolves from the first strong character, and
      // product names open sentences on this surface constantly.
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      ask('q');
      answer(grounded({ language: 'he', answer: `PageDraft ${HEBREW_BLOCK}` }));
      expect(answerBlocks().map(b => b.dir)).toEqual([null]);
    });
  });

  // ── 6. The tutoring empty state ─────────────────────────────────────────────────────────────────

  describe('the empty state inside a book with no briefs', () => {
    it('says what is missing and carries the REAL build action', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: false, builtChapters: 0 });

      const empty = fixture.debugElement.query(By.css('[data-testid="pc-empty-book"]'));
      expect(empty).not.toBeNull();
      expect((empty.nativeElement as HTMLElement).textContent)
        .toContain(CHAT_STRINGS_HE['emptyBookBody']);

      const build = fixture.debugElement.query(By.css('[data-testid="pc-build-briefs"]'))
        .nativeElement as HTMLElement;
      expect(build.textContent?.trim()).toBe(CHAT_STRINGS_HE['emptyBookBuild']);
      expect(build.getAttribute('href'))
        .withContext('the briefs row owns the consent, the estimate and the progress')
        .toBe(`/books/${BOOK_A}?focus=status-summary`);
    });

    it('shows the ORDINARY greeting once briefs exist', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: true, builtChapters: 12 });
      expect(fixture.debugElement.query(By.css('[data-testid="pc-empty-book"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-empty-title')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['emptyTitle']);
    });

    it('shows the ORDINARY greeting when the briefs state is UNKNOWN, never the missing one', () => {
      // Telling an author their briefs are missing because a status GET failed would be the chrome
      // fabricating a state, which is the class of error this whole feature exists to avoid.
      openDrawer();
      books.subject.next({ bookId: BOOK_A, title: 'Book A', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_A}/summary`))
        .error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('[data-testid="pc-empty-book"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-empty-title'))).not.toBeNull();
    });

    it('is rendered in English chrome too (he/en parity)', () => {
      useEnglish();
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: false, builtChapters: 0 });
      const empty = fixture.debugElement.query(By.css('[data-testid="pc-empty-book"]'))
        .nativeElement as HTMLElement;
      expect(empty.textContent).toContain(CHAT_STRINGS_EN['emptyBookTitle']);
      expect(empty.textContent).toContain(CHAT_STRINGS_EN['emptyBookBuild']);
    });
  });

  // ── 7. THE NO-BOOK PATH IS UNCHANGED ────────────────────────────────────────────────────────────

  describe('outside a book, nothing about phase A moves', () => {
    it('sends a body with NO bookId property at all', () => {
      openDrawer();
      ask('how do I import?');
      const req = http.expectOne('/api/product-chat');
      expect(Object.keys(req.request.body)).toEqual(['question', 'history', 'language']);
      req.flush(grounded());
      fixture.detectChanges();
    });

    it('renders no context line, no marker and no book chips', () => {
      openDrawer();
      ask('how do I import?');
      answer(grounded({ guideIds: ['import'] }));

      expect(fixture.debugElement.query(By.css('.pc-book-context'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="pc-book-marker"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="pc-book-citation"]'))).toBeNull();
      // The GUIDE citation is untouched.
      expect(fixture.debugElement.queryAll(By.css('.pc-citation-chip')).length).toBe(1);
    });

    it('reads no book status: nothing is fetched at all', () => {
      openDrawer();
      http.expectNone(r => r.url.includes('/summary'));
    });

    it('keeps phase A\'s grounding promise verbatim', () => {
      openDrawer();
      expect(fixture.debugElement.query(By.css('.pc-grounding-note')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['groundingNote']);
    });

    /**
     * f01 (review finding #5) regression fence: `groundingNote` got a book twin already, but
     * `emptyBody` and `inFlight` did not, and both are the "I answer only from the guides" claim just
     * as much as the grounding note is. Outside a book, phase A's gate-verified strings must render
     * BYTE-FOR-BYTE, unchanged by the twin these two gained.
     */
    it('keeps phase A\'s empty-state greeting and in-flight row byte-for-byte', () => {
      openDrawer();
      expect(fixture.debugElement.query(By.css('.pc-empty-body')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['emptyBody']);

      ask('how do I import?');
      const pending = fixture.debugElement.query(By.css('.pc-pending-text'));
      expect(pending.nativeElement.textContent.trim()).toBe(CHAT_STRINGS_HE['inFlight']);
      answer(grounded({ guideIds: ['import'] }));
    });
  });

  // ── 8. The grounding promise tells the truth inside a book ──────────────────────────────────────

  it('RESTATES the grounding note inside a book, which now answers from two sources', () => {
    // The one line whose whole job is to say where answers come from must not be the line that is
    // wrong about it: phase A's sentence promises the product guides ONLY.
    openDrawer();
    enterBook(BOOK_A, 'Book A');
    expect(fixture.debugElement.query(By.css('.pc-grounding-note')).nativeElement.textContent.trim())
      .toBe(CHAT_STRINGS_HE['groundingNoteBook']);

    leaveBook();
    expect(fixture.debugElement.query(By.css('.pc-grounding-note')).nativeElement.textContent.trim())
      .toBe(CHAT_STRINGS_HE['groundingNote']);
  });

  // ── 9. The empty-state greeting and the in-flight row tell the truth inside a book (f01) ─────────
  //
  // Review finding #5: the sweep that gave `groundingNote` a book twin stopped at that one line. Two
  // siblings making the identical "I answer only from the guides" claim shipped un-twinned - the
  // empty-state greeting, which renders on every book-scoped first turn where briefs ALREADY EXIST
  // (`showBookEmptyState` only diverts to the tutoring copy when briefs are NOT built), and the
  // in-flight row, shown while a request carrying book artifacts is in flight. Both were visible in one
  // screenshot alongside the (already-fixed) grounding note during the live gate.

  describe('the empty-state greeting and the in-flight row inside a book (f01)', () => {
    it('greets with the BOOK copy once briefs are built, not phase A\'s guides-only sentence', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: true, builtChapters: 12 });

      const body = fixture.debugElement.query(By.css('.pc-empty-body'));
      expect(body.nativeElement.textContent.trim()).toBe(CHAT_STRINGS_HE['emptyBodyBook']);
      expect(body.nativeElement.textContent.trim()).not.toBe(CHAT_STRINGS_HE['emptyBody']);
    });

    it('shows the BOOK copy in the in-flight row for a book-scoped question', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: true, builtChapters: 12 });
      ask('what happens in chapter 3?');

      const pending = fixture.debugElement.query(By.css('.pc-pending-text'));
      expect(pending.nativeElement.textContent.trim()).toBe(CHAT_STRINGS_HE['inFlightBook']);
      expect(pending.nativeElement.textContent.trim()).not.toBe(CHAT_STRINGS_HE['inFlight']);
      answer();
    });

    it('BOTH surfaces carry the book copy at once, matching what the live gate screenshot showed', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: true, builtChapters: 12 });
      const bodyBeforeAsk = fixture.debugElement.query(By.css('.pc-empty-body'))
        .nativeElement.textContent.trim();
      expect(bodyBeforeAsk).toBe(CHAT_STRINGS_HE['emptyBodyBook']);

      ask('what happens in chapter 3?');
      const pending = fixture.debugElement.query(By.css('.pc-pending-text'))
        .nativeElement.textContent.trim();
      expect(pending).toBe(CHAT_STRINGS_HE['inFlightBook']);

      const groundingNote = fixture.debugElement.query(By.css('.pc-grounding-note'))
        .nativeElement.textContent.trim();
      expect(groundingNote).toBe(CHAT_STRINGS_HE['groundingNoteBook']);
      answer();
    });

    it('is rendered in English chrome too (he/en parity)', () => {
      useEnglish();
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: true, builtChapters: 12 });
      expect(fixture.debugElement.query(By.css('.pc-empty-body')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_EN['emptyBodyBook']);

      ask('what happens in chapter 3?');
      expect(fixture.debugElement.query(By.css('.pc-pending-text')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_EN['inFlightBook']);
      answer();
    });

    it('falls back to the app-level in-flight row once the book is left', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A', { hasSummary: true, builtChapters: 12 });
      leaveBook();
      ask('how do I import?');

      expect(fixture.debugElement.query(By.css('.pc-pending-text')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['inFlight']);
      answer(grounded({ guideIds: ['import'] }));
    });
  });

  // ── 10. The briefs-status read is torn down with the component (f02, review finding #11) ─────────
  //
  // `loadBriefsState`'s stale-book guard (`this.book?.bookId !== bookId`) protects against a late read
  // landing on the WRONG BOOK; it says nothing about a component that has been destroyed outright. The
  // drawer happens to stay mounted for the app's life today, so nothing leaks in practice, but the
  // subscription must still be bound to `destroy$` like every other one in this file, for the day that
  // stops being true.
  //
  // Its OWN TestBed, stubbing `BookSummaryService` with a `Subject` the test holds open: a synchronous
  // `of()` would complete before teardown could matter, so the honest shape is emitting into the source
  // AFTER `ngOnDestroy` has already run and asserting the component field was not written.

  describe('the briefs-status subscription is torn down with the component (f02)', () => {
    let teardownFixture: ComponentFixture<ProductChatComponent>;
    let teardownComponent: ProductChatComponent;
    let teardownBooks: BookContextStub;
    let status$: Subject<BookSummaryStatusDto>;

    beforeEach(async () => {
      // The outer `beforeEach` already instantiated a TestBed module for this file's own fixture, so
      // this nested block needs its own clean module to swap in a stubbed `BookSummaryService`.
      TestBed.resetTestingModule();
      teardownBooks = new BookContextStub();
      status$ = new Subject<BookSummaryStatusDto>();
      await TestBed.configureTestingModule({
        imports: [ProductChatComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          { provide: BookContextService, useValue: teardownBooks },
          {
            provide: BookSummaryService,
            useValue: { getBookSummaryStatus: () => status$.asObservable() },
          },
        ],
      }).compileComponents();

      teardownFixture = TestBed.createComponent(ProductChatComponent);
      teardownComponent = teardownFixture.componentInstance;
      teardownFixture.detectChanges();
    });

    it('does not write briefsBuilt from a status response that arrives after ngOnDestroy', () => {
      teardownBooks.subject.next({ bookId: BOOK_A, title: 'Book A', language: 'he' });
      teardownFixture.detectChanges();
      expect(teardownComponent.briefsBuilt).toBeNull();

      teardownFixture.destroy();
      status$.next({
        bookId: BOOK_A,
        language: 'he',
        totalChapters: 12,
        builtChapters: 12,
        staleCount: 0,
        hasSummary: true,
        ready: true,
        lastUpdatedAt: null,
        builtWithDifferentModel: false,
        summaryCoversBuiltChapters: true,
        activeBuildJobId: null,
        chaptersToBuild: 0,
        estimatedSeconds: 0,
        estimatedUsd: null,
      });

      expect(teardownComponent.briefsBuilt)
        .withContext('a torn-down component must not still be written to by a late response')
        .toBeNull();
    });
  });

  /**
   * THREE DEFECTS A CR BOT FOUND ON THE PR, all of them the same shape one layer apart: state captured
   * when a question was ASKED, read again against the book that is open NOW.
   *
   * The in-flight window is occupied for real in each one - the book moves while a request is genuinely
   * outstanding - because a synchronous mock collapses exactly the interval all three live in.
   */
  describe('when the book moves while a request is in flight (CR bot, PR #41)', () => {
    /** Publish an ambient snapshot so `clarifyFor` has chapters to offer. */
    function publishChapters(bookId: string): void {
      TestBed.inject(AmbientChapterService).publish({
        bookId,
        openChapter: null,
        chapters: [
          { id: 'c-one', order: 0, title: 'One' },
          { id: 'c-two', order: 1, title: 'Two' },
        ],
      });
      fixture.detectChanges();
    }

    it('files a late answer ABOVE the marker for the book the author moved to', () => {
      openDrawer();
      enterBook(BOOK_A);
      ask('what happens here?');

      // The author navigates to another book while the answer is still outstanding.
      books.subject.next({ bookId: BOOK_B, title: 'Second', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_B}/summary`)).flush({
        hasSummary: true,
        builtChapters: 3,
      });
      fixture.detectChanges();

      answer();

      const kinds = component.entries.map(e => e.kind);
      const marker = kinds.indexOf('book-marker');
      const assistant = kinds.indexOf('assistant');

      expect(marker).toBeGreaterThan(-1);
      expect(assistant)
        .withContext(
          'an answer about book A must sit ABOVE the rule that says "from here on I am looking at B", ' +
            'or the transcript asserts the one thing the marker exists to deny'
        )
        .toBeLessThan(marker);
    });

    it('withdraws clarify chips once they no longer belong to the book on screen', () => {
      openDrawer();
      enterBook(BOOK_A);
      publishChapters(BOOK_A);
      ask('what happens in the chapter?');
      answer(grounded({ needsChapterClarification: true }));

      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]')))
        .withContext('the chips are offered while their own book is open')
        .not.toBeNull();

      books.subject.next({ bookId: BOOK_B, title: 'Second', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_B}/summary`)).flush({
        hasSummary: true,
        builtChapters: 3,
      });
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]')))
        .withContext('a chapter of the previous book must not be offered for a request about this one')
        .toBeNull();
    });

    it('refuses a stale clarify chip even if one is somehow tapped', () => {
      openDrawer();
      enterBook(BOOK_A);
      publishChapters(BOOK_A);
      ask('what happens in the chapter?');
      answer(grounded({ needsChapterClarification: true }));

      const assistantEntry = component.entries.find(e => e.kind === 'assistant');
      const clarify = (assistantEntry as { clarify: { question: string; bookId: string | null } }).clarify;
      books.subject.next({ bookId: BOOK_B, title: 'Second', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_B}/summary`)).flush({
        hasSummary: true,
        builtChapters: 3,
      });
      fixture.detectChanges();

      component.chooseChapter(clarify, { id: 'c-two', order: 1, title: 'Two' });
      fixture.detectChanges();

      // No request at all: the guard refuses before `ask` can put book A's chapter on a book B request.
      http.expectNone('/api/product-chat');
    });

    it('re-reads the briefs status once the book its language belongs to arrives', () => {
      openDrawer();

      // BookContextService publishes the ID FIRST with a null title and language, then re-emits when
      // its own read lands. The first briefs read therefore has no language to key on.
      books.subject.next({ bookId: BOOK_A, title: null, language: null });
      fixture.detectChanges();
      const first = http.expectOne(r => r.url.includes(`/api/books/${BOOK_A}/summary`));
      expect(first.request.urlWithParams)
        .withContext('nothing is known yet, so it falls back to the app-default slot')
        .toContain('he');
      first.flush({ hasSummary: false, builtChapters: 0 });
      fixture.detectChanges();

      books.subject.next({ bookId: BOOK_A, title: 'An English Book', language: 'en' });
      fixture.detectChanges();

      const second = http.expectOne(r => r.url.includes(`/api/books/${BOOK_A}/summary`));
      expect(second.request.urlWithParams)
        .withContext(
          'briefs are stored PER LANGUAGE, so an English book judged against the Hebrew slot can be ' +
            'told its briefs are missing on evidence about a slot it has no rows in'
        )
        .toContain('en');
      second.flush({ hasSummary: true, builtChapters: 4 });
      fixture.detectChanges();

      expect(component.showBookEmptyState).toBeFalse();
    });
  });

  /**
   * A SECOND ROUND FROM THE SAME BOT, on the fix for the first: filing a late entry mid-transcript
   * broke `retry`, which had only ever seen a fault as the LAST entry and truncated the tail to drop it.
   */
  describe('retrying a failed exchange (CR bot round 2, PR #41)', () => {
    function fail(): void {
      http.expectOne('/api/product-chat').flush('nope', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
    }

    it('cuts out only the failed pair, keeping a marker filed after it', () => {
      openDrawer();
      enterBook(BOOK_A);
      ask('what happens here?');

      books.subject.next({ bookId: BOOK_B, title: 'Second', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_B}/summary`)).flush({
        hasSummary: true,
        builtChapters: 3,
      });
      fixture.detectChanges();

      fail();

      // The fault is filed ABOVE the marker, so it is no longer the last entry.
      const faultEntry = component.entries.find(e => e.kind === 'fault') as {
        kind: 'fault';
        bookId: string | null;
        question: string;
        id: number;
        reason: string;
      };
      expect(faultEntry).toBeDefined();

      // Retrying it while book B is open is refused outright, so nothing is destroyed and no request
      // goes out. Book A's question must not be re-asked against book B.
      component.retry(faultEntry as never);
      fixture.detectChanges();
      http.expectNone('/api/product-chat');
      expect(component.entries.some(e => e.kind === 'book-marker'))
        .withContext('a refused retry must not take the transcript apart')
        .toBeTrue();

      // Back in book A, the retry is allowed, and it must remove ONLY the user turn and its fault.
      books.subject.next({ bookId: BOOK_A, title: 'A Study in Drafts', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_A}/summary`)).flush({
        hasSummary: true,
        builtChapters: 12,
      });
      fixture.detectChanges();

      component.retry(faultEntry as never);
      fixture.detectChanges();

      expect(component.entries.some(e => e.kind === 'book-marker'))
        .withContext(
          'retry must CUT OUT the failed pair, not truncate the tail: a late fault is filed above the ' +
            'marker, so slicing from it would drop the marker and every turn after it'
        )
        .toBeTrue();
      expect(component.entries.filter(e => e.kind === 'fault').length).toBe(0);

      http.expectOne('/api/product-chat').flush(grounded());
      fixture.detectChanges();
    });
  });
});
