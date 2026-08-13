/**
 * WHERE A BOOK-ARTIFACT CITATION CHIP GOES (chatbot phase B, c2).
 *
 * Kept apart from `chat-artifact-ref.ts` because the two answer different questions: a ref is a fact
 * about the answer, a destination is a fact about this app's routes AND about which book is open. This
 * file is the only place that knows both, which is what lets the todo's rule live in one readable
 * function: NAVIGATE where a surface exists, render UNLINKED where none does.
 *
 * ── The rule, and the three ways a chip ends up unlinked ──────────────────────────────────────────
 *  1. THE REF IS UNKNOWN to this build (`kind: null`). A newer server citing an eighth artifact type
 *     still gets a chip showing its raw slug, because dropping it would delete the answer's provenance.
 *  2. THE ARTIFACT HAS NO SURFACE. `history` is the one shipped ref in this class: the analysis-history
 *     metadata the server sends is per-chapter run records, and the client's history view is a tab
 *     inside the per-chapter analysis panel with no book-level equivalent to land on. A chip that
 *     navigated "somewhere near it" would be worse than one that plainly does not navigate.
 *  3. NO BOOK IS OPEN. Structurally unreachable today (artifact refs only come back when the request
 *     carried a bookId), and handled anyway, because the alternative is a `/books/null` link.
 *
 * ── CHAPTER ORDER ─────────────────────────────────────────────────────────────────────────────────
 * Every destination below uses the wire's 0-BASED order verbatim; `chapterDisplayNumber` is what turns
 * it into the number a human reads. See the decision recorded in `chat-artifact-ref.ts`.
 */

import { Params } from '@angular/router';

import { ChatArtifactRef } from './chat-artifact-ref';
import { BookSurfaceFocusRequest, bookSurfaceFocusToken } from '../services/book-surface-focus.service';

/** A `routerLink` plus its query params, ready to bind. */
export interface ChatArtifactDestination {
  link: unknown[];
  queryParams: Params;
}

/**
 * The destination for one parsed ref, or null when the chip must render unlinked.
 *
 * @param bookId The book the answer was about. Null outside a book (see rule 3 above).
 */
export function chatArtifactDestination(
  ref: ChatArtifactRef,
  bookId: string | null
): ChatArtifactDestination | null {
  if (!bookId) return null;

  const focus = focusFor(ref);
  if (!focus) return null;

  const queryParams: Params = { focus: bookSurfaceFocusToken(focus) };
  if (focus.chapterOrder !== undefined) queryParams['chapter'] = focus.chapterOrder;

  return { link: ['/books', bookId], queryParams };
}

/** Which in-book surface answers for this artifact, or null when none does. */
function focusFor(ref: ChatArtifactRef): BookSurfaceFocusRequest | null {
  switch (ref.kind) {
    case 'finding':
      // The LEDGER, not the individual finding: nothing in the ledger takes a target finding id today,
      // and inventing a per-finding scroll is a different feature than a citation chip. The ledger is a
      // real destination and the chip is honest about being one.
      return { target: 'findings' };

    case 'book-brief':
      // The book-level brief has no card of its own; the Story Bible is the surface that renders the
      // same rolled-up material in a form the author reads.
      return { target: 'story-bible' };

    case 'chapter-brief':
    case 'chapter-summary':
      // Both surfaces of one chapter's summary live in the same per-chapter list ("the inputs to this
      // build"), so both chips land there. The chip's LABEL is what distinguishes the generated brief
      // from the author's own summary; the destination cannot, and pretending otherwise would mean two
      // links to one place that differ only in a promise neither can keep.
      return { target: 'chapter-briefs' };

    case 'chapter-text':
      // The one per-chapter destination, and the one that most deserves to be: an answer grounded in
      // the chapter's actual text should open that chapter, not a summary of it.
      return ref.chapterOrder === null
        ? null
        : { target: 'chapter', chapterOrder: ref.chapterOrder };

    case 'register':
      return { target: 'register' };

    case 'status':
      return ref.statusKind === null ? null : { target: 'status', stage: ref.statusKind };

    // `history` and every unknown kind: no surface, so no link. See rules 1 and 2 in the file doc.
    default:
      return null;
  }
}
