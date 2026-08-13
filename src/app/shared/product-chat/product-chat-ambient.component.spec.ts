/**
 * ProductChatComponent, AMBIENT CHAPTER (chatbot phase B, a2).
 *
 * Its own file rather than more lines on `product-chat-book.component.spec.ts`, on the same rule that
 * split that one off phase A's: the split is by SUBJECT. Everything here is about the drawer knowing,
 * saying and sending WHICH CHAPTER is in front of the author.
 *
 * The four things the todo names are the four sections below: the context line's chapter lifecycle
 * (open, switch, leave to the dashboard, leave the book), the request payload per surface, the clarify
 * rendering, and the no-book path being unchanged.
 *
 * The book context is a STUB (the drawer's own reading of it is covered by the book-aware spec, and the
 * service derives from the router, which this file does not otherwise need). The AMBIENT service is the
 * REAL one, because half of what is under test here is the reconciliation between the two - the drawer
 * must refuse a chapter snapshot that belongs to a different book than the one it names - and a stub
 * would have re-implemented exactly the rule being tested.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { ProductChatComponent } from './product-chat.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { AmbientChapterChoice, AmbientChapterService } from '../../core/services/ambient-chapter.service';
import { BookContextService, CurrentBook } from '../../core/services/book-context.service';
import { ProductChatRequest, ProductChatResponseDto } from '../../core/models/product-chat';
import { CHAT_STRINGS_EN, CHAT_STRINGS_HE } from '../../core/i18n/chat-strings';

const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

/** The owner's real book: ONE chapter, order 0, titled "פרק 28". A clarify here must be impossible. */
const OWNERS_ONLY_CHAPTER: AmbientChapterChoice = { id: 'ch-owner', order: 0, title: 'פרק 28' };

/** A multi-chapter book, which is the only shape a clarifying question can arise on. */
const CHAPTERS: AmbientChapterChoice[] = [
  { id: 'ch-1', order: 0, title: 'הלילה שלפני' },
  { id: 'ch-2', order: 1, title: 'הדרך צפונה' },
  { id: 'ch-3', order: 2, title: '' },
];

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
    answer: 'The chapter opens on a conversation.',
    guideIds: [],
    language: 'he',
    isGrounded: true,
    faultReason: null,
    ...over,
  };
}

