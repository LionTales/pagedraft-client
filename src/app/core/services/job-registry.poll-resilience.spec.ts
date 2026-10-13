/**
 * c01 (whole-book proofread fixes): the registry over the REAL AnalysisProgressService.
 *
 * `job-registry.service.spec.ts` stubs the progress service with Subjects, so it can only say what the
 * registry does with an error the poll already decided to raise. These specs put the real poll (real
 * 5 s timer under fakeAsync, every read a held HttpTestingController request) under the registry, so
 * "one failed read in an hour-long run" is driven from the wire: the parent stays running and child
 * discovery keeps going; only a run of failed reads or a 404 ends it; and a parent this client LOST is
 * resumed (a NEW poll, counted on the wire) when it is tracked again, while a server-ended one is not.
 */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { JobRegistryService, TrackedJob } from './job-registry.service';
import { AnalysisProgressService, POLL_TRANSIENT_ERROR_BUDGET } from './analysis-progress.service';
import { AnalysisService } from './analysis.service';
import { BookSummaryService } from './book-summary.service';
import { BookReviewService } from './book-review.service';
import { StyleBaselineService } from './style-baseline.service';
import { BookProofreadService } from './book-proofread.service';
import { AnalysisProgressDto } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';

const URL = '/api/books/book-A/proofread/progress/BP1';
const N = POLL_TRANSIENT_ERROR_BUDGET;

function running(completed: number): AnalysisProgressDto {
  return {
    jobId: 'BP1', analysisType: 'Proofread', scope: 'Book', status: 'Running',
    currentChunk: completed, totalChunks: 3, completedChunks: completed, message: '', estimatedCompletionPercent: 20,
  };
}

function child(jobId: string, chapterId: string): ActiveAnalysisJobDto {
  return {
    jobId, analysisType: 'Proofread', scope: 'Chapter', chapterId, sceneId: null, status: 'Running',
    estimatedCompletionPercent: 0, message: '', lastUpdatedUtc: '2026-10-13T00:00:00Z',
  };
}

describe('JobRegistryService over the real progress poll (c01)', () => {
  let service: JobRegistryService;
  let http: HttpTestingController;
  let getActiveAnalysisJobs: jasmine.Spy;

  beforeEach(() => {
    getActiveAnalysisJobs = jasmine.createSpy('getActiveAnalysisJobs').and.returnValue(of([]));
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        JobRegistryService,
        AnalysisProgressService,
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs } },
        { provide: BookSummaryService, useValue: {} },
        { provide: BookReviewService, useValue: {} },
        { provide: StyleBaselineService, useValue: {} },
        { provide: BookProofreadService, useValue: {} },
      ],
    });
    service = TestBed.inject(JobRegistryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function job(id = 'BP1'): TrackedJob | undefined {
    return ((service as any).jobsSubject.value as TrackedJob[]).find(j => j.id === id);
  }

  function fail(status = 503): void {
    http.expectOne(URL).flush('unavailable', { status, statusText: 'Service Unavailable' });
  }

  function notFound(): void {
    http.expectOne(URL).flush('not found', { status: 404, statusText: 'Not Found' });
  }

  /** End the test's live poll so fakeAsync sees no periodic timer left. */
  function stop(id = 'BP1'): void {
    (service as any).stopPoll(id);
  }

  it('an error then a success keeps the parent running, and child discovery continues', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    http.expectOne(URL).flush(running(0));
    expect(getActiveAnalysisJobs).toHaveBeenCalledTimes(1);

    tick(5000);
    fail();
    expect(job()?.status).withContext('one failed read is not the run failing').toBe('running');
    expect(job()?.endedBy).toBeUndefined();

    getActiveAnalysisJobs.and.returnValue(of([child('child-2', 'ch-2')]));
    tick(5000);
    http.expectOne(URL).flush(running(1));
    expect(job()?.status).toBe('running');
    expect(job()?.completedChunks).toBe(1);
    expect(getActiveAnalysisJobs).withContext('discovery runs on the read after the blip').toHaveBeenCalledTimes(2);
    expect(job('child-2')?.chapterId).toBe('ch-2');

    stop('child-2');
    stop();
    http.match(() => true).forEach(r => r.flush(running(1)));
  }));

  it('N-1 errors then a success keeps the parent running', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    for (let i = 0; i < N - 1; i++) {
      fail();
      tick(5000);
    }
    http.expectOne(URL).flush(running(2));
    expect(job()?.status).toBe('running');
    expect(job()?.completedChunks).toBe(2);
    stop();
  }));

  it('N consecutive errors finalize the parent as failed, ended by a POLL ERROR', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    http.expectOne(URL).flush(running(1));
    for (let i = 0; i < N; i++) {
      tick(5000);
      fail();
    }
    expect(job()?.status).toBe('failed');
    expect(job()?.endedBy).toBe('poll-error');
    expect(job()?.completedChunks).withContext('the last known count is kept').toBe(1);
    tick(5000);
    http.expectNone(URL);
  }));

  it('a 404 finalizes the parent as failed at once, ended by the SERVER', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    notFound();
    expect(job()?.status).toBe('failed');
    expect(job()?.endedBy).toBe('server');
    tick(5000);
    http.expectNone(URL);
  }));

  it('a server terminal is ended by the SERVER', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    http.expectOne(URL).flush({ ...running(3), status: 'Failed' });
    expect(job()?.status).toBe('failed');
    expect(job()?.endedBy).toBe('server');
  }));

  it('re-tracking a LOST parent resumes ONE new poll and keeps its history', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    http.expectOne(URL).flush(running(1));
    const startedAt = job()!.startedAt;
    for (let i = 0; i < N; i++) {
      tick(5000);
      fail();
    }
    expect(job()?.endedBy).toBe('poll-error');

    service.track('book-proofread', 'book-A', 'BP1', { reattached: true });
    expect(job()?.status).toBe('running');
    expect(job()?.endedBy).toBeUndefined();
    expect(job()?.startedAt).toBe(startedAt);
    tick(0);
    // The NEW poll, on the wire.
    http.expectOne(URL).flush(running(2));
    expect(job()?.completedChunks).toBe(2);
    expect(getActiveAnalysisJobs).withContext('the resumed parent discovers children again').toHaveBeenCalledTimes(2);

    // Idempotent once resumed: a second track does not fork a second poll.
    service.track('book-proofread', 'book-A', 'BP1');
    tick(5000);
    http.expectOne(URL).flush({ ...running(3), status: 'Succeeded' });
    expect(job()?.status).toBe('succeeded');
    expect(job()?.endedBy).toBe('server');
  }));

  it('re-tracking a SERVER-ended parent (404) does not resume it: terminal is forever', fakeAsync(() => {
    service.track('book-proofread', 'book-A', 'BP1');
    tick(0);
    notFound();
    service.track('book-proofread', 'book-A', 'BP1', { reattached: true });
    tick(0);
    http.expectNone(URL);
    expect(job()?.status).toBe('failed');
  }));
});
