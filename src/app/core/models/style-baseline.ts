/**
 * Cross-app contract (a3/a4): the style-baseline status read and build response.
 * Fields mirror the backend DTOs EXACTLY (camelCase JSON). Do not rename without the BE.
 *
 * Status state machine (derived from these fields):
 *   NOT BUILT = !hasBaseline && builtChapters === 0
 *   BUILDING  = a build job is in flight (client-tracked: we started one / progress not complete)
 *   READY     = ready === true (hasBaseline && staleCount === 0)
 *   STALE     = hasBaseline && staleCount > 0
 */
export interface BookStyleBaselineStatusDto {
  bookId: string;
  language: string;
  totalChapters: number;
  builtChapters: number;
  staleCount: number;
  hasBaseline: boolean;
  /** True when the baseline is complete and fresh (hasBaseline && staleCount === 0). */
  ready: boolean;
  /** UTC ISO timestamp of the last baseline update, or null if never built. */
  lastUpdatedAt: string | null;
  /** Model the baseline was built with (empty/absent until first build). */
  builtWithModel: string | null;
  /** Currently-active LinguisticAnalysis model id (for display); null when unknown. */
  activeModel: string | null;
  /**
   * True when a baseline exists but was built with a DIFFERENT model than the currently-active one
   * (cross-model staleness). When true, staleCount already includes the affected chapters, but the
   * REASON is a model change rather than chapter edits - surface a distinct "refresh" warning.
   */
  builtWithDifferentModel: boolean;
  /**
   * If a build is currently running (possibly started in another tab/session), the jobId to attach to
   * for live progress. Null when no build is running.
   */
  activeBuildJobId: string | null;
  /** Number of chapters a build would (re)process now. */
  chaptersToBuild: number;
  /** Rough wall-clock estimate for the pending build, in seconds. */
  estimatedSeconds: number;
  /** Estimated cost in USD; null for free/local providers, a decimal for paid providers. */
  estimatedUsd: number | null;
}

/** POST .../style-baseline/build response. jobId is null when the build is a no-op (already fresh). */
export interface StartStyleBaselineBuildResponse {
  /** Build job id to poll for progress; null when noOp (already fresh, nothing to build). */
  jobId: string | null;
  language: string;
  noOp: boolean;
  ready: boolean;
  builtChapters: number;
  totalChapters: number;
  staleCount: number;
}
