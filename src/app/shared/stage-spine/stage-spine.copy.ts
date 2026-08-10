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

/**
 * Wrap every digit run in `<span class="iso">`, Angular's `[innerHTML]`-safe way to isolate a count
 * INSIDE a sentence rather than in its own DOM element. Digits are LTR glyphs; the marker number, chapter
 * order and behind-magnitude get the same treatment for free because they are already separate elements
 * with `unicode-bidi: isolate` in `stage-spine.component.ts`'s styles - a count embedded in a Hebrew
 * sentence (import detail, findings progress, the chapter-toggle count) has no element of its own to put
 * that CSS on, so this does the same thing at the string level. `class`, not inline `style`: Angular's
 * default HTML sanitizer (no `bypassSecurityTrust*`, matching `markdown-text.component.ts`) keeps `span`
 * and `class` but strips `style`.
 */
function isolateDigits(text: string): string {
  return text.replace(/\d+/g, digits => `<span class="iso">${digits}</span>`);
}

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
 *
 * `chaptersWithText === null` means NOT KNOWN and returns NO sentence. Both sentences below are positive
 * claims about the text in the book, and neither may be made from an absent number - the null used to be
 * coalesced to 0 by the caller, which turned "we have not been told" into "none of them has any text yet".
 */
export function importDetail(
  chapterCount: number,
  chaptersWithText: number | null,
  lang: SpineLang,
): string | null {
  if (chaptersWithText === null) return null;
  if (chapterCount > 0 && chaptersWithText === 0) {
    return isolateDigits(lang === 'he'
      ? `יש ${chapterCount} פרקים, אך עדיין אין בהם טקסט.`
      : `${chapterCount} chapters exist, but none of them has any text yet.`);
  }
  if (chaptersWithText > 0) {
    return isolateDigits(lang === 'he'
      ? `${chaptersWithText} מתוך ${chapterCount} פרקים מכילים טקסט.`
      : `${chaptersWithText} of ${chapterCount} chapters contain text.`);
  }
  return null;
}

/**
 * Stage 3's working-through progress, from `resolvedFindingCount` and `openFindingCount` over
 * `findingCount`.
 *
 * `acknowledged` findings are counted by NEITHER `resolved` nor `open` (be-c05:
 * `FindingStatusBucket.Acknowledged`, the third bucket) - a naive "N resolved, K open" sentence therefore
 * visibly fails to add up to the total whenever an acknowledged finding exists ("2 of 5 resolved, 2 still
 * open" reads as 4, not 5), even though the underlying fields are exactly the ones the ledger uses (finding
 * 30). be-c05 also added the server-side guarantee that the three buckets are TOTAL over the vocabulary, so
 * this subtraction is exact rather than a guess: nothing here is derived FROM an absent fact, only from the
 * two counts the payload actually carries plus the total it also carries. The acknowledged clause is
 * omitted when it is zero, matching how the open clause already behaves.
 */
export function findingsProgress(status: StageStatus, lang: SpineLang): string | null {
  const total = status.findingTotal;
  const resolved = status.findingResolved;
  if (total === null || resolved === null || total <= 0) return null;
  const open = status.findingOpen ?? 0;
  const acknowledged = Math.max(0, total - resolved - open);
  let sentence = lang === 'he'
    ? `${resolved} מתוך ${total} ממצאים טופלו`
    : `${resolved} of ${total} findings resolved`;
  if (acknowledged > 0) {
    sentence += lang === 'he' ? `, ${acknowledged} נצפו` : `, ${acknowledged} acknowledged`;
  }
  if (open > 0) {
    sentence += lang === 'he' ? `, ${open} עדיין פתוחים` : `, ${open} still open`;
  }
  return isolateDigits(`${sentence}.`);
}

// Stage 5 used to carry an EXPORT_UNAVAILABLE_REASON here: the sentence that explained, honestly, that the
// server could export but the app had no screen for it. w4 built the screen (`/books/:bookId/export`), so
// the gap that sentence described is gone and the sentence went with it. Stage 5 now reads `ready`,
// `blocked` (no chapters or no text, which are the server's own two 409 answers) or `unknown`, like any
// other computed stage.

