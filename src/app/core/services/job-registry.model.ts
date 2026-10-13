import { AnalysisProgressDto, ANALYSIS_TYPE_LABELS } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';
import { ChunkClock } from '../utils/chunk-eta';
import { runChromeLang } from '../i18n/run-strings';

/**
 * c03 (whole-book proofread fixes): the job registry's TYPES and PURE helpers, split out of
 * `job-registry.service.ts` (which had grown past 1,000 lines) with no behaviour change. Nothing here
 * injects or holds state; the service owns every observable and every poll. Consumers keep importing
 * from `job-registry.service`, which re-exports the public names below; the non-public helpers
 * (`pickMeta`, `analysisJobToSource`, ...) are exported only for the service's own use.
 */

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
export type JobKind = 'summary' | 'review' | 'proofread' | 'style-baseline' | 'book-proofread';
// f2 (whole-book proofread): `book-proofread` is the PARENT job of a run over every chapter with text. It is
// book-level (no chapterId, not in CHAPTER_SCOPED_KINDS): the per-chapter work it fans out shows up as
// ordinary chapter `proofread` child jobs, which is how the existing per-chapter running badges light.

/**
 * The JobKinds that count as a whole-book BUILD for the editor's "review running" affordance: the book
 * summary rollup and the developmental review. Single source of truth for {@link
 * JobRegistryService.anyRunningForBook$}. Chapter `proofread` runs and `style-baseline` builds are
 * tracked for the Activity Center but are NOT a summary/review build, so they are deliberately excluded
 * here.
 */
export const WHOLE_BOOK_BUILD_KINDS: ReadonlySet<JobKind> = new Set<JobKind>(['summary', 'review']);

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
 * | `book-proofread`  | `BookProofreadService` (`SetTotalChunks(plannedChapters)`)  | PLANNED CHAPTERS of the run                       |
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
  'book-proofread',
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

/**
 * c01: who ended a terminal job. `'server'` = the server answered it (a terminal snapshot, or a 404 for a
 * job it does not know); `'poll-error'` = the client stopped hearing from the server (the poll's
 * transient-error budget ran out), so the server may still be running it and a re-track resumes it.
 */
export type JobEndedBy = 'server' | 'poll-error';

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
  /**
   * c01: set on a TERMINAL job only ({@link JobEndedBy}); undefined while running. Surfaces that word a
   * terminal (the whole-book proofread row) read it to tell "the run failed" from "this client lost the
   * run", and `track` resumes a `'poll-error'` job instead of treating its terminal as forever.
   */
  endedBy?: JobEndedBy;
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
   * f6: the SERVER's time-remaining for a whole-book proofread parent (AnalysisProgressDto
   * `estimatedRemainingSeconds`, word-weighted), or null/undefined for every other kind, before the
   * first poll, after a terminal, and against an older API that does not send it. When non-null it
   * outranks {@link chunkClock}: the chapter-count clock multiplies one giant chapter by the chapters
   * left. 0 means "nothing left to say", which surfaces render as no line.
   */
  serverEtaSeconds?: number | null;
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
  /**
   * c03: the whole-book proofread run (`book-proofread` parent job id) this chapter/scene job is one unit
   * of; undefined for every other job. Set by child discovery (and by `reattach` when the same read also
   * reports a running parent) on a Proofread job THIS client did not start, and cleared if this client
   * tracks the job as its own live run. The unscoped readers (Activity Center, dock badge) fold a child
   * into its parent through {@link topLevelJobs}, and the retention cap does not count it (see
   * `evictOverCap`); every chapter-scoped reader still sees it as an ordinary `proofread` job.
   */
  parentJobId?: string;
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
  /** c03: see {@link TrackedJob.parentJobId}. */
  parentJobId?: string;
  /**
   * c03: the BOOK's language. Not a TrackedJob field: the registry remembers it per book and uses it only
   * to word the DEFAULT scope label of a job it creates without one (a reattached or discovered job), so
   * an English book's jobs read "Chapter" / "Whole book" like the live path's, not 'פרק'.
   */
  language?: string;
  /**
   * c04: this job was discovered by the REATTACH seam rather than started by this client, so it has no
   * trustworthy client-side start time and its throughput clock opens at the first observed poll
   * instead. Set by `reattach` / child discovery, and by a status row that found the run already in
   * flight. It is not a TrackedJob field (`pickMeta` does not carry it): it describes how the job was
   * learned about, and it is consumed once, when the clock is created.
   *
   * c03: it also marks the metadata as the BACKEND's defaults rather than a live caller's, so a re-track
   * carrying it never overwrites the `scopeLabel` of a job that is already tracked: the live label (worded
   * in the run's language) outranks the default the discovery source computes every parent tick.
   */
  reattached?: boolean;
}

/** The chunk-count fields one progress observation contributes. Kept together so `finalize` and the
 * running patch cannot apply a different subset of them. */
export interface ChunkCountPatch {
  completedChunks: number | null;
  totalChunks: number | null;
  chunkClock: ChunkClock;
}

