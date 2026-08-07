/**
 * Wave 1d (c2): THREE-SURFACE PARITY - the acceptance criterion of this todo.
 *
 * One running job is shown in three places at once:
 *   (i)   the run dialog          - app-analysis-run-dialog
 *   (ii)  the in-page indicator   - app-job-progress-inline (inside the analysis panel's async banner)
 *   (iii) the Activity Center     - app-activity-center's panel row
 *
 * Before this wave, (ii) was the editor's full-screen `.analysis-overlay`, whose percent was re-derived
 * from the orchestration service's own `'progress'` events and then re-clamped and forced monotonic
 * locally: a SECOND OWNER of a number JobRegistryService already owned. The three surfaces could drift
 * (different clamp, different terminal handling, different lifetime). This spec is the regression fence.
 *
 * Its whole point is the word ONE. It uses the REAL JobRegistryService (only the HTTP-shaped services
 * underneath it are stubbed) and drives it with a SINGLE progress emission from a single stubbed poll, so
 * a divergence cannot be papered over by feeding each surface its own value. If a future change gives any
 * surface its own progress channel again, the numbers will stop matching here.
 */
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideRouter } from '@angular/router';
import { NEVER, ReplaySubject, Subject, of } from 'rxjs';

import { AnalysisRunDialogComponent } from './analysis-run-dialog.component';
import { JobProgressInlineComponent } from '../job-progress-inline/job-progress-inline.component';
import { ActivityCenterComponent } from '../activity-center/activity-center.component';
import { JobKind, JobRegistryService } from '../../core/services/job-registry.service';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { AnalysisProgressDto } from '../../core/models/analysis';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';

const JOB_ID = 'JOB-PARITY-1';
const BOOK_ID = 'book-1';

@Component({
  standalone: true,
  imports: [AnalysisRunDialogComponent, JobProgressInlineComponent, ActivityCenterComponent],
  template: `
    <app-analysis-run-dialog
      [(open)]="open"
      [runEvents]="events$"
      analysisType="Proofread"
      bookLanguage="he">
    </app-analysis-run-dialog>

    <app-job-progress-inline [jobId]="jobId"></app-job-progress-inline>

    <app-activity-center></app-activity-center>
  `,
})
class ThreeSurfaceHostComponent {
  open = false;
  jobId: string | null = null;
  events$ = new ReplaySubject<AnalysisRunEvent>(16);
}

/** One progress DTO, with only the fields the registry's normalizer reads set meaningfully. */
function progress(overrides: Partial<AnalysisProgressDto>): AnalysisProgressDto {
  return {
    jobId: JOB_ID,
    analysisType: 'Proofread',
    scope: 'Chapter',
    status: 'Running',
    currentChunk: 0,
    totalChunks: 0,
    completedChunks: 0,
    message: '',
    estimatedCompletionPercent: -1,
    ...overrides,
  };
}

/** What each of the three surfaces is showing, keyed the same way by every extractor below. */
interface SurfaceTriple { dialog: string | null; inline: string | null; activityCenter: string | null }

/** The percent each surface is CURRENTLY telling a screen reader. */
function ariaPercentsIn(root: HTMLElement): SurfaceTriple {
  return {
    dialog: root.querySelector('.rd-progress-track')?.getAttribute('aria-valuenow') ?? null,
    inline: root.querySelector('.jpi-track')?.getAttribute('aria-valuenow') ?? null,
    activityCenter: root.querySelector('.ac-progress-track')?.getAttribute('aria-valuenow') ?? null,
  };
}

/** The percent each surface is CURRENTLY showing a sighted user. */
function readoutPercentsIn(root: HTMLElement): SurfaceTriple {
  const text = (sel: string) => root.querySelector(sel)?.textContent?.trim() ?? null;
  return {
    dialog: text('.rd-progress-percent'),
    inline: text('.jpi-percent'),
    activityCenter: text('.ac-progress-percent'),
  };
}

