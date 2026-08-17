/**
 * FeedbackTriageComponent: the owner's reading tool (Show C2, c2-client).
 *
 * List, EVERY filter, detail with its joined evidence, a legal transition and an illegal one, and the
 * evidence-unavailable rendering.
 *
 * ── THE VACUITY GUARD, applied to the filters on purpose ──────────────────────────────────────────
 * A filter spec that flushes an empty list and asserts "no rows" passes whether or not the filter does
 * anything at all; this corpus has been bitten by exactly that four times. So every filter case here
 * starts from a NON-EMPTY population of three rows, applies the filter, and asserts BOTH that the request
 * carried the parameter AND that a row which was on screen a moment ago is gone. Exclusion is the claim,
 * so exclusion is what is asserted.
 */
import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { FeedbackTriageComponent } from './feedback-triage.component';
import { FEEDBACK_STRINGS_EN, FEEDBACK_STRINGS_HE } from '../../core/i18n/feedback-strings';
import { GUIDE_TITLES_HE } from '../../core/i18n/chat-strings';
import { FeedbackDetailDto, FeedbackListItemDto } from '../../core/models/feedback';

const BOOK_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOOK_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function listItem(over: Partial<FeedbackListItemDto> = {}): FeedbackListItemDto {
  return {
    id: 'fb-1',
    area: 'chat-answer',
    targetType: 'conversation-message',
    targetId: 'msg-1',
    verdict: 'down',
    text: 'the answer named the wrong chapter',
    status: 'New',
    createdAt: '2026-08-17T09:00:00Z',
    statusChangedAt: '2026-08-17T09:00:00Z',
    targetDeletedAt: null,
    bookId: BOOK_A,
    ...over,
  };
}

/** THREE ROWS, deliberately different on every filterable axis. This is the non-empty population. */
const POPULATION: FeedbackListItemDto[] = [
  listItem({ id: 'fb-down-new-a', verdict: 'down', status: 'New', bookId: BOOK_A, text: 'wrong chapter' }),
  listItem({ id: 'fb-up-triaged-b', verdict: 'up', status: 'Triaged', bookId: BOOK_B, text: 'good one' }),
  listItem({ id: 'fb-down-fixed-a', verdict: 'down', status: 'Fixed', bookId: BOOK_A, text: 'stale now' }),
];

function detail(over: Partial<FeedbackDetailDto['evidence']> = {}, status = 'New'): FeedbackDetailDto {
  return {
    feedback: {
      id: 'fb-down-new-a',
      area: 'chat-answer',
      targetType: 'conversation-message',
      targetId: 'msg-1',
      verdict: 'down',
      text: 'the answer named the wrong chapter',
      status,
      createdAt: '2026-08-17T09:00:00Z',
      statusChangedAt: '2026-08-17T09:00:00Z',
      targetDeletedAt: null,
      context: { route: '/books/abc', bookId: BOOK_A, chapterId: 'ch-3', uiLanguage: 'he', appBuild: null },
    },
    evidence: {
      available: true,
      unavailableReason: null,
      conversationId: 'conv-1',
      conversationTitle: 'About chapter three',
      question: 'what happens in chapter three?',
      answer: 'The **protagonist** leaves the city.',
      answerFailed: false,
      answeredAt: '2026-08-17T08:59:00Z',
      askBookId: BOOK_A,
      askChapterId: 'ch-3',
      askChapterOrder: 2,
      grounding: {
        guideIds: ['export'],
        artifactRefs: ['chapter-text:2'],
        bookFaultReason: null,
        needsChapterClarification: false,
        selectionSummary: null,
      },
      ...over,
    },
  };
}