/** Normalized in-flight job discovered by the reattach seam. */
export interface ReattachSource {
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

/**
 * f6: the whole-book proofread parent's WORD-weighted percent, or null when the server sent none worth
 * showing. Only a strictly positive value counts: 0 is both "just started" and the older API's shape,
 * and either way the chapter-derived percent is the better readout. Exported for the spec.
 */
export function serverWordPercent(p: AnalysisProgressDto): number | null {
  const est = p?.estimatedCompletionPercent;
  return typeof est === 'number' && Number.isFinite(est) && est > 0 ? clampPercent(est) : null;
}

/**
 * f6: the server's time remaining in seconds, or null when the DTO carries none (absent on an older
 * API, null on a non-parent, negative or non-finite). 0 is kept: it is a real "nothing left". Exported
 * for the spec.
 */
export function serverEtaOf(p: AnalysisProgressDto): number | null {
  const s = p?.estimatedRemainingSeconds;
  return typeof s === 'number' && Number.isFinite(s) && s >= 0 ? s : null;
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

/**
 * Map an rf-b01 active-analysis-job DTO to a normalized reattach source. c03: `language` is the BOOK's
 * (the reattach argument, or the one the registry remembers for child discovery); absent = Hebrew.
 */
export function analysisJobToSource(j: ActiveAnalysisJobDto, language?: string | null): ReattachSource {
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
    // non-scene job keeps the proofread default.
    // c03: worded in the book's language through the SAME table the live path reads ({@link jobScopeLabel}),
    // and `track` no longer merges it over an already-tracked job's label at all (see TrackMeta.reattached).
    scopeLabel: jobScopeLabel(j.sceneId ? 'scene' : 'chapter', language),
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

export function pickMeta(meta: TrackMeta): Partial<TrackedJob> {
  const out: Partial<TrackedJob> = {};
  if (meta.scopeLabel !== undefined) out.scopeLabel = meta.scopeLabel;
  if (meta.titleHe !== undefined) out.titleHe = meta.titleHe;
  if (meta.titleEn !== undefined) out.titleEn = meta.titleEn;
  if (meta.message !== undefined) out.message = meta.message;
  if (meta.resultRoute !== undefined) out.resultRoute = meta.resultRoute;
  if (meta.analysisType !== undefined) out.analysisType = meta.analysisType;
  if (meta.chapterId !== undefined) out.chapterId = meta.chapterId;
  if (meta.sceneId !== undefined) out.sceneId = meta.sceneId;
  if (meta.parentJobId !== undefined) out.parentJobId = meta.parentJobId;
  return out;
}

/**
 * c03: a whole-book run's CHILD folded into its parent's row, for the two unscoped readers (the Activity
 * Center list and the dock's live count), which otherwise showed one 'Proofread' row per chapter beside
 * the run's own row and counted one run as two.
 *
 * Folded = it names a parent that is in `jobs`, UNLESS the child is still running after that parent
 * ended (a poll lag of a few seconds, or a lost parent): then the child is the only live trace of the run
 * and stays visible. A child whose parent is not in the list is a top-level job. So, over the ACTIVE list
 * (the dock), a run counts once; over every tracked job (the Activity Center), a run is one row.
 *
 * Chapter-scoped readers (stage 4 and the editor's running chapters, the analysis panel) must NOT call
 * this: they key on the child, which is how a chapter's own running badge lights during the run.
 */
export function topLevelJobs(jobs: readonly TrackedJob[]): TrackedJob[] {
  const byId = new Map(jobs.map(j => [j.id, j] as const));
  return jobs.filter(j => {
    const parent = j.parentJobId ? byId.get(j.parentJobId) : undefined;
    if (!parent) return true;
    return isTerminal(parent.status) && !isTerminal(j.status);
  });
}

export function nowIso(): string {
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
  // f2: the whole-book proofread run (parent job; the chapters it works through are plain `proofread` jobs).
  // DRAFT he - needs native review
  'book-proofread': { he: 'הגהת ספר שלם', en: 'Whole-book proofread' },
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
export function titleForJob(kind: JobKind, analysisType: string | undefined): { he: string; en: string } {
  if (kind === 'proofread' && analysisType) {
    const he = ANALYSIS_TYPE_LABELS.he[analysisType];
    const en = ANALYSIS_TYPE_LABELS.en[analysisType];
    if (he && en) return { he, en };
  }
  return DEFAULT_TITLES[kind];
}

/** c03: what a job covers, as its scope label words it. */
export type JobScope = 'book' | 'chapter' | 'scene';

/**
 * c03: the scope label words, ONE table for the live path (`AnalysisRunOrchestrationService`) and the
 * registry's defaults (reattach, child discovery). The two used to be separate literals and only the live
 * one was language-aware, so an English book's discovered children read 'פרק'.
 */
const SCOPE_LABELS: Record<'he' | 'en', Record<JobScope, string>> = {
  he: {
    book: 'הספר כולו', // DRAFT he - needs native review
    chapter: 'פרק', // DRAFT he - needs native review
    scene: 'סצנה', // DRAFT he - needs native review
  },
  en: { book: 'Whole book', chapter: 'Chapter', scene: 'Scene' },
};

/**
 * c03: the scope label for a job over `scope`, in the BOOK's language. The language rule is the run
 * chrome's ({@link runChromeLang}: an `en*` book reads English, anything else, absent included, Hebrew),
 * so a live-tracked job and the same job re-discovered can never word their scope differently.
 */
export function jobScopeLabel(scope: JobScope, language?: string | null): string {
  return SCOPE_LABELS[runChromeLang(language)][scope];
}

/** Default scope label per kind, in the book's language (absent = Hebrew, as before c03). */
export function defaultScopeLabel(kind: JobKind, language?: string | null): string {
  switch (kind) {
    case 'summary':
    case 'review':
    case 'style-baseline':
    case 'book-proofread':
      return jobScopeLabel('book', language);
    case 'proofread':
      return jobScopeLabel('chapter', language);
  }
}
