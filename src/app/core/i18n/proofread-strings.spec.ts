/**
 * f2: the proofread-string map is the single source of every user-facing string of the whole-book
 * proofread row, so its INVARIANTS are pinned here (same shape as run-strings.spec.ts).
 */
import {
  PROOFREAD_STRINGS_EN,
  PROOFREAD_STRINGS_HE,
  ProofreadStringKey,
  proofreadCountString,
  proofreadString,
} from './proofread-strings';

describe('proofread-strings (f2)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(PROOFREAD_STRINGS_HE).sort()).toEqual(Object.keys(PROOFREAD_STRINGS_EN).sort());
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(PROOFREAD_STRINGS_HE), ...Object.entries(PROOFREAD_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(PROOFREAD_STRINGS_HE), ...Object.entries(PROOFREAD_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('every Hebrew value carries the SAME placeholders as its English twin', () => {
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      const mismatched = (Object.keys(PROOFREAD_STRINGS_HE) as ProofreadStringKey[])
        .filter(k => placeholders(PROOFREAD_STRINGS_HE[k]).join() !== placeholders(PROOFREAD_STRINGS_EN[k]).join());
      expect(mismatched).toEqual([]);
    });

    it('the Hebrew strings really ARE Hebrew (no untranslated English left in the map)', () => {
      // 'DOCX' is a file-format name that stays Latin in Hebrew copy; placeholders are stripped too.
      const untranslated = (Object.keys(PROOFREAD_STRINGS_HE) as ProofreadStringKey[])
        .filter(k => /[A-Za-z]/.test(PROOFREAD_STRINGS_HE[k].replace(/\{\w+\}/g, '').replace(/DOCX/g, '')));
      expect(untranslated).toEqual([]);
    });
  });

  describe('proofreadString interpolation', () => {
    it('substitutes every named placeholder in both languages', () => {
      expect(proofreadString('en', 'running', { done: 3, total: 10 })).toBe('Proofreading: 3 of 10 chapters');
      expect(proofreadString('he', 'running', { done: 3, total: 10 })).toBe('מגיה: 3 מתוך 10 פרקים');
      expect(proofreadString('en', 'consentBody', { chapters: 2 }))
        .toBe('This will proofread 2 chapters, one after another. You can keep working meanwhile.');
    });

    it('c6: no string composes an ETA (formatEtaLabel returns a whole sentence and renders on its own line)', () => {
      const withEta = [...Object.entries(PROOFREAD_STRINGS_HE), ...Object.entries(PROOFREAD_STRINGS_EN)]
        .filter(([, v]) => v.includes('{eta}'))
        .map(([k]) => k);
      expect(withEta).toEqual([]);
    });

    it('leaves an UNKNOWN placeholder verbatim rather than blanking it', () => {
      expect(proofreadString('en', 'running', { done: 3 })).toBe('Proofreading: 3 of {total} chapters');
    });

    it('c6 gate: proofreadCountString picks the singular at exactly 1, in both languages', () => {
      expect(proofreadCountString('en', 'consentSkipped', 1, { skipped: 1 })).toBe('1 chapter already proofread and unchanged will be skipped.');
      expect(proofreadCountString('en', 'consentSkipped', 2, { skipped: 2 })).toBe('2 chapters already proofread and unchanged will be skipped.');
      expect(proofreadCountString('he', 'doneSummary', 1, { count: 1 })).toBe(PROOFREAD_STRINGS_HE.doneSummaryOne);
      expect(proofreadCountString('he', 'doneSummary', 0, { count: 0 })).toBe('0 פרקים הוגהו');
      for (const k of ['consentBody', 'consentSkipped', 'doneSummary', 'canceled', 'staleNote'] as const) {
        expect(proofreadCountString('en', k, 1, { chapters: 1, skipped: 1, count: 1, done: 1 }))
          .withContext(k).not.toMatch(/1 chapters/);
      }
    });

    it('c20: every count key has a singular twin that differs from its plural and never reads "1 chapters"', () => {
      const countKeys = [
        'consentBody', 'consentSkipped', 'doneSummary', 'canceled', 'staleNote',
        'failedNote', 'retryFailedButton', 'consentRetryTitle', 'consentRetryBody', 'running',
      ] as const;
      const params = { chapters: 1, skipped: 1, count: 1, done: 1, total: 1 };
      for (const k of countKeys) {
        for (const lang of ['he', 'en'] as const) {
          const one = proofreadCountString(lang, k, 1, params);
          const many = proofreadCountString(lang, k, 2, { chapters: 2, skipped: 2, count: 2, done: 2, total: 2 });
          expect(one).withContext(`${lang} ${k}`).not.toBe(many);
          expect(one).withContext(`${lang} ${k}`).not.toMatch(/\b1 chapters\b|1 פרקים/);
          expect(one).withContext(`${lang} ${k}`).not.toMatch(/\{\w+\}/);
        }
      }
      expect(proofreadCountString('he', 'failedNote', 1, { count: 1 })).toBe('פרק אחד נכשל בהגהה האחרונה:');
      expect(proofreadCountString('en', 'failedNote', 3, { count: 3 })).toBe('3 chapters failed in the last run:');
      expect(proofreadString('he', 'failedChapterItem', { number: 2, title: 'יומנו' })).toBe('פרק 2: יומנו');
      expect(proofreadString('en', 'failedChapterItemUntitled', { number: 5 })).toBe('Chapter 5');
    });

    it('returns the template untouched when no params are given', () => {
      expect(proofreadString('en', 'title')).toBe(PROOFREAD_STRINGS_EN['title']);
      expect(proofreadString('he', 'title')).toBe(PROOFREAD_STRINGS_HE['title']);
    });
  });
});
