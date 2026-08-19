import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import {
  ALL_JOB_KINDS,
  CHAPTER_SCOPED_KINDS,
  JobKind,
  JobRegistryService,
  TrackedJob,
  jobMatchesAnalysisContext,
  normalizeProgress,
  showsChunkCounts,
  progressPercent,
  clampPercent,
  normalizeStatus,
  normalizeLang,
} from './job-registry.service';
import { AnalysisProgressService } from './analysis-progress.service';
import { AnalysisService } from './analysis.service';
import { BookSummaryService } from './book-summary.service';
import { BookReviewService } from './book-review.service';
import { StyleBaselineService } from './style-baseline.service';
import { AnalysisProgressDto } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';

/** Minimal AnalysisProgressDto factory - only fields the registry reads matter. */
function progress(overrides: Partial<AnalysisProgressDto>): AnalysisProgressDto {
  return {
    jobId: 'j',
    analysisType: 'Proofread',
    scope: 'Chapter',
    status: 'running',
    currentChunk: 0,
    totalChunks: 0,
    completedChunks: 0,
    message: '',
    estimatedCompletionPercent: 0,
    ...overrides,
  };
}

/** Controllable per-poller Subjects, so tests drive terminal/running emits deterministically. */
class ProgressStub {
  summary$ = new Subject<AnalysisProgressDto>();
  review$ = new Subject<AnalysisProgressDto>();
  style$ = new Subject<AnalysisProgressDto>();
  chapter$ = new Subject<AnalysisProgressDto>();

  pollBookSummaryProgress() { return this.summary$.asObservable(); }
  pollBookReviewProgress() { return this.review$.asObservable(); }
  pollStyleBaselineProgress() { return this.style$.asObservable(); }
  pollProgress() { return this.chapter$.asObservable(); }
}

/** Status/active-jobs read stubs; default to "nothing in flight". Tests override return values. */
function makeSummaryStub(activeBuildJobId: string | null = null) {
  return { getBookSummaryStatus: jasmine.createSpy('getBookSummaryStatus').and.returnValue(of({ activeBuildJobId })) };
}
function makeReviewStub(activeBuildJobId: string | null = null) {
  return { getReviewStatus: jasmine.createSpy('getReviewStatus').and.returnValue(of({ activeBuildJobId })) };
}
function makeStyleStub(activeBuildJobId: string | null = null) {
  return { getStyleBaselineStatus: jasmine.createSpy('getStyleBaselineStatus').and.returnValue(of({ activeBuildJobId })) };
}
function makeAnalysisStub(jobs: ActiveAnalysisJobDto[] = []) {
  return { getActiveAnalysisJobs: jasmine.createSpy('getActiveAnalysisJobs').and.returnValue(of(jobs)) };
}

