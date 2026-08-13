/**
 * BOOK-ARTIFACT CITATION REFERENCES: parsing the server's `artifactRefs` into something a chip can be
 * built from (chatbot phase B, c2).
 *
 * ── The contract this mirrors ─────────────────────────────────────────────────────────────────────
 * The server builds these strings in ONE place, `Pagedraft.Api/Services/Chat/BookChatArtifacts.cs`
 * (`BookArtifactRefs`), and its own shape test (`LooksLikeArtifactRef`) accepts exactly the prefixes
 * below. The shape is a flat slug on purpose - `<type>` or `<type>:<key>`, no spaces and no brackets -
 * precisely so the client can render both citation families, guide ids and book artifacts, as chips
 * without a second wire format.
 *
 * CASING IS ORDINAL-INSENSITIVE ON THE SERVER and case-preserving here: the server compares refs with
 * `OrdinalIgnoreCase`, so this parser lower-cases the TYPE before matching rather than assuming the
 * exact casing the current server build emits. Cross-stack casing drift is a known failure class in
 * this codebase and it costs one `toLowerCase()` to be immune to it. The KEY is left untouched, since a
 * finding's Guid and a chapter's order are compared to values the client holds, not to a vocabulary.
 *
 * ── Why parsing lives here and ROUTING does not ───────────────────────────────────────────────────
 * A ref is a fact about the answer; a destination is a fact about the app's routes AND about which book
 * is open. Splitting them keeps this file free of `Router`, keeps it trivially testable, and means the
 * "a chip with no destination renders UNLINKED rather than dead" rule is decided in one place that can
 * see both halves (see `chatArtifactDestination` in `chat-artifact-routing.ts`).
 *
 * ── CHAPTER ORDER: the 0-based/1-based decision, stated once ──────────────────────────────────────
 * `Chapter.Order` is 0-BASED throughout the API, and every `chapter-brief:<order>` /
 * `chapter-summary:<order>` / `chapter-text:<order>` key is that raw 0-based value. Authors count from
 * 1. THE DECISION: {@link ChatArtifactRef.chapterOrder} keeps the wire value verbatim (0-based, so it
 * can be matched against a chapter entity without arithmetic) and `chapterDisplayNumber` is the
 * ONLY thing a human ever reads (order + 1). Navigation targets the 0-based order; the chip's label
 * shows the 1-based number. Doing the conversion in one named function rather than sprinkling `+ 1`
 * is what keeps the label and the destination from disagreeing about which chapter is meant.
 *
 * THE FUNCTION IS RE-EXPORTED, NOT DECLARED HERE (be-c02). This file used to declare a second copy of
 * `order + 1` beside the canonical one in `core/utils/chapter-number.ts`, which four other surfaces
 * already call. Two copies that agree today are the shape a third convention grows out of, and the
 * whole point of the helper is that there is exactly one of it. Importers of this module are
 * unaffected: the same symbol is still exported from the same path.
 *
 * ── THE OTHER HALF OF THIS CONTRACT IS ON THE SERVER ──────────────────────────────────────────────
 * The server is 0-based in every label, ref, brief heading and history line it shows the model, and it
 * carries a single translation sentence in the book-aware grounding string telling the model that the
 * author counts from 1. Neither side can run the other's tests, so the agreement is pinned twice:
 * `chat-artifact-ref.spec.ts`'s cross-stack pin here, and
 * `Pagedraft.Api.Tests/ProductChatChapterNumberingTests.cs` there. Both are written against the same
 * literal, `chapter-text:0` being the chapter the author calls chapter 1.
 */

/** The artifact types the server can cite. Closed, and mirrors `BookArtifactRefs`'s prefixes. */
export type ChatArtifactKind =
  | 'chapter-brief'
  | 'chapter-summary'
  | 'chapter-text'
  | 'finding'
  | 'register'
  | 'book-brief'
  | 'history'
  | 'status';

/** The three status artifacts, keyed exactly as `BookArtifactRefs.Status*` spells them. */
export type ChatStatusKind = 'summary' | 'review' | 'style-baseline';

