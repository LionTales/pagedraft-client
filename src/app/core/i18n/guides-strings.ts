/**
 * Every user-facing string the guides reader can put on screen (chatbot phase A.2, c1).
 *
 * ── Language ───────────────────────────────────────────────────────────────────────────────────────
 * Same shape and same conventions as `chat-strings.ts` and `dock-strings.ts`: {@link GuidesStringKey}
 * is a CLOSED union so a typo'd key is a compile error rather than user-facing chrome, and both maps
 * are `Record<GuidesStringKey, string>` so a key added to one language fails the build until the other
 * has it too.
 *
 * The reader is APP-LEVEL chrome, so it is HEBREW-DEFAULT like the dock. It differs from the dock in
 * one way that is forced by the content: the corpus is bilingual and the two sides are separately
 * authored files, so the reader carries its own LANGUAGE TOGGLE, and that toggle moves the chrome and
 * the document together. There is still no global i18n service in this app (`appLang` is hardcoded
 * `'he'` wherever it appears), so this toggle is local to the reader by necessity as well as by
 * design; when a global service arrives, the reader's initial language should come from it and the
 * toggle should stay.
 *
 * Hebrew here is DRAFT and needs native-speaker review. No em-dash in any user-facing string; both are
 * pinned by `guides-strings.spec.ts`.
 *
 * ── Stage labels ───────────────────────────────────────────────────────────────────────────────────
 * {@link stageLabel} names the frontmatter `stage` values the corpus actually ships. It falls back to
 * the raw stage for anything it has not heard of, on the same reasoning as `guideTitle`'s fallback in
 * `chat-strings.ts`: a stage this build does not know is still a real group of real documents, and
 * hiding it would hide guides. This map is a CROSS-REPO MIRROR of the `stage:` frontmatter values in
 * `Pagedraft.Api/Content/guides/*.md`; adding a stage there without adding it here degrades to the raw
 * slug rather than breaking. The server side of that mirror is pinned (w6/c03) by
 * `Pagedraft.Api.Tests/ProductChatCorpusTests.EveryShippedGuidesIdAndStage_IsWhatTheClientsStageGuideAndStageLabelMapsMirror`,
 * which fails on the PR that renames or adds a stage. It pins the corpus's own set; it does not read
 * this map, so the labels below are still checked only by `guides-strings.spec.ts`.
 */

import type { ChatChromeLang } from './chat-strings';

/** The reader renders in the same two chrome languages as the rest of the app-level chrome. */
export type GuidesChromeLang = ChatChromeLang;

/** Every string the guides index and reader can show. Closed on purpose. */
export type GuidesStringKey =
  // ── the affordance that opens the reader, wherever it is mounted ──
  | 'helpLink'
  | 'helpLinkAria'
  // ── index page ──
  | 'indexTitle'
  | 'indexIntro'
  | 'loading'
  | 'indexEmpty'
  // ── reader page ──
  | 'backToIndex'
  | 'updatedPrefix'
  | 'languageToggleLabel'
  | 'readInHebrew'
  | 'readInEnglish'
  // ── failure states, distinct because they are different facts ──
  | 'loadFailedTitle'
  | 'loadFailedBody'
  | 'corpusUnavailable'
  | 'guideNotFoundTitle'
  | 'guideNotFoundBody'
  | 'guideLanguageUnavailableTitle'
  | 'guideLanguageUnavailableBody'
  | 'retry';

/** Hebrew guides chrome. DRAFT he - needs native review. */
export const GUIDES_STRINGS_HE: Record<GuidesStringKey, string> = {
  helpLink:      'מדריכים',                                    // DRAFT he - needs native review
  helpLinkAria:  'פתיחת מדריכי המערכת',                        // DRAFT he - needs native review

  indexTitle:    'מדריכי המערכת',                              // DRAFT he - needs native review
  indexIntro:    'אלה המדריכים שמהם שואו עונה. אפשר לקרוא אותם כאן ישירות.',  // DRAFT he - needs native review
  loading:       'טוען...',                                    // DRAFT he - needs native review
  indexEmpty:    'אין מדריכים להצגה.',                          // DRAFT he - needs native review

  backToIndex:   'חזרה לרשימת המדריכים',                        // DRAFT he - needs native review
  updatedPrefix: 'עודכן',                                       // DRAFT he - needs native review
  languageToggleLabel: 'שפת המדריך',                            // DRAFT he - needs native review
  readInHebrew:  'עברית',
  readInEnglish: 'אנגלית',                                      // DRAFT he - needs native review

  loadFailedTitle: 'לא הצלחתי לטעון את המדריכים',               // DRAFT he - needs native review
  loadFailedBody:  'לא הצלחתי להגיע לשרת. בדקו את החיבור ונסו שוב.',  // DRAFT he - needs native review
  corpusUnavailable: 'המדריכים לא נמצאו בשרת הזה. זו תקלה בהתקנה, לא חוסר בתוכן.',  // DRAFT he - needs native review
  guideNotFoundTitle: 'המדריך הזה לא קיים',                     // DRAFT he - needs native review
  guideNotFoundBody:  'ייתכן שהוא הוחלף או שונה שמו. הרשימה המלאה נמצאת בדף המדריכים.',  // DRAFT he - needs native review
  guideLanguageUnavailableTitle: 'המדריך הזה עדיין לא קיים בעברית',  // DRAFT he - needs native review
  guideLanguageUnavailableBody:  'אפשר לקרוא אותו באנגלית.',    // DRAFT he - needs native review
  retry:         'ניסיון חוזר',
};

