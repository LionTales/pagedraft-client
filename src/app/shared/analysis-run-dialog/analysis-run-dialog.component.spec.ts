/**
 * Wave 1d: AnalysisRunDialogComponent spec.
 *
 * Covers the d1 contract:
 *  - hidden when not open
 *  - (a) STARTING: indeterminate bar, no aria-valuenow, status text from the raw stream, NO minimize
 *  - (a) -> (b) on 'job-started' + the registry resolving the job; minimize appears
 *  - (b) percent + message TRACK the registry (not the raw 'progress' events, which are ignored)
 *  - (b) determinate markup mirrors the Activity Center's aria contract
 *  - (b) -> (c) purely off the registry reporting a terminal status
 *  - (a) -> (c) off sync-result / error when no job was ever started
 *  - the sync-embedded result.jobId is NEVER handed to the registry (the false-FAILED trap)
 *  - terminal resolves EXACTLY ONCE (a later raw event cannot flip it)
 *  - (c) with NO percent renders an inert bar, not the pulsing indeterminate one, and is not a
 *    progressbar at all (c05); (a)/(b) with no percent still pulse
 *  - minimize emits the c2 seam and closes; close in (a)/(c) does NOT emit minimize; no cancel exists
 *  - c03 MODALITY: the card is a centred modal in (a)/(b) - backdrop, inert background, focus trap,
 *    aria-modal="true" - and DROPS all of it at (c), where it stays up as a dismissible notice
 *  - Escape is bound on the overlay CONTAINER: while modal it covers every Escape the user can make
 *    (focus is trapped inside), and in the non-modal state (c) it still fires only from inside the
 *    dialog, which is the c04 contract preserved for the state whose premise it was written against
 *  - RTL (Hebrew book) and LTR (English book) both render, with he/en label parity and no em-dash
 *
 * Uses a BehaviorSubject-backed JobRegistryService stub whose jobById$ mirrors the real selector; the
 * real root service (and its five transitive deps) is NOT injected.
 */
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, NEVER, Observable, Subject, Subscription } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import {
  AnalysisRunDialogComponent,
  RUN_DIALOG_LABELS_EN,
  RUN_DIALOG_LABELS_HE,
  RunDialogMinimizeEvent,
} from './analysis-run-dialog.component';
import { MINIMIZE_GHOST_CLASS, flyToActivityCenter } from './minimize-flight';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import {
  AnalysisRunContext,
  AnalysisRunEvent,
  AnalysisRunOrchestrationService,
  RUN_START_BUDGET_MS,
} from '../../core/services/analysis-run-orchestration.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { AnalysisResultDto } from '../../core/models/analysis';
import { RunStringKey, runString } from '../../core/i18n/run-strings';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The detail line the dialog COMPOSES for a tracked/terminal job (c02), in Hebrew book chrome.
 *
 * These assertions used to read `job.message` straight back out of the fixture, which made them
 * tautological about localization: the spec asserted the dialog echoed whatever English prose the
 * backend sent. It now asserts the composed localized sentence, and `type` is the job's own localized
 * TITLE, so two different jobs still produce two different messages.
 */
function detail(key: RunStringKey, type: string): string {
  return runString('he', key, { type });
}

function makeJob(overrides: Partial<TrackedJob> = {}): TrackedJob {
  const now = new Date().toISOString();
  return {
    id: 'JOB-1',
    kind: 'proofread',
    bookId: 'book-1',
    scopeLabel: 'פרק',
    titleHe: 'הגהה',
    titleEn: 'Proofread',
    status: 'running',
    percent: null,
    // c04 defaults: NO chunk shape and NO throughput observations, so the baseline fixture renders
    // neither counts nor an ETA. Every c04 spec opts in explicitly, which keeps the pre-c04 assertions
    // (the composed detail sentence, the parity of the percent) meaning exactly what they meant before.
    completedChunks: null,
    totalChunks: null,
    chunkClock: EMPTY_CHUNK_CLOCK,
    message: '',
    startedAt: now,
    updatedAt: now,
    chapterId: 'ch-1',
    ...overrides,
  };
}

function makeResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
  return {
    id: 'res-1',
    chapterId: 'ch-1',
    type: 'Proofread',
    resultText: 'ok',
    createdAt: new Date().toISOString(),
    analysisType: 'Proofread',
    ...overrides,
  };
}

/**
 * Stub for JobRegistryService. `jobById$` mirrors the real selector (find by id, null when absent,
 * distinctUntilChanged) and records every id it was asked for, so a spec can assert that an id the
 * dialog must NEVER trust was never even looked up.
 */
class JobRegistryStub {
  private readonly subject = new BehaviorSubject<TrackedJob[]>([]);
  readonly jobs$ = this.subject.asObservable();
  readonly requestedIds: string[] = [];

  jobById$(jobId: string): Observable<TrackedJob | null> {
    this.requestedIds.push(jobId);
    return this.jobs$.pipe(
      map(jobs => jobs.find(j => j.id === jobId) ?? null),
      distinctUntilChanged(),
    );
  }

  setJobs(jobs: TrackedJob[]): void {
    this.subject.next(jobs);
  }
}

