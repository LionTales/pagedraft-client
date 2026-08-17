/**
 * feedback-strings invariants (Show C2, c2-client).
 *
 * Map-level assertions, on the same pattern as `history-strings.spec.ts` and for the same stated reason:
 * a map can be perfectly localized and never be read by the surface that renders it, so the rendered-DOM
 * counterparts live in `shared/feedback-widget/feedback-widget.component.spec.ts` and
 * `features/feedback-triage/feedback-triage.component.spec.ts`.
 */
import {
  FEEDBACK_STRINGS_EN,
  FEEDBACK_STRINGS_HE,
  FeedbackStringKey,
  evidenceUnavailableLabel,
  feedbackStatusLabel,
  feedbackString,
  feedbackVerdictLabel,
  noteCounterLabel,
} from './feedback-strings';
import { FEEDBACK_STATUSES, FEEDBACK_TEXT_MAX } from '../models/feedback';

describe('feedback-strings (Show C2)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(FEEDBACK_STRINGS_HE).sort()).toEqual(Object.keys(FEEDBACK_STRINGS_EN).sort());
      // Non-vacuity: an empty pair of maps would satisfy every claim in this describe.
      expect(Object.keys(FEEDBACK_STRINGS_HE).length).toBeGreaterThan(40);
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(FEEDBACK_STRINGS_HE), ...Object.entries(FEEDBACK_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(FEEDBACK_STRINGS_HE), ...Object.entries(FEEDBACK_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('the Hebrew strings really ARE Hebrew (no untranslated English left in the map)', () => {
      const untranslated = (Object.keys(FEEDBACK_STRINGS_HE) as FeedbackStringKey[])
        .filter(k => /[A-Za-z]/.test(FEEDBACK_STRINGS_HE[k]));
      expect(untranslated).toEqual([]);
    });
  });

  describe('the wire vocabulary never reaches a reader', () => {
    it('renders every STATUS token as a word, in both languages', () => {
      // The tokens (`New`, `ConfirmedBug`, ...) are stored values, not copy. `feedbackStatusLabel` is the
      // only path a status takes into a template, so a status can never be rendered raw by accident.
      for (const status of FEEDBACK_STATUSES) {
        expect(feedbackStatusLabel('he', status))
          .withContext(`${status} must have Hebrew copy`)
          .not.toBe(status);
        expect(feedbackStatusLabel('en', status).trim()).not.toBe('');
      }
      // Non-vacuity: the loop above is meaningless if the vocabulary is empty.
      expect(FEEDBACK_STATUSES.length).toBe(5);
    });

    it('renders both VERDICTS as words', () => {
      expect(feedbackVerdictLabel('he', 'up')).toBe(FEEDBACK_STRINGS_HE['verdictUp']);
      expect(feedbackVerdictLabel('he', 'down')).toBe(FEEDBACK_STRINGS_HE['verdictDown']);
      expect(feedbackVerdictLabel('en', 'down')).toBe('Did not help');
    });

    it('falls back to the RAW token for a value this client does not know', () => {
      // Same rule the citation chips follow for an unknown guide: a server that grows a third verdict or
      // a sixth status should degrade to showing what it said, never to a blank cell that hides a row's
      // whole point.
      expect(feedbackVerdictLabel('he', 'sideways')).toBe('sideways');
      expect(feedbackStatusLabel('en', 'Escalated')).toBe('Escalated');
      expect(feedbackStatusLabel('en', null)).toBe('');
    });
  });

  describe('the three evidence-unavailable reasons are worded APART', () => {
    it('gives each reason its own sentence, because only one of them is a defect', () => {
      // `targetDeleted` is d1 working as designed (the row was kept on purpose), `targetMissing` is a row
      // that vanished without going through a delete path and is worth investigating, and
      // `targetTypeNotComposable` is a mount with no composer yet. Collapsing them would hide the only
      // one the owner has to act on.
      const deleted = evidenceUnavailableLabel('en', 'targetDeleted');
      const missing = evidenceUnavailableLabel('en', 'targetMissing');
      const notComposable = evidenceUnavailableLabel('en', 'targetTypeNotComposable');
      expect(new Set([deleted, missing, notComposable]).size).toBe(3);
      expect(deleted).toMatch(/deleted/i);
      expect(missing).toMatch(/never tombstoned|worth a look/i);
    });

    it('has a generic sentence for a reason it does not recognize', () => {
      expect(evidenceUnavailableLabel('he', 'somethingNew'))
        .toBe(FEEDBACK_STRINGS_HE['evidenceUnavailable']);
      expect(evidenceUnavailableLabel('he', null))
        .toBe(FEEDBACK_STRINGS_HE['evidenceUnavailable']);
    });
  });

  describe('the note counter', () => {
    it('names the SERVER cap, because the server rejects rather than truncates', () => {
      const label = noteCounterLabel('en', 12);
      expect(label).toContain('12');
      expect(label).toContain(String(FEEDBACK_TEXT_MAX));
      expect(label).not.toContain('{0}');
      expect(label).not.toContain('{1}');
    });
  });

  describe('feedbackString', () => {
    it('resolves from the requested language map', () => {
      expect(feedbackString('he', 'triageTitle')).toBe(FEEDBACK_STRINGS_HE['triageTitle']);
      expect(feedbackString('en', 'triageTitle')).toBe('Feedback');
    });
  });

  describe('the privacy sentence is on the surface, not only in a doc', () => {
    it('says the evidence does not leave the database, in both languages', () => {
      // The triage view renders this. Whoever adds an export affordance has to delete this line first,
      // which is the point of it being copy rather than a comment.
      expect(FEEDBACK_STRINGS_EN['triagePrivacy']).toMatch(/never leaves|read here/i);
      expect(FEEDBACK_STRINGS_HE['triagePrivacy']).toMatch(/אינן יוצאות|כאן בלבד/);
    });
  });
});