export const GUIDES_STRINGS_EN: Record<GuidesStringKey, string> = {
  helpLink:      'Guides',
  helpLinkAria:  'Open the product guides',

  indexTitle:    'Product guides',
  indexIntro:    'These are the guides Show answers from. You can read them here directly.',
  loading:       'Loading...',
  indexEmpty:    'There are no guides to show.',

  backToIndex:   'Back to the guides',
  updatedPrefix: 'Updated',
  languageToggleLabel: 'Guide language',
  readInHebrew:  'Hebrew',
  readInEnglish: 'English',

  loadFailedTitle: 'I could not load the guides',
  loadFailedBody:  'I could not reach the server. Check the connection and try again.',
  corpusUnavailable: 'The guides are not present on this server. That is an install problem, not missing content.',
  guideNotFoundTitle: 'That guide does not exist',
  guideNotFoundBody:  'It may have been replaced or renamed. The full list is on the guides page.',
  guideLanguageUnavailableTitle: 'That guide is not in Hebrew yet',
  guideLanguageUnavailableBody:  'You can read it in English.',
  retry:         'Try again',
};

/** Resolve one guides string in the given chrome language. */
export function guidesString(lang: GuidesChromeLang, key: GuidesStringKey): string {
  return (lang === 'he' ? GUIDES_STRINGS_HE : GUIDES_STRINGS_EN)[key];
}

/**
 * Display names for the frontmatter `stage` values the shipped corpus uses. See the file docstring for
 * why an unknown stage degrades to its raw slug rather than being dropped.
 *
 * `index` is present but is NOT rendered as a group: the corpus's own index document (README.md) is a
 * table of links between markdown FILES, which is exactly what the page listing these stages already
 * is, in a form that works. See `HelpIndexComponent`.
 */
const STAGE_LABELS_HE: Record<string, string> = {
  overview:            'סקירה',                    // DRAFT he - needs native review
  import:              'ייבוא',                    // DRAFT he - needs native review
  'book-intelligence': 'הכנת הספר',                // DRAFT he - needs native review
  // THE CANONICAL STAGE NAME, not a draft: `stage-spine.copy.ts`'s `STAGE_NAMES` is the owner-dictated,
  // native-swept source (2026-08-11) and this index heading is the same stage under a second name.
  // `stage-label-agreement.spec.ts` pins the two together.
  'chapter-editing':   'עריכת פרק',                // canonical - see STAGE_NAMES
  'whole-book-review': 'עריכה התפתחותית',          // DRAFT he - needs native review
  export:              'ייצוא',                    // DRAFT he - needs native review
  faq:                 'שאלות נפוצות',             // DRAFT he - needs native review
  index:               'תוכן העניינים',            // DRAFT he - needs native review
};

const STAGE_LABELS_EN: Record<string, string> = {
  overview:            'Overview',
  import:              'Import',
  'book-intelligence': 'Book setup',
  // Canonical, for the same reason as its Hebrew twin: this is the stage the spine calls
  // "Chapter editing passes", and the index heading is a second rendering of that one name.
  'chapter-editing':   'Chapter editing passes',
  'whole-book-review': 'Developmental review',
  export:              'Export',
  faq:                 'Questions',
  index:               'Contents',
};

/** The display name of a stage, falling back to the raw slug for a stage this build has not heard of. */
export function stageLabel(lang: GuidesChromeLang, stage: string): string {
  const map = lang === 'he' ? STAGE_LABELS_HE : STAGE_LABELS_EN;
  return map[stage] ?? stage;
}

/**
 * The frontmatter `updated` value, rendered for reading.
 *
 * The value is a plain CALENDAR DATE (`2026-08-06`) with no time and no timezone, so it is formatted
 * in UTC deliberately: `new Date('2026-08-06')` is midnight UTC, and letting the viewer's local
 * timezone shift it would show the day before to anyone west of Greenwich. That is the timezone-aware
 * handling this value needs - it is not an instant, so converting it to one would be the bug. The
 * repo's `formatRelativeTime` is for real UTC timestamps and is deliberately not used here; the raw
 * Angular `| date` pipe is forbidden by the page conventions.
 *
 * Returns an empty string for a missing or unparseable value, so a guide with no stamp simply shows no
 * stamp rather than "Invalid Date".
 */
export function formatGuideDate(value: string | null | undefined, lang: GuidesChromeLang): string {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
