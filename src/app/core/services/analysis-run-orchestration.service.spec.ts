import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { NEVER, Subject, of } from 'rxjs';
import { AnalysisRunOrchestrationService, AnalysisRunContext, AnalysisRunEvent } from './analysis-run-orchestration.service';
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
    customPrompt: null,
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
      for (const t of ['LinguisticAnalysis', 'LiteraryAnalysis', 'Summarization', 'Custom']) {
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
      const status = service.emitInitialStatusForRun(ctx({ selectedAnalysisType: 'Custom', documentText: 'text' }), true);
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
