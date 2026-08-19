/**
 * guides-strings invariants (chatbot phase A.2, c1).
 *
 * Map-level assertions only. The rendered-DOM counterparts (which group is named what, what the
 * language toggle does) live in `features/help/*.spec.ts`.
 */
import {
  GUIDES_STRINGS_EN,
  GUIDES_STRINGS_HE,
  GuidesStringKey,
  formatGuideDate,
  guidesString,
  stageLabel,
} from './guides-strings';

describe('guides-strings (chatbot phase A.2)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(GUIDES_STRINGS_HE).sort()).toEqual(Object.keys(GUIDES_STRINGS_EN).sort());
      // P3-75: non-vacuity floor, on the same idiom as feedback-strings.spec.ts - without it an empty
      // pair of maps would satisfy every claim in this describe.
      expect(Object.keys(GUIDES_STRINGS_HE).length).toBeGreaterThan(10);
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(GUIDES_STRINGS_HE), ...Object.entries(GUIDES_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(GUIDES_STRINGS_HE), ...Object.entries(GUIDES_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('the Hebrew strings really ARE Hebrew (no untranslated English left in the map)', () => {
      const untranslated = (Object.keys(GUIDES_STRINGS_HE) as GuidesStringKey[])
        .filter(k => /[A-Za-z]/.test(GUIDES_STRINGS_HE[k]));
      expect(untranslated).toEqual([]);
    });
  });

  describe('guidesString', () => {
    it('resolves from the requested language map', () => {
      expect(guidesString('he', 'helpLink')).toBe(GUIDES_STRINGS_HE['helpLink']);
      expect(guidesString('en', 'helpLink')).toBe('Guides');
    });
  });

  describe('stageLabel', () => {
    it('names every stage the shipped corpus uses, in both languages', () => {
      // The stages in Pagedraft.Api/Content/guides/*.md frontmatter. A stage added there without a
      // label here degrades to its slug (asserted below) rather than disappearing, but this list is
      // what keeps the shipped ones named.
      for (const stage of ['overview', 'import', 'book-intelligence', 'chapter-editing',
                           'whole-book-review', 'export', 'faq']) {
        expect(stageLabel('en', stage)).not.toBe(stage);
        expect(stageLabel('he', stage)).not.toBe(stage);
        expect(/[A-Za-z]/.test(stageLabel('he', stage)))
          .withContext(`the Hebrew label for "${stage}" is still English`)
          .toBeFalse();
      }
    });

    it('falls back to the raw slug for a stage this build has never heard of', () => {
      // A guide in an unknown stage is still a real, shipped document. Naming it awkwardly beats
      // dropping it out of the index.
      expect(stageLabel('he', 'release-notes')).toBe('release-notes');
      expect(stageLabel('en', 'release-notes')).toBe('release-notes');
    });
  });

  describe('formatGuideDate', () => {
    it('renders the calendar date the guide actually carries, in the viewer language', () => {
      expect(formatGuideDate('2026-08-06', 'en')).toBe('August 6, 2026');
      expect(formatGuideDate('2026-08-06', 'he')).toContain('2026');
      expect(formatGuideDate('2026-08-06', 'he')).toContain('6');
    });

    it('does NOT shift the day into the viewer timezone', () => {
      // `updated` is a calendar date, not an instant. Formatting it in local time would show the 5th to
      // anyone west of Greenwich, which is the bug the UTC pin exists to prevent. Asserted through the
      // day NUMBER so it holds wherever the suite runs.
      expect(formatGuideDate('2026-01-01', 'en')).toBe('January 1, 2026');
      expect(formatGuideDate('2026-12-31', 'en')).toBe('December 31, 2026');
    });

    it('renders nothing for a missing or unusable stamp rather than "Invalid Date"', () => {
      expect(formatGuideDate(null, 'he')).toBe('');
      expect(formatGuideDate(undefined, 'en')).toBe('');
      expect(formatGuideDate('', 'en')).toBe('');
      expect(formatGuideDate('not-a-date', 'en')).toBe('');
    });
  });
});
