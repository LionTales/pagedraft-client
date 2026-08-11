import { OVERVIEW_GUIDE_ID, STAGE_GUIDE_LINKS, stageGuideLink } from './stage-guide';
import { SPINE_STAGE_ORDER, SpineStageId } from './stage-spine.model';

/**
 * Wave 3 / w6 (Q13-A) - THE STAGE -> GUIDE JOIN, pinned.
 *
 * ── What this file can and cannot prove ───────────────────────────────────────────────────────────
 * It proves the join is TOTAL, that every stage resolves to exactly one guide, and that the two
 * non-one-to-one cases are declared rather than silently absorbed. It CANNOT prove the guide ids exist
 * on the server: the corpus lives in the other repo and no client test can read it.
 *
 * The other half of that mirror is
 * `Pagedraft.Api.Tests/ProductChatCorpusTests.EveryShippedGuidesIdAndStage_IsWhatTheClientsStageGuideAndStageLabelMapsMirror`,
 * which loads the shipped corpus and asserts its whole (id, stage) SET equals a set pinned there, in both
 * directions, so a rename in the corpus fails on the PR that renames it. What that test does NOT cover is
 * this file: it knows the corpus's own set and nothing about `STAGE_GUIDE_LINKS`, so it cannot see a stage
 * pointed at the wrong (but still shipped) guide. That is what the mapping test below pins. Neither half
 * sees both sides; together they bracket the mirror, and a drift is caught in whichever repo caused it.
 *
 * This docstring previously said `ProductChatCorpusTests` pinned the ids, which was not true of that file
 * (it pinned `export` alone). Measured while fixing it: a `guideId` rename WAS already caught elsewhere on
 * the API side, loudly (renaming `import` fails 11 tests, led by
 * `GuidesEndpointTests.TheIndex_IsNotEmpty_AndCarriesTheKnownShippedGuides`). A `guideStage` rename was
 * caught by NOTHING in either repo. So the id half was covered by accident and the stage half was the real
 * hole; the test named above now covers both, as one set.
 *
 * The honest degradation for a drift is stated in `stage-guide.ts`: a stage row's guide id that no longer
 * exists lands on the reader's "that guide does not exist" page.
 *
 * The DISCOVERED side of the completeness check is `SPINE_STAGE_ORDER`, not a list restated here: one
 * side of a completeness oracle must be discovered or the check goes stale the moment a stage lands.
 */
describe('stage -> guide join (w6)', () => {
  it('resolves every stage in the canonical order, with nothing missing and nothing extra', () => {
    expect(SPINE_STAGE_ORDER.length).toBe(5);

    for (const stage of SPINE_STAGE_ORDER) {
      const link = stageGuideLink(stage);
      expect(link).withContext(`stage ${stage} has no guide`).toBeTruthy();
      expect(link.stage).toBe(stage);
      expect(link.guideId.length).withContext(`stage ${stage} has an empty guide id`).toBeGreaterThan(0);
      expect(link.guideStage.length).withContext(`stage ${stage} has an empty join key`).toBeGreaterThan(0);
    }

    expect(Object.keys(STAGE_GUIDE_LINKS).sort()).toEqual([...SPINE_STAGE_ORDER].sort());
  });

  /**
   * THE ACTUAL MAPPING, spelled out. This is the table the todo asks for, and it is pinned as data rather
   * than described in a comment so a change to it is a visible diff in a test rather than a silent
   * re-point of a link the author follows.
   */
  it('maps each stage to the guide that answers it', () => {
    const expected: Record<SpineStageId, { guideId: string; guideStage: string }> = {
      'import':         { guideId: 'import',                     guideStage: 'import' },
      'briefs':         { guideId: 'book-setup-and-intelligence', guideStage: 'book-intelligence' },
      'review':         { guideId: 'whole-book-review',          guideStage: 'whole-book-review' },
      'chapter-passes': { guideId: 'chapter-editing-passes',     guideStage: 'chapter-editing' },
      'export':         { guideId: 'export',                     guideStage: 'export' },
    };

    for (const stage of SPINE_STAGE_ORDER) {
      const link = stageGuideLink(stage);
      expect(link.guideId).withContext(stage).toBe(expected[stage].guideId);
      expect(link.guideStage).withContext(stage).toBe(expected[stage].guideStage);
    }
  });

  /**
   * The join key is NOT the stage id, which is exactly why this is a map. Pinned so nobody replaces it
   * with an identity function after noticing that two of the five happen to agree.
   */
  it('is a real map: only two of the five stage ids equal their guide stage slug', () => {
    const identical = SPINE_STAGE_ORDER.filter(s => stageGuideLink(s).guideStage === s);

    expect(identical).toEqual(['import', 'export']);
  });

  /**
   * THE ONE GUIDE THAT IS BROADER THAN ITS STAGE. Book briefs lives inside `book-intelligence`, which also
   * covers the book profile, the Story Bible view, asking questions about the book, and the writing style
   * section w6 added. The flag is what makes the row warn before sending the author there, so it has to be
   * true for exactly that one stage and false for the rest.
   */
  it('declares exactly one broader-than-its-stage guide: the book briefs', () => {
    const broader = SPINE_STAGE_ORDER.filter(s => stageGuideLink(s).broaderThanStage);

    expect(broader).toEqual(['briefs']);
  });

  /**
   * The overview guide answers the spine as a WHOLE, so it deliberately joins no stage. If it ever
   * appeared in the map it would mean a row had been given the whole workflow as its stage guide.
   */
  it('keeps the overview guide out of the per-stage map', () => {
    expect(OVERVIEW_GUIDE_ID).toBe('workflow-overview');
    expect(SPINE_STAGE_ORDER.some(s => stageGuideLink(s).guideId === OVERVIEW_GUIDE_ID)).toBeFalse();
  });
});
