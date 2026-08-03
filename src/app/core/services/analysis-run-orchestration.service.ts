import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Observable, Subject, EMPTY,
  of, from, concat, defer, timer, throwError,
  switchMap, catchError, map, retry
} from 'rxjs';
import {
  AnalysisResultDto,
  AnalysisProgressDto,
  RunAnalysisRequest
} from '../models/analysis';
import { AnalysisService } from './analysis.service';
import { AnalysisProgressService } from './analysis-progress.service';
import {
  analysisTypeLabelFor,
  formatRunDurationLabel,
  runChromeLang,
  runString,
} from '../i18n/run-strings';

/** Immutable snapshot of the component state needed for a run. */
export interface AnalysisRunContext {
  bookId: string;
  chapterId: string;
  sceneId: string | null;
  selectedAnalysisType: string;
  customPrompt: string | null;
  language: string;
  documentText: string;
  /** When to use analysis-jobs (chunked); from server config. Omit to use defaults (500 Proofread, 1500 LineEdit). */
  proofreadChunkTargetWords?: number;
  lineEditChunkTargetWords?: number;
}

/**
 * Discriminated-union events for one analysis run.
 *
 * Every member EXCEPT `'run-finished'` and `'result-dropped'` is emitted by the orchestration
 * observables below. Those two are emitted by `AnalysisPanelComponent` on its `runEvent` output only;
 * no observable in this service ever produces either. They travel on the same union so a host surface
 * has ONE channel to listen on, rather than a second parallel @Output.
 */
export type AnalysisRunEvent =
  | { kind: 'status'; message: string }
  | { kind: 'progress'; percent: number | null; message: string; rawStatus: string }
  | { kind: 'streaming-token'; token: string }
  | { kind: 'sync-result'; result: AnalysisResultDto }
  | { kind: 'job-started'; jobId: string }
  | { kind: 'job-result'; result: AnalysisResultDto }
  | { kind: 'streaming-complete'; latestResult: AnalysisResultDto }
  | { kind: 'error'; message: string }
  /**
   * c01: the panel's AUTHORITATIVE run terminal, on the channel the host actually binds.
   *
   * Emitted when the run ends WITHOUT any of the terminal events above having been produced - the run
   * subscription completed or errored with nothing to report, the save that had to precede a streaming
   * run rejected, or the panel was destroyed mid-run (which cancels the run). Carries no payload on
   * purpose: it says only "there is no longer a run behind this surface". A percent must still come from
   * `JobRegistryService`, and a registry-tracked run must still resolve off the registry alone.
   *
   * On a normal run this arrives AFTER a real terminal event, so every consumer must be single-resolve.
   */
  | { kind: 'run-finished' }
  /**
   * c06: this run produced a result, and the panel DISCARDED it as stale-context.
   *
   * Emitted by `AnalysisPanelComponent` IN PLACE OF the `'sync-result'` / `'job-result'` event whenever
   * the run's captured origin (the chapter/scene the run was started on) no longer matches the context
   * on screen when the result lands. The panel drops such a result rather than injecting a prior
   * chapter's suggestions - and offsets - into the document now open, so a host surface must NOT report
   * a success the app threw away. It carries no result on purpose: there is nothing here for the host
   * to show.
   *
   * The result itself is not lost; it is persisted server-side and re-surfaced by the panel's guarded
   * history load when the user returns to the origin chapter.
   */
  | { kind: 'result-dropped' };

/**
 * Compile-time exhaustiveness fence for {@link AnalysisRunEvent}.
 *
 * Call it from the `default:` arm of every `switch (event.kind)`. Both consumers return `void`, so
 * without this TypeScript accepts a switch that silently ignores a member: adding `'run-finished'`
 * (c01) and `'result-dropped'` (c06) to this union was NOT a compile error anywhere, which is exactly
 * how the run's terminal came to be emitted on a channel nothing answered in the first place. With the
 * fence, the next member added here fails `ng build` in every switch that has not decided what to do
 * with it - including deciding, explicitly, to do nothing.
 *
 * Runtime behaviour is deliberately nil: an unknown event must never change a surface's state.
 */
export function assertUnhandledRunEvent(_event: never): void {
  // Intentionally empty. The parameter type is the whole point.
}