function activeJob(overrides: Partial<ActiveAnalysisJobDto>): ActiveAnalysisJobDto {
  return {
    jobId: 'aj',
    analysisType: 'Proofread',
    scope: 'Chapter',
    chapterId: 'ch-1',
    sceneId: null,
    status: 'Running',
    estimatedCompletionPercent: 25,
    message: 'working',
    lastUpdatedUtc: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

describe('JobRegistryService', () => {
  let service: JobRegistryService;
  let progressStub: ProgressStub;

  function configure(opts: {
    summary?: ReturnType<typeof makeSummaryStub>;
    review?: ReturnType<typeof makeReviewStub>;
    style?: ReturnType<typeof makeStyleStub>;
    analysis?: ReturnType<typeof makeAnalysisStub>;
  } = {}): void {
    progressStub = new ProgressStub();
    TestBed.configureTestingModule({
      providers: [
        JobRegistryService,
        { provide: AnalysisProgressService, useValue: progressStub },
        { provide: AnalysisService, useValue: opts.analysis ?? makeAnalysisStub() },
        { provide: BookSummaryService, useValue: opts.summary ?? makeSummaryStub() },
        { provide: BookReviewService, useValue: opts.review ?? makeReviewStub() },
        { provide: StyleBaselineService, useValue: opts.style ?? makeStyleStub() },
      ],
    });
    service = TestBed.inject(JobRegistryService);
  }

  function currentJobs(): TrackedJob[] {
    return (service as any).jobsSubject.value as TrackedJob[];
  }
  function jobById(id: string): TrackedJob | undefined {
    return currentJobs().find(j => j.id === id);
  }

  // ── Pure normalization helpers ─────────────────────────────────────────────────────────────────

  describe('normalization of BOTH DTO shapes', () => {
    it('book-level shape: uses estimatedCompletionPercent when totalChunks <= 0', () => {
      expect(progressPercent(progress({ totalChunks: 0, estimatedCompletionPercent: 42 }))).toBe(42);
    });

    it('analysis shape: computes round(100*completed/total)', () => {
      // 1/3 -> 33
      expect(progressPercent(progress({ totalChunks: 3, completedChunks: 1, estimatedCompletionPercent: 99 }))).toBe(33);
      // chunk shape is PREFERRED over estimatedCompletionPercent when total > 0
      expect(progressPercent(progress({ totalChunks: 4, completedChunks: 2, estimatedCompletionPercent: 0 }))).toBe(50);
    });

    it('normalizeProgress forces 100 on succeeded regardless of raw percent', () => {
      const n = normalizeProgress(progress({ status: 'Succeeded', totalChunks: 3, completedChunks: 1 }));
      expect(n.status).toBe('succeeded');
      expect(n.percent).toBe(100);
    });

    // c04. The counts were already being read here to DERIVE the percent and then thrown away, which is
    // why the only way to put "3 of 10" on screen used to be parsing it back out of the backend's
    // English prose. They now come back out alongside it.
    it('normalizeProgress carries the RAW chunk counts, not just the derived percent', () => {
      const n = normalizeProgress(progress({ totalChunks: 10, completedChunks: 3 }));
      expect(n.percent).toBe(30);
      expect(n.completedChunks).toBe(3);
      expect(n.totalChunks).toBe(10);
    });

    it('a run with NO chunk shape reports null counts, never "0 of 0"', () => {
      // totalChunks <= 0 is the backend's "not chunked / not chunked yet" state. Mapping it to null
      // rather than 0 is what makes every surface's "do we have counts?" test one null check.
      const n = normalizeProgress(progress({ totalChunks: 0, completedChunks: 0, estimatedCompletionPercent: 42 }));
      expect(n.percent).toBe(42);
      expect(n.totalChunks).toBeNull();
      expect(n.completedChunks).toBeNull();
    });

    it('clamps a completed count that exceeds the total, so the counts agree with the percent', () => {
      // progressPercent already clamps this to 100%; an unclamped count would make the estimator's
      // remaining-chunks negative and put "5 of 2" next to "100%".
      const n = normalizeProgress(progress({ totalChunks: 2, completedChunks: 5 }));
      expect(n.percent).toBe(100);
      expect(n.completedChunks).toBe(2);
    });
  });

  // ── c04: the chunk counts and the per-JOB throughput clock ──────────────────────────────────────
  //
  // The registry is the SINGLE OWNER of both, exactly as it already is of the percent. These specs pin
  // the ownership at the source; `three-surface-parity.spec.ts` pins that the surfaces all read it.
  describe('chunk counts + throughput clock (c04)', () => {
    it('a poll puts the real counts on the tracked job', () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 3 }));

      const job = jobById('J1')!;
      expect(job.completedChunks).toBe(3);
      expect(job.totalChunks).toBe(10);
      expect(job.percent).toBe(30);
    });

    it('counts are STICKY: a later poll with no chunk shape does not blank the readout', () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 3 }));
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 0, completedChunks: 0 }));

      const job = jobById('J1')!;
      expect(job.completedChunks).toBe(3);
      expect(job.totalChunks).toBe(10);
    });

    it('a run this client STARTED opens its throughput window at track time', () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });

      const job = jobById('J1')!;
      expect(job.chunkClock.baselineAt).toBe(job.startedAt);
      expect(job.chunkClock.baselineCompleted).toBe(0);
      expect(job.chunkClock.lastCompletionAt).toBeNull();
    });

    it('stamps the last COMPLETION, and a repeated snapshot does not move it', () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 0 }));
      expect(jobById('J1')!.chunkClock.lastCompletionAt).toBeNull();

      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 2 }));
      const stamped = jobById('J1')!.chunkClock;
      expect(stamped.lastCompletionAt).not.toBeNull();

      // Asserted by IDENTITY, not by comparing timestamps: two emissions inside the same millisecond
      // would produce equal ISO strings whether or not the clock was re-stamped, so a value comparison
      // here would pass against the bug. The same object means no observation was folded in at all.
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 2 }));
      expect(jobById('J1')!.chunkClock).toBe(stamped);
    });

    it('a REATTACHED job gets NO client-side start time, so it cannot produce a wrong estimate', () => {
      // The run was already in flight before this tab existed. Treating the moment the client noticed
      // it as the run start would under-state elapsed and therefore under-state the time remaining.
      configure({ analysis: makeAnalysisStub([activeJob({ jobId: 'RE-1' })]) });
      service.reattach('book-A', 'he');

      const job = jobById('RE-1')!;
      expect(job.chunkClock.baselineAt).toBeNull();

      // The window opens at the first OBSERVED poll instead, adopting whatever was already done.
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 4 }));
      const clock = jobById('RE-1')!.chunkClock;
      expect(clock.baselineAt).not.toBeNull();
      expect(clock.baselineCompleted).toBe(4);
      // The 4 pre-existing chunks are NOT evidence: they finished outside the observed window.
      expect(clock.lastCompletionAt).toBeNull();
    });

    it('a SUCCEEDED run reads N of N, for the same reason its percent is forced to 100', () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 8 }));
      // A terminal snapshot that lags by two chunks: the card must not read "8 of 10" beside "Done".
      progressStub.chapter$.next(progress({ status: 'Succeeded', totalChunks: 10, completedChunks: 8 }));

      const job = jobById('J1')!;
      expect(job.status).toBe('succeeded');
      expect(job.percent).toBe(100);
      expect(job.completedChunks).toBe(10);
      expect(job.totalChunks).toBe(10);
    });

    it('a FAILED run keeps its real shortfall: there the missing chunks ARE the truth', () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });
      progressStub.chapter$.next(progress({ status: 'Running', totalChunks: 10, completedChunks: 6 }));
      progressStub.chapter$.next(progress({ status: 'Failed', totalChunks: 10, completedChunks: 6 }));

      expect(jobById('J1')!.completedChunks).toBe(6);
      expect(jobById('J1')!.totalChunks).toBe(10);
    });
  });

  describe('percent clamps', () => {
    it('total = 0 with no estimate -> null (indeterminate)', () => {
      expect(progressPercent(progress({ totalChunks: 0, estimatedCompletionPercent: -1 }))).toBeNull();
    });
    it('over-100 -> 100', () => {
      expect(clampPercent(150)).toBe(100);
      expect(progressPercent(progress({ totalChunks: 2, completedChunks: 5 }))).toBe(100);
    });
    it('negative -> 0', () => {
      expect(clampPercent(-20)).toBe(0);
    });
    it('NaN / null / undefined -> null (never NaN)', () => {
      expect(clampPercent(NaN)).toBeNull();
      expect(clampPercent(null)).toBeNull();
      expect(clampPercent(undefined)).toBeNull();
    });
  });

  describe('normalizeStatus (PascalCase backend -> lowercase vocabulary)', () => {
    it('maps PascalCase enum values', () => {
      expect(normalizeStatus('Running')).toBe('running');
      expect(normalizeStatus('Succeeded')).toBe('succeeded');
      expect(normalizeStatus('Failed')).toBe('failed');
      expect(normalizeStatus('Canceled')).toBe('canceled');
      expect(normalizeStatus('Pending')).toBe('pending');
    });
    it('accepts the British spelling and unknown -> running', () => {
      expect(normalizeStatus('Cancelled')).toBe('canceled');
      expect(normalizeStatus('weird')).toBe('running');
      expect(normalizeStatus(null)).toBe('running');
    });
  });

  // ── track + single-finalize ────────────────────────────────────────────────────────────────────

  describe('track', () => {
    beforeEach(() => configure());

    it('registers a running job and updates percent/message on a running poll emit', () => {
      service.track('summary', 'book-A', 'J1');
      expect(jobById('J1')?.status).toBe('running');

      progressStub.summary$.next(progress({ status: 'Running', estimatedCompletionPercent: 60, message: 'halfway' }));
      expect(jobById('J1')?.percent).toBe(60);
      expect(jobById('J1')?.message).toBe('halfway');
    });

    it('single-finalize: a job is finalized exactly once despite repeated terminal emits', () => {
      service.track('summary', 'book-A', 'J1');

      progressStub.summary$.next(progress({ status: 'Succeeded', estimatedCompletionPercent: 100, message: 'done' }));
      expect(jobById('J1')?.status).toBe('succeeded');
      expect(jobById('J1')?.percent).toBe(100);
      const finalizedAt = jobById('J1')?.updatedAt;

      // A second terminal snapshot (poll re-emit) must NOT re-finalize or mutate the terminal job.
      progressStub.summary$.next(progress({ status: 'failed', message: 'ignored' }));
      expect(jobById('J1')?.status).toBe('succeeded');
      expect(jobById('J1')?.message).toBe('done');
      expect(jobById('J1')?.updatedAt).toBe(finalizedAt);
    });

    it('titles a chapter analysis job from its analysisType (LineEdit -> line-edit labels)', () => {
      // The fresh-start path (analysis panel job-started) tracks kind `proofread` + analysisType. A
      // LineEdit run must title as line-edit, not the proofread kind default.
      service.track('proofread', 'book-A', 'LE', { analysisType: 'LineEdit', chapterId: 'ch-1' });
      expect(jobById('LE')?.titleHe).toBe('עריכת שורה');
      expect(jobById('LE')?.titleEn).toBe('Line Edit');
    });

    it('falls back to the kind default title when no analysisType is supplied', () => {
      service.track('proofread', 'book-A', 'PF');
      expect(jobById('PF')?.titleHe).toBe('הגהה');
      expect(jobById('PF')?.titleEn).toBe('Proofreading');
    });

    it('does NOT start a second poll when track is called again for a live job (metadata merge only)', () => {
      const spy = spyOn(progressStub, 'pollBookSummaryProgress').and.callThrough();
      service.track('summary', 'book-A', 'J1');
      service.track('summary', 'book-A', 'J1', { message: 'updated' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(jobById('J1')?.message).toBe('updated');
    });

    it('does NOT resurrect a job that already reached terminal (re-track is a no-op)', () => {
      service.track('summary', 'book-A', 'J1');
      progressStub.summary$.next(progress({ status: 'Succeeded' }));
      expect(jobById('J1')?.status).toBe('succeeded');

      service.track('summary', 'book-A', 'J1');
      expect(jobById('J1')?.status).toBe('succeeded');
    });

    it('finalizes as failed when the poll errors', () => {
      const errStream$ = throwError(() => new Error('boom'));
      spyOn(progressStub, 'pollBookReviewProgress').and.returnValue(errStream$);
      service.track('review', 'book-A', 'J-err');
      expect(jobById('J-err')?.status).toBe('failed');
    });

    it('torn-state: non-terminal job with no live stop$ resumes ONE poll without resetting startedAt/status', () => {
      // Track a summary job and record its startedAt and status.
      service.track('summary', 'book-A', 'torn-1');
      const original = jobById('torn-1')!;
      expect(original.status).toBe('running');
      const originalStartedAt = original.startedAt;

      // Simulate torn state: delete the stop$ entry so the job is non-terminal but has no live poll.
      const stopsMap: Map<string, unknown> = (service as any).stops;
      stopsMap.delete('torn-1');
      expect(stopsMap.has('torn-1')).toBeFalse();

      // Spy on the poller BEFORE calling track again, so we can count invocations.
      const pollSpy = spyOn(progressStub, 'pollBookSummaryProgress').and.callThrough();

      // Call track again for the same non-terminal job.
      service.track('summary', 'book-A', 'torn-1', { message: 'resumed' });

      // Should have started exactly ONE new poll (not two).
      expect(pollSpy).toHaveBeenCalledTimes(1);
      // stop$ entry should be restored.
      expect(stopsMap.has('torn-1')).toBeTrue();

      // startedAt must not have been reset.
      expect(jobById('torn-1')?.startedAt).toBe(originalStartedAt);
      // status must still be 'running', not reset.
      expect(jobById('torn-1')?.status).toBe('running');
      // metadata was merged.
      expect(jobById('torn-1')?.message).toBe('resumed');

      // The resumed poll still works: a progress emit drives status forward.
      progressStub.summary$.next(progress({ status: 'Succeeded', estimatedCompletionPercent: 100 }));
      expect(jobById('torn-1')?.status).toBe('succeeded');
    });
  });

  // ── reattach ───────────────────────────────────────────────────────────────────────────────────

  describe('reattach', () => {
    it('re-tracks an in-flight book-level activeBuildJobId', () => {
      configure({ summary: makeSummaryStub('build-77') });
      service.reattach('book-A', 'he');
      expect(jobById('build-77')?.kind).toBe('summary');
      expect(jobById('build-77')?.status).toBe('running');
    });

    it('re-tracks an in-flight chapter analysis job from active-analysis-jobs', () => {
      configure({ analysis: makeAnalysisStub([activeJob({ jobId: 'chap-9', chapterId: 'ch-9' })]) });
      service.reattach('book-A', 'he');
      const job = jobById('chap-9');
      expect(job?.kind).toBe('proofread');
      expect(job?.chapterId).toBe('ch-9');
      expect(job?.percent).toBe(25);
    });

    it('reattaches a scene-scoped job with the scene label, not the chapter default', () => {
      // Bug: analysisJobToSource ignored scope and always used defaultScopeLabel('proofread') ('פרק'),
      // so a scene job reattached (or refreshed) as a chapter. It must mirror the live job-started label.
      configure({
        analysis: makeAnalysisStub([
          activeJob({ jobId: 'scene-1', scope: 'Scene', chapterId: 'ch-1', sceneId: 'sc-1' }),
        ]),
      });
      service.reattach('book-A', 'he');
      expect(jobById('scene-1')?.scopeLabel).toBe('סצנה');
    });

    it('a1: carries the sceneId onto the reattached job, not just into its label', () => {
      // The DTO has always carried it and `analysisJobToSource` dropped it, so a reattached scene job
      // reached the registry as a chapter job. The analysis panel's "is a run in flight for what I am
      // showing?" is scene-precise, so that made a scene run disable a chapter panel's analyze button.
      configure({
        analysis: makeAnalysisStub([
          activeJob({ jobId: 'scene-scope', scope: 'Scene', chapterId: 'ch-1', sceneId: 'sc-1' }),
          activeJob({ jobId: 'chap-scope', scope: 'Chapter', chapterId: 'ch-1', sceneId: null }),
        ]),
      });
      service.reattach('book-A', 'he');

      expect(jobById('scene-scope')?.sceneId).toBe('sc-1');
      expect(jobById('chap-scope')?.sceneId)
        .withContext('a chapter-scoped job carries no scene, so it can never match a scene-scoped panel')
        .toBeUndefined();
    });

    it('reattaches a chapter-scoped job with the chapter label', () => {
      configure({ analysis: makeAnalysisStub([activeJob({ jobId: 'chap-lbl', sceneId: null })]) });
      service.reattach('book-A', 'he');
      expect(jobById('chap-lbl')?.scopeLabel).toBe('פרק');
    });

    it('does NOT overwrite a live scene label with the chapter default when reattach re-discovers the job', () => {
      // The live job-started path tracks a scene job as 'סצנה'; a subsequent reattach (refresh / book
      // reload) re-discovers the same jobId and merges metadata idempotently. Its scopeLabel must stay
      // 'סצנה', not be clobbered back to the chapter default.
      configure({
        analysis: makeAnalysisStub([
          activeJob({ jobId: 'scene-live', scope: 'Scene', chapterId: 'ch-1', sceneId: 'sc-1' }),
        ]),
      });
      // Simulate the live start.
      service.track('proofread', 'book-A', 'scene-live', { scopeLabel: 'סצנה', chapterId: 'ch-1' });
      expect(jobById('scene-live')?.scopeLabel).toBe('סצנה');

      // A reattach re-discovers the same in-flight job and merges its metadata.
      service.reattach('book-A', 'he');
      expect(jobById('scene-live')?.scopeLabel).toBe('סצנה');
    });

    it('maps a reattached estimatedCompletionPercent of 0 to null (indeterminate, not determinate 0%)', () => {
      // The rf-b01 DTO uses 0 to mean "not yet chunked / unknown" (no negative sentinel), so a just-
      // reattached job must show the indeterminate bar, not a determinate 0%.
      configure({ analysis: makeAnalysisStub([activeJob({ jobId: 'chap-0', estimatedCompletionPercent: 0 })]) });
      service.reattach('book-A', 'he');
      expect(jobById('chap-0')?.percent).toBeNull();
    });

    it('titles a reattached Proofread job with the proofread labels', () => {
      configure({ analysis: makeAnalysisStub([activeJob({ jobId: 'pf-1', analysisType: 'Proofread' })]) });
      service.reattach('book-A', 'he');
      const job = jobById('pf-1');
      expect(job?.analysisType).toBe('Proofread');
      expect(job?.titleHe).toBe('הגהה');
      expect(job?.titleEn).toBe('Proofread');
    });

    it('titles a reattached LineEdit job with the line-edit labels, not the proofread default', () => {
      // rf-c01: LineEdit and Proofread share the one `proofread` kind, so the title must come from the
      // job's analysisType. A LineEdit job must NOT read as proofreading.
      configure({ analysis: makeAnalysisStub([activeJob({ jobId: 'le-1', analysisType: 'LineEdit' })]) });
      service.reattach('book-A', 'he');
      const job = jobById('le-1');
      expect(job?.kind).toBe('proofread');
      expect(job?.analysisType).toBe('LineEdit');
      expect(job?.titleHe).toBe('עריכת שורה');
      expect(job?.titleEn).toBe('Line Edit');
    });

    it('re-tracks BOTH a book-level build and a chapter job in one reattach', () => {
      configure({
        style: makeStyleStub('style-1'),
        analysis: makeAnalysisStub([activeJob({ jobId: 'chap-2' })]),
      });
      service.reattach('book-A', 'he');
      expect(jobById('style-1')?.kind).toBe('style-baseline');
      expect(jobById('chap-2')?.kind).toBe('proofread');
    });

    it('does NOT re-track when nothing is in flight', () => {
      configure(); // all stubs default to null / empty
      service.reattach('book-A', 'he');
      expect(currentJobs().length).toBe(0);
    });

    it('does NOT re-track a jobId already driven to terminal (lingering entry / single-finalize)', () => {
      // Status keeps advertising the SAME activeBuildJobId even after the job is terminal.
      configure({ review: makeReviewStub('linger-1') });
      service.reattach('book-A', 'he');
      expect(jobById('linger-1')?.status).toBe('running');

      // Drive it terminal.
      progressStub.review$.next(progress({ status: 'Succeeded' }));
      expect(jobById('linger-1')?.status).toBe('succeeded');

      // A second reattach re-discovers the lingering terminal entry - must NOT resurrect it.
      const pollSpy = spyOn(progressStub, 'pollBookReviewProgress').and.callThrough();
      service.reattach('book-A', 'he');
      expect(jobById('linger-1')?.status).toBe('succeeded');
      expect(pollSpy).not.toHaveBeenCalled();
    });

    it('one failing status read does not blank the other in-flight sources', () => {
      const summary = makeSummaryStub();
      summary.getBookSummaryStatus.and.returnValue(throwError(() => new Error('500')));
      configure({ summary, analysis: makeAnalysisStub([activeJob({ jobId: 'chap-ok' })]) });
      service.reattach('book-A', 'he');
      expect(jobById('chap-ok')?.kind).toBe('proofread');
    });

    // ── language forwarding + base-code normalization (Phase 4c-3) ─────────────────────────────────
    describe('language forwarding + normalization', () => {
      it('forwards the given language verbatim to all three status reads', () => {
        const summary = makeSummaryStub();
        const review = makeReviewStub();
        const style = makeStyleStub();
        configure({ summary, review, style });

        service.reattach('book-A', 'he');

        // Each status read is keyed by (BookId, Language); assert the language ARG each received.
        expect(summary.getBookSummaryStatus).toHaveBeenCalledWith('book-A', 'he');
        expect(review.getReviewStatus).toHaveBeenCalledWith('book-A', 'he');
        expect(style.getStyleBaselineStatus).toHaveBeenCalledWith('book-A', 'he');
      });

      it('normalizes a locale (en-US) to its base code (en) before forwarding to the reads', () => {
        const summary = makeSummaryStub();
        const review = makeReviewStub();
        const style = makeStyleStub();
        configure({ summary, review, style });

        service.reattach('book-A', 'en-US');

        // en-US must key the SAME (BookId, Language) slot the build POST/status rows use: base code 'en'.
        expect(summary.getBookSummaryStatus).toHaveBeenCalledWith('book-A', 'en');
        expect(review.getReviewStatus).toHaveBeenCalledWith('book-A', 'en');
        expect(style.getStyleBaselineStatus).toHaveBeenCalledWith('book-A', 'en');
      });
    });

    // ── supersession: a rapid A->B switch must not track A's jobs (Phase 4d-10a) ────────────────────
    it('supersedes an in-flight reattach: A resolves after B and A jobs are NOT tracked', () => {
      // Book A's summary status read is held open on a Subject so it resolves AFTER B's reattach starts.
      // The Subject emits the STATUS object shape the seam maps over ({ activeBuildJobId }).
      const aStatus$ = new Subject<{ activeBuildJobId: string | null }>();
      const summary = makeSummaryStub();
      summary.getBookSummaryStatus.and.callFake((bookId: string) =>
        bookId === 'book-A' ? aStatus$.asObservable() : of({ activeBuildJobId: null }),
      );
      configure({ summary });

      // Start reattach for book A (its summary read is now pending on aStatus$; forkJoin cannot emit yet).
      service.reattach('book-A', 'he');
      // Then a rapid switch: reattach for book B (all B reads resolve synchronously to nothing).
      service.reattach('book-B', 'he');

      // NOW let A's read finally resolve, advertising an in-flight A build.
      aStatus$.next({ activeBuildJobId: 'A-build' });
      aStatus$.complete();

      // The stale A response must be dropped (subscription superseded + currency guard): A is NOT tracked.
      expect(jobById('A-build')).toBeUndefined();
      expect(currentJobs().length).toBe(0);
    });
  });

  // ── normalizeLang (base-code helper) ──────────────────────────────────────────────────────────────
  describe('normalizeLang', () => {
    it('lowercases and strips the region subtag to a base code', () => {
      expect(normalizeLang('en-US')).toBe('en');
      expect(normalizeLang('he-IL')).toBe('he');
      expect(normalizeLang('EN')).toBe('en');
    });
    it('empty / whitespace / null falls back to the app default he', () => {
      expect(normalizeLang('')).toBe('he');
      expect(normalizeLang('   ')).toBe('he');
      expect(normalizeLang(null)).toBe('he');
      expect(normalizeLang(undefined)).toBe('he');
    });
  });

  // ── completed-cap eviction ───────────────────────────────────────────────────────────────────────

  describe('completed-cap eviction (N = 20)', () => {
    it('the 21st completed job evicts the oldest completed; active jobs are untouched', () => {
      configure();

      // Keep one ACTIVE job that must survive eviction.
      service.track('review', 'book-A', 'ACTIVE');
      progressStub.review$.next(progress({ status: 'Running', estimatedCompletionPercent: 10 }));
      expect(jobById('ACTIVE')?.status).toBe('running');

      // Complete 21 summary jobs. Each gets its own poll Subject via a fresh track, but ProgressStub
      // shares one summary$ Subject; to finalize each independently we drive them one at a time by
      // tracking then immediately emitting terminal on the shared subject BEFORE tracking the next.
      // The shared subject only reaches the job whose poll is currently subscribed, so we finalize
      // via a per-job succeed helper instead.
      for (let i = 1; i <= 21; i++) {
        const id = `C${i}`;
        // Give each completed job a distinct, increasing updatedAt so eviction order is deterministic.
        const iso = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(iso));
        service.track('summary', 'book-A', id);
        (service as any).finalize(id, 'succeeded', 100, 'ok');
        jasmine.clock().uninstall();
      }

      const jobs = currentJobs();
      const completed = jobs.filter(j => j.status === 'succeeded');
      // Cap holds: exactly 20 completed retained.
      expect(completed.length).toBe(20);
      // Oldest (C1) evicted, newest (C21) retained.
      expect(jobById('C1')).toBeUndefined();
      expect(jobById('C21')).toBeDefined();
      // Active job survives regardless of the cap.
      expect(jobById('ACTIVE')?.status).toBe('running');
    });
  });

  // ── observables ──────────────────────────────────────────────────────────────────────────────────

  describe('anyRunningForBook$', () => {
    it('is true while a tracked job runs and false after it terminates', async () => {
      configure();
      service.track('summary', 'book-A', 'J1');
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeTrue();

      progressStub.summary$.next(progress({ status: 'Succeeded' }));
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeFalse();
    });

    it('book-switch isolation: a job for book A does not make book B report running', async () => {
      configure();
      service.track('summary', 'book-A', 'J-A');
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeTrue();
      expect(await firstValueFrom(service.anyRunningForBook$('book-B'))).toBeFalse();
    });

    it('is true for a running developmental review build', async () => {
      configure();
      service.track('review', 'book-A', 'REV');
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeTrue();
    });

    it('a running chapter proofread job does NOT light the review affordance', async () => {
      // proofread is tracked for the Activity Center but is not a whole-book summary/review build.
      configure();
      service.track('proofread', 'book-A', 'PF', { chapterId: 'ch-1' });
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeFalse();
    });

    it('a running style-baseline build does NOT light the review affordance', async () => {
      configure();
      service.track('style-baseline', 'book-A', 'SB');
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeFalse();
    });

    it('with only proofread + style-baseline running it stays false; a summary build flips it true', async () => {
      configure();
      service.track('proofread', 'book-A', 'PF', { chapterId: 'ch-1' });
      service.track('style-baseline', 'book-A', 'SB');
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeFalse();

      service.track('summary', 'book-A', 'SUM');
      expect(await firstValueFrom(service.anyRunningForBook$('book-A'))).toBeTrue();
    });
  });

  describe('jobByKindForBook$', () => {
    it('returns the active job of that kind for the book, null when none', async () => {
      configure();
      expect(await firstValueFrom(service.jobByKindForBook$('book-A', 'summary'))).toBeNull();
      service.track('summary', 'book-A', 'J1');
      const job = await firstValueFrom(service.jobByKindForBook$('book-A', 'summary'));
      expect(job?.id).toBe('J1');
      // A different kind is still null.
      expect(await firstValueFrom(service.jobByKindForBook$('book-A', 'review'))).toBeNull();
    });
  });

  describe('jobById$', () => {
    it('returns null for an id that was never tracked, then the job once it is', async () => {
      configure();
      expect(await firstValueFrom(service.jobById$('J1'))).toBeNull();

      service.track('summary', 'book-A', 'J1');
      expect((await firstValueFrom(service.jobById$('J1')))?.id).toBe('J1');
    });

    it('follows THAT job across progress updates and its terminal transition', async () => {
      configure();
      service.track('proofread', 'book-A', 'J1', { chapterId: 'ch-1' });

      progressStub.chapter$.next(progress({ totalChunks: 4, completedChunks: 1 }));
      let job = await firstValueFrom(service.jobById$('J1'));
      expect(job?.percent).toBe(25);
      expect(job?.status).toBe('running');

      progressStub.chapter$.next(progress({ status: 'Succeeded', totalChunks: 4, completedChunks: 4 }));
      job = await firstValueFrom(service.jobById$('J1'));
      expect(job?.status).toBe('succeeded');
      expect(job?.percent).toBe(100);
    });

    it('does NOT collide on two concurrent jobs of the same kind for the same book', async () => {
      // This is exactly why jobByKindForBook$ was unfit for the run dialog: it resolves one job per
      // (book, kind), so a chapter run and a scene run started back to back share a slot.
      configure();
      service.track('proofread', 'book-A', 'CHAPTER-JOB', { chapterId: 'ch-1', scopeLabel: 'פרק' });
      service.track('proofread', 'book-A', 'SCENE-JOB', { chapterId: 'ch-1', scopeLabel: 'סצנה' });

      expect((await firstValueFrom(service.jobById$('CHAPTER-JOB')))?.scopeLabel).toBe('פרק');
      expect((await firstValueFrom(service.jobById$('SCENE-JOB')))?.scopeLabel).toBe('סצנה');
      // The kind-scoped selector cannot tell them apart: it collapses to a single job.
      const byKind = await firstValueFrom(service.jobByKindForBook$('book-A', 'proofread'));
      expect(['CHAPTER-JOB', 'SCENE-JOB']).toContain(byKind!.id);
    });

    it('emits once per real change and dedupes a steady null (distinctUntilChanged)', () => {
      configure();
      const seen: (TrackedJob | null)[] = [];
      const sub = service.jobById$('J1').subscribe(j => seen.push(j));

      // Tracking an UNRELATED job rebuilds the jobs array but must not re-emit null for J1.
      service.track('summary', 'book-A', 'OTHER');
      expect(seen).toEqual([null]);

      service.track('summary', 'book-A', 'J1');
      expect(seen.length).toBe(2);
      expect(seen[1]?.id).toBe('J1');

      sub.unsubscribe();
    });
  });

  describe('activeJobs$', () => {
    it('excludes terminal jobs', async () => {
      configure();
      service.track('summary', 'book-A', 'J1');
      service.track('review', 'book-A', 'J2');
      progressStub.review$.next(progress({ status: 'Failed' }));

      const active = await firstValueFrom(service.activeJobs$);
      expect(active.map(j => j.id)).toEqual(['J1']);
    });
  });

  /**
   * c02. `totalChunks` is ONE wire field with a different UNIT per producer, and no surface labels it.
   * This is the registry-level pin of the decision; `three-surface-parity.spec.ts` pins that all three
   * surfaces actually ask THIS predicate rather than re-testing `totalChunks !== null` locally.
   */
  describe('showsChunkCounts - which KINDS may render a bare completed/total pair', () => {
    const withCounts = (kind: JobKind) => ({ kind, totalChunks: 10 });

    it('shows the pair for a chapter proofread (denominator: TEXT CHUNKS of the chapter)', () => {
      expect(showsChunkCounts(withCounts('proofread'))).toBeTrue();
    });

    it('shows the pair for summary and style-baseline (denominator: the book CHAPTERS)', () => {
      expect(showsChunkCounts(withCounts('summary'))).toBeTrue();
      expect(showsChunkCounts(withCounts('style-baseline'))).toBeTrue();
    });

    it('WITHHOLDS the pair for review: its denominator is map WINDOWS plus reduce passes, not chapters', () => {
      expect(showsChunkCounts(withCounts('review'))).toBeFalse();
    });

    it('withholds the pair from every kind when there is no chunk shape at all (never "0 of 0")', () => {
      for (const kind of ALL_JOB_KINDS) {
        expect(showsChunkCounts({ kind, totalChunks: null })).withContext(kind).toBeFalse();
      }
    });

    it('withholds the pair for a job that is not tracked at all', () => {
      expect(showsChunkCounts(null)).toBeFalse();
      expect(showsChunkCounts(undefined)).toBeFalse();
    });
  });

  /**
   * a1: the ONE definition of "this job belongs to the analysis unit on screen".
   *
   * The analysis panel derives its whole "a run is in flight here" state from this, for an instance that
   * did not start the run and holds no field describing it, so every term is load-bearing: drop the scene
   * term and a scene run disables the chapter panel's analyze button; drop the type term and a Line Edit
   * disables Proofread. Pure and exported so this table can exercise it without a registry.
   */
  describe('jobMatchesAnalysisContext - the (book, chapter, scene, type) unit a run belongs to', () => {
    const ctx = { bookId: 'book-A', chapterId: 'ch-1', sceneId: null, analysisType: 'Proofread' };
    const job = (o: Partial<TrackedJob> = {}) => ({
      kind: 'proofread', bookId: 'book-A', chapterId: 'ch-1', analysisType: 'Proofread', ...o,
    } as unknown as TrackedJob);

    it('matches the same book, chapter, scene and type', () => {
      expect(jobMatchesAnalysisContext(job(), ctx)).toBeTrue();
    });

    it('rejects a different book, chapter or analysis type', () => {
      expect(jobMatchesAnalysisContext(job({ bookId: 'book-B' }), ctx)).toBeFalse();
      expect(jobMatchesAnalysisContext(job({ chapterId: 'ch-2' }), ctx)).toBeFalse();
      expect(jobMatchesAnalysisContext(job({ analysisType: 'LineEdit' }), ctx)).toBeFalse();
    });

    it('is SCENE-PRECISE in both directions, which is why the registry had to start carrying sceneId', () => {
      expect(jobMatchesAnalysisContext(job({ sceneId: 'sc-1' }), ctx))
        .withContext('a scene run must not answer for the chapter-scoped panel')
        .toBeFalse();
      expect(jobMatchesAnalysisContext(job(), { ...ctx, sceneId: 'sc-1' }))
        .withContext('nor the chapter run for the scene-scoped one')
        .toBeFalse();
      expect(jobMatchesAnalysisContext(job({ sceneId: 'sc-1' }), { ...ctx, sceneId: 'sc-1' })).toBeTrue();
    });

    it('rejects a whole-book build, whatever its ids say', () => {
      expect(jobMatchesAnalysisContext(job({ kind: 'review' }), ctx)).toBeFalse();
      expect(jobMatchesAnalysisContext(job({ kind: 'summary' }), ctx)).toBeFalse();
    });

    it('refuses to match on a context with no book or no chapter, rather than matching everything', () => {
      expect(jobMatchesAnalysisContext(job(), { ...ctx, bookId: null })).toBeFalse();
      expect(jobMatchesAnalysisContext(job(), { ...ctx, chapterId: null })).toBeFalse();
    });
  });

  /**
   * THE JobKind COMPLETENESS ORACLE (wave3-spine fixes c08, finding 33).
   *
   * What used to live here was non-falsifiable. It read:
   *
   *     const kinds: JobKind[] = ['summary', 'review', 'proofread', 'style-baseline'];
   *     expect(kinds.length).toBe(4);
   *     expect(kinds).not.toContain('whole-book-analysis' as unknown as JobKind);
   *
   * under a comment claiming "assigning the literal list to JobKind[] ... fails to compile if a member is
   * added". TypeScript gives no such guarantee: a 4-element literal is a perfectly good `JobKind[]` for a
   * union of any size, so a fifth member could land and this stayed green. Both assertions were about a
   * literal constructed two lines above, so neither could ever fail for any reason at all.
   *
   * The replacement follows the completeness-oracle rule: ONE SIDE MUST BE DISCOVERED. The discovered side
   * is {@link ALL_JOB_KINDS}, whose members come from `DEFAULT_TITLES`, a `Record<JobKind, ...>` that
   * TypeScript really does reject when a member is missing. The hand-authored side is `KIND_DECISIONS`
   * below: what this suite has decided about each kind. A new member therefore appears in the discovered
   * list on its own and goes RED here until someone decides it - which is the guarantee the old comment
   * only asserted.
   */
  describe('the JobKind union: every member is served, and every member has been decided', () => {
    /**
     * The HAND-AUTHORED side: one row per kind this suite has reasoned about. Deliberately keyed by
     * `string`, not by `JobKind` - a `Record<JobKind, ...>` here would make TypeScript fill the gap at
     * compile time and the runtime assertion below would become vacuous again, which is the exact failure
     * this block exists to undo.
     */
    const KIND_DECISIONS: Record<string, { chunkCounts: boolean; chapterScoped: boolean }> = {
      'summary': { chunkCounts: true, chapterScoped: false },
      'review': { chunkCounts: false, chapterScoped: false },
      'proofread': { chunkCounts: true, chapterScoped: true },
      'style-baseline': { chunkCounts: true, chapterScoped: false },
    };

    it('has no member this suite has not decided (the discovered set drives the comparison)', () => {
      // Widened to string[] only so both sides of the comparison have the same static type; the VALUES
      // still come from the production enumeration, which is the half that has to be discovered.
      const discovered: string[] = [...ALL_JOB_KINDS].sort();
      expect(discovered)
        .withContext(
          'a JobKind was added or removed: decide its chunk-count and chapter-scope rows in KIND_DECISIONS',
        )
        .toEqual(Object.keys(KIND_DECISIONS).sort());
    });

    it('SERVES every declared kind: each one can be tracked and comes back fully named', () => {
      configure();
      for (const kind of ALL_JOB_KINDS) {
        service.track(kind, 'book-A', `J-${kind}`, { chapterId: 'ch-1' });
      }

      const tracked = currentJobs();
      expect(tracked.length).withContext('one tracked job per declared kind').toBe(ALL_JOB_KINDS.length);
      for (const kind of ALL_JOB_KINDS) {
        const job = tracked.find((j) => j.kind === kind);
        expect(job).withContext(`no producer path for kind "${kind}"`).toBeDefined();
        // A kind with no title / no scope label reaches the Activity Center as a blank row, which is the
        // "dead vocabulary" defect w5 removed `whole-book-analysis` for.
        expect((job?.titleHe ?? '').trim()).withContext(`${kind} he title`).not.toBe('');
        expect((job?.titleEn ?? '').trim()).withContext(`${kind} en title`).not.toBe('');
        expect((job?.scopeLabel ?? '').trim()).withContext(`${kind} scope label`).not.toBe('');
      }
    });

    it('classifies every declared kind the way this suite says it is classified', () => {
      for (const kind of ALL_JOB_KINDS) {
        const decided = KIND_DECISIONS[kind];
        // An undecided kind is already reported by the case above; fail readably here rather than
        // crashing on a property of undefined, so the two reds name the same cause.
        if (!decided) {
          fail(`no KIND_DECISIONS row for "${kind}"`);
          continue;
        }
        expect(showsChunkCounts({ kind, totalChunks: 10 }))
          .withContext(`${kind}: chunk counts`)
          .toBe(decided.chunkCounts);
        expect(CHAPTER_SCOPED_KINDS.has(kind))
          .withContext(`${kind}: chapter-scoped`)
          .toBe(decided.chapterScoped);
      }
    });
  });
});
