/**
 * wb3-c02: BookReviewFindingsComponent spec - the Dimension Scorecard (B) + keep/improve/cut Findings
 * Ledger (A).
 *
 * Covers:
 *  - render the scorecard from `scores` (per-dimension label + keep/improve/cut counts);
 *  - render the ledger from `findings`, grouped into active (open/acknowledged) vs muted resolved
 *    (dismissed/done) groups (resolved are collapsed, NOT deleted);
 *  - filter by dimension (scorecard click, toggle off on re-click) and by verdict (chip click);
 *  - status PATCH OPTIMISTIC + reconcile: the local status flips BEFORE the held-open PATCH Subject emits,
 *    reconciles to the server-returned status AFTER it emits, and REVERTS to the prior status on error.
 *    The PATCH Subject is held open across assertions (NEVER synchronous of()/throwError) so the optimistic
 *    window is real;
 *  - empty (review ready, zero findings) + load-error states;
 *  - the wb3-f01 navigation seam (openChapter) and he/en label parity.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { BookReviewFindingsComponent } from './book-review-findings.component';
import { BookReviewService } from '../../core/services/book-review.service';
import { ReviseContextService } from '../../core/services/revise-context.service';
import {
  BookFinding,
  BookReviewFindingsDto,
  ChapterAnchor,
  DimensionScore,
  FindingStatus,
} from '../../core/models/book-review';

function makeFinding(overrides: Partial<BookFinding> = {}): BookFinding {
  return {
    id: 'f-1',
    dimension: 'plot',
    verdict: 'improve',
    severity: 2,
    rationale: 'The midpoint reversal lands without setup.',
    evidence: [{ chapterId: 'c-3', chapterOrder: 3, excerpt: 'She turned, and everything changed.' }],
    chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'The Turn' }],
    suggestedAction: 'Plant the betrayal two chapters earlier.',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeScore(overrides: Partial<DimensionScore> = {}): DimensionScore {
  return {
    dimension: 'plot',
    score: 'mixed',
    keepCount: 1,
    improveCount: 2,
    cutCount: 0,
    ...overrides,
  };
}

function makeFindingsDto(overrides: Partial<BookReviewFindingsDto> = {}): BookReviewFindingsDto {
  return {
    bookId: 'book-1',
    language: 'he',
    findings: [makeFinding()],
    scores: [makeScore()],
    ...overrides,
  };
}

describe('BookReviewFindingsComponent (wb3-c02)', () => {
  let component: BookReviewFindingsComponent;
  let fixture: ComponentFixture<BookReviewFindingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookReviewFindingsComponent],
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

    fixture = TestBed.createComponent(BookReviewFindingsComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }
  function queryAll(selector: string) {
    return fixture.debugElement.queryAll(By.css(selector));
  }

  /** Trigger the initial load via ngOnChanges (mirrors how the host drives @Inputs). */
  function triggerInit(): void {
    component.ngOnChanges({
    bookId: new SimpleChange(null, component.bookId, true),
    });
  }

  // ── Scorecard (B) ──────────────────────────────────────────────────────────

  it('renders a scorecard row per dimension score with the label + keep/improve/cut counts', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto({
          findings: [],
          scores: [
            makeScore({ dimension: 'plot', score: 'weak', keepCount: 0, improveCount: 3, cutCount: 1 }),
            makeScore({ dimension: 'character', score: 'strong', keepCount: 4, improveCount: 0, cutCount: 0 }),
          ],
        })
      )
    );
    triggerInit();
    fixture.detectChanges();

    const rows = queryAll('[data-testid^="scorecard-row-"]');
    expect(rows.length).toBe(2);

    const plotRow = query('[data-testid="scorecard-row-plot"]');
    expect(plotRow).not.toBeNull();
    const plotText = plotRow.nativeElement.textContent as string;
    expect(plotText).toContain('עלילה'); // he dimension label
    expect(plotText).toContain('חלש'); // he weak label
    expect(plotText).toContain('3'); // improveCount
    expect(plotText).toContain('1'); // cutCount

    const charRow = query('[data-testid="scorecard-row-character"]');
    expect(charRow.nativeElement.textContent).toContain('דמויות');
  });

  it('renders scorecard rows in the canonical dimension order regardless of input order', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto({
          findings: [],
          scores: [
            makeScore({ dimension: 'continuity' }),
            makeScore({ dimension: 'plot' }),
          ],
        })
      )
    );
    triggerInit();
    fixture.detectChanges();

    const rows = component.scorecardRows.map((s) => s.dimension);
    expect(rows).toEqual(['plot', 'continuity']);
  });

  // ── Ledger (A) render + grouping ─────────────────────────────────────────────

  it('renders active findings in the primary group and dismissed/done in the muted resolved group', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto({
          findings: [
            makeFinding({ id: 'open-1', status: 'open' }),
            makeFinding({ id: 'ack-1', status: 'acknowledged' }),
            makeFinding({ id: 'done-1', status: 'done' }),
            makeFinding({ id: 'dismissed-1', status: 'dismissed' }),
          ],
        })
      )
    );
    triggerInit();
    fixture.detectChanges();

    expect(component.activeFindings.map((f) => f.id).sort()).toEqual(['ack-1', 'open-1']);
    expect(component.resolvedFindings.map((f) => f.id).sort()).toEqual(['dismissed-1', 'done-1']);

    expect(query('[data-testid="ledger-active-group"]')).not.toBeNull();
    expect(query('[data-testid="ledger-resolved-group"]')).not.toBeNull();
    // Resolved rows are present (collapsed into the muted group), NOT deleted.
    expect(query('[data-testid="finding-row-done-1"]')).not.toBeNull();
    expect(query('[data-testid="finding-row-dismissed-1"]')).not.toBeNull();
  });

  it('expands a finding row to show evidence excerpts + suggested action on rationale click', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto()));
    triggerInit();
    fixture.detectChanges();

    expect(query('[data-testid="finding-detail-f-1"]')).toBeNull();
    query('[data-testid="finding-rationale-f-1"]').nativeElement.click();
    fixture.detectChanges();

    const detail = query('[data-testid="finding-detail-f-1"]');
    expect(detail).not.toBeNull();
    const text = detail.nativeElement.textContent as string;
    expect(text).toContain('She turned'); // evidence excerpt
    expect(text).toContain('Plant the betrayal'); // suggested action
  });

  // ── Filtering ────────────────────────────────────────────────────────────────

  it('filters the ledger by dimension on scorecard click and clears the filter on re-click', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto({
          findings: [
            makeFinding({ id: 'plot-1', dimension: 'plot' }),
            makeFinding({ id: 'char-1', dimension: 'character' }),
          ],
          scores: [makeScore({ dimension: 'plot' }), makeScore({ dimension: 'character' })],
        })
      )
    );
    triggerInit();
    fixture.detectChanges();

    expect(component.activeFindings.length).toBe(2);

    component.onDimensionClick('plot');
    fixture.detectChanges();
    expect(component.dimensionFilter).toBe('plot');
    expect(component.activeFindings.map((f) => f.id)).toEqual(['plot-1']);

    // Re-click clears the filter.
    component.onDimensionClick('plot');
    fixture.detectChanges();
    expect(component.dimensionFilter).toBeNull();
    expect(component.activeFindings.length).toBe(2);
  });

  it('filters the ledger by verdict on chip click', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto({
          findings: [
            makeFinding({ id: 'keep-1', verdict: 'keep' }),
            makeFinding({ id: 'cut-1', verdict: 'cut' }),
          ],
        })
      )
    );
    triggerInit();
    fixture.detectChanges();

    component.onVerdictClick('cut');
    fixture.detectChanges();
    expect(component.verdictFilter).toBe('cut');
    expect(component.activeFindings.map((f) => f.id)).toEqual(['cut-1']);

    // Filters AND-combine: a dimension that excludes the verdict-filtered row yields filtered-empty.
    component.onDimensionClick('plot'); // keep-1/cut-1 are plot by default -> still cut-1
    fixture.detectChanges();
    expect(component.activeFindings.map((f) => f.id)).toEqual(['cut-1']);
  });

  it('shows the filtered-empty hint when filters hide every finding (findings still exist)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ findings: [makeFinding({ id: 'plot-1', dimension: 'plot' })] }))
    );
    triggerInit();
    fixture.detectChanges();

    component.onDimensionClick('tone'); // no tone findings
    fixture.detectChanges();

    expect(component.isFilteredEmpty).toBeTrue();
    expect(query('[data-testid="findings-filtered-empty"]')).not.toBeNull();
  });

  // ── Status PATCH: optimistic + reconcile (held-open Subject) ──────────────────

  it('PATCH optimistic + reconcile: flips locally BEFORE emit, reconciles to server status AFTER emit', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ findings: [makeFinding({ id: 'f-1', status: 'open' })] }))
    );
    const patch$ = new Subject<BookFinding>();
    const patchSpy = spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());

    triggerInit();
    fixture.detectChanges();

    const finding = component.findings[0];
    expect(finding.status).toBe('open');

    // Act: acknowledge. The PATCH Subject is held OPEN, so we are inside the optimistic window now.
    component.onStatusAction(finding, 'acknowledge');

    // BEFORE emit: optimistic status applied + in-flight flag set; the verb was sent.
    expect(patchSpy).toHaveBeenCalledWith('book-1', 'f-1', 'acknowledge');
    expect(finding.status).toBe('acknowledged');
    expect(finding.patching).toBeTrue();

    // AFTER emit: reconcile to the SERVER-returned status (here the server normalized to 'done').
    patch$.next(makeFinding({ id: 'f-1', status: 'done' }));
    patch$.complete();

    expect(finding.status).toBe('done');
    expect(finding.patching).toBeFalse();
    expect(finding.patchError).toBeFalse();
  });

  it('PATCH error: reverts to the prior status and flags patchError (held-open Subject, errored)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ findings: [makeFinding({ id: 'f-1', status: 'open' })] }))
    );
    const patch$ = new Subject<BookFinding>();
    spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());

    triggerInit();
    fixture.detectChanges();

    const finding = component.findings[0];
    component.onStatusAction(finding, 'dismiss');

    // Optimistic: dismissed shown while in flight.
    expect(finding.status).toBe('dismissed');
    expect(finding.patching).toBeTrue();

    // Server rejects -> revert to the prior 'open' status, surface the retry hint.
    patch$.error(new Error('500'));

    expect(finding.status).toBe('open');
    expect(finding.patching).toBeFalse();
    expect(finding.patchError).toBeTrue();
  });

  // ── Optimistic group move + revert (DOM membership, not just finding.status) ──

  it('optimistic dismiss MOVES the rendered row from the active group to the resolved group, and a revert moves it BACK', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ findings: [makeFinding({ id: 'f-1', status: 'open' })] }))
    );
    const patch$ = new Subject<BookFinding>();
    spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());

    triggerInit();
    fixture.detectChanges();

    // Helper: is the finding row a DESCENDANT of the named group container?
    const rowInGroup = (groupTestId: string, findingId: string): boolean => {
      const group = query(`[data-testid="${groupTestId}"]`);
      if (!group) return false;
      return !!group.query(By.css(`[data-testid="finding-row-${findingId}"]`));
    };

    // BEFORE the dismiss: the open finding renders inside the ACTIVE group, not the resolved group.
    expect(rowInGroup('ledger-active-group', 'f-1')).toBeTrue();
    expect(query('[data-testid="ledger-resolved-group"]')).toBeNull(); // no resolved group at all yet

    // Act: optimistic dismiss. The PATCH Subject is held OPEN, so we observe the optimistic DOM now.
    const finding = component.findings[0];
    component.onStatusAction(finding, 'dismiss');
    fixture.detectChanges();

    // Optimistic move: the row has LEFT the active group and now renders in the RESOLVED group.
    expect(rowInGroup('ledger-active-group', 'f-1')).toBeFalse();
    expect(rowInGroup('ledger-resolved-group', 'f-1')).toBeTrue();

    // Server rejects -> revert. The row moves BACK to the active group and out of the resolved group.
    patch$.error(new Error('500'));
    fixture.detectChanges();

    expect(rowInGroup('ledger-active-group', 'f-1')).toBeTrue();
    expect(rowInGroup('ledger-resolved-group', 'f-1')).toBeFalse();
    // The resolved group collapses entirely (zero resolved findings) once the row reverts.
    expect(query('[data-testid="ledger-resolved-group"]')).toBeNull();
  });

  // ── Stale-response drop: a patch reply after a context switch must NOT mutate ─

  it('DROPS a patch response that arrives AFTER bookId changed (the next-handler stale-guard) — the in-flight finding is not reconciled', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ bookId: 'book-1', findings: [makeFinding({ id: 'f-1', status: 'open' })] }))
    );
    const patch$ = new Subject<BookFinding>();
    spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());

    triggerInit();
    fixture.detectChanges();

    // Start a dismiss; the PATCH Subject is held OPEN (in flight). Keep a reference to the SAME finding
    // object the handler's closure captured — the stale-guard's job is to NOT reconcile it post-switch.
    const finding = component.findings[0];
    component.onStatusAction(finding, 'dismiss');
    expect(finding.status).toBe('dismissed'); // optimistic, in flight
    expect(finding.patching).toBeTrue();

    // Switch the context's bookId WHILE the patch is in flight WITHOUT routing through ngOnChanges/resetView
    // (which would tear the sub down). This isolates the next()-handler stale-guard: the captured `bookId`
    // local no longer equals `this.bookId`, so the response must be dropped rather than reconciled.
    component.bookId = 'book-2';

    // NOW the stale (book-1) patch resolves into the still-live subscription. The guard must DROP it: it must
    // NOT overwrite the optimistic status to the server 'done' nor clear the in-flight flag for the wrong book.
    patch$.next(makeFinding({ id: 'f-1', status: 'done' }));
    patch$.complete();
    fixture.detectChanges();

    // The finding is left exactly as the optimistic dismiss left it — the stale response was dropped.
    expect(finding.status).toBe('dismissed');
    expect(finding.patching).toBeTrue();
    expect(finding.patchError).toBeFalsy();
  });

  // ── Context reset: ngOnChanges(bookId) tears down in-flight/optimistic state ──

  it('ngOnChanges(bookId) resets in-flight/optimistic state — a leftover patch from the prior book does not apply to the new one', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const getSpy = spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ bookId: 'book-1', findings: [makeFinding({ id: 'f-1', status: 'open' })] }))
    );
    const patch$ = new Subject<BookFinding>();
    spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(patch$.asObservable());

    triggerInit();
    fixture.detectChanges();

    // Hold a patch open on book-1.
    component.onStatusAction(component.findings[0], 'acknowledge');

    // Switch to book-2. resetView() should clear filters/expansion AND tear down the in-flight patch sub.
    component.expandedIds.add('f-1');
    component.dimensionFilter = 'plot';
    getSpy.and.returnValue(
      of(makeFindingsDto({ bookId: 'book-2', findings: [makeFinding({ id: 'f-9', status: 'open' })] }))
    );
    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    fixture.detectChanges();

    // resetView cleared the transient view state.
    expect(component.dimensionFilter).toBeNull();
    expect(component.expandedIds.size).toBe(0);
    expect(component.findings.map((f) => f.id)).toEqual(['f-9']);

    // The leftover book-1 patch now resolves. With the sub torn down + the stale-guard, the book-2 finding
    // (the ONLY one in the new context) is untouched.
    const newFinding = component.findings[0];
    patch$.next(makeFinding({ id: 'f-1', status: 'done' }));
    patch$.complete();
    fixture.detectChanges();

    expect(newFinding.status).toBe('open');
    expect(newFinding.patching).toBeFalsy();
    expect(component.findings.map((f) => f.id)).toEqual(['f-9']);
  });

  it('PATCH is a no-op when the finding is already in the target status', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ findings: [makeFinding({ id: 'f-1', status: 'done' })] }))
    );
    const patchSpy = spyOn(reviewSvc, 'patchFindingStatus').and.returnValue(NEVER);

    triggerInit();
    fixture.detectChanges();

    component.onStatusAction(component.findings[0], 'done');
    expect(patchSpy).not.toHaveBeenCalled();
  });

  // ── Empty + error states ─────────────────────────────────────────────────────

  it('EMPTY: shows the empty hint when the review is loaded with zero findings', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(makeFindingsDto({ findings: [], scores: [] }))
    );
    triggerInit();
    fixture.detectChanges();

    expect(component.isEmpty).toBeTrue();
    expect(query('[data-testid="findings-empty"]')).not.toBeNull();
    expect(query('[data-testid="findings-scorecard"]')).toBeNull();
  });

  it('ERROR: shows the error state when the findings fetch fails', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(throwError(() => new Error('boom')));
    triggerInit();
    fixture.detectChanges();

    expect(component.loadError).toBeTrue();
    expect(query('[data-testid="findings-error"]')).not.toBeNull();
    expect(query('[data-testid="findings-scorecard"]')).toBeNull();
  });

  // ── Navigation seam (wb3-f01 + rf-f05) ─────────────────────────────────────

  it('emits openChapter with the anchor when a chapter-anchor chip is clicked (wb3-f01 seam)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto()));
    triggerInit();
    fixture.detectChanges();

    let emitted: ChapterAnchor | null = null;
    component.openChapter.subscribe((a) => (emitted = a));

    query('[data-testid="anchor-chip-f-1-c-3"]').nativeElement.click();

    expect(emitted).not.toBeNull();
    expect(emitted!.chapterId).toBe('c-3');
    expect(emitted!.order).toBe(3);
  });

  it('rf-f05: clicking a chapter-anchor chip sets the revise context (findingId + oneLiner + chapterId)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const reviseCtx = TestBed.inject(ReviseContextService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto()));
    triggerInit();
    fixture.detectChanges();

    expect(reviseCtx.snapshot).toBeNull();

    query('[data-testid="anchor-chip-f-1-c-3"]').nativeElement.click();

    expect(reviseCtx.snapshot).not.toBeNull();
    expect(reviseCtx.snapshot!.findingId).toBe('f-1');
    expect(reviseCtx.snapshot!.chapterId).toBe('c-3');
    // oneLiner should be a non-empty string derived from the rationale.
    expect(reviseCtx.snapshot!.oneLiner.length).toBeGreaterThan(0);
    expect(reviseCtx.snapshot!.oneLiner).toContain('midpoint reversal');
  });

  it('rf-f05: openChapter is STILL emitted after the revise context is set (no regression)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto()));
    triggerInit();
    fixture.detectChanges();

    let emitted: ChapterAnchor | null = null;
    component.openChapter.subscribe((a) => (emitted = a));

    query('[data-testid="anchor-chip-f-1-c-3"]').nativeElement.click();

    // openChapter must still be emitted so the editor navigates to the chapter.
    expect(emitted).not.toBeNull();
    expect(emitted!.chapterId).toBe('c-3');
  });

  // ── he/en parity ─────────────────────────────────────────────────────────────

  it('renders English labels when the book language is English', () => {
    component.bookLanguage = 'en';
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(of(makeFindingsDto({ language: 'en' })));
    triggerInit();
    fixture.detectChanges();

    expect(component.findingsDir).toBe('ltr');
    expect(component.dimensionLabel('plot')).toBe('Plot');
    expect(component.verdictLabel('cut')).toBe('Cut');
    expect(component.scoreLabel('weak')).toBe('Weak');
    expect(component.statusLabel('acknowledged')).toBe('Acknowledged');
  });

  it('every he label map covers all enum values (he/en parity, no missing keys)', () => {
    const dims = ['plot', 'character', 'pacing', 'tone', 'theme', 'continuity'] as const;
    const verdicts = ['keep', 'improve', 'cut'] as const;
    const scores = ['weak', 'mixed', 'strong'] as const;
    const statuses: FindingStatus[] = ['open', 'acknowledged', 'dismissed', 'done'];

    component.bookLanguage = 'he';
    for (const d of dims) expect(component.dimensionLabel(d)).not.toBe(d);
    for (const v of verdicts) expect(component.verdictLabel(v)).not.toBe(v);
    for (const s of scores) expect(component.scoreLabel(s)).not.toBe(s);
    for (const s of statuses) expect(component.statusLabel(s)).not.toBe(s);
  });

  // ── NaN guard: unknown DimensionScore.score string (f02) ────────────────────

  it('overallScore is a finite number in [0,100] and never renders "NaN" when a DimensionScore carries an unknown score string', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewFindings').and.returnValue(
      of(
        makeFindingsDto({
          findings: [],
          scores: [
            // Known label mixed alongside an unknown label injected via `as any`.
            makeScore({ dimension: 'plot', score: 'mixed' }),
            makeScore({ dimension: 'character', score: 'unknown_future_value' as any }),
          ],
        })
      )
    );
    triggerInit();
    fixture.detectChanges();

    // overallScore must be a finite number in the valid range.
    const score = component.overallScore;
    expect(Number.isFinite(score)).toBeTrue();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    // The rendered figure must NOT be the string "NaN".
    const scorecardEl = query('[data-testid="findings-scorecard"]');
    expect(scorecardEl).not.toBeNull();
    expect(scorecardEl.nativeElement.textContent).not.toContain('NaN');
  });
});
