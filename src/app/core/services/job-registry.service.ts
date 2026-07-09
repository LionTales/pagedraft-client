import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

import { AnalysisProgressDto, ANALYSIS_TYPE_LABELS } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';
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
      message: meta.message ?? '',
      startedAt,
      updatedAt: startedAt,
      chapterId: meta.chapterId,
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
   * runs, `style-baseline` builds, and the reserved `whole-book-analysis` kind are also published to
   * the registry (for the Activity Center), but they are not a summary/review build and must not light
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
      case 'proofread':
      case 'whole-book-analysis': {
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
    if (isTerminal(norm.status)) {
      this.finalize(jobId, norm.status, norm.percent, norm.message);
      return;
    }
    this.patchJob(jobId, {
      status: norm.status,
      percent: norm.percent ?? job.percent,
      message: norm.message || job.message,
      updatedAt: nowIso(),
    });
  }

  /**
   * Finalize a job to a terminal state EXACTLY ONCE. Idempotent: a second call for an already-terminal
   * job is a no-op (this is the single-finalize guarantee that replaces the per-component
   * `*HandledTerminalJobId` guards). Stops the poll and enforces the completed-cap.
   */
  private finalize(jobId: string, status: TerminalStatus, percent?: number | null, message?: string): void {
    const job = this.findJob(jobId);
    if (!job || isTerminal(job.status)) return; // already finalized once - never again

    this.stopPoll(jobId);
    this.patchJob(jobId, {
      status,
      percent: status === 'succeeded' ? 100 : (percent ?? job.percent),
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
 * `whole-book-analysis` is RESERVED for Phase 2 and is type-PARAMETERIZED via `analysisType` (it is
 * NOT proofread-specific); it shares the chapter/analysis progress shape.
 */
export type JobKind = 'summary' | 'review' | 'proofread' | 'style-baseline' | 'whole-book-analysis';

/**
 * The JobKinds that count as a whole-book BUILD for the editor's "review running" affordance: the book
 * summary rollup and the developmental review. Single source of truth for {@link
 * JobRegistryService.anyRunningForBook$}. Chapter `proofread` runs, `style-baseline` builds, and the
 * reserved `whole-book-analysis` kind are tracked for the Activity Center but are NOT a summary/review
 * build, so they are deliberately excluded here.
 */
const WHOLE_BOOK_BUILD_KINDS: ReadonlySet<JobKind> = new Set<JobKind>(['summary', 'review']);

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
  message: string;
  startedAt: string;
  updatedAt: string;
  /** Chapter this job belongs to (chapter analysis kinds); undefined for book-level builds. */
  chapterId?: string;
  /** Where "view" navigates when done. Best-effort; the Activity Center (rf-f01) consumes it. */
  resultRoute?: string;
  /** Phase-2 whole-book-analysis type parameter (e.g. 'Proofread'); undefined for the built-in kinds. */
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
  resultRoute?: string;
  analysisType?: string;
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
}

// ── Pure helpers (exported where the spec needs them) ─────────────────────────────────────────────

/**
 * Normalize EITHER progress DTO shape into { status, percent, message }.
 *   - book-level pollers carry `estimatedCompletionPercent` (0-100; may be absent/negative -> null).
 *   - analysis poller carries `completedChunks`/`totalChunks` -> round(100*completed/total).
 * Percent is clamped 0-100 and is null (indeterminate) when neither shape yields a usable number.
 */
export function normalizeProgress(p: AnalysisProgressDto): { status: JobStatus; percent: number | null; message: string } {
  const status = normalizeStatus(p?.status);
  const percent = status === 'succeeded' ? 100 : progressPercent(p);
  return { status, percent, message: p?.message ?? '' };
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
    // async path, distinguished by `analysisType`. Phase 2's `whole-book-analysis` is book-scoped and
    // does not arrive here.
    kind: 'proofread',
    jobId: j.jobId,
    scopeLabel: defaultScopeLabel('proofread'),
    // Unlike the poll DTO, the rf-b01 active-analysis-job carries a NON-NEGATIVE int with no "unknown"
    // sentinel: its own doc says 0 can mean "not yet chunked", i.e. progress is not yet known - NOT
    // genuinely 0% done. So treat only a strictly-positive value as a determinate percent and map 0 to
    // null (indeterminate), matching how progressPercent renders an unknown percent. The job shows the
    // indeterminate bar until the first poll after reattach reports a real percent.
    percent: j.estimatedCompletionPercent > 0 ? clampPercent(j.estimatedCompletionPercent) : null,
    message: j.message ?? '',
    analysisType: j.analysisType,
    chapterId: j.chapterId ?? undefined,
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
const DEFAULT_TITLES: Record<JobKind, { he: string; en: string }> = {
  'summary': { he: 'בניית סיכום הספר', en: 'Building book summary' },
  'review': { he: 'סקירת הספר', en: 'Reviewing book' },
  'proofread': { he: 'הגהה', en: 'Proofreading' },
  'style-baseline': { he: 'בניית קו סגנון', en: 'Building style baseline' },
  'whole-book-analysis': { he: 'ניתוח הספר כולו', en: 'Analyzing whole book' },
};

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
    case 'whole-book-analysis':
      return 'הספר כולו'; // "Whole book"
    case 'proofread':
      return 'פרק'; // "Chapter"
  }
}
