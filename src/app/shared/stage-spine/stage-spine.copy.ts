import { BehindReason, SpineStageId, StageActionId, StageState, StageStatus } from './stage-spine.model';

/**
 * Wave 3 / w2 - every user-facing string the stage spine renders, in Hebrew and English, in one place.
 *
 * LANGUAGE RULE: the full spine is BOOK-SCOPED chrome, so it follows the BOOK language, not the app
 * default. An English book renders English, left to right, even for a Hebrew-speaking user. (w3's
 * compact variant mounts in app-level chrome, which is Hebrew-default; that is a different rule on a
 * different surface and it reads the same maps.)
 *
 * ALL HEBREW HERE IS DRAFT and is gated on the native-speaker sweep in w8. One specific thing a native
 * reader must confirm: stages 3 and 4 both contain the word עריכה and the pair must not read as one
 * concept.
 *
 * TWO STANDING CONSTRAINTS THIS FILE OBEYS:
 *  - No em-dash and no en-dash anywhere. Plain hyphens, or the sentence is restructured.
 *  - No model, provider, vendor or version identity, ever - including in the `behind` reason for a
 *    cross-configuration rebuild, which is why it says "a different configuration" and not what changed.
 */

export type SpineLang = 'he' | 'en';

/** Resolve a book language code to the two label sets. Anything that is not English renders Hebrew. */
export function spineLang(bookLanguage: string | null | undefined): SpineLang {
  return (bookLanguage ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'he';
}

type Bi = Record<SpineLang, string>;

/** The five stage names. DRAFT he. */
export const STAGE_NAMES: Record<SpineStageId, Bi> = {
  'import': { he: 'ייבוא', en: 'Import' },
  'briefs': { he: 'תקצירי ספר', en: 'Book briefs' },
  'review': { he: 'עריכה התפתחותית', en: 'Developmental review' },
  'chapter-passes': { he: 'מעברי עריכה על פרק', en: 'Chapter editing passes' },
  'export': { he: 'ייצוא', en: 'Export' },
};

/**
 * The ONE state vocabulary, rendered. Note what `behind` is NOT called: not "stale", not "error", not
 * "failed". The user did nothing wrong, they edited their book, and a derived artifact now lags.
 */
export const STATE_LABELS: Record<StageState, Bi> = {
  'blocked': { he: 'חסום', en: 'Blocked' },
  'not-started': { he: 'טרם התחיל', en: 'Not started' },
  'running': { he: 'רץ עכשיו', en: 'Running now' },
  'behind': { he: 'לא מעודכן', en: 'Out of date' },
  'ready': { he: 'מוכן', en: 'Ready' },
  'unavailable': { he: 'לא זמין', en: 'Unavailable' },
};

/** Shown where a state would be, while the signals for that stage have not arrived. Not a state. */
export const UNKNOWN_LABEL: Bi = { he: 'נטען…', en: 'Loading…' };

/**
 * Stage 4's steady state. It occupies the state slot but it is NOT a state token: it says that this
 * stage has no single answer for the whole book, which is the truth (Q2-A) rather than a tick.
 */
export const PER_CHAPTER_LABEL: Bi = { he: 'לפי פרק', en: 'Per chapter' };

/** One sentence per stage: what the stage IS. The permanent half of the progressive disclosure. */
export const STAGE_EXPLANATION: Record<SpineStageId, Bi> = {
  'import': {
    he: 'הכנסת כתב היד ובדיקה כיצד חולק לפרקים.',
    en: 'Bring the manuscript in and check how it was split into chapters.',
  },
  'briefs': {
    he: 'תקציר קצר לכל פרק, שנרכב לתקציר אחד של הספר כולו.',
    en: 'A short brief per chapter, composed into one book level brief.',
  },
  'review': {
    he: 'ממצאים על עלילה, דמויות, קצב, טון, נושא ורצף, וסימון של כל ממצא לפי הטיפול בו.',
    en: 'Findings across plot, character, pacing, tone, theme and continuity, each one marked as you work through it.',
  },
  'chapter-passes': {
    he: 'העבודה ברמת השורה נעשית פרק אחר פרק, ולכן אין לה מצב אחד לכל הספר.',
    en: 'Line level work happens chapter by chapter, so it has no single state for the whole book.',
  },
  'export': {
    he: 'הורדת הספר, או פרק אחד ממנו, כקובץ.',
    en: 'Download the book, or a single chapter of it, as a file.',
  },
};

/** Action labels. `build-briefs` and `build-review` get a rebuild wording in the `behind` state. */
const ACTION_LABELS: Record<StageActionId, Bi> = {
  'open-import': { he: 'ייבוא כתב יד', en: 'Import a manuscript' },
  'build-briefs': { he: 'בניית תקצירי ספר', en: 'Build the book briefs' },
  'build-review': { he: 'בניית סקירה', en: 'Build the review' },
  'open-findings': { he: 'מעבר לממצאים', en: 'Go to the findings' },
  'open-export': { he: 'מעבר לייצוא', en: 'Go to export' },
};

const REBUILD_LABELS: Partial<Record<StageActionId, Bi>> = {
  'build-briefs': { he: 'בנייה מחדש של התקצירים', en: 'Rebuild the briefs' },
  'build-review': { he: 'בנייה מחדש של הסקירה', en: 'Rebuild the review' },
};

/**
 * The label on a stage's action button. A `behind` stage says REBUILD rather than build, because the
 * thing exists and the user is refreshing it - and because "Build" beside an existing artifact reads as
 * if the previous one is gone.
 */
export function actionLabel(status: StageStatus, lang: SpineLang): string {
  if (!status.action) return '';
  if (status.state === 'behind') {
    const rebuild = REBUILD_LABELS[status.action];
    if (rebuild) return rebuild[lang];
  }
  return ACTION_LABELS[status.action][lang];
}

/**
 * The `blocked` sentence. It always NAMES the prerequisite stage; a blocked row that does not say what
 * is missing is the failure this stage state exists to fix.
 */
export function blockedSentence(blockedBy: SpineStageId, lang: SpineLang): string {
  const name = STAGE_NAMES[blockedBy][lang];
  return lang === 'he'
    ? `צריך קודם: ${name}.`
    : `Needs first: ${name}.`;
}

/**
 * The `behind` sentence for one reason. Calm, never an error, and it always ends with what to do rather
 * than with a warning. The magnitude belongs to `chapters-changed`; the other reasons have none.
 */
export function behindSentence(reason: BehindReason, magnitude: number | null, lang: SpineLang): string {
  const n = magnitude ?? 0;
  switch (reason) {
    case 'chapters-changed':
      if (lang === 'he') {
        return n === 1
          ? 'פרק אחד השתנה מאז הבנייה האחרונה. אפשר לבנות מחדש כשנוח.'
          : `${n} פרקים השתנו מאז הבנייה האחרונה. אפשר לבנות מחדש כשנוח.`;
      }
      return n === 1
        ? 'One chapter changed since the last build. Rebuild when convenient.'
        : `${n} chapters changed since the last build. Rebuild when convenient.`;
    case 'coverage-grew':
      return lang === 'he'
        ? 'התקציר הכולל מרכיב פחות פרקים מאלה שמוכנים כעת. בנייה מחדש תכלול אותם.'
        : 'The composed brief covers fewer chapters than are ready now. Rebuilding includes them.';
    case 'briefs-rebuilt':
      return lang === 'he'
        ? 'תקצירי הספר נבנו מחדש אחרי הסקירה, ולכן הסקירה משקפת מצב מוקדם יותר של הספר.'
        : 'The book briefs were rebuilt after the review, so the review reflects an earlier state of the book.';
    case 'configuration-changed':
      return lang === 'he'
        ? 'הבנייה הקודמת נעשתה בתצורה אחרת מזו הפעילה כעת. כדאי לבנות מחדש.'
        : 'The previous build ran under a different configuration than the one active now. Rebuilding is advisable.';
  }
}

/**
 * The fallback `behind` sentence, used when the payload says out of date but names no reason we can
 * read. Saying only what is known beats inventing a cause.
 */
export const BEHIND_FALLBACK: Bi = {
  he: 'הספר השתנה מאז הבנייה האחרונה. אפשר לבנות מחדש כשנוח.',
  en: 'The book moved since the last build. Rebuild when convenient.',
};

/**
 * Stage 1's extra line when chapters exist but none carries text: the state token is `not-started`
 * (nothing usable exists) and this sentence keeps that from reading as a contradiction.
 */
export function importDetail(chapterCount: number, chaptersWithText: number, lang: SpineLang): string | null {
  if (chapterCount > 0 && chaptersWithText === 0) {
    return lang === 'he'
      ? `יש ${chapterCount} פרקים, אך עדיין אין בהם טקסט.`
      : `${chapterCount} chapters exist, but none of them has any text yet.`;
  }
  if (chaptersWithText > 0) {
    return lang === 'he'
      ? `${chaptersWithText} מתוך ${chapterCount} פרקים מכילים טקסט.`
      : `${chaptersWithText} of ${chapterCount} chapters contain text.`;
  }
  return null;
}

/**
 * Stage 3's working-through progress, from `resolvedFindingCount` over `findingCount`.
 *
 * It renders ONLY what the two fields say. `acknowledged` findings are counted by neither field, so the
 * open count is stated separately rather than derived as total minus resolved, which would be wrong.
 */
export function findingsProgress(status: StageStatus, lang: SpineLang): string | null {
  const total = status.findingTotal;
  const resolved = status.findingResolved;
  if (total === null || resolved === null || total <= 0) return null;
  const open = status.findingOpen;
  const base = lang === 'he'
    ? `${resolved} מתוך ${total} ממצאים טופלו`
    : `${resolved} of ${total} findings resolved`;
  if (open === null || open <= 0) return `${base}.`;
  return lang === 'he'
    ? `${base}, ${open} עדיין פתוחים.`
    : `${base}, ${open} still open.`;
}

/**
 * Stage 5's honest reason while the export screen does not exist. It names the gap (no screen) rather
 * than the capability (which is real), because a stage greyed with no reason is the defect the
 * permanently grey `Polish` column shipped for a year.
 */
export const EXPORT_UNAVAILABLE_REASON: Bi = {
  he: 'עדיין אין מסך ייצוא באפליקציה. היכולת קיימת בשרת, והשלב ייפתח כאן ברגע שהמסך ייבנה.',
  en: 'There is no export screen in the app yet. The capability exists on the server, and this stage opens here once the screen is built.',
};

/**
 * The `behind` magnitude, rendered as its own short badge beside the sentence. `behind` is the state
 * users hit most and the one the old strip could not express at all, so the count gets its own visual
 * weight rather than living inside a paragraph.
 */
export function behindMagnitudeLabel(magnitude: number, lang: SpineLang): string {
  if (lang === 'he') return magnitude === 1 ? 'פרק אחד' : `${magnitude} פרקים`;
  return magnitude === 1 ? '1 chapter' : `${magnitude} chapters`;
}

/** Stage 4's entry point into the per-chapter breakdown. */
export function chapterListToggleLabel(count: number, lang: SpineLang): string {
  return lang === 'he' ? `בחירת פרק (${count})` : `Choose a chapter (${count})`;
}

/** Marks one chapter in the breakdown as having a pass in flight. */
export const CHAPTER_RUNNING_LABEL: Bi = { he: 'רץ', en: 'Running' };

/** Accessible name of the spine as a whole. */
export const SPINE_ARIA_LABEL: Bi = { he: 'שלבי העבודה על הספר', en: 'Book workflow stages' };

/** Accessible name of a row's expand/collapse control, composed with the stage name by the component. */
export const DETAILS_TOGGLE_LABEL: Bi = { he: 'פרטים על השלב', en: 'Stage details' };
