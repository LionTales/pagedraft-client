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
 * d1: CLIENT-ONLY, NOT A WIRE DTO. A ChapterAnchor carrying the best-effort intra-chapter
 * navigation hints the findings ledger can supply when the reader clicks an anchor chip.
 *
 * It EXTENDS ChapterAnchor deliberately, so every surface that still emits a bare anchor (the
 * Story Bible, the stage spine, the dashboard's own chapter chips) stays assignable and needs no
 * change. Both extra fields are optional and everything downstream treats them as hints: a missing,
 * stale or unmatched excerpt silently lands the reader at the top of the chapter, which is the
 * behavior that shipped before this type existed and therefore cannot regress.
 */
export interface FindingNavigationTarget extends ChapterAnchor {
  /** The finding's own evidence excerpt for THIS chapter, when it carries one. */
  excerpt?: string;
  /** The finding whose anchor was clicked, so the host can keep the ledger row in sync. */
  findingId?: string;
}

/**
 * A single persisted whole-book finding as returned by GET .../review/findings.
 * Mirrors BookFindingDto (camelCase): id, dimension, verdict, severity, rationale,
 * evidence, chapterAnchors, suggestedAction, status, createdAt, updatedAt.
 * Note: bookId and language are on the container BookReviewFindingsDto, not per-finding.
 * Carries no builtWithModel: which model produced a finding is internal IP and stays server-side.
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
 * lastUpdatedAt, builtWithDifferentModel, staleVsBriefs,
 * hasBriefs, activeBuildJobId, ready, chaptersReviewed, chaptersTotal, windowCount,
 * ranSynthesis, ranContinuityReduce, failedWindows.
 *
 * Status state machine (derived from these fields):
 *   NOT BUILT      = !hasReview
 *   BRIEFS MISSING = !hasBriefs
 *   BUILDING       = activeBuildJobId is non-null (in-flight job; attach for progress)
 *   READY          = ready === true (hasBriefs && hasReview && !builtWithDifferentModel && !staleVsBriefs)
 *   STALE          = hasReview && (staleVsBriefs || builtWithDifferentModel)
 *
 * Coverage-provenance fields (wb4-c06):
 *   chaptersReviewed / chaptersTotal are PERSISTED (reliably reported by the status probe).
 *   windowCount / ranSynthesis / ranContinuityReduce / failedWindows are NOT persisted — they
 *   reflect the build-time shape and this status DTO ALWAYS reports them as 0/false. The LIVE build-shape
 *   (window detail + partial-window warning) is delivered instead on the REVIEW PROGRESS terminal payload
 *   (AnalysisProgressDto.bookReviewWindowCount / ...RanContinuityReduce / ...FailedWindows) and captured by
 *   the status row at the build terminal, so it survives the post-build status refresh that zeroes these.
 *   Render them ONLY when > 0 / true, never show "0 windows".
 */
export interface BookReviewStatusDto {
  bookId: string;
  language: string;
  /** True when at least one BookFinding row exists for (bookId, language). */
  hasReview: boolean;
  /** Total persisted findings for (bookId, language). */
  findingCount: number;
  /**
   * Wave 3 / w1 (work item M3). Findings still at status `open`.
   *
   * NOT derivable from `findingCount - resolvedFindingCount`: `acknowledged` is a THIRD bucket counted by
   * neither field. Both counts follow the same `FindingStatusPartition` the findings ledger renders, so the
   * spine and the ledger cannot disagree one click apart. Render only what these fields say.
   */
  openFindingCount: number;
  /** Wave 3 / w1 (M3). Findings at status `dismissed` or `done`, i.e. worked through. */
  resolvedFindingCount: number;
  /** UTC ISO timestamp of the last review build, or null if never built. */
  lastUpdatedAt: string | null;
  /**
   * True when a review exists but was built with a DIFFERENT model than the currently-active one.
   * Surface a distinct "refresh" warning.
   *
   * The only cross-model signal on the wire; the two model names it replaced are internal IP and stay
   * server-side. See BookStyleBaselineStatusDto for the full note.
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
  // ── Coverage-provenance fields (wb4-c06) ────────────────────────────────────
  /**
   * Number of chapters included in the review (persisted; reliably reported by status probe).
   * Render as "Reviewed N/chaptersTotal chapters" in the READY state.
   */
  chaptersReviewed: number;
  /**
   * Total chapters in the book at review-build time (persisted; reliably reported by status probe).
   */
  chaptersTotal: number;
  /**
   * Number of multi-chapter windows used during a windowed review build.
   * NOT persisted — the status probe reports 0; only > 0 when returned from the live build-completion
   * payload. Render ONLY when > 0; NEVER show "0 windows".
   */
  windowCount: number;
  /**
   * True when the build ran a synthesis pass over all window outputs.
   * NOT persisted — the status probe reports false; only reliable at build time.
   * Show the continuity-pass detail ONLY when ranContinuityReduce === true.
   */
  ranSynthesis: boolean;
  /**
   * True when the build ran a continuity-reduce pass over windowed findings.
   * NOT persisted — the status probe reports false; only reliable at build time.
   * Show the continuity-pass detail ONLY when this is true.
   */
  ranContinuityReduce: boolean;
  /**
   * Number of windows that failed during a windowed build.
   * NOT persisted — the status probe reports 0; render the PARTIAL warning ONLY when > 0.
   */
  failedWindows: number;
}

/**
 * Response for POST .../review — async build started (or no-op / briefs-missing).
 * Mirrors StartBookReviewBuildResponse (camelCase): jobId, language, noOp, ready,
 * briefsMissing, findingCount, message, chaptersReviewed, chaptersTotal, windowCount,
 * ranSynthesis, ranContinuityReduce, failedWindows.
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
  // ── Coverage-provenance fields (wb4-c06, defensive mirror) ──────────────────
  /** Chapters included in the review; see BookReviewStatusDto for field semantics. */
  chaptersReviewed?: number;
  /** Total chapters in the book at build time; see BookReviewStatusDto. */
  chaptersTotal?: number;
  /** Window count; NOT persisted — only reliable in this build-start response. See BookReviewStatusDto. */
  windowCount?: number;
  /** Whether a synthesis pass ran; NOT persisted. See BookReviewStatusDto. */
  ranSynthesis?: boolean;
  /** Whether a continuity-reduce pass ran; NOT persisted. See BookReviewStatusDto. */
  ranContinuityReduce?: boolean;
  /** Windows that failed; NOT persisted. See BookReviewStatusDto. */
  failedWindows?: number;
}
