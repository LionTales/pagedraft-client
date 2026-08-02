/**
 * Cross-app contract (wb1-f01): the book-summary status read and build response.
 * Fields mirror the backend BookSummaryStatusDto EXACTLY (camelCase JSON). Do not rename without BE.
 *
 * Status state machine (derived from these fields):
 *   NOT BUILT = !hasSummary && builtChapters === 0
 *   BUILDING  = a build job is in flight (client-tracked: we started one / progress not complete)
 *   READY     = ready === true (hasSummary && staleCount === 0)
 *   STALE     = hasSummary && staleCount > 0
 */
export interface BookSummaryStatusDto {
  bookId: string;
  language: string;
  totalChapters: number;
  builtChapters: number;
  staleCount: number;
  hasSummary: boolean;
  /** True when the summary is complete and fresh (hasSummary && staleCount === 0). */
  ready: boolean;
  /** UTC ISO timestamp of the last summary update, or null if never built. */
  lastUpdatedAt: string | null;
  /**
   * True when a summary exists but was built with a DIFFERENT model than the currently-active one
   * (cross-model staleness). Surface a distinct "refresh" warning.
   *
   * The only cross-model signal on the wire; the two model names it replaced are internal IP and stay
   * server-side. See BookStyleBaselineStatusDto for the full note.
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

/** POST .../summary/build response. jobId is null when the build is a no-op (already fresh). */
export interface StartBookSummaryBuildResponse {
  /** Build job id to poll for progress; null when noOp (already fresh, nothing to build). */
  jobId: string | null;
  language: string;
  noOp: boolean;
  ready: boolean;
  builtChapters: number;
  totalChapters: number;
  staleCount: number;
}
