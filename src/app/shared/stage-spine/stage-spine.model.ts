import { BookReviewStatusDto } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';

/**
 * Wave 3 / w2 - the RECONCILED five-stage model, and the pure derivation from real signals to stage
 * state. This file holds no DOM and no services so the derivation can be asserted directly, seeded
 * signal by seeded signal, without a TestBed.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: nothing is presented as done unless the app computed it.
 * The component it replaced (FunnelStepperComponent) hardcoded `Structure` to `done` and shipped a
 * permanently grey `Polish` step that no endpoint could ever back. Both are gone. Every state below is
 * a function of a payload field, and where the app genuinely cannot know something it says so
 * (`unknown`) or declines to make a book-level claim at all (stage 4, see {@link StageStatus.perChapter})
 * rather than inventing a token.
 *
 * Canonical order: Import -> Book briefs -> Developmental review -> Chapter editing passes -> Export.
 * The field-by-field contract is PAGEDRAFT_DESIGN.md section "Stage spine signals (Wave 3)".
 */

/** The five stages, as stable ids. */
export type SpineStageId = 'import' | 'briefs' | 'review' | 'chapter-passes' | 'export';

/** Canonical order. The spine renders exactly this, always, in this sequence. */
export const SPINE_STAGE_ORDER: readonly SpineStageId[] = [
  'import',
  'briefs',
  'review',
  'chapter-passes',
  'export',
] as const;

/**
 * THE ONE state vocabulary, used identically on all five stages. No synonyms, no per-stage extras.
 *
 *  - `blocked`      a NAMED prerequisite is missing; the row must say which and offer the fix.
 *  - `not-started`  nothing built yet. The inviting state, where a first-run user lives.
 *  - `running`      a build is in flight.
 *  - `behind`       built, but what it was built from has moved. NOT an error, and it has a magnitude
 *                   and a reason (see {@link BehindReason}).
 *  - `ready`        built and current.
 *  - `unavailable`  no surface exists for this stage yet. Honest greying, WITH the reason.
 */
export type StageState = 'blocked' | 'not-started' | 'running' | 'behind' | 'ready' | 'unavailable';

/**
 * Why a stage is `behind`. Every value maps to a field that is on the wire, so the row can always say
 * something true. More than one can hold at once; they are reported in the order below.
 *
 *  - `chapters-changed`      briefs: `staleCount > 0`, and `staleCount` is the magnitude.
 *  - `coverage-grew`         briefs: `!summaryCoversBuiltChapters` - the rollup is narrower than the
 *                            per-chapter work behind it.
 *  - `briefs-rebuilt`        review: `staleVsBriefs` - the briefs moved under the review.
 *  - `configuration-changed` either: `builtWithDifferentModel`. Deliberately NOT named as a model or a
 *                            provider on any user-facing surface (brief section 5.6).
 */
export type BehindReason =
  | 'chapters-changed'
  | 'coverage-grew'
  | 'briefs-rebuilt'
  | 'configuration-changed';

/** The next action a stage row can offer. `open-export` is inert until w4 builds the screen. */
export type StageActionId =
  | 'open-import'
  | 'build-briefs'
  | 'build-review'
  | 'open-findings'
  | 'open-export';

/**
 * One chapter, as stage 4 sees it. Stage 4 is a PER-CHAPTER picture by decision (Q2-A): there is no
 * book-level rollup of chapter-pass state and one was deliberately not built, so a book-level tick here
 * would be the second hardcoded lie. `running` is the one thing the app CAN know book-wide, from the
 * job registry's in-flight chapter analysis jobs.
 */
export interface ChapterPassSignal {
  chapterId: string;
  title: string;
  order: number;
  /** A chapter-scoped analysis job is in flight for this chapter right now. */
  running: boolean;
}

/**
 * Everything the spine renders from. All of it is real payload: nothing here may be synthesized by the
 * host to make a stage look further along than it is.
 *
 * `null` means NOT KNOWN YET (the request has not landed), never "empty". An empty book is
 * `chapters: []`, which is a fact; `chapters: null` is the absence of one, and the stages that depend
 * on it render `unknown` instead of guessing.
 */