describe('ProductChatComponent, ambient chapter (chatbot phase B, a2)', () => {
  let fixture: ComponentFixture<ProductChatComponent>;
  let component: ProductChatComponent;
  let http: HttpTestingController;
  let overlays: AppOverlayService;
  let books: BookContextStub;
  let ambient: AmbientChapterService;

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
    ambient = TestBed.inject(AmbientChapterService);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function openDrawer(): void {
    overlays.openTab('assistant');
    fixture.detectChanges();
  }

  /** Put the drawer inside a book, and answer the briefs-status read it makes on arrival. */
  function enterBook(bookId: string, title = 'צל הירח'): void {
    books.subject.next({ bookId, title, language: 'he' });
    fixture.detectChanges();
    http.expectOne(r => r.url.includes(`/api/books/${bookId}/summary`))
      .flush({ hasSummary: true, builtChapters: 8 });
    fixture.detectChanges();
  }

  // ── The four surfaces d2 enumerates, driven exactly as the editor drives them ────────────────────

  /** Editor, edit mode, a chapter selected. */
  function openChapter(
    bookId: string,
    chapter: AmbientChapterChoice,
    chapters: AmbientChapterChoice[] = CHAPTERS
  ): void {
    ambient.publish({ bookId, openChapter: chapter, chapters });
    fixture.detectChanges();
  }

  /** Editor with no chapter selected, OR the book-review dashboard: a book, explicitly no chapter. */
  function openBookWithoutChapter(bookId: string, chapters: AmbientChapterChoice[] = CHAPTERS): void {
    ambient.publish({ bookId, openChapter: null, chapters });
    fixture.detectChanges();
  }

  /** No book surface is mounted at all: the import page, the export page, the books list. */
  function noSurface(): void {
    ambient.clear();
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

  /**
   * The body of the ask that is in flight, ANSWERED on the way out so the transcript settles.
   *
   * `expectOne` consumes the request, so reading the body and flushing have to happen in one place or
   * the second call finds nothing.
   */
  function sentBody(res: ProductChatResponseDto = grounded()): ProductChatRequest {
    const req = http.expectOne('/api/product-chat');
    const body = req.request.body as ProductChatRequest;
    req.flush(res);
    fixture.detectChanges();
    return body;
  }

  function answer(res: ProductChatResponseDto = grounded()): void {
    http.expectOne('/api/product-chat').flush(res);
    fixture.detectChanges();
  }

  function chapterLine(): HTMLElement | null {
    const found = fixture.debugElement.query(By.css('[data-testid="pc-ambient-chapter"]'));
    return found ? (found.nativeElement as HTMLElement) : null;
  }

  function useEnglish(): void {
    (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
    fixture.detectChanges();
  }

  // ── 1. THE CONTEXT LINE'S CHAPTER LIFECYCLE ─────────────────────────────────────────────────────

  describe('the context line names the chapter', () => {
    it('names the chapter once one is OPEN, beside the book', () => {
      openDrawer();
      enterBook(BOOK_A, 'צל הירח');
      openChapter(BOOK_A, CHAPTERS[0]);

      const line = fixture.debugElement.query(By.css('.pc-book-context'))
        .nativeElement as HTMLElement;
      expect(line.textContent).toContain('צל הירח');
      expect(chapterLine()?.textContent?.trim()).toBe('הלילה שלפני');
    });

    it('SWITCHES as the author moves between chapters', () => {
      // The lifecycle case most likely to go stale, and the one that decides whether the whole feature
      // answers about the chapter in front of the author or about one they have left.
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      expect(chapterLine()?.textContent?.trim()).toBe('הלילה שלפני');

      openChapter(BOOK_A, CHAPTERS[1]);
      expect(chapterLine()?.textContent?.trim()).toBe('הדרך צפונה');
    });

    it('drops the chapter half on the BOOK-REVIEW dashboard, keeping the book', () => {
      // The author is looking at book-wide artifacts, so "the chapter I am in" would be false. The
      // editor publishes the null; the line must actually follow it rather than remembering.
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      openBookWithoutChapter(BOOK_A);

      expect(chapterLine()).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-book-context'))).not.toBeNull();
    });

    it('drops the chapter half on a book page that is NOT the editor (import / export)', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      noSurface();

      expect(chapterLine()).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-book-context'))).not.toBeNull();
    });

    it('drops the WHOLE line on leaving the book', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);

      books.subject.next(null);
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-book-context'))).toBeNull();
      expect(chapterLine()).toBeNull();
    });

    it('REFUSES a chapter belonging to a different book than the one it names', () => {
      // The two services move on different ticks during a book switch. Naming book A's chapter under
      // book B's title would be the wrong-chapter failure with the books swapped, and it is the state
      // a real switch passes through rather than a hypothetical one.
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      openChapter(BOOK_A, CHAPTERS[0]);

      books.subject.next({ bookId: BOOK_B, title: 'Book B', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_B}/summary`))
        .flush({ hasSummary: true, builtChapters: 4 });
      fixture.detectChanges();

      expect(chapterLine())
        .withContext('book A\'s chapter must not be named under book B')
        .toBeNull();
    });

    it('falls back to the chapter NUMBER for an untitled chapter, 1-based', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[2]);
      expect(chapterLine()?.textContent?.trim()).toBe('פרק 3');
    });

    it('renders the chapter with its OWN direction and carries NO control', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);

      expect(chapterLine()?.getAttribute('dir')).toBe('auto');
      const line = fixture.debugElement.query(By.css('.pc-book-context'))
        .nativeElement as HTMLElement;
      expect(line.querySelector('button'))
        .withContext('a fact, not a setting: the way to change the chapter is to open another one')
        .toBeNull();
      expect(line.querySelector('a')).toBeNull();
    });

    it('names BOTH halves in the accessible name, so they are not heard as one run-on title', () => {
      openDrawer();
      enterBook(BOOK_A, 'צל הירח');
      openChapter(BOOK_A, CHAPTERS[0]);

      const aria = fixture.debugElement.query(By.css('.pc-book-context'))
        .nativeElement.getAttribute('aria-label') as string;
      expect(aria).toContain(CHAT_STRINGS_HE['bookContextChapterAria']);
      expect(aria).toContain('הלילה שלפני');
      expect(aria).toContain('צל הירח');
    });

    it('leaves the book-only accessible name exactly as it shipped', () => {
      openDrawer();
      enterBook(BOOK_A);
      expect(fixture.debugElement.query(By.css('.pc-book-context'))
        .nativeElement.getAttribute('aria-label'))
        .toBe(CHAT_STRINGS_HE['bookContextAria']);
    });

    it('names the chapter in English chrome too (he/en parity)', () => {
      useEnglish();
      openDrawer();
      enterBook(BOOK_A, 'The Salt Road');
      openChapter(BOOK_A, { id: 'ch-x', order: 3, title: '' });
      expect(chapterLine()?.textContent?.trim()).toBe('Chapter 4');
      expect(fixture.debugElement.query(By.css('.pc-book-context'))
        .nativeElement.getAttribute('aria-label'))
        .toContain(CHAT_STRINGS_EN['bookContextChapterAria']);
    });
  });

  // ── 2. THE REQUEST PAYLOAD, PER SURFACE ─────────────────────────────────────────────────────────

  describe('the request payload per surface', () => {
    it('EDITOR WITH A CHAPTER: sends the id and the order', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[1]);
      ask('זה פרק שעבר עריכה. האם מרגישים את הקונפליקטים?');

      const body = sentBody();
      expect(body.bookId).toBe(BOOK_A);
      expect(body.ambientChapterId).toBe('ch-2');
      expect(body.ambientChapterOrder).toBe(1);
    });

    it('sends ORDER 0 as 0 on the owner\'s real single-chapter book', () => {
      // The whole plan is about this book. A falsy-order bug here would report "nothing is open" and
      // the request would still look perfectly well-formed.
      openDrawer();
      enterBook(BOOK_A, 'הספר של הבעלים');
      openChapter(BOOK_A, OWNERS_ONLY_CHAPTER, [OWNERS_ONLY_CHAPTER]);
      ask('זה פרק שעבר עריכה אחרי שאמרו לי שהסתרה בו סכנה');

      const body = sentBody();
      expect(body.ambientChapterOrder).toBe(0);
      expect(body.ambientChapterId).toBe('ch-owner');
    });

    it('EDITOR WITH NO CHAPTER: sends both keys as EXPLICIT NULL, never omitted', () => {
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A, []);
      ask('what happens in the chapter?');

      const body = sentBody();
      expect('ambientChapterId' in body)
        .withContext('"nothing is open" and "this client is too old to say" must differ on the wire')
        .toBeTrue();
      expect(body.ambientChapterId).toBeNull();
      expect(body.ambientChapterOrder).toBeNull();
    });

    it('THE BOOK DASHBOARD: sends explicit nulls even though a chapter is technically selected', () => {
      // The carve-out is this client's contract: the server can verify only that an id names a chapter
      // of this book, and an editor-with-a-chapter and a dashboard look identical from there.
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      openBookWithoutChapter(BOOK_A);
      ask('מה הסקירה מצאה?');

      const body = sentBody();
      expect(body.ambientChapterId).toBeNull();
      expect(body.ambientChapterOrder).toBeNull();
    });

    it('A BOOK PAGE THAT IS NOT THE EDITOR: sends explicit nulls', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      noSurface();
      ask('q');

      const body = sentBody();
      expect(body.bookId).toBe(BOOK_A);
      expect(body.ambientChapterId).toBeNull();
    });

    it('NO BOOK: the body is byte-identical to phase A\'s, with no ambient keys at all', () => {
      openDrawer();
      openChapter(BOOK_A, CHAPTERS[0]);   // a stale snapshot with nowhere to apply
      books.subject.next(null);
      fixture.detectChanges();
      ask('how do I import?');

      expect(Object.keys(sentBody())).toEqual(['question', 'history', 'language']);
    });

    it('never sends ANOTHER book\'s chapter after a switch', () => {
      openDrawer();
      enterBook(BOOK_A, 'Book A');
      openChapter(BOOK_A, CHAPTERS[0]);

      books.subject.next({ bookId: BOOK_B, title: 'Book B', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_B}/summary`))
        .flush({ hasSummary: true, builtChapters: 4 });
      fixture.detectChanges();

      ask('what happens in this chapter?');
      const body = sentBody();
      expect(body.bookId).toBe(BOOK_B);
      expect(body.ambientChapterId)
        .withContext('a chapter of book A on a question about book B is fabrication with a receipt')
        .toBeNull();
    });

    it('captures the chapter AT SEND TIME, not on arrival', () => {
      // The author can move to another chapter while an answer is in flight. The answer is about the
      // chapter it was asked in.
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      ask('q');
      const req = http.expectOne('/api/product-chat');
      openChapter(BOOK_A, CHAPTERS[1]);

      expect((req.request.body as ProductChatRequest).ambientChapterId).toBe('ch-1');
      req.flush(grounded());
      fixture.detectChanges();
    });
  });

  // ── 3. THE CLARIFYING QUESTION'S CHIPS ──────────────────────────────────────────────────────────

  describe('the clarifying question', () => {
    function chips(): HTMLButtonElement[] {
      return fixture.debugElement
        .queryAll(By.css('.pc-clarify-chip'))
        .map(d => d.nativeElement as HTMLButtonElement);
    }

    it('renders one chip per chapter when the server asks', () => {
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A);
      ask('what happens in the chapter?');
      answer(grounded({ needsChapterClarification: true }));

      const row = fixture.debugElement.query(By.css('[data-testid="pc-clarify"]'));
      expect(row).not.toBeNull();
      expect((row.nativeElement as HTMLElement).textContent)
        .toContain(CHAT_STRINGS_HE['clarifyLabel']);
      expect(chips().map(c => c.textContent?.trim()))
        .toEqual(['הלילה שלפני', 'הדרך צפונה', 'פרק 3']);
    });

    it('is IMPOSSIBLE on a one-chapter book, even if the server asked anyway', () => {
      // The owner's real book. A clarifying question there would be absurd, so it is refused on BOTH
      // halves rather than only on the one that happens to compute it today.
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, OWNERS_ONLY_CHAPTER, [OWNERS_ONLY_CHAPTER]);
      ask('מה קורה בפרק?');
      answer(grounded({ needsChapterClarification: true }));

      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]'))).toBeNull();
    });

    it('is IMPOSSIBLE on a book with NO chapters', () => {
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A, []);
      ask('מה קורה בפרק?');
      answer(grounded({ needsChapterClarification: true }));

      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]'))).toBeNull();
    });

    it('renders NOTHING when the server did not ask', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      ask('מה קורה בפרק הזה?');
      answer(grounded());

      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]'))).toBeNull();
    });

    it('never asks when the ambient chapter RESOLVED, which is the anti-rule', () => {
      // The flag is computed server-side from the selection and is false by construction once a chapter
      // resolved, so this pins the client half: an omitted flag is not a truthy one.
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      ask('זה פרק שעבר עריכה');
      answer(grounded({ artifactRefs: ['chapter-text:0'] }));

      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="pc-book-citation"]'))).not.toBeNull();
    });

    it('a chip RE-ASKS the same question with that chapter as the ambient key', () => {
      // Not by rewriting the question to name a number: a 1-based label against a 0-based order is
      // genuinely ambiguous on the server's explicit path, and the id is not.
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A);
      ask('מה קורה בפרק?');
      answer(grounded({ needsChapterClarification: true }));

      chips()[1].click();
      fixture.detectChanges();

      const body = sentBody();
      expect(body.question).toBe('מה קורה בפרק?');
      expect(body.ambientChapterId).toBe('ch-2');
      expect(body.ambientChapterOrder).toBe(1);
    });

    it('a chip OUTRANKS an open chapter: explicit beats ambient on the client half too', () => {
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A);
      ask('מה קורה בפרק?');
      answer(grounded({ needsChapterClarification: true }));

      // The author opens a chapter, then answers the clarifying question with a DIFFERENT one.
      openChapter(BOOK_A, CHAPTERS[0]);
      chips()[2].click();
      fixture.detectChanges();

      expect(sentBody().ambientChapterId)
        .withContext('the author has just said which chapter they meant')
        .toBe('ch-3');
    });

    it('TAGS the re-asked turn with the chapter, so the repeat is legible', () => {
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A);
      ask('מה קורה בפרק?');
      answer(grounded({ needsChapterClarification: true }));

      chips()[0].click();
      fixture.detectChanges();

      const tag = fixture.debugElement.query(By.css('[data-testid="pc-turn-scope"]'))
        .nativeElement as HTMLElement;
      expect(tag.textContent?.trim())
        .toBe(CHAT_STRINGS_HE['askedAboutChapter'].replace('{0}', 'הלילה שלפני'));
      answer();
    });

    it('leaves an ORDINARY turn untagged: the context line already says the chapter', () => {
      openDrawer();
      enterBook(BOOK_A);
      openChapter(BOOK_A, CHAPTERS[0]);
      ask('q');
      answer();
      expect(fixture.debugElement.query(By.css('[data-testid="pc-turn-scope"]'))).toBeNull();
    });

    it('DISABLES the chips while a request is in flight', () => {
      openDrawer();
      enterBook(BOOK_A);
      openBookWithoutChapter(BOOK_A);
      ask('מה קורה בפרק?');
      answer(grounded({ needsChapterClarification: true }));

      expect(chips()[0].disabled).toBeFalse();
      chips()[0].click();
      fixture.detectChanges();
      expect(chips()[0].disabled).toBeTrue();
      answer();
    });

    it('renders in English chrome too (he/en parity)', () => {
      useEnglish();
      openDrawer();
      enterBook(BOOK_A, 'The Salt Road');
      openBookWithoutChapter(BOOK_A);
      ask('what happens in the chapter?');
      answer(grounded({ language: 'en', needsChapterClarification: true }));

      expect((fixture.debugElement.query(By.css('[data-testid="pc-clarify"]'))
        .nativeElement as HTMLElement).textContent)
        .toContain(CHAT_STRINGS_EN['clarifyLabel']);
    });
  });

  // ── 4. THE NO-BOOK PATH IS UNCHANGED ────────────────────────────────────────────────────────────

  describe('outside a book, nothing about phase A moves', () => {
    it('renders no context line and no clarify row, whatever the ambient service holds', () => {
      openDrawer();
      openChapter(BOOK_A, CHAPTERS[0]);
      books.subject.next(null);
      fixture.detectChanges();

      ask('how do I import?');
      answer(grounded({ language: 'en', guideIds: ['import'], needsChapterClarification: true }));

      expect(fixture.debugElement.query(By.css('.pc-book-context'))).toBeNull();
      expect(chapterLine()).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="pc-clarify"]')))
        .withContext('there is no book whose chapters could be offered')
        .toBeNull();
    });

    it('reads no book status at all', () => {
      openDrawer();
      openChapter(BOOK_A, CHAPTERS[0]);
      http.expectNone(r => r.url.includes('/summary'));
    });
  });
});