/**
 * One parsed reference.
 *
 * `kind: null` is the important case and it is NOT an error: it is a ref this build has never heard of
 * (a server that grew an eighth artifact type). It still renders, unlinked, showing its raw text -
 * exactly as an unknown GUIDE id still renders as a chip showing its raw id. Hiding it would delete
 * the one piece of provenance the author has for that part of the answer.
 */
export interface ChatArtifactRef {
  /** The wire string, verbatim. What an unrecognized ref falls back to displaying. */
  raw: string;
  /** The recognized type, or null when this build does not know it. */
  kind: ChatArtifactKind | null;
  /** The 0-BASED chapter order, for the three chapter-keyed kinds. Null otherwise. See the file doc. */
  chapterOrder: number | null;
  /** Which status, for `status:*`. Null otherwise, INCLUDING for a `status:` key we do not know. */
  statusKind: ChatStatusKind | null;
  /** The finding's id, for `finding:<guid>`. Passed through verbatim; the ledger matches on it. */
  findingId: string | null;
}

const CHAPTER_KEYED: readonly string[] = ['chapter-brief', 'chapter-summary', 'chapter-text'];
const KINDS: readonly string[] = [
  'chapter-brief',
  'chapter-summary',
  'chapter-text',
  'finding',
  'register',
  'book-brief',
  'history',
  'status',
];
const STATUS_KINDS: readonly string[] = ['summary', 'review', 'style-baseline'];

/**
 * Parse one wire ref.
 *
 * Deliberately total: every input produces a {@link ChatArtifactRef}, and an unparseable one comes back
 * with `kind: null` rather than throwing or being dropped. A citation that silently loses an entry is
 * worse than one that shows a slug the author does not recognize, because the first is invisible.
 *
 * A KEY THAT DOES NOT PARSE DEMOTES THE WHOLE REF to unknown rather than keeping the type and losing
 * the key. `chapter-brief:oops` with the type kept would render a chip labelled "Chapter NaN" and, worse,
 * could route somewhere; unknown renders the raw string unlinked, which is honest.
 */
export function parseArtifactRef(raw: string): ChatArtifactRef {
  const unknown: ChatArtifactRef = {
    raw,
    kind: null,
    chapterOrder: null,
    statusKind: null,
    findingId: null,
  };
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return unknown;

  const colon = trimmed.indexOf(':');
  const type = (colon < 0 ? trimmed : trimmed.slice(0, colon)).toLowerCase();
  const key = colon < 0 ? '' : trimmed.slice(colon + 1).trim();

  if (!KINDS.includes(type)) return unknown;
  const kind = type as ChatArtifactKind;

  // Keyless kinds. A stray key on one of these is a ref this build does not understand, not a
  // keyless ref with noise after it.
  if (kind === 'register' || kind === 'book-brief' || kind === 'history') {
    return key ? unknown : { ...unknown, kind };
  }

  if (!key) return unknown;

  if (CHAPTER_KEYED.includes(kind)) {
    // Strictly an integer >= 0. `parseInt` would accept "7abc"; a whole-string test does not, and a
    // chapter key that is not a chapter number must not become a chip that navigates.
    if (!/^\d+$/.test(key)) return unknown;
    const order = Number(key);
    return Number.isSafeInteger(order) ? { ...unknown, kind, chapterOrder: order } : unknown;
  }

  if (kind === 'status') {
    const status = key.toLowerCase();
    return STATUS_KINDS.includes(status)
      ? { ...unknown, kind, statusKind: status as ChatStatusKind }
      : unknown;
  }

  // finding:<guid>. The id is opaque to this layer: the ledger is what knows whether it resolves, and
  // a client-side Guid regex here would be a second, weaker copy of that authority.
  return { ...unknown, kind, findingId: key };
}

/** Parse a whole `artifactRefs` list, tolerating a null/absent field from a phase-A-shaped response. */
export function parseArtifactRefs(raws: readonly string[] | null | undefined): ChatArtifactRef[] {
  return (raws ?? []).map(parseArtifactRef);
}

/**
 * The chapter number a HUMAN reads, from the 0-based wire order. Re-exported from the app's single
 * owner of that conversion - see the file doc's chapter-order decision.
 */
export { chapterDisplayNumber } from '../utils/chapter-number';