/**
 * c04. The completed/total chunk COUNTS each surface is currently showing, normalized to `completed/total`.
 *
 * The three treatments differ on purpose - the dialog spells out a localized sentence ("הגהה: 3 מתוך 10
 * הושלמו"), the two compact surfaces show a bare "3/10" - and the todo's rule is exactly that: a smaller
 * treatment is fine, a DIFFERENT NUMBER is not. So this pulls the two integers out of whatever each
 * surface renders and compares the PAIR, which is the fact that has to match. Comparing rendered strings
 * instead would either force one treatment on all three or assert nothing at all.
 *
 * c02: module-scope on purpose. The per-KIND fence at the bottom of this file asks the same question of
 * a summary / review / style-baseline job, and it has to ask it with the SAME extractor - two extractors
 * would let the two fences disagree about what "shows a count" even means.
 */
function countsPairsIn(root: HTMLElement): SurfaceTriple {
  const pair = (sel: string) => {
    const text = root.querySelector(sel)?.textContent ?? '';
    const m = text.match(/(\d+)\D+?(\d+)/);
    return m ? `${m[1]}/${m[2]}` : null;
  };
  return {
    dialog: pair('.rd-message'),
    inline: pair('.jpi-counts'),
    activityCenter: pair('.ac-progress-counts'),
  };
}

