/**
 * ProductChatComponent: HISTORY, THREADING AND RESUME (Show C1, c2).
 *
 * Its own file rather than another 400 lines on the phase-A or phase-B spec, both of which are already
 * at this repo's file-size ceiling. The split is by SUBJECT: everything here is about a conversation
 * outliving the session it was held in.
 *
 * ── THE SPEC THIS FILE EXISTS FOR ─────────────────────────────────────────────────────────────────
 * "the resend window after a resume is IDENTICAL to the one the unbroken session sent". C1 changed no
 * prompt and re-ran no gate, and that identity is what makes that safe rather than assumed. It is
 * asserted ON THE WIRE - the `history` array of a real POST - because that is the only place the
 * property is observable: an entry list that looks right and is then windowed differently would pass a
 * unit assertion and fail the product.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { ProductChatComponent } from './product-chat.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { BookContextService, CurrentBook } from '../../core/services/book-context.service';
import {
  ConversationListDto,
  ConversationListItemDto,
  ConversationMessageDto,
} from '../../core/models/conversation';
import { ProductChatResponseDto, ProductChatTurnDto } from '../../core/models/product-chat';
import { CHAT_STRINGS_EN, CHAT_STRINGS_HE } from '../../core/i18n/chat-strings';
import { HISTORY_STRINGS_EN, HISTORY_STRINGS_HE } from '../../core/i18n/history-strings';

const CONV = 'c0ffee00-0000-4000-8000-000000000001';
const OTHER_CONV = 'c0ffee00-0000-4000-8000-000000000002';
const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

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
    answer: 'Import accepts a DOCX file.',
    guideIds: ['import'],
    language: 'en',
    isGrounded: true,
    faultReason: null,
    conversationId: CONV,
    ...over,
  };
}

function failSafe(over: Partial<ProductChatResponseDto> = {}): ProductChatResponseDto {
  return {
    answer: 'I cannot reach the guides right now.',
    guideIds: [],
    language: 'he',
    isGrounded: false,
    faultReason: 'model-unavailable',
    conversationId: CONV,
    ...over,
  };
}

/** One stored row. `sequence` is the order of record, so every helper below sets it explicitly. */
function stored(
  sequence: number,
  role: 'user' | 'assistant',
  text: string,
  over: Partial<ConversationMessageDto> = {}
): ConversationMessageDto {
  return {
    id: `m-${sequence}`,
    sequence,
    role,
    text,
    failed: false,
    createdAt: '2026-08-16T10:00:00Z',
    askBookId: null,
    askChapterId: null,
    askChapterOrder: null,
    grounding: role === 'assistant'
      ? {
        guideIds: ['import'],
        artifactRefs: [],
        bookFaultReason: null,
        needsChapterClarification: false,
        selectionSummary: null,
      }
      : null,
    ...over,
  };
}

function listRow(over: Partial<ConversationListItemDto> = {}): ConversationListItemDto {
  return {
    id: CONV,
    title: 'How do I import a manuscript?',
    bookId: null,
    createdAt: '2026-08-16T09:00:00Z',
    updatedAt: new Date().toISOString(),
    messageCount: 8,
    ...over,
  };
}

function listOf(items: ConversationListItemDto[]): ConversationListDto {
  return { items, page: 1, pageSize: 20, totalCount: items.length, nearCapWarning: false };
}

