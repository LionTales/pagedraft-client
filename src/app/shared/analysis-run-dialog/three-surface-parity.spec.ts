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
import { JobRegistryService } from '../../core/services/job-registry.service';
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

describe('three-surface parity over ONE registry job (Wave 1d c2)', () => {
  let fixture: ComponentFixture<ThreeSurfaceHostComponent>;
  let host: ThreeSurfaceHostComponent;
  let registry: JobRegistryService;
  /** The ONE progress channel behind the real registry. Every number on screen originates here. */
  let poll$: Subject<AnalysisProgressDto>;

  const root = () => fixture.nativeElement as HTMLElement;

  /** The percent each surface is CURRENTLY telling a screen reader. */
  function ariaPercents(): { dialog: string | null; inline: string | null; activityCenter: string | null } {
    return {
      dialog: root().querySelector('.rd-progress-track')?.getAttribute('aria-valuenow') ?? null,
      inline: root().querySelector('.jpi-track')?.getAttribute('aria-valuenow') ?? null,
      activityCenter: root().querySelector('.ac-progress-track')?.getAttribute('aria-valuenow') ?? null,
    };
  }

  /** The percent each surface is CURRENTLY showing a sighted user. */
  function readoutPercents(): { dialog: string | null; inline: string | null; activityCenter: string | null } {
    const text = (sel: string) => root().querySelector(sel)?.textContent?.trim() ?? null;
    return {
      dialog: text('.rd-progress-percent'),
      inline: text('.jpi-percent'),
      activityCenter: text('.ac-progress-percent'),
    };
  }

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

    // Open the Activity Center panel so its row is actually rendered. Click the real bell rather than
    // calling togglePanel(): the Activity Center is OnPush, so only a bound event marks it dirty.
    (root().querySelector('.ac-bell') as HTMLButtonElement).click();
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
