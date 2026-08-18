import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Observable, Subject, ReplaySubject, BehaviorSubject, Subscription, EMPTY,
  of, from, concat, defer, merge, timer, throwError,
  switchMap, catchError, finalize, map, retry, takeUntil, tap
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
  // Wave 3 / w7: `customPrompt` LIVED HERE. It carried the Custom pass's free-form instruction from
  // the panel into the request body, and both ends went with the pass.
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
  /**
   * A run failure the user must be told about.
   *
   * `startBudgetExpired` marks the ONE error this service composes WITHOUT the server having failed:
   * {@link withStartTimeout}'s expiry (c02). It is the client giving up on waiting, not a verdict on the
   * run - the request is still in flight, there is no cancel endpoint, and a result may still land. Every
   * other `error` on this union reports something that actually went wrong, and on the sync route those
   * arrive from `catchError`, which emits and then COMPLETES, so nothing can follow them.
   *
   * The flag exists because those two are indistinguishable by `message` alone, and a surface that has
   * already resolved on an expiry needs to know its terminal was provisional in order to let this run's
   * own late result correct it. Optional and absent everywhere else on purpose: no consumer may treat a
   * plain `error` as retractable.
   */
  | { kind: 'error'; message: string; startBudgetExpired?: true }
  /**
   * c01: the panel's AUTHORITATIVE run terminal, on the channel the host actually binds.
   *
   * Emitted when the run ends WITHOUT any of the terminal events above having been produced - the run
   * subscription completed or errored with nothing to report, the save that had to precede a streaming
   * run rejected, or a PANEL-OWNED run was destroyed mid-run (which cancels that run). Carries no payload
   * on purpose: it says only "there is no longer a run behind this surface". A percent must still come
   * from `JobRegistryService`, and a registry-tracked run must still resolve off the registry alone.
   *
   * a1 NARROWED the destroy case to a panel-owned run, i.e. the streaming path. A run started through
   * {@link AnalysisRunOrchestrationService.startRun} is owned HERE and survives the panel's unmount, so
   * the panel no longer reports a terminal for it - there is none, and claiming one put a "Canceled"
   * card over a run the server was still working on.
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

/**
 * Does this event PROVE the server answered? The start budget's one cancellation condition.
 *
 * `'status'` is the ONE member that proves nothing: it is composed on the CLIENT
 * ({@link AnalysisRunOrchestrationService.emitInitialStatusForRun}) and emitted the instant the run is
 * subscribed, before a single byte has left the browser. It is also the only thing the user saw during
 * the measured hang ("מריץ הגהה..." on screen forever), so a guard that treated it as life would have
 * been cancelled by the very message that was lying to them.
 *
 * Everything else can only exist because a request came back: a jobId, a progress poll answering, a
 * streamed token, a result, or an error. The two PANEL-emitted members never travel on an observable
 * this guard wraps, but they END the run, so answering them "yes, stop the timer" is both harmless and
 * the only answer that is not a leak.
 *
 * The `default` arm is the exhaustiveness fence: a new member of {@link AnalysisRunEvent} must be
 * classified here rather than silently defaulting into "not proof", which would let a healthy new
 * lifecycle signal be timed out.
 */
function provesServerAnswered(event: AnalysisRunEvent): boolean {
  switch (event.kind) {
    case 'status':
      return false;
    case 'progress':
    case 'streaming-token':
    case 'job-started':
    case 'sync-result':
    case 'job-result':
    case 'streaming-complete':
    case 'error':
    case 'run-finished':
    case 'result-dropped':
      return true;
    default:
      assertUnhandledRunEvent(event);
      return true;
  }
}

/** Parsed progress update returned by handleProgressUpdate (internal use). */
interface ProgressUpdateResult {
  status: string;
  message: string;
  progressPercent: number | null;
}

