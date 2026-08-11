/**
 * Wave 3 / w6 (Q10-D) - the first-run orientation panel's memory.
 *
 * ── What it remembers, and why that is one bit ────────────────────────────────────────────────────
 * Exactly one fact per book: has the author dismissed the orientation panel for this book. Nothing
 * else. The panel's OPEN state is not stored - a re-opened panel closes when the author closes it and
 * does not need to survive a reload, and storing it would make "dismissed permanently" a lie the next
 * time the page loaded.
 *
 * ── Why per book, and not once per user ───────────────────────────────────────────────────────────
 * The panel is per book by decision ("first visit to a book with no builds"). An author's second book
 * is a second first run in every way that matters: the stages start over, the build rows start over,
 * and the panel that explains them is worth offering again. Making it global would show it once, ever,
 * which is exactly the failure mode option C was rejected for.
 *
 * ── Fails open, in the direction that is safe ─────────────────────────────────────────────────────
 * Every read and write is wrapped, like {@link collapse-store} beside it. An unreadable store reads as
 * "not dismissed", so a private-mode browser or a full quota gets the panel offered again rather than a
 * broken dashboard. Offering orientation twice is a small annoyance; hiding it forever because a write
 * failed is the bug. The panel is non-blocking and dismissible in one click, so the safe direction is
 * to show it.
 *
 * ── Not a server setting, deliberately ────────────────────────────────────────────────────────────
 * Same reasoning as the collapse map: this is one reader's view preference on one machine, it carries
 * no book content, and a persisted column would have meant a new API contract for something the app can
 * honestly forget.
 */

/** localStorage key for one book's orientation state. */
export function orientationStorageKey(bookId: string): string {
  return `pd:orientation-dismissed:${bookId}`;
}

/**
 * Has the author dismissed the orientation panel for this book?
 *
 * Returns false for a missing book id and for any storage failure - see the fails-open note above.
 */
export function orientationDismissed(bookId: string | null | undefined): boolean {
  if (!bookId) return false;
  try {
    return localStorage.getItem(orientationStorageKey(bookId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Record the dismissal. Called when the author closes the panel, never when the panel merely fails to
 * load: a panel that never appeared has not been dismissed, and consuming the first run on a failed
 * fetch would silently cost the author their one orientation.
 */
export function dismissOrientation(bookId: string | null | undefined): void {
  if (!bookId) return;
  try {
    localStorage.setItem(orientationStorageKey(bookId), '1');
  } catch {
    // Fails open: the panel still closes for this session, it just will not be remembered.
  }
}

/**
 * Drop one book's orientation row. Called from the books-list delete handler beside
 * `clearCollapseState`, so a deleted book leaves nothing behind for an id that can never be reopened.
 */
export function clearOrientationState(bookId: string | null | undefined): void {
  if (!bookId) return;
  try {
    localStorage.removeItem(orientationStorageKey(bookId));
  } catch {
    // Fails open: a leftover flag for a deleted book is inert, not a correctness bug.
  }
}