export interface StageSpineSignals {
  /**
   * The book's chapters, for stage 4's per-chapter picture. Null on a surface that has no chapter list
   * (the books list, which w3's compact variant renders from counts alone).
   */
  chapters: ChapterPassSignal[] | null;
  /**
   * How many chapters the book has. Explicit rather than always `chapters.length`, so the books-list
   * payload's `chapterCount` (w1's M1) can drive stage 1 on a surface that never loads a chapter list.
   * Falls back to `chapters.length` when not given.
   */
  chapterCount?: number | null;
  /** Stage 2's whole source. */
  summary: BookSummaryStatusDto | null;
  /** Stage 3's whole source. */
  review: BookReviewStatusDto | null;
  /**
   * A briefs build THIS client started and is polling. ORed with the payload's `activeBuildJobId`, which
   * is a snapshot and does not carry a build that started since the last status read: without this the
   * spine sits on `not-started` for a poll interval after the user pressed build, which reads as if the
   * press did nothing. It is a real signal (the build POST returned a job id), not a synthesized state.
   */
  summaryRunning: boolean;
  /** The same, for the developmental review build. */
  reviewRunning: boolean;
  /**
   * Whether an export SCREEN exists in this build of the client. Every host now passes
   * {@link EXPORT_SURFACE_AVAILABLE}, which w4 set to true when it built `/books/:bookId/export`.
   *
   * It is a fact about the CLIENT BUILD, not about the book, which is why flipping it is not a hardcoded
   * "done": with it true, stage 5 still derives its state from the chapters, exactly like stage 1.
   */
  exportSurfaceAvailable: boolean;
  /**
   * How many of those chapters carry text. Stage 1's `ready` test, and the books-list payload's
   * `chaptersWithTextCount`. Null when not known.
   */
  chaptersWithText: number | null;
}

/**
 * WHETHER THIS BUILD OF THE CLIENT HAS AN EXPORT SCREEN. w4 built it (`/books/:bookId/export`), so it is
 * true, and it is a CONSTANT rather than a literal repeated in each host for one reason: four surfaces mount
 * a spine, and four copies of a boolean is how one of them keeps saying "no export screen" for a release
 * after the screen shipped - a stage lying in the safe direction is still the class of lie this wave removes.
 *
 * It stays a signal rather than being deleted from the model because it is genuinely a build fact: the seam
 * that lets a spec render stage 5 without a screen is the same seam that would let a deployment ship without
 * one. What it may never become is a per-book claim.
 */
export const EXPORT_SURFACE_AVAILABLE = true;

/**
 * Signals with NOTHING known. The starting value for every host: each stage renders `unknown` (or, for the
 * two that need no signal, its honest constant) rather than a guess.
 *
 * Shared rather than re-declared per host on purpose. Four surfaces now mount a spine, and a per-host copy
 * of this literal is how one of them eventually seeds `chaptersWithText: 0` instead of `null` and quietly
 * turns "not known yet" into "no text", which is the exact class of claim the wave exists to remove.
 */
export function emptyStageSpineSignals(): StageSpineSignals {
  return {
    chapters: null,
    chapterCount: null,
    chaptersWithText: null,
    summary: null,
    review: null,
    summaryRunning: false,
    reviewRunning: false,
    exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE,
  };
}