/**
 * Is this the ONE error shape the final-result read is allowed to retry - "the row is not there yet"?
 *
 * c01: `GET analysis-jobs/{jobId}` answers 404 while the job's `AnalysisResult` row has not been
 * committed, which is a TRANSIENT state on a run the server is in the middle of finishing. Every other
 * failure (500, a dropped connection, a parse error) says something is actually wrong, and re-asking the
 * same question three more times only delays the error the user needs to see. So the predicate is
 * deliberately narrow: exactly 404, nothing else, and a persistent 404 still surfaces as an error once
 * the budget is spent.
 */
function isFinalResultNotFound(error: unknown): boolean {
  return (error as HttpErrorResponse | null | undefined)?.status === 404;
}

/** Parsed progress update returned by handleProgressUpdate (internal use). */
interface ProgressUpdateResult {
  status: string;
  message: string;
  progressPercent: number | null;
}

@Injectable({ providedIn: 'root' })
export class AnalysisRunOrchestrationService {
  /**
   * Shared handle to the most recent polling stop subject.
   * Each polling run gets its own Subject instance so concurrent runs don't interfere.
   */
  private progressStop$ : Subject<void> | null = null;

  /**
   * Bounded read-after-write budget for {@link loadFinalResultForJob}. Deliberately the SAME numbers as
   * the panel's `proofreadFinalizeMaxRetries` / `proofreadFinalizeRetryMs` (3 x 600ms): both wait out the
   * same window - a row the server has just written becoming visible to the next GET - so they should not
   * disagree about how long that takes. ~1.8s of patience total, well under any user's notion of a hang,
   * and a persistent 404 still fails.
   */
  private readonly finalResultRetryMax = 3;
  private readonly finalResultRetryDelayMs = 600;

  constructor(
    private analysisService: AnalysisService,
    private analysisProgressService: AnalysisProgressService
  ) {}

  /** Cancel any active progress polling. Call from component ngOnDestroy. */
  stopProgressPolling(): void {
    if (this.progressStop$) {
      this.progressStop$.next();
    }
  }

  /** Create a new stop subject for a polling run, cancelling any previous run first. */
  private createProgressStop(): Subject<void> {
    if (this.progressStop$) {
      this.progressStop$.next();
    }
    this.progressStop$ = new Subject<void>();
    return this.progressStop$;
  }

  // ---------------------------------------------------------------------------
  // Pure / computational helpers
  // ---------------------------------------------------------------------------

  /**
   * Decide whether a run uses the async job flow (analysis-jobs + analysis-progress poll) instead of a
   * blocking synchronous /analyze request.
   *
   * Two families qualify:
   *  - Single-shot whole-chapter LLM analyses (Linguistic/Literary/Summarization/Custom): ALWAYS async.
   *    Each sends the whole chapter to the model and can run for tens of seconds to minutes (Linguistic was
   *    measured at ~3 min), so a synchronous request risks a proxy/browser timeout that loses the result
   *    even though the server persisted it. The backend reads the chapter from the DB, so no documentText is
   *    required here to make the decision.
   *  - Chunked Proofread/LineEdit: async only once the document exceeds the server chunk threshold; short
   *    documents finish fast enough to run inline.
   */
  shouldUseAsyncJob(ctx: AnalysisRunContext): boolean {
    const { selectedAnalysisType: analysisType, documentText, proofreadChunkTargetWords, lineEditChunkTargetWords } = ctx;
    if (
      analysisType === 'LinguisticAnalysis'
      || analysisType === 'LiteraryAnalysis'
      || analysisType === 'Summarization'
      || analysisType === 'Custom'
    ) {
      return true;
    }
    if (analysisType !== 'Proofread' && analysisType !== 'LineEdit') return false;
    if (!documentText?.trim()) return false;
    const words = documentText.trim().split(/\s+/).filter(Boolean).length;
    const proofreadThreshold = proofreadChunkTargetWords ?? 500;
    const lineEditThreshold = lineEditChunkTargetWords ?? 1500;
    if (analysisType === 'Proofread') return words > proofreadThreshold;
    return words > lineEditThreshold;
  }

