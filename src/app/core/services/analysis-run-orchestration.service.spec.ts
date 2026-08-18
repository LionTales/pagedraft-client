import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, NEVER, Subject, of } from 'rxjs';
import {
  AnalysisRunOrchestrationService,
  AnalysisRunContext,
  AnalysisRunEvent,
  RUN_START_BUDGET_MS,
} from './analysis-run-orchestration.service';
import { AnalysisService } from './analysis.service';
import { AnalysisProgressService } from './analysis-progress.service';
import { AnalysisProgressDto, AnalysisResultDto } from '../models/analysis';
import { RunStringKey, runString } from '../i18n/run-strings';

function ctx(overrides: Partial<AnalysisRunContext>): AnalysisRunContext {
  return {
    bookId: 'b',
    chapterId: 'c',
    sceneId: null,
    selectedAnalysisType: 'Proofread',
    language: 'en',
    documentText: '',
    ...overrides,
  };
}

describe('AnalysisRunOrchestrationService', () => {
  let service: AnalysisRunOrchestrationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            run: () => of({}),
            startAsync: () => of({ jobId: 'j-1' }),
            getByJob: () => of({}),
            runStream: () => of(''),
          },
        },
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => of(),
          },
        },
      ],
    });
    service = TestBed.inject(AnalysisRunOrchestrationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('shouldUseAsyncJob', () => {
    it('returns true (always) for single-shot whole-chapter types, even with no documentText', () => {
      // Wave 3 / w7: 'Custom' was a fourth member of this list and is no longer startable.
      for (const t of ['LinguisticAnalysis', 'LiteraryAnalysis', 'Summarization']) {
        expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: t, documentText: '' }))).toBeTrue();
      }
    });

    it('returns false for an unrecognized/inline type', () => {
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'General', documentText: 'a '.repeat(1000) }))).toBeFalse();
    });

    it('returns false when documentText is empty or null', () => {
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: '' }))).toBeFalse();
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: null! }))).toBeFalse();
    });

    it('returns true for Proofread when word count exceeds threshold (default 500)', () => {
      const longText = Array(501).fill('word').join(' ');
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: longText }))).toBeTrue();
    });

    it('returns false for Proofread when word count is at or below threshold', () => {
      const shortText = Array(500).fill('word').join(' ');
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: shortText }))).toBeFalse();
    });

    it('returns true for LineEdit when word count exceeds threshold (default 1500)', () => {
      const longText = Array(1501).fill('word').join(' ');
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'LineEdit', documentText: longText }))).toBeTrue();
    });

    it('returns false for LineEdit when word count is at or below threshold', () => {
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'LineEdit', documentText: 'one' }))).toBeFalse();
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'LineEdit', documentText: Array(1500).fill('word').join(' ') }))).toBeFalse();
    });

    it('uses custom proofreadChunkTargetWords / lineEditChunkTargetWords from context', () => {
      // LineEdit with server threshold 500: 600 words → async
      expect(service.shouldUseAsyncJob(ctx({
        selectedAnalysisType: 'LineEdit',
        documentText: Array(600).fill('w').join(' '),
        lineEditChunkTargetWords: 500,
      }))).toBeTrue();
      // LineEdit with server threshold 500: 400 words → sync
      expect(service.shouldUseAsyncJob(ctx({
        selectedAnalysisType: 'LineEdit',
        documentText: Array(400).fill('w').join(' '),
        lineEditChunkTargetWords: 500,
      }))).toBeFalse();
    });
  });

  describe('handleProgressUpdate', () => {
    it('builds human-readable status with completedChunks for Proofread', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'running',
        currentChunk: 2,
        totalChunks: 5,
        completedChunks: 2,
        message: '',
        estimatedCompletionPercent: 40,
      };
      const result = service.handleProgressUpdate(progress, 'en');
      expect(result.message).toContain('Proofread');
      expect(result.message).toContain('2 of 5 completed');
      expect(result.progressPercent).toBe(40);
    });

    it('shows "analyzing…" when completedChunks is 0', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'running',
        currentChunk: 1,
        totalChunks: 3,
        completedChunks: 0,
        message: '',
        estimatedCompletionPercent: 0,
      };
      const result = service.handleProgressUpdate(progress, 'en');
      expect(result.message).toContain('Proofread');
      expect(result.message).toContain('analyzing...');
      expect(result.progressPercent).toBe(0);
    });

    it('uses "Line Edit" label and server estimatedCompletionPercent', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'LineEdit',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'running',
        currentChunk: 1,
        totalChunks: 3,
        completedChunks: 1,
        message: '',
        estimatedCompletionPercent: 33,
      };
      const result = service.handleProgressUpdate(progress, 'en');
      expect(result.message).toContain('Line Edit');
      expect(result.message).toContain('1 of 3 completed');
      expect(result.progressPercent).toBe(33);
    });

    it('reports failed status', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'failed',
        currentChunk: 0,
        totalChunks: 0,
        completedChunks: 0,
        message: '',
        estimatedCompletionPercent: -1,
      };
      const result = service.handleProgressUpdate(progress, 'en');
      expect(result.status).toBe('failed');
      expect(result.message).toContain('failed');
    });

    it('returns 100% when status is succeeded', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'succeeded',
        currentChunk: 3,
        totalChunks: 3,
        completedChunks: 3,
        message: '',
        estimatedCompletionPercent: 100,
      };
      const result = service.handleProgressUpdate(progress, 'en');
      expect(result.progressPercent).toBe(100);
    });
  });

  describe('formatRunDuration', () => {
    it('returns null when runStartedAt is null', () => {
      expect(service.formatRunDuration(null, 'en')).toBeNull();
    });

    it('returns a seconds label for recent timestamps', () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const label = service.formatRunDuration(now - 5000, 'en', now);
      expect(label).toMatch(/^\d+s$/);
    });
  });

  describe('emitInitialStatusForRun', () => {
    it('returns a status string including analysis type', () => {
      const status = service.emitInitialStatusForRun(ctx({ selectedAnalysisType: 'Proofread', documentText: 'short text' }));
      expect(status).toContain('Proofread');
    });

    it('includes streaming indicator when streaming is true', () => {
      const status = service.emitInitialStatusForRun(ctx({ selectedAnalysisType: 'Summarization', documentText: 'text' }), true);
      expect(status).toContain('streaming');
    });
  });

  describe('doRunStreaming', () => {
    it('stamps the synthetic streaming-complete result with the run language', () => {
      const events: any[] = [];
      service
        .doRunStreaming(ctx({ selectedAnalysisType: 'LinguisticAnalysis', language: 'en' }))
        .subscribe(e => events.push(e));

      const complete = events.find(e => e.kind === 'streaming-complete');
      expect(complete).withContext('a streaming-complete event should be emitted').toBeTruthy();
      // Without the language stamp, LinguisticResultComponent defaults to Hebrew (RTL + Hebrew labels),
      // so an English run would render with the wrong direction/labels.
      expect(complete.latestResult.language).toBe('en');
      expect(complete.latestResult.analysisType).toBe('LinguisticAnalysis');
    });
  });
});