describe('three-surface parity over ONE registry job (Wave 1d c2)', () => {
  let fixture: ComponentFixture<ThreeSurfaceHostComponent>;
  let host: ThreeSurfaceHostComponent;
  let registry: JobRegistryService;
  /** The ONE progress channel behind the real registry. Every number on screen originates here. */
  let poll$: Subject<AnalysisProgressDto>;

  const root = () => fixture.nativeElement as HTMLElement;
  const ariaPercents = () => ariaPercentsIn(root());
  const readoutPercents = () => readoutPercentsIn(root());
  const countsPairs = () => countsPairsIn(root());

  beforeEach(async () => {
    poll$ = new Subject<AnalysisProgressDto>();

    await TestBed.configureTestingModule({
      imports: [ThreeSurfaceHostComponent],
      providers: [
        provideRouter([]),
        // The REAL JobRegistryService is used (it is providedIn:'root'); only the HTTP-shaped services
        // beneath it are stubbed, so the normalization + single-finalize logic under test is the shipped one.
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => poll$.asObservable(),
            pollBookSummaryProgress: () => NEVER,
            pollBookReviewProgress: () => NEVER,
            pollStyleBaselineProgress: () => NEVER,
          },
        },
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs: () => of([]) } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => of({ activeBuildJobId: null }) } },
        { provide: BookReviewService, useValue: { getReviewStatus: () => of({ activeBuildJobId: null }) } },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => of({ activeBuildJobId: null }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ThreeSurfaceHostComponent);
    host = fixture.componentInstance;
    registry = TestBed.inject(JobRegistryService);

    // A run starts: the panel tracks the job (its single track() call site), the dialog learns the id from
    // the run stream, and the in-page indicator is pointed at the same id.
    registry.track('proofread', BOOK_ID, JOB_ID, { chapterId: 'ch-1', analysisType: 'Proofread' });
    host.jobId = JOB_ID;
    host.open = true;
    fixture.detectChanges();
    host.events$.next({ kind: 'job-started', jobId: JOB_ID });
    fixture.detectChanges();

    // Open the Activity Center panel so its row is actually rendered. Driven through AppOverlayService,
    // the seam the tab body subscribes to: it marks the OnPush component for check, which a bare field
    // write would not. (There is no bell to click any more; the merged dock owns the launcher.)
    TestBed.inject(AppOverlayService).openTab('activity');
    fixture.detectChanges();
  });

  it('all three surfaces are mounted and looking at the same job', () => {
    expect(root().querySelector('.rd-card')).not.toBeNull();
    expect(root().querySelector('.jpi-track')).not.toBeNull();
    expect(root().querySelector('.ac-row')).not.toBeNull();
    // Exactly one Activity Center row: no duplicate registration from the dialog or the indicator.
    expect(root().querySelectorAll('.ac-row').length).toBe(1);
  });

  it('ONE registry emission puts the SAME percent on all three surfaces', () => {
    poll$.next(progress({ completedChunks: 3, totalChunks: 5, message: 'Proofread · 3 of 5 completed' }));
    fixture.detectChanges();

    expect(ariaPercents()).toEqual({ dialog: '60', inline: '60', activityCenter: '60' });
    expect(readoutPercents()).toEqual({ dialog: '60%', inline: '60%', activityCenter: '60%' });
  });

  // c04. The percent is a DERIVED number; the counts are the raw pair it was derived from, and they are
  // now on screen too. Both come off the same TrackedJob fields, so the fence has to cover both or the
  // next change can put "3 of 10" on one surface and "4 of 10" on another while the percents still agree.
  it('ONE registry emission puts the SAME chunk COUNTS on all three surfaces', () => {
    poll$.next(progress({ completedChunks: 3, totalChunks: 10, message: 'Running chunk 4/10' }));
    fixture.detectChanges();

    expect(countsPairs()).toEqual({ dialog: '3/10', inline: '3/10', activityCenter: '3/10' });
    // ...and the percent derived from that same pair, so the two readouts tell one story.
    expect(readoutPercents()).toEqual({ dialog: '30%', inline: '30%', activityCenter: '30%' });
  });

  it('the counts advance together, including through 0 of 10 (the moment that read as stalled)', () => {
    // The user's screenshot: 0% next to a run that had queued ten chunks, because the parallel workers
    // had not finished one yet. The percent is honest and useless; the counts are what carry the shape.
    poll$.next(progress({ completedChunks: 0, totalChunks: 10 }));
    fixture.detectChanges();
    expect(countsPairs()).toEqual({ dialog: '0/10', inline: '0/10', activityCenter: '0/10' });
    expect(readoutPercents()).toEqual({ dialog: '0%', inline: '0%', activityCenter: '0%' });

    poll$.next(progress({ completedChunks: 7, totalChunks: 10 }));
    fixture.detectChanges();
    expect(countsPairs()).toEqual({ dialog: '7/10', inline: '7/10', activityCenter: '7/10' });
  });

  it('a run with NO chunk shape shows counts on NONE of them (never "0 of 0")', () => {
    poll$.next(progress({ totalChunks: 0, estimatedCompletionPercent: 42 }));
    fixture.detectChanges();

    // The two compact surfaces render no counts element at all...
    expect(root().querySelector('.jpi-counts')).toBeNull();
    expect(root().querySelector('.ac-progress-counts')).toBeNull();
    // ...and the dialog falls back to its count-free sentence, so no pair can be read off it either.
    expect(countsPairs().dialog).toBeNull();
    // The percent is unaffected: it came from the other DTO shape.
    expect(readoutPercents()).toEqual({ dialog: '42%', inline: '42%', activityCenter: '42%' });
  });

  it('they stay identical as the job advances (a second emission moves all three together)', () => {
    poll$.next(progress({ completedChunks: 1, totalChunks: 4 }));
    fixture.detectChanges();
    expect(ariaPercents()).toEqual({ dialog: '25', inline: '25', activityCenter: '25' });

    poll$.next(progress({ completedChunks: 3, totalChunks: 4 }));
    fixture.detectChanges();
    expect(ariaPercents()).toEqual({ dialog: '75', inline: '75', activityCenter: '75' });
  });

  it('the other progress SHAPE (estimatedCompletionPercent) also lands identically', () => {
    // Book-level pollers report this shape; normalizeProgress folds both into one number, once.
    poll$.next(progress({ totalChunks: 0, estimatedCompletionPercent: 42 }));
    fixture.detectChanges();

    expect(ariaPercents()).toEqual({ dialog: '42', inline: '42', activityCenter: '42' });
  });

  it('an INDETERMINATE job shows the indeterminate bar on all three, with no aria-valuenow anywhere', () => {
    // No chunk counts and the backend's "no estimate yet" sentinel: percent is genuinely unknown.
    poll$.next(progress({ totalChunks: 0, estimatedCompletionPercent: -1 }));
    fixture.detectChanges();

    expect(ariaPercents()).toEqual({ dialog: null, inline: null, activityCenter: null });
    expect(root().querySelector('.rd-progress-fill--indet')).not.toBeNull();
    expect(root().querySelector('.jpi-fill--indet')).not.toBeNull();
    expect(root().querySelector('.ac-progress-fill--indet')).not.toBeNull();
  });

  // c05. A job can end WITHOUT ever having reported a percent (its poll errors before any chunk count
  // arrives, or it is canceled). All three surfaces used to render that as the pulsing indeterminate
  // bar, i.e. as a live task, next to their own "Failed" pill. The fix is keyed on the state machine
  // rather than on percent nullity, and it has to land on all three or this wave's convergence is gone.
  it('a job that ENDS with no percent shows an inert bar on all three, not the pulsing one', () => {
    poll$.next(progress({ totalChunks: 0, estimatedCompletionPercent: -1 }));
    fixture.detectChanges();
    // Precondition: while it was still running, all three really were pulsing.
    expect(root().querySelector('.rd-progress-fill--indet')).not.toBeNull();
    expect(root().querySelector('.jpi-fill--indet')).not.toBeNull();
    expect(root().querySelector('.ac-progress-fill--indet')).not.toBeNull();

    // The run fails before any percent was ever known.
    poll$.next(progress({ status: 'Failed', totalChunks: 0, estimatedCompletionPercent: -1, message: 'boom' }));
    fixture.detectChanges();

    // Nothing pulses any more, on any surface.
    expect(root().querySelector('.rd-progress-fill--indet')).toBeNull();
    expect(root().querySelector('.jpi-fill--indet')).toBeNull();
    expect(root().querySelector('.ac-progress-fill--indet')).toBeNull();

    // And no surface still claims to be a progressbar of unknown size.
    expect(root().querySelector('.rd-progress-track')!.hasAttribute('role')).toBeFalse();
    expect(root().querySelector('.jpi-track')!.hasAttribute('role')).toBeFalse();
    expect(root().querySelector('.ac-progress-track')!.hasAttribute('role')).toBeFalse();
    expect(ariaPercents()).toEqual({ dialog: null, inline: null, activityCenter: null });
  });

  it('the terminal emission resolves all three to 100% exactly once', () => {
    poll$.next(progress({ completedChunks: 2, totalChunks: 5 }));
    fixture.detectChanges();
    expect(ariaPercents()).toEqual({ dialog: '40', inline: '40', activityCenter: '40' });

    poll$.next(progress({ status: 'Succeeded', completedChunks: 5, totalChunks: 5, message: 'done' }));
    fixture.detectChanges();

    expect(ariaPercents()).toEqual({ dialog: '100', inline: '100', activityCenter: '100' });
    // Single-finalize: a repeated terminal snapshot cannot add a second row or move the number.
    poll$.next(progress({ status: 'Succeeded', completedChunks: 5, totalChunks: 5, message: 'done again' }));
    fixture.detectChanges();
    expect(root().querySelectorAll('.ac-row').length).toBe(1);
    expect(ariaPercents()).toEqual({ dialog: '100', inline: '100', activityCenter: '100' });
  });

  it('a raw "progress" event on the run stream cannot desynchronize the dialog from the other two', () => {
    poll$.next(progress({ completedChunks: 1, totalChunks: 5 }));
    fixture.detectChanges();
    expect(ariaPercents()).toEqual({ dialog: '20', inline: '20', activityCenter: '20' });

    // The orchestration service's own poll of the sync-embedded jobId is exactly the second channel this
    // wave removed. Even if it fires, the dialog must ignore it.
    host.events$.next({ kind: 'progress', percent: 95, message: 'stale poll text', rawStatus: 'running' });
    fixture.detectChanges();

    expect(ariaPercents()).toEqual({ dialog: '20', inline: '20', activityCenter: '20' });
  });

  it('minimizing the dialog leaves the other two surfaces tracking the same job', () => {
    poll$.next(progress({ completedChunks: 2, totalChunks: 5 }));
    fixture.detectChanges();

    (root().querySelector('.rd-minimize') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Dialog gone, job untouched: the in-page indicator and the Activity Center keep advancing.
    expect(root().querySelector('.rd-card')).toBeNull();
    expect(host.open).toBeFalse();

    poll$.next(progress({ completedChunks: 4, totalChunks: 5 }));
    fixture.detectChanges();

    const after = ariaPercents();
    expect(after.dialog).toBeNull();
    expect(after.inline).toBe('80');
    expect(after.activityCenter).toBe('80');
  });
});