/**
 * Stage 5's extra line when chapters exist but none of them carries text.
 *
 * WHY THIS SENTENCE EXISTS. Without it the row reads `blocked` / "Needs first: Import" on a book that
 * plainly HAS chapters, which reads as the spine being wrong rather than as the book being empty. The
 * blocked sentence names the prerequisite; this one says what is actually missing and what the file would
 * be if it were produced anyway - which is the thing the author cares about, and the thing an empty
 * download used to tell them only after they had opened it.
 *
 * It says what the file WOULD be, never what the server will do: the two definitions of an empty chapter
 * differ by design (word count here, renderable content there), so this is a warning, not a forecast.
 * Returns null when there is nothing true to add, including when the count is not known.
 */
export function exportNothingWrittenDetail(
  chapterCount: number | null,
  chaptersWithText: number | null,
  lang: SpineLang,
): string | null {
  if (chapterCount === null || chaptersWithText === null) return null;
  if (chapterCount <= 0 || chaptersWithText !== 0) return null;
  if (lang === 'he') {
    return chapterCount === 1
      ? 'יש פרק אחד בספר, אך עדיין לא נכתב בו דבר, ולכן קובץ שייווצר עכשיו יהיה ריק.'
      : `יש ${chapterCount} פרקים בספר, אך עדיין לא נכתב בהם דבר, ולכן קובץ שייווצר עכשיו יהיה ריק.`;
  }
  return chapterCount === 1
    ? 'The book has one chapter, but nothing has been written in it yet, so a file made now would be empty.'
    : `The book has ${chapterCount} chapters, but nothing has been written in them yet, so a file made now would be empty.`;
}

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
  return isolateDigits(lang === 'he' ? `בחירת פרק (${count})` : `Choose a chapter (${count})`);
}

/** Marks one chapter in the breakdown as having a pass in flight. */
export const CHAPTER_RUNNING_LABEL: Bi = { he: 'רץ', en: 'Running' };

/** Accessible name of the spine as a whole. */
export const SPINE_ARIA_LABEL: Bi = { he: 'שלבי העבודה על הספר', en: 'Book workflow stages' };

/** Accessible name of a row's expand/collapse control, composed with the stage name by the component. */
export const DETAILS_TOGGLE_LABEL: Bi = { he: 'פרטים על השלב', en: 'Stage details' };

// ─── Wave 3 / w3: the COMPACT density ──────────────────────────────────────────────────────────────
//
// The compact spine renders on surfaces that hold no book payload beyond the books-list row: the books
// list itself, the import screen, and the editor route whenever the full spine is not on screen. It is a
// DENSITY of the same component reading the same maps, not a second vocabulary - every string below is
// either shared with the full spine or exists because compact has less to say, never because it says
// something different.

/** Accessible name of the compact spine as a whole. */
export const COMPACT_ARIA_LABEL: Bi = {
  he: 'שלבי העבודה על הספר, תצוגה מצומצמת',
  en: 'Book workflow stages, compact view',
};

/**
 * THE HONEST "LESS". A stage the compact spine cannot compute from the payload its surface already holds
 * renders THIS, not the full spine's `Loading…`: on the books list nothing further is coming, because
 * asking would cost one status request per row and the standing rule is that compact shows less rather
 * than fetching more. "Not known here" is a statement about this SCREEN, and the fix is to open the book.
 */
export const COMPACT_UNKNOWN_LABEL: Bi = { he: 'לא ידוע מכאן', en: 'Not known here' };

/**
 * The compact spine's one line of readable text. Compact has no room for five names, and truncating them
 * is forbidden (the 2.6 constraint), so instead of shrinking every name it names exactly ONE stage in full.
 *
 * Which one: a RUNNING stage always wins, because carrying the running signal on every route is this
 * density's job (Q12b, the two chrome dots retired into it). Otherwise it is the focus stage, the first
 * one in canonical order that wants something from the user.
 */
export function compactSummaryLine(
  stageName: string,
  stateText: string,
  running: boolean,
  lang: SpineLang,
): string {
  if (running) {
    return lang === 'he' ? `בונה עכשיו: ${stageName}` : `Building now: ${stageName}`;
  }
  return lang === 'he' ? `הבא: ${stageName}, ${stateText}` : `Next: ${stageName}, ${stateText}`;
}

/**
 * One pip's accessible name: the stage's full name and its state, so a screen reader gets from compact
 * exactly what a sighted user gets from the full spine. The pips themselves carry a number and a colour
 * only; no name is ever clipped, because no name is ever drawn.
 */
export function compactPipLabel(stageName: string, stateText: string): string {
  return `${stageName}: ${stateText}`;
}
