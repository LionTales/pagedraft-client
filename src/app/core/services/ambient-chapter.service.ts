import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * WHICH CHAPTER THE AUTHOR HAS OPEN, readable from app-level chrome (chatbot phase B, a2).
 *
 * ── Why this service had to exist ─────────────────────────────────────────────────────────────────
 * The same reason `BookContextService` had to, one level down, and it is worth stating in the same
 * words because it is the same defect: NOTHING APP-LEVEL KNEW. The open chapter lives entirely inside
 * `EditorPageComponent` as `selectedChapterId`, written by `selectChapter`, by `selectScene`, by the
 * chapter-delete path and by nothing else that publishes it. There is no `chapterId` route segment to
 * derive it from - `app.routes.ts` has exactly one book-scoped editing route, `books/:bookId` - and the
 * `chapter=` query param that does exist is a ONE-SHOT DEEP LINK that the editor consumes and strips
 * within the same tick, not a live indicator of what is on screen.
 *
 * So the drawer, which is app chrome mounted once for the life of the app, was chapter-blind by
 * construction. That is what made the owner's own question ("זה פרק שעבר עריכה...") unanswerable: the
 * request carried a bookId and the server had no way to resolve "this chapter" even though the editor
 * knew exactly which one it was.
 *
 * ── The shape, and why it is a PUSH rather than a route read ──────────────────────────────────────
 * `BookContextService` derives from the router because the URL is the only thing true on every
 * book-scoped route. Here the URL says nothing, so the editor PUSHES. That is the precedent
 * `BookSurfaceFocusService` already set for carrying editor state outward to app chrome: a root-provided
 * channel, written by the feature and read by the dock. `providedIn: 'root'` is load-bearing for the
 * test suite as well as idiom - injecting a non-root service into a component breaks every existing spec
 * of that component with a NullInjector error, and both the editor page and the drawer have large ones.
 *
 * Unlike `BookSurfaceFocusService` this one is STATE, not an event: a focus is a one-shot gesture, but
 * "which chapter is open" has to be readable by a drawer that was opened long after the chapter was.
 * Hence a `BehaviorSubject` that replays to a late subscriber.
 *
 * ── What it deliberately is NOT ───────────────────────────────────────────────────────────────────
 * Not a chapter store and not a second owner of chapter state. The editor remains the only writer and
 * the only loader; this carries a copy of three fields so the drawer can name a chapter and offer a
 * chapter list without a second HTTP round trip.
 *
 * ── THE DASHBOARD CARVE-OUT LIVES IN THE EDITOR, NOT HERE ─────────────────────────────────────────
 * `reviewMode === 'review'` (the whole-book dashboard, embedded in the SAME route) must publish
 * {@link AmbientChapterState.openChapter} as null even though `selectedChapterId` still holds a value,
 * because the author is looking at book-wide artifacts rather than that chapter's prose. The rule is
 * applied at the publishing site rather than by a reader, so there is exactly one place it can be got
 * wrong, and the server logs the ambient key on every turn so a client that gets it wrong is visible
 * rather than silent. The server cannot enforce it: it can verify only that the id names a chapter of
 * this book, and an editor-with-a-chapter and a dashboard look identical from there.
 */

/** One chapter, as much of it as app-level chrome needs. */
export interface AmbientChapterChoice {
  id: string;
  /** `Chapter.Order`, 0-BASED, exactly as the wire carries it. `chapterDisplayNumber` is the only +1. */
  order: number;
  title: string;
}

/** What the editor publishes. Always scoped to ONE book; a reader must check whose. */
export interface AmbientChapterState {
  /** The book this snapshot belongs to. A reader must ignore a snapshot for a different book. */
  bookId: string;
  /**
   * The chapter whose text is in front of the author, or null when none is: an empty book, the
   * deleted-with-no-replacement state, or the book-review dashboard (see the class doc's carve-out).
   */
  openChapter: AmbientChapterChoice | null;
  /**
   * Every chapter of the book, in order. Carried so the clarifying question's one-click chips can be
   * offered without a second HTTP read; it is populated on the dashboard too, where `openChapter` is
   * null but the author is still inside the book.
   */
  chapters: readonly AmbientChapterChoice[];
}

@Injectable({ providedIn: 'root' })
export class AmbientChapterService {
  private readonly state$ = new BehaviorSubject<AmbientChapterState | null>(null);

  /**
   * The open chapter, or null when no editor is mounted at all.
   *
   * NULL IS A REAL STATE AND IT IS NOT THE SAME AS "no chapter open": null here means no book surface
   * is publishing (the books list, the import and export pages, `/help`), while a state whose
   * `openChapter` is null means a book IS open and no chapter of it is on screen. The request the
   * drawer builds keeps that distinction, which is the whole reason the wire fields are sent as
   * explicit nulls rather than omitted.
   */
  readonly ambient$: Observable<AmbientChapterState | null> = this.state$.asObservable();

  /** Synchronous snapshot, for the imperative paths and for specs. */
  get ambient(): AmbientChapterState | null {
    return this.state$.value;
  }

  /**
   * The state, but ONLY when it belongs to `bookId`.
   *
   * The guard is the point. A book switch moves `BookContextService` and this service on different
   * ticks, so for one frame the drawer can hold book B while this still holds book A's chapter. Sending
   * that pair would ground an answer about book B in a chapter of book A, which is the wrong-chapter
   * fabrication this whole plan exists to prevent, with the books swapped.
   */
  forBook(bookId: string | null | undefined): AmbientChapterState | null {
    const state = this.state$.value;
    return state && bookId && state.bookId === bookId ? state : null;
  }

  /** Publish a fresh snapshot. The editor page is the only writer. */
  publish(state: AmbientChapterState | null): void {
    this.state$.next(state);
  }

  /**
   * No book surface is publishing any more.
   *
   * Called from the editor's `ngOnDestroy`, which is what makes the import and export pages report no
   * ambient chapter: they are book-scoped routes where `BookContextService` still names the book, so
   * without this the last chapter the author had open would keep riding on requests made from a page
   * that is not showing it. Idempotent, so a second teardown cannot emit a redundant null.
   */
  clear(): void {
    if (this.state$.value !== null) this.state$.next(null);
  }
}
