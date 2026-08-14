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
 *  - `blocked`      something NAMED is missing; the row must say what, and offer the fix when there is one
 *                   to offer. What is missing is usually an earlier stage ({@link StageStatus.blockedBy});
 *                   it can also be content that no stage produces ({@link BlockedNeed}), and naming the
 *                   nearest stage in that case is what final-r03 removed.
 *  - `not-started`  nothing built yet. The inviting state, where a first-run user lives.
 *  - `running`      a build is in flight.
 *  - `behind`       built, but what it was built from has moved. NOT an error, and it has a magnitude
 *                   and a reason (see {@link BehindReason}).
 *  - `ready`        built and current.
 *  - `unavailable`  no surface exists for this stage yet. Honest greying, WITH the reason. NIT 54: since
 *                   w4 shipped the export screen ({@link EXPORT_SURFACE_AVAILABLE} is `true`), no stage
 *                   in a shipped build can currently reach this state - it stays in the vocabulary as the
 *                   deliberate build-fact seam {@link EXPORT_SURFACE_AVAILABLE} documents, so one of the
 *                   six states here is presently unreachable rather than dead: a future stage without a
 *                   screen yet, or a build flag flipped back, would use it again.
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

/**
 * WHAT A BLOCKED ROW IS WAITING FOR WHEN THE ANSWER IS NOT AN EARLIER STAGE (final-r03).
 *
 * `blocked` has always carried a two-part contract: name what is missing, and offer the way to fix it. Until
 * the closing render gate there was exactly one KIND of missing thing - an earlier stage - so `blockedBy`
 * (a {@link SpineStageId}) was the whole of the first half. The gate found the case that does not fit: a book
 * with eight imported chapters and `exportableChapterCount: 0` rendered stage 1 `ready` and stage 5
 * `blocked` / "Needs first: Import" in ONE viewport, with an action button offering to upload a manuscript
 * over the manuscript that was already there. The named prerequisite was not missing; it was DONE.
 *
 * So the missing thing gets its own vocabulary rather than borrowing the nearest stage name:
 *
 *  - `exportable-content`  chapters exist and not one of them holds anything the exporter can put in a file.
 *                          The blocker is content, not a step, and no stage in the spine produces it: it is
 *                          made by writing in a chapter, which is stage 4's row and not a whole-book build.
 *
 * EXACTLY ONE of {@link StageStatus.blockedBy} and {@link StageStatus.blockedNeed} is set on a blocked row.
 * That is what keeps the contract's first half intact: the row still always names something, and now it names
 * the true thing.
 */
export type BlockedNeed = 'exportable-content';

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
  /**
   * How many of those chapters THE EXPORTER could put in a file - the book payload's
   * `exportableChapterCount`, computed by the export service itself. Stage 5's whole `ready` test, and
   * deliberately a SECOND number rather than a reuse of {@link chaptersWithText} (w8 / F2).
   *
   * The two answer different questions and a book can satisfy one and fail the other: "has text" is
   * `WordCount > 0`, "can be exported" is whether the stored SFDT holds a renderable block, plus the scene
   * rule. A book imported and never opened in the editor has word counts and no renderable document, and
   * stage 5 used to read `ready` on it while `GET /api/document/export/book/{id}` answered 409
   * `nothingWritten` - the spine speaking for the exporter off a predicate the exporter does not use.
   *
   * NULL ON EVERY SURFACE THAT DOES NOT LOAD THE BOOK PAYLOAD, which is the books list: the count cannot be
   * expressed in SQL and putting it on the list would turn a metadata query into a full-manuscript read per
   * row. Stage 5 therefore reads `unknown` there, which the compact density already says honestly for the
   * stages it cannot compute. Null is never coalesced to zero: that would turn "not known here" into
   * "nothing can be exported".
   */
  chaptersExportable: number | null;
}

/**
 * WHETHER THIS BUILD OF THE CLIENT HAS AN EXPORT SCREEN. w4 built it (`/books/:bookId/export`), so it is
 * true, and it is a CONSTANT rather than a literal repeated in each host for one reason: five surfaces mount
 * a spine (the books-list dashboard, the book dashboard, the editor, the import page and the export page
 * itself), and five copies of a boolean is how one of them keeps saying "no export screen" for a release
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
 * Shared rather than re-declared per host on purpose. Five surfaces now mount a spine, and a per-host copy
 * of this literal is how one of them eventually seeds `chaptersWithText: 0` instead of `null` and quietly
 * turns "not known yet" into "no text", which is the exact class of claim the wave exists to remove.
 */