/**
 * c02 (run-dialog-starting-state-escape, 2026-08-03): the fence asked of a run that is on NONE of the
 * three surfaces, which is the case the other two blocks cannot see.
 *
 * A sub-threshold (single-chunk) analysis takes the SYNC route: one blocking `/analyze` request, a
 * result persisted with a NULL JobId (verified in the database), no `job-started` event, and therefore
 * no `JobRegistryService.track()` call anywhere. So it has NO Activity Center row and NO in-page
 * indicator, and the run dialog is its only surface for the whole run.
 *
 * That is a DECISION, not an accident (see `AnalysisRunDialogComponent.minimize`): the alternative was
 * to track sync runs behind a client-minted synthetic id so minimize, the bell and this very fence would
 * work uniformly, and it was rejected because such a run cannot be reattached after a refresh and does
 * not outlive the analysis panel that owns its HTTP subscription, while the Activity Center is
 * app-level chrome whose whole promise is that it does.
 *
 * This block exists so that decision cannot be reversed by accident. Its assertions are deliberately
 * about the ABSENCE of surfaces, which is exactly what the two blocks above cannot express.
 *
 * WHAT IT DOES AND DOES NOT CATCH, measured during final-r01 rather than assumed. This host drives
 * `JobRegistryService` ITSELF; it does not mount `AnalysisPanelComponent`, which owns the one
 * `track()` call site. So a production change that starts minting a synthetic id in the panel leaves
 * THESE two registry-fed assertions (`.ac-row`, `.jpi-track`) green - it was tried, and the whole suite
 * stayed green. The half of this block that IS a real production guard is the dialog: `.rd-close`
 * present and `.rd-minimize` absent fail immediately if `canMinimize` is widened to state (a). The
 * production-source guard for the track() call itself lives in `analysis-panel.component.spec.ts`
 * ("c02: a SYNC run (no job-started) is NEVER tracked"), and a reversal has to turn BOTH red.
 */