/** The derived, language-free status of one stage. Copy is resolved separately, per book language. */
export interface StageStatus {
  id: SpineStageId;
  /**
   * The stage's state, or `null` when the app makes NO book-level claim. Two different reasons for a
   * null, distinguished by the two flags below and never conflated:
   *   - {@link unknown} true:    the signals have not arrived. Renders as loading, never as a state.
   *   - {@link perChapter} true: stage 4 in its steady state. There IS no book-level answer (Q2-A) and
   *                              inventing one is the defect this wave removes; the row renders the
   *                              per-chapter breakdown instead.
   */
  state: StageState | null;
  /** The signals this stage needs have not landed yet. */
  unknown: boolean;
  /** Stage 4's steady state: no book-level claim, the chapter list is the content. */
  perChapter: boolean;
  /** When `blocked`, the stage that must happen first. Always set when state is `blocked`. */
  blockedBy: SpineStageId | null;
  /** When `behind`, every reason that holds, in report order. Empty otherwise. */
  behindReasons: BehindReason[];
  /** When `behind` for `chapters-changed`, how many chapters moved. Null when there is no magnitude. */
  behindMagnitude: number | null;
  /** The next action this row offers, or null when there is nothing honest to offer. */
  action: StageActionId | null;
  /**
   * Stages 1 and 5: how many chapters exist, and how many carry text. Null when NOT KNOWN, which readers
   * must keep distinct from zero - the copy layer renders a sentence off these and an absent fact may not
   * become the positive claim "none of them has any text".
   *
   * Stage 4 also carries {@link chapterCount} for its own gate; only 1 and 5 read the pair.
   */
  chapterCount: number | null;
  chaptersWithText: number | null;
  /** Stage 3 only: working-through progress, straight off the status payload. Null when no review. */
  findingTotal: number | null;
  findingResolved: number | null;
  findingOpen: number | null;
  /** Stage 4 only: the chapters, in order. Null when not known, [] for a book with no chapters. */
  chapters: ChapterPassSignal[] | null;
}

/**
 * Derive all five stages from the signals. Pure: same input, same output, no clock, no service.
 *
 * Read the per-stage comments as the contract; each names the exact field it reads.
 */
export function deriveStageSpine(signals: StageSpineSignals): StageStatus[] {
  const chapters = signals.chapters;
  const chapterCount = signals.chapterCount ?? (chapters ? chapters.length : null);
  const chaptersWithText = signals.chaptersWithText;

  return [
    deriveImport(chapterCount, chaptersWithText),
    deriveBriefs(signals.summary, chapterCount, signals.summaryRunning),
    deriveReview(signals.review, chapterCount, signals.reviewRunning),
    deriveChapterPasses(chapters, chapterCount),
    deriveExport(signals.exportSurfaceAvailable, chapterCount, chaptersWithText),
  ];
}

/**
 * Stage 1, Import. From the chapter list (inside a book) or `chapterCount` / `chaptersWithTextCount`
 * (on the books list) - the same two numbers either way.
 *
 *   chapterCount === null     -> unknown. The list has not landed.
 *   chapterCount === 0        -> not-started, and the action is to import. No text is possible with no
 *                                rows, so this answer needs no second number.
 *   chaptersWithText === null -> unknown. Rows exist and whether any of them carries text is NOT KNOWN.
 *   chaptersWithText > 0      -> ready.
 *   chapters but no text yet  -> not-started, with a DIFFERENT sentence: something exists, nothing usable.
 *
 * WHY THE NULL BRANCH IS ITS OWN CASE, and not `(chaptersWithText ?? 0) > 0`. That coalesce read an
 * ABSENT fact as the positive fact "zero chapters carry text" and rendered the assertive sentence
 * "12 chapters exist, but none of them has any text yet" from a payload that had said nothing of the
 * kind - against this file's own contract at {@link StageSpineSignals} ("null means NOT KNOWN YET, never
 * empty"). Every host that knows `chapterCount` also knows `chaptersWithText` today (they are computed
 * from one source), so this branch is a guard on a future host, which is exactly when it would be wrong.
 *
 * There is deliberately NO `running`. Import is a fire-and-forget POST pair with no persisted job, so
 * there is nothing to report and none may be invented.
 */
function deriveImport(chapterCount: number | null, chaptersWithText: number | null): StageStatus {
  const base = emptyStatus('import');
  base.chapterCount = chapterCount;
  base.chaptersWithText = chaptersWithText;
  if (chapterCount === null) {
    base.unknown = true;
    return base;
  }
  if (chapterCount === 0) {
    base.state = 'not-started';
    base.action = 'open-import';
    return base;
  }
  if (chaptersWithText === null) {
    base.unknown = true;
    return base;
  }
  if (chaptersWithText > 0) {
    base.state = 'ready';
    return base;
  }
  base.state = 'not-started';
  base.action = 'open-import';
  return base;
}

