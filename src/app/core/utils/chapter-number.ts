/**
 * The chapter number an author sees, everywhere a chapter is named to them.
 *
 * The wire's `Chapter.Order` (and every anchor/summary DTO that carries it - `FindingChapterAnchorDto`,
 * `ChapterSummaryDto`, the export skipped-chapter headers, the spine's per-chapter breakdown) is
 * ZERO-BASED. Two surfaces used to number chapters directly off that raw value (a review finding chip, a
 * story-bible anchor chip) while two others added one (the export picker, the spine) - so the SAME
 * chapter read "2. הסופה" on one screen and "3. הסופה" on another, on a screen (export) where picking the
 * wrong one produces a wrong file.
 *
 * ONE-BASED is the correct convention: the number is shown beside a human-authored title as "the Nth
 * chapter", which is how a reader counts chapters, not how the database indexes them. Every surface that
 * names a chapter by number must call this function on the raw `order` rather than re-deriving it, so a
 * fifth surface cannot invent a third convention.
 */
export function chapterDisplayNumber(order: number): number {
  return order + 1;
}