describe('FeedbackTriageComponent (Show C2)', () => {
  let fixture: ComponentFixture<FeedbackTriageComponent>;
  let component: FeedbackTriageComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeedbackTriageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackTriageComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

  /** Bring the component up with the given population already loaded. */
  function start(items: FeedbackListItemDto[] = POPULATION): TestRequest {
    fixture.detectChanges();
    const request = http.expectOne(r => r.url === '/api/feedback' && r.method === 'GET');
    request.flush({ items, page: 1, pageSize: 25, totalCount: items.length });
    fixture.detectChanges();
    return request;
  }

  function rowIds(): string[] {
    return fixture.debugElement
      .queryAll(By.css('[data-feedback-id]'))
      .map(node => node.nativeElement.getAttribute('data-feedback-id'));
  }

  function el(testId: string): HTMLElement | null {
    return fixture.debugElement.query(By.css(`[data-testid="${testId}"]`))?.nativeElement ?? null;
  }

  function all(selector: string): HTMLElement[] {
    return fixture.debugElement.queryAll(By.css(selector)).map(n => n.nativeElement);
  }

  /**
   * Set a filter control and let its `change` handler fire, the way the owner would.
   *
   * Returns the open TestRequest rather than flushing it, because `expectOne` CONSUMES what it matches:
   * one handle has to serve both the parameter assertion and the flush.
   */
  function setFilter(testId: string, value: string): TestRequest {
    const control = el(testId) as HTMLSelectElement | HTMLInputElement;
    control.value = value;
    control.dispatchEvent(new Event('input'));
    control.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return http.expectOne(r => r.url === '/api/feedback' && r.method === 'GET');
  }

  /** Answer one captured list read with the given rows. */
  function answer(request: TestRequest, items: FeedbackListItemDto[]): void {
    request.flush({ items, page: 1, pageSize: 25, totalCount: items.length });
    fixture.detectChanges();
  }

  // ── The list ─────────────────────────────────────────────────────────────────────────────────────

  describe('the list', () => {
    it('reads on init with NO filters, because an omitted filter means everything', () => {
      const request = start().request;
      expect(request.params.has('area')).toBeFalse();
      expect(request.params.has('status')).toBeFalse();
      expect(request.params.has('verdict')).toBeFalse();
      expect(request.params.has('bookId')).toBeFalse();
      expect(rowIds()).toEqual(['fb-down-new-a', 'fb-up-triaged-b', 'fb-down-fixed-a']);
    });

    it('renders the vocabulary as WORDS, never as the stored tokens', () => {
      start();
      const statuses = all('[data-testid="ft-row-status"]').map(n => n.textContent?.trim());
      expect(statuses).toEqual([
        FEEDBACK_STRINGS_HE['statusNew'],
        FEEDBACK_STRINGS_HE['statusTriaged'],
        FEEDBACK_STRINGS_HE['statusFixed'],
      ]);
      expect(statuses).not.toContain('ConfirmedBug');
    });

    it('says so plainly when a target has been tombstoned', () => {
      start([listItem({ id: 'fb-t', targetDeletedAt: '2026-08-17T10:00:00Z' })]);
      expect(fixture.nativeElement.textContent).toContain(FEEDBACK_STRINGS_HE['listTargetDeleted']);
    });

    it('surfaces a failed read with a retry, rather than an empty list', () => {
      fixture.detectChanges();
      http.expectOne(r => r.method === 'GET').flush('down', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      // An empty list and a failed read are different facts; showing "no rows match" for a 500 would be
      // the surface fabricating a state.
      expect(el('ft-load-error')).toBeTruthy();
      expect(el('ft-empty')).toBeNull();
    });

    it('shows the empty state only for a genuinely empty response', () => {
      start([]);
      expect(el('ft-empty')).toBeTruthy();
      expect(el('ft-load-error')).toBeNull();
    });
  });

  // ── The filters, each one, against a non-empty population ────────────────────────────────────────

  describe('the filters (vacuity guard: each starts from three rows and proves an exclusion)', () => {
    it('STATUS: sends the parameter and drops the rows it excludes', () => {
      start();
      expect(rowIds().length).toBe(3);

      const request = setFilter('ft-filter-status', 'New');
      expect(request.request.params.get('status')).toBe('New');
      expect(component.filters.status)
        .withContext('the control is really bound, not only clicked')
        .toBe('New');
      // The server does the filtering; what this asserts is that the narrowed population REPLACES the
      // wide one on screen, so a row that was visible a moment ago is provably gone.
      answer(request, [POPULATION[0]]);
      expect(rowIds()).toEqual(['fb-down-new-a']);
      expect(rowIds()).not.toContain('fb-up-triaged-b');
      expect(rowIds()).not.toContain('fb-down-fixed-a');
    });

    it('VERDICT: sends the parameter and drops the rows it excludes', () => {
      start();
      const request = setFilter('ft-filter-verdict', 'down');
      expect(request.request.params.get('verdict')).toBe('down');
      answer(request, [POPULATION[0], POPULATION[2]]);
      expect(rowIds()).toEqual(['fb-down-new-a', 'fb-down-fixed-a']);
      expect(rowIds()).not.toContain('fb-up-triaged-b');
    });

    it('AREA: sends the parameter and drops the rows it excludes', () => {
      start();
      const request = setFilter('ft-filter-area', 'chat-answer');
      expect(request.request.params.get('area')).toBe('chat-answer');
      answer(request, [POPULATION[1]]);
      expect(rowIds()).toEqual(['fb-up-triaged-b']);
      expect(rowIds().length).toBeLessThan(POPULATION.length);
    });

    it('BOOK: sends the parameter and drops the rows it excludes', () => {
      start();
      const request = setFilter('ft-filter-book', BOOK_B);
      expect(request.request.params.get('bookId')).toBe(BOOK_B);
      answer(request, [POPULATION[1]]);
      expect(rowIds()).toEqual(['fb-up-triaged-b']);
      expect(rowIds()).not.toContain('fb-down-new-a');
    });

    it('a filter set back to "any" travels as an ABSENT parameter, not an empty one', () => {
      start();
      answer(setFilter('ft-filter-status', 'New'), [POPULATION[0]]);
      expect(rowIds().length).toBe(1);

      const request = setFilter('ft-filter-status', '');
      // Not the same request: a server that trims and compares would treat `status=` as a filter.
      expect(request.request.params.has('status')).toBeFalse();
      answer(request, POPULATION);
      expect(rowIds().length).toBe(3);
    });

    it('clearing every filter goes back to page 1 with no parameters at all', () => {
      start();
      answer(setFilter('ft-filter-verdict', 'down'), [POPULATION[0], POPULATION[2]]);
      component.page = 3;

      el('ft-filter-clear')!.click();
      fixture.detectChanges();
      const request = http.expectOne(r => r.method === 'GET');
      expect(request.request.params.has('verdict')).toBeFalse();
      expect(request.request.params.get('page')).toBe('1');
      answer(request, POPULATION);
      expect(rowIds().length).toBe(3);
    });
  });

  // ── The detail, and its evidence ─────────────────────────────────────────────────────────────────

  describe('the detail', () => {
    function openFirst(payload: FeedbackDetailDto = detail()): void {
      start();
      all('[data-testid="ft-row-open"]')[0].click();
      fixture.detectChanges();
      http.expectOne(r => r.url === '/api/feedback/fb-down-new-a' && r.method === 'GET').flush(payload);
      fixture.detectChanges();
    }

    it('composes the row and its evidence in ONE request', () => {
      openFirst();
      expect(el('ft-detail')).toBeTruthy();
      expect(el('ft-evidence-question')?.textContent).toContain('what happens in chapter three?');
    });

    it('renders the answer through the EXISTING markdown component, not a second parser', () => {
      openFirst();
      const answer = el('ft-evidence-answer')!;
      // `**protagonist**` came through the shared renderer, which is what "reuse, do not rebuild" means
      // here: a change to how model prose renders reaches Show and this pane at once.
      expect(answer.querySelector('.markdown-text')).toBeTruthy();
      expect(answer.querySelector('strong')?.textContent).toBe('protagonist');
    });

    it('renders the grounding refs as READ-ONLY chips, labelled by the transcript\'s own helpers', () => {
      openFirst();
      const chips = all('[data-testid="ft-guide-chips"] .ft-chip, [data-testid="ft-artifact-chips"] .ft-chip');
      expect(chips.length).toBe(2);
      // Inert by construction: a link would navigate the owner out of the row they are triaging, and a
      // chip here can point at grounding for a conversation that no longer exists.
      expect(chips.every(chip => chip.tagName.toLowerCase() === 'span')).toBeTrue();
      expect(fixture.nativeElement.querySelector('[data-testid="ft-guide-chips"] a')).toBeNull();
      // Not the raw ids: the same labelling the citation chips use.
      expect(chips.map(c => c.textContent?.trim())).not.toContain('chapter-text:2');
    });

    it('recomputes the label lists for the row actually opened, not a stale memo from the last one', () => {
      // Row A: one guide chip ("export"), one artifact chip.
      start();
      all('[data-testid="ft-row-open"]')[0].click();
      fixture.detectChanges();
      http.expectOne(r => r.url === '/api/feedback/fb-down-new-a' && r.method === 'GET').flush(
        detail({
          grounding: {
            guideIds: ['export'],
            artifactRefs: ['chapter-text:2'],
            bookFaultReason: null,
            needsChapterClarification: false,
            selectionSummary: null,
          },
        })
      );
      fixture.detectChanges();
      const rowAGuideChips = all('[data-testid="ft-guide-chips"] .ft-chip').map(c => c.textContent?.trim());
      expect(rowAGuideChips).toEqual([GUIDE_TITLES_HE['export']]);
      expect(el('ft-artifact-chips')).toBeTruthy();

      // Back to the list, then open a DIFFERENT row with a different guide and no artifacts at all.
      component.closeDetail();
      fixture.detectChanges();
      all('[data-testid="ft-row-open"]')[1].click();
      fixture.detectChanges();
      http.expectOne(r => r.url === '/api/feedback/fb-up-triaged-b' && r.method === 'GET').flush(
        detail(
          {
            grounding: {
              guideIds: ['import'],
              artifactRefs: [],
              bookFaultReason: null,
              needsChapterClarification: false,
              selectionSummary: null,
            },
          },
          'Triaged'
        )
      );
      fixture.detectChanges();

      // Row B's chips must be row B's, not row A's leftovers: a different guide, and NO artifact chips
      // (row A had one) - a stale cache would still show "chapter-text" grounding here.
      const rowBGuideChips = all('[data-testid="ft-guide-chips"] .ft-chip').map(c => c.textContent?.trim());
      expect(rowBGuideChips).toEqual([GUIDE_TITLES_HE['import']]);
      expect(rowBGuideChips).not.toEqual(rowAGuideChips);
      expect(el('ft-artifact-chips')).toBeNull();
    });

    it('shows the stored context, which is the half no join can recover', () => {
      openFirst();
      const text = el('ft-detail')!.textContent ?? '';
      expect(text).toContain('/books/abc');
      expect(text).toContain('ch-3');
    });

    it('isolates the route with unicode-bidi: plaintext, not isolate, so the leading slash cannot flip to the far end', () => {
      // D1 (closing render gate, measured): under Hebrew chrome `li` carries `unicode-bidi: isolate` from
      // the UA default stylesheet, and isolate keeps the run at the INHERITED direction: rtl, so the
      // route's leading slash - a bidi-neutral with nothing before it in the run - resolved to the RTL
      // end and `/books/a63a...` rendered as `books/a63a.../`. `plaintext` resolves the run's own
      // direction from its OWN first strong character instead, the same fix already shipped for the
      // markdown-text inline code span. Pinned on the COMPUTED style of the rendered node, not the
      // stylesheet text: an emulated-encapsulation rule that matches nothing is the recorded failure mode.
      openFirst();
      const route = el('ft-context-route')!;
      expect(route.textContent?.trim()).toBe('/books/abc');
      expect(getComputedStyle(route).unicodeBidi).toBe('plaintext');
    });

    it('leaves the bare id/language context values untreated, because they were measured to render correctly', () => {
      // bookId, chapterId and uiLanguage start and end on a strong latin/digit character, so isolate's
      // inherited RTL embedding has no leading/trailing neutral to misplace them; this asserts the scoping
      // decision itself, not just the route fix, so a future blanket-apply regresses a real assertion.
      openFirst();
      const bookLi = all('.ft-context li')[1];
      expect(bookLi.textContent).toContain(BOOK_A);
      expect(getComputedStyle(bookLi).unicodeBidi).not.toBe('plaintext');
    });

    it('flags an answer that FAILED, because that vote is about the failure itself', () => {
      openFirst(detail({ answerFailed: true }));
      expect(el('ft-answer-failed')).toBeTruthy();
    });

    it('renders a DELETED target as a state with its own reason, not as an error', () => {
      // d1 chose to KEEP the row when its conversation is deleted, so refusing to show it would defeat
      // that decision. The endpoint answers 200 with `available: false`.
      openFirst(
        detail({
          available: false,
          unavailableReason: 'targetDeleted',
          question: null,
          answer: null,
          grounding: null,
        })
      );
      expect(el('ft-evidence-unavailable')?.textContent?.trim())
        .toBe(FEEDBACK_STRINGS_HE['evidenceTargetDeleted']);
      expect(el('ft-evidence-answer')).toBeNull();
    });

    it('distinguishes a MISSING target from a deleted one', () => {
      openFirst(detail({ available: false, unavailableReason: 'targetMissing', answer: null }));
      expect(el('ft-evidence-unavailable')?.textContent?.trim())
        .toBe(FEEDBACK_STRINGS_HE['evidenceTargetMissing']);
    });

    it('says so when an answer carried no grounding', () => {
      openFirst(detail({ grounding: null }));
      expect(el('ft-no-grounding')).toBeTruthy();
    });

    it('keeps the LIST on screen when the detail read fails', () => {
      start();
      all('[data-testid="ft-row-open"]')[0].click();
      fixture.detectChanges();
      http.expectOne(r => r.method === 'GET').flush('down', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      // Swapping to an empty detail pane would imitate `available: false`, which is a real and different
      // state this must not counterfeit.
      expect(el('ft-detail-error')).toBeTruthy();
      expect(rowIds().length).toBe(3);
    });
  });

  // ── Transitions ──────────────────────────────────────────────────────────────────────────────────

  describe('status transitions', () => {
    function openWithStatus(status: string): void {
      start();
      all('[data-testid="ft-row-open"]')[0].click();
      fixture.detectChanges();
      http.expectOne(r => r.method === 'GET' && r.url.includes('/api/feedback/')).flush(detail({}, status));
      fixture.detectChanges();
    }

    function transitionButtons(): string[] {
      return all('[data-transition]').map(n => n.getAttribute('data-transition')!);
    }

    it('offers exactly the LEGAL moves, and never a way back to New', () => {
      openWithStatus('New');
      expect(transitionButtons()).toEqual(['Triaged', 'ConfirmedBug', 'Dismissed']);
      // `New` is C3's inbox, not "untouched": a hand transition back into it would re-arm the automated
      // re-check forever.
      expect(transitionButtons()).not.toContain('New');
    });

    it('offers Fixed ONLY from ConfirmedBug, so nothing can claim a fix nobody confirmed', () => {
      openWithStatus('Triaged');
      expect(transitionButtons()).not.toContain('Fixed');
      expect(transitionButtons()).toEqual(['ConfirmedBug', 'Dismissed']);
    });

    it('performs a LEGAL transition and updates the row it came from', () => {
      openWithStatus('New');
      fixture.debugElement.query(By.css('[data-transition="ConfirmedBug"]')).nativeElement.click();
      fixture.detectChanges();

      const patch = http.expectOne(r => r.method === 'PATCH' && r.url === '/api/feedback/fb-down-new-a/status');
      expect(patch.request.body).toEqual({ status: 'ConfirmedBug' });
      patch.flush({
        ...detail({}, 'ConfirmedBug').feedback,
        status: 'ConfirmedBug',
        statusChangedAt: '2026-08-17T11:00:00Z',
      });
      fixture.detectChanges();

      expect(el('ft-detail-status')?.textContent?.trim())
        .toBe(FEEDBACK_STRINGS_HE['statusConfirmedBug']);
      // The LIST is kept honest too, so going back does not show the status the row used to hold.
      component.closeDetail();
      fixture.detectChanges();
      expect(all('[data-testid="ft-row-status"]')[0].textContent?.trim())
        .toBe(FEEDBACK_STRINGS_HE['statusConfirmedBug']);
    });

    it('renders the SERVER\'s refusal verbatim when it rejects a move as illegal', () => {
      // Driven through the component rather than a button, because the button for an illegal move is
      // deliberately not rendered: this is the case where our graph and the server's DISAGREE, and the
      // point is that the disagreement reaches the owner rather than being swallowed.
      openWithStatus('New');
      component.changeStatus('Fixed');
      fixture.detectChanges();

      http.expectOne(r => r.method === 'PATCH').flush(
        { error: 'statusTransitionNotAllowed', from: 'New', to: 'Fixed' },
        { status: 400, statusText: 'Bad Request' }
      );
      fixture.detectChanges();

      expect(el('ft-status-error')?.textContent?.trim())
        .toBe(FEEDBACK_STRINGS_HE['statusNotAllowed']);
      // The row did NOT move: no optimistic status is shown anywhere on this surface.
      expect(el('ft-detail-status')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['statusNew']);
    });

    it('reports a transport failure differently from a refusal', () => {
      openWithStatus('New');
      component.changeStatus('Triaged');
      fixture.detectChanges();
      http.expectOne(r => r.method === 'PATCH').flush('down', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(el('ft-status-error')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['statusFailed']);
    });

    // ── The owner navigates while a transition is on the wire ────────────────────────────────────
    //
    // A PATCH is a mutation and nothing recalls it, so the window between dispatch and landing is real
    // and the owner is free to spend it on another row. Every case below therefore HOLDS the request
    // open across the navigation: flushing it synchronously closes the window and the assertion then
    // passes whether or not the handler checks who owns the pane.

    /**
     * A detail payload for a NAMED row. The shared `detail()` helper hardcodes row A's id, which is
     * precisely the thing these cases have to tell apart.
     */
    function detailOf(
      id: string,
      status: string,
      over: Partial<FeedbackDetailDto['evidence']> = {}
    ): FeedbackDetailDto {
      const base = detail(over, status);
      return { ...base, feedback: { ...base.feedback, id, text: `note on ${id}` } };
    }

    /** Row B, opened while row A's PATCH is still out: its own question, answer and grounding. */
    function openRowBWhileInFlight(): void {
      component.closeDetail();
      fixture.detectChanges();
      all('[data-testid="ft-row-open"]')[1].click();
      fixture.detectChanges();
      http.expectOne(r => r.url === '/api/feedback/fb-up-triaged-b' && r.method === 'GET').flush(
        detailOf('fb-up-triaged-b', 'Triaged', {
          question: 'how do I export a chapter?',
          answer: 'Open the export panel.',
          grounding: {
            guideIds: ['import'],
            artifactRefs: [],
            bookFaultReason: null,
            needsChapterClarification: false,
            selectionSummary: null,
          },
        })
      );
      fixture.detectChanges();
    }

    it('lands a late transition on the LIST but never on the row the owner moved to', () => {
      openWithStatus('New');
      fixture.debugElement.query(By.css('[data-transition="ConfirmedBug"]')).nativeElement.click();
      fixture.detectChanges();
      // Captured, deliberately NOT flushed: this is the window the owner navigates in.
      const patch = http.expectOne(r => r.method === 'PATCH' && r.url === '/api/feedback/fb-down-new-a/status');

      openRowBWhileInFlight();

      // Row A's answer arrives now, with the owner reading row B.
      patch.flush({ ...detail({}, 'ConfirmedBug').feedback, status: 'ConfirmedBug', statusChangedAt: '2026-08-17T11:00:00Z' });
      fixture.detectChanges();

      // Row B's FEEDBACK: its own status, its own note, and its own legal moves. A grafted row A would
      // read ConfirmedBug here and would offer Fixed, which is a move row B has never been eligible for.
      expect(el('ft-detail-status')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['statusTriaged']);
      expect(el('ft-detail-note')?.textContent).toContain('note on fb-up-triaged-b');
      expect(transitionButtons()).toEqual(['ConfirmedBug', 'Dismissed']);
      // Row B's EVIDENCE, including the label cache that follows the opened row.
      expect(el('ft-evidence-question')?.textContent).toContain('how do I export a chapter?');
      expect(all('[data-testid="ft-guide-chips"] .ft-chip').map(c => c.textContent?.trim()))
        .toEqual([GUIDE_TITLES_HE['import']]);

      // And the half that is keyed by id rather than shared: row A did move, and going back shows it.
      component.closeDetail();
      fixture.detectChanges();
      expect(all('[data-testid="ft-row-status"]')[0].textContent?.trim())
        .toBe(FEEDBACK_STRINGS_HE['statusConfirmedBug']);
    });

    it('drops a late REFUSAL rather than showing it under the row the owner moved to', () => {
      openWithStatus('New');
      component.changeStatus('Fixed');
      fixture.detectChanges();
      const patch = http.expectOne(r => r.method === 'PATCH' && r.url === '/api/feedback/fb-down-new-a/status');

      openRowBWhileInFlight();

      patch.flush(
        { error: 'statusTransitionNotAllowed', from: 'New', to: 'Fixed' },
        { status: 400, statusText: 'Bad Request' }
      );
      fixture.detectChanges();

      // A refusal is about ONE row. Rendered here it would say row B refused a move nobody made on it.
      expect(el('ft-status-error')).toBeNull();
      expect(el('ft-detail-status')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['statusTriaged']);
      expect(el('ft-evidence-question')?.textContent).toContain('how do I export a chapter?');
    });

    it('lets the NEW row transition while the old row\'s request is still out', () => {
      openWithStatus('New');
      fixture.debugElement.query(By.css('[data-transition="Triaged"]')).nativeElement.click();
      fixture.detectChanges();
      const rowAPatch = http.expectOne(r => r.method === 'PATCH' && r.url === '/api/feedback/fb-down-new-a/status');

      openRowBWhileInFlight();

      // The lock belongs to a ROW, not to the surface: row A's open request must not disable row B.
      expect(el('ft-status-saving')).toBeNull();
      const button = fixture.debugElement.query(By.css('[data-transition="Dismissed"]')).nativeElement as HTMLButtonElement;
      expect(button.disabled).toBeFalse();
      button.click();
      fixture.detectChanges();

      const rowBPatch = http.expectOne(r => r.method === 'PATCH' && r.url === '/api/feedback/fb-up-triaged-b/status');
      // Row B's own request now owns the line under row B's buttons.
      expect(el('ft-status-saving')).toBeTruthy();

      // Both land, in the reverse order, and neither strands the other's flag.
      rowBPatch.flush({ ...detailOf('fb-up-triaged-b', 'Dismissed').feedback, status: 'Dismissed' });
      fixture.detectChanges();
      expect(el('ft-status-saving')).toBeNull();
      expect(el('ft-detail-status')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['statusDismissed']);

      rowAPatch.flush({ ...detail({}, 'Triaged').feedback, status: 'Triaged' });
      fixture.detectChanges();
      expect(el('ft-status-saving')).toBeNull();
      expect(el('ft-detail-status')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['statusDismissed']);
    });
  });

  // ── Chrome ───────────────────────────────────────────────────────────────────────────────────────

  describe('chrome', () => {
    it('is Hebrew-default and RTL-first, like every app-level surface here', () => {
      start();
      expect(fixture.nativeElement.getAttribute('dir')).toBe('rtl');
      expect(fixture.nativeElement.textContent).toContain(FEEDBACK_STRINGS_HE['triageTitle']);
    });

    it('flips whole with the language', () => {
      start();
      (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
      // OnPush: the language is internal state, not an input, so the COMPONENT's own view has to be
      // marked before the assertion below reads the DOM. `componentRef.changeDetectorRef` is the HOST
      // view's and marking it leaves the OnPush component view unrefreshed, which is exactly the stale
      // read this line exists to avoid.
      fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
      fixture.detectChanges();
      expect(fixture.nativeElement.getAttribute('dir')).toBe('ltr');
      expect(fixture.nativeElement.textContent).toContain(FEEDBACK_STRINGS_EN['triagePrivacy']);
    });

    it('renders timestamps through the timezone-aware helper, never a raw date pipe', () => {
      start([listItem({ id: 'fb-x', createdAt: new Date().toISOString() })]);
      // The page conventions forbid `| date`. A just-now row renders the relative phrase.
      expect(fixture.nativeElement.textContent).toContain('הרגע');
    });
  });
});