/**
 * Stage 2, Book briefs. From `BookSummaryStatusDto`.
 *
 *   no chapters              -> blocked by Import. A build here would have nothing to read, and saying so
 *                               is more useful than the payload's literal `not-started`.
 *   activeBuildJobId != null -> running (a live job is the strongest available fact).
 *   !hasSummary              -> not-started.
 *   ready                    -> ready.
 *   hasSummary && !ready     -> behind, with magnitude `staleCount` and every reason that holds.
 *
 * `behind` is the state users hit most and the state the old strip could not express at all. It is not
 * an error: the user edited their book, which is the point of the product, and a derived artifact lags.
 */
function deriveBriefs(
  summary: BookSummaryStatusDto | null,
  chapterCount: number | null,
  clientRunning: boolean,
): StageStatus {
  const base = emptyStatus('briefs');
  if (chapterCount === 0) {
    base.state = 'blocked';
    base.blockedBy = 'import';
    base.action = 'open-import';
    return base;
  }
  if (clientRunning) {
    base.state = 'running';
    return base;
  }
  if (!summary) {
    base.unknown = true;
    return base;
  }
  if (summary.activeBuildJobId) {
    base.state = 'running';
    return base;
  }
  if (!summary.hasSummary) {
    base.state = 'not-started';
    base.action = 'build-briefs';
    return base;
  }
  if (summary.ready) {
    base.state = 'ready';
    base.action = 'build-briefs';
    return base;
  }
  base.state = 'behind';
  base.action = 'build-briefs';
  base.behindReasons = behindReasonsForBriefs(summary);
  base.behindMagnitude = summary.staleCount > 0 ? summary.staleCount : null;
  return base;
}

/**
 * The reasons a built summary is not `ready`, in report order. All three are inputs to the server's own
 * `ready`, so at least one holds whenever `hasSummary && !ready` - but the list is allowed to come back
 * empty rather than fabricating a reason, and the copy layer has a truthful fallback for that case.
 */
function behindReasonsForBriefs(summary: BookSummaryStatusDto): BehindReason[] {
  const reasons: BehindReason[] = [];
  if (summary.staleCount > 0) reasons.push('chapters-changed');
  if (!summary.summaryCoversBuiltChapters) reasons.push('coverage-grew');
  if (summary.builtWithDifferentModel) reasons.push('configuration-changed');
  return reasons;
}

/**
 * Stage 3, Developmental review. From `BookReviewStatusDto`.
 *
 *   no chapters              -> blocked by IMPORT, offering the import. See the walkability rule below.
 *   activeBuildJobId != null -> running.
 *   !hasBriefs               -> blocked BY THE BOOK BRIEFS, and the row offers building them. This is the
 *                               product's one hard prerequisite: a review build with no briefs spends zero
 *                               model calls and comes back `briefsMissing`. It is the single most common
 *                               wasted action in the product, and the strip this replaces structurally
 *                               could not warn about it because it fused the two stages into one box.
 *   !hasReview               -> not-started.
 *   !ready                   -> behind, naming `staleVsBriefs` / `builtWithDifferentModel` as the reason(s).
 *   ready                    -> ready. TRUSTS `review.ready` rather than re-deriving it from the two
 *                               booleans above, exactly as `deriveBriefs` trusts `summary.ready` - the DTO's
 *                               own doc says `ready` is the gate and callers must use it.
 *
 * THE WALKABILITY RULE FOR `blocked`, and why zero chapters names Import rather than the briefs. The
 * `blocked` contract is two halves: name the prerequisite AND offer the way to fix it. An offered action
 * the user cannot actually walk satisfies the letter and breaks the point. With zero chapters this stage
 * used to name the briefs and offer `build-briefs`, while stage 2 in the SAME derivation was itself
 * `blocked` by Import and retargeted to `open-import`: one empty book therefore rendered two contradictory
 * primary CTAs, and pressing this row's action landed the user on a briefs row that also could not build.
 * So the empty book names the ONE prerequisite that is walkable from here, exactly as stages 4 and 5 do -
 * all four downstream stages say the same thing and point at the same door. The briefs prerequisite is
 * still named the moment it is the real one: chapters exist and `hasBriefs` is false, below.
 */