describe('ProductChatComponent, conversation history (Show C1)', () => {
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

    mount();
  });

  afterEach(() => http.verify());

  /** Create (or re-create) the drawer. Re-creating is how this file simulates closing the browser. */
  function mount(): void {
    fixture = TestBed.createComponent(ProductChatComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    overlays = TestBed.inject(AppOverlayService);
    fixture.detectChanges();
  }

  function openDrawer(): void {
    overlays.openTab('assistant');
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

  /** The body of the POST currently in flight, without answering it. */
  function inFlight() {
    return http.expectOne('/api/product-chat');
  }

  function exchange(question: string, answer: string): void {
    ask(question);
    inFlight().flush(grounded({ answer }));
    fixture.detectChanges();
  }

  function click(selector: string, index = 0): void {
    const nodes = fixture.debugElement.queryAll(By.css(selector));
    (nodes[index].nativeElement as HTMLElement).click();
    fixture.detectChanges();
  }

  /** Open the history panel and answer the list read it makes on arrival. */
  function openHistory(rows: ConversationListItemDto[] = [listRow()]): void {
    click('[data-testid="pc-history-toggle"]');
    http.expectOne(r => r.url === '/api/conversations').flush(listOf(rows));
    fixture.detectChanges();
  }

  /** Press a row and answer the transcript read, which resumes the conversation. */
  function resumeRow(messages: ConversationMessageDto[], id = CONV, index = 0): void {
    click('[data-testid="ch-open"]', index);
    http.expectOne(r => r.url === `/api/conversations/${id}/messages`)
      .flush({ items: messages, page: 1, pageSize: 500, totalCount: messages.length });
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /**
   * Flip the chrome to English, the way this surface's other specs do.
   *
   * CALLED BEFORE THE THING UNDER ASSERTION IS RENDERED, always, and that is not stylistic. The
   * component is OnPush and writing to a private field marks no view dirty, so a flip after the pane is
   * on screen leaves the old language there and the assertion after it fails for a reason that has
   * nothing to do with the claim. Opening the tab is what marks the view (the async pipe emits), so the
   * flip goes first.
   */
  function useEnglish(): void {
    (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
    fixture.detectChanges();
  }

  // ══ THE PIN ═══════════════════════════════════════════════════════════════════════════════════
  //
  // Everything else in this file is chrome around this one property.

  describe('the byte-identity pin', () => {
    /**
     * The session the pin compares against: six exchanges, one of which FAILED AND WAS RETRIED, so the
     * transcript ends up holding more than the eight turns the window carries and the failed pair is
     * one the live client removed. Both of those are load-bearing: the first exercises the 8-turn
     * slice, the second exercises hydration's retried-failure suppression (the refusal never becomes a
     * turn, and the flagged question is withheld because a later un-failed row repeats it). The
     * un-retried failure, where the flagged question IS replayed, has its own cases below.
     */
    function liveSession(): void {
      exchange('q1', 'a1');
      exchange('q2', 'a2');

      // The failure, and the retry. Live, `retry()` CUTS the failed question and its fault out of the
      // transcript and re-asks through the ordinary path; the server keeps both, flagged.
      ask('q3');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      click('.pc-retry');
      inFlight().flush(grounded({ answer: 'a3' }));
      fixture.detectChanges();

      exchange('q4', 'a4');
      exchange('q5', 'a5');
      exchange('q6', 'a6');
    }

    /**
     * What the server stored for {@link liveSession}, in the shape `GET /messages` returns it.
     *
     * The failed exchange is stored as TWO flagged rows and the retry as two more, which is exactly the
     * asymmetry the pin has to survive: storage holds a question the live transcript threw away.
     */
    function storedSession(): ConversationMessageDto[] {
      return [
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'q2'), stored(3, 'assistant', 'a2'),
        stored(4, 'user', 'q3', { failed: true, grounding: null }),
        stored(5, 'assistant', 'I cannot reach the guides right now.', { failed: true, grounding: null }),
        stored(6, 'user', 'q3'), stored(7, 'assistant', 'a3'),
        stored(8, 'user', 'q4'), stored(9, 'assistant', 'a4'),
        stored(10, 'user', 'q5'), stored(11, 'assistant', 'a5'),
        stored(12, 'user', 'q6'), stored(13, 'assistant', 'a6'),
      ];
    }

    it('the resend window after a resume is IDENTICAL to the one the unbroken session sent', () => {
      // ── 1. The unbroken session, and the window it would send for the next question.
      openDrawer();
      liveSession();

      ask('what about export?');
      const live = inFlight();
      const liveWindow = live.request.body.history as ProductChatTurnDto[];
      // Non-vacuity, three ways, BEFORE the comparison: an empty window, or one that never reached the
      // cap, or one that still carried the failure, would make the identity below meaningless.
      expect(liveWindow.length).toBe(8);
      expect(liveWindow.map(t => t.content)).not.toContain('I cannot reach the guides right now.');
      expect(liveWindow[liveWindow.length - 1].content).toBe('a6');
      live.flush(grounded({ answer: 'export answer' }));
      fixture.detectChanges();

      // ── 2. Close the browser. Literally: the component is destroyed and rebuilt.
      fixture.destroy();
      mount();
      openDrawer();
      expect(component.entries.length)
        .withContext('a rebuilt drawer starts empty, which is what makes the resume real')
        .toBe(0);

      // ── 3. Find the conversation in history and resume it.
      openHistory();
      resumeRow(storedSession());

      // ── 4. Ask the SAME next question, and compare what goes on the wire.
      ask('what about export?');
      const resumed = inFlight();
      const resumedWindow = resumed.request.body.history as ProductChatTurnDto[];

      expect(resumedWindow)
        .withContext(
          'C1 changed no prompt and re-ran no gate; this equality is what makes that safe rather ' +
          'than assumed'
        )
        .toEqual(liveWindow);
      resumed.flush(grounded({ answer: 'export answer' }));
      fixture.detectChanges();
    });

    it('and the question itself, the language and the book are unchanged too', () => {
      // The window is the interesting half, but the pin is about the whole composed request: a resumed
      // conversation that sent the same turns under a different language hint would still move the
      // prompt.
      openDrawer();
      openHistory();
      resumeRow(storedSession());

      ask('what about export?');
      const req = inFlight();
      expect(req.request.body.question).toBe('what about export?');
      expect(req.request.body.language).toBe('he');
      expect('bookId' in req.request.body)
        .withContext('outside a book the phase-A body shape is unchanged, resumed or not')
        .toBeFalse();
      req.flush(grounded());
      fixture.detectChanges();
    });

    it('replays the FULL stored turn, never a truncated copy', () => {
      // The 1,000-character per-turn cap is the SERVER's, applied to what the client sends. A second
      // truncation site would drift from it the moment it is retuned.
      const long = 'x'.repeat(3000);
      openDrawer();
      openHistory();
      resumeRow([stored(0, 'user', long), stored(1, 'assistant', long)]);

      ask('and then?');
      const req = inFlight();
      const window = req.request.body.history as ProductChatTurnDto[];
      expect(window[0].content.length).toBe(3000);
      req.flush(grounded());
      fixture.detectChanges();
    });
  });

  // ══ The window's exclusions, restated on the resumed side ═════════════════════════════════════

  describe('the resumed window\'s exclusions', () => {
    it('drops turns asked in ANOTHER book, exactly as the live rule does', () => {
      // The live rule: a turn taken in a different book stays readable in the transcript and never
      // conditions an answer about the book that is open now. Hydration has to carry the ask-time book
      // for that rule to have anything to read.
      openDrawer();
      books.subject.next({ bookId: BOOK_A, title: 'A Study in Drafts', language: 'he' });
      fixture.detectChanges();
      http.expectOne(r => r.url.includes(`/api/books/${BOOK_A}/summary`))
        .flush({ hasSummary: true, builtChapters: 3 });
      fixture.detectChanges();

      openHistory();
      resumeRow([
        stored(0, 'user', 'about book B', { askBookId: BOOK_B }),
        stored(1, 'assistant', 'answer about B', { askBookId: BOOK_B }),
        stored(2, 'user', 'a product question', { askBookId: null }),
        stored(3, 'assistant', 'a product answer', { askBookId: null }),
        stored(4, 'user', 'about book A', { askBookId: BOOK_A }),
        stored(5, 'assistant', 'answer about A', { askBookId: BOOK_A }),
      ]);

      ask('and now?');
      const req = inFlight();
      const window = (req.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      // Non-vacuity: something really did survive, so the exclusions below are exclusions and not an
      // empty list.
      expect(window.length).toBe(4);
      expect(window).toContain('about book A');
      expect(window).toContain('a product question');
      expect(window).not.toContain('about book B');
      expect(window).not.toContain('answer about B');
      req.flush(grounded());
      fixture.detectChanges();
    });

    it('renders the context-change markers those book switches imply', () => {
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'about book A', { askBookId: BOOK_A }),
        stored(1, 'assistant', 'answer', { askBookId: BOOK_A }),
        stored(2, 'user', 'about book B', { askBookId: BOOK_B }),
        stored(3, 'assistant', 'answer', { askBookId: BOOK_B }),
      ]);

      const markers = fixture.debugElement.queryAll(By.css('[data-testid="pc-book-marker"]'));
      expect(markers.length).toBe(1);
    });

    it('renders a failed exchange as the FAILURE UI, and never as an assistant bubble', () => {
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q', { failed: true, grounding: null }),
        stored(1, 'assistant', 'I cannot reach the guides right now.', { failed: true, grounding: null }),
      ]);

      expect(fixture.debugElement.query(By.css('.pc-fault'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).toBeNull();
      // The server's own fail-safe prose is not what the author reads: the client's per-reason copy is,
      // exactly as for a live failure.
      expect(text()).not.toContain('I cannot reach the guides right now.');
      expect(text()).toContain(CHAT_STRINGS_HE['faultUnknown']);
    });

    /**
     * THE PIN'S NARROWEST CASE, and the one it used to fail.
     *
     * The LIVE client is not symmetrical about a failure: `ask()` appends the author's turn before the
     * request goes out and `acceptFault` does not remove it - only `retry()` cuts the pair - so a
     * failure the author did NOT retry leaves its question in the live transcript, and the live window
     * carries it. Hydration folded both flagged rows into a single fault and emitted no turn, so the
     * resumed window was short by exactly that question.
     *
     * It is closed from the HYDRATION side, which is why this is a positive pin rather than a
     * documented deviation: emitting the failed question as a `user` entry changes which entries a
     * resumed transcript holds and changes NOTHING about which entries `historyForServer()` selects.
     * No gated prompt path moves, so C1 still needs no re-gate.
     */
    it('an un-retried failure leaves its question in the resumed window too, exactly as live', () => {
      openDrawer();
      exchange('q1', 'a1');
      ask('the question that failed');
      inFlight().flush(failSafe());
      fixture.detectChanges();

      ask('a different question');
      const live = inFlight();
      const liveWindow = (live.request.body.history as ProductChatTurnDto[]).map(t => t.content);
      expect(liveWindow).toContain('the question that failed');
      live.flush(grounded());
      fixture.detectChanges();

      fixture.destroy();
      mount();
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(3, 'assistant', 'refusal', { failed: true, grounding: null }),
      ]);

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);
      expect(resumedWindow).toEqual(['q1', 'a1', 'the question that failed']);
      expect(resumedWindow)
        .withContext('the resumed window and the live one are the same window, failure and all')
        .toEqual(liveWindow);
      // The REFUSAL is still the half that never goes back up: replaying the server's fail-safe prose
      // as an assistant turn would condition the next answer on words the assistant never said.
      expect(resumedWindow).not.toContain('refusal');
      resumed.flush(grounded());
      fixture.detectChanges();
    });

    /**
     * THE MIRROR CASE, on a conversation too short for the 8-turn slice to hide it.
     *
     * `retry()` removes the user turn AND the fault before re-asking, so a live session that retried
     * holds ONE copy of that question; storage holds two, the flagged pair and the retry's fresh pair.
     * Replaying the flagged one as a turn would send the question TWICE - a SUPERSET of the live
     * window, which inflates what the model reads rather than merely dropping context. Hydration tells
     * the two apart by the only trace `retry()` leaves, the identical stored text of a LATER un-failed
     * question; see `conversation-hydration.ts` for what that derivation costs.
     *
     * The pin above uses a six-exchange session where the duplicate falls off the front of the slice,
     * which is exactly why this cell has to be its own, short one.
     */
    it('a RETRIED failure leaves its question in the resumed window ONCE, exactly as live', () => {
      openDrawer();
      exchange('q1', 'a1');
      ask('the question that failed');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      click('.pc-retry');
      inFlight().flush(grounded({ answer: 'the answer after the retry' }));
      fixture.detectChanges();

      ask('a different question');
      const live = inFlight();
      const liveWindow = (live.request.body.history as ProductChatTurnDto[]).map(t => t.content);
      // Non-vacuity: the live transcript really did keep the retried question, once.
      expect(liveWindow).toEqual(['q1', 'a1', 'the question that failed', 'the answer after the retry']);
      live.flush(grounded());
      fixture.detectChanges();

      fixture.destroy();
      mount();
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(3, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(4, 'user', 'the question that failed'),
        stored(5, 'assistant', 'the answer after the retry'),
      ]);

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      // Asserted by CONTENT before the whole-window equality, so a hydration that replays both copies
      // fails on a message naming the duplicated question rather than on a bare length mismatch.
      expect(resumedWindow.filter(c => c === 'the question that failed'))
        .withContext('storage holds the retried question twice; the live transcript holds it once')
        .toEqual(['the question that failed']);
      expect(resumedWindow)
        .withContext('the resumed window and the live one are the same window, retry and all')
        .toEqual(liveWindow);
      resumed.flush(grounded());
      fixture.detectChanges();
    });

    /**
     * THE CELL BETWEEN THE TWO ABOVE: retried, and the retry FAILED TOO.
     *
     * `retry()` cuts the pair out before re-asking whatever the second attempt then does, so the live
     * transcript holds ONE failed pair however many attempts failed - while storage holds one flagged
     * pair per attempt. A suppression that only counted a later UN-FAILED row saw no retry here and
     * replayed every attempt, which is the SUPERSET divergence the derivation exists to prevent, in the
     * shape a bad afternoon actually has: with the model unreachable, the retry fails too.
     */
    it('a failure RETRIED INTO A SECOND FAILURE leaves its question in the resumed window once', () => {
      openDrawer();
      exchange('q1', 'a1');
      ask('the question that failed');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      click('.pc-retry');
      inFlight().flush(failSafe());
      fixture.detectChanges();

      ask('a different question');
      const live = inFlight();
      const liveWindow = (live.request.body.history as ProductChatTurnDto[]).map(t => t.content);
      // Non-vacuity: after two failed attempts the live transcript really is holding that question once.
      expect(liveWindow).toEqual(['q1', 'a1', 'the question that failed']);
      live.flush(grounded());
      fixture.detectChanges();

      fixture.destroy();
      mount();
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(3, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(4, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(5, 'assistant', 'refusal', { failed: true, grounding: null }),
      ]);

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      // By CONTENT before the whole-window equality, so replaying both attempts fails on a message
      // naming the duplicated question rather than on a bare length mismatch.
      expect(resumedWindow.filter(c => c === 'the question that failed'))
        .withContext('two failed attempts are two stored pairs and one live pair')
        .toEqual(['the question that failed']);
      expect(resumedWindow)
        .withContext('the resumed window and the live one are the same window, both failures and all')
        .toEqual(liveWindow);
      resumed.flush(grounded());
      fixture.detectChanges();
    });

    /**
     * THE REST OF THE RETRY MATRIX ON THE WIRE (final-r02).
     *
     * The three cells above were each written after a defect was found in the cell beside them. These
     * are the remaining reachable ones, enumerated from the two facts a stored `user` row carries - its
     * text and its `failed` flag - rather than from the next bug report. The shape half of each lives in
     * `conversation-hydration.spec.ts`; the window is only observable here, so the cells that deviate
     * are pinned HERE, where the live and resumed windows can be compared side by side.
     */
    it('a failure retried TWICE leaves its question in the resumed window once', () => {
      openDrawer();
      exchange('q1', 'a1');
      ask('the question that failed');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      click('.pc-retry');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      click('.pc-retry');
      inFlight().flush(grounded({ answer: 'the answer after the second retry' }));
      fixture.detectChanges();

      ask('a different question');
      const live = inFlight();
      const liveWindow = (live.request.body.history as ProductChatTurnDto[]).map(t => t.content);
      // Non-vacuity: three attempts really did collapse to one live turn plus the answer.
      expect(liveWindow)
        .toEqual(['q1', 'a1', 'the question that failed', 'the answer after the second retry']);
      live.flush(grounded());
      fixture.detectChanges();

      fixture.destroy();
      mount();
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(3, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(4, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(5, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(6, 'user', 'the question that failed'),
        stored(7, 'assistant', 'the answer after the second retry'),
      ]);

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      expect(resumedWindow.filter(c => c === 'the question that failed'))
        .withContext('three stored attempts of one question are one turn live and one here')
        .toEqual(['the question that failed']);
      expect(resumedWindow)
        .withContext('the resumed window and the live one are the same window, both retries and all')
        .toEqual(liveWindow);
      resumed.flush(grounded());
      fixture.detectChanges();
    });

    /**
     * THE ONE CELL THAT IS WRONG, PINNED AS WHAT IT IS RATHER THAN LEFT TO BE REDISCOVERED.
     *
     * An author who RETYPES a failed question instead of pressing retry produces rows byte-identical to
     * a retry's, and storage records nothing that tells the two apart - not a column, not a field on
     * `ProductChatRequest`. So hydration reads this as a retry and the resumed window carries the
     * question ONCE where the live session carried it twice.
     *
     * IT IS THE SUBSET DIRECTION, which is why it is tolerated: it drops context rather than inflating
     * the window the model reads, and it is the same direction the feature already tolerated before the
     * failed question was replayed at all. The assertion below states the deviation exactly - one copy
     * fewer and nothing else different - so a future change that made it worse in either direction
     * would fail here rather than quietly widen it. Closing it needs the retry RECORDED; see the plan's
     * `## Recommendation for the owner`.
     */
    it('KNOWN DEVIATION: a hand-retyped repeat sends ONE copy fewer than the live session did', () => {
      openDrawer();
      exchange('q1', 'a1');
      ask('the question that failed');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      // RETYPED, not retried: the composer is used again, so nothing removes the failed pair.
      ask('the question that failed');
      inFlight().flush(grounded({ answer: 'the answer after retyping' }));
      fixture.detectChanges();

      ask('a different question');
      const live = inFlight();
      const liveWindow = (live.request.body.history as ProductChatTurnDto[]).map(t => t.content);
      // Non-vacuity: the live transcript really is holding that question twice.
      expect(liveWindow.filter(c => c === 'the question that failed'))
        .withContext('only retry() removes entries, so a retype leaves both copies live')
        .toEqual(['the question that failed', 'the question that failed']);
      live.flush(grounded());
      fixture.detectChanges();

      fixture.destroy();
      mount();
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(3, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(4, 'user', 'the question that failed'),
        stored(5, 'assistant', 'the answer after retyping'),
      ]);

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      // EXACTLY the live window minus one copy of the retyped question: a SUBSET, and a subset of a
      // stated shape rather than "shorter somehow".
      const liveMinusOneCopy = [...liveWindow];
      liveMinusOneCopy.splice(liveWindow.indexOf('the question that failed'), 1);
      expect(resumedWindow)
        .withContext('the deviation is one dropped copy and nothing else')
        .toEqual(liveMinusOneCopy);
      expect(resumedWindow.length)
        .withContext('the resumed window must never be LONGER than the live one: that is the unsafe direction')
        .toBeLessThan(liveWindow.length);
      resumed.flush(grounded());
      fixture.detectChanges();
    });

    /**
     * A FAILED PAIR SPLIT ACROSS A PAGE BOUNDARY is still one pair.
     *
     * `ConversationService.allMessages` walks the pages and hands hydration the whole conversation, so
     * the question on page 1 and the refusal on page 2 meet in one array. A hydration fed page 1 alone
     * would hold a dangling failed question and, worse, would be missing exactly the newest turns the
     * next request is composed from - the messages endpoint is paged OLDEST FIRST.
     */
    it('reassembles a failed pair SPLIT ACROSS A PAGE BOUNDARY, and walks to the newest turns', () => {
      openDrawer();
      openHistory();
      click('[data-testid="ch-open"]');

      const page1 = [
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the question that failed', { failed: true, grounding: null }),
      ];
      const page2 = [
        stored(3, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(4, 'user', 'q2'), stored(5, 'assistant', 'a2'),
      ];
      http.expectOne(r => r.url === `/api/conversations/${CONV}/messages`)
        .flush({ items: page1, page: 1, pageSize: 3, totalCount: 6 });
      // THE SECOND PAGE IS ASSERTED, not merely allowed: without this line the case would pass over a
      // client that read page 1 and stopped, because `expectOne` only fails on an UNexpected request at
      // `http.verify()` time and the window below would still hold the failed question.
      http.expectOne(r => r.url === `/api/conversations/${CONV}/messages`)
        .flush({ items: page2, page: 2, pageSize: 3, totalCount: 6 });
      fixture.detectChanges();

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      expect(resumedWindow)
        .withContext('every turn of both pages, with the failed question replayed once and the refusal never')
        .toEqual(['q1', 'a1', 'the question that failed', 'q2', 'a2']);
      // The pair really was reassembled: one failure card, not a dangling question and no fault.
      expect(fixture.debugElement.queryAll(By.css('.pc-fault')).length).toBe(1);
      resumed.flush(grounded());
      fixture.detectChanges();
    });

    /**
     * RETRYING A RESTORED FAULT MUST NOT EAT THE TURN ABOVE IT (found by final-r02).
     *
     * Hydration withholds the question of a failure it reads as retried and files the fault alone, so a
     * RESTORED transcript can hold a fault whose neighbour above is a different exchange entirely - a
     * shape no live session ever holds, because `ask()` always appends the question first. `retry()`
     * used to cut "the user entry above me" unconditionally, which in that shape deletes an unrelated
     * question out of the transcript the author is reading AND off the next request's window.
     *
     * The fixture is ordinary in every step: a question whose answer never came back (the tab was
     * closed mid-flight), then a question that failed and was retried successfully.
     */
    it('retrying a RESTORED fault re-asks its own question and leaves the turn above it alone', () => {
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'the question whose answer never came'),
        stored(1, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(2, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(3, 'user', 'the question that failed'),
        stored(4, 'assistant', 'the answer after the retry'),
      ]);

      // The shape this case is about: the fault has no question of its own above it, because hydration
      // withheld it. Asserted, so the case cannot quietly stop exercising the shape.
      expect(component.entries.map(e => e.kind))
        .withContext('a restored retried failure files the fault with an unrelated turn above it')
        .toEqual(['user', 'fault', 'user', 'assistant']);

      click('.pc-retry');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      // By CONTENT, so a retry that ate the neighbour fails on a message naming the lost question.
      expect(resumedWindow)
        .withContext('retrying the restored fault must re-ask its own question, not delete somebody else\'s')
        .toEqual([
          'the question whose answer never came',
          'the question that failed',
          'the answer after the retry',
        ]);
      expect(resumed.request.body.question).toBe('the question that failed');
      // And it is still on screen: the author watched a bubble they never touched, not one disappear.
      expect(text()).toContain('the question whose answer never came');

      resumed.flush(grounded());
      fixture.detectChanges();
    });

    it('still SHOWS the retried failure in the resumed transcript, even though it sends no turn', () => {
      // A fault is a display entry `historyForServer()` can never select, so keeping it costs the
      // window nothing - and the author resuming should still see that this question failed once.
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'the question that failed', { failed: true, grounding: null }),
        stored(1, 'assistant', 'refusal', { failed: true, grounding: null }),
        stored(2, 'user', 'the question that failed'),
        stored(3, 'assistant', 'the answer after the retry'),
      ]);

      // The question appears ONCE on screen as a turn. Asserted by the rendered TEXT rather than by a
      // count of bubbles, so a transcript that shows it twice fails on a message naming the repeated
      // question instead of on "Expected 2 to be 1".
      const userBubbles = fixture.debugElement
        .queryAll(By.css('.pc-bubble--user'))
        .map(node => (node.nativeElement as HTMLElement).textContent?.trim());
      expect(userBubbles).toEqual(['the question that failed']);
      expect(fixture.debugElement.query(By.css('.pc-fault'))).not.toBeNull();
      expect(text()).toContain(CHAT_STRINGS_HE['faultUnknown']);
    });

    /**
     * A TRAILING QUESTION WHOSE ANSWER NEVER LANDED IS RESENT, and the design doc said the opposite.
     *
     * §2.8.2 read "a trailing user turn with no answer after it (a request that died in flight) is
     * likewise not resent" until sweep01. It never was true: the row carries no `failed` flag (nothing
     * ever reached the code that sets one), so hydration rebuilds it as an ordinary `user` entry and
     * `historyForServer()` sends it.
     *
     * It is also the right behaviour, which is why the doc moved rather than the code. `ask()` appends
     * the author's turn before the request goes out, so the transcript the live session was holding at
     * the instant it died held that question; a resumed session that dropped it would send a window
     * strictly smaller than the one that session would have sent, which is the byte-identity pin broken
     * in the same direction c01 closed for an un-retried failure.
     */
    it('resends a trailing question whose answer never landed, exactly as the live transcript held it', () => {
      openDrawer();
      openHistory();
      resumeRow([
        stored(0, 'user', 'q1'), stored(1, 'assistant', 'a1'),
        stored(2, 'user', 'the one that never came back'),
      ]);

      ask('a different question');
      const resumed = inFlight();
      const resumedWindow = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.content);

      // By CONTENT and in full, so a hydration that dropped the orphan fails on a message naming the
      // lost question rather than on a count.
      expect(resumedWindow).toEqual(['q1', 'a1', 'the one that never came back']);
      // And it went up as the AUTHOR's turn, not as anything else: an unflagged row is not a failure.
      const roles = (resumed.request.body.history as ProductChatTurnDto[]).map(t => t.role);
      expect(roles).toEqual(['user', 'assistant', 'user']);
      expect(fixture.debugElement.query(By.css('.pc-fault'))).toBeNull();

      resumed.flush(grounded());
      fixture.detectChanges();
    });
  });

  // ══ Threading ════════════════════════════════════════════════════════════════════════════════

  describe('threading the conversation id', () => {
    it('OMITS the id on a first question, keeping that body byte-identical to phase B\'s', () => {
      openDrawer();
      ask('how do I import?');
      const req = inFlight();
      expect('conversationId' in req.request.body).toBeFalse();
      expect(Object.keys(req.request.body)).toEqual(['question', 'history', 'language']);
      req.flush(grounded());
      fixture.detectChanges();
    });

    it('ADOPTS the id the server returned, and sends it on every question after', () => {
      openDrawer();
      ask('first');
      inFlight().flush(grounded());
      fixture.detectChanges();
      expect(component.conversationId).toBe(CONV);

      ask('second');
      const second = inFlight();
      expect(second.request.body.conversationId).toBe(CONV);
      second.flush(grounded());
      fixture.detectChanges();
    });

    it('adopts it from a FAIL-SAFE answer too, so a refusal does not start a new thread', () => {
      // A failed exchange is persisted flagged rather than dropped, so it has a conversation id like
      // any other. Threading only on success would start a fresh conversation for every question asked
      // after a refusal.
      openDrawer();
      ask('first');
      inFlight().flush(failSafe());
      fixture.detectChanges();
      expect(component.conversationId).toBe(CONV);
    });

    it('adopts an id that DIFFERS from the one it sent (the server re-created the conversation)', () => {
      // A stale id is not an error server-side: a new conversation is started and its id returned. A
      // client that kept its dead id would write every later turn into yet another new conversation.
      openDrawer();
      ask('first');
      inFlight().flush(grounded());
      fixture.detectChanges();

      ask('second');
      const second = inFlight();
      expect(second.request.body.conversationId).toBe(CONV);
      second.flush(grounded({ conversationId: OTHER_CONV }));
      fixture.detectChanges();
      expect(component.conversationId).toBe(OTHER_CONV);
    });

    it('leaves the thread alone when the server returns a NULL id (the write faulted, the answer stands)', () => {
      openDrawer();
      ask('first');
      inFlight().flush(grounded());
      fixture.detectChanges();

      ask('second');
      inFlight().flush(grounded({ conversationId: null }));
      fixture.detectChanges();
      expect(component.conversationId)
        .withContext('dropping the id would detach the next question from a conversation that exists')
        .toBe(CONV);
    });

    it('threads the RESUMED conversation, so a follow-up is written where it belongs', () => {
      openDrawer();
      openHistory([listRow({ id: OTHER_CONV })]);
      resumeRow([stored(0, 'user', 'q'), stored(1, 'assistant', 'a')], OTHER_CONV);

      expect(component.conversationId).toBe(OTHER_CONV);
      ask('a follow-up');
      const req = inFlight();
      expect(req.request.body.conversationId).toBe(OTHER_CONV);
      req.flush(grounded({ conversationId: OTHER_CONV }));
      fixture.detectChanges();
    });
  });

  // ══ New conversation ═════════════════════════════════════════════════════════════════════════

  describe('new conversation, unified with the A.1 reset', () => {
    it('drops the thread, so the next question mints a NEW conversation server-side', () => {
      openDrawer();
      exchange('first', 'first answer');
      expect(component.conversationId).toBe(CONV);

      component.startNewConversation();
      fixture.detectChanges();
      expect(component.conversationId).toBeNull();

      ask('after the new');
      const req = inFlight();
      expect('conversationId' in req.request.body).toBeFalse();
      expect(req.request.body.history).toEqual([]);
      req.flush(grounded({ conversationId: OTHER_CONV }));
      fixture.detectChanges();
      expect(component.conversationId).toBe(OTHER_CONV);
    });

    it('DESTROYS NOTHING: no delete is issued, and the old conversation is still listed', () => {
      // This is the difference C1 made, and the reason the copy had to change. `http.verify()` in the
      // afterEach is what fails if a DELETE was sent.
      openDrawer();
      exchange('first', 'first answer');

      click('.pc-new');
      click('.pc-reset-yes');
      expect(component.entries.length).toBe(0);

      openHistory([listRow({ id: CONV, title: 'first' })]);
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);
      expect(text()).toContain('first');
    });

    it('reads as NEW rather than as clearing, in Hebrew', () => {
      openDrawer();
      exchange('first', 'first answer');
      click('.pc-new');

      const bar = fixture.debugElement.query(By.css('.pc-conversation-bar')).nativeElement as HTMLElement;
      expect(bar.textContent).toContain(CHAT_STRINGS_HE['newConversationConfirm']);
      expect(bar.textContent).toContain('שיחה חדשה');
      expect(bar.textContent)
        .withContext('A.1\'s "clear it" promised a destruction that C1 stopped performing')
        .not.toContain('לנקות');

      click('.pc-reset-no');
    });

    it('reads as NEW rather than as clearing, in English', () => {
      useEnglish();
      openDrawer();
      exchange('first', 'first answer');
      click('.pc-new');

      const bar = fixture.debugElement.query(By.css('.pc-conversation-bar')).nativeElement as HTMLElement;
      expect(bar.textContent).toContain(CHAT_STRINGS_EN['newConversationConfirm']);
      expect(bar.textContent?.toLowerCase()).not.toContain('clear');

      click('.pc-reset-no');
    });

    it('a resumed conversation can be stepped away from like any other', () => {
      openDrawer();
      openHistory();
      resumeRow([stored(0, 'user', 'q'), stored(1, 'assistant', 'a')]);
      expect(component.entries.length).toBe(2);

      component.startNewConversation();
      fixture.detectChanges();
      expect(component.entries.length).toBe(0);
      expect(component.conversationId).toBeNull();
    });
  });

  // ══ Delete ═══════════════════════════════════════════════════════════════════════════════════

  describe('deleting the conversation being read', () => {
    it('stops threading it but LEAVES the transcript on screen', () => {
      // Emptying the pane would be a second, unasked destruction of what the author is reading; leaving
      // it threaded to a row that no longer exists would write the next exchange into a conversation
      // the server has to re-create anyway.
      openDrawer();
      exchange('first', 'first answer');
      expect(component.conversationId).toBe(CONV);

      openHistory([listRow({ id: CONV })]);
      click('[data-testid="ch-delete"]');
      click('[data-testid="ch-delete-yes"]');
      http.expectOne(`/api/conversations/${CONV}`).flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      expect(component.conversationId).toBeNull();
      click('[data-testid="pc-history-toggle"]');
      expect(component.entries.length).toBe(2);
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(2);
    });

    /**
     * THE DELETE-WHILE-ANSWERING WINDOW.
     *
     * The POST is held UNFLUSHED across the delete, which is the only ordering in which the defect
     * exists: nulling `conversationId` does not reach a request that already carries it, and
     * `adoptConversation` takes whatever id comes back, so the deleted id was written straight back
     * onto the fresh thread and the next question threaded a conversation that no longer exists.
     *
     * The remedy is deliberately NOT `reset$`. Cancelling would throw away an answer the author is
     * sitting waiting for, and deleting a row from a list says nothing about the question currently
     * being answered - so the answer lands, and only the dead id is refused.
     */
    it('lets the answer LAND but refuses the deleted id, so the next question does not thread a ghost', () => {
      openDrawer();
      exchange('first', 'first answer');
      expect(component.conversationId).toBe(CONV);

      ask('a question whose answer is still coming');
      const late = inFlight();
      expect(late.request.body.conversationId)
        .withContext('the in-flight request must really carry the id about to be deleted')
        .toBe(CONV);

      openHistory([listRow({ id: CONV })]);
      click('[data-testid="ch-delete"]');
      click('[data-testid="ch-delete-yes"]');
      http.expectOne(`/api/conversations/${CONV}`).flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();
      expect(component.conversationId).toBeNull();

      // The answer arrives after the delete, still naming the conversation it was written under.
      late.flush(grounded({ answer: 'the answer worth keeping', conversationId: CONV }));
      fixture.detectChanges();

      expect(component.conversationId)
        .withContext('the deleted conversation\'s id was adopted back, so the next question threads it')
        .toBeNull();

      // The answer itself was NOT discarded: that is what firing `reset$` here would have cost.
      click('[data-testid="pc-history-toggle"]');
      expect(text()).toContain('the answer worth keeping');

      // And the next question mints a fresh conversation rather than sending the dead id.
      ask('the next question');
      const next = inFlight();
      expect('conversationId' in next.request.body)
        .withContext('a dead conversation id went back on the wire')
        .toBeFalse();
      next.flush(grounded({ conversationId: OTHER_CONV }));
      fixture.detectChanges();
      expect(component.conversationId).toBe(OTHER_CONV);
    });

    it('leaves the thread alone when a DIFFERENT conversation is deleted', () => {
      openDrawer();
      exchange('first', 'first answer');

      openHistory([listRow({ id: OTHER_CONV })]);
      click('[data-testid="ch-delete"]');
      click('[data-testid="ch-delete-yes"]');
      http.expectOne(`/api/conversations/${OTHER_CONV}`)
        .flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      expect(component.conversationId).toBe(CONV);
    });
  });

  // ══ The affordance itself ════════════════════════════════════════════════════════════════════

  describe('the history affordance on Show\'s tab', () => {
    it('is offered even in the EMPTY state, which is when it is needed most', () => {
      openDrawer();
      expect(component.entries.length).toBe(0);
      expect(fixture.debugElement.query(By.css('[data-testid="pc-history-toggle"]'))).not.toBeNull();
    });

    it('REPLACES the transcript and the composer while it is open, and gives them back', () => {
      openDrawer();
      exchange('first', 'first answer');
      expect(fixture.debugElement.query(By.css('.pc-composer'))).not.toBeNull();

      openHistory();
      expect(fixture.debugElement.query(By.css('.pc-body'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-composer'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.ch-panel'))).not.toBeNull();

      click('[data-testid="pc-history-toggle"]');
      expect(fixture.debugElement.query(By.css('.pc-composer'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.ch-panel'))).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(2);
    });

    it('closes when the author leaves the tab, so the drawer reopens on the conversation', () => {
      openDrawer();
      openHistory();
      expect(component.historyOpen).toBeTrue();

      overlays.selectTab('activity');
      fixture.detectChanges();
      overlays.selectTab('assistant');
      fixture.detectChanges();

      expect(component.historyOpen).toBeFalse();
      expect(fixture.debugElement.query(By.css('.pc-composer'))).not.toBeNull();
    });

    it('disarms an armed new-conversation confirmation, because the author went elsewhere', () => {
      openDrawer();
      exchange('first', 'first answer');
      click('.pc-new');
      expect(component.confirmingReset).toBeTrue();

      openHistory();
      expect(component.confirmingReset).toBeFalse();
    });

    it('names where the press GOES, not the state it leaves (Hebrew chrome)', () => {
      openDrawer();
      const toggle = () =>
        (fixture.debugElement.query(By.css('[data-testid="pc-history-toggle"]'))
          .nativeElement as HTMLElement);

      expect(toggle().textContent).toContain(HISTORY_STRINGS_HE['historyTrigger']);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');

      openHistory();
      expect(toggle().textContent).toContain(HISTORY_STRINGS_HE['historyBack']);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });

    /**
     * THE SECOND SITE OF f01's CLASS, found by sweep01 and fixed the same way.
     *
     * The trigger carried `[attr.aria-label]="historyTriggerAria"` while closed, and an `aria-label`
     * REPLACES the name computed from a button's contents rather than adding to it - so the visible
     * "שיחות קודמות" was discarded in favour of "פתיחת רשימת השיחות הקודמות". In Hebrew the two are not
     * even substrings of one another (the aria copy prefixes the definite article), so the announced
     * name disagreed with the name on screen and voice control could not address the button by what it
     * reads.
     *
     * MECHANISM PROXY, exactly as the sibling case in `conversation-history.component.spec.ts` says:
     * this suite does not run the browser's accessible-name algorithm, so it asserts the two facts that
     * algorithm reads - no name-replacing attribute, and the visible label present inside the button.
     */
    it('lets its VISIBLE label be its accessible name, in both states', () => {
      openDrawer();
      const toggle = () =>
        (fixture.debugElement.query(By.css('[data-testid="pc-history-toggle"]'))
          .nativeElement as HTMLElement);

      expect(toggle().getAttribute('aria-label'))
        .withContext('an aria-label on the trigger replaces its computed name, discarding the visible label')
        .toBeNull();
      expect(toggle().textContent).toContain(HISTORY_STRINGS_HE['historyTrigger']);

      openHistory();
      expect(toggle().getAttribute('aria-label')).toBeNull();
      expect(toggle().textContent).toContain(HISTORY_STRINGS_HE['historyBack']);
    });

    it('says the same two things in ENGLISH chrome, and pushes that language into the list', () => {
      useEnglish();
      openDrawer();
      const toggle = () =>
        (fixture.debugElement.query(By.css('[data-testid="pc-history-toggle"]'))
          .nativeElement as HTMLElement);

      expect(toggle().textContent).toContain(HISTORY_STRINGS_EN['historyTrigger']);
      openHistory();
      expect(toggle().textContent).toContain(HISTORY_STRINGS_EN['historyBack']);
      // The list follows the drawer's language rather than deciding its own, so the two halves of one
      // panel can never disagree.
      expect(text()).toContain(HISTORY_STRINGS_EN['historyTitle']);
      expect(text()).toContain(HISTORY_STRINGS_EN['historyRename']);
    });

    it('is RTL in Hebrew chrome, like the rest of this surface', () => {
      openDrawer();
      openHistory();
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(text()).toContain(HISTORY_STRINGS_HE['historyTitle']);
    });

    it('is LTR in English chrome', () => {
      useEnglish();
      openDrawer();
      openHistory();
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
    });
  });

  // ══ Resume as a state change ═════════════════════════════════════════════════════════════════

  describe('resuming', () => {
    it('renders the stored transcript and closes the panel', () => {
      openDrawer();
      openHistory();
      resumeRow([stored(0, 'user', 'how do I export?'), stored(1, 'assistant', 'Use the export page.')]);

      expect(fixture.debugElement.query(By.css('.ch-panel'))).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(2);
      expect(text()).toContain('how do I export?');
      expect(text()).toContain('Use the export page.');
    });

    it('REPLACES whatever was on screen rather than appending to it', () => {
      // The row resumed here must be a DIFFERENT conversation from the live one: the current
      // conversation's own row is refused (see `conversation-history.component.spec.ts`), so this
      // exercises the ordinary case - opening a stored, non-active conversation - rather than one the
      // panel would now decline to open at all.
      openDrawer();
      exchange('a live question', 'a live answer');

      openHistory([listRow({ id: OTHER_CONV })]);
      resumeRow(
        [stored(0, 'user', 'a stored question'), stored(1, 'assistant', 'a stored answer')],
        OTHER_CONV
      );

      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(2);
      expect(text()).toContain('a stored question');
      expect(text()).not.toContain('a live question');
    });

    it('CANCELS a request that belonged to the conversation being left', () => {
      // Same mechanism the new-conversation control uses: the in-flight request is unsubscribed, so
      // neither its answer nor its conversation id can land on the transcript that replaced it.
      openDrawer();
      ask('a question whose answer will be too late');
      const late = inFlight();

      openHistory();
      resumeRow([stored(0, 'user', 'q'), stored(1, 'assistant', 'a')]);

      expect(late.cancelled).toBeTrue();
      expect(component.pending).toBeFalse();
      expect(component.conversationId).toBe(CONV);
      expect(() => late.flush(grounded({ answer: 'the late answer', conversationId: OTHER_CONV })))
        .toThrowError(/cancel/i);
      fixture.detectChanges();
      expect(text()).not.toContain('the late answer');
    });
  });

  // ══ Where a resume LANDS ═════════════════════════════════════════════════════════════════════
  //
  // Found in the browser, not here: a resumed 16-message conversation opened 3,347px above its newest
  // turn, because `.pc-body` is created by the same change-detection pass that closes the history panel
  // and the deferred write fired before that pass ran. These cases are laid out against a REAL bounded
  // height so the transcript genuinely overflows; without that, `scrollHeight === clientHeight` and
  // every scroll assertion below would pass with no scroll having happened.

  describe('where a resume lands', () => {
    /**
     * Give the pane a real, bounded height, which a fixture does not otherwise have.
     *
     * `:host { display: contents }` means this component contributes no box of its own and the dock
     * supplies the flex column it fills. The inline style overrides that host rule (inline wins) and
     * makes the fixture root that column, so the transcript is squeezed and has somewhere to scroll.
     */
    function boundTheHeight(px = 240): void {
      const root = fixture.nativeElement as HTMLElement;
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.height = `${px}px`;
    }

    /** A stored conversation long enough to overflow the height above. */
    function longConversation(exchanges = 8): ConversationMessageDto[] {
      const rows: ConversationMessageDto[] = [];
      for (let i = 0; i < exchanges; i++) {
        rows.push(stored(i * 2, 'user', `stored question number ${i + 1}`));
        rows.push(stored(i * 2 + 1, 'assistant', `stored answer number ${i + 1}`));
      }
      return rows;
    }

    function body(): HTMLElement {
      return fixture.debugElement.query(By.css('.pc-body')).nativeElement as HTMLElement;
    }

    function distanceFromBottom(el: HTMLElement): number {
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    }

    it('puts the author AT the newest turn, not at the top of the stored conversation', () => {
      openDrawer();
      boundTheHeight();
      openHistory();
      resumeRow(longConversation());

      const el = body();
      // THE OVERFLOW MUST BE THE TRANSCRIPT'S, and this line is why the turn count is asserted before
      // the height. With no entries the pane renders Show's empty state - the greeting and its example
      // prompts - which is itself taller than the bounded height, so `scrollHeight > clientHeight` is
      // satisfied by content that is not a conversation at all. A closing-review mutation that made
      // `longConversation()` return nothing left both cases in this block GREEN for exactly that reason.
      const turns = fixture.debugElement.queryAll(By.css('.pc-turn'));
      expect(turns.length)
        .withContext('the resumed transcript must hold the stored turns, or the height below is the empty state\'s')
        .toBe(16);
      expect(el.scrollHeight)
        .withContext('the transcript must actually overflow, or this case asserts nothing')
        .toBeGreaterThan(el.clientHeight + 100);
      expect(distanceFromBottom(el))
        .withContext(
          'pixels between the resumed transcript and its newest turn: a resume must land AT the ' +
          'latest turn, and this is the measurement the browser gate reads'
        )
        .toBeLessThanOrEqual(1);
      // And the claim is about the NEWEST TURN, not about the pane's bottom edge: a transcript scrolled
      // to the bottom of something else would satisfy the line above.
      const newest = turns[turns.length - 1].nativeElement as HTMLElement;
      expect(newest.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom)
        .withContext('the newest stored turn is below the fold of the pane the resume landed in')
        .toBeLessThanOrEqual(1);
    });

    it('then LEAVES the author where they scrolled, however many checks follow', () => {
      // The other half of a one-shot: an author who scrolls up to re-read a resumed conversation must
      // not be dragged back down by the next unrelated change-detection pass.
      openDrawer();
      boundTheHeight();
      openHistory();
      resumeRow(longConversation());

      const el = body();
      // Same guard as above, and for the same reason: without the stored turns this would be a claim
      // about scrolling the empty state.
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length)
        .withContext('the resumed transcript must hold the stored turns')
        .toBe(16);
      el.scrollTop = 0;
      fixture.detectChanges();
      fixture.detectChanges();

      expect(el.scrollTop)
        .withContext('a later check re-scrolled a transcript the author had scrolled up in')
        .toBe(0);
    });
  });
});
