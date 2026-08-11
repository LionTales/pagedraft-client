import { SpineStageId } from './stage-spine.model';

/**
 * Wave 3 / w6 (Q13-A) - THE JOIN FROM A SPINE STAGE TO ITS GUIDE.
 *
 * ── What this is, and what it deliberately is not ──────────────────────────────────────────────────
 * First-run orientation is a VIEW OVER THE SERVED GUIDES, not tutorial prose written into components.
 * That was Q13's explicit ruling: hardcoded tutorial copy is throwaway work that has to be kept in sync
 * with the assistant's answers, and it is how a product ends up with a third contradictory stage model.
 * So a stage row does not EXPLAIN the stage at length; it points at the document that does, and the same
 * pointer is what the assistant cites.
 *
 * This file therefore holds exactly one thing: which guide answers which stage. No prose, no titles, no
 * language. Titles come from the server (derived from each guide's own H1) and the body comes from the
 * `/help/:guideId` reader that chatbot phase A.2 already built. Nothing here duplicates a serving path.
 *
 * ── The join key ──────────────────────────────────────────────────────────────────────────────────
 * The corpus's frontmatter carries `stage:` on every file, and the brief names it the join key from a
 * spine stage to its guide. The two vocabularies are NOT the same strings, which is why this is a map
 * and not an identity function: the spine's ids are `import | briefs | review | chapter-passes | export`
 * and the corpus's stage slugs are `import | book-intelligence | whole-book-review | chapter-editing |
 * export`. Both are recorded per row so a reader can check the join rather than trust it.
 *
 * ── The two joins that are NOT one-to-one, stated rather than hidden ───────────────────────────────
 * 1. `briefs` -> `book-setup-and-intelligence`. The guide is BROADER than the stage: besides the book
 *    briefs it also covers the book profile, the Story Bible view, asking questions about the book, and
 *    (since this todo) your book's writing style. The brief calls this out explicitly ("stage 2 lives
 *    inside book-intelligence"). The row says so, via {@link StageGuideLink.broaderThanStage}, instead
 *    of sending the author to a document that opens on a heading they did not ask about with no warning.
 * 2. The corpus's `overview` and `faq` guides join NO stage at all. `overview` is the whole workflow, so
 *    it belongs to the spine as a WHOLE rather than to any row of it - which is why it is the source the
 *    first-run orientation panel reads (see `first-run-orientation.component.ts`) and not a row link.
 *    `faq` is cross-cutting. Both stay reachable from `/help`, which lists every guide the server sends.
 *
 * ── Why the ids are literals here, what pins them, and what a drift costs ──────────────────────────
 * These are the corpus's own frontmatter `id` values, and they are a CROSS-REPO MIRROR of
 * `Pagedraft.Api/Content/guides/*.md`, like `guides-strings.ts`'s stage-label map (which mirrors the
 * `stage:` values off the same files). No client test can read that directory, so the pin lives on the
 * side that can actually move it:
 * `Pagedraft.Api.Tests/ProductChatCorpusTests.EveryShippedGuidesIdAndStage_IsWhatTheClientsStageGuideAndStageLabelMapsMirror`
 * loads the shipped corpus and asserts its whole (id, stage) set against a set pinned there, in both
 * directions, covering both maps' vocabularies at once. It knows nothing about THIS file's contents,
 * though: it catches a rename in the corpus, not a stage wired to the wrong shipped guide. That is what
 * `stage-guide.spec.ts` pins. Neither half sees both sides.
 *
 * If a drift does get through, the failure is honest rather than silent, but it is not ONE failure, and
 * the difference is worth knowing before reading a bug report:
 *   - A STAGE ROW's guide id (the five in the map below). The row routes to `/help/:guideId`, the API
 *     answers 404 `guideNotFound`, and `GuideReaderComponent` renders "that guide does not exist" with a
 *     way back to the index. It distinguishes a missing guide from a missing language from a corpus the
 *     server could not read at all. Never a blank page. Same degradation as the assistant's citation chips.
 *   - {@link OVERVIEW_GUIDE_ID}, which is read TWICE and degrades differently on each. The orientation
 *     panel's "read the whole guide" button routes to the reader, so it lands on the page above; but the
 *     panel also FETCHES that guide inline for its excerpt, and `FirstRunOrientationComponent` maps 404
 *     onto its `corpus` state on purpose, so the excerpt reports the install fault ("the guides are not
 *     present on this server") rather than a missing document the author never asked for by name. Correct
 *     for a corpus that did not ship, misleading for a guide that was merely renamed.
 *   - A `guideStage` slug. Nothing routes by it (it is recorded so the join is checkable), so a rename
 *     costs nothing here; it surfaces on `/help`, where `stageLabel` falls back to the raw slug.
 */
export interface StageGuideLink {
  /** The spine stage this link belongs to. */
  stage: SpineStageId;
  /** The guide's frontmatter `id`, which is also the `/help/:guideId` route parameter. */
  guideId: string;
  /** The guide's frontmatter `stage`, i.e. the join key itself. Kept so the join is checkable. */
  guideStage: string;
  /**
   * True when the guide covers more than this one stage, so the row can say so before sending the
   * author there. Only `briefs` is true today; see the class doc.
   */
  broaderThanStage: boolean;
}

/**
 * Every stage's guide. A `Record` rather than an array so TypeScript refuses a build that adds a spine
 * stage without deciding which guide answers it: a stage silently missing from an array would render a
 * row with no way into the content, which is the "dead affordance" this todo is required not to ship.
 */
export const STAGE_GUIDE_LINKS: Record<SpineStageId, StageGuideLink> = {
  'import': {
    stage: 'import',
    guideId: 'import',
    guideStage: 'import',
    broaderThanStage: false,
  },
  'briefs': {
    stage: 'briefs',
    guideId: 'book-setup-and-intelligence',
    guideStage: 'book-intelligence',
    broaderThanStage: true,
  },
  'review': {
    stage: 'review',
    guideId: 'whole-book-review',
    guideStage: 'whole-book-review',
    broaderThanStage: false,
  },
  'chapter-passes': {
    stage: 'chapter-passes',
    guideId: 'chapter-editing-passes',
    guideStage: 'chapter-editing',
    broaderThanStage: false,
  },
  'export': {
    stage: 'export',
    guideId: 'export',
    guideStage: 'export',
    broaderThanStage: false,
  },
};

/**
 * The guide that answers one stage. Total over {@link SpineStageId} by construction, so callers never
 * need a null branch and no stage can quietly lose its pointer.
 */
export function stageGuideLink(stage: SpineStageId): StageGuideLink {
  return STAGE_GUIDE_LINKS[stage];
}

/**
 * The guide the first-run orientation reads. NOT a member of the map above, on purpose: it answers the
 * spine as a whole rather than any single row, so giving it a stage would have meant inventing a
 * sixth stage or attaching the whole workflow to one of the five.
 */
export const OVERVIEW_GUIDE_ID = 'workflow-overview';