describe('a SYNC run is on none of the three surfaces (c02)', () => {
  let fixture: ComponentFixture<ThreeSurfaceHostComponent>;
  let host: ThreeSurfaceHostComponent;

  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ThreeSurfaceHostComponent],
      providers: [
        provideRouter([]),
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => NEVER,
            pollBookSummaryProgress: () => NEVER,
            pollBookReviewProgress: () => NEVER,
            pollStyleBaselineProgress: () => NEVER,
          },
        },
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs: () => of([]) } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => of({ activeBuildJobId: null }) } },
        { provide: BookReviewService, useValue: { getReviewStatus: () => of({ activeBuildJobId: null }) } },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => of({ activeBuildJobId: null }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ThreeSurfaceHostComponent);
    host = fixture.componentInstance;

    // A SYNC run: NO registry.track() call (the panel makes that call only from `job-started`), no jobId
    // for the in-page indicator to point at, and one client-composed status event before the blocking
    // request returns.
    host.jobId = null;
    host.open = true;
    fixture.detectChanges();
    host.events$.next({ kind: 'status', message: 'מריץ הגהה...' });
    fixture.detectChanges();

    TestBed.inject(AppOverlayService).openTab('activity');
    fixture.detectChanges();
  });

  it('mid-run: the dialog is the ONLY surface, and it offers a close rather than a minimize', () => {
    // The dialog is up and blocking...
    expect(root().querySelector('.rd-card')).not.toBeNull();
    expect(root().querySelector('.rd-progress-fill--indet')).not.toBeNull();
    // ...with an escape that is honestly labelled: no bell row exists, so there is nothing to minimize.
    expect(root().querySelector('.rd-close')).not.toBeNull();
    expect(root().querySelector('.rd-minimize')).toBeNull();

    // The Activity Center panel is OPEN and has no row for this run.
    expect(root().querySelectorAll('.ac-row').length)
      .withContext('a row here would claim a durable, cross-book job that does not exist')
      .toBe(0);
    // And the in-page indicator has nothing to render.
    expect(root().querySelector('.jpi-track')).toBeNull();
  });

  it('closing the card leaves the run with no surface at all, which is the accepted cost', () => {
    (root().querySelector('.rd-close') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root().querySelector('.rd-card')).toBeNull();
    expect(root().querySelectorAll('.ac-row').length).toBe(0);
    expect(root().querySelector('.jpi-track')).toBeNull();
    expect(host.open).toBeFalse();
  });

  it('the terminal sync result adds no row either: nothing was ever tracked to finalize', () => {
    host.events$.next({
      kind: 'sync-result',
      result: {
        id: 'res-1',
        chapterId: 'ch-1',
        type: 'Proofread',
        resultText: 'ok',
        createdAt: new Date().toISOString(),
        analysisType: 'Proofread',
      },
    });
    fixture.detectChanges();

    // The dialog resolves to its own terminal, from the run stream and not from the registry.
    expect(root().querySelector('.rd-status-pill')!.textContent!.trim()).toBe('הסתיים');
    // The other two surfaces never learned this run existed, and still do not.
    expect(root().querySelectorAll('.ac-row').length).toBe(0);
    expect(root().querySelector('.jpi-track')).toBeNull();
  });
});

