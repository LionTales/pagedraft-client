import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

import { AnalysisProgressDto, ANALYSIS_TYPE_LABELS } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';
import { ChunkClock, EMPTY_CHUNK_CLOCK, advanceChunkClock, startChunkClock } from '../utils/chunk-eta';
import { AnalysisProgressService } from './analysis-progress.service';
import { AnalysisService } from './analysis.service';
import { BookSummaryService } from './book-summary.service';
import { BookReviewService } from './book-review.service';
import { StyleBaselineService } from './style-baseline.service';

/**
 * rf-c01 - the KEYSTONE. A root-provided singleton that is the FE's single VIEW-MODEL of every
 * background job and survives component unmounts.
 *
 * SCOPE GUARD: this is FE-ONLY. It is a cache + normalizer over BACKEND truth (status endpoints'
 * `activeBuildJobId` + the read-only rf-b01 active-analysis-jobs endpoint + persisted artifacts). It
 * does NOT own a durable, cross-instance, per-user job store or a queue - that belongs to the
 * multi-user production service, NOT this plan. All progress is HTTP-polled (reusing
 * AnalysisProgressService); there is no SignalR here (SignalR carries only chapter/scene events).
 *
 * This registry generalizes the per-component reattach + terminal-dedup pattern that already lives in
 * AnalysisPanelComponent (style-baseline) into ONE place:
 *   - context/stale guard: a poll or reattach response for a job whose id is no longer tracked (or was
 *     already finalized) is dropped, so a lingering/stale backend entry can never loop.
 *   - single-finalize: a job transitions to a terminal state EXACTLY ONCE even if the poll re-emits the
 *     same terminal snapshot or reattach re-discovers a lingering terminal entry.
 *
 * NOTE: rf-c02 will migrate the components (summary/review status rows + analysis panel) onto this
 * registry and delete their per-component `*HandledTerminalJobId` guards. This todo only builds the
 * registry + its own tests; it does NOT refactor those components.
 */
@Injectable({ providedIn: 'root' })
export class JobRegistryService {
  private readonly progress = inject(AnalysisProgressService);
  private readonly analysis = inject(AnalysisService);
  private readonly summarySvc = inject(BookSummaryService);
  private readonly reviewSvc = inject(BookReviewService);
  private readonly styleSvc = inject(StyleBaselineService);

  /** Retained recent-completed cap so the Activity Center can show "just finished". */
  private static readonly COMPLETED_CAP = 20;

  /** Single source of truth. Ordered newest-updated-first is not guaranteed; consumers filter/sort. */
  private readonly jobsSubject = new BehaviorSubject<TrackedJob[]>([]);

  /** All tracked jobs (active + retained recently-completed), newest registered last. */
  readonly jobs$: Observable<TrackedJob[]> = this.jobsSubject.asObservable();

  /** Only non-terminal (active) jobs. */
  readonly activeJobs$: Observable<TrackedJob[]> = this.jobs$.pipe(
    map(jobs => jobs.filter(j => !isTerminal(j.status))),
  );

  /**
   * Per-job teardown Subjects, keyed by job id. Completing one stops that job's poll (mirrors the
   * per-component stop$). Kept OUT of TrackedJob so the view-model stays a plain serializable shape.
   */
  private readonly stops = new Map<string, Subject<void>>();

  /**
   * The in-flight reattach subscription (at most one). A rapid A->B book switch must not let A's
   * async read land after B and track A's jobs, so a new reattach SUPERSEDES the previous one:
   * the prior subscription is torn down and its bookId is no longer the current one, so any
   * response that still resolves is dropped by the currency guard below.
   */
  private reattachSub: Subscription | null = null;
  /** The bookId of the CURRENT (latest) reattach; a stale response whose bookId differs is dropped. */
  private reattachBookId: string | null = null;

  // ── Reattach source-of-truth SEAM ──────────────────────────────────────────────────────────────
  //
  // `reattach(bookId)` reads the CURRENT truth of a book's in-flight jobs through the private
  // `readActiveJobsForBook(bookId)` method below. TODAY that method fans out over the four existing
  // read endpoints (three book-level status reads for `activeBuildJobId` + the rf-b01
  // active-analysis-jobs endpoint) and returns a normalized `ReattachSource[]`.
  //
  // A future durable, cross-instance job store (the multi-user production service) can replace the
  // BODY of `readActiveJobsForBook` with a single query WITHOUT touching `track`, the observables, or
  // any UI: the seam's CONTRACT is "given a bookId, return the set of jobs the backend currently
  // considers in-flight, already normalized to ReattachSource". Everything downstream keys off that.

