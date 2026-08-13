import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Observable, distinctUntilChanged, filter, map, startWith } from 'rxjs';

import { BookService } from './book.service';

/**
 * WHICH BOOK THE APP IS CURRENTLY INSIDE, readable from app-level chrome (chatbot phase B, c2).
 *
 * ── Why this service had to exist ─────────────────────────────────────────────────────────────────
 * Nothing app-level knew. The book id lived in `EditorPageComponent`'s route subscription, the title
 * lived in that component's `book` field, and the one other app-level holder of a book id
 * (`SyncService.currentBookId`) is private with no getter. So the dock and everything in it were, by
 * construction, book-blind: `AppDockComponent`'s own doc even reasons from that fact ("reachable from
 * every route including ones where no book is open, so there is no book language to follow").
 *
 * Phase B needs the opposite of blindness in ONE narrow respect - the assistant has to send a bookId and
 * say whose book it is looking at - and it needs it without making the drawer depend on the editor page
 * being mounted. Hence a ROUTE-DERIVED service: the URL is the only thing that is true on every route
 * that has a book (`/books/:bookId`, `.../import`, `.../export`) and false on every route that does not.
 *
 * ── What it deliberately is NOT ───────────────────────────────────────────────────────────────────
 * Not a book store, not a cache other surfaces should read, and not a second owner of book state. It
 * publishes an id and a display title. The editor page keeps loading its own `BookDetailDto` for the
 * chapter list and everything else, and this service does not try to become that. The one HTTP read it
 * does is for the TITLE, and it is skipped entirely when the id has not changed.
 *
 * ── The title read, and what happens while it is in flight ────────────────────────────────────────
 * The id is available SYNCHRONOUSLY from the route; the title is not. Both are published, and the title
 * is nullable, precisely so a consumer can act on the id immediately (a request may carry a bookId
 * before the title lands) while a surface that names the book waits for a real name rather than showing
 * a Guid. A failed title read is not a fault: the id stands, the title stays null, and the drawer says
 * "this book" rather than nothing at all.
 */
export interface CurrentBook {
  /** The route's `bookId`. Always present on this type; a null CONTEXT means "not inside a book". */
  bookId: string;
  /** The book's own title, or null while the read is in flight or if it failed. */
  title: string | null;
  /** The book's language tag, for surfaces that render book content in the book's own direction. */
  language: string | null;
}

@Injectable({ providedIn: 'root' })
export class BookContextService {
  private readonly router = inject(Router);
  private readonly books = inject(BookService);

  private readonly state$ = new BehaviorSubject<CurrentBook | null>(null);

  /**
   * The book the app is inside, or null outside one.
   *
   * Emits on every book CHANGE and again when the title lands. It does NOT emit per navigation within
   * the same book, so a consumer that treats each emission as "the book changed" would still be wrong
   * only in the harmless direction (a title arriving), which is why the transcript's book-switch marker
   * keys on the ID rather than on the emission.
   */
  readonly currentBook$: Observable<CurrentBook | null> = this.state$.asObservable();

  /** Just the id, deduped. What a request body needs. */
  readonly bookId$: Observable<string | null> = this.currentBook$.pipe(
    map(b => b?.bookId ?? null),
    distinctUntilChanged(),
  );

  constructor() {
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        // The service is created lazily by its first injector, which may be AFTER the navigation that
        // put us inside a book. Without this the drawer would stay book-blind until the next navigation,
        // which is exactly the state a user reaches by opening the dock on a book page they loaded
        // directly.
        startWith(null),
      )
      .subscribe(() => this.readRoute());
  }

  /** Synchronous snapshot, for the imperative paths and for specs. */
  get currentBook(): CurrentBook | null {
    return this.state$.value;
  }

  private readRoute(): void {
    const bookId = findBookId(this.router.routerState.snapshot.root);
    const current = this.state$.value;

    if (bookId === (current?.bookId ?? null)) return;

    if (!bookId) {
      this.state$.next(null);
      return;
    }

    // Publish the ID FIRST, title null. A book-scoped request must not have to wait for a display
    // string, and a surface that names the book has a null to branch on meanwhile.
    this.state$.next({ bookId, title: null, language: null });

    this.books.getById(bookId).subscribe({
      next: book => {
        // The author may have navigated on while this was in flight. Landing a stale title on the new
        // book would name the wrong manuscript, which on this surface is worse than naming none.
        if (this.state$.value?.bookId !== bookId) return;
        this.state$.next({ bookId, title: book?.title ?? null, language: book?.language ?? null });
      },
      // Swallowed on purpose, and it is a real decision rather than an oversight: the id is what the
      // request needs and it is already published. A failed title read degrades the LABEL, and the
      // consumer's own copy covers a null title.
      error: () => undefined,
    });
  }
}

/**
 * Walk the activated-route tree for a `bookId` param.
 *
 * The tree rather than a URL regex: `/books` (the list) and `/books/:bookId` differ by a segment that a
 * regex would have to special-case, and the three book-scoped routes nest differently. Reading the param
 * asks the router what it matched instead of re-deriving it.
 */
function findBookId(root: ActivatedRouteSnapshot): string | null {
  const queue: ActivatedRouteSnapshot[] = [root];
  while (queue.length) {
    const node = queue.shift()!;
    const id = node.paramMap.get('bookId');
    if (id) return id;
    queue.push(...node.children);
  }
  return null;
}