/**
 * c02 (2026-08-03): the SAME fence, asked PER KIND.
 *
 * `totalChunks` is one wire field with a different UNIT per producer, measured at the call sites:
 * text chunks of the chapter for `proofread` (`UnifiedAnalysisService.SetTotalChunks(chunks.Count)`),
 * the book's CHAPTERS for `summary` (`BookSummaryService`) and `style-baseline`
 * (`StyleBaselineService`), and for `review` (`BookReviewService`) map-reduce WINDOWS plus one
 * synthesis pass plus a variable number of continuity passes - with a legacy branch that reports
 * DIMENSIONS into the same field. None of the three surfaces renders a unit label.
 *
 * The c04 readers gated on `totalChunks !== null` alone, so a review build rendered a bare `3/9` that
 * a reader can only take as chapters, and is wrong. The registry now owns the decision
 * (`showsChunkCounts` / `CHUNK_COUNT_KINDS`) and all three surfaces ask it. This block is the fence:
 * ONE registry emission, three surfaces, asserted per kind - so the two compact surfaces cannot
 * diverge from each other OR from the dialog when the answer differs by kind.
 */
describe('the bare chunk COUNTS are scoped by job KIND (c02)', () => {
  let fixture: ComponentFixture<ThreeSurfaceHostComponent>;
  let host: ThreeSurfaceHostComponent;
  /** The ONE progress channel behind the real registry, whichever poller the kind routes to. */
  let poll$: Subject<AnalysisProgressDto>;

  const root = () => fixture.nativeElement as HTMLElement;
  const countsPairs = () => countsPairsIn(root());
  const readoutPercents = () => readoutPercentsIn(root());
  const ariaPercents = () => ariaPercentsIn(root());

  /**
   * Mount all three surfaces over ONE registry job of the given kind. Every book-level poller is wired
   * to the SAME subject as the chapter poller, so the kind under test changes which registry code path
   * runs while the numbers on screen still come from a single emission.
   */
  async function setupKind(kind: JobKind): Promise<void> {
    poll$ = new Subject<AnalysisProgressDto>();
    const stream = () => poll$.asObservable();

    await TestBed.configureTestingModule({
      imports: [ThreeSurfaceHostComponent],
      providers: [
        provideRouter([]),
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: stream,
            pollBookSummaryProgress: stream,
            pollBookReviewProgress: stream,
            pollStyleBaselineProgress: stream,
          },
        },
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs: () => of([]) } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => of({ activeBuildJobId: null }) } },
        { provide: BookReviewService, useValue: { getReviewStatus: () => of({ activeBuildJobId: null }) } },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => of({ activeBuildJobId: null }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ThreeSurfaceHostComponent);
    host = fixture.componentInstance;
    const registry = TestBed.inject(JobRegistryService);

    registry.track(kind, BOOK_ID, JOB_ID, { chapterId: 'ch-1' });
    host.jobId = JOB_ID;
    host.open = true;
    fixture.detectChanges();
    host.events$.next({ kind: 'job-started', jobId: JOB_ID });
    fixture.detectChanges();

    TestBed.inject(AppOverlayService).openTab('activity');
    fixture.detectChanges();
  }

  it('a chapter proofread shows its counts: its denominator is TEXT CHUNKS of the chapter', async () => {
    // The control. Scoping by kind must not cost the kind the counts were written for.
    await setupKind('proofread');
    poll$.next(progress({ completedChunks: 3, totalChunks: 10 }));
    fixture.detectChanges();

    expect(countsPairs()).toEqual({ dialog: '3/10', inline: '3/10', activityCenter: '3/10' });
  });

  it('a summary build shows its counts: its denominator is the book CHAPTERS, which the scope names', async () => {
    await setupKind('summary');
    poll$.next(progress({ completedChunks: 3, totalChunks: 12 }));
    fixture.detectChanges();

    // Decided, not inherited: "3 of 12" on a whole-book summary is 3 of the book's 12 chapters, and it
    // reads correctly whether taken as chapters or as pieces of work.
    expect(countsPairs()).toEqual({ dialog: '3/12', inline: '3/12', activityCenter: '3/12' });
    expect(readoutPercents()).toEqual({ dialog: '25%', inline: '25%', activityCenter: '25%' });
  });

  it('a style-baseline build shows its counts too: same CHAPTERS denominator', async () => {
    await setupKind('style-baseline');
    poll$.next(progress({ completedChunks: 2, totalChunks: 8 }));
    fixture.detectChanges();

    expect(countsPairs()).toEqual({ dialog: '2/8', inline: '2/8', activityCenter: '2/8' });
  });

  it('a review build shows NO bare pair on ANY surface: 3/9 there is windows plus reduce passes, not chapters', async () => {
    await setupKind('review');
    poll$.next(progress({ completedChunks: 3, totalChunks: 9 }));
    fixture.detectChanges();

    // Asserted across all three FIRST, so a regression names every surface it reached rather than
    // stopping at whichever element assertion happens to run first.
    expect(countsPairs()).toEqual({ dialog: null, inline: null, activityCenter: null });
    // The two compact surfaces render no counts element at all (not an empty one)...
    expect(root().querySelector('.jpi-counts')).toBeNull();
    expect(root().querySelector('.ac-progress-counts')).toBeNull();
  });

  it('withholding the review pair costs it nothing else: the PERCENT still lands on all three', async () => {
    // The scoping must remove the ambiguous PAIR only. A review row that lost its progress bar too
    // would be a worse regression than the one this fixes.
    await setupKind('review');
    poll$.next(progress({ completedChunks: 3, totalChunks: 9 }));
    fixture.detectChanges();

    expect(ariaPercents()).toEqual({ dialog: '33', inline: '33', activityCenter: '33' });
    expect(readoutPercents()).toEqual({ dialog: '33%', inline: '33%', activityCenter: '33%' });
    // ...and it is a DETERMINATE bar, not the pulsing "unknown size" one.
    expect(root().querySelector('.ac-progress-fill--indet')).toBeNull();
    expect(root().querySelector('.jpi-fill--indet')).toBeNull();
  });

  it('a SUCCEEDED review still shows no pair: the terminal 9/9 backfill is withheld on kind, not on value', async () => {
    // `finalize` forces completedChunks to totalChunks on success, so a kind-blind reader would print
    // "9/9" on a finished review even though nothing else in the run ever showed a count.
    await setupKind('review');
    poll$.next(progress({ status: 'Succeeded', completedChunks: 7, totalChunks: 9, message: 'done' }));
    fixture.detectChanges();

    expect(countsPairs()).toEqual({ dialog: null, inline: null, activityCenter: null });
    expect(ariaPercents()).toEqual({ dialog: '100', inline: '100', activityCenter: '100' });
  });
});
