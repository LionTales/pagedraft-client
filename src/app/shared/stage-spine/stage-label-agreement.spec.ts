import { stageLabel } from '../../core/i18n/guides-strings';
import { STAGE_GUIDE_LINKS } from './stage-guide';
import { STAGE_NAMES } from './stage-spine.copy';
import { SPINE_STAGE_ORDER } from './stage-spine.model';

/**
 * ONE STAGE, ONE NAME - across the two client surfaces that both name a stage.
 *
 * The w8 live-browser gate found FOUR Hebrew names for stage 4 in a shipped build, two of them visible in a
 * single screenshot. Two of the four are client copy and are joined here: the stage spine's
 * {@link STAGE_NAMES} (owner-dictated and native-swept on 2026-08-11, therefore the canonical one) and the
 * `/help` index's stage-group heading (`guides-strings.ts`'s `STAGE_LABELS_*`, which was reading
 * `עריכת פרקים` / `Chapter editing passes`'s shorter English cousin).
 *
 * THE JOIN IS NOT A LITERAL. The two vocabularies use different keys - the spine's stage ids
 * (`chapter-passes`) and the corpus's frontmatter `stage` slugs (`chapter-editing`) - and
 * {@link STAGE_GUIDE_LINKS} already owns that mapping, so this asserts a property over the real join rather
 * than re-spelling either name. A rename on either side fails here; a rename on both sides, together, passes,
 * which is the whole point.
 *
 * WHAT ABOUT THE OTHER TWO RENDERINGS. They are guide prose and a guide H1, which live in the API repo and
 * which no client test process can read. The overlay's stage list is pinned on that side, against a mirror of
 * this same table, by `Pagedraft.Api.Tests/GuideStageVocabularyTests`. The guide's own H1 is deliberately NOT
 * pinned to anything: `GuideSelector` scores H1/H2 headings at weight 3.0, so a heading is a retrieval index
 * and renaming one silently re-ranks the chatbot.
 */
describe('stage name agreement across client surfaces', () => {
  const LANGS = ['he', 'en'] as const;

  /**
   * `briefs` is the ONE stage whose two names are allowed to differ, and it is exempt by a fact already on the
   * join rather than by a list kept here: its guide covers more than the stage (the book profile, the Story
   * Bible, asking questions about the book, the writing style), so the `/help` group heading names the
   * DOCUMENT ("Book setup") while the spine row names the STAGE ("Book briefs"). That is a deliberate
   * difference, stated in `stage-guide.ts`, not a drift.
   */
  it('exempts exactly one stage, and for the reason recorded on the join', () => {
    const exempt = SPINE_STAGE_ORDER.filter(id => STAGE_GUIDE_LINKS[id].broaderThanStage);

    expect(exempt).toEqual(['briefs']);
  });

  for (const lang of LANGS) {
    it(`names every stage identically on the spine and in the /help index (${lang})`, () => {
      const joined = SPINE_STAGE_ORDER.filter(id => !STAGE_GUIDE_LINKS[id].broaderThanStage);
      // Anti-vacuity: a filter that emptied (a renamed flag, a stage dropped from the order) would pass
      // every comparison below while proving nothing.
      expect(joined.length).toBe(4);

      for (const id of joined) {
        const spineName = STAGE_NAMES[id][lang];
        const indexHeading = stageLabel(lang, STAGE_GUIDE_LINKS[id].guideStage);

        expect(indexHeading)
          .withContext(
            `Stage '${id}' is called '${spineName}' on the stage spine and '${indexHeading}' on the /help ` +
            'index. One stage may carry one name. Change both, or record the difference on ' +
            'STAGE_GUIDE_LINKS the way `briefs` does.',
          )
          .toBe(spineName);
      }
    });
  }
});
