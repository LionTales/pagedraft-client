/**
 * c02: the run-string map is the single source of every user-facing analysis-run string, so its
 * INVARIANTS are pinned here rather than left to review.
 *
 * These are map-level assertions on purpose, and they are deliberately NOT the whole of c02's test
 * coverage: a map can be perfectly localized and still never be read by the surface that shows the
 * text, which is exactly the defect this todo fixed. The rendered-DOM counterpart lives in
 * `shared/analysis-run-dialog/run-chrome-i18n.spec.ts`.
 */
import {
  RUN_STRINGS_EN,
  RUN_STRINGS_HE,
  RunStringKey,
  analysisTypeLabelFor,
  formatEtaLabel,
  formatRunDurationLabel,
  runChromeLang,
  runString,
} from './run-strings';

describe('run-strings (c02)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(RUN_STRINGS_HE).sort()).toEqual(Object.keys(RUN_STRINGS_EN).sort());
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(RUN_STRINGS_HE), ...Object.entries(RUN_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(RUN_STRINGS_HE), ...Object.entries(RUN_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('every Hebrew value carries the SAME placeholders as its English twin', () => {
      const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      const mismatched = (Object.keys(RUN_STRINGS_HE) as RunStringKey[])
        .filter(k => placeholders(RUN_STRINGS_HE[k]).join() !== placeholders(RUN_STRINGS_EN[k]).join());
      expect(mismatched)
        .withContext('a placeholder present in one language and not the other renders a hole in that language')
        .toEqual([]);
    });

    it('the Hebrew strings really ARE Hebrew (no untranslated English left in the map)', () => {
      // Latin letters are the tell. Digits, punctuation and placeholders are fine, so the placeholder
      // names are stripped before the check.
      const untranslated = (Object.keys(RUN_STRINGS_HE) as RunStringKey[])
        .filter(k => /[A-Za-z]/.test(RUN_STRINGS_HE[k].replace(/\{\w+\}/g, '')));
      expect(untranslated).toEqual([]);
    });
  });

  describe('runChromeLang', () => {
    it('is English ONLY for an explicitly English tag', () => {
      expect(runChromeLang('en')).toBe('en');
      expect(runChromeLang('en-US')).toBe('en');
      expect(runChromeLang('  EN  ')).toBe('en');
    });

    it('defaults to Hebrew for Hebrew, blank, null, and any other language', () => {
      expect(runChromeLang('he')).toBe('he');
      expect(runChromeLang('he-IL')).toBe('he');
      expect(runChromeLang('')).toBe('he');
      expect(runChromeLang('   ')).toBe('he');
      expect(runChromeLang(null)).toBe('he');
      expect(runChromeLang(undefined)).toBe('he');
      // A third language gets Hebrew chrome on EVERY surface rather than English on one of them: this
      // is the same rule the dialog's chromeLang and the panel's panelLang already apply.
      expect(runChromeLang('fr')).toBe('he');
    });
  });

  describe('runString interpolation', () => {
    it('substitutes every named placeholder', () => {
      expect(runString('en', 'progressCompleted', { type: 'Proofread', completed: 3, total: 10 }))
        .toBe('Proofread: 3 of 10 completed');
      expect(runString('he', 'progressCompleted', { type: 'הגהה', completed: 3, total: 10 }))
        .toBe('הגהה: 3 מתוך 10 הושלמו');
    });

    it('leaves an UNKNOWN placeholder verbatim rather than blanking it', () => {
      // A visible `{total}` is a bug report; a silent hole in the sentence is not.
      expect(runString('en', 'progressCompleted', { type: 'Proofread', completed: 3 }))
        .toBe('Proofread: 3 of {total} completed');
    });

    it('returns the template untouched when no params are given', () => {
      expect(runString('en', 'analysisFailed')).toBe(RUN_STRINGS_EN['analysisFailed']);
      expect(runString('he', 'analysisFailed')).toBe(RUN_STRINGS_HE['analysisFailed']);
    });
  });

  describe('analysisTypeLabelFor', () => {
    it('reads the SHARED analysis-type label source in both languages', () => {
      expect(analysisTypeLabelFor('en', 'LineEdit')).toBe('Line Edit');
      expect(analysisTypeLabelFor('he', 'LineEdit')).toBe('עריכת שורה');
      expect(analysisTypeLabelFor('he', 'Proofread')).toBe('הגהה');
    });

    it('falls back to the localized generic name for an absent or unknown type', () => {
      expect(analysisTypeLabelFor('en', '')).toBe('Analysis');
      expect(analysisTypeLabelFor('en', null)).toBe('Analysis');
      expect(analysisTypeLabelFor('he', 'NoSuchType')).toBe('ניתוח');
    });
  });

  describe('formatRunDurationLabel', () => {
    it('renders seconds under a minute, in the chrome language', () => {
      expect(formatRunDurationLabel('en', 5_000)).toBe('5s');
      expect(formatRunDurationLabel('he', 5_000)).toBe('5 שניות');
    });

    it('renders whole minutes and minutes+seconds', () => {
      expect(formatRunDurationLabel('en', 120_000)).toBe('2m');
      expect(formatRunDurationLabel('en', 90_000)).toBe('1m 30s');
      expect(formatRunDurationLabel('he', 120_000)).toBe('2 דקות');
      // 90s is 1 MINUTE 30 seconds: the minutes part is singular ("דקה", never "1 דקות").
      expect(formatRunDurationLabel('he', 90_000)).toBe('דקה ו-30 שניות');
    });

    it('never renders a negative duration', () => {
      expect(formatRunDurationLabel('en', -10_000)).toBe('0s');
    });

    it('puts NO Latin letters in the Hebrew duration label (the defect: "זמן ריצה: 5s")', () => {
      expect(formatRunDurationLabel('he', 5_000)).not.toMatch(/[A-Za-z]/);
      expect(formatRunDurationLabel('he', 90_000)).not.toMatch(/[A-Za-z]/);
    });

    // f01. MEASURED IN THE BROWSER on :4201: a real run rendered "זמן ריצה: 1 דקות ו-24 שניות". A
    // single minute is "דקה", not "1 דקות", and the same rule applies to a single second - so every
    // bucket where either part is exactly 1 needs its own singular string rather than falling through
    // to the plural template with a bare "1" spliced in.
    describe('singular minute / second forms (f01)', () => {
      it('exactly 1 second: singular, no bare "1" before a plural noun', () => {
        expect(formatRunDurationLabel('en', 1_000)).toBe('1s');
        expect(formatRunDurationLabel('he', 1_000)).toBe('שנייה');
        expect(formatRunDurationLabel('he', 1_000)).not.toMatch(/^1 /);
      });

      it('exactly 1 minute, no seconds: singular, no bare "1" before a plural noun', () => {
        expect(formatRunDurationLabel('en', 60_000)).toBe('1m');
        expect(formatRunDurationLabel('he', 60_000)).toBe('דקה');
        expect(formatRunDurationLabel('he', 60_000)).not.toMatch(/^1 /);
      });

      it('exactly 1 minute 1 second: BOTH parts singular', () => {
        expect(formatRunDurationLabel('en', 61_000)).toBe('1m 1s');
        expect(formatRunDurationLabel('he', 61_000)).toBe('דקה ושנייה');
        expect(formatRunDurationLabel('he', 61_000)).not.toMatch(/\d+ (דקות|שניות)/);
      });

      it('1 minute 24 seconds: the EXACT measured defect ("1 דקות ו-24 שניות")', () => {
        expect(formatRunDurationLabel('en', 84_000)).toBe('1m 24s');
        expect(formatRunDurationLabel('he', 84_000)).toBe('דקה ו-24 שניות');
        expect(formatRunDurationLabel('he', 84_000)).not.toContain('1 דקות');
      });

      it('2 minutes, no seconds: PLURAL is correct here, unlike 1 minute', () => {
        expect(formatRunDurationLabel('en', 120_000)).toBe('2m');
        expect(formatRunDurationLabel('he', 120_000)).toBe('2 דקות');
      });

      it('no bucket renders a plural noun immediately after a bare "1"', () => {
        // Sweep every second in the first two minutes: whenever the rendered Hebrew string starts with
        // a literal "1 " (a bare digit-one followed by a space), the noun after it must NOT be the
        // plural "דקות" / "שניות" - it must have gone through a singular key instead.
        for (let s = 0; s <= 150; s++) {
          const label = formatRunDurationLabel('he', s * 1000);
          if (/^1 /.test(label)) {
            expect(label)
              .withContext(`${s}s -> "${label}"`)
              .not.toMatch(/^1 (דקות|שניות)/);
          }
        }
      });
    });
  });

  // c04. The number is an extrapolation from observed throughput, so the RENDERING has two jobs: keep
  // it coarse enough that it cannot read as a countdown, and make the hedge impossible to omit.
  describe('formatEtaLabel (c04)', () => {
    it('says "less than a minute" rather than a bare 0 for anything under a minute', () => {
      expect(formatEtaLabel('en', 0)).toBe('Estimated time remaining: less than a minute');
      expect(formatEtaLabel('en', 45_000)).toBe('Estimated time remaining: less than a minute');
      expect(formatEtaLabel('he', 45_000)).toBe('זמן משוער שנותר: פחות מדקה');
    });

    it('rounds UP to whole minutes, so the estimate under-promises rather than over-promises', () => {
      expect(formatEtaLabel('en', 60_000)).toBe('Estimated time remaining: about 1 minute');
      // 3m20s becomes "about 4 minutes", never "3 minutes 20 seconds": false precision on an
      // extrapolation reads as a commitment.
      expect(formatEtaLabel('en', 200_000)).toBe('Estimated time remaining: about 4 minutes');
      expect(formatEtaLabel('he', 200_000)).toBe('זמן משוער שנותר: כ-4 דקות');
    });

    it('switches to whole hours for a long run', () => {
      expect(formatEtaLabel('en', 90 * 60_000)).toBe('Estimated time remaining: about 2 hours');
      expect(formatEtaLabel('he', 90 * 60_000)).toBe('זמן משוער שנותר: כ-2 שעות');
      expect(formatEtaLabel('en', 200 * 60_000)).toBe('Estimated time remaining: about 3 hours');
    });

    it('the hours bucket has NO singular form to reach: 89 minutes is still minutes, 90 is 2 hours', () => {
      // This is why there is deliberately no `etaHour` key. The minutes bucket runs to 89 (so a
      // 61-to-89-minute wait is never over-promised as "about 1 hour"), and the hours bucket therefore
      // opens at 90 minutes, which rounds to 2. Sweeping the whole boundary region proves the singular
      // is unreachable rather than merely untested - if someone lowers the ceiling, this goes RED and
      // tells them the missing key is now needed.
      expect(formatEtaLabel('en', 89 * 60_000)).toBe('Estimated time remaining: about 89 minutes');
      for (let minutes = 1; minutes <= 240; minutes++) {
        expect(formatEtaLabel('en', minutes * 60_000))
          .withContext(`${minutes} minutes`)
          .not.toBe('Estimated time remaining: about 1 hour');
      }
    });

    it('EVERY bucket carries the estimate hedge, in both languages', () => {
      // The requirement is that the number can never be rendered bare. Asserting it per-bucket rather
      // than on the map is the point: a future bucket added to `formatEtaLabel` that reaches for a plain
      // duration string would slip past a map-level check.
      const buckets = [0, 45_000, 60_000, 200_000, 90 * 60_000, 200 * 60_000];
      for (const ms of buckets) {
        expect(formatEtaLabel('en', ms))
          .withContext(`en, ${ms}ms`)
          .toMatch(/Estimated time remaining: (about|less than)/);
        expect(formatEtaLabel('he', ms))
          .withContext(`he, ${ms}ms`)
          .toMatch(/^זמן משוער שנותר: /);
        expect(formatEtaLabel('he', ms))
          .withContext(`he, ${ms}ms, must contain no Latin chrome`)
          .not.toMatch(/[A-Za-z]/);
      }
    });

    it('never renders a negative estimate', () => {
      expect(formatEtaLabel('en', -5_000)).toBe('Estimated time remaining: less than a minute');
    });
  });
});
