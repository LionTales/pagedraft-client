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
 *
 * be-c05: per chapter the server reports EXACTLY ONE of covered and fresh, edited ({@link chaptersEdited}),
 * unreliable ({@link chaptersUnreliable}) or not proofread (some exported unit has no result in the status
 * language), each read through the one unit rule the annotated export also uses. Not proofread is
 * `chaptersWithText - chaptersWithActiveProofread - chaptersUnreliable`.
 */
export interface BookProofreadStatusDto {
  /** Job id of the in-flight whole-book run for this (book, language); null when none. */
  activeJobId: string | null;
  /** Chapters that have text (the run's candidate set). */
  chaptersWithText: number;
  /**
   * Chapters COVERED: every exported unit has a RELIABLE result in the status language (fresh or edited
   * since). An unreliable chapter is never covered. (Before be-c05: any Active result, unreliable included.)
   */
  chaptersWithActiveProofread: number;
  /**
   * KEPT for older clients: {@link chaptersEdited} + {@link chaptersUnreliable} (disjoint). An older API sent
   * it alone, meaning edited and unreliable mixed; read it only when the split is absent.
   */
  chaptersStale: number;
  /**
   * be-c05: covered chapters with at least one unit edited after its result (a subset of the covered count).
   * Optional: an older API does not send it, and the row then falls back to {@link chaptersStale}.
   */
  chaptersEdited?: number;
  /**
   * be-c05: chapters with at least one unit whose current result is flagged unreliable; never covered;
   * equals `unreliableChapters.length`. Optional for an older API, like {@link chaptersEdited}.
   */
  chaptersUnreliable?: number;
  /** ISO timestamp of the newest result of a COVERED chapter's units; null when nothing is covered. */
  lastRunAt: string | null;
  /**
   * c7/c8: what `POST .../proofread?force=false` would plan RIGHT NOW (the server's one planning method feeds
   * both the start and this status, so the consent cannot disagree with the run it starts). 0 = nothing.
   */
  plannedChapters: number;
  estimatedChunks: number;
  /** Whole-run estimate in seconds for the non-forced plan; 0 when nothing would run. */
  estimatedSeconds: number;
  /** The same trio for `force=true` (the "run again" path). */
  forcePlannedChapters: number;
  forceEstimatedChunks: number;
  forceEstimatedSeconds: number;
  /**
   * Chapters, in reading order, one of whose exported units' current proofread result (in the status
   * language) the system flagged unreliable: the {@link chaptersUnreliable} chapters. The export page asks the
   * author whether to include or skip them, and `?unreliable=skip` skips exactly these.
   */
  unreliableChapters: BookProofreadUnreliableChapter[];
  /**
   * c20: chapters, in reading order, whose LATEST whole-book attempt failed or came back unreliable and that no
   * reliable proofread has covered since. A chapter whose attempt THREW keeps its previous result, which still
   * counts as fresh when it is reliable and newer than the last edit, so the normal plan skips it; an unreliable
   * result archived the previous one (its pending suggestions superseded) and is never fresh, so the normal plan
   * re-plans that chapter too. `POST .../proofread?onlyFailed=true` plans exactly these. The server keeps this
   * record IN MEMORY, so it is empty after an API restart. Optional: an older API does not send it.
   */
  failedChapters?: BookProofreadFailedChapter[];
  /** The `onlyFailed` plan's estimate, from the same server planning method. 0 when nothing failed. */
  failedEstimatedChunks?: number;
  failedEstimatedSeconds?: number;
}

/**
 * c20: a chapter whose latest whole-book proofread attempt failed. `order` is the STORED 0-based
 * `Chapter.Order`; render it only through `chapterDisplayNumber`, never directly.
 */
export interface BookProofreadFailedChapter {
  chapterId: string;
  title: string;
  order: number;
}

/**
 * A chapter whose Active proofread result was flagged unreliable. `order` is the STORED 0-based
 * `Chapter.Order`; render it only through `chapterDisplayNumber`, never directly.
 */
export interface BookProofreadUnreliableChapter {
  chapterId: string;
  title: string;
  order: number;
}
