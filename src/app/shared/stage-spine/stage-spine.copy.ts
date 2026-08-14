import {
  BehindReason,
  BlockedNeed,
  SpineStageId,
  StageActionId,
  StageState,
  StageStatus,
} from './stage-spine.model';

/**
 * Wave 3 / w2 - every user-facing string the stage spine renders, in Hebrew and English, in one place.
 *
 * LANGUAGE RULE: the full spine is BOOK-SCOPED chrome, so it follows the BOOK language, not the app
 * default. An English book renders English, left to right, even for a Hebrew-speaking user. (w3's
 * compact variant mounts in app-level chrome, which is Hebrew-default; that is a different rule on a
 * different surface and it reads the same maps.)
 *
 * THE HEBREW HERE HAS BEEN THROUGH THE w8 NATIVE-SPEAKER SWEEP (2026-08-11, `docs/HEBREW_NATIVE_REVIEW.md`).
 * The owner read every string in this file and either cleared it or dictated its replacement, including the
 * one thing the draft flagged for a native ear: stages 3 and 4 both contain the word עריכה, and the answer
 * was to rename stage 4 to `עריכת פרק` (מעברים read as "transitions", not "passes") and to keep the overlap
 * with stage 3 knowingly. Their wording is authoritative - do not "improve" a Hebrew string here without
 * another native reading. The GUIDES corpus is NOT covered by that sweep: it still calls an individual pass
 * a `מעבר`, which is a live, undecided terminology question recorded in that document.
 *
 * ONE STRING IN THIS FILE IS NEWER THAN THAT SWEEP AND IS NOT CLEARED: {@link BLOCKED_NEED_SENTENCE}, written
 * 2026-08-14 for final-r03. It carries a `// DRAFT he - needs native review` marker at its site, the same
 * convention `features/export/export-kinds.ts` uses for the three strings it reworded after its own
 * clearance. Everything else here is cleared, so the marker is the difference and not the docstring.
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

/**
 * The five stage names. THE CANONICAL, owner-dictated, native-swept source (2026-08-11) - not a draft.
 * `src/docs/HEBREW_NATIVE_REVIEW.md` lists this group (inventory group 1) CLEARED, and `guides-strings.ts`'s
 * `STAGE_LABELS_HE['chapter-editing']` cites this map as the canonical name for the same reason. This
 * does NOT resolve the stage-4 naming question left open there: the guide H1 and Show's citation chip
 * still say `מעברי העריכה על פרק`, and that is a live, undecided terminology question for the owner's
 * next sweep, not a draft-clearance question.
 */
