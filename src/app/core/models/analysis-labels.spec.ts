import {
  ANALYSIS_TYPES,
  ANALYSIS_TYPE_LABELS,
  CHAPTER_RECAP_RELATIONSHIP,
  STARTABLE_ANALYSIS_TYPES,
} from './analysis';
import { DEFAULT_TITLES } from '../services/job-registry.service';
import { LABELS_EN, LABELS_HE } from '../../shared/activity-center/activity-center.component';
import { RUN_STRINGS_EN, RUN_STRINGS_HE, analysisTypeLabelFor } from '../i18n/run-strings';

/**
 * Wave 3 / w6 (Q9-C) - THE RENAME, SWEPT.
 *
 * ── What this file is, and what it honestly cannot be ─────────────────────────────────────────────
 * The todo asks for a grep-based test for the old label in user-facing strings. A Karma spec runs in a
 * browser and cannot read the source tree, so the reachable equivalent is a sweep over the STRING
 * REGISTRIES themselves: every exported map in this client through which a user-facing analysis-type or
 * job label is resolved. That is a stronger check than a grep in one way (it follows the resolution the
 * product actually performs, so a label reached through `analysisTypeLabelFor` is covered without this
 * file naming that function's callers) and weaker in another (a string hardcoded into a component rather
 * than sourced from one of the swept maps is invisible here). That is not a theoretical gap: this same
 * review cycle hit it twice, in `book-chapter-summaries.component.ts`'s own local `label()` and
 * `rederiveResultLabel()` maps (Hebrew, then English; findings f04 and f05), which the fix had to reach
 * by a whole-client grep rather than by this sweep.
 *
 * The weaker half is closed by construction rather than by assertion: every surface that renders an
 * analysis-type name goes through `ANALYSIS_TYPE_LABELS` - the analysis panel, its run tab, its history
 * tab and the job registry all read that ONE map, which is why the rename is a two-line change - and the
 * job kinds go through `DEFAULT_TITLES`, the activity centre's own two maps (`LABELS_HE`, `LABELS_EN`),
 * `ANALYSIS_TYPES` and the run-string maps (`RUN_STRINGS_HE`, `RUN_STRINGS_EN`). Every collection
 * enumerated in `everyUserFacingLabel` below is what is swept; the function IS the enumeration, on
 * purpose, so a count carried here cannot go stale the next time a collection is added to it.
 *
 * ── The two words, and why BOTH are banned ────────────────────────────────────────────────────────
 * `Summarize` and `סיכום`. The Hebrew is the one that mattered most: it was the pass's label AND the
 * legacy name of the book-level build ("סיכום הספר"), so the two colliding terms could appear one row
 * apart in the activity list. The wire value `Summarization` is NOT banned and must not be: it is the
 * API enum, the persisted row and the repair-config key, and this whole rename is a display mapping
 * precisely so that contract does not move.
 */