/**
 * Bounded START budget for a run: how long the client will wait for the server's FIRST answer of any
 * kind before it gives the user their app back. See {@link withStartTimeout}.
 *
 * WHY 180s, and what was measured (2026-08-03, `## c01 decision` in the plan):
 *  - The unbounded side was REPRODUCED, not inferred. With a listener on :5114 that accepts the TCP
 *    connection and never answers (the shape of an API that is mid-start, or of a wedged model runner),
 *    a request through the dev proxy was still open at 100s, which was the measuring client's own
 *    timeout and not a bound anywhere in the browser, the proxy or this client. There is no ceiling on
 *    this wait at all, which is why the user reported it as endless.
 *  - The healthy side is what the budget has to clear. A run sits in the dialog's state (a) until the
 *    server answers, and on the SYNC path that answer is the whole analysis, not a dispatch: the sync
 *    route is reserved by {@link shouldUseAsyncJob} for sub-threshold documents (one chunk), but on a
 *    local model that single chunk still has to cold-load the weights and generate.
 *  - The ASYNC dispatch it also covers is orders of magnitude faster (`POST analysis-jobs` answers as
 *    soon as the job row is enqueued; no model work), so a cold API's JIT and EF model build fit inside
 *    this with room to spare.
 *
 * WHY 180s STAYS, now that the healthy side HAS been measured (2026-08-04, `## c02 findings`):
 * The sync route was timed against a real 248-word Hebrew chapter - two words under the server's 250-word
 * Hebrew threshold, so the largest chapter that can take this route at all. Cold Proofread (`gemma4:12b`)
 * came in at 73.8s and 70.4s, which 180s clears. Cold LineEdit (`DictaLM-3.0-Nemotron-12B`, the OTHER
 * task sharing that threshold) came in at 32.0s, 45.1s and **394.3s** - a healthy HTTP 200 carrying a
 * real result, 2.2x over this budget. So THE BUDGET DOES MISFIRE, and no constant fixes that: the wall
 * clock tracks GENERATED TOKEN COUNT, which varied 13x across identical requests and is bounded only by
 * `Ollama_LineEdit.NumPredict` (5120). The 394.3s run did not approach that cap, so the true ceiling is
 * several times higher again - a budget that never misfired would have to be ~13 minutes, which is
 * indistinguishable from the endless wait this budget exists to end.
 *
 * The number is therefore NOT raised. Raising it re-creates the reported bug (a modal with no bound) to
 * buy an ever-shrinking reduction in false alarms. Instead the MISFIRE WAS MADE RECOVERABLE: the expiry
 * carries `startBudgetExpired: true`, and the run dialog lets this run's own late result retract that
 * terminal. That inverts the asymmetry this comment used to rest on - firing early is now cheap and
 * self-correcting, firing late is still the original defect - so if anything 180s is now conservative.
 */
export const RUN_START_BUDGET_MS = 180_000;

/**
 * a1: the run this service currently OWNS, described in the vocabulary every surface asks about it in.
 *
 * `AnalysisPanelComponent` is mounted under an `@if` and is destroyed on every tab or mode switch, so
 * until a1 the panel's own subscription was the only thing holding a run open: destroying it CANCELLED
 * an in-flight `/analyze`. The service now subscribes the run itself ({@link
 * AnalysisRunOrchestrationService.startRun}) and publishes this description of it, so a panel that
 * remounts mid-run can answer "is a run in flight for what I am showing?" without having started it.
 *
 * For an ASYNC run this is the belt to the registry's braces: `jobId` fills in the moment the dispatch
 * answers, and from then on `JobRegistryService` is the authority on the run's progress and terminal.
 * For a SYNC run there is no registry row at all, and this is the only description that exists.
 */
export interface ActiveRunContext {
  /** Opaque per-run identity, so a consumer can dedupe "this run's terminal" without a jobId. */
  runId: string;
  bookId: string;
  chapterId: string;
  sceneId: string | null;
  analysisType: string;
  /** The registry job id once the run dispatched async; null while it is sync or not yet dispatched. */
  jobId: string | null;
}

/**
 * How many of a run's events are replayed to a subscriber of {@link
 * AnalysisRunOrchestrationService.startRun}.
 *
 * Needed because the service subscribes the run FIRST (that is what makes the run outlive the panel) and
 * the caller subscribes to the returned stream immediately afterwards, by which time the opening
 * `'status'` - and, for a stub or a fail-fast path, the whole run - has already been emitted. The buffer
 * only has to survive that one call stack; the editor's own `RUN_EVENT_REPLAY` is sized the same way and
 * for the same reason.
 */
const RUN_EVENT_REPLAY = 64;

