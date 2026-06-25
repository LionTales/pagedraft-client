/**
 * Cross-app contract (wb2-f02): the whole-book review DTOs.
 * Fields mirror the backend record types in AnalysisJobDtos.cs EXACTLY (camelCase JSON).
 * Do not rename without BE.
 *
 * Dimension values:  plot | character | pacing | tone | theme | continuity
 * Verdict values:    keep | improve | cut
 * Severity values:   1 (minor) | 2 (moderate) | 3 (major)
 * FindingStatus:     open | acknowledged | dismissed | done
 * DimensionScore:    weak | mixed | strong
 */

/** Editorial dimensions the review fans out over. */
export type Dimension = 'plot' | 'character' | 'pacing' | 'tone' | 'theme' | 'continuity';

/** Overall verdict for a finding. */
export type Verdict = 'keep' | 'improve' | 'cut';

/** Severity level 1-3. */
export type Severity = 1 | 2 | 3;

/** Workflow status of a finding (user-settable). */
export type FindingStatus = 'open' | 'acknowledged' | 'dismissed' | 'done';

/** Holistic quality label per dimension. */
export type DimensionScoreLabel = 'weak' | 'mixed' | 'strong';

/**
 * One piece of textual evidence supporting a finding.
 * Mirrors FindingEvidenceDto (camelCase): chapterId, chapterOrder, excerpt.
 */
export interface FindingEvidence {
  chapterId: string | null;
  chapterOrder: number;
  excerpt: string;
}

/**
 * Chapter reference used to anchor a finding for navigation.
 * Mirrors FindingChapterAnchorDto (camelCase): chapterId, order, title.
 */
export interface ChapterAnchor {
  chapterId: string;
  order: number;
  title: string;
}

/**
 * A single persisted whole-book finding as returned by GET .../review/findings.
 * Mirrors BookFindingDto (camelCase): id, dimension, verdict, severity, rationale,
 * evidence, chapterAnchors, suggestedAction, status, builtWithModel, createdAt, updatedAt.
 * Note: bookId and language are on the container BookReviewFindingsDto, not per-finding.
 */
export interface BookFinding {
  id: string;
  dimension: Dimension;
  verdict: Verdict;
  severity: Severity;
  rationale: string;
  evidence: FindingEvidence[];
  chapterAnchors: ChapterAnchor[];
  suggestedAction: string | null;
  status: FindingStatus;
  builtWithModel: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-dimension rollup score for the FE.
 * Mirrors BookReviewDimensionScoreDto (camelCase): dimension, score, keepCount, improveCount, cutCount.
 */
export interface DimensionScore {
  dimension: Dimension;
  score: DimensionScoreLabel;
  keepCount: number;
  improveCount: number;
  cutCount: number;
}

/**
 * Response for GET .../review/findings — findings + per-dimension rollup scores.
 * Mirrors BookReviewFindingsDto (camelCase): bookId, language, findings, scores.
 */
export interface BookReviewFindingsDto {
  bookId: string;
  language: string;
  findings: BookFinding[];
  scores: DimensionScore[];
}

/**
 * Response for GET .../review/status — coverage + freshness of the cached whole-book review.
 * Mirrors BookReviewStatusDto (camelCase): bookId, language, hasReview, findingCount,
 * lastUpdatedAt, builtWithModel, activeModel, builtWithDifferentModel, staleVsBriefs,
 * hasBriefs, activeBuildJobId, ready.
 *
 * Status state machine (derived from these fields):
 *   NOT BUILT      = !hasReview
 *   BRIEFS MISSING = !hasBriefs
 *   BUILDING       = activeBuildJobId is non-null (in-flight job; attach for progress)
 *   READY          = ready === true (hasBriefs && hasReview && !builtWithDifferentModel && !staleVsBriefs)
 *   STALE          = hasReview && (staleVsBriefs || builtWithDifferentModel)
 */
export interface BookReviewStatusDto {
  bookId: string;
  language: string;
  /** True when at least one BookFinding row exists for (bookId, language). */
  hasReview: boolean;
  /** Total persisted findings for (bookId, language). */
  findingCount: number;
  /** UTC ISO timestamp of the last review build, or null if never built. */
  lastUpdatedAt: string | null;
  /** Model the review was built with; null when no review exists. */
  builtWithModel: string | null;
  /** Currently-active BookReview model id; null when unknown. */
  activeModel: string | null;
  /**
   * True when a review exists but was built with a DIFFERENT model than the currently-active one.
   * Surface a distinct "refresh" warning.
   */
  builtWithDifferentModel: boolean;
  /**
   * True when the review is STALE vs the briefs: the book summary was (re)built more recently
   * than the newest finding, so the review reflects an older view of the book.
   */
  staleVsBriefs: boolean;
  /**
   * True when the book has usable structured briefs to review at all (BookBrief or ChapterBriefs).
   * When false, prompt the user to build the book summary first.
   */
  hasBriefs: boolean;
  /**
   * JobId of an in-progress review build for (bookId, language); null when none.
   * Attach to this job for live progress rather than starting a new build.
   */
  activeBuildJobId: string | null;
  /**
   * True when the review is complete and fresh AND rebuildable: hasBriefs && hasReview &&
   * !builtWithDifferentModel && !staleVsBriefs. Requires hasBriefs so `ready` is never true while the briefs
   * are gone/degraded (a state where a build would report BriefsMissing rather than no-op).
   */
  ready: boolean;
}

/**
 * Response for POST .../review — async build started (or no-op / briefs-missing).
 * Mirrors StartBookReviewBuildResponse (camelCase): jobId, language, noOp, ready,
 * briefsMissing, findingCount, message.
 */
export interface StartBookReviewBuildResponse {
  /** Build job id to poll for progress; null when noOp or briefsMissing (no build started). */
  jobId: string | null;
  language: string;
  /** True when nothing needed (re)building — the review was already fresh. */
  noOp: boolean;
  /** True when the build (or no-op) ended with a usable cached review. */
  ready: boolean;
  /**
   * True when the build could NOT run because the book has no usable structured briefs yet.
   * NO model calls were spent; prompt the user to build the book summary first.
   */
  briefsMissing: boolean;
  /** Current persisted finding count for (bookId, language). */
  findingCount: number;
  message: string;
}
