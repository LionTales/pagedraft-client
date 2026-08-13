import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * THE DEEP-LINK SEAM for the in-book surfaces (chatbot phase B, c2).
 *
 * ── The problem this exists to solve ──────────────────────────────────────────────────────────────
 * Phase B's citation chips name book artifacts - a finding, a chapter brief, the character register, a
 * build status - and the todo's rule is that a chip NAVIGATES where a surface exists and renders
 * UNLINKED where one does not. Every one of those surfaces exists. NONE of them was addressable: they
 * all live inside `BookDashboardComponent`, which is not a route but a child mounted conditionally
 * inside the editor's review panel, behind `reviewMode === 'review'`, and two of them additionally sit
 * inside sections that are collapsed by default. There is no `?panel=`, no fragment, and
 * `provideRouter` is configured without anchor scrolling, so `[fragment]` would not scroll either.
 *
 * ── The shape, and why it is a URL param rather than only a service call ──────────────────────────
 * A `focus` QUERY PARAM on `/books/:bookId` is what a chip links to, which means the chip is an ordinary
 * `routerLink`: it works from any route, it works when the drawer is open on a DIFFERENT book (the
 * navigation changes book and focus in one step), middle-click and copy-link behave, and a same-book
 * chip does not remount the editor. The param is read by `EditorPageComponent` and then STRIPPED from
 * the URL, following the shipped `imported=1` precedent exactly - a sticky focus param would re-force
 * the review panel open on every refresh and override a later choice by the author, which is the exact
 * bug the `imported` strip was added to fix.
 *
 * This service is the second half: the editor page consumes the param and PUBLISHES the request here,
 * and `BookDashboardComponent` subscribes. It is a plain event channel rather than state, because a
 * focus is a one-shot gesture: replaying the last one to a late subscriber would scroll the author away
 * from wherever they had got to.
 *
 * `providedIn: 'root'` is load-bearing for the test suite, not just idiom: injecting a non-root service
 * into a component breaks every existing spec of that component with a NullInjector error, and both the
 * editor page and the dashboard have large ones.
 */

/** The surfaces a citation chip can ask for. Closed, so a typo does not compile. */
export type BookSurfaceTarget =
  /** The whole-book review findings ledger. */
  | 'findings'
  /** The Story Bible tab beside the ledger, which is where the book-level brief is legible. */
  | 'story-bible'
  /** The per-chapter briefs ("the inputs to this build"), a section that is collapsed by default. */
  | 'chapter-briefs'
  /** The character register editor, likewise collapsed by default. */
  | 'register'
  /** The three build/staleness status rows. */
  | 'status'
  /** One chapter's text, in the editor itself. */
  | 'chapter';

/** Which status row, when {@link BookSurfaceTarget} is `status`. Mirrors the server's `status:<key>`. */
export type BookStatusStage = 'summary' | 'review' | 'style-baseline';

/** One focus request. */
export interface BookSurfaceFocusRequest {
  target: BookSurfaceTarget;
  /** Set only for `status`. */
  stage?: BookStatusStage;
  /** Set only for `chapter`: the 0-BASED chapter order, exactly as the wire ref carries it. */
  chapterOrder?: number;
}

/**
 * The `focus` query-param vocabulary, flattened so one param carries the whole request except the
 * chapter order (which rides in its own `chapter` param, since it is a number rather than a token).
 */
const TOKENS: Record<string, BookSurfaceFocusRequest> = {
  'findings': { target: 'findings' },
  'story-bible': { target: 'story-bible' },
  'chapter-briefs': { target: 'chapter-briefs' },
  'register': { target: 'register' },
  'status-summary': { target: 'status', stage: 'summary' },
  'status-review': { target: 'status', stage: 'review' },
  'status-style-baseline': { target: 'status', stage: 'style-baseline' },
  'chapter': { target: 'chapter' },
};

/** The token a request travels as. The inverse of {@link parseBookSurfaceFocus}. */
export function bookSurfaceFocusToken(request: BookSurfaceFocusRequest): string {
  if (request.target === 'status') return `status-${request.stage ?? 'summary'}`;
  return request.target;
}

/**
 * Parse a `focus` param (plus the companion `chapter` param) into a request.
 *
 * Returns null for anything unrecognized rather than guessing. A focus token this build does not know
 * must do NOTHING - a link from a newer build should not scroll the author to an arbitrary section
 * because a lookup fell through to a default.
 */
export function parseBookSurfaceFocus(
  focus: string | null | undefined,
  chapter?: string | null
): BookSurfaceFocusRequest | null {
  const token = (focus ?? '').trim().toLowerCase();
  const base = TOKENS[token];
  if (!base) return null;

  if (base.target !== 'chapter') return { ...base };

  // A chapter focus with no usable order is not a chapter focus. Falling back to "chapter 0" would
  // open a chapter the author never asked for.
  const order = Number((chapter ?? '').trim());
  if (!/^\d+$/.test((chapter ?? '').trim()) || !Number.isSafeInteger(order)) return null;
  return { target: 'chapter', chapterOrder: order };
}

@Injectable({ providedIn: 'root' })
export class BookSurfaceFocusService {
  private readonly requests$ = new Subject<BookSurfaceFocusRequest>();

  /** Focus requests, as they are made. Deliberately NOT replayed - see the class doc. */
  readonly focus$: Observable<BookSurfaceFocusRequest> = this.requests$.asObservable();

  /** Ask the book surfaces to bring `request` into view. */
  request(request: BookSurfaceFocusRequest): void {
    this.requests$.next(request);
  }
}