  /**
   * Compute the initial human-readable status for the run dialog's state (a). Uses ctx chunk thresholds
   * when provided.
   *
   * c02: composed from {@link runString} in `ctx.language`'s chrome language, which is the SAME language
   * the dialog and the panel render in (`ctx.language` is the panel's normalized `bookLanguage`).
   */
  emitInitialStatusForRun(ctx: AnalysisRunContext, isStreaming: boolean = false): string {
    const lang = runChromeLang(ctx.language);
    const type = ctx.selectedAnalysisType || '';
    const typeLabel = analysisTypeLabelFor(lang, type);
    const documentText = ctx.documentText;
    const proofreadChunk = ctx.proofreadChunkTargetWords ?? 500;
    const lineEditChunk = ctx.lineEditChunkTargetWords ?? 1500;
    if (type === 'Proofread' && documentText?.trim()) {
      const words = documentText.trim().split(/\s+/).filter(Boolean).length;
      const chunks = Math.max(1, Math.ceil(words / proofreadChunk));
      if (chunks > 1) {
        return runString(lang, isStreaming ? 'runChunkedStreaming' : 'runChunked',
          { type: typeLabel, parts: chunks, words: proofreadChunk });
      }
    }
    if (type === 'LineEdit' && documentText?.trim() && !isStreaming) {
      const words = documentText.trim().split(/\s+/).filter(Boolean).length;
      const chunks = Math.max(1, Math.ceil(words / lineEditChunk));
      if (chunks > 1) {
        return runString(lang, 'runChunked', { type: typeLabel, parts: chunks, words: lineEditChunk });
      }
    }
    return runString(lang, isStreaming ? 'runStartingStreaming' : 'runStarting', { type: typeLabel });
  }

  /**
   * Process a progress DTO into a human-readable status and numeric percent.
   *
   * c02: `language` is REQUIRED rather than defaulted. Every caller has the run's language in hand, and
   * a default here is exactly how an English sentence ends up in Hebrew chrome without anyone noticing.
   * The message is composed from the DTO's STRUCTURED fields (`status`, `completedChunks`,
   * `totalChunks`); the DTO's own prose `message` is never read.
   */
  handleProgressUpdate(p: AnalysisProgressDto, language: string): ProgressUpdateResult {
    const lang = runChromeLang(language);
    const status = (p.status || '').toLowerCase();
    const total = p.totalChunks || 0;
    // Use completedChunks (monotonic) for the label so it never goes backwards with parallel execution.
    const completed = typeof p.completedChunks === 'number' && p.completedChunks >= 0
      ? p.completedChunks
      : (total > 0 && typeof p.estimatedCompletionPercent === 'number' && p.estimatedCompletionPercent >= 0
        ? Math.round((p.estimatedCompletionPercent / 100) * total)
        : 0);

    const label = analysisTypeLabelFor(lang, (p.analysisType || '').trim() || 'Proofread');

    let message: string;
    if (status === 'failed') {
      message = runString(lang, 'runFailed', { type: label });
    } else if (status === 'canceled') {
      message = runString(lang, 'runCanceled', { type: label });
    } else if (total > 0 && completed > 0) {
      message = runString(lang, 'progressCompleted', { type: label, completed, total });
    } else if (total > 0) {
      message = runString(lang, 'progressAnalyzing', { type: label });
    } else if (status === 'pending') {
      message = runString(lang, 'progressPreparing', { type: label });
    } else {
      message = runString(lang, 'progressRunning', { type: label });
    }

    let progressPercent: number | null = null;
    if (status === 'succeeded') {
      progressPercent = 100;
    } else if (typeof p.estimatedCompletionPercent === 'number' && p.estimatedCompletionPercent >= 0) {
      progressPercent = Math.max(0, Math.min(100, p.estimatedCompletionPercent));
    } else if (total > 0 && completed >= 0) {
      // Fallback: derive from completedChunks/totalChunks so progress bar updates during run
      progressPercent = Math.max(0, Math.min(100, Math.round((100 * completed) / total)));
    }

    return { status, message, progressPercent };
  }

  /**
   * Compute a localized duration label from a run start timestamp.
   * Pure function: pass the same clock source for start and (optionally) end to avoid mixing performance.now() and Date.now().
   *
   * c02: `language` is required and the unit suffixes come from the run-string map. They used to be the
   * hardcoded Latin `s` / `m`, which rendered as "זמן ריצה: 5s" inside otherwise-Hebrew chrome.
   *
   * @param runStartedAt Start time from performance.now() or Date.now() (must match endTime clock if provided).
   * @param language The run's language (the book language); normalized by {@link runChromeLang}.
   * @param endTime Optional end time; if omitted, uses the same clock as runStartedAt would use (performance.now() or Date.now()).
   */
  formatRunDuration(runStartedAt: number | null, language: string, endTime?: number): string | null {
    if (runStartedAt == null) return null;
    const now = endTime ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return formatRunDurationLabel(runChromeLang(language), now - runStartedAt);
  }

