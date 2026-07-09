import { Injectable } from '@angular/core';
import {
  Observable, Subject, EMPTY,
  of, from, concat, defer,
  switchMap, catchError, map
} from 'rxjs';
import {
  AnalysisResultDto,
  AnalysisProgressDto,
  RunAnalysisRequest
} from '../models/analysis';
import { AnalysisService } from './analysis.service';
import { AnalysisProgressService } from './analysis-progress.service';

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

/** Discriminated-union events emitted by the orchestration observables. */
export type AnalysisRunEvent =
  | { kind: 'status'; message: string }
  | { kind: 'progress'; percent: number | null; message: string; rawStatus: string }
  | { kind: 'streaming-token'; token: string }
  | { kind: 'sync-result'; result: AnalysisResultDto }
  | { kind: 'job-started'; jobId: string }
  | { kind: 'job-result'; result: AnalysisResultDto }
  | { kind: 'streaming-complete'; latestResult: AnalysisResultDto }
  | { kind: 'error'; message: string };

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

  /** Compute the initial human-readable status for the editor's global spinner. Uses ctx chunk thresholds when provided. */
  emitInitialStatusForRun(ctx: AnalysisRunContext, isStreaming: boolean = false): string {
    const type = ctx.selectedAnalysisType || 'Analysis';
    const documentText = ctx.documentText;
    const proofreadChunk = ctx.proofreadChunkTargetWords ?? 500;
    const lineEditChunk = ctx.lineEditChunkTargetWords ?? 1500;
    if (type === 'Proofread' && documentText?.trim()) {
      const words = documentText.trim().split(/\s+/).filter(Boolean).length;
      const chunks = Math.max(1, Math.ceil(words / proofreadChunk));
      if (chunks > 1) {
        const mode = isStreaming ? 'streaming' : 'chunked';
        return `Proofread ${mode} · about ${chunks} parts (~${proofreadChunk} words each)`;
      }
    }
    if (type === 'LineEdit' && documentText?.trim() && !isStreaming) {
      const words = documentText.trim().split(/\s+/).filter(Boolean).length;
      const chunks = Math.max(1, Math.ceil(words / lineEditChunk));
      if (chunks > 1) {
        return `Line Edit chunked · about ${chunks} parts (~${lineEditChunk} words each)`;
      }
    }
    const label = type === 'Custom' ? 'Custom analysis' : `${type} analysis`;
    const suffix = isStreaming ? ' (streaming)…' : '…';
    return `Running ${label}${suffix}`;
  }

  /** Process a progress DTO into a human-readable status and numeric percent. */
  handleProgressUpdate(p: AnalysisProgressDto): ProgressUpdateResult {
    const status = (p.status || '').toLowerCase();
    const total = p.totalChunks || 0;
    // Use completedChunks (monotonic) for the label so it never goes backwards with parallel execution.
    const completed = typeof p.completedChunks === 'number' && p.completedChunks >= 0
      ? p.completedChunks
      : (total > 0 && typeof p.estimatedCompletionPercent === 'number' && p.estimatedCompletionPercent >= 0
        ? Math.round((p.estimatedCompletionPercent / 100) * total)
        : 0);

    const rawType = (p.analysisType || '').trim() || 'Proofread';
    const label = rawType === 'LineEdit' ? 'Line Edit' : rawType;

    let message: string;
    if (status === 'failed') {
      message = `${label} · failed – see error message`;
    } else if (status === 'canceled') {
      message = `${label} · canceled`;
    } else if (total > 0 && completed > 0) {
      message = `${label} · ${completed} of ${total} completed`;
    } else if (total > 0) {
      message = `${label} · analyzing…`;
    } else if (status === 'pending') {
      message = `${label} · preparing chunks…`;
    } else {
      message = `${label} · running…`;
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
   * Compute a human-readable duration label from a run start timestamp.
   * Pure function: pass the same clock source for start and (optionally) end to avoid mixing performance.now() and Date.now().
   * @param runStartedAt Start time from performance.now() or Date.now() (must match endTime clock if provided).
   * @param endTime Optional end time; if omitted, uses the same clock as runStartedAt would use (performance.now() or Date.now()).
   */
  formatRunDuration(runStartedAt: number | null, endTime?: number): string | null {
    if (runStartedAt == null) return null;
    const now = endTime ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const ms = Math.max(0, now - runStartedAt);
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return rem ? `${mins}m ${rem}s` : `${mins}m`;
  }

  /** Prompt the user to confirm re-analysis when there are pending suggestions. */
  confirmReanalysisIfPendingSuggestions(pendingCount: number, scopeLabel: string): boolean {
    if (!pendingCount) return true;
    const message = pendingCount === 1
      ? `Running a new analysis will end your current session for this ${scopeLabel}. 1 pending suggestion will be discarded. Continue?`
      : `Running a new analysis will end your current session for this ${scopeLabel}. ${pendingCount} pending suggestions will be discarded. Continue?`;
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
              this.startProgressPollingIfNeeded(ctx.bookId, ctx.chapterId, result)
            );
          }
          return of(resultEvent);
        }),
        catchError((err): Observable<AnalysisRunEvent> => {
          this.stopProgressPolling();
          const message = err?.error?.error ?? err?.message ?? 'Analysis failed.';
          return of<AnalysisRunEvent>({ kind: 'error', message });
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
          const label = ctx.selectedAnalysisType === 'LineEdit' ? 'Line Edit' : (ctx.selectedAnalysisType || 'Analysis');
          return concat(
            of<AnalysisRunEvent>({ kind: 'job-started', jobId: res.jobId }),
            of<AnalysisRunEvent>({ kind: 'status', message: `${label} · job started, polling analysis-progress…` }),
            this.startProgressPollingForJob(
              ctx.bookId, ctx.chapterId, res.jobId, ctx.selectedAnalysisType
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
            const message = err?.error?.error ?? err?.message ?? 'Analysis failed.';
            subscriber.next({ kind: 'error', message });
            subscriber.complete();
          },
          complete: () => {
            const latestResult: AnalysisResultDto = {
              id: '',
              chapterId: ctx.chapterId,
              type: ctx.selectedAnalysisType,
              resultText: accumulated,
              modelName: '',
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
    result: AnalysisResultDto
  ): Observable<AnalysisRunEvent> {
    if (!bookId || !chapterId || !result.jobId) return EMPTY;
    const type = result.analysisType || result.type;
    const stop$ = this.createProgressStop();
    return this.analysisProgressService
      .pollProgress(bookId, chapterId, result.jobId, stop$)
      .pipe(
        map((p): AnalysisRunEvent => {
          const update = this.handleProgressUpdate(p);
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
          const label = type === 'Custom' ? 'Custom analysis' : `${type} analysis`;
          return of<AnalysisRunEvent>({ kind: 'status', message: `Running ${label}…` });
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
    selectedAnalysisType?: string
  ): Observable<AnalysisRunEvent> {
    if (!bookId || !chapterId) return EMPTY;
    const type = selectedAnalysisType || 'Analysis';
    const stop$ = this.createProgressStop();
    return this.analysisProgressService
      .pollProgress(bookId, chapterId, jobId, stop$)
      .pipe(
        switchMap((p): Observable<AnalysisRunEvent> => {
          const update = this.handleProgressUpdate(p);
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
              this.loadFinalResultForJob(bookId, chapterId, jobId)
            );
          }
          if (update.status === 'failed' || update.status === 'canceled') {
            stop$.next();
            if (update.status === 'failed') {
              const errorEvent: AnalysisRunEvent = { kind: 'error', message: `${type} failed – see error message.` };
              return of(progressEvent, errorEvent);
            }
            return of(progressEvent);
          }
          return of(progressEvent);
        }),
        catchError((): Observable<AnalysisRunEvent> => {
          stop$.next();
          const label = type === 'Custom' ? 'Custom analysis' : `${type} analysis`;
          return of<AnalysisRunEvent>({ kind: 'status', message: `Running ${label}…` });
        })
      );
  }

  /** Fetch the final AnalysisResult for a completed async job. */
  loadFinalResultForJob(
    bookId: string,
    chapterId: string,
    jobId: string
  ): Observable<AnalysisRunEvent> {
    return this.analysisService.getByJob(bookId, chapterId, jobId).pipe(
      map((result): AnalysisRunEvent => ({ kind: 'job-result', result })),
      catchError((): Observable<AnalysisRunEvent> =>
        of<AnalysisRunEvent>({ kind: 'error', message: 'Failed to load final result; reloading history.' })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

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
