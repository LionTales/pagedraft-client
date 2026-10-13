/**
 * c03 (whole-book proofread fixes): the registry's handling of a whole-book run's CHILD jobs.
 *
 * (1) Scope labels: child discovery re-tracks every active chapter job on every parent tick, and used to
 *     merge its Hebrew-only default label over a job the live path had worded 'Chapter'. It now never
 *     overwrites an already-tracked job's label, and words a NEW job's default in the book's language.
 * (2) Children: each discovered child carries `parentJobId`; finished children stay out of the retention
 *     cap (and leave once the run ends), and the unscoped readers fold them into the run through
 *     `topLevelJobs`, while the chapter-scoped readers still see them as ordinary `proofread` jobs.
 */
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { CHAPTER_SCOPED_KINDS, JobRegistryService, TrackedJob, topLevelJobs } from './job-registry.service';
import { AnalysisProgressService } from './analysis-progress.service';
import { AnalysisService } from './analysis.service';
import { BookSummaryService } from './book-summary.service';
import { BookReviewService } from './book-review.service';
import { StyleBaselineService } from './style-baseline.service';
import { BookProofreadService } from './book-proofread.service';
import { AnalysisProgressDto } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';

function progress(overrides: Partial<AnalysisProgressDto>): AnalysisProgressDto {
  return {
    jobId: 'j', analysisType: 'Proofread', scope: 'Chapter', status: 'Running', currentChunk: 0,
    totalChunks: 0, completedChunks: 0, message: '', estimatedCompletionPercent: 0, ...overrides,
  };
}

function activeJob(overrides: Partial<ActiveAnalysisJobDto>): ActiveAnalysisJobDto {
  return {
    jobId: 'aj', analysisType: 'Proofread', scope: 'Chapter', chapterId: 'ch-1', sceneId: null, status: 'Running',
    estimatedCompletionPercent: 0, message: '', lastUpdatedUtc: '2026-10-13T00:00:00Z', ...overrides,
  };
}

/** Shared per-poller Subjects (as in job-registry.service.spec.ts): a terminal emit reaches every live poll. */
class ProgressStub {
  summary$ = new Subject<AnalysisProgressDto>();
  bookProofread$ = new Subject<AnalysisProgressDto>();
  chapter$ = new Subject<AnalysisProgressDto>();
  pollBookSummaryProgress() { return this.summary$.asObservable(); }
  pollBookReviewProgress() { return new Subject<AnalysisProgressDto>().asObservable(); }
  pollStyleBaselineProgress() { return new Subject<AnalysisProgressDto>().asObservable(); }
  pollBookProofreadProgress() { return this.bookProofread$.asObservable(); }
  pollProgress() { return this.chapter$.asObservable(); }
}