  /**
   * Prompt the user to confirm re-analysis when there are pending suggestions.
   *
   * c02: the scope is a closed `'chapter' | 'scene'` union rather than a free string, so the caller can
   * no longer hand in the English word itself (it used to pass the literal `'chapter'`/`'scene'`, which
   * then appeared verbatim inside an otherwise-Hebrew sentence).
   */
  confirmReanalysisIfPendingSuggestions(
    pendingCount: number,
    scope: 'chapter' | 'scene',
    language: string
  ): boolean {
    if (!pendingCount) return true;
    const lang = runChromeLang(language);
    const scopeLabel = runString(lang, scope === 'scene' ? 'scopeScene' : 'scopeChapter');
    const message = pendingCount === 1
      ? runString(lang, 'reanalysisConfirmOne', { scope: scopeLabel })
      : runString(lang, 'reanalysisConfirmMany', { scope: scopeLabel, count: pendingCount });
    return window.confirm(message);
  }

  // ---------------------------------------------------------------------------
  // Observable run flows
  // ---------------------------------------------------------------------------

  /**
   * Orchestrate the full sync/async run lifecycle:
   * optionally save → emit initial status → dispatch to sync or async path.
   *
   * Emits AnalysisRunEvent items; the component handles state mutations in its
   * subscription handler.
   */
  runAnalysisAfterSave(
    ctx: AnalysisRunContext,
    saveBeforeRun?: () => Promise<void>
  ): Observable<AnalysisRunEvent> {
    this.stopProgressPolling();
    const initialStatus = this.emitInitialStatusForRun(ctx);
    const run$: Observable<AnalysisRunEvent> = concat(
      of<AnalysisRunEvent>({ kind: 'status', message: initialStatus }),
      defer(() => this.doRunAnalysis(ctx))
    );
    if (saveBeforeRun) {
      return from(saveBeforeRun()).pipe(switchMap(() => run$));
    }
    return run$;
  }

  /** Route to sync or async-job path based on server chunk thresholds in ctx. */
  doRunAnalysis(ctx: AnalysisRunContext): Observable<AnalysisRunEvent> {
    if (this.shouldUseAsyncJob(ctx)) {
      return this.doRunAnalysisAsyncJob(ctx);
    }
    return this.doRunAnalysisSync(ctx);
  }

  /** Synchronous /analyze path (short texts, non-Proofread types, fallback). */
  doRunAnalysisSync(ctx: AnalysisRunContext): Observable<AnalysisRunEvent> {
    const body = this.buildRequestBody(ctx);
    return this.analysisService
      .run(ctx.bookId, ctx.chapterId, body, ctx.sceneId ?? undefined)
      .pipe(
        switchMap((result): Observable<AnalysisRunEvent> => {
          const resultEvent: AnalysisRunEvent = { kind: 'sync-result', result };
          if (result.jobId) {
            return concat(
              of(resultEvent),
              this.startProgressPollingIfNeeded(ctx.bookId, ctx.chapterId, result, ctx.language)
            );
          }
          return of(resultEvent);
        }),
        catchError((err): Observable<AnalysisRunEvent> => {
          this.stopProgressPolling();
          return of<AnalysisRunEvent>({ kind: 'error', message: this.runFailureMessage(err, ctx.language) });
        })
      );
  }

  /**
   * Async job-based flow: start an analysis job, poll progress, fetch final result.
   * Falls back to sync path if the backend doesn't return a jobId or rejects.
   */
  doRunAnalysisAsyncJob(ctx: AnalysisRunContext): Observable<AnalysisRunEvent> {
    const body = this.buildRequestBody(ctx);
    return this.analysisService
      .startAsync(ctx.bookId, ctx.chapterId, body, ctx.sceneId ?? undefined)
      .pipe(
        switchMap((res): Observable<AnalysisRunEvent> => {
          if (!res?.jobId) {
            return this.doRunAnalysisSync(ctx);
          }
          const lang = runChromeLang(ctx.language);
          const label = analysisTypeLabelFor(lang, ctx.selectedAnalysisType);
          return concat(
            of<AnalysisRunEvent>({ kind: 'job-started', jobId: res.jobId }),
            of<AnalysisRunEvent>({ kind: 'status', message: runString(lang, 'jobStarted', { type: label }) }),
            this.startProgressPollingForJob(
              ctx.bookId, ctx.chapterId, res.jobId, ctx.selectedAnalysisType, ctx.language
            )
          );
        }),
        catchError((): Observable<AnalysisRunEvent> => this.doRunAnalysisSync(ctx))
      );
  }

