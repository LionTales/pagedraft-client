import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import {
  JobRegistryService,
  TrackedJob,
  normalizeProgress,
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
});
