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
 *  - Escape is scoped to the CARD: it dismisses/minimizes only when focus is inside it (c04)
 *  - RTL (Hebrew book) and LTR (English book) both render, with he/en label parity and no em-dash
 *
 * Uses a BehaviorSubject-backed JobRegistryService stub whose jobById$ mirrors the real selector; the
 * real root service (and its five transitive deps) is NOT injected.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import {
  AnalysisRunDialogComponent,
  RUN_DIALOG_LABELS_EN,
  RUN_DIALOG_LABELS_HE,
  RunDialogMinimizeEvent,
} from './analysis-run-dialog.component';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { AnalysisResultDto } from '../../core/models/analysis';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      const jobA = makeJob({ id: 'JOB-A', percent: 20, message: 'A · 1 of 5 completed' });
      const jobB = makeJob({ id: 'JOB-B', percent: 70, message: 'B · 7 of 10 completed' });
      const jobALate = makeJob({ id: 'JOB-A', percent: 95, message: 'A · 5 of 5 completed (late)' });

      startRun();

      // (1) JOB-A is tracked and drives the card.
      registry.setJobs([jobA]);
      emit({ kind: 'job-started', jobId: 'JOB-A' });
      expect(component.state).toBe('tracked');
      expect(component.percent).toBe(20);
      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('20');
      expect(el('.rd-message')!.textContent!.trim()).toBe('A · 1 of 5 completed');

      // (2) A second job-started with a DIFFERENT id supersedes it.
      registry.setJobs([jobA, jobB]);
      emit({ kind: 'job-started', jobId: 'JOB-B' });
      expect(component.percent).toBe(70);
      expect(el('.rd-message')!.textContent!.trim()).toBe('B · 7 of 10 completed');

      // (3) A late registry update for the OLD job. `jobB` keeps its identity, so B's stream is silent
      //     (distinctUntilChanged) and only a still-live A subscription could speak here.
      registry.setJobs([jobALate, jobB]);
      fixture.detectChanges();

      // The card still shows B. Before c03 it showed A's 95%.
      expect(component.percent).toBe(70);
      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('70');
      expect(el('.rd-message')!.textContent!.trim()).toBe('B · 7 of 10 completed');
    });

    it('a superseded job going TERMINAL cannot latch the dialog behind the current job', () => {
      const jobA = makeJob({ id: 'JOB-A', percent: 20 });
      const jobB = makeJob({ id: 'JOB-B', percent: 70, message: 'B · 7 of 10 completed' });

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
      expect(el('.rd-message')!.textContent!.trim()).toBe('B · 7 of 10 completed');
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
      expect(el('.rd-message')!.textContent!.trim()).toBe('still tracking');
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
      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread · 3 of 5 completed');
    });

    it('IGNORES raw "progress" events: the registry is the only source once tracked', () => {
      emit({ kind: 'progress', percent: 95, message: 'stale poll text', rawStatus: 'running' });

      expect(el('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('20');
      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread · 1 of 5 completed');
    });

    it('IGNORES raw "status" events once tracked (the registry owns the message)', () => {
      emit({ kind: 'status', message: 'Running Proofread analysis...' });
      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread · 1 of 5 completed');
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
      expect(el('.rd-message')!.textContent!.trim()).toBe('boom');
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
      expect(el('.rd-message')!.textContent!.trim()).toBe('done');
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
      expect(el('.rd-message')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['canceled']);
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
      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread · 2 of 5 completed');
      expect(el('.rd-minimize')).not.toBeNull();

      // The registry, and only the registry, resolves it - and it resolves as SUCCEEDED, which the
      // panel's terminal would have mislabelled as canceled.
      registry.setJobs([makeJob({ id: 'JOB-1', percent: 100, status: 'succeeded', message: 'done' })]);
      fixture.detectChanges();

      expect(component.state).toBe('terminal');
      expect(el('.rd-status-pill')!.textContent!.trim()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
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
      expect(el('.rd-message')!.textContent!.trim()).toBe('Proofread · 2 of 5 completed');
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

  // ── c04: Escape is scoped to the card, not to the document ─────────────────
  //
  // The handler used to be `@HostListener('document:keydown.escape')`, so a modeless card claimed the
  // global Escape key. The user is EXPECTED to keep working in the Syncfusion document editor behind
  // this dialog (aria-modal="false", no focus trap, no backdrop), and Syncfusion uses Escape for its own
  // dismiss gestures, so an Escape pressed in the editor closed - or, in state (b), MINIMIZED with the
  // fly-to-bell animation - a card that never had focus.
  //
  // The binding now lives on `.rd-card` itself, so keydown must BUBBLE from a focused descendant. These
  // specs drive the real DOM path: they focus an element and dispatch a bubbling KeyboardEvent from it.
  // The inside-focus cases and the outside-focus case share `pressEscape`, so a broken dispatch would
  // fail the inside cases rather than silently greening the outside one.
  describe('Escape is scoped to the card (c04)', () => {
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

    // ── focus OUTSIDE the card: the defect ────────────────────────────────────

    it('state (b): Escape pressed OUTSIDE the card does nothing and never fires the flight', () => {
      const minimized: RunDialogMinimizeEvent[] = [];
      const openChanges: boolean[] = [];
      component.minimizeRequested.subscribe(e => minimized.push(e));
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      trackJob();

      // Focus is genuinely elsewhere - NOT the <body> default, which would prove nothing.
      outsider.focus();
      expect(document.activeElement).toBe(outsider);
      expect(component.state).toBe('tracked');

      pressEscape(outsider);

      // The card is untouched: it never had focus, so Escape was not its key to take.
      expect(el('.rd-card')).not.toBeNull();
      expect(component.open).toBeTrue();
      expect(component.state).toBe('tracked');
      expect(openChanges).toEqual([]);
      // The fly-to-bell animation must NOT play out of nowhere.
      expect(minimized).toEqual([]);
    });

    it('state (a): Escape pressed OUTSIDE the card leaves the card open', () => {
      const openChanges: boolean[] = [];
      component.openChange.subscribe(v => openChanges.push(v));

      startRun();
      outsider.focus();
      expect(document.activeElement).toBe(outsider);

      pressEscape(outsider);

      expect(el('.rd-card')).not.toBeNull();
      expect(component.open).toBeTrue();
      expect(openChanges).toEqual([]);
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
});