  /** Streaming analysis flow. Emits streaming-token events, then a single streaming-complete. */
  doRunStreaming(ctx: AnalysisRunContext): Observable<AnalysisRunEvent> {
    const body = this.buildRequestBody(ctx, true);
    let accumulated = '';

    return new Observable<AnalysisRunEvent>(subscriber => {
      const inner = this.analysisService
        .runStream(ctx.bookId, ctx.chapterId, body, ctx.sceneId ?? undefined)
        .subscribe({
          next: (token) => {
            accumulated += token;
            subscriber.next({ kind: 'streaming-token', token });
          },
          error: (err) => {
            subscriber.next({ kind: 'error', message: this.runFailureMessage(err, ctx.language) });
            subscriber.complete();
          },
          complete: () => {
            const latestResult: AnalysisResultDto = {
              id: '',
              chapterId: ctx.chapterId,
              type: ctx.selectedAnalysisType,
              resultText: accumulated,
              createdAt: new Date().toISOString(),
              analysisType: ctx.selectedAnalysisType,
              // Stamp the language the run used. Without it LinguisticResultComponent treats a missing
              // language as Hebrew (RTL + Hebrew labels), so English results would render incorrectly.
              language: ctx.language
            };
            subscriber.next({ kind: 'streaming-complete', latestResult });
            subscriber.complete();
          }
        });
      return () => inner.unsubscribe();
    });
  }

  /** Poll progress for a sync result that returned a jobId (chunked run display). */
  startProgressPollingIfNeeded(
    bookId: string,
    chapterId: string,
    result: AnalysisResultDto,
    language: string
  ): Observable<AnalysisRunEvent> {
    if (!bookId || !chapterId || !result.jobId) return EMPTY;
    const type = result.analysisType || result.type;
    const stop$ = this.createProgressStop();
    return this.analysisProgressService
      .pollProgress(bookId, chapterId, result.jobId, stop$)
      .pipe(
        map((p): AnalysisRunEvent => {
          const update = this.handleProgressUpdate(p, language);
          if (update.status === 'succeeded' || update.status === 'failed' || update.status === 'canceled') {
            stop$.next();
          }
          return {
            kind: 'progress',
            percent: update.status === 'succeeded' ? 100 : update.progressPercent,
            message: update.message,
            rawStatus: update.status
          };
        }),
        catchError((): Observable<AnalysisRunEvent> => {
          stop$.next();
          const lang = runChromeLang(language);
          return of<AnalysisRunEvent>({
            kind: 'status',
            message: runString(lang, 'runStarting', { type: analysisTypeLabelFor(lang, type) }),
          });
        })
      );
  }

  /**
   * Poll progress for an async job. When succeeded, fetch and emit the final result.
   * On failure/cancel, emit corresponding error/status events.
   */
  startProgressPollingForJob(
    bookId: string,
    chapterId: string,
    jobId: string,
    selectedAnalysisType: string | undefined,
    language: string
  ): Observable<AnalysisRunEvent> {
    if (!bookId || !chapterId) return EMPTY;
    const lang = runChromeLang(language);
    const typeLabel = analysisTypeLabelFor(lang, selectedAnalysisType);
    const stop$ = this.createProgressStop();
    return this.analysisProgressService
      .pollProgress(bookId, chapterId, jobId, stop$)
      .pipe(
        switchMap((p): Observable<AnalysisRunEvent> => {
          const update = this.handleProgressUpdate(p, language);
          const progressEvent: AnalysisRunEvent = {
            kind: 'progress',
            percent: update.status === 'succeeded' ? 100 : update.progressPercent,
            message: update.message,
            rawStatus: update.status
          };

          if (update.status === 'succeeded') {
            stop$.next();
            return concat(
              of(progressEvent),
              this.loadFinalResultForJob(bookId, chapterId, jobId, language)
            );
          }
          if (update.status === 'failed' || update.status === 'canceled') {
            stop$.next();
            if (update.status === 'failed') {
              const errorEvent: AnalysisRunEvent = {
                kind: 'error',
                message: runString(lang, 'runFailed', { type: typeLabel }),
              };
              return of(progressEvent, errorEvent);
            }
            return of(progressEvent);
          }
          return of(progressEvent);
        }),
        catchError((): Observable<AnalysisRunEvent> => {
          stop$.next();
          return of<AnalysisRunEvent>({
            kind: 'status',
            message: runString(lang, 'runStarting', { type: typeLabel }),
          });
        })
      );
  }