describe('the Summarize rename (w6 / Q9-C)', () => {
  /** The retired user-facing words, in both languages. */
  const RETIRED = ['Summarize', 'summarize', 'סיכום'];

  /** Every registry a user-facing analysis or job label is resolved through. */
  function everyUserFacingLabel(): { where: string; value: string }[] {
    const out: { where: string; value: string }[] = [];
    for (const lang of ['he', 'en'] as const) {
      for (const [key, value] of Object.entries(ANALYSIS_TYPE_LABELS[lang])) {
        out.push({ where: `ANALYSIS_TYPE_LABELS.${lang}.${key}`, value });
      }
    }
    for (const opt of ANALYSIS_TYPES) out.push({ where: `ANALYSIS_TYPES[${opt.value}].label`, value: opt.label });
    for (const [kind, title] of Object.entries(DEFAULT_TITLES)) {
      out.push({ where: `DEFAULT_TITLES.${kind}.he`, value: title.he });
      out.push({ where: `DEFAULT_TITLES.${kind}.en`, value: title.en });
    }
    for (const [key, value] of Object.entries(LABELS_HE)) out.push({ where: `LABELS_HE.${key}`, value });
    for (const [key, value] of Object.entries(LABELS_EN)) out.push({ where: `LABELS_EN.${key}`, value });
    for (const [key, value] of Object.entries(RUN_STRINGS_HE)) out.push({ where: `RUN_STRINGS_HE.${key}`, value });
    for (const [key, value] of Object.entries(RUN_STRINGS_EN)) out.push({ where: `RUN_STRINGS_EN.${key}`, value });
    return out;
  }

  it('sweeps a non-empty population, so the ban below cannot pass vacuously', () => {
    // The anti-vacuity floor. Every "no label says X" assertion in this file is meaningless if the
    // collection is empty, and an empty collection is exactly what a bad refactor of an export produces.
    expect(everyUserFacingLabel().length).toBeGreaterThan(40);
  });

  it('carries neither retired word in ANY user-facing label registry', () => {
    const offenders = everyUserFacingLabel()
      .filter(entry => RETIRED.some(word => entry.value.includes(word)))
      .map(entry => `${entry.where} = "${entry.value}"`);

    expect(offenders)
      .withContext('a user-facing string still calls the pass, or the briefs build, by its retired name')
      .toEqual([]);
  });

  it('displays the renamed pass in both languages', () => {
    expect(ANALYSIS_TYPE_LABELS.en['Summarization']).toBe('Chapter recap');
    expect(ANALYSIS_TYPE_LABELS.he['Summarization']).toBe('תמצית פרק');
    expect(analysisTypeLabelFor('en', 'Summarization')).toBe('Chapter recap');
    expect(analysisTypeLabelFor('he', 'Summarization')).toBe('תמצית פרק');
  });

  /**
   * THE CONTRACT THAT DID NOT MOVE. The keys here are wire values: the API enum the client posts, the
   * value a persisted result row carries, and the key the tier and repair configuration are looked up by.
   * Renaming one would break every history row read back from the database at once, which is why Q9-C is
   * absorbed as a display mapping.
   */
  it('leaves the wire vocabulary exactly where it was', () => {
    expect(ANALYSIS_TYPES.map(t => t.value)).toEqual([
      'Proofread', 'LineEdit', 'LinguisticAnalysis', 'LiteraryAnalysis', 'Summarization', 'Custom',
    ]);
    expect(Object.keys(ANALYSIS_TYPE_LABELS.he)).toContain('Summarization');
    expect(Object.keys(ANALYSIS_TYPE_LABELS.en)).toContain('Summarization');
  });
});

/**
 * ── Wave 3 / w7 (Q5): THE STARTABLE LIST AND THE VOCABULARY ARE DIFFERENT SETS ────────────────────
 *
 * Until w7 there was one constant and it fed two surfaces that only happened to want the same thing:
 * the run-tab picker (what an author can START) and the history tab's type-filter chips (what an
 * author can FIND). Retiring the Custom pass from the picker by deleting the entry would have taken
 * the chip with it, so past Custom results, which the API still stores and still serves, would have
 * become reachable only by scrolling the unfiltered list.
 *
 * These pin the split at the source. The rendered halves are pinned where they render, in
 * `analysis-panel.component.spec.ts` (picker) and `analysis-history-tab.component.spec.ts` (chips and
 * the Hebrew label on a historical row).
 */
describe('the startable-vs-known split (w7 / Q5)', () => {
  it('offers every known type except Custom as startable, in the same order', () => {
    expect(STARTABLE_ANALYSIS_TYPES.map(t => t.value)).toEqual([
      'Proofread', 'LineEdit', 'LinguisticAnalysis', 'LiteraryAnalysis', 'Summarization',
    ]);
  });

  it('keeps Custom in the KNOWN vocabulary, because persisted results still carry it', () => {
    expect(ANALYSIS_TYPES.map(t => t.value))
      .withContext('removing Custom here would remove its history filter chip and its label lookup')
      .toContain('Custom');
    expect(ANALYSIS_TYPE_LABELS.he['Custom'])
      .withContext('a missing label renders the raw ASCII wire value inside the Hebrew UI')
      .toBe('מותאם');
    expect(ANALYSIS_TYPE_LABELS.en['Custom']).toBe('Custom');
  });

  it('is a strict subset, so a type can never be startable without being nameable', () => {
    const known = new Set(ANALYSIS_TYPES.map(t => t.value as string));
    for (const t of STARTABLE_ANALYSIS_TYPES) {
      expect(known)
        .withContext(`${t.value} is startable but is not in the known vocabulary, so it has no label`)
        .toContain(t.value);
    }
    expect(STARTABLE_ANALYSIS_TYPES.length).toBeLessThan(ANALYSIS_TYPES.length);
  });
});

