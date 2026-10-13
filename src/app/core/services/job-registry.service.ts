import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map } from 'rxjs/operators';

import { AnalysisProgressDto } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';
import { EMPTY_CHUNK_CLOCK, advanceChunkClock, startChunkClock } from '../utils/chunk-eta';
import {
  ChunkCountPatch,
  JobEndedBy,
  JobKind,
  ReattachSource,
  TerminalStatus,
  TrackMeta,
  TrackedJob,
  WHOLE_BOOK_BUILD_KINDS,
  analysisJobToSource,
  clampPercent,
  defaultScopeLabel,
  isTerminal,
  normalizeLang,
  normalizeProgress,
  nowIso,
  pickMeta,
  serverEtaOf,
  serverWordPercent,
  titleForJob,
} from './job-registry.model';
import { AnalysisProgressService, isJobUnknownError } from './analysis-progress.service';
import { AnalysisService } from './analysis.service';
import { BookSummaryService } from './book-summary.service';
import { BookReviewService } from './book-review.service';
import { StyleBaselineService } from './style-baseline.service';
import { BookProofreadService } from './book-proofread.service';

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
 *     same terminal snapshot or reattach re-discovers a lingering terminal entry. c01: the one exception
 *     is a job the CLIENT lost (`endedBy: 'poll-error'`), which a later `track` of the same id resumes.
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
  private readonly proofreadSvc = inject(BookProofreadService);

  /**
   * Retained recent-completed cap so the Activity Center can show "just finished". c03: counts top-level
   * jobs only; a whole-book run's finished children are retained while their parent runs and dropped once
   * it ends (see `evictOverCap`), so a 30-chapter run cannot push 30 unrelated completions out.
   */
  private static readonly COMPLETED_CAP = 20;

  /**
   * c03: the language this client last saw for each book (a `reattach` argument, or a `track` caller's
   * `meta.language`), base code. Read only to word a DEFAULT scope label (reattach, child discovery).
   */
  private readonly bookLanguages = new Map<string, string>();

  /**
   * c03: ids of jobs THIS client tracked as its own live run (any `track` without `reattached`). Child
   * discovery never tags one of these as a whole-book run's child. Pruned with the job (`evictOverCap`).
   */
  private readonly liveTrackedIds = new Set<string>();

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
    if (meta.language) this.bookLanguages.set(bookId, normalizeLang(meta.language));
    // c03: a job THIS client tracks as its own live run is never a whole-book run's child (see
    // `discoverChildJobs`), even if a discovery read happened to see it first.
    if (!meta.reattached) this.liveTrackedIds.add(jobId);

    const existing = this.findJob(jobId);
    // Already actively tracked (poll live): merge metadata, don't double-subscribe.
    if (existing && this.stops.has(jobId)) {
      this.patchJob(jobId, { ...this.mergeMeta(meta), updatedAt: nowIso() });
      return;
    }
    // c01: EXCEPT a job this client LOST: its poll ran out of reads (see POLL_TRANSIENT_ERROR_BUDGET), so
    // the 'failed' it carries is the client's, not the server's. Whoever tracks it again has just been told
    // by the backend that it is still in flight (a status read's active id, a reattach, child discovery),
    // so resume ONE poll for it, keeping its history (startedAt, counts, clock). The poll's next answer
    // settles it either way: a server terminal, a 404 (server-ended, never resumed), or another loss.
    if (existing && isTerminal(existing.status) && existing.endedBy === 'poll-error') {
      this.patchJob(jobId, { ...this.mergeMeta(meta), status: 'running', endedBy: undefined, updatedAt: nowIso() });
      this.startPoll(kind, bookId, jobId);
      return;
    }
    // Re-tracking a job that previously reached terminal (lingering entry / re-discovered by reattach):
    // do NOT resurrect it into an active poll - single-finalize means a SERVER terminal is forever.
    if (existing && isTerminal(existing.status)) {
      return;
    }
    // Torn-state guard: existing is non-terminal but has no live stop$ (poll was lost, e.g. after a
    // service reset or test manipulation). Resume exactly ONE poll for the existing job and merge
    // metadata WITHOUT resetting startedAt or status - so the job's history is preserved.
    if (existing && !this.stops.has(jobId)) {
      this.patchJob(jobId, { ...this.mergeMeta(meta), updatedAt: nowIso() });
      this.startPoll(kind, bookId, jobId);
      return;
    }

    const startedAt = nowIso();
    const titles = titleForJob(kind, meta.analysisType);
    const job: TrackedJob = {
      id: jobId,
      kind,
      bookId,
      scopeLabel: meta.scopeLabel ?? defaultScopeLabel(kind, this.bookLanguages.get(bookId)),
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
      ...(meta.parentJobId && meta.reattached ? { parentJobId: meta.parentJobId } : {}),
    };
    this.upsert(job);
    this.startPoll(kind, bookId, jobId);
  }

  /**
   * The metadata a re-track of an ALREADY-tracked job merges in.
   *
   * c03: a `reattached` re-track (reattach on book load, and child discovery on EVERY parent tick) carries
   * the backend's defaults, not a caller's knowledge, so it never overwrites the job's `scopeLabel`: the
   * live path words that label in the run's language ('Chapter' on an English book), and the discovery
   * tick used to put 'פרק' back over it every five seconds. A LIVE re-track (this client's own run) is
   * authoritative and also clears `parentJobId`: a run this client started is nobody's child.
   */
  private mergeMeta(meta: TrackMeta): Partial<TrackedJob> {
    const merged = pickMeta(meta);
    if (meta.reattached) {
      delete merged.scopeLabel;
    } else {
      merged.parentJobId = undefined;
    }
    return merged;
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
    this.bookLanguages.set(bookId, lang);

    this.reattachSub = this.readActiveJobsForBook(bookId, lang).subscribe(sources => {
      // Currency guard: if a newer reattach (a different book) started while this read was in flight,
      // drop this response so a stale book's jobs are never tracked.
      if (this.reattachBookId !== bookId) return;
      // c03: a book opened mid-run reads the parent AND its current child in this one response; tag the
      // child now rather than leaving it a separate row until the parent's first discovery tick.
      const parentJobId = sources.find(s => s.kind === 'book-proofread')?.jobId;
      for (const s of sources) this.trackReattachSource(bookId, s, parentJobId ? this.childParentFor(s, parentJobId) : undefined);
    });
  }

  /**
   * c03: the parent a backend-reported job belongs to while a whole-book proofread `parentJobId` runs on its
   * book, or undefined. The active-jobs read does not say which run created a job, so this is decided on
   * the client: the run only ever creates Proofread chapter/scene jobs, and a job this client started
   * itself ({@link liveTrackedIds}) is the author's own run, never a child. Residual: a Proofread the
   * author started in ANOTHER tab during the run is folded into the run's row here (its own chapter badge
   * still lights; only the Activity Center row and the dock count are merged).
   */
  private childParentFor(s: ReattachSource, parentJobId: string): string | undefined {
    if (s.kind !== 'proofread' || s.analysisType !== 'Proofread') return undefined;
    return this.liveTrackedIds.has(s.jobId) ? undefined : parentJobId;
  }

  /** Track one job the BACKEND reported as in flight (reattach, and c6's child discovery below). */
  private trackReattachSource(bookId: string, s: ReattachSource, parentJobId?: string): void {
    this.track(s.kind, bookId, s.jobId, {
      parentJobId,
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

  // ── c6: the whole-book proofread's CHILD jobs ───────────────────────────────────────────────────
  //
  // A whole-book proofread is ONE parent job (`book-proofread`) that creates a plain Chapter-scope
  // Proofread job per chapter, ONE AT A TIME, server-side. Before c6 the client learned about chapter
  // jobs in exactly two ways: the run it dispatched itself, and `reattach` on book load. Neither sees a
  // child the server creates mid-run, so a run over N chapters lit at most the chapter that happened to
  // be running when the book was opened: the dashboard's stage-4 running marks stayed dark, and the
  // analysis panel on the open chapter never saw its child go terminal, so it never re-read history.
  //
  // So while a parent is polled, each poll tick also re-reads the book's active chapter jobs and tracks
  // what it finds. `track` is idempotent per id, which is what makes a re-read every tick safe: a child
  // already tracked is a metadata merge, a child already finished here is never resurrected. One read in
  // flight per parent at a time, so a slow answer is never overlapped by the next tick's.

  /** Parent job ids whose child-discovery read is in flight right now. */
  private readonly childDiscoveryInFlight = new Set<string>();

  private discoverChildJobs(bookId: string, parentJobId: string): void {
    if (this.childDiscoveryInFlight.has(parentJobId)) return;
    this.childDiscoveryInFlight.add(parentJobId);
    this.analysis.getActiveAnalysisJobs(bookId).pipe(
      catchError(() => of([] as ActiveAnalysisJobDto[])),
      finalize(() => this.childDiscoveryInFlight.delete(parentJobId)),
    ).subscribe(jobs => {
      // c03: each child is tagged with its parent (folded into the run's row by the unscoped readers) and
      // its default scope label is worded in the book's language.
      const lang = this.bookLanguages.get(bookId);
      for (const j of jobs ?? []) {
        const source = analysisJobToSource(j, lang);
        this.trackReattachSource(bookId, source, this.childParentFor(source, parentJobId));
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
        ? [{ kind: 'summary' as JobKind, jobId: s.activeBuildJobId, scopeLabel: defaultScopeLabel('summary', language), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    const review$ = this.reviewSvc.getReviewStatus(bookId, language).pipe(
      map(s => s.activeBuildJobId
        ? [{ kind: 'review' as JobKind, jobId: s.activeBuildJobId, scopeLabel: defaultScopeLabel('review', language), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    const style$ = this.styleSvc.getStyleBaselineStatus(bookId, language).pipe(
      map(s => s.activeBuildJobId
        ? [{ kind: 'style-baseline' as JobKind, jobId: s.activeBuildJobId, scopeLabel: defaultScopeLabel('style-baseline', language), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    // f2: the whole-book proofread run. Its status carries `activeJobId` (NOT `activeBuildJobId` like the
    // three siblings above), because it is a run over chapters rather than a cached artifact build.
    const bookProofread$ = this.proofreadSvc.getStatus(bookId, language).pipe(
      map(s => s.activeJobId
        ? [{ kind: 'book-proofread' as JobKind, jobId: s.activeJobId, scopeLabel: defaultScopeLabel('book-proofread', language), percent: null as number | null, message: '', analysisType: undefined as string | undefined }]
        : []),
      catchError(() => of([] as ReattachSource[])),
    );
    const analysis$ = this.analysis.getActiveAnalysisJobs(bookId).pipe(
      map(jobs => jobs.map(j => analysisJobToSource(j, language))),
      catchError(() => of([] as ReattachSource[])),
    );

    return forkJoin([summary$, review$, style$, bookProofread$, analysis$]).pipe(
      map(([a, b, c, d, e]) => [...a, ...b, ...c, ...d, ...e]),
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
      // A polling error is terminal for this job: finalize it as failed exactly once. c01: the poll only
      // errors after its transient-error budget ran out, or on a 404. A 404 is the server's answer (the job
      // is unknown or pruned), so it ends the job for good; anything else means the CLIENT lost the job, and
      // `endedBy: 'poll-error'` lets a later `track` of the same id resume it.
      error: (err: unknown) =>
        this.finalize(jobId, 'failed', undefined, undefined, undefined, isJobUnknownError(err) ? 'server' : 'poll-error'),
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
      case 'book-proofread':
        return this.progress.pollBookProofreadProgress(bookId, jobId, stop$);
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
    // f6: a whole-book proofread parent reports a WORD-weighted percent and a server ETA; every other
    // kind keeps the chunk-derived percent and no server ETA, byte for byte.
    if (job.kind === 'book-proofread') {
      const wordPercent = serverWordPercent(p);
      if (wordPercent !== null) norm.percent = wordPercent;
    }
    const serverEtaSeconds = job.kind === 'book-proofread' ? serverEtaOf(p) : undefined;
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
    // c6: a running whole-book proofread is the one parent whose children appear mid-run (see above).
    if (job.kind === 'book-proofread') this.discoverChildJobs(job.bookId, jobId);
    this.patchJob(jobId, {
      ...counts,
      ...(job.kind === 'book-proofread' ? { serverEtaSeconds } : {}),
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
    endedBy: JobEndedBy = 'server',
  ): void {
    const job = this.findJob(jobId);
    if (!job || isTerminal(job.status)) return; // already finalized once - never again

    this.stopPoll(jobId);
    const completedChunks = counts?.completedChunks ?? job.completedChunks;
    const totalChunks = counts?.totalChunks ?? job.totalChunks;
    this.patchJob(jobId, {
      status,
      endedBy,
      // f6: a terminal run has no time remaining; clear the server ETA of a whole-book proofread.
      ...(job.kind === 'book-proofread' ? { serverEtaSeconds: null } : {}),
      percent: status === 'succeeded' ? 100 : (percent ?? job.percent),
      // c04: a SUCCEEDED run reads "10 of 10", for the same reason its percent is forced to 100. The
      // final poll usually says so already, but a terminal reached through the poll's error channel
      // (or a snapshot that lags by one chunk) would otherwise leave a finished card reading "9 of 10"
      // beside its own "Done" pill. A failed/canceled run keeps its real last-known counts: there the
      // shortfall is the truth.
      //
      // c6: EXCEPT a whole-book proofread, whose `completedChunks` is not a lagging chunk count but the
      // run's OUTCOME: chapters actually proofread, so a Succeeded parent with completed < total is a
      // PARTIAL run (a chapter failed and the run went on). Forcing it to total would turn every partial
      // run into a clean one on every surface that reads the registry.
      completedChunks: status === 'succeeded' && job.kind !== 'book-proofread'
        ? (totalChunks ?? completedChunks)
        : completedChunks,
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
   *
   * c03: a whole-book run's CHILDREN (`parentJobId`) are outside the cap. A finished child is retained
   * while its parent is still running (the run's own row stands for it), and dropped once the parent is
   * terminal or gone: the parent's row and the status row carry the run's outcome, and a 30-chapter run
   * used to leave 30 'Proofread' rows that pushed every unrelated completion out of the cap. This runs
   * AFTER `finalize`'s terminal patch has emitted, so a child's own terminal still reaches every
   * subscriber (the analysis panel re-reads history on it) before the child leaves the list.
   */
  private evictOverCap(): void {
    const jobs = this.jobsSubject.value;
    const byId = new Map(jobs.map(j => [j.id, j] as const));
    const dropIds = new Set<string>();
    for (const j of jobs) {
      if (!j.parentJobId || !isTerminal(j.status)) continue;
      const parent = byId.get(j.parentJobId);
      if (!parent || isTerminal(parent.status)) dropIds.add(j.id);
    }

    const completed = jobs.filter(j => isTerminal(j.status) && !j.parentJobId);
    if (completed.length > JobRegistryService.COMPLETED_CAP) {
      [...completed]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(JobRegistryService.COMPLETED_CAP)
        .forEach(j => dropIds.add(j.id));
    }
    if (dropIds.size === 0) return;

    for (const id of dropIds) this.liveTrackedIds.delete(id);
    this.jobsSubject.next(jobs.filter(j => !dropIds.has(j.id)));
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

// c03: the registry's types and pure helpers live in `job-registry.model.ts`. Re-exported here so every
// consumer keeps importing the registry's public surface from this one module, exactly as before the split.
export type {
  AnalysisJobContext,
  JobEndedBy,
  JobKind,
  JobScope,
  JobStatus,
  TerminalStatus,
  TrackMeta,
  TrackedJob,
} from './job-registry.model';
export {
  ALL_JOB_KINDS,
  CHAPTER_SCOPED_KINDS,
  DEFAULT_TITLES,
  clampPercent,
  isTerminal,
  jobMatchesAnalysisContext,
  jobScopeLabel,
  normalizeLang,
  normalizeProgress,
  normalizeStatus,
  progressPercent,
  serverEtaOf,
  serverWordPercent,
  showsChunkCounts,
  topLevelJobs,
} from './job-registry.model';