  /**
   * Fetch the final AnalysisResult for a completed async job, with a bounded read-after-write retry.
   *
   * c01. This read fires the instant the progress poll reports `succeeded`, so it is a classic
   * read-after-write: the server has told us the job is done and we immediately ask for the row it
   * wrote. When the write has not landed yet, `GET analysis-jobs/{jobId}` answers 404 - MEASURED by the
   * user on a 10-chunk Hebrew Proofread, which showed a failure banner for an analysis that was present
   * and correct after a browser refresh. A single 404 used to be reported as a failed run.
   *
   * `be-c01` fixed the server ordering (persist, then mark the job Succeeded). This stays anyway, as
   * defence in depth: the ordering guarantee holds only inside one API process, and a proxy hiccup, a
   * read replica, or a fourth persist path re-splitting the pair puts the same 404 back on the wire.
   *
   * SHAPE, deliberately mirroring the panel's `proofreadFinalizing` / `proofreadFinalizeRetriesLeft`
   * machinery (`analysis-panel.component.ts`), which is the same replica-lag problem on the sibling read
   * - same budget (3), same delay (600ms), one vocabulary rather than two:
   *
   *  - ONLY 404 is retried (see {@link isFinalResultNotFound}); anything else fails immediately.
   *  - A 404 that outlives the budget still surfaces as `{ kind: 'error' }`, unchanged.
   *  - The budget is SUBSCRIPTION-scoped, not a field on this root singleton. That is the reset
   *    discipline, expressed as a mechanism: `retry` counts within one subscription, and the panel
   *    creates a fresh subscription per run (`prepareForRun` unsubscribes the previous one), so a run
   *    cannot inherit a half-spent budget and there is no state for a context change to leave stale.
   *  - `defer` re-invokes `getByJob` on each attempt, so a retry is a genuinely new request rather than a
   *    re-subscription to a settled one.
   *  - The retry cannot outlive the run: the timer lives inside this subscription, so the panel's
   *    `ngOnDestroy` / next-run unsubscribe cancels it. A retry that succeeds AFTER a chapter switch
   *    emits the ordinary `job-result` event, so it meets the panel's `resultBelongsToRunOrigin` guard
   *    and is dropped (`result-dropped`) exactly like any other late result - this adds no new member to
   *    `AnalysisRunEvent` and no new emit site, so the `never`-guarded exhaustiveness fence is untouched.
   */
  loadFinalResultForJob(
    bookId: string,
    chapterId: string,
    jobId: string,
    language: string
  ): Observable<AnalysisRunEvent> {
    return defer(() => this.analysisService.getByJob(bookId, chapterId, jobId)).pipe(
      retry({
        count: this.finalResultRetryMax,
        delay: (error: unknown) => isFinalResultNotFound(error)
          ? timer(this.finalResultRetryDelayMs)
          : throwError(() => error)
      }),
      map((result): AnalysisRunEvent => ({ kind: 'job-result', result })),
      catchError((): Observable<AnalysisRunEvent> =>
        of<AnalysisRunEvent>({
          kind: 'error',
          message: runString(runChromeLang(language), 'loadFinalResultFailed'),
        })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * The message for a run that failed at the HTTP layer.
   *
   * c02, and the ONE deliberate exception to "every run string is localized": a `{ error: "..." }` body
   * the API chose to send is DATA, not chrome. It is the only channel that says WHY this particular
   * request was rejected (text too long, chapter has no text, model unavailable), so it is passed
   * through verbatim rather than replaced by a generic localized sentence that discards the reason.
   * Localizing it needs a server-side error-CODE contract; see the plan's `## c02 decision`.
   *
   * `err.message` is deliberately NOT part of the chain any more. That is Angular HttpClient's internal
   * string ("Http failure response for /api/...: 500 Internal Server Error"): never user copy, always
   * English, and it used to shadow this localized fallback on every transport-level failure.
   */
  private runFailureMessage(err: unknown, language: string): string {
    const serverDetail = (err as { error?: { error?: unknown } } | null | undefined)?.error?.error;
    if (typeof serverDetail === 'string' && serverDetail.trim()) return serverDetail;
    return runString(runChromeLang(language), 'analysisFailed');
  }

  private buildRequestBody(ctx: AnalysisRunContext, stream = false): RunAnalysisRequest {
    return {
      analysisType: ctx.selectedAnalysisType,
      customPrompt: ctx.selectedAnalysisType === 'Custom'
        ? (ctx.customPrompt || undefined)
        : undefined,
      language: ctx.language,
      stream
    };
  }
}