describe('AnalysisRunDialogComponent (Wave 1d)', () => {
  let fixture: ComponentFixture<AnalysisRunDialogComponent>;
  let component: AnalysisRunDialogComponent;
  let registry: JobRegistryStub;
  let events$: Subject<AnalysisRunEvent>;

  /** Open the dialog for a fresh run (the false -> true transition is the run boundary). */
  function startRun(opts: { language?: string; analysisType?: string } = {}): void {
    fixture.componentRef.setInput('bookLanguage', opts.language ?? 'he');
    fixture.componentRef.setInput('analysisType', opts.analysisType ?? 'Proofread');
    fixture.componentRef.setInput('runEvents', events$);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  }

  function emit(event: AnalysisRunEvent): void {
    events$.next(event);
    fixture.detectChanges();
  }

  function el(selector: string): HTMLElement | null {
    const de = fixture.debugElement.query(By.css(selector));
    return de ? (de.nativeElement as HTMLElement) : null;
  }

  beforeEach(async () => {
    registry = new JobRegistryStub();
    events$ = new Subject<AnalysisRunEvent>();

    await TestBed.configureTestingModule({
      imports: [AnalysisRunDialogComponent],
      providers: [{ provide: JobRegistryService, useValue: registry }],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisRunDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── hidden ─────────────────────────────────────────────────────────────────

  it('renders nothing while closed', () => {
    expect(component.state).toBe('hidden');
    expect(el('.rd-card')).toBeNull();
  });

  // ── (a) STARTING ───────────────────────────────────────────────────────────

  describe('state (a) STARTING', () => {
    it('renders the indeterminate bar with NO aria-valuenow and NO minimize button', () => {
      startRun();

      expect(component.state).toBe('starting');
      expect(el('.rd-card')).not.toBeNull();

      const track = el('.rd-progress-track');
      expect(track).not.toBeNull();
      expect(track!.getAttribute('role')).toBe('progressbar');
      // Mirrors the Activity Center: an indeterminate bar emits no ambiguous aria-valuenow.
      expect(track!.hasAttribute('aria-valuenow')).toBeFalse();
      expect(el('.rd-progress-fill--indet')).not.toBeNull();
      expect(el('.rd-progress-percent')).toBeNull();

      // Minimize is ABSENT (not disabled) while nothing is tracked.
      expect(el('.rd-minimize')).toBeNull();
      expect(component.canMinimize).toBeFalse();
      // The dismiss control says "close", never "minimize", here.
      expect(el('.rd-dismiss')!.getAttribute('aria-label')).toBe(RUN_DIALOG_LABELS_HE['close']);
    });

    it('shows the raw status message, falling back to a localized "starting"', () => {
      startRun();
      expect(el('.rd-message')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['starting']);

      emit({ kind: 'status', message: 'Proofread chunked · about 4 parts' });
      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread chunked · about 4 parts');
    });

    it('titles the card from the analysis type before any job is tracked', () => {
      startRun({ language: 'en', analysisType: 'LineEdit' });
      expect(el('.rd-title')!.textContent!.trim()).toBe('Line Edit');
    });
  });

  // ── (a) -> (b) ─────────────────────────────────────────────────────────────

  describe('(a) -> (b) TRACKED', () => {
    it('captures the jobId from job-started and switches once the registry resolves it', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: null })]);

      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(registry.requestedIds).toEqual(['JOB-1']);
      expect(component.state).toBe('tracked');
      expect(el('.rd-minimize')).not.toBeNull();
      expect(el('.rd-dismiss')!.getAttribute('aria-label')).toBe(RUN_DIALOG_LABELS_HE['minimize']);
    });

    it('stays in (a) at ANY elapsed time until job-started arrives (no timeout, no auto-fail)', () => {
      startRun();
      // Many status ticks, no job-started: still (a), still no minimize.
      for (let i = 0; i < 20; i++) emit({ kind: 'status', message: `tick ${i}` });
      expect(component.state).toBe('starting');
      expect(el('.rd-minimize')).toBeNull();

      // A LATE job-started is still a legal (a) -> (b).
      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).toBe('tracked');
    });

    it('minimize is present even while the tracked job has no percent yet', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: null })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(component.percent).toBeNull();
      expect(el('.rd-progress-fill--indet')).not.toBeNull();
      expect(el('.rd-minimize')).not.toBeNull();
    });
  });

  // ── c03: exactly ONE job subscription is live at a time ────────────────────
  //
  // `attachToJob` used to guard only `this.jobId === jobId`, so a second `job-started` carrying a
  // DIFFERENT id opened a SECOND `jobById$` subscription without stopping the first. Both wrote
  // `trackedJob`, so a LATE update for the superseded job overwrote the current one's progress.
  //
  // The registry stub is the real selector's shape (a BehaviorSubject list + find-by-id +
  // distinctUntilChanged), so pushing a new object for JOB-A alone re-emits on A's stream only, which is
  // exactly the emission a torn-down subscription must not receive.
  describe('supersession: attaching to a new job tears down the previous one (c03)', () => {
    it('a LATE update for the superseded job cannot overwrite the current job', () => {
      // Distinct TITLES, not distinct backend prose: the title is what the composed message varies on.
      const jobA = makeJob({ id: 'JOB-A', percent: 20, titleHe: 'הגהה א' });
      const jobB = makeJob({ id: 'JOB-B', percent: 70, titleHe: 'הגהה ב' });
      const jobALate = makeJob({ id: 'JOB-A', percent: 95, titleHe: 'הגהה א' });

      startRun();

      // (1) JOB-A is tracked and drives the card.
      registry.setJobs([jobA]);
      emit({ kind: 'job-started', jobId: 'JOB-A' });
      expect(component.state).toBe('tracked');
      expect(component.percent).toBe(20);
      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('20');
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה א'));

      // (2) A second job-started with a DIFFERENT id supersedes it.
      registry.setJobs([jobA, jobB]);
      emit({ kind: 'job-started', jobId: 'JOB-B' });
      expect(component.percent).toBe(70);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה ב'));

      // (3) A late registry update for the OLD job. `jobB` keeps its identity, so B's stream is silent
      //     (distinctUntilChanged) and only a still-live A subscription could speak here.
      registry.setJobs([jobALate, jobB]);
      fixture.detectChanges();

      // The card still shows B. Before c03 it showed A's 95%.
      expect(component.percent).toBe(70);
      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('70');
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה ב'));
    });

    it('a superseded job going TERMINAL cannot latch the dialog behind the current job', () => {
      const jobA = makeJob({ id: 'JOB-A', percent: 20 });
      const jobB = makeJob({ id: 'JOB-B', percent: 70, titleHe: 'הגהה ב' });

      startRun();
      registry.setJobs([jobA]);
      emit({ kind: 'job-started', jobId: 'JOB-A' });
      registry.setJobs([jobA, jobB]);
      emit({ kind: 'job-started', jobId: 'JOB-B' });
      expect(component.state).toBe('tracked');

      // JOB-A finishes; JOB-B is still running. The dialog is B's, so it must stay in (b).
      registry.setJobs([makeJob({ id: 'JOB-A', percent: 100, status: 'succeeded', message: 'A done' }), jobB]);
      fixture.detectChanges();

      expect(component.state).toBe('tracked');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['running']);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה ב'));
      expect(el('.rd-minimize')).not.toBeNull();
    });

    it('a REPEATED identical job-started is a no-op, NOT a resubscribe', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 30 })]);

      emit({ kind: 'job-started', jobId: 'JOB-1' });
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      // The registry was asked for the id exactly once: the extra events did not open a subscription,
      // and (since jobStop$ is only fired on a real supersession) did not drop the live one either.
      expect(registry.requestedIds).toEqual(['JOB-1']);
      expect(component.state).toBe('tracked');
      expect(component.percent).toBe(30);

      // Still LIVE: a subsequent registry update is still followed.
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 80, message: 'still tracking' })]);
      fixture.detectChanges();
      expect(component.percent).toBe(80);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
    });
  });

  // ── scope label (f03) ─────────────────────────────────────────────────────

  describe('the card names its scope (f03)', () => {
    it('renders NOTHING in state (a), before any job is tracked', () => {
      startRun();
      expect(component.state).toBe('starting');
      expect(el('.rd-scope')).toBeNull();
    });

    it('renders the tracked job\'s scopeLabel once tracked, in state (b)', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', scopeLabel: 'סצנה' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(component.state).toBe('tracked');
      expect(el('.rd-scope')!.textContent!.trim()).toBe('סצנה');
    });

    it('is still present on the terminal card, in state (c)', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', scopeLabel: 'סצנה' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      registry.setJobs([makeJob({ id: 'JOB-1', scopeLabel: 'סצנה', status: 'succeeded', message: 'done' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(el('.rd-scope')!.textContent!.trim()).toBe('סצנה');
    });
  });

  // ── percent tracks the registry ────────────────────────────────────────────

  describe('the percent tracks the registry', () => {
    beforeEach(() => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 20, message: 'Proofread · 1 of 5 completed' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
    });

    it('renders the determinate bar with the Activity Center aria contract', () => {
      const track = el('.rd-progress-track')!;
      expect(track.getAttribute('role')).toBe('progressbar');
      expect(track.getAttribute('aria-valuenow')).toBe('20');
      expect(track.getAttribute('aria-valuemin')).toBe('0');
      expect(track.getAttribute('aria-valuemax')).toBe('100');
      expect(el('.rd-progress-percent')!.textContent!.trim()).toBe('20%');
      expect(el('.rd-progress-fill--det')!.style.width).toBe('20%');
    });

    it('follows a registry update to a new percent and message', () => {
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 60, message: 'Proofread · 3 of 5 completed' })]);
      fixture.detectChanges();

      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('60');
      expect(el('.rd-progress-percent')!.textContent!.trim()).toBe('60%');
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
    });

    it('IGNORES raw "progress" events: the registry is the only source once tracked', () => {
      emit({ kind: 'progress', percent: 95, message: 'stale poll text', rawStatus: 'running' });

      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('20');
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
    });

    it('IGNORES raw "status" events once tracked (the registry owns the message)', () => {
      emit({ kind: 'status', message: 'Running Proofread analysis...' });
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
    });
  });

  // ── (b) -> (c) ─────────────────────────────────────────────────────────────

  describe('(b) -> (c) TERMINAL', () => {
    beforeEach(() => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 60 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
    });

    it('resolves off the registry status alone, pins 100%, and drops the minimize button', () => {
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 60, status: 'succeeded', message: 'done' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(component.percent).toBe(100);
      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('100');
      expect(el('.rd-minimize')).toBeNull();
      expect(el('.rd-dismiss')!.getAttribute('aria-label')).toBe(RUN_DIALOG_LABELS_HE['close']);
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
    });

    it('a failed registry status keeps the last known percent and shows the failed pill', () => {
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 60, status: 'failed', message: 'boom' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(component.percent).toBe(60);
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['failed']);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('runFailed', 'הגהה'));
    });

    it('resolves EXACTLY ONCE: a later raw error cannot flip a succeeded run to failed', () => {
      registry.setJobs([makeJob({ id: 'JOB-1', status: 'succeeded', message: 'done' })]);
      fixture.detectChanges();
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);

      emit({ kind: 'error', message: 'late failure' });
      registry.setJobs([makeJob({ id: 'JOB-1', status: 'failed', message: 'late failure' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('runSucceeded', 'הגהה'));
    });
  });

  // ── (a) -> (c) : the run that never had a trackable job ────────────────────

  describe('(a) -> (c) with no job at all', () => {
    it('a plain sync-result terminates the dialog at 100% with no minimize', () => {
      startRun();
      emit({ kind: 'sync-result', result: makeResult() });

      expect(component.state).toBe('terminal');
      expect(component.percent).toBe(100);
      expect(el('.rd-minimize')).toBeNull();
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
    });

    it('an error terminates the dialog as failed with the error message', () => {
      startRun();
      emit({ kind: 'error', message: 'Analysis failed.' });

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['failed']);
      expect(el('.rd-message')!.textContent!.trim()).toBe('Analysis failed.');
    });

    it('a streaming run terminates on streaming-complete', () => {
      startRun();
      emit({ kind: 'streaming-token', token: 'abc' });
      expect(component.state).toBe('starting');

      emit({ kind: 'streaming-complete', latestResult: makeResult() });
      expect(component.state).toBe('terminal');
    });

    it('NEVER hands the sync-embedded result.jobId to the registry (the false-FAILED trap)', () => {
      startRun();
      // A short chapter the SERVER decided to chunk: the sync response carries a jobId whose progress
      // entry was never seeded, so polling it 404s and would finalize a SUCCESSFUL run as failed.
      emit({ kind: 'sync-result', result: makeResult({ jobId: 'SYNC-EMBEDDED' }) });

      expect(registry.requestedIds).toEqual([]);
      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
    });
  });

  // ── c01: 'run-finished', the panel's own terminal ──────────────────────────
  //
  // The orchestration service produces no event when a run simply STOPS: the panel's ngOnDestroy
  // (triggered by the editor's `@if`) cancels the run, and a rejected pre-run save never starts one. On
  // the sync path there is no registry job to resolve off either, so before c01 the dialog sat in
  // "Starting..." with a live indeterminate bar forever, describing a run that no longer existed.
  //
  // `events$` is a Subject held OPEN across the assertions on purpose: state (a) is asserted while the
  // run is genuinely mid-flight, and only THEN is the terminal pushed. A synchronous of()/throwError()
  // would collapse that window and pass against the bug.
  describe("(a) -> (c) on the panel's 'run-finished' terminal (c01)", () => {
    it('resolves a mid-flight untracked run to canceled, and only AFTER the terminal is pushed', () => {
      startRun();
      emit({ kind: 'status', message: 'Running Proofread analysis...' });

      // Mid-flight: still (a). The bar is live and there is no terminal card.
      expect(component.state).toBe('starting');
      expect(el('.rd-progress-fill--indet')).not.toBeNull();
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['pending']);

      // The panel's run ends with nothing to report (destroyed mid-run / save rejected).
      emit({ kind: 'run-finished' });

      expect(component.state).toBe('terminal');
      // Canceled, NOT succeeded: no result event ever arrived, so there is nothing behind this card.
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['canceled']);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('runCanceled', 'הגהה'));
      // No percent is read off the event: an unknown-progress run stays indeterminate.
      expect(component.percent).toBeNull();
      expect(el('.rd-minimize')).toBeNull();
    });

    it('cannot overwrite a run that already resolved off a real terminal event', () => {
      startRun();
      emit({ kind: 'sync-result', result: makeResult() });
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);

      // On a normal run the panel's terminal ALWAYS arrives after the result event. It must be inert.
      emit({ kind: 'run-finished' });

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
      expect(component.percent).toBe(100);
    });

    // d1 item 6: (b) -> (c) is the registry's call ALONE. A tracked job keeps running server-side after
    // the panel goes away - that is the whole point of the minimize gesture - so the panel's terminal must
    // not resolve its card.
    it('does NOT resolve a TRACKED run: state (b) keeps waiting for the registry', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 40, message: 'Proofread · 2 of 5 completed' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).toBe('tracked');

      // The panel is destroyed mid-run (sub-tab switch) while the job is registry-tracked.
      emit({ kind: 'run-finished' });

      // Still tracked: same percent, same message, minimize still offered.
      expect(component.state).toBe('tracked');
      expect(component.percent).toBe(40);
      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('40');
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
      expect(el('.rd-minimize')).not.toBeNull();

      // The registry, and only the registry, resolves it - and it resolves as SUCCEEDED, which the
      // panel's terminal would have mislabelled as canceled.
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 100, status: 'succeeded', message: 'done' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
    });
  });

  // ── c03: a captured jobId the registry never resolves ─────────────────────
  //
  // "An id was captured" and "the registry owns this run" are two DIFFERENT facts, and the code used to
  // fence every (a) -> (c) arm on the first one. 'job-started' is fanned out to the host - which is what
  // makes this dialog capture the id - whether or not the run reached the registry, because the
  // jobRegistry.track(...) publish sits behind a guard. (c01 moved that publish into
  // AnalysisRunOrchestrationService, ahead of the fan-out, so the ORDER no longer opens the gap; the
  // guard still can.) By then the c01 start budget is already spent, because provesServerAnswered
  // returns true for 'job-started' and that tap runs upstream of every subscriber. A guard that declines
  // therefore left the card modal, indeterminate, with no timer left and every terminal latch switched
  // off: nothing that could still happen would resolve it.
  //
  // The fence is now `registryOwnsRun` (jobId AND a tracked job, i.e. state (b) itself), so the run's own
  // stream resolves the card exactly as it does before any id is captured. No clock was added here.
  //
  // The registry stub is BehaviorSubject-backed and is simply never given a job for JOB-ORPHAN, so
  // jobById$ keeps emitting null - the real shape of a declined track(). `events$` is a Subject held OPEN
  // across the assertions, so state (a) is asserted while the run is genuinely mid-flight rather than
  // collapsed inside a synchronous of().
  describe('a captured jobId the registry never resolves (c03)', () => {
    /** Reach the defect state: the id IS captured, and no registry row ever appears for it. */
    function startedButUntracked(): void {
      startRun();
      emit({ kind: 'job-started', jobId: 'JOB-ORPHAN' });
      expect(registry.requestedIds)
        .withContext('premise: the id really was captured and looked up')
        .toEqual(['JOB-ORPHAN']);
      expect(component.state)
        .withContext('premise: this is NOT state (b) - the registry has no row for this run')
        .toBe('starting');
      expect(el('.rd-minimize'))
        .withContext('premise: there is nothing to minimize into, which is what makes the card blocking')
        .toBeNull();
    }

    it("resolves to canceled on the panel's run-finished, exactly as a never-started run does", () => {
      startedButUntracked();

      emit({ kind: 'run-finished' });

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['canceled']);
      // And the card stops blocking, which is the whole point: the modality is a projection of `state`.
      expect(component.isModal).toBeFalse();
    });

    it("resolves to succeeded on the run's OWN job-result", () => {
      startedButUntracked();

      emit({ kind: 'job-result', result: makeResult() });

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
      expect(component.percent).toBe(100);
    });

    it('resolves to failed on an error from the run stream', () => {
      startedButUntracked();

      emit({ kind: 'error', message: 'boom' });

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['failed']);
    });

    it('is abandoned by result-dropped, closing rather than claiming an outcome', () => {
      startedButUntracked();
      const openChanges: boolean[] = [];
      component.openChange.subscribe(v => openChanges.push(v));

      emit({ kind: 'result-dropped' });

      expect(component.state).toBe('hidden');
      expect(openChanges).toEqual([false]);
    });

    // The fence must not have WIDENED: a genuinely tracked run still belongs to the registry alone
    // (d1 item 6). Same event, same id, the one difference being that a registry row exists.
    it('did not widen the fence: a run the registry DOES own still ignores run-finished', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 40 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).withContext('premise: this one IS state (b)').toBe('tracked');

      emit({ kind: 'run-finished' });

      expect(component.state).toBe('tracked');
      expect(component.percent).toBe(40);
      expect(el('.rd-minimize')).not.toBeNull();
    });
  });

  // ── c06: a result the app DISCARDED must not leave a card claiming "Done" ──
  //
  // On the sync path the card sits in state (a) with no jobId, so a `sync-result` latches
  // succeeded/100%/"Done" (pinned by "a plain sync-result terminates the dialog at 100%" above). But the
  // panel DROPS a result whose captured origin no longer matches the chapter/scene on screen, and under
  // c02's book-scoped contract the card survives the very switch that caused the drop - so the user was
  // shown a green "Done" for suggestions that reached no surface at all (an untracked sync run is never
  // registry-tracked, so it has no Activity Center row and no in-page banner either).
  //
  // The panel now sends `result-dropped` in place of the result event, and the card is ABANDONED rather
  // than resolved: latching anything would be false in both directions ("Done" for a result nothing
  // showed, "Canceled" for a run that actually succeeded and is persisted).
  //
  // `events$` is held OPEN across the assertions so state (a) is asserted while the run is genuinely
  // mid-flight; a synchronous of() would collapse the window this defect lives in.
  describe("a dropped result abandons the card instead of claiming 'Done' (c06)", () => {
    it('closes an UNTRACKED mid-flight card and latches no terminal at all', () => {
      startRun();
      const openChanges: boolean[] = [];
      component.openChange.subscribe(v => openChanges.push(v));
      emit({ kind: 'status', message: 'Running Proofread analysis...' });

      // Mid-flight: the card is up and nothing has resolved.
      expect(component.state).toBe('starting');
      expect(el('.rd-card')).not.toBeNull();

      // The result landed on a chapter the user has left, and the panel threw it away.
      emit({ kind: 'result-dropped' });

      expect(el('.rd-status-pill'))
        .withContext('no card may claim "Done" (or any other outcome) for a result the app discarded')
        .toBeNull();
      expect(el('.rd-card')).toBeNull();
      expect(component.state).toBe('hidden');
      expect(component.percent).toBeNull();
      // Closed through the same two-way `open` channel the dismiss gesture uses, so the host's flag
      // follows the card instead of holding it open forever.
      expect(component.open).toBeFalse();
      expect(openChanges).toEqual([false]);
    });

    it('does NOT touch a TRACKED card: state (b) keeps waiting for the registry (d1 item 6)', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 40, message: 'Proofread · 2 of 5 completed' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).toBe('tracked');

      const openChanges: boolean[] = [];
      component.openChange.subscribe(v => openChanges.push(v));

      // The panel dropped the async job's result as stale-context. The JOB is still running server-side,
      // which is the entire point of the minimize gesture, so the card must stay exactly as it was.
      emit({ kind: 'result-dropped' });

      expect(component.state).toBe('tracked');
      expect(component.percent).toBe(40);
      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
      expect(el('.rd-minimize')).not.toBeNull();
      expect(openChanges).withContext('a live tracked card is never closed by the panel (c02 contract B)').toEqual([]);

      // And the registry, alone, still resolves it.
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 100, status: 'succeeded', message: 'done' })]);
      fixture.detectChanges();
      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
    });

    it('leaves a KEPT result its terminal card (a late drop signal cannot take it away)', () => {
      startRun();
      // The user switched away and back before the result landed, so the origin still matched at arrival
      // and the panel sent the raw result event.
      emit({ kind: 'sync-result', result: makeResult() });
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);

      emit({ kind: 'result-dropped' });

      expect(component.state).toBe('terminal');
      expect(el('.rd-card')).not.toBeNull();
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
      expect(component.percent).toBe(100);
    });
  });

  // ── c05: a terminal card must not pulse an indeterminate bar ───────────────
  //
  // `percent === null` used to mean two different things in one template branch: "unknown, still
  // running" (states (a)/(b)) and "over, and we never learned a number" (state (c)). Both rendered
  // `.rd-progress-fill--indet`, whose SCSS is an INFINITE keyframe animation, so a terminal card pulsed
  // as though the run were still going, directly contradicting the localized "Failed" / "Canceled" pill
  // beside it in the same header - and announced itself to a screen reader as a live task of unknown
  // size (`role="progressbar"` with no `aria-valuenow` IS an indeterminate progressbar in ARIA).
  //
  // The percent getter is deliberately UNCHANGED; only the render is keyed on the state machine.
  describe('a terminal card does not pulse an indeterminate bar (c05)', () => {
    /** What a screen reader and a sighted user get from the progress area, in one shot. */
    function progressBar(): { track: HTMLElement | null; role: string | null; indet: HTMLElement | null } {
      const track = el('.rd-progress-track');
      return { track, role: track?.getAttribute('role') ?? null, indet: el('.rd-progress-fill--indet') };
    }

    // ── the two terminal flavours that reach percent: null ────────────────────

    it('the ERROR terminal (a) -> (c): no pulsing class, and not a progressbar at all', () => {
      startRun();
      emit({ kind: 'error', message: 'Analysis failed.' });

      expect(component.state).toBe('terminal');
      expect(component.percent).toBeNull();
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['failed']);

      const bar = progressBar();
      // The defect: this used to be the pulsing indeterminate fill.
      expect(bar.indet).toBeNull();
      // The aria decision: a finished run with no known percent is not a progressbar.
      expect(bar.role).toBeNull();
      expect(bar.track!.hasAttribute('aria-valuenow')).toBeFalse();
      // The bar is kept for layout only, and says so.
      expect(bar.track!.classList.contains('rd-progress-track--ended')).toBeTrue();
      expect(bar.track!.getAttribute('aria-hidden')).toBe('true');
      expect(bar.track!.children.length).toBe(0);
    });

    it("c01's 'run-finished' -> canceled terminal (a) -> (c): same, no pulse and no progressbar", () => {
      startRun();
      emit({ kind: 'status', message: 'Running Proofread analysis...' });
      // Mid-flight it really IS pulsing - so the assertion below is about the terminal, not about the
      // element never existing.
      expect(el('.rd-progress-fill--indet')).not.toBeNull();

      // Every panel unmount mid-run latches this terminal (an ordinary Edit-help sub-tab switch).
      emit({ kind: 'run-finished' });

      expect(component.state).toBe('terminal');
      expect(component.percent).toBeNull();
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['canceled']);

      const bar = progressBar();
      expect(bar.indet).toBeNull();
      expect(bar.role).toBeNull();
      expect(bar.track!.classList.contains('rd-progress-track--ended')).toBeTrue();
    });

    it('a REGISTRY terminal with no percent (b) -> (c) is inert too', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: null })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).toBe('tracked');
      expect(el('.rd-progress-fill--indet')).not.toBeNull();

      registry.setJobs([makeJob({ id: 'JOB-1', percent: null, status: 'failed', message: 'boom' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(component.percent).toBeNull();
      expect(progressBar().indet).toBeNull();
      expect(progressBar().role).toBeNull();
    });

    // ── the still-running states keep the pulse ───────────────────────────────

    it('state (a) with a null percent DOES keep the indeterminate treatment', () => {
      startRun();

      expect(component.state).toBe('starting');
      expect(component.percent).toBeNull();
      const bar = progressBar();
      expect(bar.indet).not.toBeNull();
      expect(bar.role).toBe('progressbar');
      expect(bar.track!.hasAttribute('aria-valuenow')).toBeFalse();
      expect(bar.track!.classList.contains('rd-progress-track--ended')).toBeFalse();
    });

    it('state (b) with a null percent DOES keep the indeterminate treatment', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: null })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(component.state).toBe('tracked');
      expect(component.percent).toBeNull();
      const bar = progressBar();
      expect(bar.indet).not.toBeNull();
      expect(bar.role).toBe('progressbar');
      expect(bar.track!.classList.contains('rd-progress-track--ended')).toBeFalse();
    });

    // ── the determinate branch is untouched (its aria contract is three-surface parity) ──

    it('a terminal card that DOES know its percent keeps the full progressbar contract', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 60 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 60, status: 'failed', message: 'boom' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(component.percent).toBe(60);
      const track = el('.rd-progress-track')!;
      expect(track.getAttribute('role')).toBe('progressbar');
      expect(track.getAttribute('aria-valuenow')).toBe('60');
      expect(track.getAttribute('aria-valuemin')).toBe('0');
      expect(track.getAttribute('aria-valuemax')).toBe('100');
      expect(el('.rd-progress-percent')!.textContent!.trim()).toBe('60%');
      expect(el('.rd-progress-fill--indet')).toBeNull();
    });
  });

  // ── minimize / close semantics ─────────────────────────────────────────────

  describe('minimize and close semantics (no cancel exists)', () => {
    it('minimize emits the jobId + live origin rect and closes the dialog', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 40 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      el('.rd-minimize')!.click();
      fixture.detectChanges();

      expect(minimized.length).toBe(1);
      expect(minimized[0].jobId).toBe('JOB-1');
      // The rect is measured while the card is still mounted, so the animation owner has geometry.
      expect(minimized[0].originRect).not.toBeNull();
      expect(openChanges).toEqual([false]);
      expect(el('.rd-card')).toBeNull();
    });

    it('the header dismiss IS a minimize while a job is tracked (closing never cancels)', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));

      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      el('.rd-dismiss')!.click();
      fixture.detectChanges();

      expect(minimized.map(m => m.jobId)).toEqual(['JOB-1']);
    });

    it('closing in state (a) dismisses WITHOUT emitting a minimize (nothing is tracked)', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      el('.rd-dismiss')!.click();
      fixture.detectChanges();

      expect(minimized).toEqual([]);
      expect(openChanges).toEqual([false]);
      expect(el('.rd-card')).toBeNull();
    });

    it('closing in state (c) dismisses WITHOUT emitting a minimize', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));

      startRun();
      emit({ kind: 'sync-result', result: makeResult() });
      el('.rd-dismiss')!.click();
      fixture.detectChanges();

      expect(minimized).toEqual([]);
      expect(el('.rd-card')).toBeNull();
    });

    it('offers no cancel control at all (there is no cancel endpoint to call)', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      const buttons = fixture.debugElement.queryAll(By.css('button'))
        .map(de => (de.nativeElement as HTMLElement).className);
      expect(buttons.sort()).toEqual(['rd-dismiss', 'rd-minimize']);
    });

    it('reopening for a NEW run resets the state machine', () => {
      startRun();
      emit({ kind: 'error', message: 'first run failed' });
      expect(component.state).toBe('terminal');

      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();

      expect(component.state).toBe('starting');
      expect(el('.rd-message')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['starting']);
    });
  });

  // ── Escape: scoped to the DIALOG, on the overlay container (c04, re-scoped by c03) ─────────────
  //
  // The handler was once `@HostListener('document:keydown.escape')`, so the card claimed the global
  // Escape key while the user was expected to keep working in the Syncfusion editor behind it - and
  // Syncfusion uses Escape for its own dismiss gestures - so an Escape pressed in the editor closed, or
  // in state (b) MINIMIZED with the fly-to-bell animation, a card that never had focus. c04 removed it.
  //
  // c03 made the card MODAL while the run is live, which moves the binding from `.rd-card` to the
  // overlay CONTAINER (`tabindex="-1"`), for a concrete reason rather than a stylistic one: focus-on-
  // open lands on the container, which is NOT inside `.rd-card`, so a `.rd-card` binding would drop the
  // FIRST Escape of every modal run. On the container the scope is still structural - keydown BUBBLES,
  // so the handler runs only when focus is somewhere inside this dialog - and while modal that is every
  // Escape the user can generate, because the focus trap keeps focus inside.
  //
  // In state (c) the modality is gone and c04's original premise (a live editor behind a non-blocking
  // card) is true again, so the outside-focus cases below assert exactly what c04 asserted.
  //
  // These specs drive the real DOM path: they focus an element and dispatch a bubbling KeyboardEvent
  // from it. The inside-focus cases and the outside-focus cases share `pressEscape`, so a broken
  // dispatch would fail the inside cases rather than silently greening the outside ones.
  describe('Escape is scoped to the dialog (c04, re-scoped by c03)', () => {
    let outsider: HTMLButtonElement;

    /** Dispatch a REAL bubbling Escape keydown from `target`, exactly as the browser would. */
    function pressEscape(target: Element): void {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
    }

    /** A focusable element OUTSIDE the card, standing in for the Syncfusion editor behind it. */
    beforeEach(() => {
      outsider = document.createElement('button');
      outsider.type = 'button';
      outsider.id = 'outside-the-card';
      document.body.appendChild(outsider);
    });

    afterEach(() => {
      outsider.remove();
    });

    function trackJob(): void {
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 40 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
    }

    // ── focus INSIDE the card: the existing semantics are untouched ───────────

    it('state (a): Escape from a focused control inside the card dismisses, with NO minimize', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      const dismiss = el('.rd-dismiss')!;
      dismiss.focus();
      // The card really can hold focus - this is what keeps the scoped handler reachable.
      expect(document.activeElement).toBe(dismiss);

      pressEscape(dismiss);

      expect(el('.rd-card')).toBeNull();
      expect(openChanges).toEqual([false]);
      expect(minimized).toEqual([]);
    });

    it('state (b): Escape from inside the card MINIMIZES, emitting the live origin rect', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      trackJob();
      expect(component.state).toBe('tracked');

      const minimizeBtn = el('.rd-minimize')!;
      minimizeBtn.focus();
      expect(document.activeElement).toBe(minimizeBtn);

      pressEscape(minimizeBtn);

      // Still a real minimize, not a plain hide: the flight seam fires with live geometry.
      expect(minimized.length).toBe(1);
      expect(minimized[0].jobId).toBe('JOB-1');
      expect(minimized[0].originRect).not.toBeNull();
      expect(openChanges).toEqual([false]);
      expect(el('.rd-card')).toBeNull();
    });

    it('state (c): Escape from inside the card dismisses, with NO minimize', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));

      startRun();
      emit({ kind: 'sync-result', result: makeResult() });
      expect(component.state).toBe('terminal');

      const dismiss = el('.rd-dismiss')!;
      dismiss.focus();
      pressEscape(dismiss);

      expect(el('.rd-card')).toBeNull();
      expect(minimized).toEqual([]);
    });

    // ── the FIRST Escape of a modal run: the reason the binding is on the container ──

    it('state (a): Escape from the element focus LANDS on when the modal opens dismisses it', () => {
      const openChanges: boolean[] = [];
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();

      // Focus-on-open puts focus on the overlay CONTAINER, which is outside `.rd-card`. A `.rd-card`
      // binding would ignore this Escape entirely - that is the regression this assertion pins.
      const overlay = el('.rd-overlay')!;
      expect(document.activeElement).toBe(overlay);

      pressEscape(document.activeElement!);

      expect(el('.rd-card')).toBeNull();
      expect(openChanges).toEqual([false]);
    });

    // ── focus OUTSIDE the dialog ──────────────────────────────────────────────
    //
    // While MODAL there is no such thing as "focus outside": the background is inert, so the outsider
    // cannot even take focus. The c04 defect (an Escape from the editor minimizing the card) is asserted
    // in the state where it is still reachable - the non-modal terminal card.

    it('states (a)/(b): the background is inert, so an outside element cannot even take focus', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      trackJob();
      expect(component.state).toBe('tracked');

      expect(outsider.hasAttribute('inert')).toBeTrue();
      outsider.focus();
      expect(document.activeElement).not.toBe(outsider);

      pressEscape(outsider);

      expect(el('.rd-card')).not.toBeNull();
      expect(component.open).toBeTrue();
      expect(component.state).toBe('tracked');
      expect(openChanges).toEqual([]);
      // The fly-to-bell animation must NOT play out of nowhere.
      expect(minimized).toEqual([]);
    });

    it('state (c): Escape pressed OUTSIDE the non-modal card leaves it open (the c04 contract)', () => {
      const openChanges: boolean[] = [];
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      emit({ kind: 'error', message: 'boom' });
      expect(component.state).toBe('terminal');

      // The modality dropped, so the page is live again and focus really can be elsewhere - which is
      // precisely the situation c04 was written for: the user is back in the Syncfusion editor.
      expect(outsider.hasAttribute('inert')).toBeFalse();
      outsider.focus();
      expect(document.activeElement).toBe(outsider);

      pressEscape(outsider);

      expect(el('.rd-card')).not.toBeNull();
      expect(component.open).toBeTrue();
      expect(openChanges).toEqual([]);
    });
  });

  // ── c03: modal while the run is LIVE, non-modal once it is over ────────────
  //
  // The product decision, received from the user on 2026-08-03: the dialog BLOCKS in states (a) and (b)
  // and stops blocking at (c), where the card stays up as a dismissible notice. Every assertion below is
  // about the MECHANISM (the backdrop element, the `inert` attribute, `aria-modal`, `document.
  // activeElement`), never about appearance, so none of it can be satisfied by a screenshot.
  //
  // The transition test is the load-bearing one: a suite that only covers dismiss stays green while the
  // focus trap survives into the non-modal state, which is the specific bug this decision creates.
  describe('modality (c03)', () => {
    /** A focusable element OUTSIDE the dialog: the background whose inertness is under test. */
    let outsider: HTMLButtonElement;

    beforeEach(() => {
      outsider = document.createElement('button');
      outsider.type = 'button';
      outsider.id = 'background-control';
      outsider.textContent = 'background';
      document.body.appendChild(outsider);
    });

    afterEach(() => outsider.remove());

    function trackJob(percent: number | null = 40): void {
      registry.setJobs([makeJob({ id: 'JOB-1', percent })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
    }

    /** Drive the (b) -> (c) transition the way the app does: the REGISTRY reports a terminal status. */
    function finishJob(): void {
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 100, status: 'succeeded' })]);
      fixture.detectChanges();
    }

    /** Dispatch a real bubbling Tab keydown from `target`; returns the event so the spec can read it. */
    function pressTab(target: Element, shift = false): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    // ── the backdrop ────────────────────────────────────────────────────────

    it('renders the backdrop in (a) and in (b), and REMOVES the element in (c)', () => {
      startRun();
      expect(el('.rd-backdrop')).withContext('state (a)').not.toBeNull();

      trackJob();
      expect(component.state).toBe('tracked');
      expect(el('.rd-backdrop')).withContext('state (b)').not.toBeNull();

      finishJob();
      expect(component.state).toBe('terminal');
      // Removed, not faded: an invisible scrim would go on eating every click on the page.
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.rd-backdrop').length)
        .withContext('state (c) must have NO backdrop element at all')
        .toBe(0);
      // The card itself is still up: dropping the modality is not closing the dialog.
      expect(el('.rd-card')).not.toBeNull();
    });

    // ── background inertness ────────────────────────────────────────────────

    it('makes the background inert while modal and live again in (c)', () => {
      startRun();
      expect(outsider.hasAttribute('inert')).withContext('state (a)').toBeTrue();

      trackJob();
      expect(outsider.hasAttribute('inert')).withContext('state (b)').toBeTrue();

      finishJob();
      expect(outsider.hasAttribute('inert')).withContext('state (c)').toBeFalse();
    });

    it('never marks its OWN backdrop or overlay inert (the walk is anchored on the HOST)', () => {
      // The anchor is load-bearing, not a detail: `.rd-backdrop` and `.rd-overlay` are SIBLINGS inside
      // the component host, so a walk anchored on the overlay marks the dialog's own scrim inert and
      // backdrop-click dismissal silently stops working. The existing backdrop-click spec cannot catch
      // that - a programmatic `.click()` fires on an inert element just the same - so assert the
      // attribute directly. See the anchoring note in `modal-a11y.ts`.
      startRun();
      trackJob();

      expect(el('.rd-backdrop')!.hasAttribute('inert'))
        .withContext('an inert scrim swallows nothing and dismisses nothing')
        .toBeFalse();
      expect(el('.rd-overlay')!.hasAttribute('inert')).toBeFalse();
      expect(el('.rd-card')!.hasAttribute('inert')).toBeFalse();
      // ...while the background really is inert, so this is not vacuous.
      expect(outsider.hasAttribute('inert')).toBeTrue();
    });

    it('leaves nothing inert behind when the HOST closes it (the editor context reset)', () => {
      // The editor's `ngDoCheck` reconcile writes `runDialogOpen = false` on a book change. That is a
      // different path from `dismiss()` - it comes in through `ngOnChanges` - and it must release too,
      // or a background context switch could leave the whole app inert with no card on screen.
      startRun();
      expect(outsider.hasAttribute('inert')).toBeTrue();

      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();

      expect(el('.rd-card')).toBeNull();
      expect(outsider.hasAttribute('inert')).toBeFalse();
    });

    it('leaves nothing inert behind when the dialog is dismissed from state (a)', () => {
      startRun();
      expect(outsider.hasAttribute('inert')).toBeTrue();

      component.dismiss();
      fixture.detectChanges();

      expect(outsider.hasAttribute('inert')).toBeFalse();
    });

    // ── aria-modal ──────────────────────────────────────────────────────────

    it('claims aria-modal="true" only while it really is modal', () => {
      startRun();
      expect(el('.rd-overlay')!.getAttribute('aria-modal')).withContext('state (a)').toBe('true');

      trackJob();
      expect(el('.rd-overlay')!.getAttribute('aria-modal')).withContext('state (b)').toBe('true');

      finishJob();
      // A card that no longer traps focus must not keep claiming that it does.
      expect(el('.rd-overlay')!.getAttribute('aria-modal')).withContext('state (c)').toBe('false');
    });

    // ── focus: in on open, trapped while modal, restored when the modality drops ──

    it('moves focus into the dialog when the modal opens', () => {
      outsider.focus();
      expect(document.activeElement).toBe(outsider);

      startRun();

      expect(document.activeElement).toBe(el('.rd-overlay'));
    });

    it('traps Tab inside the card while modal: the last control wraps to the first', () => {
      startRun();
      trackJob();

      const focusables = Array.from(
        el('.rd-card')!.querySelectorAll<HTMLElement>('button'),
      );
      expect(focusables.length).withContext('state (b) renders dismiss + minimize').toBe(2);

      const last = focusables[focusables.length - 1];
      last.focus();
      const event = pressTab(last);

      expect(event.defaultPrevented).withContext('the browser default must be suppressed').toBeTrue();
      expect(document.activeElement).toBe(focusables[0]);
    });

    it('traps Shift+Tab inside the card while modal: the first control wraps to the last', () => {
      startRun();
      trackJob();

      const focusables = Array.from(el('.rd-card')!.querySelectorAll<HTMLElement>('button'));
      // Non-vacuity, mirroring the forward-Tab spec: with only ONE control in the card, first === last
      // and "wraps to the last" is trivially true, so this spec would pass on a dialog stuck in state
      // (a). It really did, under a source mutation that stopped the registry resolving the job.
      expect(focusables.length).withContext('state (b) renders dismiss + minimize').toBe(2);
      const first = focusables[0];
      first.focus();
      const event = pressTab(first, true);

      expect(event.defaultPrevented).toBeTrue();
      expect(document.activeElement).toBe(focusables[focusables.length - 1]);
    });

    it('RELEASES the trap and RESTORES focus at the (b) -> (c) transition, not only on dismiss', () => {
      outsider.focus();
      startRun();
      trackJob();
      // Focus is genuinely inside the modal before the transition, or the restore proves nothing.
      expect(el('.rd-overlay')!.contains(document.activeElement)).toBeTrue();

      finishJob();

      // 1. focus went back to whatever had it before the dialog opened...
      expect(document.activeElement)
        .withContext('a user left focused inside a card that is no longer modal is trapped')
        .toBe(outsider);
      // 2. ...and Tab is no longer intercepted, so the keyboard can leave the card.
      const dismiss = el('.rd-dismiss')!;
      dismiss.focus();
      const event = pressTab(dismiss);
      expect(event.defaultPrevented)
        .withContext('a trap that outlives the modality is the bug this decision creates')
        .toBeFalse();
    });

    it('restores focus on dismiss from state (a)', () => {
      outsider.focus();
      startRun();
      expect(document.activeElement).not.toBe(outsider);

      component.dismiss();
      fixture.detectChanges();

      expect(document.activeElement).toBe(outsider);
    });

    // ── minimize + backdrop click ───────────────────────────────────────────

    it('minimize still emits a LIVE rect, and the background is already live when it fires', () => {
      const seen: { rect: DOMRect | null; backgroundInert: boolean }[] = [];
      component.minimizeRequested.subscribe(e =>
        seen.push({ rect: e.originRect, backgroundInert: outsider.hasAttribute('inert') }),
      );

      startRun();
      trackJob();
      el('.rd-minimize')!.click();
      fixture.detectChanges();

      expect(seen.length).toBe(1);
      expect(seen[0].rect).not.toBeNull();
      // A CENTRED card still measures: the flight reads the card's real box, not a hardcoded corner.
      expect(seen[0].rect!.width).toBeGreaterThan(0);
      expect(seen[0].rect!.height).toBeGreaterThan(0);
      // The flight must play over a page that is already usable.
      expect(seen[0].backgroundInert)
        .withContext('the background must be released BEFORE the fly-to-bell flight')
        .toBeFalse();
      expect(el('.rd-card')).toBeNull();
    });

    it('a backdrop click in (b) minimizes, exactly as the dismiss control does', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));

      startRun();
      trackJob();
      el('.rd-backdrop')!.click();
      fixture.detectChanges();

      expect(minimized.length).toBe(1);
      expect(minimized[0].jobId).toBe('JOB-1');
      expect(el('.rd-card')).toBeNull();
    });

    // ── focus CONTAINMENT while modal (c01) ─────────────────────────────────
    //
    // The defect these pin was invisible to this fixture and was found in the browser: with the modal
    // fully engaged (backdrop up, aria-modal="true", 25 elements inert) `document.activeElement` was
    // Syncfusion's `iframe.e-de-text-target`, outside the overlay and inside the inert subtree. From
    // there neither the Escape binding nor the Tab cycle - both on `.rd-overlay` - could fire.
    //
    // The fixture cannot host Syncfusion, so these DRIVE THE MECHANISM instead of simulating the editor.
    // The steal is staged with an element appended to `<body>` AFTER the modal engaged, which is both a
    // faithful stand-in (it is genuinely not inert, exactly as the iframe's inner document is not) and a
    // second contract in its own right: `applyBackgroundInert` is a one-shot snapshot, so anything that
    // arrives later is never marked, and focus containment is the layer that covers it.

    /** A focusable element that arrives AFTER the inert walk ran, so the walk never marked it. */
    let latecomers: HTMLElement[] = [];
    function addLateOutsider(id: string): HTMLButtonElement {
      const late = document.createElement('button');
      late.type = 'button';
      late.id = id;
      late.textContent = id;
      document.body.appendChild(late);
      latecomers.push(late);
      return late;
    }
    afterEach(() => {
      for (const late of latecomers) late.remove();
      latecomers = [];
    });

    it('pulls focus BACK into the dialog when something outside steals it while modal', () => {
      startRun();
      trackJob();
      expect(el('.rd-overlay')!.contains(document.activeElement))
        .withContext('focus starts inside, or the steal proves nothing')
        .toBeTrue();

      const late = addLateOutsider('late-background-control');
      // Not vacuous in the other direction either: this element really CAN take focus, because the
      // inert walk had already run when it was appended.
      expect(late.hasAttribute('inert'))
        .withContext('the one-shot inert walk cannot have marked an element that did not exist yet')
        .toBeFalse();

      late.focus();

      expect(document.activeElement)
        .withContext('a modal whose focus can be taken has no reachable Escape and no Tab cycle')
        .toBe(el('.rd-overlay'));
    });

    it('re-asserts only ONCE per steal: it cannot ping-pong with itself', () => {
      startRun();
      trackJob();
      const overlay = el('.rd-overlay')!;
      // Installed AFTER engage, so the focus-on-open call is not counted.
      const focusSpy = spyOn(overlay, 'focus').and.callThrough();

      addLateOutsider('late-loop-control').focus();

      expect(focusSpy.calls.count())
        .withContext('moving focus fires focusin again; the destination guard must stop the cycle')
        .toBe(1);
    });

    it('stops containing focus in state (c), where focus is meant to be free to leave', () => {
      startRun();
      trackJob();
      finishJob();
      expect(component.state).toBe('terminal');

      // `outsider` is live again in (c) - the same element the inertness spec uses - so this is the
      // real background, not a latecomer.
      outsider.focus();

      expect(document.activeElement)
        .withContext('the non-modal terminal card must not hold the keyboard hostage')
        .toBe(outsider);
    });

    it('is already released when minimize() emits, so it cannot fight the fly-to-bell flight', () => {
      const observed: { active: string | null }[] = [];
      const late = addLateOutsider('late-minimize-control');
      component.minimizeRequested.subscribe(() => {
        // Inside the emit handler: the flight owner is about to move focus/DOM around, and the modality
        // (inert AND focus containment) is documented as already released by this point.
        late.focus();
        observed.push({ active: document.activeElement ? document.activeElement.id : null });
      });

      startRun();
      trackJob();
      el('.rd-minimize')!.click();
      fixture.detectChanges();

      expect(observed.length).toBe(1);
      expect(observed[0].active)
        .withContext('containment must be gone BEFORE minimizeRequested is emitted, not after')
        .toBe('late-minimize-control');

      // ...and it stays gone once the card is down.
      const after = addLateOutsider('after-minimize-control');
      after.focus();
      expect(document.activeElement).toBe(after);
    });

    it('leaves no document listener behind after the dialog is destroyed', () => {
      startRun();
      trackJob();

      fixture.destroy();

      const late = addLateOutsider('late-after-destroy');
      late.focus();
      expect(document.activeElement)
        .withContext('a destroyed dialog that still grabs focus would break the whole page')
        .toBe(late);
    });
  });

  // ── c01: the bounded START budget, and the escape affordance in state (a) ──
  //
  // THE DEFECT, observed live by the user on 2026-08-03: state (a) is modal, indeterminate and has no
  // minimize, and nothing bounded how long it could last. With a server that accepted the connection and
  // never answered, the card sat there with a pulsing bar and the localized starting message while the
  // whole app stayed behind an `inert` background - reported as "endless wait, no progress, no button to
  // dismiss" (a dismiss control WAS on screen; it was a bare glyph and did not read as one).
  //
  // These specs drive the REAL production guard: the budget lives on AnalysisRunOrchestrationService, so
  // they construct that service over never-answering HTTP stubs and pump its output into the dialog the
  // way the panel and the editor do. A dialog-only test with a hand-made 'error' event would prove only
  // that the dialog can latch a terminal, which it already could - the thing under test is that the
  // escape ARRIVES, and that it arrives through the one channel the dialog already listens on.
  //
  // Every assertion about the release is about the MECHANISM (aria-modal, the backdrop ELEMENT, the
  // `inert` attribute count), per the c03 precedent: a card that merely LOOKS unblocked is the bug.
  describe('the bounded start budget releases state (a) (c01)', () => {
    /** A run context shaped like the panel's `buildRunContext()` output. */
    function runContext(overrides: Partial<AnalysisRunContext> = {}): AnalysisRunContext {
      return {
        bookId: 'book-1',
        chapterId: 'ch-1',
        sceneId: null,
        selectedAnalysisType: 'Proofread',
        language: 'he',
        // Short enough to take the SYNC route, which is the route the reported hang took.
        documentText: 'מילה אחת שתיים שלוש',
        ...overrides,
      };
    }

    /** The real service over HTTP stubs that never answer: the reproduced hang, in a test. */
    function orchestrationThatNeverAnswers(
      overrides: Partial<Record<'run' | 'startAsync', () => Observable<never>>> = {},
    ): AnalysisRunOrchestrationService {
      return new AnalysisRunOrchestrationService(
        { run: () => NEVER, startAsync: () => NEVER, getByJob: () => NEVER, ...overrides } as unknown as AnalysisService,
        { pollProgress: () => NEVER } as unknown as AnalysisProgressService,
        // c01: the service writes the registry on `job-started`. This describe drives `runAnalysisAfterSave`
        // (not `startRun`), so nothing here ever reaches that write; the stub is what makes the
        // constructor satisfiable without dragging the real root registry and its five HTTP deps in.
        { track: () => { /* no run here ever dispatches */ } } as unknown as JobRegistryService,
      );
    }

    /** Open the dialog on `hot`, then start the real run and pump its events into it. */
    function startRealRun(
      service: AnalysisRunOrchestrationService,
      hot: Subject<AnalysisRunEvent>,
      ctx: AnalysisRunContext,
    ): Subscription {
      fixture.componentRef.setInput('bookLanguage', ctx.language);
      fixture.componentRef.setInput('analysisType', ctx.selectedAnalysisType);
      fixture.componentRef.setInput('runEvents', hot);
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      const sub = service.runAnalysisAfterSave(ctx).subscribe(e => hot.next(e));
      fixture.detectChanges();
      return sub;
    }

    it('latches a terminal and DROPS the modality when the budget expires', fakeAsync(() => {
      const warn = spyOn(console, 'warn');
      const hot = new Subject<AnalysisRunEvent>();
      const sub = startRealRun(orchestrationThatNeverAnswers(), hot, runContext());

      // Precondition: this really is the trap. Blocking, indeterminate, no minimize.
      expect(component.state).toBe('starting');
      expect(el('.rd-backdrop')).withContext('state (a) is modal').not.toBeNull();
      expect(el('.rd-progress-fill--indet')).not.toBeNull();
      expect(document.querySelectorAll('[inert]').length)
        .withContext('the background really is inert, so the release below is not vacuous')
        .toBeGreaterThan(0);

      tick(RUN_START_BUDGET_MS - 1);
      fixture.detectChanges();
      expect(component.state)
        .withContext('one millisecond short of the budget the run is still starting: the budget is a '
          + 'budget, not a race')
        .toBe('starting');

      tick(1);
      fixture.detectChanges();

      // 1. A terminal exists - and it is the EXISTING latch, not a second notion of "over".
      expect(component.state).toBe('terminal');
      // 2. The modality is gone, by mechanism.
      expect(el('.rd-overlay')!.getAttribute('aria-modal')).toBe('false');
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.rd-backdrop').length)
        .withContext('an invisible scrim would go on eating every click on the page')
        .toBe(0);
      expect(document.querySelectorAll('[inert]').length)
        .withContext('an app left inert behind a non-blocking card is the trap, unchanged')
        .toBe(0);
      // 3. The copy is localized AND distinguishable from a run that genuinely failed.
      expect(el('.rd-message')!.textContent!.trim())
        .toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));
      expect(el('.rd-message')!.textContent!.trim())
        .not.toBe(runString('he', 'runFailed', { type: 'הגהה' }));
      // 4. The new failure mode is observable: it leaves no HTTP error in the console to correlate on,
      //    because the request is still open.
      expect(warn).toHaveBeenCalled();
      expect(warn.calls.mostRecent().args[0] as string).toContain('[AnalysisRun]');

      sub.unsubscribe();
      flush();
    }));

    it("a result that lands AFTER the budget expired retracts the expiry terminal", fakeAsync(() => {
      // c02 MEASURED this: a cold near-threshold Hebrew LineEdit (248 words, two under the server's
      // 250-word Hebrew threshold, so genuinely on the SYNC route) returned a real HTTP 200 carrying a
      // real result in 394.3s, against a 180s budget. The expiry cannot cancel the run - there is no
      // cancel endpoint - so the result still arrives, and `AnalysisPanelComponent.onRunResultReceived`
      // clears `runError` and renders the suggestions. A card still reading "did not start" on top of
      // those suggestions is two surfaces contradicting each other about one run, with no path back.
      //
      // The analyze response is a Subject held OPEN across the expiry ON PURPOSE. A synchronous `of()`
      // would answer before the timer ever ran and collapse the exact window this bug lives in.
      const analyze$ = new Subject<AnalysisResultDto>();
      const service = orchestrationThatNeverAnswers({
        run: () => analyze$.asObservable() as unknown as Observable<never>,
      });
      const hot = new Subject<AnalysisRunEvent>();
      const sub = startRealRun(service, hot, runContext());
      expect(component.state).toBe('starting');

      tick(RUN_START_BUDGET_MS);
      fixture.detectChanges();

      // Precondition: the budget really did misfire on a run that is still perfectly healthy.
      expect(component.state).withContext('the budget must actually have expired').toBe('terminal');
      expect(el('.rd-message')!.textContent!.trim())
        .withContext('precondition: the card is reporting that the run never started')
        .toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));

      // The run answers, late but successfully - exactly the 394.3s case.
      analyze$.next({
        id: 'res-1',
        chapterId: 'ch-1',
        type: 'Proofread',
        analysisType: 'Proofread',
        resultText: 'תוצאה',
        createdAt: new Date().toISOString(),
      } as AnalysisResultDto);
      analyze$.complete();
      fixture.detectChanges();

      expect(el('.rd-message')!.textContent!.trim())
        .withContext('the run SUCCEEDED and its suggestions are rendered behind this card; the expiry '
          + 'terminal was provisional and this run\'s own result must retract it')
        .toBe(runString('he', 'runSucceeded', { type: 'הגהה' }));
      expect(el('.rd-message')!.textContent!.trim())
        .not.toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));
      expect(component.state)
        .withContext('correcting the card must not reopen the run: it stays resolved, just truthfully')
        .toBe('terminal');
      expect(document.querySelectorAll('[inert]').length)
        .withContext('the modality was released at the expiry and must NOT be re-engaged')
        .toBe(0);

      sub.unsubscribe();
      flush();
    }));

    it('a GENUINE error terminal is never retracted by a later result', fakeAsync(() => {
      // The fence on the exception above. Only `startBudgetExpired` is provisional; a real failure is a
      // verdict on the run and single-resolve still holds absolutely.
      const hot = new Subject<AnalysisRunEvent>();
      fixture.componentRef.setInput('bookLanguage', 'he');
      fixture.componentRef.setInput('analysisType', 'Proofread');
      fixture.componentRef.setInput('runEvents', hot);
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();

      hot.next({ kind: 'error', message: 'boom' });
      fixture.detectChanges();
      expect(component.state).toBe('terminal');
      expect(el('.rd-message')!.textContent!.trim()).toBe('boom');

      hot.next({
        kind: 'sync-result',
        result: { id: 'res-1', chapterId: 'ch-1', resultText: 'x', createdAt: '' } as AnalysisResultDto,
      });
      fixture.detectChanges();

      expect(el('.rd-message')!.textContent!.trim())
        .withContext('a server error is not provisional; widening the retraction to every terminal would '
          + 'be the d1 item 6 violation the narrow flag exists to avoid')
        .toBe('boom');
      flush();
    }));

    it('a genuine error that lands AFTER the budget expired retracts the expiry terminal', fakeAsync(() => {
      // The MIRROR of the retraction above, and the same defect class in the failure direction. The
      // expiry says the server never answered; a late `error` off the same still-live subscription says
      // it answered and the run failed. Both cannot be true of one run. Left dropped by single-resolve,
      // the panel's banner carries the real failure while the card above it keeps the timeout copy - two
      // surfaces contradicting each other about one run, which is exactly what this mechanism exists to
      // remove. Reachable because `withStartTimeout` merges the expiry with a stream that stays LIVE:
      // only the expiry completes, so the run goes on and its `catchError` still composes an `error`.
      //
      // Driven through the REAL sync path, with the analyze response a Subject held OPEN across the
      // expiry, so the error is composed by the service rather than hand-fed to the dialog.
      const analyze$ = new Subject<AnalysisResultDto>();
      const service = orchestrationThatNeverAnswers({
        run: () => analyze$.asObservable() as unknown as Observable<never>,
      });
      const hot = new Subject<AnalysisRunEvent>();
      const sub = startRealRun(service, hot, runContext());
      expect(component.state).toBe('starting');

      tick(RUN_START_BUDGET_MS);
      fixture.detectChanges();

      expect(component.state).withContext('the budget must actually have expired').toBe('terminal');
      expect(el('.rd-message')!.textContent!.trim())
        .withContext('precondition: the card is reporting that the run never started')
        .toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));

      // The run answers late, and badly.
      analyze$.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
      fixture.detectChanges();

      const shown = el('.rd-message')!.textContent!.trim();
      expect(shown)
        .withContext('the server DID answer and the run failed; the card must stop claiming the server '
          + 'never responded, or the real failure only ever reaches the panel banner')
        .not.toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));
      expect(shown)
        .withContext('and what replaces it is the run\'s own failure message, composed by the service')
        .toBe(runString('he', 'analysisFailed'));
      expect(component.state)
        .withContext('correcting the card must not reopen the run: it stays resolved, just truthfully')
        .toBe('terminal');
      expect(document.querySelectorAll('[inert]').length)
        .withContext('the modality was released at the expiry and must NOT be re-engaged')
        .toBe(0);

      sub.unsubscribe();
      flush();
    }));

    it('a genuine error terminal is never retracted by a LATER error either', fakeAsync(() => {
      // The fence on the arm just widened. Only a terminal latched FROM an expiry is provisional; once a
      // real failure is on the card, single-resolve holds absolutely, including against another error.
      const hot = new Subject<AnalysisRunEvent>();
      fixture.componentRef.setInput('bookLanguage', 'he');
      fixture.componentRef.setInput('analysisType', 'Proofread');
      fixture.componentRef.setInput('runEvents', hot);
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();

      hot.next({ kind: 'error', message: 'boom' });
      fixture.detectChanges();
      expect(el('.rd-message')!.textContent!.trim()).toBe('boom');

      hot.next({ kind: 'error', message: 'second boom' });
      fixture.detectChanges();

      expect(el('.rd-message')!.textContent!.trim())
        .withContext('a server error is not provisional, so nothing after it may rewrite the card')
        .toBe('boom');
      flush();
    }));

    it('a run that reaches (b) BEFORE the budget is never falsely failed', fakeAsync(() => {
      // THE regression that matters: a slow-but-healthy job must not be killed. The dispatch answers
      // late but well inside the budget, and the run then goes on far longer than the budget - which is
      // ordinary for a whole-chapter analysis (Linguistic was measured at ~3 minutes).
      const dispatch$ = new Subject<{ jobId: string }>();
      const service = orchestrationThatNeverAnswers({
        startAsync: () => dispatch$.asObservable() as unknown as Observable<never>,
      });
      const hot = new Subject<AnalysisRunEvent>();
      const seen: AnalysisRunEvent[] = [];
      hot.subscribe(e => seen.push(e));

      const sub = startRealRun(service, hot, runContext({ selectedAnalysisType: 'LinguisticAnalysis' }));
      expect(component.state).toBe('starting');

      tick(RUN_START_BUDGET_MS - 1_000);
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 5 })]);
      dispatch$.next({ jobId: 'JOB-1' });
      fixture.detectChanges();
      expect(component.state).withContext('the dispatch answered inside the budget').toBe('tracked');

      // Now outlast the budget several times over. The job is healthy; nothing may kill it.
      tick(RUN_START_BUDGET_MS * 3);
      fixture.detectChanges();

      expect(component.state)
        .withContext('a timer that survives the answer turns every long healthy run into a false failure')
        .toBe('tracked');
      expect(seen.filter(e => e.kind === 'error'))
        .withContext('no error may cross the channel for a run the server accepted')
        .toEqual([]);
      expect(el('.rd-backdrop')).withContext('a live run is still modal').not.toBeNull();

      sub.unsubscribe();
      flush();
    }));

    it('does not outlive the run: a dialog torn down mid-wait leaves no timer and no late terminal',
      fakeAsync(() => {
        const hot = new Subject<AnalysisRunEvent>();
        const seen: AnalysisRunEvent[] = [];
        hot.subscribe(e => seen.push(e));
        const sub = startRealRun(orchestrationThatNeverAnswers(), hot, runContext());
        expect(component.state).toBe('starting');

        // The editor's per-context reconcile closes the card on a book/chapter change, and the panel
        // unsubscribes the run. Both happen here, in that order.
        fixture.componentRef.setInput('open', false);
        fixture.detectChanges();
        sub.unsubscribe();

        // Well past the budget. A surviving timer would fire into a context that has moved on - and
        // `fakeAsync` fails the spec outright on a leftover timer, so this asserts the mechanism twice.
        tick(RUN_START_BUDGET_MS * 2);
        fixture.detectChanges();

        expect(seen.filter(e => e.kind === 'error'))
          .withContext('a cancelled run must be told nothing at all')
          .toEqual([]);
        expect(component.state).toBe('hidden');
        expect(document.querySelectorAll('[inert]').length).toBe(0);
      }));
  });

  // ── c01: state (a) offers a real, labelled escape ──────────────────────────
  //
  // The user's report was "no button to dismiss" while the header glyph was on screen. An accessible
  // name is necessary but it is not an affordance, so state (a) now renders a labelled control in the
  // same row minimize occupies in state (b).
  describe('state (a) offers a labelled escape (c01)', () => {
    it('renders a labelled close control that dismisses without claiming to minimize', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();

      const close = el('.rd-close');
      expect(close).withContext('state (a) must offer more than a bare glyph').not.toBeNull();
      expect(close!.textContent!.trim())
        .withContext('a LABEL, not an icon: the icon is what the user did not read as an escape')
        .toBe(RUN_DIALOG_LABELS_HE['close']);
      // It is a close, never a minimize: nothing is tracked, so there is no bell row to fly to.
      expect(el('.rd-minimize')).toBeNull();
      // c02 weakened this hint (it used to reuse state (b)'s unconditional keepsRunning). See the
      // "state (a) must not over-promise" spec below for why.
      expect(el('.rd-hint')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['keepsRunningWhileOpen']);

      close!.click();
      fixture.detectChanges();

      expect(minimized)
        .withContext('minimizeRequested still fires ONLY from state (b); its docblock promise holds')
        .toEqual([]);
      expect(openChanges).toEqual([false]);
      expect(el('.rd-card')).toBeNull();
    });

    it('the glyph control carries BOTH an accessible name and a title', () => {
      startRun();
      const dismiss = el('.rd-dismiss')!;
      expect(dismiss.getAttribute('aria-label')).toBe(RUN_DIALOG_LABELS_HE['close']);
      expect(dismiss.getAttribute('title'))
        .withContext('hover is the sighted user\'s equivalent of the accessible name')
        .toBe(RUN_DIALOG_LABELS_HE['close']);
    });

    it('is absent in state (b), where minimize owns the slot, and PRESENT in state (c)', () => {
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(el('.rd-close')).withContext('(b) offers minimize, which is not a close').toBeNull();
      expect(el('.rd-minimize')).not.toBeNull();

      registry.setJobs([makeJob({ id: 'JOB-1', status: 'succeeded', percent: 100 })]);
      fixture.detectChanges();
      expect(component.state).toBe('terminal');
      // THIS ASSERTION WAS FLIPPED (P1-1, 2026-08-04). It used to require .rd-close ABSENT here, under
      // the context "(c) is already non-blocking and the header dismiss is enough" - which is a
      // restatement of the argument c01 rejected for state (a), written as a passing fence, and it is
      // why nobody caught the gap. State (c) is the state that persists INDEFINITELY (a and b resolve on
      // their own) and the expiry copy the same change wrote ends "close this window", so the bare glyph
      // is least sufficient in exactly the state that had only the glyph.
      expect(el('.rd-close'))
        .withContext('(c) persists until dismissed and its own copy tells the user to close it, so the '
          + 'bare glyph is least sufficient here of all - not most')
        .not.toBeNull();
    });

    // RTL / narrow-viewport check for the ONE control this todo adds. The layout itself is asserted in
    // the SCSS by construction (the row is `display: flex` with logical spacing tokens and the control
    // shares `.rd-minimize`'s rule set verbatim, so there is no physical left/right to mirror); what a
    // spec CAN pin is that the control follows the BOOK language in both directions, which is the part a
    // regression would actually break.
    it('follows the book language and direction in both RTL and LTR', () => {
      startRun({ language: 'he' });
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(el('.rd-close')).withContext('the RTL escape control must exist to be mirrored').not.toBeNull();
      expect(el('.rd-close')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['close']);

      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      startRun({ language: 'en-US' });
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
      expect(el('.rd-close')).withContext('the LTR escape control must exist too').not.toBeNull();
      expect(el('.rd-close')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_EN['close']);
    });
  });

  // ── P1-1: state (c) offers the SAME labelled escape ────────────────────────
  //
  // c01 established, from a live user report, that a bare glyph is not a discoverable escape - and gave
  // the labelled control to state (a) only. State (c) is the OTHER state where that glyph stood alone,
  // and it is the one that needs it most: (a) and (b) resolve on their own, while (c) persists until
  // dismissed, so an undiscovered glyph leaves a card floating over the editor indefinitely. The expiry
  // sentence c01 itself wrote ends "close this window" / `סגרו את החלון` and used to render next to no
  // close control. MEASURED LIVE 2026-08-04: the .rd-card control inventory in (c) was exactly
  // [rd-dismiss="✕"] in both he and en.
  describe('state (c) offers a labelled escape too (P1-1)', () => {
    /** The measured defect scenario: the c01 start-budget expiry, which arrives as an ordinary error. */
    function expireIntoTerminal(): void {
      emit({ kind: 'error', message: runString('he', 'runStartTimedOut', { type: 'הגהה' }) });
      expect(component.state).withContext('precondition: this really is state (c)').toBe('terminal');
    }

    it('renders a labelled close in the actions row, not only the header glyph', () => {
      startRun();
      expireIntoTerminal();

      const close = el('.rd-close');
      expect(close)
        .withContext('the state that persists indefinitely must offer more than a bare glyph')
        .not.toBeNull();
      expect(close!.textContent!.trim())
        .withContext('a LABEL, not an icon: the icon is what the user did not read as an escape')
        .toBe(RUN_DIALOG_LABELS_HE['close']);
      // The row is the same slot minimize occupies in (b), and minimize is NOT offered here: the run is
      // over, so there is nothing to hand to the Activity Center.
      expect(el('.rd-minimize')).toBeNull();
      // NO hint: both hint strings are promises about a LIVE run, and this one is over.
      expect(el('.rd-hint'))
        .withContext('keepsRunning / keepsRunningWhileOpen would both be false for a finished run')
        .toBeNull();
    });

    it('clicking it closes the card and emits NO minimizeRequested', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      expireIntoTerminal();
      // Guarded, so that removing the control fails with the sentence that NAMES the defect rather than
      // with a TypeError on a null click - a red for the wrong reason is not a revert-verify.
      expect(el('.rd-close'))
        .withContext('there must be a labelled control in (c) for the user to click at all')
        .not.toBeNull();
      el('.rd-close')!.click();
      fixture.detectChanges();

      expect(el('.rd-card')).toBeNull();
      expect(minimized)
        .withContext('minimizeRequested still fires ONLY from state (b); its docblock promise holds')
        .toEqual([]);
      expect(openChanges).toEqual([false]);
    });

    it('follows the book language and direction in both RTL and LTR', () => {
      startRun({ language: 'he' });
      expireIntoTerminal();
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(el('.rd-close'))
        .withContext('the Hebrew terminal card must offer the escape to be mirrored at all')
        .not.toBeNull();
      expect(el('.rd-close')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['close']);

      // The dialog resets on the open false -> true RUN BOUNDARY, so a second run has to be re-opened.
      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      startRun({ language: 'en-US' });
      emit({ kind: 'error', message: runString('en', 'runStartTimedOut', { type: 'Proofread' }) });
      expect(component.state).toBe('terminal');
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
      expect(el('.rd-close'))
        .withContext('the English terminal card needs the escape just as much')
        .not.toBeNull();
      expect(el('.rd-close')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_EN['close']);
    });

    it('the expiry copy that says "close this window" is rendered NEXT TO a close control', () => {
      // The narrowest statement of the defect: the sentence instructs an action the state did not
      // afford. Both halves are asserted together so neither can drift from the other.
      startRun();
      expireIntoTerminal();

      const message = el('.rd-message')!.textContent!.trim();
      expect(message).toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));
      expect(message)
        .withContext('premise check: this copy really does instruct the user to close the card')
        .toContain('סגרו את החלון');
      expect(el('.rd-close'))
        .withContext('copy that says "close this window" next to no close control is the defect')
        .not.toBeNull();
    });
  });

  // ── c02: a run that never gets a jobId (the SINGLE-CHUNK / sync run) ───────
  //
  // THE USER REQUIREMENT, stated directly: "even with only 1 chunk, the user could minimize the popup".
  // VERIFIED IN THE DATABASE 2026-08-03: a 247-word chapter persisted with TotalChunks 1, SucceededChunks
  // 1 and JobId NULL - it took the SYNC route and never entered JobRegistryService.
  //
  // The c02 decision (recorded in full on AnalysisRunDialogComponent.minimize) is that such a run gets a
  // real ESCAPE but never the minimize GESTURE, because minimize means "hand this to the Activity Center
  // bell and keep watching it there" and a sync run has nothing to hand over: it has no server-side job
  // to reattach to, and it dies with the analysis panel that owns its HTTP subscription, while the bell
  // is app-level chrome whose promise is that you can navigate away. These specs pin BOTH halves - the
  // escape works, and the gesture is not faked.
  describe('a single-chunk (sync) run: escapable, but never faked as a minimize (c02)', () => {
    /**
     * The editor's real handler, wired the way `editor-page.component.html` wires it. The flight's
     * DESTINATION is the point at issue, so the test drives the actual function the editor calls rather
     * than asserting on the emit alone: if the gesture ever fires without a tracked job, a ghost appears
     * in the document and the "no destination, no flight" rule fails here loudly.
     */
    function wireEditorFlyToBell(): void {
      component.minimizeRequested.subscribe(e => flyToActivityCenter(e.originRect));
    }

    function ghosts(): number {
      return document.querySelectorAll('.' + MINIMIZE_GHOST_CLASS).length;
    }

    afterEach(() => {
      document.querySelectorAll('.' + MINIMIZE_GHOST_CLASS).forEach(n => n.remove());
    });

    it('offers a working escape from the blocking card, and the run is not resolved by taking it', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));

      startRun();
      // The sync route's ONLY pre-result event: one client-composed status, then silence until the
      // blocking /analyze call returns. This is the whole window the user has to escape in.
      emit({ kind: 'status', message: 'מריץ הגהה...' });
      expect(component.state).withContext('a sync run really does sit in state (a)').toBe('starting');
      expect(el('.rd-backdrop')).withContext('and it really is blocking the app').not.toBeNull();

      const escape = el('.rd-close');
      expect(escape).withContext('the user asked to be able to get out of this card').not.toBeNull();
      escape!.click();
      fixture.detectChanges();

      // Escaped, by mechanism: no card, no scrim, nothing inert.
      expect(el('.rd-card')).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.rd-backdrop').length).toBe(0);
      expect(document.querySelectorAll('[inert]').length).toBe(0);
      // ...and the gesture was NOT the minimize gesture.
      expect(minimized)
        .withContext('a sync run has no registry entry, so a minimize emit would hand over nothing')
        .toEqual([]);
    });

    it('plays NO fly-to-bell flight, because there is no bell row to fly to', () => {
      wireEditorFlyToBell();
      startRun();
      emit({ kind: 'status', message: 'מריץ הגהה...' });

      expect(ghosts()).withContext('precondition: nothing in flight yet').toBe(0);
      el('.rd-close')!.click();
      fixture.detectChanges();

      expect(ghosts())
        .withContext('flying a ghost at the bell when the bell has no row for this run is a lie told '
          + 'with an animation')
        .toBe(0);
    });

    it('the flight DOES play once a run is genuinely tracked, so the rule above is not vacuous', () => {
      // The control. If the flight never played at all, the assertion above would pass for the wrong
      // reason (a broken wiring rather than a withheld gesture).
      wireEditorFlyToBell();
      startRun();
      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).toBe('tracked');

      el('.rd-minimize')!.click();
      fixture.detectChanges();

      expect(ghosts())
        .withContext('a tracked job HAS an Activity Center row, so the flight has a real destination')
        .toBe(1);
    });

    it('state (a) does not promise the background survival a sync run cannot deliver', () => {
      // The panel's ngOnDestroy unsubscribes the run (emitting run-finished), so on the sync route
      // leaving the editor CANCELS it. State (b)'s "this keeps running in the background" is earned by a
      // server-side job and is false here, which matters precisely because this card is inviting the
      // user to close it and go do something else.
      startRun();
      const startingHint = el('.rd-hint')!.textContent!.trim();
      expect(startingHint).toBe(RUN_DIALOG_LABELS_HE['keepsRunningWhileOpen']);

      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      const trackedHint = el('.rd-hint')!.textContent!.trim();
      expect(trackedHint).toBe(RUN_DIALOG_LABELS_HE['keepsRunning']);

      expect(startingHint)
        .withContext('one wording for two different promises is how the promise gets broken')
        .not.toBe(trackedHint);
    });

    it('the weaker state-(a) promise is localized in BOTH languages, and differs from (b) in both', () => {
      for (const [lang, labels] of [['he', RUN_DIALOG_LABELS_HE], ['en-US', RUN_DIALOG_LABELS_EN]] as const) {
        fixture.componentRef.setInput('open', false);
        fixture.detectChanges();
        startRun({ language: lang });

        expect((fixture.nativeElement as HTMLElement).getAttribute('dir'))
          .toBe(lang === 'he' ? 'rtl' : 'ltr');
        expect(el('.rd-hint')!.textContent!.trim()).toBe(labels['keepsRunningWhileOpen']);
        expect(labels['keepsRunningWhileOpen']).not.toBe(labels['keepsRunning']);
      }
    });

    // OBSERVABILITY. Closing in state (a) is the one dismissal that leaves a LIVE run with no surface at
    // all, and nothing about it fails, so without a log a "my analysis vanished" report is unreadable
    // from the console. It must fire for THAT state only - a log on every close would be noise that
    // stops being read.
    it('records the close-with-no-surface, exactly once and only for state (a)', () => {
      // The dialog resets on the open false -> true RUN BOUNDARY, and `setInput` dedupes against the
      // value IT last wrote (the component's own `setOpen(false)` is invisible to it), so each
      // subsequent run has to be re-opened explicitly. Same shape as the c01 RTL/LTR spec above.
      const reopen = () => {
        fixture.componentRef.setInput('open', false);
        fixture.detectChanges();
        startRun();
      };
      const info = spyOn(console, 'info');

      startRun();
      el('.rd-close')!.click();
      fixture.detectChanges();
      expect(info).toHaveBeenCalledTimes(1);
      expect(info.calls.mostRecent().args[0] as string).toContain('[AnalysisRun]');

      // State (b): the run has a registry row and an Activity Center presence, so nothing is lost.
      info.calls.reset();
      reopen();
      registry.setJobs([makeJob({ id: 'JOB-1' })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(component.state).withContext('precondition: this really is state (b)').toBe('tracked');
      el('.rd-minimize')!.click();
      fixture.detectChanges();
      expect(info).withContext('a minimize hands the run to the bell; nothing is unaccounted for').not.toHaveBeenCalled();

      // State (c): the run is over. There is nothing left to lose track of.
      info.calls.reset();
      registry.setJobs([]);
      reopen();
      emit({ kind: 'error', message: 'boom' });
      expect(component.state).withContext('precondition: this really is state (c)').toBe('terminal');
      el('.rd-dismiss')!.click();
      fixture.detectChanges();
      expect(info).not.toHaveBeenCalled();
    });
  });

  // ── i18n / direction ───────────────────────────────────────────────────────

  describe('book-scoped i18n and direction', () => {
    it('a Hebrew book renders dir=rtl with Hebrew chrome', () => {
      startRun({ language: 'he' });
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 10 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(el('.rd-title')!.textContent!.trim()).toBe('הגהה');
      expect(el('.rd-minimize')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['minimize']);
      expect(el('.rd-hint')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['keepsRunning']);
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['running']);
    });

    it('an English book renders dir=ltr with English chrome', () => {
      startRun({ language: 'en-US' });
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 10 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
      expect(el('.rd-title')!.textContent!.trim()).toBe('Proofread');
      expect(el('.rd-minimize')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_EN['minimize']);
      expect(el('.rd-hint')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_EN['keepsRunning']);
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_EN['running']);
    });

    it('an absent/blank book language falls back to Hebrew (the app default)', () => {
      startRun({ language: '  ' });
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(component.chromeLang).toBe('he');
    });

    it('he/en label maps have identical key sets', () => {
      expect(Object.keys(RUN_DIALOG_LABELS_HE).sort()).toEqual(Object.keys(RUN_DIALOG_LABELS_EN).sort());
    });

    it('no user-facing label contains an em-dash', () => {
      const all = [...Object.values(RUN_DIALOG_LABELS_HE), ...Object.values(RUN_DIALOG_LABELS_EN)];
      expect(all.filter(v => v.includes('—'))).toEqual([]);
    });
  });

  // ── c04: real chunk counts + an approximate time remaining ─────────────────
  //
  // The defect this closes: the card read "0%" beside a run that had queued ten chunks, because the
  // percent is derived from completedChunks/totalChunks and the parallel workers finish nothing for the
  // first stretch. It was honest and it read as stalled. "0 of 10" says the same thing and reads as
  // work in progress; the ETA appears as soon as there is any basis for one.
  describe('chunk counts and the approximate time remaining (c04)', () => {
    /** A clock whose observed window is [T0, T0 + `windowSeconds`]. */
    function clock(windowSeconds: number | null, baselineCompleted = 0) {
      const t0 = Date.parse('2026-08-03T10:00:00.000Z');
      return {
        baselineAt: new Date(t0).toISOString(),
        baselineCompleted,
        lastCompletionAt: windowSeconds === null ? null : new Date(t0 + windowSeconds * 1000).toISOString(),
      };
    }

    it('renders the REAL counts in the detail line, not just the percent', () => {
      startRun({ language: 'he' });
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 30, completedChunks: 3, totalChunks: 10 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(el('.rd-message')!.textContent!.trim())
        .toBe(runString('he', 'progressCompleted', { type: 'הגהה', completed: 3, total: 10 }));
    });

    it('shows 0 of 10 at the very start, which is the moment that used to read as stalled', () => {
      startRun({ language: 'en' });
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 0, completedChunks: 0, totalChunks: 10 })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread: 0 of 10 completed');
      expect(el('.rd-progress-percent')!.textContent!.trim()).toBe('0%');
    });

    it('a run with NO chunk shape keeps the count-free sentence', () => {
      // A single-shot analysis has no chunks; inventing "0 of 0" would be worse than saying nothing.
      startRun({ language: 'he' });
      registry.setJobs([makeJob({ id: 'JOB-1', percent: null, completedChunks: null, totalChunks: null })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(el('.rd-message')!.textContent!.trim()).toBe(detail('progressRunning', 'הגהה'));
    });

    it('shows NO estimate before the first chunk has completed', () => {
      startRun({ language: 'en' });
      registry.setJobs([makeJob({
        id: 'JOB-1', percent: 0, completedChunks: 0, totalChunks: 10, chunkClock: clock(null),
      })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(el('.rd-eta')).toBeNull();
    });

    it('shows a LABELLED approximate estimate once throughput is observable', () => {
      // 2 chunks in 60s -> 30s per chunk of pipeline time x 8 remaining = 240s -> "about 4 minutes".
      startRun({ language: 'en' });
      registry.setJobs([makeJob({
        id: 'JOB-1', percent: 20, completedChunks: 2, totalChunks: 10, chunkClock: clock(60),
      })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(el('.rd-eta')!.textContent!.trim()).toBe('Estimated time remaining: about 4 minutes');
    });

    it('labels the estimate in HEBREW for a Hebrew book, with no Latin chrome', () => {
      startRun({ language: 'he' });
      registry.setJobs([makeJob({
        id: 'JOB-1', percent: 20, completedChunks: 2, totalChunks: 10, chunkClock: clock(60),
      })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      const eta = el('.rd-eta')!.textContent!.trim();
      expect(eta).toBe('זמן משוער שנותר: כ-4 דקות');
      expect(eta).not.toMatch(/[A-Za-z]/);
    });

    it('a REATTACHED job (no client-side start time) shows counts but NO estimate', () => {
      // The registry gives a reattached job an empty clock precisely so this card cannot invent a
      // number from a window it never observed. Counts are still real, so the user is not left with 0%.
      startRun({ language: 'en' });
      registry.setJobs([makeJob({
        id: 'JOB-1', percent: 40, completedChunks: 4, totalChunks: 10, chunkClock: EMPTY_CHUNK_CLOCK,
      })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });

      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread: 4 of 10 completed');
      expect(el('.rd-eta')).toBeNull();
    });

    it('drops the estimate at the terminal, including a FAILED run with chunks outstanding', () => {
      startRun({ language: 'en' });
      registry.setJobs([makeJob({
        id: 'JOB-1', percent: 20, completedChunks: 2, totalChunks: 10, chunkClock: clock(60),
      })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      expect(el('.rd-eta')).not.toBeNull(); // premise: it really was showing one

      // A run that fails at 2 of 10 still has 8 chunks "remaining", so only the STATE gate stops the
      // card from reading "Failed" above "about 4 minutes remaining".
      registry.setJobs([makeJob({
        id: 'JOB-1', status: 'failed', percent: 20, completedChunks: 2, totalChunks: 10, chunkClock: clock(60),
      })]);
      fixture.detectChanges();

      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_EN['failed']);
      expect(el('.rd-eta')).toBeNull();
    });

    it('the estimate does not JITTER while a chunk is in flight', () => {
      // The registry re-emits the job on every poll tick, several times per chunk. The rate is
      // evaluated at the last COMPLETION, so ticks that carry no new completion cannot move the line -
      // and in particular a chunk that is dragging cannot make the estimate count UP.
      startRun({ language: 'en' });
      const running = { percent: 20, completedChunks: 2, totalChunks: 10, chunkClock: clock(60) };
      registry.setJobs([makeJob({ id: 'JOB-1', ...running })]);
      emit({ kind: 'job-started', jobId: 'JOB-1' });
      const first = el('.rd-eta')!.textContent!.trim();

      // Three more polls, minutes later in wall-clock time, with the same chunk still in flight.
      for (const updatedAt of ['2026-08-03T10:02:00Z', '2026-08-03T10:05:00Z', '2026-08-03T10:09:00Z']) {
        registry.setJobs([makeJob({ id: 'JOB-1', ...running, updatedAt })]);
        fixture.detectChanges();
        expect(el('.rd-eta')!.textContent!.trim()).toBe(first);
      }
    });
  });
});