/**
 * ── w6 (Q9-C): label-map parity and the on-surface relationship statement ────────────────────────
 *
 * A sibling of the w7 split above, not a child of it: these pin the rename's label-map hygiene and the
 * "what does Chapter recap relate to" copy, neither of which is about which types are startable. (A
 * `describe` closing brace once sat in this file such that everything below ran INSIDE 'the
 * startable-vs-known split (w7 / Q5)', which meant a `--grep "startable-vs-known"` run silently pulled in
 * FIVE w6/Q9-C test cases that describe's own doc comment says nothing about - the parity case plus the
 * four in 'the on-surface relationship statement' - finding C2. Revert-verified: with the old nesting
 * restored and that describe focused via `fdescribe`, 8 tests ran under it instead of the 3 that belong
 * there. (Recounted 2026-08-14: this note first said "six assertions" and "the 4 that belong there";
 * the w7 describe holds THREE cases of its own and the block below contributes FIVE, which is the 8.))
 */
describe('label maps and the relationship statement (w6 / Q9-C)', () => {
  /** he/en parity, and no key in one map that the other lacks. */
  it('keeps the two label maps at parity', () => {
    expect(Object.keys(ANALYSIS_TYPE_LABELS.he).sort()).toEqual(Object.keys(ANALYSIS_TYPE_LABELS.en).sort());
    for (const key of Object.keys(ANALYSIS_TYPE_LABELS.he)) {
      expect(ANALYSIS_TYPE_LABELS.he[key].length).withContext(`he ${key}`).toBeGreaterThan(0);
      expect(ANALYSIS_TYPE_LABELS.en[key].length).withContext(`en ${key}`).toBeGreaterThan(0);
    }
  });

  // ── The relationship statement, Q9-C's second half ─────────────────────────────────────────────

  describe('the on-surface relationship statement', () => {
    const sentences = [
      { where: 'pass.he', value: CHAPTER_RECAP_RELATIONSHIP.pass.he },
      { where: 'pass.en', value: CHAPTER_RECAP_RELATIONSHIP.pass.en },
      { where: 'briefs.he', value: CHAPTER_RECAP_RELATIONSHIP.briefs.he },
      { where: 'briefs.en', value: CHAPTER_RECAP_RELATIONSHIP.briefs.en },
    ];

    it('says, from the PASS side, what it summarizes and what it does not feed', () => {
      expect(CHAPTER_RECAP_RELATIONSHIP.pass.en).toContain('this chapter');
      expect(CHAPTER_RECAP_RELATIONSHIP.pass.en).toContain('does not feed the book briefs');
      expect(CHAPTER_RECAP_RELATIONSHIP.pass.he).toContain('אינו מזין את תקצירי הספר');
    });

    it('says, from the BRIEFS side, that running the pass everywhere does not produce them', () => {
      expect(CHAPTER_RECAP_RELATIONSHIP.briefs.en).toContain('separate build');
      expect(CHAPTER_RECAP_RELATIONSHIP.briefs.en).toContain('Chapter recap');
      expect(CHAPTER_RECAP_RELATIONSHIP.briefs.he).toContain('בנייה נפרדת');
      expect(CHAPTER_RECAP_RELATIONSHIP.briefs.he).toContain('תמצית פרק');
    });

    /**
     * The ban here is on the retired NAME, not on the English verb. "Summarizes this chapter for you to
     * read" is the sentence Q9-C asks for verbatim, and the verb is what makes it readable; what must not
     * survive is the pass being CALLED Summarize. `\bSummarize\b` matches the name and not the inflection
     * (the `s` is a word character, so there is no boundary after "Summarize" in "Summarizes"), which is
     * the distinction the registry sweep above does not have to make because a label is the whole string.
     */
    it('names the pass by its NEW label, never by the retired one', () => {
      for (const s of sentences) {
        expect(s.value).withContext(`${s.where} still calls the pass Summarize`).not.toMatch(/\bSummarize\b/);
        expect(s.value).withContext(`${s.where} still says סיכום`).not.toContain('סיכום');
      }
    });

    it('carries no em-dash and no en-dash', () => {
      for (const s of sentences) {
        expect(s.value).withContext(s.where).not.toMatch(/[–—]/);
      }
    });
  });
});
