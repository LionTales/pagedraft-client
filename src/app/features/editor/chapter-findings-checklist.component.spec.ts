/**
 * rf-f05: ChapterFindingsChecklistComponent spec.
 *
 * Covers (per plan):
 *  (a) clicking a finding's go-to-chapter sets the addressing context (findingId + one-liner + chapterId)
 *      and the Edit-mode chip renders "Addressing: <one-liner>" with a working "back to findings" that
 *      switches to Review/Findings and clears the context;
 *  (b) the per-chapter checklist filters findings to those whose chapterAnchors include the current chapter
 *      (a finding anchored to another chapter is excluded; a multi-anchor finding including the current
 *      chapter is included);
 *  (c) each checklist row reflects the finding's outcome status; setting a status reuses the existing
 *      lifecycle mutation (assert the existing service method is called, not a new one);
 *  (d) empty state when the current chapter has no findings;
 *  (e) Story Bible openChapter (no finding identity = no revise context) does NOT show a chip;
 *  (f) RTL dir + he/en label parity.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of } from 'rxjs';
import { ChapterFindingsChecklistComponent } from './chapter-findings-checklist.component';
import { BookReviewService } from '../../core/services/book-review.service';
import { ReviseContextService } from '../../core/services/revise-context.service';
import { BookFinding, BookReviewFindingsDto, ChapterAnchor } from '../../core/models/book-review';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<BookFinding> = {}): BookFinding {
  return {
    id: 'f-1',
    dimension: 'plot',
    verdict: 'improve',
    severity: 2,
    rationale: 'The midpoint reversal lands without setup.',
    evidence: [],
    chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }],
    suggestedAction: null,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFindingsDto(findings: BookFinding[]): BookReviewFindingsDto {
  return {
    bookId: 'book-1',
    language: 'he',
    findings,
    scores: [],
  };
}

describe('ChapterFindingsChecklistComponent (rf-f05)', () => {
  let component: ChapterFindingsChecklistComponent;
  let fixture: ComponentFixture<ChapterFindingsChecklistComponent>;
  let reviseCtxService: ReviseContextService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChapterFindingsChecklistComponent],
      providers: [
        {
          provide: BookReviewService,
          useValue: {
            getReviewFindings: () => NEVER,
            patchFindingStatus: () => NEVER,
          },
        },
        ReviseContextService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChapterFindingsChecklistComponent);
    component = fixture.componentInstance;
    reviseCtxService = TestBed.inject(ReviseContextService);

    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.chapterId = 'c-3';
  });

  function triggerInit(): void {
    component.ngOnInit();
    component.ngOnChanges({
    bookId: new SimpleChange(null, component.bookId, true),
    });
    fixture.detectChanges();
  }

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }
  function queryAll(selector: string) {
    return fixture.debugElement.queryAll(By.css(selector));
  }

  // ── (a) Context chip render + back-to-findings ────────────────────────────

  it('(a) renders the addressing chip when the context matches the current chapter', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    // No chip before context is set.
    expect(query('[data-testid="addressing-chip"]')).toBeNull();

    // Set context for the current chapter.
    reviseCtxService.set({ findingId: 'f-1', oneLiner: 'The midpoint reversal.', chapterId: 'c-3' });
    fixture.detectChanges();

    const chip = query('[data-testid="addressing-chip"]');
    expect(chip).not.toBeNull();
    const text = chip.nativeElement.textContent as string;
    expect(text).toContain('The midpoint reversal.');
  });

  it('(a) does NOT render the addressing chip when the context chapterId does not match the current chapter', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    // Context set for a DIFFERENT chapter.
    reviseCtxService.set({ findingId: 'f-1', oneLiner: 'Something else', chapterId: 'c-99' });
    fixture.detectChanges();

    expect(query('[data-testid="addressing-chip"]')).toBeNull();
  });

  it('(a) "back to findings" link emits switchToReview and clears the addressing context', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    reviseCtxService.set({ findingId: 'f-1', oneLiner: 'Midpoint reversal.', chapterId: 'c-3' });
    fixture.detectChanges();

    let switchEmitted = false;
    component.switchToReview.subscribe(() => (switchEmitted = true));

    query('[data-testid="back-to-findings"]').nativeElement.click();
    fixture.detectChanges();

    expect(switchEmitted).toBeTrue();
    expect(reviseCtxService.snapshot).toBeNull();
    // Chip disappears after context cleared.
    expect(query('[data-testid="addressing-chip"]')).toBeNull();
  });

  // ── Phase 4d-10c: stale chip reset on chapter navigation ──────────────────

  it('clears the addressing context when the open chapter navigates OFF the anchored chapter', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    // Context set for the current chapter c-3: chip shows.
    reviseCtxService.set({ findingId: 'f-1', oneLiner: 'Midpoint reversal.', chapterId: 'c-3' });
    fixture.detectChanges();
    expect(query('[data-testid="addressing-chip"]')).not.toBeNull();

    // Navigate to a DIFFERENT chapter (c-3 -> c-7): ngOnChanges must clear the stale context.
    component.chapterId = 'c-7';
    component.ngOnChanges({
    chapterId: new SimpleChange('c-3', 'c-7', false),
    });
    fixture.detectChanges();

    expect(reviseCtxService.snapshot).toBeNull();
    expect(query('[data-testid="addressing-chip"]')).toBeNull();
  });

  it('does NOT re-show a stale chip after returning to the anchored chapter (context stays null)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    // Anchor at c-3, navigate away to c-7 (clears), then back to c-3.
    reviseCtxService.set({ findingId: 'f-1', oneLiner: 'Midpoint reversal.', chapterId: 'c-3' });
    fixture.detectChanges();

    component.chapterId = 'c-7';
    component.ngOnChanges({ chapterId: new SimpleChange('c-3', 'c-7', false) });
    fixture.detectChanges();
    expect(reviseCtxService.snapshot).toBeNull();

    // Return to the anchored chapter c-3: the OLD chip must NOT reappear.
    component.chapterId = 'c-3';
    component.ngOnChanges({ chapterId: new SimpleChange('c-7', 'c-3', false) });
    fixture.detectChanges();

    expect(reviseCtxService.snapshot).toBeNull();
    expect(query('[data-testid="addressing-chip"]')).toBeNull();
  });

  it('does NOT clear the context on the first chapterId binding (fresh mount for the anchored chapter)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));

    // The finding navigation sets the context for c-3, THEN the checklist mounts on c-3 (firstChange=true).
    reviseCtxService.set({ findingId: 'f-1', oneLiner: 'Midpoint reversal.', chapterId: 'c-3' });
    component.chapterId = 'c-3';
    component.ngOnInit();
    component.ngOnChanges({
      bookId: new SimpleChange(null, component.bookId, true),
      chapterId: new SimpleChange(undefined, 'c-3', true),
    });
    fixture.detectChanges();

    // The just-set context must survive the fresh mount and render its chip.
    expect(reviseCtxService.snapshot).not.toBeNull();
    expect(query('[data-testid="addressing-chip"]')).not.toBeNull();
  });

  // ── (e) Story Bible openChapter (no context) — no chip ───────────────────

  it('(e) no chip when ReviseContextService was never set (Story Bible path — no finding identity)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    // Context is null (no navigation from a finding — e.g. Story Bible path that does not call reviseContext.set).
    expect(query('[data-testid="addressing-chip"]')).toBeNull();
  });

  // ── (b) Checklist filter by current chapter ───────────────────────────────

  it('(b) checklist shows only findings whose chapterAnchors include the current chapterId', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto([
          makeFinding({ id: 'f-in',  chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
          makeFinding({ id: 'f-out', chapterAnchors: [{ chapterId: 'c-99', order: 99, title: 'Other' }] }),
        ])
      )
    );
    triggerInit();

    const items = queryAll('[data-testid^="checklist-item-"]');
    expect(items.length).toBe(1);
    expect(items[0].nativeElement.getAttribute('data-finding-id')).toBe('f-in');
  });

  it('(b) multi-anchor finding is included when ANY anchor matches the current chapter', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto([
          makeFinding({
            id: 'f-multi',
            chapterAnchors: [
              { chapterId: 'c-1', order: 1, title: 'Chapter 1' },
              { chapterId: 'c-3', order: 3, title: 'The Turn' }, // matches current
              { chapterId: 'c-5', order: 5, title: 'Chapter 5' },
            ],
          }),
        ])
      )
    );
    triggerInit();

    expect(queryAll('[data-testid^="checklist-item-"]').length).toBe(1);
    expect(query('[data-testid="checklist-item-f-multi"]')).not.toBeNull();
  });

  it('(b) finding anchored only to OTHER chapters is excluded', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto([
          makeFinding({
            id: 'f-elsewhere',
            chapterAnchors: [{ chapterId: 'c-7', order: 7, title: 'Chapter 7' }],
          }),
        ])
      )
    );
    triggerInit();

    expect(queryAll('[data-testid^="checklist-item-"]').length).toBe(0);
  });

  // ── (c) Status badge + existing lifecycle mutation ────────────────────────

  it('(c) each checklist row shows the finding outcome status badge', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto([
          makeFinding({ id: 'f-open',  status: 'open' }),
          makeFinding({ id: 'f-done',  status: 'done',  chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
          makeFinding({ id: 'f-ack',   status: 'acknowledged', chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
        ])
      )
    );
    triggerInit();

    expect(query('[data-testid="checklist-status-f-open"]').nativeElement.getAttribute('data-status')).toBe('open');
    expect(query('[data-testid="checklist-status-f-done"]').nativeElement.getAttribute('data-status')).toBe('done');
    expect(query('[data-testid="checklist-status-f-ack"]').nativeElement.getAttribute('data-status')).toBe('acknowledged');
  });

  it('(c) clicking Mark done calls patchFindingStatus (existing service method, no new mutation)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const patch$ = new Subject<BookFinding>();
    const patchSpy = spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto([makeFinding({ id: 'f-1', status: 'open' })]))
    );
    triggerInit();

    // Act: click the Mark done button.
    query('[data-testid="checklist-done-f-1"]').nativeElement.click();

    // Verify: patchFindingStatus is called with the correct args.
    expect(patchSpy).toHaveBeenCalledWith('book-1', 'f-1', 'done');
  });

  it('(c) clicking Dismiss calls patchFindingStatus with verb "dismiss" (open finding)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const patch$ = new Subject<BookFinding>();
    const patchSpy = spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto([makeFinding({ id: 'f-1', status: 'open' })]))
    );
    triggerInit();

    // Act: click the Dismiss button (visible for open status).
    query('[data-testid="checklist-dismiss-f-1"]').nativeElement.click();

    // Verify: patchFindingStatus is called with the dismiss verb.
    expect(patchSpy).toHaveBeenCalledWith('book-1', 'f-1', 'dismiss');
  });

  it('(c) Dismiss button is visible for open and acknowledged findings, hidden for done/dismissed', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(NEVER);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto([
        makeFinding({ id: 'f-open', status: 'open',        chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
        makeFinding({ id: 'f-ack',  status: 'acknowledged', chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
        makeFinding({ id: 'f-done', status: 'done',         chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
        makeFinding({ id: 'f-dis',  status: 'dismissed',    chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }] }),
      ]))
    );
    triggerInit();

    // open and acknowledged get dismiss buttons.
    expect(query('[data-testid="checklist-dismiss-f-open"]')).not.toBeNull();
    expect(query('[data-testid="checklist-dismiss-f-ack"]')).not.toBeNull();
    // done and dismissed do NOT get dismiss buttons.
    expect(query('[data-testid="checklist-dismiss-f-done"]')).toBeNull();
    expect(query('[data-testid="checklist-dismiss-f-dis"]')).toBeNull();
  });

  it('(c) status is applied optimistically and reconciled when the PATCH resolves', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const patch$ = new Subject<BookFinding>();
    spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto([makeFinding({ id: 'f-1', status: 'open' })]))
    );
    triggerInit();

    // Optimistic: click Acknowledge before the PATCH resolves.
    query('[data-testid="checklist-acknowledge-f-1"]').nativeElement.click();
    fixture.detectChanges();

    // Status badge should reflect optimistic state ('acknowledged').
    expect(query('[data-testid="checklist-status-f-1"]').nativeElement.getAttribute('data-status')).toBe('acknowledged');

    // Server resolves with 'done' — reconcile.
    patch$.next(makeFinding({ id: 'f-1', status: 'done' }));
    patch$.complete();
    fixture.detectChanges();

    expect(query('[data-testid="checklist-status-f-1"]').nativeElement.getAttribute('data-status')).toBe('done');
  });

  // ── (d) Empty state ───────────────────────────────────────────────────────

  it('(d) shows the empty-state message when the current chapter has no findings', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto([
        makeFinding({ id: 'f-other', chapterAnchors: [{ chapterId: 'c-99', order: 99, title: 'Other' }] }),
      ]))
    );
    triggerInit();

    expect(query('[data-testid="checklist-empty"]')).not.toBeNull();
    expect(queryAll('[data-testid^="checklist-item-"]').length).toBe(0);
  });

  it('(d) empty state when no review exists yet (bookId null)', () => {
    component.bookId = null;
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(NEVER);
    triggerInit();

    // When bookId is null the component fetches nothing; checklist section is gated on bookId+chapterId.
    expect(queryAll('[data-testid^="checklist-item-"]').length).toBe(0);
  });

  // ── (f) he/en parity + RTL ───────────────────────────────────────────────

  it('(f) renders in RTL dir for Hebrew language', () => {
    component.bookLanguage = 'he';
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    expect(query('[data-testid="chapter-findings-checklist"]').nativeElement.getAttribute('dir')).toBe('rtl');
  });

  it('(f) renders in LTR dir for English language', () => {
    component.bookLanguage = 'en';
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    expect(query('[data-testid="chapter-findings-checklist"]').nativeElement.getAttribute('dir')).toBe('ltr');
  });

  it('(f) English labels: checklist title, empty, back-to-findings (he/en parity)', () => {
    component.bookLanguage = 'en';
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    expect(component.label('checklistTitle')).toBe('Findings for this chapter');
    expect(component.label('empty')).toBe('No developmental findings for this chapter.');
    expect(component.label('backToFindings')).toBe('Back to findings');
    expect(component.label('addressing')).toBe('Addressing');
  });

  it('(f) Hebrew labels exist and are not the raw key (he/en parity)', () => {
    component.bookLanguage = 'he';
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    for (const key of ['addressing', 'backToFindings', 'checklistTitle', 'loading', 'empty', 'viewFinding', 'acknowledge', 'dismiss', 'done', 'reopen']) {
      const val = component.label(key);
      expect(val).not.toBe(key); // must be a real translation, not a fallback key
    }
  });

  it('(f) Hebrew status labels all differ from the raw key', () => {
    component.bookLanguage = 'he';
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto([])));
    triggerInit();

    for (const s of ['open', 'acknowledged', 'dismissed', 'done'] as const) {
      expect(component.statusLabel(s)).not.toBe(s);
    }
  });

  // ── view finding → switchToReview ────────────────────────────────────────

  it('"View" button on a checklist row emits switchToReview', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto([makeFinding({ id: 'f-1' })]))
    );
    triggerInit();

    let emitted = false;
    component.switchToReview.subscribe(() => (emitted = true));

    query('[data-testid="checklist-open-f-1"]').nativeElement.click();
    expect(emitted).toBeTrue();
  });
});
