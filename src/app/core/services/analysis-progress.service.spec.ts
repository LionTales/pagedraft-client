import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { AnalysisProgressService, POLL_TRANSIENT_ERROR_BUDGET, isJobUnknownError } from './analysis-progress.service';
import { AnalysisProgressDto } from '../models/analysis';

describe('AnalysisProgressService', () => {
  let service: AnalysisProgressService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AnalysisProgressService],
    });

    service = TestBed.inject(AnalysisProgressService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('exposes a polling observable that can be cancelled via stop$', () => {
    const stop$ = new Subject<void>();

    const sub = service
      // Small interval so the observable would poll if not cancelled; in this
      // focused test we simply ensure that subscribe/unsubscribe wiring works
      // without forcing timers to elapse.
      .pollProgress('book-1', 'chap-1', 'job-1', stop$ as unknown as any, 10)
      .subscribe();

    expect(sub.closed).toBeFalse();

    stop$.next();
    stop$.complete();
    sub.unsubscribe();

    expect(sub.closed).toBeTrue();
  });

  // ── c01: a failed read is not the end of the poll ─────────────────────────────────────────────────
  //
  // Before c01 the first failed read errored the poll, and every consumer reads that error as the job's
  // terminal: one blip in an hour of 5 s polls ended a whole-book proofread as "failed" in the client.
  // Every read here is a real HttpTestingController request driven by the real 5 s timer under fakeAsync.
  describe('c01 transient-error budget', () => {
    const URL = '/api/books/book-1/proofread/progress/job-1';
    const N = POLL_TRANSIENT_ERROR_BUDGET;

    function running(completed = 1): AnalysisProgressDto {
      return {
        jobId: 'job-1', analysisType: 'Proofread', scope: 'Book', status: 'Running',
        currentChunk: completed, totalChunks: 3, completedChunks: completed, message: '', estimatedCompletionPercent: 30,
      };
    }

    interface Probe { seen: AnalysisProgressDto[]; error: unknown; errored: boolean; completed: boolean; stop$: Subject<void> }

    function subscribe(poll$: (stop$: Observable<void>) => Observable<AnalysisProgressDto> =
      stop$ => service.pollBookProofreadProgress('book-1', 'job-1', stop$)): Probe {
      const probe: Probe = { seen: [], error: null, errored: false, completed: false, stop$: new Subject<void>() };
      poll$(probe.stop$).subscribe({
        next: p => probe.seen.push(p),
        error: e => { probe.error = e; probe.errored = true; },
        complete: () => { probe.completed = true; },
      });
      return probe;
    }

    /** Answer the read that is due now with a server error (5xx). */
    function fail(url = URL, status = 503): void {
      http.expectOne(url).flush('unavailable', { status, statusText: 'Service Unavailable' });
    }

    it('the budget is 6 consecutive failures (30 s at the 5 s interval)', () => {
      expect(N).toBe(6);
    });

    it('an error then a success keeps the poll running, and the retry waits the NORMAL interval', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      fail();
      expect(probe.errored).withContext('one failed read must not end the poll').toBeFalse();

      tick(4999);
      http.expectNone(URL); // not an immediate retry: the next read is the next tick
      tick(1);
      http.expectOne(URL).flush(running());
      expect(probe.seen.length).toBe(1);
      expect(probe.errored).toBeFalse();
      expect(probe.completed).toBeFalse();

      tick(5000);
      http.expectOne(URL).flush(running(2));
      expect(probe.seen.length).withContext('the poll is still live after the recovery').toBe(2);
      probe.stop$.next();
    }));

    it('a network failure (status 0) is retried like a 5xx', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      http.expectOne(URL).error(new ProgressEvent('error'));
      tick(5000);
      http.expectOne(URL).flush(running());
      expect(probe.errored).toBeFalse();
      expect(probe.seen.length).toBe(1);
      probe.stop$.next();
    }));

    it('N-1 consecutive errors then a success keeps running, and the success RESETS the count', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      for (let i = 0; i < N - 1; i++) {
        fail();
        tick(5000);
      }
      http.expectOne(URL).flush(running());
      expect(probe.errored).toBeFalse();
      expect(probe.seen.length).toBe(1);

      // Another N-1 failures after the success: the budget bounds a CONTINUOUS outage, not the run's total.
      for (let i = 0; i < N - 1; i++) {
        tick(5000);
        fail();
      }
      expect(probe.errored).withContext(`${2 * (N - 1)} errors in total, never ${N} in a row`).toBeFalse();
      tick(5000);
      http.expectOne(URL).flush(running(2));
      expect(probe.seen.length).toBe(2);
      probe.stop$.next();
    }));

    it('N consecutive errors end the poll with the last error, and no further read is made', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      for (let i = 0; i < N - 1; i++) {
        fail();
        tick(5000);
        expect(probe.errored).toBeFalse();
      }
      fail(URL, 502);
      expect(probe.errored).toBeTrue();
      expect((probe.error as HttpErrorResponse).status).toBe(502);
      expect(isJobUnknownError(probe.error)).toBeFalse();

      tick(5000);
      http.expectNone(URL);
    }));

    it('a 404 (job unknown or pruned) ends the poll at once', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      http.expectOne(URL).flush('not found', { status: 404, statusText: 'Not Found' });
      expect(probe.errored).toBeTrue();
      expect(isJobUnknownError(probe.error)).toBeTrue();
      tick(5000);
      http.expectNone(URL);
    }));

    it('a 404 after earlier transient errors still ends the poll at once', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      fail();
      tick(5000);
      http.expectOne(URL).flush('not found', { status: 404, statusText: 'Not Found' });
      expect(probe.errored).toBeTrue();
      tick(5000);
      http.expectNone(URL);
    }));

    it('a terminal status still completes the poll (unchanged)', fakeAsync(() => {
      const probe = subscribe();
      tick(0);
      fail();
      tick(5000);
      http.expectOne(URL).flush({ ...running(3), status: 'Succeeded' });
      expect(probe.completed).toBeTrue();
      tick(5000);
      http.expectNone(URL);
    }));

    it('two subscribers keep separate counts', fakeAsync(() => {
      const poll$ = service.pollBookProofreadProgress('book-1', 'job-1', new Subject<void>());
      let aErrored = false;
      let bErrored = false;
      const a = poll$.subscribe({ error: () => { aErrored = true; } });
      tick(0);
      // A burns N-1 failures before B even subscribes.
      for (let i = 0; i < N - 1; i++) {
        fail();
        tick(5000);
      }
      const b = poll$.subscribe({ error: () => { bErrored = true; } });
      tick(0);
      // Two reads are now due (A's Nth, B's first): both fail.
      for (const req of http.match(URL)) req.flush('x', { status: 503, statusText: 'Service Unavailable' });
      expect(aErrored).toBeTrue();
      expect(bErrored).withContext('B has failed once, not N times').toBeFalse();
      a.unsubscribe();
      b.unsubscribe();
    }));

    // Population: every progress route shares the one helper. Each poller survives N-1 failures and ends
    // on the Nth, at its own URL.
    const POLLERS: Array<{ name: string; url: string; poll: (s: AnalysisProgressService, stop$: Observable<void>) => Observable<AnalysisProgressDto> }> = [
      { name: 'pollProgress (chapter)', url: '/api/books/b/chapters/c/analysis-progress/j', poll: (s, stop$) => s.pollProgress('b', 'c', 'j', stop$) },
      { name: 'pollBookSummaryProgress', url: '/api/books/b/summary/progress/j', poll: (s, stop$) => s.pollBookSummaryProgress('b', 'j', stop$) },
      { name: 'pollBookReviewProgress', url: '/api/books/b/review/progress/j', poll: (s, stop$) => s.pollBookReviewProgress('b', 'j', stop$) },
      { name: 'pollBookProofreadProgress', url: '/api/books/b/proofread/progress/j', poll: (s, stop$) => s.pollBookProofreadProgress('b', 'j', stop$) },
      { name: 'pollStyleBaselineProgress', url: '/api/books/b/style-baseline/progress/j', poll: (s, stop$) => s.pollStyleBaselineProgress('b', 'j', stop$) },
    ];
    for (const p of POLLERS) {
      it(`${p.name} shares the budget`, fakeAsync(() => {
        const probe = subscribe(stop$ => p.poll(service, stop$));
        tick(0);
        for (let i = 0; i < N - 1; i++) {
          fail(p.url);
          tick(5000);
        }
        expect(probe.errored).toBeFalse();
        fail(p.url);
        expect(probe.errored).toBeTrue();
      }));
    }
  });
});