/**
 * c01: the bounded read-after-write retry on `loadFinalResultForJob`.
 *
 * THE DEFECT. This read fires the instant the progress poll reports `succeeded`, and it used to make ONE
 * `getByJob` call whose every failure became `{ kind: 'error' }`. The panel sets `runError` from that and
 * the run dialog latches a FAILED terminal - for an analysis the server had actually persisted. The user
 * reproduced it on a 10-chunk Hebrew Proofread: a failure banner, and the correct analysis sitting there
 * after a browser refresh.
 *
 * WHY THE STUB IS A SUBJECT, ONE PER CALL. Every case here lives in the window between "the request went
 * out" and "it answered". A synchronous `of()` / `throwError()` closes that window inside the subscribe
 * call, so the retry finishes before the first assertion runs and the test passes just as happily against
 * the one-shot version. Holding each attempt open makes "how many requests exist", "which of them have
 * answered" and "what the caller has been told so far" three separately observable facts, and `fakeAsync`
 * + `tick` makes the DELAY between attempts a fact too rather than something inferred from a call count.
 */
describe('AnalysisRunOrchestrationService final-result read-after-write retry (c01)', () => {
  let service: AnalysisRunOrchestrationService;
  /** One open Subject per `getByJob` CALL, in call order. Its length IS the attempt count. */
  let attempts: Subject<AnalysisResultDto>[];

  /** The budget the production code must be honouring: 1 initial attempt + 3 retries, 600ms apart. */
  const RETRY_DELAY_MS = 600;
  const MAX_RETRIES = 3;
  const MAX_ATTEMPTS = MAX_RETRIES + 1;

  function notFound(): HttpErrorResponse {
    return new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
  }

  function serverError(): HttpErrorResponse {
    return new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });
  }

  function persistedRow(): AnalysisResultDto {
    return {
      id: 'r-1',
      chapterId: 'chap-A',
      jobId: 'job-1',
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the persisted output',
      createdAt: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    attempts = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getByJob: () => {
              const attempt = new Subject<AnalysisResultDto>();
              attempts.push(attempt);
              return attempt.asObservable();
            },
          },
        },
        { provide: AnalysisProgressService, useValue: { pollProgress: () => NEVER } },
      ],
    });
    service = TestBed.inject(AnalysisRunOrchestrationService);
  });

  it('retries a 404 and reports job-result once the row appears, never an error', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.loadFinalResultForJob('book-1', 'chap-A', 'job-1', 'en').subscribe(e => events.push(e));

    expect(attempts.length).withContext('the first read goes out immediately').toBe(1);

    // The server has not committed the row yet.
    attempts[0].error(notFound());

    expect(events.length)
      .withContext('a single transient 404 must not be reported at all yet - reporting it is the defect: '
        + 'the panel sets runError from it and the run dialog latches a FAILED terminal for an analysis '
        + 'the server persisted')
      .toBe(0);
    expect(attempts.length).withContext('the retry WAITS for the delay; it must not hammer').toBe(1);

    tick(RETRY_DELAY_MS);
    expect(attempts.length).withContext('exactly one retry per elapsed delay').toBe(2);

    // The row has landed now.
    attempts[1].next(persistedRow());
    attempts[1].complete();

    expect(events.map(e => e.kind))
      .withContext('the run succeeded, so the ONLY event is the result - no error crosses the channel')
      .toEqual(['job-result']);
    expect((events[0] as { kind: 'job-result'; result: AnalysisResultDto }).result.id).toBe('r-1');

    sub.unsubscribe();
  }));

  it('surfaces the error when the 404 outlives the retry budget', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.loadFinalResultForJob('book-1', 'chap-A', 'job-1', 'en').subscribe(e => events.push(e));

    // Every attempt 404s, forever.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(attempts.length).withContext(`attempt ${i + 1} must have been issued`).toBe(i + 1);
      attempts[i].error(notFound());
      if (i < MAX_RETRIES) {
        expect(events.length).withContext('still inside the budget: nothing reported yet').toBe(0);
        tick(RETRY_DELAY_MS);
      }
    }

    expect(attempts.length)
      .withContext(`the retry is BOUNDED at 1 + ${MAX_RETRIES} attempts; an unbounded retry would hide a `
        + 'genuinely missing result forever')
      .toBe(MAX_ATTEMPTS);
    expect(events.length).toBe(1);
    expect(events[0].kind)
      .withContext('a 404 that persists past the budget is a real failure and must still reach the user')
      .toBe('error');

    // Nothing is still pending: no further attempt, and fakeAsync would fail on a leftover timer.
    tick(RETRY_DELAY_MS * 4);
    expect(attempts.length).toBe(MAX_ATTEMPTS);

    sub.unsubscribe();
  }));

  it('does NOT retry a non-404 error: a 500 surfaces on the first attempt', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.loadFinalResultForJob('book-1', 'chap-A', 'job-1', 'en').subscribe(e => events.push(e));

    expect(attempts.length).toBe(1);
    attempts[0].error(serverError());

    expect(events.length)
      .withContext('a 500 is not replica lag - re-asking cannot help, so it must surface immediately '
        + 'instead of making the user wait out a budget that was never going to pay off')
      .toBe(1);
    expect(events[0].kind).toBe('error');

    tick(RETRY_DELAY_MS * MAX_ATTEMPTS);
    expect(attempts.length)
      .withContext('exactly one attempt for a non-404: the retry must be narrow, not a blanket retry')
      .toBe(1);

    sub.unsubscribe();
  }));

  it('gives every run a FULL fresh budget: the counter is subscription-scoped, not service state', fakeAsync(() => {
    /** 404 the attempt that is currently open, if there is one. */
    const fail404 = () => attempts[attempts.length - 1]?.error(notFound());

    // Run 1 spends its whole budget on a job whose row never appears.
    const sub1 = service.loadFinalResultForJob('book-1', 'chap-A', 'job-1', 'en').subscribe();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      fail404();
      if (i < MAX_RETRIES) tick(RETRY_DELAY_MS);
    }
    sub1.unsubscribe();

    // Run 2 starts (a new run, or the same run after a context change). It must not inherit a spent
    // budget: this is the reset discipline, and the mechanism is that there is no counter FIELD on this
    // root singleton to leave stale in the first place.
    const before = attempts.length;
    const events: AnalysisRunEvent[] = [];
    const sub2 = service.loadFinalResultForJob('book-1', 'chap-B', 'job-2', 'en').subscribe(e => events.push(e));

    expect(attempts.length).withContext('run 2 issues its own first read').toBe(before + 1);
    fail404();
    tick(RETRY_DELAY_MS);
    expect(attempts.length)
      .withContext('the second run must still get its retries; a budget carried over from run 1 would '
        + 'have been exhausted here and this 404 would have gone straight to the user')
      .toBe(before + 2);

    attempts[attempts.length - 1].next(persistedRow());
    attempts[attempts.length - 1].complete();
    expect(events.map(e => e.kind)).toEqual(['job-result']);

    sub2.unsubscribe();
  }));

  it('cannot outlive the run: unsubscribing cancels a pending retry', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.loadFinalResultForJob('book-1', 'chap-A', 'job-1', 'en').subscribe(e => events.push(e));

    attempts[0].error(notFound());
    // The panel unsubscribes on ngOnDestroy and when the next run starts. The retry lives inside this
    // subscription, so that teardown must take the pending timer with it.
    sub.unsubscribe();

    tick(RETRY_DELAY_MS * MAX_ATTEMPTS);
    expect(attempts.length)
      .withContext('a retry that survives its own run would re-issue a request for a run nobody is '
        + 'listening to (and fakeAsync would flag the orphaned timer)')
      .toBe(1);
    expect(events.length)
      .withContext('a cancelled run must be told nothing at all - least of all that its transient 404 was '
        + 'a failure')
      .toBe(0);
  }));
});