export const STAGE_NAMES: Record<SpineStageId, Bi> = {
  'import': { he: 'ייבוא', en: 'Import' },
  'briefs': { he: 'תקצירי ספר', en: 'Book briefs' },
  'review': { he: 'עריכה התפתחותית', en: 'Developmental review' },
  'chapter-passes': { he: 'עריכת פרק', en: 'Chapter editing passes' },
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
    he: 'העלאת כתב היד ובדיקה כיצד חולק לפרקים.',
    en: 'Bring the manuscript in and check how it was split into chapters.',
  },
  'briefs': {
    he: 'תקציר לכל פרק, שמורכב לתקציר אחד של הספר כולו.',
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
  'open-import': { he: 'העלאת כתב יד', en: 'Import a manuscript' },
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
 * The `blocked` sentence FOR A ROW WAITING ON AN EARLIER STAGE. It always NAMES that stage; a blocked row
 * that does not say what is missing is the failure this stage state exists to fix.
 *
 * IT MAY ONLY BE CALLED WITH A STAGE THAT IS ACTUALLY MISSING. The naming is the whole contract, and naming
 * a stage the author has already finished breaks it just as thoroughly as naming nothing: see
 * {@link BLOCKED_NEED_SENTENCE} for the case that used to come through here wrongly and now does not.
 */
export function blockedSentence(blockedBy: SpineStageId, lang: SpineLang): string {
  const name = STAGE_NAMES[blockedBy][lang];
  return lang === 'he'
    ? `צריך קודם: ${name}.`
    : `Needs first: ${name}.`;
}

/**
 * The `blocked` sentence FOR A ROW WAITING ON SOMETHING THAT IS NOT A STAGE (final-r03).
 *
 * WHY IT EXISTS. {@link blockedSentence} names a stage, and stage 5's "chapters exist, none of them holds
 * anything renderable" case borrowed Import's name for want of one of its own. The closing render gate read
 * the result back on a real book with eight imported chapters: stage 1 "Ready" and, in the same viewport,
 * stage 5 "Blocked" plus "Needs first: Import" over a button offering to upload a manuscript. The sentence
 * named a prerequisite that was not missing, so the row asked the author to redo finished work and
 * contradicted a row four places above it. This sentence names the thing that IS missing instead.
 *
 * THE WORDING. It keeps the "Needs first" frame, because that frame is the row's promise and only its object
 * was wrong, and it names CONTENT rather than an act of writing: a chapter imported from a DOCX and never
 * opened in the editor already holds the author's words and still yields no file, so "write something" would
 * be the false claim w8 / F2 removed from the sentence one line below this one. It is deliberately NOT a copy
 * of `features/export/export-kinds.ts`'s `EXPORT_ERRORS.nothingWrittenBook`, which answers the same server
 * condition after a failed click and therefore carries the retry and both ways out of it; the two must make
 * the same CLAIM, and they do, but a spine row read before the click has no attempt to retry. The row's own
 * third line ({@link exportNothingWrittenDetail}) then supplies the count and what a file made now would
 * contain, so this line stays short enough for a 300px panel.
 *
 * NO ACTION ACCOMPANIES IT, which is `stage-spine.model.ts`'s call, not this file's; the reason is written at
 * `blockedOnExportableContent`.
 *
 * PARITY IS ENFORCED BY THE TYPE, not by review: `Record<BlockedNeed, Bi>` and `Bi = Record<SpineLang, string>`
 * mean a need with only one language, or a need with no sentence at all, does not compile.
 *
 * RTL: nothing here is direction-aware. The sentence carries no digits, no bracket and no Latin fragment
 * inside its Hebrew, so it needs neither {@link isolateDigits} nor a bidi mark; it MIRRORS with the row, which
 * is `dir`-driven at the spine root and reading-edge aligned by `.stage-line`'s inherited `text-align: start`.
 */
export const BLOCKED_NEED_SENTENCE: Record<BlockedNeed, Bi> = {
  // DRAFT he - needs native review (written 2026-08-14; the rest of this file's Hebrew is cleared, this
  // string is not, see the file docstring).
  'exportable-content': {
    he: 'צריך קודם: פרק שיש בו תוכן שאפשר להפיק ממנו קובץ.',
    en: 'Needs first: a chapter that holds something a file can be made from.',
  },
};

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
        ? 'תקציר הספר נבנה מפחות פרקים מכפי שיש כעת. בנייה מחדש תכלול גם אותם.'
        : 'The composed brief covers fewer chapters than are ready now. Rebuilding includes them.';
    case 'briefs-rebuilt':
      return lang === 'he'
        ? 'תקצירי הספר נבנו מחדש אחרי הסקירה, ולכן הסקירה משקפת מצב מוקדם יותר של הספר.'
        : 'The book briefs were rebuilt after the review, so the review reflects an earlier state of the book.';
    case 'configuration-changed':
      return lang === 'he'
        ? 'הבנייה הקודמת נעשתה בהגדרה שונה מזו הפעילה כעת. כדאי לבנות מחדש.'
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
 *
 * NIT 50: both counts here get a singular form, exactly as {@link behindSentence} and
 * {@link behindMagnitudeLabel} already do for their own counts - a one-chapter book used to render
 * "1 chapters exist" / "יש 1 פרקים".
 */
export function importDetail(
  chapterCount: number,
  chaptersWithText: number | null,
  lang: SpineLang,
): string | null {
  if (chaptersWithText === null) return null;
  if (chapterCount > 0 && chaptersWithText === 0) {
    if (lang === 'he') {
      return isolateDigits(chapterCount === 1
        ? 'יש פרק אחד, אך עדיין אין בו טקסט.'
        : `יש ${chapterCount} פרקים, אך עדיין אין בהם טקסט.`);
    }
    return isolateDigits(chapterCount === 1
      ? 'There is one chapter, but it has no text yet.'
      : `${chapterCount} chapters exist, but none of them has any text yet.`);
  }
  if (chaptersWithText > 0) {
    if (lang === 'he') {
      const withText = chaptersWithText === 1 ? 'פרק אחד' : `${chaptersWithText}`;
      const ofTotal = chapterCount === 1 ? 'פרק אחד' : `${chapterCount} פרקים`;
      const verb = chaptersWithText === 1 ? 'מכיל' : 'מכילים';
      return isolateDigits(`${withText} מתוך ${ofTotal} ${verb} טקסט.`);
    }
    const withText = chaptersWithText === 1 ? '1' : `${chaptersWithText}`;
    const total = chapterCount === 1 ? '1' : `${chapterCount}`;
    const chapterWord = chapterCount === 1 ? 'chapter' : 'chapters';
    const verb = chaptersWithText === 1 ? 'contains' : 'contain';
    return isolateDigits(`${withText} of ${total} ${chapterWord} ${verb} text.`);
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
 * Stage 5's extra line when chapters exist but not one of them holds anything the exporter could put in a
 * file.
 *
 * WHY THIS SENTENCE EXISTS. Without it the row reads `blocked` and a bare prerequisite on a book that plainly
 * HAS chapters, which reads as the spine being wrong rather than as the book holding nothing a file can be
 * made from. The prerequisite line above ({@link BLOCKED_NEED_SENTENCE}) names the missing thing; this one
 * carries the COUNT and says what the file would be if it were produced anyway - which is the thing the
 * author cares about, and the thing an empty download used to tell them only after they had opened it.
 *
 * It used to be the row's ONLY true line, because the prerequisite line above it named Import, a stage the
 * author had already finished (final-r03). Both lines now answer the same condition and neither contradicts
 * stage 1.
 *
 * IT NOW SAYS WHAT THE SERVER WILL DO, and that is a change (w8 / F2). It used to be a warning off the word
 * count with an explicit disclaimer that the exporter's definition of an empty chapter is a different one;
 * the count it reads is now the exporter's own (`chaptersExportable`), so the sentence and the endpoint
 * cannot disagree. The wording follows: "nothing has been written" was true of the state the word count
 * described and false of this one - a chapter imported from a DOCX and never opened in the editor has the
 * author's words in it and still nothing a file can be made from. It says that instead.
 *
 * Returns null when there is nothing true to add, including when the count is not known.
 */
export function exportNothingWrittenDetail(
  chapterCount: number | null,
  chaptersExportable: number | null,
  lang: SpineLang,
): string | null {
  if (chapterCount === null || chaptersExportable === null) return null;
  if (chapterCount <= 0 || chaptersExportable !== 0) return null;
  // No {@link isolateDigits} here, deliberately: this sentence is rendered as TEXT, not through
  // `[innerHTML]` like the import detail, so a span would be drawn literally (confirmed at
  // `stage-spine.component.ts`'s `exportDetailText` binding, `{{ detail }}` not `[innerHTML]`). It is
  // the only COUNT-BEARING sentence among the isolated group named in that file's RTL numerals note
  // (import detail, findings progress, chapter-toggle count) that is not wrapped - the asymmetry is
  // deliberate, not an oversight, for the reason above. NOTE: `behindSentence`'s `chapters-changed` case
  // a few functions above ALSO embeds an unwrapped count and is ALSO rendered as plain text for the same
  // reason; that one predates this note and is a pre-existing gap in the same RTL numerals comment's
  // enumeration, not something this function's asymmetry claim covers - flagging it here rather than
  // silently repeating an incomplete "the one exception" line.
  if (lang === 'he') {
    return chapterCount === 1
      ? 'יש פרק אחד בספר, אך אין בו עדיין תוכן שאפשר לכתוב לקובץ, ולכן קובץ שייווצר עכשיו יהיה ריק.'
      : `יש ${chapterCount} פרקים בספר, אך אין בהם עדיין תוכן שאפשר לכתוב לקובץ, ולכן קובץ שייווצר עכשיו יהיה ריק.`;
  }
  return chapterCount === 1
    ? 'The book has one chapter, but it holds nothing that can go into a file yet, so a file made now would be empty.'
    : `The book has ${chapterCount} chapters, but they hold nothing that can go into a file yet, so a file made now would be empty.`;
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

// ─── Wave 3 / w6 (Q13-A): the pointer from a stage row to the guide that answers it ────────────────
//
// The row's one-sentence {@link STAGE_EXPLANATION} says what the stage IS; this is where an author goes
// for the rest, and it is CONTENT rather than copy - the destination is the shipped guide, read through
// the reader chatbot phase A.2 built. That is Q13-A's whole point: orientation is a view over the served
// guides, so nothing here restates what a guide says.

/** The row's link into its guide. */
export const STAGE_GUIDE_LINK_LABEL: Bi = {
  he: 'מדריך לשלב הזה',
  en: 'Read the guide for this stage',
};

/**
 * Said only on the ONE row whose guide is broader than its stage (Book briefs, whose guide also covers
 * the book profile, the Story Bible, asking questions about the book and the writing style). An author
 * who presses a link labelled "the guide for this stage" and lands on a document about four other things
 * has been mildly lied to, and this is the sentence that keeps that from happening.
 */
export const STAGE_GUIDE_BROADER_NOTE: Bi = {
  he: 'המדריך מכסה גם מידע על הספר.',
  en: 'That guide also covers the other book level material.',
};

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
 *
 * "Wants something" is load-bearing in the `הבא:` / "Next:" wording, and it is `focusStageId` that has to
 * honour it: a stage this screen has already settled as `ready` wants nothing and may not be named here.
 * See that function's own note on the unknown fallback (w8 / E1) - on the surfaces this density mounts on,
 * stages 2 to 5 are permanently unknown, and naming stage 1 there used to render `הבא: ייבוא, מוכן`.
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
