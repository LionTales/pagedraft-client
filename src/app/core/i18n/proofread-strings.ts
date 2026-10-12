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
 * c6: NO string here composes an ETA. f2 had `consentBody` take `formatEtaLabel` output as `{eta}`, but
 * that function returns a whole sentence ("Estimated time remaining: about 3 minutes"), so the composed
 * copy read "and take about Estimated time remaining: ...". The row renders `formatEtaLabel` (run-strings.ts)
 * as its OWN line instead, so it and the run dialog still never disagree on how a duration reads.
 *
 * c8: the consent's ETA is now the SERVER's estimate off the status read (c7), rendered the same way, so
 * the old pace line ("an estimate appears once the run starts") is gone: it stopped being true.
 *
 * Hebrew is DRAFT and needs native-speaker review. No em-dash in any user-facing string.
 */

/** Every string the whole-book proofread row can show. Closed on purpose: a typo'd key does not compile. */
export type ProofreadStringKey =
  // ── idle ──
  | 'title'
  | 'idleHint'
  | 'startButton'
  // c6: the forced re-run, offered only when every chapter is already fresh.
  | 'runAgainButton'
  | 'coverage'
  | 'lastRun'
  | 'needsImport'
  | 'needsText'
  // ── consent (shows the plan before any model time is spent) ──
  | 'consentTitle'
  | 'consentBody'
  | 'consentSkipped'
  | 'consentRerun'
  | 'consentConfirm'
  | 'consentDismiss'
  | 'nothingToDo'
  // ── running ──
  | 'running'
  | 'cancelButton'
  | 'cancelling'
  | 'startFailed'
  | 'cancelFailed'
  // ── terminals ──
  | 'doneSummary'
  | 'failed'
  | 'partial'
  | 'canceled'
  | 'downloadLink'
  // ── freshness ──
  | 'staleNote'
  // c6 gate: the singular of every count a one-chapter book or a one-chapter run can reach. The plural
  // template read '1 chapters will be skipped' / '1 פרקים הוגהו'. Picked by proofreadCountString.
  | 'consentBodyOne'
  | 'consentSkippedOne'
  | 'doneSummaryOne'
  | 'canceledOne'
  | 'staleNoteOne';

// DRAFT he - needs native review
export const PROOFREAD_STRINGS_HE: Record<ProofreadStringKey, string> = {
  title:          'הגהת ספר שלם',
  idleHint:       'הגהה של כל הפרקים בהרצה אחת, והצעות התיקון נשמרות בכל פרק.',
  startButton:    'הגה את כל הספר',
  runAgainButton: 'הגה שוב את כל הספר',
  coverage:       '{done} מתוך {total} פרקים הוגהו',
  lastRun:        'הגהה אחרונה {when}',
  needsImport:    'אין עדיין פרקים בספר. צריך קודם להעלות כתב יד או להוסיף פרק.',
  needsText:      'הפרקים בספר עדיין ריקים. צריך קודם לכתוב בהם או להעלות כתב יד.',

  consentTitle:   'להגיה את כל הספר?',
  consentBody:    'ההגהה תעבור על {chapters} פרקים, אחד אחרי השני. אפשר להמשיך לעבוד בינתיים.',
  consentSkipped: '{skipped} פרקים שכבר הוגהו ולא השתנו ידולגו.',
  consentRerun:   'כל הפרקים כבר הוגהו. הגהה חוזרת תחליף את הצעות התיקון הקיימות בכל פרק.',
  consentConfirm: 'התחל הגהה',
  consentDismiss: 'ביטול',
  nothingToDo:    'כל הפרקים כבר הוגהו ולא השתנו מאז.',

  running:        'מגיה: {done} מתוך {total} פרקים',
  cancelButton:   'עצור הגהה',
  cancelling:     'עוצר אחרי הפרק הנוכחי...',
  startFailed:    'לא ניתן היה להתחיל את ההגהה. נסו שוב.',
  cancelFailed:   'לא ניתן היה לעצור את ההגהה. נסו שוב.',

  doneSummary:    '{count} פרקים הוגהו',
  failed:         'ההגהה נכשלה. אפשר להפעיל אותה שוב והפרקים שכבר הוגהו ידולגו.',
  partial:        'ההגהה הסתיימה חלקית: {done} מתוך {total} פרקים הוגהו.',
  canceled:       'ההגהה נעצרה. {done} פרקים הוגהו ונשמרו.',
  downloadLink:   'הורד קובץ DOCX עם הצעות התיקון',

  staleNote:      '{count} פרקים נערכו מאז ההגהה האחרונה.',

  // DRAFT he - needs native review
  consentBodyOne:    'ההגהה תעבור על פרק אחד. אפשר להמשיך לעבוד בינתיים.',
  consentSkippedOne: 'פרק אחד שכבר הוגה ולא השתנה ידולג.',
  doneSummaryOne:    'פרק אחד הוגה',
  canceledOne:       'ההגהה נעצרה. פרק אחד הוגה ונשמר.',
  staleNoteOne:      'פרק אחד נערך מאז ההגהה האחרונה.',
};

