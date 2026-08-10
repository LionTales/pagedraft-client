/**
 * Wave 3 / w5 - the collapse directive's persistence layer.
 *
 * The owner's addition to Q6 asks for dashboard sections that collapse at two levels (major parts, and
 * elements inside them) and that REMEMBER what the author did, per book. This is that memory, and it is
 * deliberately a plain localStorage map rather than a server setting: a collapse is a view preference of
 * one reader on one machine, it carries no book content, and giving it a persisted column would have
 * meant a new API contract for something the app can honestly forget if storage is unavailable.
 *
 * KEYED PER BOOK. One author can have a long book whose chapter-brief list they always want folded and a
 * short one where they never do, so a single global key would have made the setting wrong half the time.
 * The book id is in the storage key, not in the payload, so deleting a book's row costs one removeItem.
 *
 * FAILS OPEN, ALWAYS. Every read and write is wrapped: a private-mode browser, a full quota, or a
 * hand-corrupted value must degrade to "use the defaults", never to a broken dashboard. `read` returning
 * an empty map is indistinguishable from "nothing has been collapsed yet", which is exactly the state a
 * first-run author is in, so the failure mode is the first-run experience rather than an error.
 *
 * WHAT IS NOT STORED HERE, and why it matters: the sections whose visibility IS the feature (the stage
 * spine at either density, a status row carrying a `blocked` warning, an open consent prompt) are never
 * wrapped in a collapsible at all, so no key for them can ever exist. That is enforced by placement, not
 * by a deny-list here, because a deny-list would still leave the markup collapsible and one refactor away
 * from hiding a warning.
 */

/** localStorage key for one book's collapse map. */
export function collapseStorageKey(bookId: string): string {
  return `pd:dashboard-collapse:${bookId}`;
}

/** The persisted shape: section id -> collapsed?. Absent id means "use the section's default". */
export type CollapseMap = Record<string, boolean>;

/** Read one book's collapse map. Returns an empty map on any failure (see the fails-open note above). */
export function readCollapseMap(bookId: string | null | undefined): CollapseMap {
  if (!bookId) return {};
  try {
    const raw = localStorage.getItem(collapseStorageKey(bookId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: CollapseMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Write one section's collapsed flag into one book's map, preserving the other sections' entries. */
export function writeCollapseState(
  bookId: string | null | undefined,
  sectionId: string,
  collapsed: boolean,
): void {
  if (!bookId || !sectionId) return;
  try {
    const map = readCollapseMap(bookId);
    map[sectionId] = collapsed;
    localStorage.setItem(collapseStorageKey(bookId), JSON.stringify(map));
  } catch {
    // Fails open: the section still collapses for this session, it just will not be remembered.
  }
}