  /**
   * Register a background job and start ONE progress poll for it (reusing AnalysisProgressService - no
   * new poller is forked). Idempotent per job id: calling track again for an id that is already being
   * polled updates its metadata but does NOT start a second poll.
   */
  track(kind: JobKind, bookId: string, jobId: string, meta: TrackMeta = {}): void {
    if (!jobId) return;

    const existing = this.findJob(jobId);
    // Already actively tracked (poll live): merge metadata, don't double-subscribe.
    if (existing && this.stops.has(jobId)) {
      this.patchJob(jobId, { ...pickMeta(meta), updatedAt: nowIso() });
      return;
    }
    // Re-tracking a job that previously reached terminal (lingering entry / re-discovered by reattach):
    // do NOT resurrect it into an active poll - single-finalize means terminal is forever.
    if (existing && isTerminal(existing.status)) {
      return;
    }
    // Torn-state guard: existing is non-terminal but has no live stop$ (poll was lost, e.g. after a
    // service reset or test manipulation). Resume exactly ONE poll for the existing job and merge
    // metadata WITHOUT resetting startedAt or status - so the job's history is preserved.
    if (existing && !this.stops.has(jobId)) {
      this.patchJob(jobId, { ...pickMeta(meta), updatedAt: nowIso() });
      this.startPoll(kind, bookId, jobId);
      return;
    }

    const startedAt = nowIso();
    const titles = titleForJob(kind, meta.analysisType);
    const job: TrackedJob = {
      id: jobId,
      kind,
      bookId,
      scopeLabel: meta.scopeLabel ?? defaultScopeLabel(kind),
      titleHe: meta.titleHe ?? titles.he,
      titleEn: meta.titleEn ?? titles.en,
      status: 'running',
      percent: clampPercent(meta.initialPercent ?? null),
      completedChunks: null,
      totalChunks: null,
      // c04. The throughput clock is stamped HERE, once, per job - not per component, and not per
      // surface: a dialog re-opened after a minimize or an Activity Center opened at 60% must measure
      // the window the RUN has been going, not the window their own view has existed for.
      //
      // A REATTACHED job gets no baseline (see TrackMeta.reattached): the run started before this tab
      // did, `startedAt` here is merely when the client noticed it, and treating that as the run start
      // would under-state elapsed and therefore under-state the time remaining - a confidently wrong
      // estimate, which the todo rules out explicitly. The clock instead opens at the first observed
      // poll and measures only what this client actually saw.
      chunkClock: meta.reattached ? EMPTY_CHUNK_CLOCK : startChunkClock(startedAt),
      message: meta.message ?? '',
      startedAt,
      updatedAt: startedAt,
      chapterId: meta.chapterId,
      sceneId: meta.sceneId,
      resultRoute: meta.resultRoute,
      analysisType: meta.analysisType,
    };
    this.upsert(job);
    this.startPoll(kind, bookId, jobId);
  }

  /**
   * Reattach to any in-flight jobs the BACKEND still considers running for this book (call on book
   * load). Re-tracks book-level builds whose status reports a non-null `activeBuildJobId` PLUS any
   * in-flight chapter Proofread/LineEdit jobs from the rf-b01 endpoint. This REPLACES the editor
   * reconcile poll AND makes chapter analysis jobs survive a browser refresh.
   *
   * Single-finalize + context guards: a source that is already actively tracked is skipped (no double
   * poll); a source whose id was already driven to terminal here is skipped (lingering entry can't
   * loop) - both handled inside `track`.
   */
  reattach(bookId: string, language: string): void {
    if (!bookId) return;

    // SUPERSESSION: a new reattach cancels any prior in-flight one. Without this, a rapid A->B book
    // switch lets A's async read land after B's and track A's jobs against the wrong current book.
    this.reattachSub?.unsubscribe();
    this.reattachBookId = bookId;

    // LANGUAGE: normalize to a base code so a locale like `en-US` cannot key a different
    // (BookId, Language) slot than the build POST/status reads used for the same book.
    const lang = normalizeLang(language);

    this.reattachSub = this.readActiveJobsForBook(bookId, lang).subscribe(sources => {
      // Currency guard: if a newer reattach (a different book) started while this read was in flight,
      // drop this response so a stale book's jobs are never tracked.
      if (this.reattachBookId !== bookId) return;
      for (const s of sources) {
        this.track(s.kind, bookId, s.jobId, {
          scopeLabel: s.scopeLabel,
          message: s.message,
          initialPercent: s.percent,
          analysisType: s.analysisType,
          chapterId: s.chapterId,
          // a1: the scene half of the job's SCOPE. Without it a reattached scene job is
          // indistinguishable from a chapter job of the same type in the same chapter, and the analysis
          // panel's "is a run in flight for what I am showing?" question (which is scene-precise, exactly
          // like `resultBelongsToRunOrigin`) would answer yes for the wrong unit.
          sceneId: s.sceneId,
          // c04: this job was already running before the client knew about it, so it gets no
          // client-side start time and therefore no ETA until it has been observed for a while.
          reattached: true,
        });
      }
    });
  }

  /**
   * True while a whole-book BUILD (book summary rollup OR developmental review) is running for this
   * book; false once all such builds have finalized. This is the single truth the editor's "review
   * running" affordance reads.
   *
   * It counts ONLY the {@link WHOLE_BOOK_BUILD_KINDS} - NOT every tracked job. Chapter `proofread`
   * runs and `style-baseline` builds are also published to the registry (for the Activity Center), but
   * they are not a summary/review build and must not light
   * the review affordance. Without this scoping, starting a chapter proofread or a style-baseline build
   * would falsely turn "review running" on.
   */
  anyRunningForBook$(bookId: string): Observable<boolean> {
    return this.jobs$.pipe(
      map(jobs => jobs.some(j =>
        j.bookId === bookId && WHOLE_BOOK_BUILD_KINDS.has(j.kind) && !isTerminal(j.status))),
      distinctUntilChanged(),
    );
  }

  /**
   * Observe ONE SPECIFIC tracked job by id, or null if it was never tracked / is not tracked yet.
   *
   * Added for the analysis run dialog (Wave 1d), which must follow exactly the job its own run started.
   * {@link jobByKindForBook$} is unfit for that: it resolves "the" job of a KIND for a BOOK, so two
   * concurrent runs of the same kind for the same book (e.g. a chapter Proofread and a scene Proofread
   * started back to back) collide on it and a dialog could end up rendering the other run's progress.
   *
   * Emits `null` (not an error) for an unknown id, so a caller can subscribe BEFORE `track` upserts the
   * job and simply transition when it appears. `distinctUntilChanged` dedupes the steady `null` stream;
   * every `patchJob` rebuilds the job object, so real updates always emit.
   */
  jobById$(jobId: string): Observable<TrackedJob | null> {
    return this.jobs$.pipe(
      map(jobs => jobs.find(j => j.id === jobId) ?? null),
      distinctUntilChanged(),
    );
  }