@Injectable({ providedIn: 'root' })
export class AnalysisRunOrchestrationService {
  /**
   * Every progress poll this service currently has open, so {@link stopProgressPolling} can be a
   * TEARDOWN of everything rather than a cancel of "the last one".
   *
   * a1: this replaced a single `progressStop$ : Subject<void> | null` field whose own comment claimed
   * "each polling run gets its own Subject instance so concurrent runs don't interfere" while the field
   * held exactly one. Two concurrent runs shared it, so the second run's `createProgressStop()` stopped
   * the FIRST run's poll, and any caller of `stopProgressPolling()` stopped whichever run happened to
   * have registered last. A run's poll is now scoped to that run's own subscription: unsubscribing the
   * run tears its poll down, and nothing else's.
   */
  private readonly activePolls = new Set<Subject<void>>();

  /** The run this service owns, or null. See {@link ActiveRunContext}. */
  private readonly activeRunSubject = new BehaviorSubject<ActiveRunContext | null>(null);

  /** The owned run, as a stream. Emits null when no run is in flight. */
  readonly activeRun$: Observable<ActiveRunContext | null> = this.activeRunSubject.asObservable();

  /** The owned run's current description, or null. Synchronous read of {@link activeRun$}. */
  get activeRun(): ActiveRunContext | null {
    return this.activeRunSubject.value;
  }

  /** The owned run's subscription: what keeps the HTTP request alive across a panel unmount. */
  private activeRunSub: Subscription | null = null;

  /** The owned run's event stream, multicast so a caller's unsubscribe does not cancel the run. */
  private activeRunEvents: ReplaySubject<AnalysisRunEvent> | null = null;

  /** Monotonic source of {@link ActiveRunContext.runId}. */
  private runSeq = 0;

  /**
   * Bounded read-after-write budget for {@link loadFinalResultForJob}. Deliberately the SAME numbers as
   * the panel's `proofreadFinalizeMaxRetries` / `proofreadFinalizeRetryMs` (3 x 600ms): both wait out the
   * same window - a row the server has just written becoming visible to the next GET - so they should not
   * disagree about how long that takes. ~1.8s of patience total, well under any user's notion of a hang,
   * and a persistent 404 still fails.
   */
  private readonly finalResultRetryMax = 3;
  private readonly finalResultRetryDelayMs = 600;

  /** Bounded start budget for this instance. See {@link RUN_START_BUDGET_MS}. */
  private readonly runStartTimeoutMs = RUN_START_BUDGET_MS;

  constructor(
    private analysisService: AnalysisService,
    private analysisProgressService: AnalysisProgressService
  ) {}

  /**
   * Stop EVERY progress poll this service has open.
   *
   * a1 narrowed who may call this. It is a whole-service teardown, not a per-run one: the panel's
   * `ngOnDestroy` used to call it, which stopped the poll of a run the panel no longer owned (and, with
   * the old single shared subject, could stop a DIFFERENT run's poll entirely). A run's poll now ends
   * with that run's subscription; this stays for a genuine "stop everything" caller and for symmetry
   * with the set it drains.
   */
  stopProgressPolling(): void {
    for (const stop$ of [...this.activePolls]) {
      stop$.next();
      stop$.complete();
    }
    this.activePolls.clear();
  }

  /**
   * Mint a stop subject for ONE poll, registered so {@link stopProgressPolling} can reach it.
   *
   * It deliberately does NOT cancel any previous poll: that was the shared-field behaviour a1 removed.
   * Concurrent runs are a real state (a chapter Proofread and a scene Proofread started back to back),
   * and each of their polls belongs to its own run's subscription.
   */
  private createProgressStop(): Subject<void> {
    const stop$ = new Subject<void>();
    this.activePolls.add(stop$);
    return stop$;
  }

  /** End one poll and forget it. Safe to call more than once for the same subject. */
  private releaseProgressStop(stop$: Subject<void>): void {
    stop$.next();
    this.activePolls.delete(stop$);
  }

  // ---------------------------------------------------------------------------
  // Run OWNERSHIP (a1)
  // ---------------------------------------------------------------------------

