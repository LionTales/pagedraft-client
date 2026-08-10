/**
 * Timezone-aware relative-time formatting for UTC ISO timestamps from the API.
 *
 * The page conventions forbid the raw Angular `| date` pipe (it is not timezone-aware in the way the
 * product needs and produces no relative phrasing). This helper:
 *   - parses a UTC ISO string,
 *   - renders a localized relative phrase ("3 minutes ago" / "לפני 3 דקות") for recent times, and
 *   - falls back to a localized ABSOLUTE date+time in the viewer's local timezone for older times
 *     (via Intl/toLocaleString, which is timezone-aware).
 *
 * he/en parity. No em-dash in any user-facing string.
 *
 * DRAFT: the Hebrew relative-time strings below require native-speaker validation before release.
 */

export type RelativeTimeLang = 'he' | 'en';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Returns a localized "updated <relative time>" value for an ISO (UTC) timestamp.
 * Falls back to the absolute, locale+timezone-aware date for timestamps older than ~7 days, or when
 * the timestamp is missing/unparseable (returns an empty string in that last case).
 */
export function formatRelativeTime(
  isoUtc: string | null | undefined,
  lang: RelativeTimeLang = 'he',
  now: Date = new Date()
): string {
  if (!isoUtc) return '';
  const then = new Date(isoUtc);
  const t = then.getTime();
  if (!Number.isFinite(t)) return '';

  const locale = lang === 'he' ? 'he-IL' : 'en-US';
  const diffMs = now.getTime() - t;

  // Just-now window: avoid "0 seconds ago" awkwardness.
  if (diffMs >= 0 && diffMs < MINUTE_MS) {
    return lang === 'he' ? 'הרגע' : 'just now';
  }

  // Older than a week (or in the future): show the absolute local date+time.
  if (diffMs < 0 || diffMs >= WEEK_MS) {
    return then.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Pick the largest sensible unit and floor to it. The unit and its divisor are derived from the
  // SAME threshold, so a value never "spills" into a unit it has not actually reached (e.g. 557
  // minutes -> 9 hours, not 557 minutes).
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (diffMs < HOUR_MS) {
    value = Math.floor(diffMs / MINUTE_MS);
    unit = 'minute';
  } else if (diffMs < DAY_MS) {
    value = Math.floor(diffMs / HOUR_MS);
    unit = 'hour';
  } else {
    value = Math.floor(diffMs / DAY_MS);
    unit = 'day';
  }
  // NIT 71, verified live: this Chrome's he-IL ICU data appends a stray literal-value parenthetical to
  // the special (non-standard-count) plural forms - `rtf.format(-1, 'minute')` returns "לפני דקה (1)"
  // and `rtf.format(-2, 'hour')` returns "לפני שעתיים (2)" - while the ordinary plural forms (3+) and
  // the day unit's own special words ("אתמול", "שלשום") are clean. Node's ICU on the same Intl call does
  // NOT reproduce it, so this is a browser/ICU quirk in the formatter's output, not a real CLDR phrase -
  // strip it rather than reformat, so the fix tracks whichever values this Chrome's ICU affects instead
  // of hand-listing them.
  return rtf.format(-value, unit).replace(/\s*\(\d+\)\s*$/, '');
}
