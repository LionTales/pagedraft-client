/**
 * Wave 3 / w4 - WHAT THIS SCREEN CAN PRODUCE, as data.
 *
 * ── Why a list and not two buttons ────────────────────────────────────────────────────────────────
 * The roadmap already has a third export in it: an "editor report" (findings, scorecard and per-chapter
 * suggestions as a document, owner 2026-08-09). It is deliberately NOT built here. What is built here is a
 * screen that renders a LIST of export kinds, so that report arrives as one more entry in {@link EXPORT_KINDS}
 * plus one branch in the page's dispatch, and nothing about the layout, the running affordance, the error
 * handling or the specs has to be reworked to make room for it.
 *
 * Adding a kind is exactly three edits, and the compiler enforces the third:
 *   1. add the id to {@link ExportKindId};
 *   2. add its entry to {@link EXPORT_KINDS} (name, description, format, scope, availability);
 *   3. add its case to the page's `startExport` switch - the switch ends in a `never` assignment, so an id
 *      with no case FAILS TO COMPILE rather than silently rendering a button that does nothing.
 *
 * ── Availability is data too ──────────────────────────────────────────────────────────────────────
 * A kind that is listed but not yet buildable carries the REASON it is not ({@link ExportKindAvailability}).
 * That is the wave's standing rule applied one level down: a greyed row without a reason is the defect the
 * spine's permanently grey column shipped for a year, and a list of kinds is exactly where the next one
 * would appear.
 *
 * ALL HEBREW HERE IS DRAFT, gated on w8's native-speaker sweep. No em-dash, no en-dash, no model or
 * provider identity - the same three constraints the rest of the wave obeys.
 */

export type ExportLang = 'he' | 'en';

type Bi = Record<ExportLang, string>;