function deriveReview(
  review: BookReviewStatusDto | null,
  chapterCount: number | null,
  clientRunning: boolean,
): StageStatus {
  const base = emptyStatus('review');
  if (chapterCount === 0) {
    base.state = 'blocked';
    base.blockedBy = 'import';
    base.action = 'open-import';
    return base;
  }
  if (clientRunning) {
    base.state = 'running';
    return base;
  }
  if (!review) {
    base.unknown = true;
    return base;
  }
  base.findingTotal = review.findingCount;
  base.findingResolved = review.resolvedFindingCount;
  base.findingOpen = review.openFindingCount;
  if (review.activeBuildJobId) {
    base.state = 'running';
    return base;
  }
  if (!review.hasBriefs) {
    base.state = 'blocked';
    base.blockedBy = 'briefs';
    base.action = 'build-briefs';
    return base;
  }
  if (!review.hasReview) {
    base.state = 'not-started';
    base.action = 'build-review';
    return base;
  }
  // Trust the server's `ready`, exactly as `deriveBriefs` trusts `summary.ready`: `BookReviewStatus.IsReady`
  // (and its wire twin `BookReviewStatusDto.ready`) already state the readiness gate
  // (`hasBriefs && hasReview && !builtWithDifferentModel && !staleVsBriefs`) and their own doc says callers
  // must trust it rather than re-derive it. `staleVsBriefs` / `builtWithDifferentModel` are read below only
  // to NAME the reason a not-ready review is behind, never to decide ready vs. not.
  if (!review.ready) {
    base.state = 'behind';
    base.action = 'build-review';
    if (review.staleVsBriefs) base.behindReasons.push('briefs-rebuilt');
    if (review.builtWithDifferentModel) base.behindReasons.push('configuration-changed');
    return base;
  }
  base.state = 'ready';
  base.action = 'open-findings';
  return base;
}

/**
 * Stage 4, Chapter editing passes. THE STAGE THAT DOES NOT MAKE A BOOK-LEVEL CLAIM (Q2-A).
 *
 *   no chapters   -> blocked by Import (gated on stage 1 only, never on 2 or 3).
 *   any chapter running -> running, and the breakdown says which chapters.
 *   otherwise     -> NO STATE. `perChapter` is set and the row renders the chapter list as an entry
 *                    point. There is no book-level rollup of chapter-pass state, so `not-started` and
 *                    `ready` are both unknowable here and both would be a claim the app cannot make.
 */
function deriveChapterPasses(
  chapters: ChapterPassSignal[] | null,
  chapterCount: number | null,
): StageStatus {
  const base = emptyStatus('chapter-passes');
  base.chapters = chapters;
  base.chapterCount = chapterCount;
  if (chapterCount === 0) {
    base.state = 'blocked';
    base.blockedBy = 'import';
    base.action = 'open-import';
    return base;
  }
  if (chapters === null) {
    base.unknown = true;
    return base;
  }
  if (chapters.some(c => c.running)) {
    base.state = 'running';
    base.perChapter = true;
    return base;
  }
  base.perChapter = true;
  return base;
}