  /** The (single) tracked job of a given kind for a book, or null. Prefers the active one if several. */
  jobByKindForBook$(bookId: string, kind: JobKind): Observable<TrackedJob | null> {
    return this.jobs$.pipe(
      map(jobs => {
        const matches = jobs.filter(j => j.bookId === bookId && j.kind === kind);
        if (matches.length === 0) return null;
        const active = matches.find(j => !isTerminal(j.status));
        return active ?? matches[matches.length - 1];
      }),
      distinctUntilChanged(),
    );
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────────────

  /**
   * The swappable reattach seam's SOURCE. Fans out over the current backend read endpoints and returns
   * a normalized set of jobs the backend considers in-flight. A future durable store replaces ONLY the
   * body here. Every read is individually error-tolerant so one failing endpoint does not blank the
   * others (e.g. a book with no style baseline yet).
   */
  private readActiveJobsForBook(bookId: string, language: string): Observable<ReattachSource[]> {
    const summary$ = this.summarySvc.getBookSummaryStatus(bookId, language).pipe(
      map(s => s.activeBuildJobId
        ? [{ kind: 'summary' as JobKind, jobId: s.activeBuildJobId, scopeLabel: defaultScopeLabel('summary'), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    const review$ = this.reviewSvc.getReviewStatus(bookId, language).pipe(
      map(s => s.activeBuildJobId
        ? [{ kind: 'review' as JobKind, jobId: s.activeBuildJobId, scopeLabel: defaultScopeLabel('review'), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    const style$ = this.styleSvc.getStyleBaselineStatus(bookId, language).pipe(
      map(s => s.activeBuildJobId
        ? [{ kind: 'style-baseline' as JobKind, jobId: s.activeBuildJobId, scopeLabel: defaultScopeLabel('style-baseline'), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    const analysis$ = this.analysis.getActiveAnalysisJobs(bookId).pipe(
      map(jobs => jobs.map(j => analysisJobToSource(j))),
      catchError(() => of([] as ReattachSource[])),
    );

    return forkJoin([summary$, review$, style$, analysis$]).pipe(
      map(([a, b, c, d]) => [...a, ...b, ...c, ...d]),
    );
  }

  /**
   * Start the single progress poll for a job. Book-level kinds use their dedicated book-level poller
   * (estimatedCompletionPercent shape); chapter analysis kinds use pollProgress (completedChunks /
   * totalChunks shape). Both are normalized by `normalizeProgress` into the same TrackedJob update.
   */
  private startPoll(kind: JobKind, bookId: string, jobId: string): void {
    const stop$ = new Subject<void>();
    this.stops.set(jobId, stop$);

    const stream$ = this.progressStreamFor(kind, bookId, jobId, stop$);
    stream$.subscribe({
      next: p => this.onProgress(jobId, p),
      // A polling error is terminal for this job: finalize it as failed exactly once.
      error: () => this.finalize(jobId, 'failed'),
    });
  }

  /** Pick the right existing poller for the kind. Chapter analysis needs a chapterId. */
  private progressStreamFor(
    kind: JobKind,
    bookId: string,
    jobId: string,
    stop$: Observable<void>,
  ): Observable<AnalysisProgressDto> {
    switch (kind) {
      case 'summary':
        return this.progress.pollBookSummaryProgress(bookId, jobId, stop$);
      case 'review':
        return this.progress.pollBookReviewProgress(bookId, jobId, stop$);
      case 'style-baseline':
        return this.progress.pollStyleBaselineProgress(bookId, jobId, stop$);
      case 'proofread': {
        // Chapter-scoped async analysis. The chapterId lives on the tracked job (set at reattach/track
        // time from the source). Fall back defensively; the poller URL needs it.
        const chapterId = this.findJob(jobId)?.chapterId ?? '';
        return this.progress.pollProgress(bookId, chapterId, jobId, stop$);
      }
    }
  }

  /**
   * Handle one progress emission. Context guard: if the job is no longer tracked (context switched /
   * evicted) or was already finalized, drop the emit so a stale/lingering poll can't mutate state or
   * re-finalize. Otherwise normalize the DTO and either update in place or finalize once.
   */
  private onProgress(jobId: string, p: AnalysisProgressDto): void {
    const job = this.findJob(jobId);
    if (!job || isTerminal(job.status)) return; // context/stale guard + single-finalize

    const norm = normalizeProgress(p);
    const at = nowIso();
    // c04: fold this observation into the throughput clock BEFORE the terminal branch, so the last
    // chunk of a run that succeeds on the same poll still counts as evidence. Counts are STICKY: a
    // later poll that carries no chunk shape (a transient snapshot before/after chunking) keeps the
    // last known pair rather than blanking the readout, exactly as `percent` already does.
    const clock = advanceChunkClock(job.chunkClock, job.completedChunks, norm.completedChunks, at);
    const counts = {
      completedChunks: norm.completedChunks ?? job.completedChunks,
      totalChunks: norm.totalChunks ?? job.totalChunks,
      chunkClock: clock,
    };

    if (isTerminal(norm.status)) {
      this.finalize(jobId, norm.status, norm.percent, norm.message, counts);
      return;
    }
    this.patchJob(jobId, {
      ...counts,
      status: norm.status,
      percent: norm.percent ?? job.percent,
      message: norm.message || job.message,
      updatedAt: at,
    });
  }

  /**
   * Finalize a job to a terminal state EXACTLY ONCE. Idempotent: a second call for an already-terminal
   * job is a no-op (this is the single-finalize guarantee that replaces the per-component
   * `*HandledTerminalJobId` guards). Stops the poll and enforces the completed-cap.
   */
  private finalize(
    jobId: string,
    status: TerminalStatus,
    percent?: number | null,
    message?: string,
    counts?: ChunkCountPatch,
  ): void {
    const job = this.findJob(jobId);
    if (!job || isTerminal(job.status)) return; // already finalized once - never again

    this.stopPoll(jobId);
    const completedChunks = counts?.completedChunks ?? job.completedChunks;
    const totalChunks = counts?.totalChunks ?? job.totalChunks;
    this.patchJob(jobId, {
      status,
      percent: status === 'succeeded' ? 100 : (percent ?? job.percent),
      // c04: a SUCCEEDED run reads "10 of 10", for the same reason its percent is forced to 100. The
      // final poll usually says so already, but a terminal reached through the poll's error channel
      // (or a snapshot that lags by one chunk) would otherwise leave a finished card reading "9 of 10"
      // beside its own "Done" pill. A failed/canceled run keeps its real last-known counts: there the
      // shortfall is the truth.
      completedChunks: status === 'succeeded' ? (totalChunks ?? completedChunks) : completedChunks,
      totalChunks,
      ...(counts ? { chunkClock: counts.chunkClock } : {}),
      message: message || job.message,
      updatedAt: nowIso(),
    });
    this.evictOverCap();
  }

  private stopPoll(jobId: string): void {
    const stop$ = this.stops.get(jobId);
    if (stop$) {
      stop$.next();
      stop$.complete();
      this.stops.delete(jobId);
    }
  }

  /**
   * Evict retained COMPLETED jobs beyond the cap, newest-first (oldest completed dropped). Active
   * (non-terminal) jobs are NEVER evicted. "Newest" is by updatedAt (terminal timestamp).
   */
  private evictOverCap(): void {
    const jobs = this.jobsSubject.value;
    const completed = jobs.filter(j => isTerminal(j.status));
    if (completed.length <= JobRegistryService.COMPLETED_CAP) return;

    const keptCompleted = [...completed]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, JobRegistryService.COMPLETED_CAP);
    const keepIds = new Set(keptCompleted.map(j => j.id));
    const next = jobs.filter(j => !isTerminal(j.status) || keepIds.has(j.id));
    this.jobsSubject.next(next);
  }

  private findJob(jobId: string): TrackedJob | undefined {
    return this.jobsSubject.value.find(j => j.id === jobId);
  }

  private upsert(job: TrackedJob): void {
    const jobs = this.jobsSubject.value;
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx === -1) {
      this.jobsSubject.next([...jobs, job]);
    } else {
      const next = jobs.slice();
      next[idx] = job;
      this.jobsSubject.next(next);
    }
  }

  private patchJob(jobId: string, patch: Partial<TrackedJob>): void {
    const jobs = this.jobsSubject.value;
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx === -1) return;
    const next = jobs.slice();
    next[idx] = { ...next[idx], ...patch };
    this.jobsSubject.next(next);
  }
}

// ── Types ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The FE's normalized kinds of background job.
 *
 * Wave 3 / w5: a fifth member, `whole-book-analysis`, was REMOVED. It was reserved for a Phase 2 that
 * never landed: it carried a title, an icon, a scope label and a chunk-count entry, and a sweep of every
 * `track(` call site in the client found no caller that could ever produce one. The audit's own words for
 * it are "a dead label in the one surface whose job is to name what is happening", and shipping vocabulary
 * for a capability that does not exist is the same defect class the whole wave exists to remove. If a
 * whole-book analysis kind is ever built, it comes back WITH its producer, not before it.
 */
export type JobKind = 'summary' | 'review' | 'proofread' | 'style-baseline';

/**
 * The JobKinds that count as a whole-book BUILD for the editor's "review running" affordance: the book
 * summary rollup and the developmental review. Single source of truth for {@link
 * JobRegistryService.anyRunningForBook$}. Chapter `proofread` runs and `style-baseline` builds are
 * tracked for the Activity Center but are NOT a summary/review build, so they are deliberately excluded
 * here.
 */
const WHOLE_BOOK_BUILD_KINDS: ReadonlySet<JobKind> = new Set<JobKind>(['summary', 'review']);

/**
 * The JobKinds that can carry a `chapterId` and therefore belong in a book's PER-CHAPTER running
 * breakdown (the spine's stage 4, hosted by both `book-dashboard.component.ts` and
 * `editor-page.component.ts`). `proofread` is the only chapter/scene-scoped async analysis path today
 * (Proofread, LineEdit and the single-shot whole-chapter types all share it, distinguished by
 * `analysisType`) - `chapterId` (and, since a1, `sceneId`) reaches a `TrackedJob` through exactly TWO
 * routes, both of which end up as `meta.chapterId`/`meta.sceneId` on a `track()` call, whose own object
 * literal (or its `pickMeta` merge, for a re-track) is the actual WRITE onto the `TrackedJob` - not
 * {@link analysisJobToSource}, which only builds the metadata for one of the two routes: a REATTACHED
 * job sources it from {@link analysisJobToSource} (`getActiveAnalysisJobs`'s mapping - the only
 * `ReattachSource` producer that carries either field; the book-level kinds' sources never do), and a
 * LIVE-dispatched job has it passed directly by whichever caller started the run - today
 * `AnalysisRunOrchestrationService.publishJobToRegistry` (moved there from the analysis panel by c01).
 * f13 (2026-08-19): corrected from "the one place a TrackedJob.chapterId is ever set", already false
 * before c01 (the live caller passed it directly too, just from a different file) and doubly so after.
 *
 * Mirrors {@link WHOLE_BOOK_BUILD_KINDS}: an explicit allowlist, not "any job that happens to carry a
 * chapterId". Both hosts used to read the per-chapter breakdown off that absence rather than off this
 * set, two functions away from the idiom this constant establishes - true today only because no other
 * kind's `track()` call site ever passes `chapterId`, a fact enforced by nothing. Exported so the two
 * hosts read the SAME allowlist rather than each re-deriving "chapter-scoped" from the negative space of
 * {@link WHOLE_BOOK_BUILD_KINDS}.
 */
export const CHAPTER_SCOPED_KINDS: ReadonlySet<JobKind> = new Set<JobKind>(['proofread']);

/**
 * c02 (2026-08-03): the JobKinds whose `totalChunks` denominator is a unit a reader can identify from
 * the run's own scope, and which may therefore render the BARE, unlabelled `3/10` pair.
 *
 * `TotalChunks` is ONE wire field with a DIFFERENT unit per producer. Measured at the call sites, not
 * inferred:
 *
 * | kind              | producer                                                  | unit of `totalChunks`                            |
 * |-------------------|-----------------------------------------------------------|--------------------------------------------------|
 * | `proofread`       | `UnifiedAnalysisService` (`SetTotalChunks(chunks.Count)`)   | TEXT CHUNKS of the chapter/scene being analyzed   |
 * | `summary`         | `BookSummaryService` (`SetTotalChunks(chapters.Count)`)     | CHAPTERS of the book                              |
 * | `style-baseline`  | `StyleBaselineService` (`SetTotalChunks(chapters.Count)`)   | CHAPTERS of the book                              |
 * | `review`          | `BookReviewService` (`windowCount + reducePassCount`)       | MAP WINDOWS **plus** a variable number of REDUCE  |
 * |                   | and the legacy branch (`SetTotalChunks(Dimensions.Length)`) | passes, or DIMENSIONS on the legacy branch        |
 *
 * The first three denominators are countable units of the thing the user pointed at: the chapter they
 * asked to proofread, the chapters of the book they asked to summarize. A bare `3/12` is legible there
 * whichever of the two readings ("3 of 12 chapters" / "3 of 12 pieces of work") the reader takes,
 * because both are true and both are monotone in progress.
 *
 * `review` is excluded, and it is the only exclusion. Its denominator is not a unit at all: it is a
 * count of map-reduce WINDOWS (a window spans several chapters) plus one synthesis pass plus a
 * VARIABLE, plan-dependent number of continuity passes, and the legacy per-dimension branch reports
 * dimensions into the same field. So `3/10` on a review row for a 40-chapter book invites exactly one
 * reading ("10 chapters?") and that reading is wrong, the denominator can change between two runs of an
 * unchanged book, and none of the three surfaces carries a unit label to correct any of it. A number
 * that is only readable if you know which server-side branch produced it is not shown.
 *
 * SINGLE SOURCE OF TRUTH: every surface asks {@link showsChunkCounts}; no surface hand-copies the
 * condition (the `WHOLE_BOOK_BUILD_KINDS` precedent, same file, same reason). A NEW JobKind is absent
 * from this set and therefore renders no counts until someone states its unit here, which is the safe
 * default: the failure mode this scoping fixes was a reader that showed whatever the wire sent.
 */
const CHUNK_COUNT_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  'proofread',
  'summary',
  'style-baseline',
]);

/**
 * Whether a tracked job's chunk counts may be rendered as a bare `completed/total` pair.
 *
 * BOTH halves of the test live here so neither is re-derived per surface: the job must have a chunk
 * shape at all (`totalChunks !== null`, the registry's own "counts are known" test) AND its kind's
 * denominator must be a legible unit ({@link CHUNK_COUNT_KINDS}). The run dialog, the in-page indicator
 * and the Activity Center row all call this one predicate; `three-surface-parity.spec.ts` pins that they
 * agree per kind.
 */
export function showsChunkCounts(job: Pick<TrackedJob, 'kind' | 'totalChunks'> | null | undefined): boolean {
  if (!job || job.totalChunks === null) return false;
  return CHUNK_COUNT_KINDS.has(job.kind);
}

/**
 * a1: the (book, chapter, scene, analysis type) unit a chapter-scoped analysis run belongs to.
 *
 * This is the SAME tuple `AnalysisPanelComponent.resultBelongsToRunOrigin` compares, stated once so the
 * "is a run in flight for what I am showing?" question and the "does this result belong here?" question
 * cannot drift apart.
 */
export interface AnalysisJobContext {
  bookId: string | null;
  chapterId: string | null;
  sceneId: string | null;
  analysisType: string;
}

/**
 * Does this tracked job belong to the given analysis context?
 *
 * Exported and pure because it is the ONE definition of that match: the analysis panel derives its
 * "running" state from it (a1), and a spec can exercise it without a registry. `null`/`undefined` are
 * normalized to `null` on both sides so a chapter-scoped job (no `sceneId`) matches a chapter-scoped
 * panel (no `sceneId`) and never a scene-scoped one.
 *
 * Deliberately says nothing about the job's STATUS: callers ask that separately with {@link isTerminal},
 * because both questions ("is one running?" and "did the one I saw just finish?") are asked of the same
 * matched set.
 */
export function jobMatchesAnalysisContext(job: TrackedJob, ctx: AnalysisJobContext): boolean {
  if (!CHAPTER_SCOPED_KINDS.has(job.kind)) return false;
  if (!ctx.bookId || !ctx.chapterId) return false;
  return job.bookId === ctx.bookId
    && (job.chapterId ?? null) === ctx.chapterId
    && (job.sceneId ?? null) === (ctx.sceneId ?? null)
    && (job.analysisType ?? null) === ctx.analysisType;
}

/** The registry's lowercase status vocabulary (backend PascalCase enums normalize down to these). */
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type TerminalStatus = 'succeeded' | 'failed' | 'canceled';

/** Normalized, serializable view-model of one background job. `startedAt`/`updatedAt` are ISO strings. */
export interface TrackedJob {
  id: string;
  kind: JobKind;
  bookId: string;
  /** Short human label of what the job covers (e.g. "Whole book", chapter title). */
  scopeLabel: string;
  /** DRAFT he - needs native review. */
  titleHe: string;
  titleEn: string;
  status: JobStatus;
  /** 0-100, or null when indeterminate (no reliable percent available). Never NaN/negative/over-100. */
  percent: number | null;
  /**
   * c04: the REAL chunk counts behind {@link percent}, carried as structured numbers.
   *
   * `0%` beside a run that has queued ten chunks is honest but reads as stalled, because `percent` is
   * derived from `completedChunks / totalChunks` and the parallel workers finish nothing for the first
   * stretch. "0 of 10" says the same thing and reads as work in progress. Every surface that shows a
   * count reads THESE fields, exactly as it reads `percent`, so the three surfaces cannot disagree
   * (`three-surface-parity.spec.ts` is the fence).
   *
   * `totalChunks` is null - not 0 - whenever the run has no usable chunk shape (a single-shot analysis,
   * or a poll before chunking has happened), so "counts are known" is exactly `totalChunks !== null`
   * and no surface has to re-derive that test. `completedChunks` is null in the same situations, and 0
   * (a real zero) once chunking is known but nothing has finished.
   */
  completedChunks: number | null;
  totalChunks: number | null;
  /**
   * c04: the per-JOB throughput clock the time-remaining estimate is computed from. Registry-owned, so
   * a surface mounted mid-run cannot compute from its own mount time. See `core/utils/chunk-eta.ts`;
   * pass it to `estimateRemainingMs` rather than reading its fields directly.
   */
  chunkClock: ChunkClock;
  /**
   * The backend's own progress prose, verbatim ("Running chunk 2/10", "Proofread finished", a .NET
   * exception string on a failure).
   *
   * c02: this is DIAGNOSTIC, not chrome, and NO surface renders it. It is always English, so rendering
   * it put Latin prose inside RTL Hebrew chrome next to a correctly-localized status pill; the run
   * dialog (the only surface that ever read it) now composes its detail line from the STRUCTURED
   * status/percent instead. Kept on the view-model because it is the one place a backend-side failure
   * reason is visible at all from the client, and because dropping the field would silently discard it
   * from the reattach payload too. If you are about to bind this into a template: do not.
   */
  message: string;
  startedAt: string;
  updatedAt: string;
  /** Chapter this job belongs to (chapter analysis kinds); undefined for book-level builds. */
  chapterId?: string;
  /**
   * a1: the SCENE this job was started against, when the run was scene-scoped; undefined for a
   * chapter-scoped run and for every book-level build.
   *
   * It is carried for the same reason {@link chapterId} is: a job's identity for a UI question is its
   * SCOPE, and the analysis panel's scope is (chapter, scene) - `resultBelongsToRunOrigin` has always
   * compared both. Before this field the registry could only answer "a Proofread is running in this
   * chapter", so a scene run and a chapter run in the same chapter were the same job to every consumer.
   */
  sceneId?: string;
  /** Where "view" navigates when done. Best-effort; the Activity Center (rf-f01) consumes it. */
  resultRoute?: string;
  /**
   * The analysis type behind a chapter-scoped `proofread` job (e.g. 'Summarization', 'LineEdit');
   * undefined for the book-level build kinds. Chapter/scene analysis rides ONE JobKind for every type, so
   * this is the only field that distinguishes them, and it drives both the row title and (since w5) the
   * row ICON.
   */
  analysisType?: string;
}

/** Optional metadata accepted by `track`. */
export interface TrackMeta {
  scopeLabel?: string;
  titleHe?: string;
  titleEn?: string;
  message?: string;
  initialPercent?: number | null;
  chapterId?: string;
  /** a1: the scene the run was started against; see {@link TrackedJob.sceneId}. */
  sceneId?: string;
  resultRoute?: string;
  analysisType?: string;
  /**
   * c04: this job was discovered by the REATTACH seam rather than started by this client, so it has no
   * trustworthy client-side start time and its throughput clock opens at the first observed poll
   * instead. Set ONLY by `reattach`. It is not a TrackedJob field (`pickMeta` does not carry it): it
   * describes how the job was learned about, and it is consumed once, when the clock is created.
   */
  reattached?: boolean;
}

/** The chunk-count fields one progress observation contributes. Kept together so `finalize` and the
 * running patch cannot apply a different subset of them. */
interface ChunkCountPatch {
  completedChunks: number | null;
  totalChunks: number | null;
  chunkClock: ChunkClock;
}

/** Normalized in-flight job discovered by the reattach seam. */
interface ReattachSource {
  kind: JobKind;
  jobId: string;
  scopeLabel: string;
  percent: number | null;
  message: string;
  analysisType?: string;
  chapterId?: string;
  sceneId?: string;
}

// ── Pure helpers (exported where the spec needs them) ─────────────────────────────────────────────

/**
 * Normalize EITHER progress DTO shape into { status, percent, message, completedChunks, totalChunks }.
 *   - book-level pollers carry `estimatedCompletionPercent` (0-100; may be absent/negative -> null).
 *   - analysis poller carries `completedChunks`/`totalChunks` -> round(100*completed/total).
 * Percent is clamped 0-100 and is null (indeterminate) when neither shape yields a usable number.
 *
 * c04: the raw counts come back out alongside the derived percent. They were already being read here to
 * DERIVE the percent and then discarded; a surface that wanted "3 of 10" had no way to get it, and
 * parsing it back out of the backend's English `message` was the alternative this plan rejected.
 */
export function normalizeProgress(p: AnalysisProgressDto): {
  status: JobStatus;
  percent: number | null;
  message: string;
  completedChunks: number | null;
  totalChunks: number | null;
} {
  const status = normalizeStatus(p?.status);
  const percent = status === 'succeeded' ? 100 : progressPercent(p);
  return { status, percent, message: p?.message ?? '', ...chunkCounts(p) };
}

/**
 * The DTO's chunk counts, or nulls when it carries no usable chunk shape.
 *
 * `totalChunks <= 0` is the backend's "not chunked / not chunked yet" state, and it maps to NULL rather
 * than 0 so every consumer's "do we have counts?" test is a single null check (and so nothing can render
 * "0 of 0"). The completed count is clamped into [0, total]: a snapshot claiming more completed than
 * total would make the estimator's remaining count negative, and the percent is already clamped the same
 * way, so this keeps the two readouts telling one story.
 */
function chunkCounts(p: AnalysisProgressDto): { completedChunks: number | null; totalChunks: number | null } {
  const rawTotal = p?.totalChunks;
  if (typeof rawTotal !== 'number' || !Number.isFinite(rawTotal) || rawTotal <= 0) {
    return { completedChunks: null, totalChunks: null };
  }
  const total = Math.floor(rawTotal);
  const rawCompleted = p?.completedChunks;
  const completed = typeof rawCompleted === 'number' && Number.isFinite(rawCompleted) ? Math.floor(rawCompleted) : 0;
  return { completedChunks: Math.max(0, Math.min(total, completed)), totalChunks: total };
}

/**
 * Compute a 0-100 percent from a progress DTO, preferring the chunk shape (completedChunks/totalChunks)
 * when totalChunks > 0, else falling back to estimatedCompletionPercent. Returns null (indeterminate)
 * when neither yields a finite number, and clamps every result to [0, 100].
 */
export function progressPercent(p: AnalysisProgressDto): number | null {
  const total = typeof p?.totalChunks === 'number' ? p.totalChunks : 0;
  const completed = typeof p?.completedChunks === 'number' ? p.completedChunks : 0;
  if (total > 0) {
    return clampPercent(Math.round((100 * completed) / total));
  }
  // total <= 0: the chunk shape is not usable; try the book-level percent. A NEGATIVE
  // estimatedCompletionPercent is the backend's "no estimate yet" sentinel (mirrors the orchestration
  // service's `>= 0` gate), so treat it as absent -> null (indeterminate), NOT as 0%.
  const est = p?.estimatedCompletionPercent;
  if (typeof est === 'number' && Number.isFinite(est) && est >= 0) {
    return clampPercent(est);
  }
  return null;
}

/** Clamp a percent to [0, 100]; null/NaN/undefined -> null. Never negative/over-100/NaN. */
export function clampPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Map any backend status casing (PascalCase enum or lowercase) to the registry vocabulary. */
export function normalizeStatus(status: string | null | undefined): JobStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'canceled':
    case 'cancelled': return 'canceled';
    case 'pending': return 'pending';
    default: return 'running';
  }
}

export function isTerminal(status: JobStatus): status is TerminalStatus {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

/**
 * Normalize a language/locale to its base code so the reattach seam keys the SAME (BookId, Language)
 * slot the build POST / status reads use: lowercase + take the part before any '-' (e.g. `en-US` -> `en`,
 * `he-IL` -> `he`). Empty/whitespace falls back to 'he' (the app default), matching the status rows'
 * `bookLanguage.trim() || 'he'`. Exported for the spec's normalization assertion.
 */
export function normalizeLang(language: string | null | undefined): string {
  const base = (language ?? '').trim().toLowerCase().split('-')[0];
  return base || 'he';
}

/** Map an rf-b01 active-analysis-job DTO to a normalized reattach source. */
function analysisJobToSource(j: ActiveAnalysisJobDto): ReattachSource {
  return {
    // Chapter/scene async analysis is the `proofread` kind today: Proofread, LineEdit, and the
    // single-shot whole-chapter types (Linguistic, Literary, Summarization, Custom) all share this
    // async path, distinguished by `analysisType`.
    kind: 'proofread',
    jobId: j.jobId,
    // Scope label must match what the live `job-started` path sets in
    // AnalysisRunOrchestrationService.publishJobToRegistry (it lived in AnalysisPanelComponent until
    // c01 moved the write off that unmountable surface): a
    // scene-scoped job reattaches as 'סצנה', not the chapter default 'פרק'. Otherwise `track`'s
    // idempotent metadata merge overwrites a live scene job's label with the chapter default after a
    // refresh or book reload (and a freshly reattached scene job would render as a chapter). Any
    // non-scene job keeps the proofread default. DRAFT he - needs native review.
    scopeLabel: j.sceneId ? 'סצנה' : defaultScopeLabel('proofread'),
    // Unlike the poll DTO, the rf-b01 active-analysis-job carries a NON-NEGATIVE int with no "unknown"
    // sentinel: its own doc says 0 can mean "not yet chunked", i.e. progress is not yet known - NOT
    // genuinely 0% done. So treat only a strictly-positive value as a determinate percent and map 0 to
    // null (indeterminate), matching how progressPercent renders an unknown percent. The job shows the
    // indeterminate bar until the first poll after reattach reports a real percent.
    percent: j.estimatedCompletionPercent > 0 ? clampPercent(j.estimatedCompletionPercent) : null,
    message: j.message ?? '',
    analysisType: j.analysisType,
    chapterId: j.chapterId ?? undefined,
    // a1: the DTO has always carried this (the scope label above is derived from it); it was simply
    // dropped on the floor here, so a reattached scene job reached the registry as a chapter job.
    sceneId: j.sceneId ?? undefined,
  };
}

function pickMeta(meta: TrackMeta): Partial<TrackedJob> {
  const out: Partial<TrackedJob> = {};
  if (meta.scopeLabel !== undefined) out.scopeLabel = meta.scopeLabel;
  if (meta.titleHe !== undefined) out.titleHe = meta.titleHe;
  if (meta.titleEn !== undefined) out.titleEn = meta.titleEn;
  if (meta.message !== undefined) out.message = meta.message;
  if (meta.resultRoute !== undefined) out.resultRoute = meta.resultRoute;
  if (meta.analysisType !== undefined) out.analysisType = meta.analysisType;
  if (meta.chapterId !== undefined) out.chapterId = meta.chapterId;
  if (meta.sceneId !== undefined) out.sceneId = meta.sceneId;
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Default titles per kind. Hebrew strings are DRAFT and marked for native-speaker validation.
 * No em-dash in any user-facing string.
 */
// DRAFT he - needs native review
export const DEFAULT_TITLES: Record<JobKind, { he: string; en: string }> = {
  // Wave 3 / w6 (Q9-C): the stage-2 build is "Book briefs" / "תקצירי ספר" everywhere the wave touched,
  // and this default title was the last activity surface still calling it the book SUMMARY - the exact
  // word the per-chapter pass was renamed away from. DRAFT he - w8 native sweep.
  'summary': { he: 'בניית תקצירי הספר', en: 'Building the book briefs' },
  'review': { he: 'סקירת הספר', en: 'Reviewing book' },
  'proofread': { he: 'הגהה', en: 'Proofreading' },
  // w5: renamed to match the row's new user-comprehensible name on the book dashboard, so the activity
  // entry and the build it reports name the same thing. DRAFT he - needs native review.
  'style-baseline': { he: 'בניית סגנון הכתיבה של הספר', en: "Building your book's writing style" },
};

/**
 * EVERY member of {@link JobKind}, DISCOVERED from {@link DEFAULT_TITLES} rather than restated.
 *
 * The union has no runtime representation, so a test that wants to iterate it has to get the members from
 * somewhere. Hand-writing the list is what finding 33 caught: `const kinds: JobKind[] = ['summary', ...]`
 * assigns cleanly for a union of ANY size, so such a list silently goes stale the moment a member lands
 * and asserts nothing about the union at all.
 *
 * `Record<JobKind, ...>` is different: TypeScript DOES reject a Record that is missing a member, so a new
 * kind cannot reach a build without an entry here, and once it has one this array grows on its own. That
 * makes this the discovered side of the completeness oracle in `job-registry.service.spec.ts` (one side
 * must be discovered, never both hand-authored), and it is the reason `DEFAULT_TITLES` is exported: not
 * because a caller needs the strings, but because the KEY SET is the mechanical enumeration.
 *
 * Frozen, and typed as readonly, so a consumer cannot mutate the enumeration it is asking about.
 */
export const ALL_JOB_KINDS: readonly JobKind[] = Object.freeze(
  Object.keys(DEFAULT_TITLES) as JobKind[],
);

/**
 * Title (he/en) for a NEW tracked job. Chapter/scene async analysis rides ONE JobKind (`proofread`) for
 * ALL analysis types (Proofread, LineEdit, Linguistic, Literary, Summarization, Custom), so the kind
 * alone cannot name the row - only the `analysisType` distinguishes them. When a chapter analysis job
 * carries an analysisType, resolve its title from the shared ANALYSIS_TYPE_LABELS source (kept in sync
 * with every other analysis-type surface) so an in-flight LineEdit reads "Line Edit" / "עריכת שורה"
 * instead of the proofread default. Any other kind, or an absent/unknown analysisType, falls back to
 * the per-kind default.
 */
function titleForJob(kind: JobKind, analysisType: string | undefined): { he: string; en: string } {
  if (kind === 'proofread' && analysisType) {
    const he = ANALYSIS_TYPE_LABELS.he[analysisType];
    const en = ANALYSIS_TYPE_LABELS.en[analysisType];
    if (he && en) return { he, en };
  }
  return DEFAULT_TITLES[kind];
}

/** Default scope label per kind. DRAFT Hebrew where user-facing; the FE resolves richer labels later. */
// DRAFT he - needs native review
function defaultScopeLabel(kind: JobKind): string {
  switch (kind) {
    case 'summary':
    case 'review':
    case 'style-baseline':
      return 'הספר כולו'; // "Whole book"
    case 'proofread':
      return 'פרק'; // "Chapter"
  }
}