export function emptyStageSpineSignals(): StageSpineSignals {
  return {
    chapters: null,
    chapterCount: null,
    chaptersWithText: null,
    chaptersExportable: null,
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
  /**
   * When `blocked` ON AN EARLIER STAGE, the stage that must happen first. Null when the row is blocked on
   * something that is not a stage, which is {@link blockedNeed} below - and exactly one of the two is set
   * whenever `state` is `blocked`, so a blocked row still always names what is missing.
   */
  blockedBy: SpineStageId | null;
  /**
   * When `blocked` on something that is NOT a stage, what that is. See {@link BlockedNeed} for why this
   * exists and what naming a completed stage instead used to cost.
   */
  blockedNeed: BlockedNeed | null;
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
   * Stage 4 also carries {@link chapterCount} for its own gate; only 1 and 5 read a second number, and
   * they read DIFFERENT second numbers - stage 1 {@link chaptersWithText}, stage 5
   * {@link chaptersExportable}.
   */
  chapterCount: number | null;
  chaptersWithText: number | null;
  /**
   * Stage 5 only: how many chapters the exporter could put in a file
   * ({@link StageSpineSignals.chaptersExportable}). Null when not known, under the same rule as the pair
   * above - the copy layer renders a sentence off it and an absent fact may not become "nothing can be
   * exported".
   */
  chaptersExportable: number | null;
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

  const inputs = buildInputsFor(chapterCount, chaptersWithText);

  return [
    deriveImport(chapterCount, chaptersWithText),
    deriveBriefs(signals.summary, inputs, signals.summaryRunning),
    deriveReview(signals.review, inputs, signals.reviewRunning),
    deriveChapterPasses(chapters, chapterCount),
    // Stage 5 gets its OWN inputs, off its own count. It is the one stage whose claim belongs to the
    // exporter rather than to the whole-book builders, and `inputs` is the builders' precondition.
    deriveExport(
      signals.exportSurfaceAvailable,
      chapterCount,
      signals.chaptersExportable,
      buildInputsFor(chapterCount, signals.chaptersExportable),
    ),
  ];
}

/**
 * WHAT A WHOLE-BOOK BUILD HAS TO READ, from the only two counts that answer it.
 *
 *   'unknown'     - one of the two counts has not landed. Nothing may be refused on an absent fact.
 *   'no-chapters' - the book has no chapter rows at all.
 *   'no-text'     - rows exist and not one of them carries a word.
 *   'has-text'    - at least one chapter carries text, so a build has something to read.
 *
 * IT CLASSIFIES A PAIR OF COUNTS, and the second count is the CALLER's. The whole-book builds pass
 * `chaptersWithText`; stage 5 passes `chaptersExportable`, because the exporter's precondition is not "is
 * there text" but "is there a renderable document" (w8 / F2, and see {@link deriveExport}). The shape of the
 * answer - unknown before no-chapters before the empty case - is what is shared, not the number.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A COMPARISON SPELLED PER CALLER. Every whole-book build in the product
 * reads chapter TEXT: the briefs builder, the developmental review that consumes them, and the writing-style
 * measurement. They therefore have exactly one precondition, and it was spelled twice with
 * two different answers - the spine's stages 1 and 5 read both counts (c01) while the dashboard's three
 * build rows read `chapterCount === 0` alone (c02). On a book with three chapters created empty that put
 * two surfaces on one screen in direct contradiction: the spine said "there are 3 chapters but nothing has
 * been written in them, so a file made now would be empty" while, 200px below, `Build now` sat enabled and
 * offered to spend a real model run on them. That is the same one-surface-denies-the-other class this wave
 * retired from the stage strip, reintroduced one surface over. Both sides now call this.
 *
 * `no-text` IS REFUSED, NOT WARNED ABOUT, because the server answers it as a total no-op and not as a
 * smaller build. Both per-chapter builders short-circuit on empty text before any model call
 * (`ChapterBriefService.LoadOrBuildChapterBriefAsync`, `AnalysisContextService.LoadOrBuildChapterStyleProfileAsync`),
 * and the briefs rollup then reports "not enough chapter briefs to build a book summary" and persists
 * nothing. A permitted build would therefore run a progress bar, write an activity entry and finish leaving
 * the row exactly where it started - a ceremony that produces nothing, which is this wave's own definition
 * of claiming work that will not be done. The prerequisite is walkable (write in a chapter, or import a
 * manuscript), so `blocked` keeps both halves of its contract.
 *
 * THE ORDER OF THE TWO NULL CHECKS IS LOAD-BEARING. `chapterCount === null` is asked first because with no
 * rows there is no text question to ask; `chaptersWithText === null` is then its own answer rather than
 * being coalesced to zero, because an absent fact may never become the positive claim "nothing is written".
 */
export type BuildInputs = 'unknown' | 'no-chapters' | 'no-text' | 'has-text';

export function buildInputsFor(chapterCount: number | null, chaptersWithText: number | null): BuildInputs {
  if (chapterCount === null) return 'unknown';
  if (chapterCount === 0) return 'no-chapters';
  if (chaptersWithText === null) return 'unknown';
  if (chaptersWithText === 0) return 'no-text';
  return 'has-text';
}

/**
 * True when {@link buildInputsFor} says a whole-book build has nothing to read. The one predicate the
 * dashboard's three build rows disable on, so their answer and the spine's cannot drift apart again.
 */
export function buildIsRefused(inputs: BuildInputs): boolean {
  return inputs === 'no-chapters' || inputs === 'no-text';
}

/** The one blocked answer for a stage whose inputs are missing: name Import, and offer it. */
function blockedByImport(base: StageStatus): StageStatus {
  base.state = 'blocked';
  base.blockedBy = 'import';
  base.action = 'open-import';
  return base;
}

/**
 * THE OTHER BLOCKED ANSWER (final-r03): the row is waiting on CONTENT, not on a step.
 *
 * It names {@link BlockedNeed} `exportable-content` and offers NO action, and both halves are deliberate.
 *
 * WHY NOT `blockedByImport` HERE. That is what shipped, and the closing render gate read it back: on a book
 * with eight imported chapters, stage 1 said `ready` and stage 5 said "Needs first: Import" over a button
 * offering to upload a manuscript. Import was not the missing thing - it was the finished thing - so the row
 * told the author to redo completed work, and contradicted the row four places above it in the same column.
 * That is the same class as the defect w8 / F2 fixed on this very code path (stage 5 claiming a state the
 * server contradicts), only inverted: there the stage over-claimed readiness, here it under-claims the work
 * the author has already done.
 *
 * WHY NO ACTION, rather than a new one. The thing that is missing is made by writing in a chapter, and
 * {@link StageActionId} is a closed union whose every member is a whole-book move that the hosts route
 * explicitly (`book-dashboard.component.ts`'s `onSpineAction` switch, and the same event handled by the
 * editor, import and export hosts). A new id would be a fifth thing to wire in five hosts, and the switch
 * has no exhaustiveness assertion, so a host that missed it would render a button that silently does
 * nothing - which is a worse version of this very finding. And the walkable door is already ON THIS SPINE
 * and one row up: stage 4 renders the chapter list and every entry opens a chapter, which
 * {@link deriveChapterPasses} keeps walkable on exactly this book for exactly this reason. The row's third
 * line says what a file made now would contain, and the row's guide link explains the stage; what the row
 * no longer does is offer a step that is already complete. "Absent rather than disabled when there is
 * nothing honest to offer" is the template's standing rule, and this is that case.
 */
function blockedOnExportableContent(base: StageStatus): StageStatus {
  base.state = 'blocked';
  base.blockedNeed = 'exportable-content';
  base.action = null;
  return base;
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
  // The same four answers every other stage gates on, read from {@link buildInputsFor}. Stage 1 is where
  // the two counts MEAN something to the author, so it renders them rather than refusing: `no-chapters` and
  // `no-text` are both "the manuscript is not in yet", told apart by `importDetail`'s two sentences.
  switch (buildInputsFor(chapterCount, chaptersWithText)) {
    case 'unknown':
      base.unknown = true;
      return base;
    case 'has-text':
      base.state = 'ready';
      return base;
    default:
      base.state = 'not-started';
      base.action = 'open-import';
      return base;
  }
}

/**
 * Stage 2, Book briefs. From `BookSummaryStatusDto`.
 *
 *   no chapters              -> blocked by Import. A build here would have nothing to read, and saying so
 *                               is more useful than the payload's literal `not-started`.
 *   a build is running       -> running (a live job is the strongest available fact, and it outranks the
 *                               refusal below: a run that IS in flight may not be called blocked).
 *   no chapter carries text  -> blocked by Import, for the same reason as the line above it and on the same
 *                               shared predicate ({@link buildInputsFor}). See below.
 *   !hasSummary              -> not-started.
 *   ready                    -> ready.
 *   hasSummary && !ready     -> behind, with magnitude `staleCount` and every reason that holds.
 *
 * WHY `no-text` REFUSES THIS STAGE AND NOT ONLY STAGES 1 AND 5. c01 taught the two stages that RENDER the
 * counts to read both of them, which left this stage offering `Build briefs` on a book whose chapters are
 * all empty - a build the server answers as a total no-op, and one the dashboard's briefs row (which reads
 * the same predicate) refuses. An offered action the neighbouring row refuses is the walkability defect c02
 * closed for the zero-chapter book, so it is closed here on the same terms: name the ONE prerequisite that
 * is walkable from here, which is the same door stages 1, 3 and 5 point at on this book.
 *
 * It is placed AFTER both running checks deliberately. `blocked` and `running` are both facts, but only one
 * of them can be observed to be happening; a build started before the chapters were emptied must keep
 * reporting that it is running until it finishes.
 *
 * `behind` is the state users hit most and the state the old strip could not express at all. It is not
 * an error: the user edited their book, which is the point of the product, and a derived artifact lags.
 */
function deriveBriefs(
  summary: BookSummaryStatusDto | null,
  inputs: BuildInputs,
  clientRunning: boolean,
): StageStatus {
  const base = emptyStatus('briefs');
  if (inputs === 'no-chapters') return blockedByImport(base);
  if (clientRunning) {
    base.state = 'running';
    return base;
  }
  // Reordered ahead of the `!summary` guard so a live server-side job still outranks the refusal below.
  // With no payload the optional chain is undefined and this falls through exactly as it did before.
  if (summary?.activeBuildJobId) {
    base.state = 'running';
    return base;
  }
  // Knowable without the status payload: it is a fact about the chapters, not about the briefs.
  if (inputs === 'no-text') return blockedByImport(base);
  if (!summary) {
    base.unknown = true;
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
 *   no chapter carries text  -> blocked by IMPORT too, on the same shared predicate ({@link buildInputsFor})
 *                               and for the same walkability reason: the briefs this stage needs cannot be
 *                               built from empty chapters either, so naming them would point the author at
 *                               a row that is itself refused. See the note on {@link deriveBriefs}.
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
  inputs: BuildInputs,
  clientRunning: boolean,
): StageStatus {
  const base = emptyStatus('review');
  if (inputs === 'no-chapters') return blockedByImport(base);
  if (clientRunning) {
    base.state = 'running';
    return base;
  }
  // The findings counts are carried on every branch that HAS a payload, including the running one, exactly
  // as before - only the two `inputs` refusals below can now return without them, and on a book with no
  // text there are no findings to carry.
  if (review) {
    base.findingTotal = review.findingCount;
    base.findingResolved = review.resolvedFindingCount;
    base.findingOpen = review.openFindingCount;
  }
  if (review?.activeBuildJobId) {
    base.state = 'running';
    return base;
  }
  // Knowable without the status payload: it is a fact about the chapters, not about the review.
  if (inputs === 'no-text') return blockedByImport(base);
  if (!review) {
    base.unknown = true;
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
 *
 * WHY THIS STAGE DELIBERATELY DOES NOT TAKE THE `no-text` REFUSAL stages 2, 3 and 5 now take. Those three
 * offer a whole-book BUILD, and on a book with no text the build is a no-op, so offering it claims work
 * that will not happen. This row offers no build: its content is the chapter list, and every entry is a way
 * INTO the chapter - which on a rows-but-no-text book is precisely where the author has to go to fix the
 * thing that blocks the other three. Refusing it would remove the only walkable door on the screen while
 * four rows point at it. It also asserts nothing: `perChapter` with a null state is the absence of a claim,
 * so there is no contradiction for a refusal to resolve.
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
 *   chaptersExportable unknown     -> unknown. Rows exist, but whether a file made from them would hold
 *                                     anything is not known here, and `ready` would be a guess. This is
 *                                     the permanent answer on the books list, which does not carry the
 *                                     count (see {@link StageSpineSignals.chaptersExportable}).
 *   chapters, none exportable      -> blocked ON CONTENT, not on a stage ({@link blockedOnExportableContent}),
 *                                     with its own sentence and NO action. The server's second 409 answer
 *                                     (`nothingWritten`), said before the click.
 *   otherwise                      -> ready, and the action opens the export screen.
 *
 * THE TWO BLOCKED CASES ARE NOT THE SAME BLOCKED, and final-r03's closing render gate is where that stopped
 * being a nicety. With no chapters, Import is genuinely the missing step and `open-import` is genuinely the
 * fix, so that case is unchanged. With chapters that hold nothing renderable, Import is DONE - the gate read
 * stage 1 "Ready" four rows above stage 5 "Blocked / Needs first: Import" with an "upload a manuscript"
 * button, in Hebrew and again in English, on a book with eight imported chapters. `blockedSentence`'s
 * contract is to name what is MISSING, and a completed stage is not it. See
 * {@link blockedOnExportableContent} for the second answer and for why it offers no action at all.
 *
 * WHY THIS DOES NOT READ STAGE 1's SIGNAL, and what each version of that cost. It first read `ready` off
 * `chapterCount > 0` alone, so a book whose three chapters were created empty rendered stage 1
 * `not-started` ("none of them has any text yet") and stage 5 `ready` IN THE SAME COLUMN - and the user
 * who followed it downloaded a .docx containing nothing, HTTP 200, no error. c01 fixed that by reading
 * stage 1's `chaptersWithText`, and that was the right shape with the wrong number.
 *
 * THE NUMBER IS NOW THE EXPORTER'S OWN (w8 / F2). `WordCount > 0` and "the stored SFDT holds a renderable
 * block" are two different questions, and a book satisfies the first and fails the second the moment it is
 * imported and not yet opened in the editor - which is most books, on their first visit to this screen. The
 * live gate found exactly that: `ייצוא: מוכן` above a 409 `nothingWritten`. The argument that used to sit
 * here - that the difference is an honest WARNING rather than a prediction - holds for a PARTIAL skip,
 * where a file really is produced and the chapters left out of it come back on the response headers and are
 * rendered from the server's answer (`export.service.ts`). It does not hold for the all-or-nothing claim
 * this stage makes, because there the two predicates do not differ in detail, they contradict each other.
 * One claim, one source: `BookDetailDto.exportableChapterCount` comes from
 * `BookExportService.CountExportableChaptersAsync`, which calls the same underlying rule the export
 * endpoints do (`RenderableUnitsOf`), one level down - not the endpoints' own helper, `ResolveUnitsFor`,
 * which adds a warning log on top of that rule and nothing else. The two callers' agreement is held by
 * `BookExportServiceTests.cs`, not by construction; a filter added inside `ResolveUnitsFor`, or a conversion
 * failure that leaves an export with zero buffers, would reopen the drift silently.
 *
 * `blocked` rather than `not-started`: nothing about export is ever the user's own unstarted work, and
 * naming what is missing is what the `blocked` contract is for. On the empty book that is Import, the same
 * door every other blocked stage points at; on the book whose chapters hold nothing renderable it is the
 * content itself, because Import there is already done. `ready` still means only "there is something to
 * download and a screen to download it from", never that the author is finished.
 */
function deriveExport(
  surfaceAvailable: boolean,
  chapterCount: number | null,
  chaptersExportable: number | null,
  inputs: BuildInputs,
): StageStatus {
  const base = emptyStatus('export');
  base.chapterCount = chapterCount;
  base.chaptersExportable = chaptersExportable;
  if (!surfaceAvailable) {
    base.state = 'unavailable';
    return base;
  }
  // The five-way answer this stage used to spell inline is now {@link buildInputsFor}, shared with stages
  // 1, 2 and 3 and with the dashboard's three build rows. `no-chapters` and `no-text` are the server's own
  // two 409 answers (`noChapters`, `nothingWritten`), said before the user spends a click on them - and
  // they get TWO DIFFERENT blocked answers here, which is the whole of final-r03's fix. They used to share
  // one.
  switch (inputs) {
    case 'unknown':
      base.unknown = true;
      return base;
    case 'no-chapters':
      return blockedByImport(base);
    case 'no-text':
      return blockedOnExportableContent(base);
    default:
      base.state = 'ready';
      base.action = 'open-export';
      return base;
  }
}

/** A status with nothing claimed. Every derivation starts here and only sets what it can prove. */
function emptyStatus(id: SpineStageId): StageStatus {
  return {
    id,
    state: null,
    unknown: false,
    perChapter: false,
    blockedBy: null,
    blockedNeed: null,
    behindReasons: [],
    behindMagnitude: null,
    action: null,
    chapterCount: null,
    chaptersWithText: null,
    chaptersExportable: null,
    findingTotal: null,
    findingResolved: null,
    findingOpen: null,
    chapters: null,
  };
}

/**
 * The stage whose row opens expanded, so the user always sees one self-explaining row without clicking:
 * the FIRST stage in canonical order that wants something from them. `ready`, `unavailable` and the
 * per-chapter stage want nothing.
 *
 * When every stage is GENUINELY SETTLED the focus falls to stage 4, because that is where the ongoing
 * work lives once the book-level builds are current. It is a default, not a claim: stage 4 still shows no
 * tick. That default is guarded to fire only on real settlement, not merely on "nothing wants attention
 * yet" - the signals not having landed also produces a `find` miss (an `unknown` stage carries `state`
 * `null`), and defaulting to stage 4 there would open "Chapter editing passes" on first paint and then
 * visibly jump to whichever stage actually wants attention the instant real data lands.
 *
 * ── THE UNKNOWN FALLBACK, AND WHY IT IS NOT STAGE 1 (w8 / E1) ────────────────────────────────────
 * This used to fall back to stage 1 whenever ANY stage read `unknown`, which is a permanent condition on
 * every surface the COMPACT density mounts on: the books list, the import screen and the export screen
 * all hold enough payload to settle stage 1 and nothing at all about stages 2 to 5. So the fallback did
 * not fire on first paint only - it fired forever, and because {@link compactSummaryLine} prefixes the
 * focus stage with "Next", a books-list row with an imported manuscript read `הבא: ייבוא, מוכן`:
 * a FINISHED stage announced as the next thing to do.
 *
 * The fallback is now the first stage that is still `unknown`, in canonical order. That preserves the
 * behaviour the paragraph above argues for - on genuine first paint every stage is `unknown`, so the
 * first one IS stage 1 - while on a surface that has settled the stages it can, the focus moves past
 * them to the first one this screen cannot speak for. That is the honest reading of "the first stage
 * that wants something": a settled `ready` stage wants nothing and must never be named as next, and an
 * unknown stage is the earliest point at which something may still be wanted. Compact renders it with
 * `COMPACT_UNKNOWN_LABEL` ("not known here"), so the line says which stage is next and admits it cannot
 * report its state from this screen, rather than making a false claim about a finished one.
 *
 * A RUNNING stage still wins ahead of all of this. It wins here positionally (`running` is in `wants`),
 * and the compact density additionally hoists a running stage over the focus stage regardless of order,
 * because carrying the running signal on every route is that density's job.
 */
export function focusStageId(statuses: StageStatus[]): SpineStageId {
  const wants: ReadonlySet<StageState> = new Set<StageState>([
    'blocked',
    'not-started',
    'running',
    'behind',
  ]);
  const found = statuses.find(s => s.state !== null && wants.has(s.state));
  if (found) return found.id;
  const firstUnknown = statuses.find(s => s.unknown);
  return firstUnknown ? firstUnknown.id : 'chapter-passes';
}
