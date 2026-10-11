import { RunChromeLang } from './run-strings';

/**
 * f2 (whole-book proofread): the ONE source of every user-facing string of the book-level proofread
 * status row on the dashboard (c6 renders them). Same pattern as `run-strings.ts`.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────────────────────────
 * {@link ProofreadStringKey} is a CLOSED union, so a typo'd key is a compile error rather than
 * user-facing chrome. Both maps are `Record<ProofreadStringKey, string>`, so a key added to one
 * language fails the build until the other has it too. `proofread-strings.spec.ts` pins parity, no
 * empty value, placeholder parity, genuinely-Hebrew values and no em-dash.
 *
 * The ETA phrase in `consentBody` is NOT composed here: callers pass the output of `formatEtaLabel`
 * (run-strings.ts) as `{eta}`, so the row and the run dialog never disagree on how a duration reads.
 *
 * Hebrew is DRAFT and needs native-speaker review. No em-dash in any user-facing string.
 */

/** Every string the whole-book proofread row can show. Closed on purpose: a typo'd key does not compile. */
export type ProofreadStringKey =
  // ── idle ──
  | 'title'
  | 'idleHint'
  | 'startButton'
  // ── consent (shows the plan before any model time is spent) ──
  | 'consentTitle'
  | 'consentBody'
  | 'consentSkipped'
  | 'consentConfirm'
  | 'consentDismiss'
  | 'nothingToDo'
  // ── running ──
  | 'running'
  | 'cancelButton'
  | 'cancelling'
  // ── terminals ──
  | 'doneSummary'
  | 'failed'
  | 'partial'
  | 'canceled'
  | 'downloadLink'
  // ── freshness ──
  | 'staleNote';

// DRAFT he - needs native review
export const PROOFREAD_STRINGS_HE: Record<ProofreadStringKey, string> = {
  title:          'הגהת ספר שלם',
  idleHint:       'הגהה של כל הפרקים בהרצה אחת, והצעות התיקון נשמרות בכל פרק.',
  startButton:    'הגה את כל הספר',

  consentTitle:   'להגיה את כל הספר?',
  consentBody:    'ההגהה תרוץ על {chapters} פרקים ותארך כ-{eta}. אפשר להמשיך לעבוד בינתיים.',
  consentSkipped: '{skipped} פרקים שכבר הוגהו ולא השתנו ידולגו.',
  consentConfirm: 'התחל הגהה',
  consentDismiss: 'ביטול',
  nothingToDo:    'כל הפרקים כבר הוגהו ולא השתנו מאז.',

  running:        'מגיה: {done} מתוך {total} פרקים',
  cancelButton:   'עצור הגהה',
  cancelling:     'עוצר אחרי הפרק הנוכחי...',

  doneSummary:    '{count} פרקים הוגהו',
  failed:         'ההגהה נכשלה. אפשר להפעיל אותה שוב והפרקים שכבר הוגהו ידולגו.',
  partial:        'ההגהה הסתיימה חלקית: {done} מתוך {total} פרקים הוגהו.',
  canceled:       'ההגהה נעצרה. {done} פרקים הוגהו ונשמרו.',
  downloadLink:   'הורד קובץ DOCX עם הצעות התיקון',

  staleNote:      '{count} פרקים נערכו מאז ההגהה האחרונה.',
};

export const PROOFREAD_STRINGS_EN: Record<ProofreadStringKey, string> = {
  title:          'Whole-book proofread',
  idleHint:       'Proofread every chapter in one run; the suggestions are saved on each chapter.',
  startButton:    'Proofread the whole book',

  consentTitle:   'Proofread the whole book?',
  consentBody:    'This will proofread {chapters} chapters and take about {eta}. You can keep working meanwhile.',
  consentSkipped: '{skipped} chapters already proofread and unchanged will be skipped.',
  consentConfirm: 'Start proofreading',
  consentDismiss: 'Cancel',
  nothingToDo:    'Every chapter is already proofread and unchanged since.',

  running:        'Proofreading: {done} of {total} chapters',
  cancelButton:   'Stop proofreading',
  cancelling:     'Stopping after the current chapter...',

  doneSummary:    '{count} chapters proofread',
  failed:         'The proofread failed. You can run it again and chapters already done will be skipped.',
  partial:        'The proofread finished partially: {done} of {total} chapters done.',
  canceled:       'The proofread was stopped. {done} chapters were proofread and saved.',
  downloadLink:   'Download a DOCX with the suggested changes',

  staleNote:      '{count} chapters were edited since the last proofread.',
};

/** Substitution parameters for a proofread string. Values are stringified as-is. */
export type ProofreadStringParams = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left VERBATIM rather than blanked, so a
 * template/caller mismatch shows up as `{eta}` on screen (and in a test) instead of a sentence with a hole.
 */
function interpolate(template: string, params?: ProofreadStringParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

/** Resolve one proofread string in the given chrome language. */
export function proofreadString(
  lang: RunChromeLang,
  key: ProofreadStringKey,
  params?: ProofreadStringParams,
): string {
  const map = lang === 'he' ? PROOFREAD_STRINGS_HE : PROOFREAD_STRINGS_EN;
  return interpolate(map[key], params);
}