export const PROOFREAD_STRINGS_EN: Record<ProofreadStringKey, string> = {
  title:          'Whole-book proofread',
  idleHint:       'Proofread every chapter in one run; the suggestions are saved on each chapter.',
  startButton:    'Proofread the whole book',
  runAgainButton: 'Proofread the whole book again',
  coverage:       '{done} of {total} chapters proofread',
  lastRun:        'Last proofread {when}',
  needsImport:    'This book has no chapters yet. Import a manuscript or add a chapter first.',
  needsText:      'The chapters in this book are still empty. Write in them or import a manuscript first.',

  consentTitle:   'Proofread the whole book?',
  consentBody:    'This will proofread {chapters} chapters, one after another. You can keep working meanwhile.',
  consentSkipped: '{skipped} chapters already proofread and unchanged will be skipped.',
  consentRerun:   'Every chapter is already proofread. Running again replaces the existing suggestions in each chapter.',
  consentConfirm: 'Start proofreading',
  consentDismiss: 'Cancel',
  nothingToDo:    'Every chapter is already proofread and unchanged since.',

  running:        'Proofreading: {done} of {total} chapters',
  cancelButton:   'Stop proofreading',
  cancelling:     'Stopping after the current chapter...',
  startFailed:    'The proofread could not be started. Try again.',
  cancelFailed:   'The proofread could not be stopped. Try again.',

  doneSummary:    '{count} chapters proofread',
  failed:         'The proofread failed. You can run it again and chapters already done will be skipped.',
  partial:        'The proofread finished partially: {done} of {total} chapters done.',
  canceled:       'The proofread was stopped. {done} chapters were proofread and saved.',
  downloadLink:   'Download a DOCX with the suggested changes',

  staleNote:      '{count} chapters were edited since the last proofread.',

  consentBodyOne:    'This will proofread 1 chapter. You can keep working meanwhile.',
  consentSkippedOne: '1 chapter already proofread and unchanged will be skipped.',
  doneSummaryOne:    '1 chapter proofread',
  canceledOne:       'The proofread was stopped. 1 chapter was proofread and saved.',
  staleNoteOne:      '1 chapter was edited since the last proofread.',
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

/** The plural keys that have a singular twin, and that twin. */
export type ProofreadCountKey = 'consentBody' | 'consentSkipped' | 'doneSummary' | 'canceled' | 'staleNote';
const SINGULAR_OF: Record<ProofreadCountKey, ProofreadStringKey> = {
  consentBody: 'consentBodyOne',
  consentSkipped: 'consentSkippedOne',
  doneSummary: 'doneSummaryOne',
  canceled: 'canceledOne',
  staleNote: 'staleNoteOne',
};

/**
 * c6 gate: resolve a chapter-count string, picking the singular at exactly 1 (both languages need it:
 * '1 chapters' and '1 פרקים הוגהו' both read wrong). `params` still carries the count for the plural.
 */
export function proofreadCountString(
  lang: RunChromeLang,
  key: ProofreadCountKey,
  count: number,
  params?: ProofreadStringParams,
): string {
  return proofreadString(lang, count === 1 ? SINGULAR_OF[key] : key, params);
}