  /**
   * Start a run and OWN it: subscribe it here, so the request survives the caller going away.
   *
   * ── Why the service and not the panel ────────────────────────────────────────────────────────────
   * `AnalysisPanelComponent` is mounted under `@if (editHelpView === 'analysis')` inside
   * `@else if (reviewMode === 'edit')`, so switching the Edit-help sub-tab or the Review/Edit control
   * DESTROYS it. When the panel held the only subscription, that destruction cancelled the in-flight
   * `/analyze` - the run the user had just started simply stopped, silently, on the sync route - and the
   * panel had to tell the run dialog so ("run-finished", which the dialog reads as `canceled`). The run
   * is not a property of the surface that started it, so it lives here now.
   *
   * ── What the caller gets ─────────────────────────────────────────────────────────────────────────
   * A MULTICAST view of the run's events. Unsubscribing from it detaches that consumer and nothing more;
   * the run keeps going. It replays (see {@link RUN_EVENT_REPLAY}) because this method subscribes the
   * run before returning, so a caller that subscribes on the next line would otherwise miss the opening
   * `'status'`.
   *
   * ── Supersession ─────────────────────────────────────────────────────────────────────────────────
   * Starting a run DISCARDS the previously owned one, exactly as the panel's `runSubscription?.
   * unsubscribe()` did before it: one run at a time, and the newest is the one the user asked for.
   */
  startRun(ctx: AnalysisRunContext, saveBeforeRun?: () => Promise<void>): Observable<AnalysisRunEvent> {
    this.discardActiveRun();

    const events = new ReplaySubject<AnalysisRunEvent>(RUN_EVENT_REPLAY);
    this.activeRunEvents = events;
    this.activeRunSubject.next({
      runId: `run-${++this.runSeq}`,
      bookId: ctx.bookId,
      chapterId: ctx.chapterId,
      sceneId: ctx.sceneId ?? null,
      analysisType: ctx.selectedAnalysisType,
      jobId: null,
    });

    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      // Only clear if THIS run is still the owned one: a superseding startRun has already replaced both
      // fields and must not have them nulled out from under it by the run it superseded.
      if (this.activeRunEvents === events) {
        this.activeRunEvents = null;
        this.activeRunSub = null;
        this.activeRunSubject.next(null);
      }
      events.complete();
    };

    const sub = this.runAnalysisAfterSave(ctx, saveBeforeRun).subscribe({
      next: event => {
        // The dispatch answered: from here the REGISTRY owns this run's progress and terminal, and the
        // id is published so a consumer can tell "the sync run I was watching ended" from "the async job
        // I was watching ended" without guessing.
        if (event.kind === 'job-started') {
          const current = this.activeRunSubject.value;
          if (current && this.activeRunEvents === events) {
            this.activeRunSubject.next({ ...current, jobId: event.jobId });
          }
        }
        events.next(event);
      },
      error: () => end(),
      complete: () => end(),
    });
    // A run that finishes synchronously (a fail-fast path, or an `of()`-backed stub) has already run
    // `end()` by the time `subscribe` returns, so only record the subscription when it is still live.
    if (!ended) this.activeRunSub = sub;