/** Resolve a book language code to a copy language. Anything that is not English renders Hebrew. */
export function exportLang(bookLanguage: string | null | undefined): ExportLang {
  return (bookLanguage ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'he';
}

/** The kinds this screen knows about. `editor-report` joins here when it is built. */
export type ExportKindId = 'book-docx' | 'chapter-docx';

/**
 * What the kind needs before it can run. It drives the ROW's shape, not the endpoint:
 *  - `book`     one button; the book is already chosen by the route.
 *  - `chapter`  a chapter picker, then the button.
 * A future book-scoped kind therefore needs no new UI at all.
 */
export type ExportKindScope = 'book' | 'chapter';

/** Available, or listed with the honest reason it is not. */
export type ExportKindAvailability = { available: true } | { available: false; reason: Bi };

export interface ExportKind {
  id: ExportKindId;
  scope: ExportKindScope;
  /** The file format, shown as a short badge. Not localized: DOCX is DOCX in both languages. */
  format: string;
  /** The kind's name, as the user reads it. */
  name: Bi;
  /** One sentence: what the file contains. */
  description: Bi;
  availability: ExportKindAvailability;
}

/**
 * The catalog, in the order the screen renders it: whole book first, because that is what an author asking
 * for "my book" means, and one chapter second.
 */
export const EXPORT_KINDS: readonly ExportKind[] = [
  {
    id: 'book-docx',
    scope: 'book',
    format: 'DOCX',
    name: { he: 'הספר כולו', en: 'The whole book' },
    description: {
      he: 'כל הפרקים לפי הסדר, בקובץ Word אחד, בדיוק כפי שהם שמורים כעת.',
      en: 'Every chapter in order, in one Word file, exactly as they are saved right now.',
    },
    availability: { available: true },
  },
  {
    id: 'chapter-docx',
    scope: 'chapter',
    format: 'DOCX',
    name: { he: 'פרק אחד', en: 'A single chapter' },
    description: {
      he: 'פרק אחד לבחירתכם, בקובץ Word שנקרא על שם הפרק.',
      en: 'One chapter of your choosing, in a Word file named after the chapter.',
    },
    availability: { available: true },
  },
];

// ─── The screen's own copy ────────────────────────────────────────────────────────────────────────
//
// BOOK-SCOPED LANGUAGE: this is a book surface reached from inside a book, so it follows the BOOK's
// language, exactly as the full spine and the import screen do. An English book renders English and LTR
// even for a Hebrew-speaking user.

export const EXPORT_COPY = {
  title: { he: 'ייצוא', en: 'Export' },
  subtitle: {
    he: 'הורדת הספר, או פרק אחד ממנו, כקובץ Word.',
    en: 'Download the book, or a single chapter of it, as a Word file.',
  },
  backToBook: { he: 'חזרה לספר', en: 'Back to book' },
  /** The button on every available kind. */
  download: { he: 'הורדה', en: 'Download' },
  /**
   * THE IN-PROGRESS AFFORDANCE. Both calls are synchronous, so what this says is true of the REQUEST and
   * claims nothing about server-side progress: there is no job and no percentage on the wire to report.
   */
  preparing: { he: 'מכין את הקובץ…', en: 'Preparing the file…' },
  /** Announced politely while a file is being prepared, so the wait is not sighted-only. */
  preparingAria: { he: 'מכין את קובץ הייצוא', en: 'Preparing the export file' },
  /** Shown once a file has been handed to the browser. */
  downloaded: { he: 'הקובץ ירד:', en: 'Downloaded:' },
  chapterLabel: { he: 'פרק', en: 'Chapter' },
  chooseChapter: { he: 'בחירת פרק', en: 'Choose a chapter' },
  loading: { he: 'נטען…', en: 'Loading…' },
  /** The book itself could not be read, so the screen knows nothing about its chapters. */
  bookLoadFailed: {
    he: 'לא הצלחנו לטעון את הספר, ולכן אין כאן מידע על הפרקים. אפשר לרענן את הדף ולנסות שוב.',
    en: 'The book could not be loaded, so there is nothing here about its chapters. Refresh the page and try again.',
  },
  /** No chapters: stated once at the top of the screen, and every kind is disabled with the same reason. */
  noChapters: {
    he: 'אין עדיין פרקים בספר הזה, ולכן אין מה לייצא. ייבוא כתב יד יפתח את המסך הזה.',
    en: 'This book has no chapters yet, so there is nothing to export. Importing a manuscript opens this screen up.',
  },
  goToImport: { he: 'מעבר לייבוא', en: 'Go to import' },
} satisfies Record<string, Bi>;

// ─── Failure copy ─────────────────────────────────────────────────────────────────────────────────
//
// One sentence per outcome the wire can actually produce, each saying what happened AND what to do. The
// screen never renders a status code or a stack trace, and it never reports a reason the server did not
// send: an unrecognized failure gets the generic sentence rather than a guessed cause.

export const EXPORT_ERRORS = {
  /** 409 with `reason: noChapters` - the book emptied out between loading this screen and pressing. */
  noChapters: {
    he: 'אין פרקים לייצוא. ייבוא כתב יד או הוספת פרק, ואז אפשר לנסות שוב.',
    en: 'There are no chapters to export. Import a manuscript or add a chapter, then try again.',
  },
  /**
   * 409 with `reason: nothingWritten` on the BOOK path - the book has chapters, but not one of them holds
   * anything renderable, so the file would be blank. A separate sentence from {@link noChapters} because
   * the next action is different: there is nothing to import, there is something to write.
   */
  nothingWrittenBook: {
    he: 'יש פרקים בספר, אך עדיין לא נכתב בהם דבר, ולכן הקובץ היה יוצא ריק. אפשר לכתוב באחד הפרקים, או לייבא כתב יד, ואז לנסות שוב.',
    en: 'The book has chapters, but nothing has been written in them yet, so the file would have come out empty. Write in a chapter, or import a manuscript, then try again.',
  },
  /**
   * 409 with `reason: nothingWritten` on the CHAPTER path. This case used to answer 200 with a valid but
   * empty .docx, so this sentence is the whole of what the author now learns instead of a blank file.
   */
  nothingWrittenChapter: {
    he: 'עדיין לא נכתב דבר בפרק הזה, ולכן הקובץ היה יוצא ריק. אפשר לכתוב בו, או לבחור פרק אחר, ואז לנסות שוב.',
    en: 'Nothing has been written in this chapter yet, so the file would have come out empty. Write in it, or pick another chapter, then try again.',
  },
  /** 404 on the book path. */
  bookNotFound: {
    he: 'הספר לא נמצא. ייתכן שנמחק בחלון אחר.',
    en: 'The book could not be found. It may have been deleted in another window.',
  },
  /** 404 on the chapter path (the lookup is book-scoped, so this covers a chapter of another book too). */
  chapterNotFound: {
    he: 'הפרק לא נמצא. ייתכן שנמחק. אפשר לרענן את הדף ולבחור פרק אחר.',
    en: 'The chapter could not be found. It may have been deleted. Refresh the page and pick another chapter.',
  },
  /** status 0: the request never reached the server. */
  offline: {
    he: 'לא הצלחנו להגיע לשרת. בדקו את החיבור ונסו שוב.',
    en: 'The server could not be reached. Check your connection and try again.',
  },
  /** Anything else, including a 500. Says only what is known. */
  generic: {
    he: 'הייצוא נכשל. אפשר לנסות שוב.',
    en: 'The export did not complete. You can try again.',
  },
} satisfies Record<string, Bi>;

// ─── What the downloaded file does NOT contain ────────────────────────────────────────────────────
//
// The export leaves out a chapter with nothing written in it. Silently, that is indistinguishable from
// data loss: an author opening their manuscript and finding chapter 7 missing has no way to tell a skip
// from a corruption. So a successful download says what it left out, from the SERVER's own headers - the
// client never predicts a skip, because the spine's "empty chapter" (no words) and the exporter's (no
// renderable block) are deliberately different tests and a guess here would be a third one.

/**
 * The notice under a completed download that left chapters out.
 *
 * THE COUNT AND THE NAMES ARE TWO DIFFERENT FACTS. The server bounds the named list so a long book cannot
 * blow a proxy's header budget, so it may name fewer chapters than it counted; the count is authoritative
 * and the names are a courtesy, and this sentence never implies the list is complete when it is not.
 *
 * `names` arrive already numbered by the caller, which owns display numbering.
 */
export function skippedNotice(count: number, names: string[], lang: ExportLang): string {
  const head = lang === 'he'
    ? (count === 1
      ? 'פרק אחד לא נכלל בקובץ, כי עדיין לא נכתב בו דבר'
      : `${count} פרקים לא נכללו בקובץ, כי עדיין לא נכתב בהם דבר`)
    : (count === 1
      ? 'One chapter is not in this file, because nothing has been written in it yet'
      : `${count} chapters are not in this file, because nothing has been written in them yet`);
  if (names.length === 0) return `${head}.`;
  const list = names.join(', ');
  if (names.length >= count) return `${head}: ${list}.`;
  // Fewer names than the count: say so, rather than letting the list read as the whole of it.
  return lang === 'he' ? `${head}. בהם: ${list}.` : `${head}. Among them: ${list}.`;
}

/**
 * The notice under a completed download whose skip headers never arrived: an older server, or a proxy that
 * stripped them. Rendering nothing here would let the screen imply a complete manuscript it was never told
 * about, and rendering "0 chapters left out" would be an outright invention.
 */
export const SKIPPED_UNKNOWN: Bi = {
  he: 'לא קיבלנו מהשרת מידע על פרקים שאולי לא נכללו בקובץ הזה, ולכן כדאי לבדוק אותו.',
  en: 'The server did not tell us whether any chapters were left out of this file, so it is worth checking.',
};

/** Resolve a bilingual constant. */
export function pick(bi: Bi, lang: ExportLang): string {
  return bi[lang];
}