describe('JobRegistryService: whole-book run children (c03)', () => {
  let service: JobRegistryService;
  let stub: ProgressStub;
  let getActiveAnalysisJobs: jasmine.Spy;
  let bookProofreadStatus: { activeJobId: string | null };

  beforeEach(() => {
    stub = new ProgressStub();
    getActiveAnalysisJobs = jasmine.createSpy('getActiveAnalysisJobs').and.returnValue(of([]));
    bookProofreadStatus = { activeJobId: null };
    TestBed.configureTestingModule({
      providers: [
        JobRegistryService,
        { provide: AnalysisProgressService, useValue: stub },
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => of({ activeBuildJobId: null }) } },
        { provide: BookReviewService, useValue: { getReviewStatus: () => of({ activeBuildJobId: null }) } },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => of({ activeBuildJobId: null }) } },
        { provide: BookProofreadService, useValue: { getStatus: () => of(bookProofreadStatus) } },
      ],
    });
    service = TestBed.inject(JobRegistryService);
  });

  function jobs(): TrackedJob[] {
    return (service as any).jobsSubject.value as TrackedJob[];
  }
  function job(id: string): TrackedJob | undefined {
    return jobs().find(j => j.id === id);
  }
  /** One parent poll tick, whose child-discovery read answers `active`. */
  function parentTick(active: ActiveAnalysisJobDto[], completed = 0): void {
    getActiveAnalysisJobs.and.returnValue(of(active));
    stub.bookProofread$.next(progress({ scope: 'Book', status: 'Running', totalChunks: 30, completedChunks: completed }));
  }

  // ── (1) scope labels ──────────────────────────────────────────────────────────────────────────────

  describe('scope labels', () => {
    it('a live chapter job worded "Chapter" keeps it across discovery ticks (no Hebrew default merged over it)', () => {
      // The registry does not know this book's language (no reattach, a caller that passed none), so the
      // discovery source's default is 'פרק'. Before c03 that default was merged over the live label every tick.
      service.track('book-proofread', 'book-A', 'BP1');
      service.track('proofread', 'book-A', 'LIVE', { analysisType: 'Proofread', chapterId: 'ch-1', scopeLabel: 'Chapter' });

      parentTick([activeJob({ jobId: 'LIVE', chapterId: 'ch-1' })]);
      parentTick([activeJob({ jobId: 'LIVE', chapterId: 'ch-1' })]);

      expect(job('LIVE')?.scopeLabel).toBe('Chapter');
      expect(job('LIVE')?.parentJobId).withContext('the author\'s own run is nobody\'s child').toBeUndefined();
    });

    it('on an English book, a DISCOVERED child and the run itself are worded in English', () => {
      service.track('book-proofread', 'book-A', 'BP1', { language: 'en' });
      parentTick([
        activeJob({ jobId: 'child-1', chapterId: 'ch-1' }),
        activeJob({ jobId: 'child-s', chapterId: 'ch-2', scope: 'Scene', sceneId: 'sc-1' }),
      ]);

      expect(job('BP1')?.scopeLabel).toBe('Whole book');
      expect(job('child-1')?.scopeLabel).toBe('Chapter');
      expect(job('child-s')?.scopeLabel).toBe('Scene');
    });

    it('a Hebrew book (or no language at all) keeps the Hebrew labels', () => {
      service.track('book-proofread', 'book-A', 'BP1', { language: 'he' });
      service.track('book-proofread', 'book-B', 'BP2');
      getActiveAnalysisJobs.and.returnValue(of([activeJob({ jobId: 'child-he', chapterId: 'ch-1' })]));
      stub.bookProofread$.next(progress({ scope: 'Book', status: 'Running', totalChunks: 2 }));

      expect(job('BP1')?.scopeLabel).toBe('הספר כולו');
      expect(job('BP2')?.scopeLabel).toBe('הספר כולו');
      expect(job('child-he')?.scopeLabel).toBe('פרק');
    });

    it('reattach on an English book words every reattached job in English', () => {
      bookProofreadStatus.activeJobId = 'BP1';
      getActiveAnalysisJobs.and.returnValue(of([activeJob({ jobId: 'child-1', chapterId: 'ch-1' })]));
      service.reattach('book-A', 'en-US');

      expect(job('BP1')?.scopeLabel).toBe('Whole book');
      expect(job('child-1')?.scopeLabel).toBe('Chapter');
    });
  });

  // ── (2) children ──────────────────────────────────────────────────────────────────────────────────

  describe('parentJobId', () => {
    it('is set on each discovered Proofread child, from the parent being polled', () => {
      service.track('book-proofread', 'book-A', 'BP1');
      parentTick([activeJob({ jobId: 'child-1', chapterId: 'ch-1' })]);
      expect(job('child-1')?.parentJobId).toBe('BP1');
    });

    it('is set by a reattach that reads the running parent and its current child together', () => {
      bookProofreadStatus.activeJobId = 'BP1';
      getActiveAnalysisJobs.and.returnValue(of([activeJob({ jobId: 'child-1', chapterId: 'ch-1' })]));
      service.reattach('book-A', 'he');
      expect(job('child-1')?.parentJobId).toBe('BP1');
    });

    it('is NOT set on a job of another analysis type the discovery read happens to list', () => {
      service.track('book-proofread', 'book-A', 'BP1');
      parentTick([activeJob({ jobId: 'le-1', analysisType: 'LineEdit', chapterId: 'ch-1' })]);
      expect(job('le-1')?.parentJobId).toBeUndefined();
    });

    it('is cleared when this client tracks the job as its own live run after discovery saw it first', () => {
      service.track('book-proofread', 'book-A', 'BP1');
      parentTick([activeJob({ jobId: 'RACE', chapterId: 'ch-1' })]);
      expect(job('RACE')?.parentJobId).withContext('non-vacuity: discovery tagged it').toBe('BP1');

      service.track('proofread', 'book-A', 'RACE', { analysisType: 'Proofread', chapterId: 'ch-1', scopeLabel: 'Chapter' });
      expect(job('RACE')?.parentJobId).toBeUndefined();
      expect(job('RACE')?.scopeLabel).withContext('a live re-track is authoritative').toBe('Chapter');
    });
  });

  describe('retention cap', () => {
    afterEach(() => jasmine.clock().uninstall());

    it('30 discovered children finishing do not evict 20 unrelated completed jobs', () => {
      jasmine.clock().install();
      let second = 0;
      const step = () => jasmine.clock().mockDate(new Date(Date.UTC(2026, 9, 13, 0, 0, ++second)));

      for (let i = 1; i <= 20; i++) {
        step();
        service.track('summary', 'book-B', `DONE-${i}`);
        stub.summary$.next(progress({ scope: 'Book', status: 'Succeeded' }));
      }
      expect(jobs().filter(j => j.status === 'succeeded').length).withContext('non-vacuity: the cap is full').toBe(20);

      step();
      service.track('book-proofread', 'book-A', 'BP1');
      for (let i = 1; i <= 30; i++) {
        step();
        parentTick([activeJob({ jobId: `child-${i}`, chapterId: `ch-${i}` })], i - 1);
        step();
        stub.chapter$.next(progress({ status: 'Succeeded', totalChunks: 1, completedChunks: 1 }));
        expect(job(`child-${i}`)?.status).withContext(`child-${i} finished and is retained while the run goes on`).toBe('succeeded');
      }

      for (let i = 1; i <= 20; i++) {
        expect(job(`DONE-${i}`)).withContext(`DONE-${i} must survive the run's 30 children`).toBeDefined();
      }

      // The run ends: its finished children leave; the run's own row now counts against the cap.
      step();
      stub.bookProofread$.next(progress({ scope: 'Book', status: 'Succeeded', totalChunks: 30, completedChunks: 30 }));
      expect(jobs().filter(j => j.parentJobId).length).toBe(0);
      expect(job('BP1')?.status).toBe('succeeded');
      expect(job('DONE-1')).withContext('the oldest of 21 top-level completions is the one evicted').toBeUndefined();
      expect(job('DONE-2')).toBeDefined();
    });

    it('a child that finishes AFTER its parent still reaches subscribers as succeeded before it leaves', () => {
      service.track('book-proofread', 'book-A', 'BP1');
      parentTick([activeJob({ jobId: 'child-1', chapterId: 'ch-1' })]);
      stub.bookProofread$.next(progress({ scope: 'Book', status: 'Succeeded', totalChunks: 1, completedChunks: 1 }));
      expect(job('child-1')?.status).withContext('a running child outlives its parent\'s terminal').toBe('running');

      const seen: string[] = [];
      const sub = service.jobs$.subscribe(list => {
        const c = list.find(j => j.id === 'child-1');
        seen.push(c ? c.status : 'gone');
      });
      stub.chapter$.next(progress({ status: 'Succeeded', totalChunks: 1, completedChunks: 1 }));
      sub.unsubscribe();

      expect(seen).toEqual(['running', 'succeeded', 'gone']);
    });
  });

  describe('readers', () => {
    it('one whole-book run is ONE top-level active job, and its child still lights its chapter', () => {
      service.track('book-proofread', 'book-A', 'BP1');
      parentTick([activeJob({ jobId: 'child-3', chapterId: 'ch-3' })]);

      let active: TrackedJob[] = [];
      service.activeJobs$.subscribe(list => (active = list)).unsubscribe();

      expect(topLevelJobs(active).map(j => j.id)).toEqual(['BP1']);
      // The per-chapter readers (book dashboard stage 4, editor spine, import page) read activeJobs$
      // directly and key on CHAPTER_SCOPED_KINDS + chapterId: the child is still there for them.
      const runningChapters = active.filter(j => CHAPTER_SCOPED_KINDS.has(j.kind) && j.chapterId).map(j => j.chapterId);
      expect(runningChapters).toEqual(['ch-3']);
    });

    it('a job the author started meanwhile stays its own top-level job', () => {
      service.track('book-proofread', 'book-A', 'BP1');
      service.track('proofread', 'book-A', 'MINE', { analysisType: 'Proofread', chapterId: 'ch-9', scopeLabel: 'פרק' });
      parentTick([
        activeJob({ jobId: 'child-1', chapterId: 'ch-1' }),
        activeJob({ jobId: 'MINE', chapterId: 'ch-9' }),
      ]);

      let active: TrackedJob[] = [];
      service.activeJobs$.subscribe(list => (active = list)).unsubscribe();
      expect(topLevelJobs(active).map(j => j.id).sort()).toEqual(['BP1', 'MINE']);
    });
  });
});