/**
 * c02: EVERY string this service composes is localized, and it composes them in the RUN's language.
 *
 * The enumeration in the plan's `## c02 decision` is the checklist; this describe walks it. The
 * assertions are deliberately paired - the exact expected sentence AND "no Latin letters at all in the
 * Hebrew one" - because the exact-sentence half alone would still pass if someone put English into the
 * Hebrew map, and the no-Latin half alone would pass for an empty string.
 *
 * `ctx.language` is the panel's normalized `bookLanguage`, so composing here in that language puts the
 * same language on the run dialog (book-scoped) and on the panel banner (book-scoped) that render it.
 */
describe('AnalysisRunOrchestrationService run-string localization (c02)', () => {
  let service: AnalysisRunOrchestrationService;
  let runSubject: Subject<AnalysisResultDto>;
  let progressSubject: Subject<AnalysisProgressDto>;
  let getByJobSubject: Subject<AnalysisResultDto>;

  const LONG_PROOFREAD = Array(1200).fill('word').join(' ');

  function noLatin(value: string | null | undefined): void {
    expect(value ?? '')
      .withContext('a Hebrew book must show no Latin-script run chrome')
      .not.toMatch(/[A-Za-z]/);
  }

  function progressDto(overrides: Partial<AnalysisProgressDto>): AnalysisProgressDto {
    return {
      jobId: 'job-1', analysisType: 'Proofread', scope: 'Chapter',
      status: 'running', currentChunk: 0, totalChunks: 0, completedChunks: 0,
      // Backend prose that must never survive into a composed message.
      message: 'Running chunk 3/10', estimatedCompletionPercent: -1,
      ...overrides,
    };
  }

  beforeEach(() => {
    runSubject = new Subject<AnalysisResultDto>();
    progressSubject = new Subject<AnalysisProgressDto>();
    getByJobSubject = new Subject<AnalysisResultDto>();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            run: () => runSubject.asObservable(),
            startAsync: () => of({ jobId: 'job-1' }),
            getByJob: () => getByJobSubject.asObservable(),
            runStream: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollProgress: () => progressSubject.asObservable() } },
      ],
    });
    service = TestBed.inject(AnalysisRunOrchestrationService);
  });

  describe('emitInitialStatusForRun', () => {
    it('composes the plain start message in each language', () => {
      const he = service.emitInitialStatusForRun(ctx({ language: 'he', documentText: 'short' }));
      expect(he).toBe(runString('he', 'runStarting', { type: 'הגהה' }));
      noLatin(he);
      expect(service.emitInitialStatusForRun(ctx({ language: 'en', documentText: 'short' })))
        .toBe(runString('en', 'runStarting', { type: 'Proofread' }));
    });

    it('composes the CHUNKED start message (the "about N parts" family) in each language', () => {
      const he = service.emitInitialStatusForRun(ctx({ language: 'he', documentText: LONG_PROOFREAD }));
      expect(he).toBe(runString('he', 'runChunked', { type: 'הגהה', parts: 3, words: 500 }));
      noLatin(he);
      expect(service.emitInitialStatusForRun(ctx({ language: 'en', documentText: LONG_PROOFREAD })))
        .toBe(runString('en', 'runChunked', { type: 'Proofread', parts: 3, words: 500 }));
    });

    it('composes the STREAMING variants in each language', () => {
      noLatin(service.emitInitialStatusForRun(ctx({ language: 'he', documentText: 'short' }), true));
      noLatin(service.emitInitialStatusForRun(ctx({ language: 'he', documentText: LONG_PROOFREAD }), true));
      expect(service.emitInitialStatusForRun(ctx({ language: 'en', documentText: 'short' }), true))
        .toBe(runString('en', 'runStartingStreaming', { type: 'Proofread' }));
    });

    it('uses the shared LineEdit label rather than a raw type name', () => {
      const he = service.emitInitialStatusForRun(ctx({
        language: 'he', selectedAnalysisType: 'LineEdit', documentText: Array(3200).fill('w').join(' '),
      }));
      expect(he).toContain('עריכת שורה');
      noLatin(he);
    });
  });

  describe('handleProgressUpdate', () => {
    const cases: {
      name: string;
      dto: Partial<AnalysisProgressDto>;
      key: RunStringKey;
      params?: Record<string, string | number>;
    }[] = [
      { name: 'failed', dto: { status: 'failed' }, key: 'runFailed' },
      { name: 'canceled', dto: { status: 'canceled' }, key: 'runCanceled' },
      { name: 'chunks completed', dto: { totalChunks: 5, completedChunks: 2 }, key: 'progressCompleted', params: { completed: 2, total: 5 } },
      { name: 'chunked, none done yet', dto: { totalChunks: 5 }, key: 'progressAnalyzing' },
      { name: 'pending', dto: { status: 'pending' }, key: 'progressPreparing' },
      { name: 'running, not yet chunked', dto: {}, key: 'progressRunning' },
    ];

    for (const c of cases) {
      it(`composes the "${c.name}" message in Hebrew, never echoing the backend prose`, () => {
        const message = service.handleProgressUpdate(progressDto(c.dto), 'he').message;
        expect(message).toBe(runString('he', c.key, { type: 'הגהה', ...(c.params ?? {}) }));
        noLatin(message);
      });

      it(`composes the "${c.name}" message in English for an English book`, () => {
        expect(service.handleProgressUpdate(progressDto(c.dto), 'en').message)
          .toBe(runString('en', c.key, { type: 'Proofread', ...(c.params ?? {}) }));
      });
    }
  });

  describe('the async-job status and failure messages', () => {
    it('composes the job-started status in the run language', () => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.doRunAnalysisAsyncJob(ctx({ language: 'he', documentText: LONG_PROOFREAD }))
        .subscribe(e => events.push(e));

      const status = events.find(e => e.kind === 'status') as { message: string };
      expect(status.message).toBe(runString('he', 'jobStarted', { type: 'הגהה' }));
      noLatin(status.message);
      sub.unsubscribe();
    });

    it('composes the FAILED terminal error in the run language', () => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.startProgressPollingForJob('b', 'c', 'job-1', 'Proofread', 'he')
        .subscribe(e => events.push(e));

      progressSubject.next(progressDto({ status: 'failed', message: 'System.Exception: boom' }));

      const error = events.find(e => e.kind === 'error') as { message: string };
      expect(error.message).toBe(runString('he', 'runFailed', { type: 'הגהה' }));
      noLatin(error.message);
      sub.unsubscribe();
    });

    it('composes the poll-error fallback status in the run language', () => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.startProgressPollingForJob('b', 'c', 'job-1', 'LineEdit', 'he')
        .subscribe(e => events.push(e));

      progressSubject.error(new Error('poll died'));

      const status = events.find(e => e.kind === 'status') as { message: string };
      expect(status.message).toBe(runString('he', 'runStarting', { type: 'עריכת שורה' }));
      noLatin(status.message);
      sub.unsubscribe();
    });
  });

  describe('loadFinalResultForJob', () => {
    it('composes the read failure in the run language once the retry budget is spent', fakeAsync(() => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.loadFinalResultForJob('b', 'c', 'job-1', 'he').subscribe(e => events.push(e));

      // Exhaust the c01 budget (1 + 3) so the TERMINAL error is the one under test.
      for (let i = 0; i < 4; i++) {
        getByJobSubject.error(new HttpErrorResponse({ status: 404 }));
        getByJobSubject = new Subject<AnalysisResultDto>();
        tick(600);
      }

      const error = events.find(e => e.kind === 'error') as { message: string } | undefined;
      expect(error).withContext('a persistent 404 must still surface as an error (c01)').toBeTruthy();
      expect(error!.message).toBe(runString('he', 'loadFinalResultFailed'));
      noLatin(error!.message);
      sub.unsubscribe();
    }));
  });

  describe('the sync-path HTTP failure message', () => {
    it('falls back to the LOCALIZED sentence when the server sent no error body', () => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.doRunAnalysisSync(ctx({ language: 'he', documentText: 'short' }))
        .subscribe(e => events.push(e));

      // A transport failure: Angular's own `err.message` is English and used to shadow the fallback.
      runSubject.error(new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' }));

      const error = events.find(e => e.kind === 'error') as { message: string };
      expect(error.message).toBe(runString('he', 'analysisFailed'));
      noLatin(error.message);
      sub.unsubscribe();
    });

    it('PASSES THROUGH a server-sent { error } body: it is data, not chrome (the documented exception)', () => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.doRunAnalysisSync(ctx({ language: 'he', documentText: 'short' }))
        .subscribe(e => events.push(e));

      runSubject.error(new HttpErrorResponse({ status: 400, error: { error: 'Proofread text is too long' } }));

      // The reason a request was rejected is the only actionable thing the user has; replacing it with a
      // generic localized sentence would discard it. Localizing it needs a server error-CODE contract.
      expect((events.find(e => e.kind === 'error') as { message: string }).message)
        .toBe('Proofread text is too long');
      sub.unsubscribe();
    });
  });

  describe('confirmReanalysisIfPendingSuggestions', () => {
    it('asks in Hebrew, with the scope word localized too', () => {
      const confirm = spyOn(window, 'confirm').and.returnValue(true);

      service.confirmReanalysisIfPendingSuggestions(1, 'chapter', 'he');
      expect(confirm.calls.mostRecent().args[0])
        .toBe(runString('he', 'reanalysisConfirmOne', { scope: runString('he', 'scopeChapter') }));
      noLatin(confirm.calls.mostRecent().args[0]);

      service.confirmReanalysisIfPendingSuggestions(4, 'scene', 'he');
      expect(confirm.calls.mostRecent().args[0])
        .toBe(runString('he', 'reanalysisConfirmMany', { scope: runString('he', 'scopeScene'), count: 4 }));
      noLatin(confirm.calls.mostRecent().args[0]);
    });

    it('asks in English for an English book (the control)', () => {
      const confirm = spyOn(window, 'confirm').and.returnValue(true);
      service.confirmReanalysisIfPendingSuggestions(2, 'scene', 'en');
      expect(confirm.calls.mostRecent().args[0])
        .toBe(runString('en', 'reanalysisConfirmMany', { scope: 'scene', count: 2 }));
    });

    it('does not prompt at all when nothing is pending', () => {
      const confirm = spyOn(window, 'confirm').and.returnValue(true);
      expect(service.confirmReanalysisIfPendingSuggestions(0, 'chapter', 'he')).toBeTrue();
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe('formatRunDuration', () => {
    it('renders the elapsed label in the run language, with no Latin unit in Hebrew', () => {
      const now = 1_000_000;
      expect(service.formatRunDuration(now - 5_000, 'en', now)).toBe('5s');
      const he = service.formatRunDuration(now - 5_000, 'he', now);
      expect(he).toBe(runString('he', 'durationSeconds', { seconds: 5 }));
      noLatin(he);
    });
  });

});

/**
 * c01 (run-dialog-starting-state-escape): the bounded START budget.
 *
 * THE DEFECT. The run dialog is MODAL while a run is live, and its state (a) lasts until the first
 * event arrives. Nothing bounded that wait, so a request that never answered left the entire app behind
 * a scrim with an `inert` background and an indeterminate bar, indefinitely - reported by the user as an
 * endless wait on 2026-08-03.
 *
 * THE MEASUREMENT behind the budget (also recorded in the plan's `## c01 decision`): with a socket on
 * :5114 that ACCEPTS the connection and never replies - an API mid-start, or a wedged model runner - a
 * request through the dev proxy was still open at 100 seconds, which was the measuring client's own
 * timeout rather than any bound in the browser, the proxy or this client. The wait genuinely had no
 * ceiling.
 *
 * WHY THE STUBS ARE `NEVER` AND SUBJECTS. Every case here lives in the window between "the request went
 * out" and "it answered". A synchronous `of()` closes that window inside the subscribe call, so the run
 * would resolve before the first assertion and a version with no guard at all would pass. `fakeAsync` +
 * `tick` then makes the BUDGET itself a fact rather than something inferred.
 */
describe('AnalysisRunOrchestrationService bounded start budget (c01)', () => {
  /** The one call the sync route makes; held open so the run stays silent. */
  let runSubject: Subject<AnalysisResultDto>;
  /** The async dispatch. Answering it is what proves the server accepted the run. */
  let startAsyncSubject: Subject<{ jobId: string }>;

  /**
   * Constructed directly rather than through the TestBed: this describe re-builds the service INSIDE a
   * `fakeAsync` body (the he/en pass below), and a testing-module reset in the middle of a fake time zone
   * is a second moving part with nothing to do with what is under test.
   */
  function build(): AnalysisRunOrchestrationService {
    return new AnalysisRunOrchestrationService(
      {
        run: () => runSubject.asObservable(),
        startAsync: () => startAsyncSubject.asObservable(),
        getByJob: () => NEVER,
        runStream: () => NEVER,
      } as unknown as AnalysisService,
      { pollProgress: () => NEVER } as unknown as AnalysisProgressService,
    );
  }

  function noLatinInHebrew(value: string): void {
    expect(value).withContext('a Hebrew book must show no Latin-script run chrome').not.toMatch(/[A-Za-z]/);
  }

  let service: AnalysisRunOrchestrationService;

  /** Sub-threshold Proofread: the SYNC route, which is the route the reported hang took. */
  function syncCtx(overrides: Partial<AnalysisRunContext> = {}): AnalysisRunContext {
    return ctx({ selectedAnalysisType: 'Proofread', documentText: 'one two three', ...overrides });
  }

  /** Always async, whatever the document says. */
  function asyncCtx(overrides: Partial<AnalysisRunContext> = {}): AnalysisRunContext {
    return ctx({ selectedAnalysisType: 'LinguisticAnalysis', documentText: '', ...overrides });
  }

  beforeEach(() => {
    runSubject = new Subject<AnalysisResultDto>();
    startAsyncSubject = new Subject<{ jobId: string }>();
    service = build();
  });

  // The ONE assertion on the budget's VALUE rather than its mechanism, and it exists because f01 removed
  // the accidental fence that used to hold it: both spec files hand-mirrored the literal `180_000`, so a
  // change to the constant broke them. They now tick RELATIVE to the export, which is right - they test
  // the mechanism - but it means every other timing assertion here stays green at any value at all.
  // c02 MEASURED this number as one that MISFIRES (a healthy cold near-threshold Hebrew LineEdit returned
  // a real result in 394.3s against it) and kept it anyway, choosing to make the misfire RETRACTABLE
  // instead of raising it, because no constant can bound a local generation whose length varies 13x. That
  // is a decision with evidence behind it, and it should not be quietly undone by editing one number.
  it('is 180s, and that is a DECISION with measurements behind it, not a default', () => {
    expect(RUN_START_BUDGET_MS)
      .withContext('c02 measured this budget misfiring at 394.3s and deliberately did NOT raise it - it '
        + 'made the expiry retractable instead. Read the RUN_START_BUDGET_MS docblock and the plan\'s '
        + '`## c02 findings` before changing this, and re-argue the retraction if you do')
      .toBe(180_000);
  });

  it('reports a localized "did not start" error once the budget is spent, and not before', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.runAnalysisAfterSave(syncCtx({ language: 'he' })).subscribe(e => events.push(e));

    // The only thing on the channel is the CLIENT-composed opener - which is exactly what the user was
    // staring at. It must not be mistaken for a sign of life.
    expect(events.map(e => e.kind)).toEqual(['status']);

    tick(RUN_START_BUDGET_MS - 1);
    expect(events.map(e => e.kind))
      .withContext('a budget that fires early turns a slow healthy run into a false failure')
      .toEqual(['status']);

    tick(1);
    const errors = events.filter(e => e.kind === 'error') as { message: string }[];
    expect(errors.length).withContext('exactly one expiry, not a repeating alarm').toBe(1);
    expect(errors[0].message).toBe(runString('he', 'runStartTimedOut', { type: 'הגהה' }));
    noLatinInHebrew(errors[0].message);

    tick(RUN_START_BUDGET_MS * 2);
    expect(events.filter(e => e.kind === 'error').length).toBe(1);

    sub.unsubscribe();
  }));

  it('says something DIFFERENT from a run that genuinely failed, in both languages', fakeAsync(() => {
    // Decision (c). "The run failed" leaves the user nothing to do; "the run did not start" tells them
    // to try again. One sentence for both facts would re-create the ambiguity this fixes.
    for (const lang of ['he', 'en'] as const) {
      runSubject = new Subject<AnalysisResultDto>();
      startAsyncSubject = new Subject<{ jobId: string }>();
      service = build();

      const events: AnalysisRunEvent[] = [];
      const sub = service.runAnalysisAfterSave(syncCtx({ language: lang })).subscribe(e => events.push(e));
      tick(RUN_START_BUDGET_MS);

      const message = (events.find(e => e.kind === 'error') as { message: string }).message;
      const typeLabel = lang === 'he' ? 'הגהה' : 'Proofread';
      expect(message).toBe(runString(lang, 'runStartTimedOut', { type: typeLabel }));
      expect(message).not.toBe(runString(lang, 'runFailed', { type: typeLabel }));
      expect(message).not.toBe(runString(lang, 'analysisFailed'));
      sub.unsubscribe();
    }
  }));

  it('logs the expiry once, on the console seam this failure mode has no other trace on', fakeAsync(() => {
    // A start-budget expiry leaves NO HTTP error behind to correlate against: the request is still open.
    // Without this line the only record of it would be the user's screenshot.
    const warn = spyOn(console, 'warn');
    const sub = service.runAnalysisAfterSave(syncCtx()).subscribe();

    tick(RUN_START_BUDGET_MS - 1);
    expect(warn).not.toHaveBeenCalled();

    tick(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.calls.mostRecent().args[0] as string).toContain('[AnalysisRun]');
    expect(warn.calls.mostRecent().args[1] as object).toEqual(
      jasmine.objectContaining({ analysisType: 'Proofread', timeoutMs: RUN_START_BUDGET_MS }),
    );

    sub.unsubscribe();
  }));

  it('is CANCELLED by the first proof the server answered, however late that proof is', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.runAnalysisAfterSave(asyncCtx()).subscribe(e => events.push(e));

    // The dispatch answers one second inside the budget. From here the run is healthy, and a
    // whole-chapter analysis routinely runs for minutes (Linguistic was measured at ~3 min).
    tick(RUN_START_BUDGET_MS - 1_000);
    startAsyncSubject.next({ jobId: 'JOB-1' });
    expect(events.some(e => e.kind === 'job-started')).toBeTrue();

    tick(RUN_START_BUDGET_MS * 3);
    expect(events.filter(e => e.kind === 'error'))
      .withContext('killing a job the server already accepted is the regression that matters here')
      .toEqual([]);

    sub.unsubscribe();
  }));

  it('a sync result cancels it too, and leaves no timer behind a finished run', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.runAnalysisAfterSave(syncCtx()).subscribe(e => events.push(e));

    tick(1_000);
    runSubject.next({
      id: 'r-1', chapterId: 'c', type: 'Proofread', analysisType: 'Proofread',
      resultText: 'ok', createdAt: new Date().toISOString(),
    });
    runSubject.complete();

    // A run that ENDED must take its timer with it. `fakeAsync` fails the spec on a leftover timer, so
    // the tick below asserts the teardown twice over.
    tick(RUN_START_BUDGET_MS * 2);
    expect(events.map(e => e.kind)).toEqual(['status', 'sync-result']);

    sub.unsubscribe();
  }));

  it('a run that ENDS without ever saying anything is not reported as a start timeout', fakeAsync(() => {
    // The guard has to be cancelled by the run ENDING, not only by an event crossing the channel.
    // Without that, a stream that completes silently leaves the budget pending, and two things break at
    // once: the subscriber's `complete` (which is how the panel emits its own run terminal, and how the
    // dialog stops showing a live card) is held back for the whole budget, and then a "did not start"
    // error fires at a run that already finished.
    //
    // This is also the case that pins the SUBSCRIPTION ORDER inside the guard: the run below completes
    // synchronously, inside its own subscribe call, so its cancellation is published before anything
    // that subscribed after it would have been listening.
    const service = new AnalysisRunOrchestrationService(
      { run: () => EMPTY, startAsync: () => NEVER, getByJob: () => NEVER } as unknown as AnalysisService,
      { pollProgress: () => NEVER } as unknown as AnalysisProgressService,
    );
    const events: AnalysisRunEvent[] = [];
    let completed = false;
    const sub = service.runAnalysisAfterSave(syncCtx()).subscribe({
      next: e => events.push(e),
      complete: () => { completed = true; },
    });

    expect(completed)
      .withContext('the run is over the moment its own stream ends; a pending budget must not hold the '
        + 'terminal back for three minutes')
      .toBeTrue();

    tick(RUN_START_BUDGET_MS * 2);
    expect(events.filter(e => e.kind === 'error'))
      .withContext('a finished run must never be told it did not start')
      .toEqual([]);

    sub.unsubscribe();
  }));

  it('cannot outlive the run: unsubscribing cancels a pending expiry', fakeAsync(() => {
    const events: AnalysisRunEvent[] = [];
    const sub = service.runAnalysisAfterSave(syncCtx()).subscribe(e => events.push(e));

    tick(1_000);
    // The panel unsubscribes on ngOnDestroy and when the next run starts. A context change is exactly
    // this, and a timer that survives it would fire a terminal at a card belonging to another chapter.
    sub.unsubscribe();

    tick(RUN_START_BUDGET_MS * 2);
    expect(events.filter(e => e.kind === 'error')).toEqual([]);
  }));

  it('gives every run a FULL fresh budget: the guard is subscription-scoped, not service state', fakeAsync(() => {
    // Run 1 spends its whole budget.
    const first: AnalysisRunEvent[] = [];
    const sub1 = service.runAnalysisAfterSave(syncCtx()).subscribe(e => first.push(e));
    tick(RUN_START_BUDGET_MS);
    expect(first.filter(e => e.kind === 'error').length).toBe(1);
    sub1.unsubscribe();

    // Run 2 must not inherit a spent budget, and the mechanism is that there is no budget FIELD on this
    // root singleton to leave stale in the first place.
    runSubject = new Subject<AnalysisResultDto>();
    const second: AnalysisRunEvent[] = [];
    const sub2 = service.runAnalysisAfterSave(syncCtx()).subscribe(e => second.push(e));
    tick(RUN_START_BUDGET_MS - 1);
    expect(second.filter(e => e.kind === 'error'))
      .withContext('an inherited budget would have expired the instant run 2 subscribed')
      .toEqual([]);
    tick(1);
    expect(second.filter(e => e.kind === 'error').length).toBe(1);

    sub2.unsubscribe();
  }));

  // ── a1: the service OWNS the run ────────────────────────────────────────────────────────────────
  //
  // The analysis panel is mounted under an `@if` and destroyed on every Edit-help tab switch. While its
  // subscription was the only one, that destruction CANCELLED the in-flight `/analyze`: the user's run
  // stopped, silently, and the run dialog was told `canceled`. `startRun` subscribes the run here, so a
  // caller detaching is just a caller detaching. The subjects this describe already uses are exactly
  // what makes that observable: `runSubject.observed` IS "the request is still in flight".
  describe('a1 startRun: the run outlives its caller', () => {
    it('keeps the request alive when the CALLER unsubscribes, and publishes the run while it is in flight', () => {
      const events: AnalysisRunEvent[] = [];
      const sub = service.startRun(syncCtx()).subscribe(e => events.push(e));

      expect(service.activeRun)
        .withContext('a surface that was not there when the run started has to be able to see it')
        .toEqual(jasmine.objectContaining({ bookId: 'b', chapterId: 'c', analysisType: 'Proofread', jobId: null }));
      // The opening status is REPLAYED: the service subscribes before returning, so a caller that
      // subscribes on the next line would otherwise never see it.
      expect(events.map(e => e.kind)).toEqual(['status']);

      sub.unsubscribe();

      expect(runSubject.observed)
        .withContext('this is the whole fix: detaching a view must not cancel the analysis')
        .toBeTrue();
      expect(service.activeRun).not.toBeNull();

      // ...and it still resolves, with no caller attached at all.
      runSubject.next({ id: 'r1', chapterId: 'c', type: 'Proofread', resultText: 'x', createdAt: '' } as AnalysisResultDto);
      runSubject.complete();
      expect(service.activeRun).toBeNull();
    });

    it('publishes the job id once the run dispatches async, so a consumer can tell the two apart', () => {
      const sub = service.startRun(asyncCtx()).subscribe();
      startAsyncSubject.next({ jobId: 'job-77' });

      expect(service.activeRun?.jobId).toBe('job-77');
      sub.unsubscribe();
    });

    it('SUPERSEDES the previous owned run rather than accumulating them', () => {
      const first = service.startRun(syncCtx()).subscribe();
      const firstRunId = service.activeRun?.runId;
      expect(runSubject.observed).toBeTrue();

      runSubject = new Subject<AnalysisResultDto>();
      const second = service.startRun(syncCtx()).subscribe();

      expect(service.activeRun?.runId).not.toBe(firstRunId);
      expect(service.activeRun?.runId).toBeTruthy();
      first.unsubscribe();
      second.unsubscribe();
    });
  });

  it('bounds a pre-run save that never settles: the one path that emits NOTHING at all', fakeAsync(() => {
    // `runAnalysisAfterSave` gates the whole run behind `saveBeforeRun()`, so a save that hangs never
    // even produces the opening `status` event. That is the worst version of state (a): a blocking modal
    // with no message of its own. The guard therefore wraps the save as well as the run.
    const events: AnalysisRunEvent[] = [];
    const sub = service
      .runAnalysisAfterSave(syncCtx({ language: 'en' }), () => new Promise<void>(() => { /* never settles */ }))
      .subscribe(e => events.push(e));

    tick(RUN_START_BUDGET_MS - 1);
    expect(events).withContext('nothing at all has crossed the channel yet').toEqual([]);

    tick(1);
    expect((events[0] as { kind: string; message: string }).kind).toBe('error');
    expect((events[0] as { kind: string; message: string }).message)
      .toBe(runString('en', 'runStartTimedOut', { type: 'Proofread' }));

    sub.unsubscribe();
  }));
});