/**
 * Stage 5, Export. Gated on stage 1 only, and independent of 2, 3 and 4: it consumes nothing they make.
 *
 *   no export screen in this build -> unavailable. Unreachable in a shipped build since w4
 *                                     ({@link EXPORT_SURFACE_AVAILABLE}), and kept as the build-fact seam.
 *   chapterCount unknown           -> unknown. The screen exists but this surface cannot say if there is
 *                                     anything to put in a file.
 *   no chapters                    -> blocked by Import. This is exactly the server's own 409 answer
 *                                     (`noChapters`), said before the user spends a click on it.
 *   chaptersWithText unknown       -> unknown. Rows exist, but whether a file made from them would hold
 *                                     anything is not known here, and `ready` would be a guess.
 *   chapters, none with text       -> blocked by Import, with its own sentence. The server's second 409
 *                                     answer (`nothingWritten`), said before the click.
 *   otherwise                      -> ready, and the action opens the export screen.
 *
 * WHY THIS READS THE SAME SIGNAL AS STAGE 1, and what it cost not to. This stage used to read `ready` off
 * `chapterCount > 0` alone, so a book whose three chapters were created empty rendered stage 1
 * `not-started` ("none of them has any text yet") and stage 5 `ready` IN THE SAME COLUMN - and the user
 * who followed it downloaded a .docx containing nothing, HTTP 200, no error. That is this file's one rule
 * failing on the one stage whose input was on the wire and unused: `chaptersWithTextCount` was put there
 * by w1 for exactly this.
 *
 * The server now agrees rather than being contradicted: an all-unwritten book answers `409`
 * `nothingWritten` instead of assembling an empty document. The two are NOT the same test - the spine
 * counts `WordCount > 0` and the exporter asks whether the stored SFDT holds a renderable block - so this
 * derivation is a HONEST WARNING, never a prediction of which chapters the file will be missing. Those
 * come back on the response headers of a successful export and are rendered from the server's answer
 * (`export.service.ts`); a client-side guess at them would be a third spelling of the same definition.
 *
 * `blocked` rather than `not-started`: nothing about export is ever the user's own unstarted work, and
 * naming a prerequisite the user can walk (Import, the same door every other blocked stage points at on
 * this book) is what the `blocked` contract is for. `ready` still means only "there is something to
 * download and a screen to download it from", never that the author is finished.
 */
function deriveExport(
  surfaceAvailable: boolean,
  chapterCount: number | null,
  chaptersWithText: number | null,
): StageStatus {
  const base = emptyStatus('export');
  base.chapterCount = chapterCount;
  base.chaptersWithText = chaptersWithText;
  if (!surfaceAvailable) {
    base.state = 'unavailable';
    return base;
  }
  if (chapterCount === null) {
    base.unknown = true;
    return base;
  }
  if (chapterCount === 0) {
    base.state = 'blocked';
    base.blockedBy = 'import';
    base.action = 'open-import';
    return base;
  }
  if (chaptersWithText === null) {
    base.unknown = true;
    return base;
  }
  if (chaptersWithText === 0) {
    base.state = 'blocked';
    base.blockedBy = 'import';
    base.action = 'open-import';
    return base;
  }
  base.state = 'ready';
  base.action = 'open-export';
  return base;
}

/** A status with nothing claimed. Every derivation starts here and only sets what it can prove. */
function emptyStatus(id: SpineStageId): StageStatus {
  return {
    id,
    state: null,
    unknown: false,
    perChapter: false,
    blockedBy: null,
    behindReasons: [],
    behindMagnitude: null,
    action: null,
    chapterCount: null,
    chaptersWithText: null,
    findingTotal: null,
    findingResolved: null,
    findingOpen: null,
    chapters: null,
  };
}

/**
 * The stage whose row opens expanded, so the user always sees one self-explaining row without clicking:
 * the FIRST stage in canonical order that wants something from them. `ready`, `unavailable` and the
 * still-loading stages want nothing.
 *
 * When every stage is settled the focus falls to stage 4, because that is where the ongoing work lives
 * once the book-level builds are current. It is a default, not a claim: stage 4 still shows no tick.
 */
export function focusStageId(statuses: StageStatus[]): SpineStageId {
  const wants: ReadonlySet<StageState> = new Set<StageState>([
    'blocked',
    'not-started',
    'running',
    'behind',
  ]);
  const found = statuses.find(s => s.state !== null && wants.has(s.state));
  return found ? found.id : 'chapter-passes';
}
