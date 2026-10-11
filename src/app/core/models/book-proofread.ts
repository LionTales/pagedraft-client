/**
 * Cross-app contract (whole-book proofread, f2): the DTOs of the book-level proofread run.
 * Fields mirror the backend records in `BookProofreadDtos.cs` EXACTLY (camelCase JSON, as ASP.NET
 * serializes). Do not rename without BE.
 */

/**
 * Response for POST /api/books/{bookId}/proofread?language=&force= - a run was started, or nothing
 * needed running.
 *
 * `started === false` means every chapter with text already has a fresh Active proofread result
 * (`skippedFresh` of them) and no job exists; `jobId` is then still a Guid on the wire but carries no
 * run, so callers MUST branch on `started`, never on `jobId` alone. When another run for the same
 * (book, language) is already in flight the API answers with THAT run's id and `started === true`
 * (the loser-gets-the-active-id rule the summary/review builds already follow).
 */
export interface StartBookProofreadResponse {
  jobId: string;
  started: boolean;
  /** Chapters skipped because their Active proofread result is newer than the chapter's last edit. */
  skippedFresh: number;
  /** Chapters this run will proofread. */
  plannedChapters: number;
  /** Estimated text chunks across the planned chapters (drives the ETA). */
  estimatedChunks: number;
  /** Estimated wall-clock seconds for the whole run. */
  estimatedSeconds: number;
}

/**
 * Response for GET /api/books/{bookId}/proofread/status?language= - coverage and freshness of the
 * book's chapter proofread results, plus the in-flight run (if any).
 */
export interface BookProofreadStatusDto {
  /** Job id of the in-flight whole-book run for this (book, language); null when none. */
  activeJobId: string | null;
  /** Chapters that have text (the run's candidate set). */
  chaptersWithText: number;
  /** Chapters holding an Active proofread result. */
  chaptersWithActiveProofread: number;
  /** Chapters whose Active proofread result is OLDER than the chapter's last edit. */
  chaptersStale: number;
  /** ISO timestamp of the newest Active proofread result; null when the book was never proofread. */
  lastRunAt: string | null;
}
