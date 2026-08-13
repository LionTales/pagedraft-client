/**
 * Which book the app is inside, read at APP level (chatbot phase B, c2).
 *
 * Driven through the REAL Router with real routes rather than a stub, because the whole point of the
 * service is that it derives the book from what the router actually matched: a stub that returned a
 * paramMap would test the walk and not the derivation, and the three book-scoped routes nest
 * differently from each other.
 */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';

import { BookContextService, CurrentBook } from './book-context.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

describe('BookContextService (chatbot phase B)', () => {
  let svc: BookContextService;
  let router: Router;
  let http: HttpTestingController;
  let seen: (CurrentBook | null)[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'books', component: BlankComponent },
          { path: 'books/:bookId', component: BlankComponent },
          { path: 'books/:bookId/export', component: BlankComponent },
          { path: 'help', component: BlankComponent },
        ]),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(BookContextService);
    seen = [];
    svc.currentBook$.subscribe(b => seen.push(b));
  });

  afterEach(() => http.verify());

  /** Navigate and let the router settle. */
  function go(url: string): void {
    router.navigateByUrl(url);
    tick();
  }

  /** Answer the title read this service issues on entering a book. */
  function flushTitle(bookId: string, title: string, language = 'he'): void {
    http.expectOne(`/api/books/${bookId}`).flush({ id: bookId, title, language, chapters: [] });
    tick();
  }

  it('is null outside any book, and issues no read', fakeAsync(() => {
    go('/books');
    expect(svc.currentBook).toBeNull();
    go('/help');
    expect(svc.currentBook).toBeNull();
    http.expectNone(() => true);
  }));

  it('ENTERING a book publishes the id IMMEDIATELY, before the title lands', fakeAsync(() => {
    // A book-scoped request must not have to wait for a display string, and the surface that names the
    // book has a null title to branch on meanwhile.
    go(`/books/${BOOK_A}`);
    expect(svc.currentBook?.bookId).toBe(BOOK_A);
    expect(svc.currentBook?.title).toBeNull();

    flushTitle(BOOK_A, 'A Study in Drafts');
    expect(svc.currentBook?.title).toBe('A Study in Drafts');
  }));

  it('resolves the book on a NESTED book route too', fakeAsync(() => {
    go(`/books/${BOOK_A}/export`);
    expect(svc.currentBook?.bookId).toBe(BOOK_A);
    flushTitle(BOOK_A, 'A Study in Drafts');
  }));

  it('SWITCHING books swaps the context and re-reads the title', fakeAsync(() => {
    go(`/books/${BOOK_A}`);
    flushTitle(BOOK_A, 'Book A');

    go(`/books/${BOOK_B}`);
    expect(svc.currentBook?.bookId).toBe(BOOK_B);
    expect(svc.currentBook?.title)
      .withContext('the previous book\'s title must not linger over the new one')
      .toBeNull();
    flushTitle(BOOK_B, 'Book B');
    expect(svc.currentBook?.title).toBe('Book B');
  }));

  it('LEAVING every book clears the context', fakeAsync(() => {
    go(`/books/${BOOK_A}`);
    flushTitle(BOOK_A, 'Book A');
    go('/books');
    expect(svc.currentBook).toBeNull();
  }));

  it('does NOT re-read or re-emit for a navigation within the SAME book', fakeAsync(() => {
    go(`/books/${BOOK_A}`);
    flushTitle(BOOK_A, 'Book A');
    const emissions = seen.length;

    go(`/books/${BOOK_A}/export`);
    http.expectNone(`/api/books/${BOOK_A}`);
    expect(seen.length).toBe(emissions);
  }));

  it('a LATE title for a book the author already left is discarded', fakeAsync(() => {
    // Landing a stale title on the new book would name the wrong manuscript, which on a surface whose
    // job is to say which book it is looking at is worse than naming none.
    go(`/books/${BOOK_A}`);
    const slow = http.expectOne(`/api/books/${BOOK_A}`);

    go(`/books/${BOOK_B}`);
    slow.flush({ id: BOOK_A, title: 'Book A', language: 'he', chapters: [] });
    tick();

    expect(svc.currentBook?.bookId).toBe(BOOK_B);
    expect(svc.currentBook?.title).toBeNull();
    flushTitle(BOOK_B, 'Book B');
  }));

  it('a FAILED title read leaves the id standing, with a null title', fakeAsync(() => {
    // The id is what the request needs and it is already published. A failure degrades the LABEL only.
    go(`/books/${BOOK_A}`);
    http.expectOne(`/api/books/${BOOK_A}`).error(new ProgressEvent('network error'));
    tick();

    expect(svc.currentBook?.bookId).toBe(BOOK_A);
    expect(svc.currentBook?.title).toBeNull();
  }));

  it('bookId$ emits only on a real book CHANGE, not when the title lands', fakeAsync(() => {
    const ids: (string | null)[] = [];
    svc.bookId$.subscribe(id => ids.push(id));

    go(`/books/${BOOK_A}`);
    flushTitle(BOOK_A, 'Book A');
    go('/books');

    expect(ids).toEqual([null, BOOK_A, null]);
  }));
});
