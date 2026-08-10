import { formatRelativeTime } from './relative-time';

// A fixed clock so the relative phrasing is deterministic regardless of when the suite runs.
const NOW = new Date('2026-06-22T12:00:00.000Z');

/** Build an ISO UTC string `minutes` before NOW. */
function isoMinutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

describe('formatRelativeTime', () => {
  // ---------------------------------------------------------------------------
  // Roll-up regression: ~9.3h must read as hours, NOT 557 minutes.
  // ---------------------------------------------------------------------------
  describe('unit roll-up (557 minutes ~= 9.3h)', () => {
    const iso = () => isoMinutesAgo(557); // 557 / 60 = 9.28 -> floor 9 hours

    it('rolls 557 minutes up to a 9-hour phrase (en)', () => {
      const out = formatRelativeTime(iso(), 'en', NOW);
      expect(out).toContain('9');
      expect(out).toContain('hour');
      // Must NOT regress to the minutes phrasing.
      expect(out).not.toContain('minute');
      expect(out).not.toContain('557');
    });

    it('rolls 557 minutes up to a 9-hour phrase (he)', () => {
      const out = formatRelativeTime(iso(), 'he', NOW);
      expect(out).toContain('9');
      expect(out).toContain('שעות');
      expect(out).not.toContain('557');
      expect(out).not.toContain('דקות');
    });
  });

  // ---------------------------------------------------------------------------
  // Each in-between band selects the largest sensible unit.
  // ---------------------------------------------------------------------------
  describe('largest-sensible-unit selection', () => {
    it('< 1 hour stays in minutes (en)', () => {
      const out = formatRelativeTime(isoMinutesAgo(45), 'en', NOW);
      expect(out).toContain('45');
      expect(out).toContain('minute');
    });

    it('~2 days reads in days (en)', () => {
      const out = formatRelativeTime(isoMinutesAgo(2 * 24 * 60 + 30), 'en', NOW); // 2 days + 30 min
      expect(out).toContain('2');
      expect(out).toContain('day');
      expect(out).not.toContain('hour');
    });

    // 3 days avoids the he-IL numeric:'auto' special case for 2-days-ago ("שלשום"), confirming the
    // day band is selected with an explicit numeric value in both locales.
    it('~3 days reads in days (en)', () => {
      const out = formatRelativeTime(isoMinutesAgo(3 * 24 * 60 + 30), 'en', NOW); // 3 days + 30 min
      expect(out).toContain('3');
      expect(out).toContain('day');
      expect(out).not.toContain('hour');
    });

    it('~3 days reads in days (he)', () => {
      const out = formatRelativeTime(isoMinutesAgo(3 * 24 * 60 + 30), 'he', NOW);
      expect(out).toContain('3');
      expect(out).toContain('ימים');
    });
  });

  // ---------------------------------------------------------------------------
  // NIT 71, found live: this Chrome's he-IL Intl.RelativeTimeFormat appends a stray literal-value
  // parenthetical to the special (non-standard-count) plural forms - "לפני דקה (1)", "לפני שעתיים (2)" -
  // while the ordinary plural forms are clean. Assert no such artifact ever reaches the rendered string,
  // for every value/unit combination this file's own unit-selection can produce.
  // ---------------------------------------------------------------------------
  describe('no stray parenthetical artifact (NIT 71)', () => {
    it('1 minute ago (he) carries no "(1)" artifact', () => {
      const out = formatRelativeTime(isoMinutesAgo(1), 'he', NOW);
      expect(out).not.toMatch(/\(\d+\)/);
      expect(out).toContain('דקה');
    });

    it('1 hour ago (he) carries no "(1)" artifact', () => {
      const out = formatRelativeTime(isoMinutesAgo(60), 'he', NOW);
      expect(out).not.toMatch(/\(\d+\)/);
      expect(out).toContain('שעה');
    });

    it('2 hours ago (he) carries no "(2)" artifact', () => {
      const out = formatRelativeTime(isoMinutesAgo(120), 'he', NOW);
      expect(out).not.toMatch(/\(\d+\)/);
    });

    it('3 minutes ago (he) stays clean (already unaffected, guards the regex is not too broad)', () => {
      const out = formatRelativeTime(isoMinutesAgo(3), 'he', NOW);
      expect(out).toBe('לפני 3 דקות');
    });

    it('4 days ago (he) stays clean (already unaffected)', () => {
      const out = formatRelativeTime(isoMinutesAgo(4 * 24 * 60), 'he', NOW);
      expect(out).not.toMatch(/\(\d+\)/);
      expect(out).toContain('4');
    });
  });

  // ---------------------------------------------------------------------------
  // Just-now window (< 60s).
  // ---------------------------------------------------------------------------
  describe('just-now window', () => {
    it('returns "just now" for < 60s (en)', () => {
      const iso = new Date(NOW.getTime() - 30 * 1000).toISOString();
      expect(formatRelativeTime(iso, 'en', NOW)).toBe('just now');
    });

    it('returns "הרגע" for < 60s (he)', () => {
      const iso = new Date(NOW.getTime() - 30 * 1000).toISOString();
      expect(formatRelativeTime(iso, 'he', NOW)).toBe('הרגע');
    });
  });

  // ---------------------------------------------------------------------------
  // > 7 days falls back to an absolute local date+time (not a relative phrase).
  // ---------------------------------------------------------------------------
  describe('absolute fallback for old timestamps', () => {
    it('falls back to an absolute date (contains the year) for > 7 days (en)', () => {
      const iso = isoMinutesAgo(10 * 24 * 60); // 10 days ago
      const out = formatRelativeTime(iso, 'en', NOW);
      // Absolute date, not a relative phrase.
      expect(out).toContain('2026');
      expect(out).not.toContain('ago');
      expect(out).not.toContain('day');
    });

    it('falls back to an absolute date for > 7 days (he)', () => {
      const iso = isoMinutesAgo(10 * 24 * 60);
      const out = formatRelativeTime(iso, 'he', NOW);
      expect(out).toContain('2026');
      expect(out).not.toContain('לפני');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty / unparseable inputs.
  // ---------------------------------------------------------------------------
  describe('missing / unparseable input', () => {
    it('returns empty string for null', () => {
      expect(formatRelativeTime(null, 'en', NOW)).toBe('');
    });

    it('returns empty string for an unparseable string', () => {
      expect(formatRelativeTime('not a date', 'en', NOW)).toBe('');
    });
  });
});
