import { BookProofreadStatusDto, BookProofreadUnreliableChapter } from '../../core/models/book-proofread';
import { chapterDisplayNumber } from '../../core/utils/chapter-number';
import { ExportKindScope, ExportLang } from './export-kinds';

/**
 * c8 (owner decision 2026-10-12): the annotated export exports EVERYTHING by default, and asks the author
 * first only when a chapter it covers carries an Active proofread result the system flagged unreliable.
 * This file holds the pure half of that: which flagged chapters a given export touches, how a chapter is
 * named to the author, and every string the dialog and the downloaded notice render.
 *
 * ── Numbering ─────────────────────────────────────────────────────────────────────────────────────
 * The status carries the STORED 0-based `Chapter.Order`. The author sees the 1-based number, and only
 * {@link chapterDisplayNumber} turns one into the other (the same function the export picker, the spine
 * and the review findings call), so this dialog cannot call a chapter by a different number than the
 * picker right above it.
 *
 * Hebrew is DRAFT and needs native-speaker review. No em-dash or en-dash in any string. Every count has
 * a singular twin (one chapter is the common case: a flag is rare).
 */

/** What the author picked in the dialog. `include` / `skip` are also the wire values of `?unreliable=`. */
export type UnreliableChoice = 'include' | 'skip' | 'cancel';

/**
 * The flagged chapters THIS export would carry: every listed chapter for a book-scoped kind, or the picked
 * chapter alone when it is listed for a chapter-scoped kind. Server order is kept (it is reading order).
 * A missing list (an older server) is "nothing flagged", which is today's behaviour: export with include.
 */
export function relevantUnreliableChapters(
  status: Pick<BookProofreadStatusDto, 'unreliableChapters'> | null | undefined,
  scope: ExportKindScope,
  chapterId: string | null,
): BookProofreadUnreliableChapter[] {
  const listed = status?.unreliableChapters ?? [];
  if (scope === 'book') return listed.slice();
  return chapterId ? listed.filter(c => c.chapterId === chapterId) : [];
}

/** "Chapter 1: Title" / "פרק 1: Title", the 1-based number the author sees. */
export function unreliableChapterLabel(chapter: BookProofreadUnreliableChapter, lang: ExportLang): string {
  const n = chapterDisplayNumber(chapter.order);
  return lang === 'he' ? `פרק ${n}: ${chapter.title}` : `Chapter ${n}: ${chapter.title}`;
}

type Bi = Record<ExportLang, string>;

// DRAFT he - needs native review
export const UNRELIABLE_EXPORT_COPY = {
  title: {
    he: 'חלק מתוצאות ההגהה סומנו כלא אמינות',
    en: 'Some proofread results were flagged unreliable',
  },
  bodyOne: {
    he: 'המערכת סימנה את תוצאת ההגהה של הפרק הזה כלא אמינה: הפלט נראה שבור, ולכן ייתכן שהצעות התיקון בו שגויות.',
    en: 'The system flagged the proofread result of this chapter as unreliable: the output looked broken, so its suggestions may be wrong.',
  },
  bodyMany: {
    he: 'המערכת סימנה את תוצאות ההגהה של הפרקים האלה כלא אמינות: הפלט נראה שבור, ולכן ייתכן שהצעות התיקון בהם שגויות.',
    en: 'The system flagged the proofread results of these chapters as unreliable: the output looked broken, so their suggestions may be wrong.',
  },
  skipHintOne: {
    he: 'דילוג משאיר את הטקסט של הפרק בקובץ, בלי הצעות התיקון שלו.',
    en: 'Skipping keeps the chapter\'s text in the file, without its suggestions.',
  },
  skipHintMany: {
    he: 'דילוג משאיר את הטקסט של הפרקים בקובץ, בלי הצעות התיקון שלהם.',
    en: 'Skipping keeps those chapters\' text in the file, without their suggestions.',
  },
  exportAll: { he: 'ייצוא של הכול', en: 'Export everything' },
  skipOne: { he: 'דילוג על הפרק הזה', en: 'Skip this chapter' },
  skipMany: { he: 'דילוג על הפרקים האלה', en: 'Skip those chapters' },
  cancel: { he: 'ביטול', en: 'Cancel' },
} satisfies Record<string, Bi>;

/**
 * The line under a completed annotated download that skipped flagged chapters. The COUNT is the server's
 * (`X-Export-Unreliable-Skipped-Count`, chapters); `names` are the chapters the author chose to skip in the
 * dialog, already labelled, and are named only when they agree with that count, so the sentence can never
 * name a chapter the server did not skip.
 */
export function unreliableSkippedNotice(count: number, names: string[], lang: ExportLang): string {
  // DRAFT he - needs native review
  const head = lang === 'he'
    ? (count === 1 ? 'הצעות התיקון של פרק אחד דולגו' : `הצעות התיקון של ${count} פרקים דולגו`)
    : (count === 1 ? 'Suggestions skipped for 1 chapter' : `Suggestions skipped for ${count} chapters`);
  return names.length > 0 && names.length === count ? `${head} (${names.join(', ')}).` : `${head}.`;
}