    return events.asObservable();
  }

  /**
   * Drop the owned run: unsubscribe it (which cancels its request and tears down its poll) and clear the
   * published description. Called when a new run supersedes it.
   */
  private discardActiveRun(): void {
    this.activeRunSub?.unsubscribe();
    this.activeRunSub = null;
    this.activeRunEvents?.complete();
    this.activeRunEvents = null;
    if (this.activeRunSubject.value !== null) this.activeRunSubject.next(null);
  }

  // ---------------------------------------------------------------------------
  // Pure / computational helpers
  // ---------------------------------------------------------------------------

  /**
   * Decide whether a run uses the async job flow (analysis-jobs + analysis-progress poll) instead of a
   * blocking synchronous /analyze request.
   *
   * Two families qualify:
   *  - Single-shot whole-chapter LLM analyses (Linguistic/Literary/Summarization): ALWAYS async.
   *    Each sends the whole chapter to the model and can run for tens of seconds to minutes (Linguistic was
   *    measured at ~3 min), so a synchronous request risks a proxy/browser timeout that loses the result
   *    even though the server persisted it. The backend reads the chapter from the DB, so no documentText is
   *    required here to make the decision.
   *    Wave 3 / w7: `Custom` was a fourth member of this family and is gone with the pass. Nothing else
   *    routes on it, so a Custom value reaching here (it cannot: it is not startable) would fall through
   *    to the Proofread/LineEdit branch and be answered `false`, which is the safe direction.
   *  - Chunked Proofread/LineEdit: async only once the document exceeds the server chunk threshold; short
   *    documents finish fast enough to run inline.
   */
  shouldUseAsyncJob(ctx: AnalysisRunContext): boolean {
    const { selectedAnalysisType: analysisType, documentText, proofreadChunkTargetWords, lineEditChunkTargetWords } = ctx;
    if (
      analysisType === 'LinguisticAnalysis'
      || analysisType === 'LiteraryAnalysis'
      || analysisType === 'Summarization'
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
    // a1: this used to open with `stopProgressPolling()`, which - with the single shared stop subject it
    // was written against - meant "cancel whatever poll ran last". Supersession is now the OWNER's job
    // ({@link startRun} discards the previous run, taking its poll with its subscription), so composing a
    // run no longer reaches across into another run's state.
    const initialStatus = this.emitInitialStatusForRun(ctx);
    const run$: Observable<AnalysisRunEvent> = concat(
      of<AnalysisRunEvent>({ kind: 'status', message: initialStatus }),
      defer(() => this.doRunAnalysis(ctx))
    );
    const withSave$ = saveBeforeRun
      ? from(saveBeforeRun()).pipe(switchMap(() => run$))
      : run$;
    // The guard wraps the SAVE too, not just the run. A `saveBeforeRun()` promise that never settles
    // emits nothing at all - not even the initial `status` - so it is the one path on which the dialog
    // can sit in state (a) with no event ever having crossed the channel.
    return this.withStartTimeout(withSave$, ctx);
  }

  /**
   * c01 (run-dialog-starting-state-escape): bound how long a run may produce NO answer from the server.
   *
   * ── The defect ────────────────────────────────────────────────────────────────────────────────────
   * The run dialog is MODAL in its state (a) ("starting"), and state (a) lasts until an event arrives.
   * Nothing bounded that wait, so a request that never answers left the whole app behind a blurred,
   * `inert`-backed scrim with an indeterminate bar, forever. MEASURED 2026-08-03 (see
   * {@link runStartTimeoutMs}): a socket that accepts and never replies keeps such a request open with no
   * ceiling anywhere in the stack.
   *
   * ── Where it lives, and why HERE rather than on the dialog ────────────────────────────────────────
   * On the orchestration service, because "how long may a run go without answering" is a property of the
   * RUN, and the dialog is a VIEW over `runEvents$` plus the registry. A view that owns a business
   * timeout is how the two-poller problem started. The dialog needs no new notion of "over": the expiry
   * arrives as an ordinary `{ kind: 'error' }` on the one channel it already listens to, so its existing
   * `terminal` latch fires, `isModal` (a projection of `state`, kept that way) goes false, and c03's
   * machinery removes the backdrop, clears every `inert` and restores focus. No second terminal predicate
   * is introduced anywhere.
   *
   * ── Shape, deliberately mirroring {@link loadFinalResultForJob} rather than inventing a dialect ────
   *  - SUBSCRIPTION-SCOPED. `defer` mints the guard per subscription, so there is no budget FIELD on this
   *    root singleton, no reset site, and nothing for a context change to leave stale. The panel creates
   *    a fresh subscription per run, so every run gets a whole fresh budget by mechanism.
   *  - It CANNOT OUTLIVE THE RUN. The timer lives inside this subscription: the panel's `ngOnDestroy` and
   *    its next-run unsubscribe take it with them, and `finalize` cancels it when the run stream ends on
   *    its own, so a completed run leaves no pending timer behind.
   *  - It cancels on the FIRST proof the server answered ({@link provesServerAnswered}), not on the
   *    dialog reaching any particular state. A slow-but-healthy run is therefore never killed: the moment
   *    a jobId, a poll, a token, a result or an error exists, the budget is void.
   *
   * ── What it does NOT do ───────────────────────────────────────────────────────────────────────────
   * It does not cancel the run. There is no cancel endpoint at all (see the dialog's "close vs cancel"
   * note), so the request stays in flight and a result that lands later still reaches the panel through
   * the ordinary result event and its context guard. The expiry is a statement about what the CLIENT
   * knows, which is why its copy says the run did not start rather than that it failed.
   *
   * `doRunStreaming` is deliberately NOT wrapped: it is not reachable from any template today, and its
   * legitimate silence is time-to-first-token on a local model rather than a server that is not
   * answering. If it is ever wired to a control, it needs its own budget decision, not this one.
   */
  private withStartTimeout(
    run$: Observable<AnalysisRunEvent>,
    ctx: AnalysisRunContext
  ): Observable<AnalysisRunEvent> {
    return defer(() => {
      const answered$ = new Subject<void>();
      const expiry$ = timer(this.runStartTimeoutMs).pipe(
        takeUntil(answered$),
        map((): AnalysisRunEvent => {
          const lang = runChromeLang(ctx.language);
          // Observability: a start-budget expiry is a distinct failure mode from a request that failed,
          // and it leaves no HTTP error in the console to correlate against - the request is still open.
          // Bracketed-tag console.warn is the convention already used elsewhere in core/services. Ids and
          // document text are deliberately not logged.
          console.warn('[AnalysisRun] start budget expired: no answer from the server', {
            analysisType: ctx.selectedAnalysisType,
            timeoutMs: this.runStartTimeoutMs,
          });
          return {
            kind: 'error',
            // c02: marks this terminal as PROVISIONAL. The run was not cancelled (it cannot be), so a
            // surface that resolves on this must accept this run's own later result as a correction.
            startBudgetExpired: true,
            message: runString(lang, 'runStartTimedOut', {
              type: analysisTypeLabelFor(lang, ctx.selectedAnalysisType),
            }),
          };
        }),
      );
      const watched$ = run$.pipe(
        tap(event => { if (provesServerAnswered(event)) answered$.next(); }),
        // Covers the endings `tap` cannot see: the run completing or erroring with nothing to report, and
        // the subscriber walking away. Without it a completed run would leave the timer pending and the
        // merged stream would not complete until the budget elapsed.
        finalize(() => answered$.next()),
      );
      // ORDER IS LOAD-BEARING: `expiry$` must be subscribed BEFORE `watched$`, so its `takeUntil`
      // listener is already installed when `watched$` runs. A run that completes SYNCHRONOUSLY on
      // subscribe (a path that fails fast, or any `of()`-backed stub) fires `finalize` inside its own
      // subscribe call, and with the sources the other way round that cancellation would be published to
      // a subject nobody was listening to yet - leaving a live timer behind a finished run.
      return merge(expiry$, watched$);
    });
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
          // a1: no `stopProgressPolling()` here. This error ENDS this run's stream, and ending the
          // stream already tears down the only poll this run could have opened (the `concat`ed
          // `startProgressPollingIfNeeded` above, whose stop subject is released on its own teardown).
          // Reaching for the service-wide teardown from inside one run is how a second, unrelated run's
          // poll used to be killed by the first run's failure.
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
            this.releaseProgressStop(stop$);
          }
          return {
            kind: 'progress',
            percent: update.status === 'succeeded' ? 100 : update.progressPercent,
            message: update.message,
            rawStatus: update.status
          };
        }),
        catchError((): Observable<AnalysisRunEvent> => {
          this.releaseProgressStop(stop$);
          const lang = runChromeLang(language);
          return of<AnalysisRunEvent>({
            kind: 'status',
            message: runString(lang, 'runStarting', { type: analysisTypeLabelFor(lang, type) }),
          });
        }),
        // a1: whichever way this stream ends - terminal, error, or the OWNER discarding the run - the
        // poll stops and its stop subject leaves {@link activePolls}. Without this an unsubscribed run
        // would leave a live entry in the set, and the service-wide teardown would grow monotonically.
        finalize(() => this.releaseProgressStop(stop$)),
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
            this.releaseProgressStop(stop$);
            return concat(
              of(progressEvent),
              this.loadFinalResultForJob(bookId, chapterId, jobId, language)
            );
          }
          if (update.status === 'failed' || update.status === 'canceled') {
            this.releaseProgressStop(stop$);
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
          this.releaseProgressStop(stop$);
          return of<AnalysisRunEvent>({
            kind: 'status',
            message: runString(lang, 'runStarting', { type: typeLabel }),
          });
        }),
        // a1: see the twin in `startProgressPollingIfNeeded`.
        finalize(() => this.releaseProgressStop(stop$)),
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
    // Wave 3 / w7: a `customPrompt` field was set here for the Custom pass. The API still accepts one;
    // this client no longer has a surface that produces one, so it no longer sends the field at all.
    return {
      analysisType: ctx.selectedAnalysisType,
      language: ctx.language,
      stream
    };
  }
}
