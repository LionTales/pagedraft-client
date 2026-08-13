/**
 * The `focus` deep-link vocabulary and channel (chatbot phase B, c2).
 *
 * The parser is where a link from a NEWER build meets an older client, so the important assertion here
 * is the negative one: an unrecognized token must do NOTHING, never fall through to a default surface
 * and scroll the author somewhere they did not ask to go.
 */
import { TestBed } from '@angular/core/testing';

import {
  BookSurfaceFocusRequest,
  BookSurfaceFocusService,
  bookSurfaceFocusToken,
  parseBookSurfaceFocus,
} from './book-surface-focus.service';

describe('parseBookSurfaceFocus (chatbot phase B)', () => {
  it('parses every token the routing layer can emit', () => {
    expect(parseBookSurfaceFocus('findings')).toEqual({ target: 'findings' });
    expect(parseBookSurfaceFocus('story-bible')).toEqual({ target: 'story-bible' });
    expect(parseBookSurfaceFocus('chapter-briefs')).toEqual({ target: 'chapter-briefs' });
    expect(parseBookSurfaceFocus('register')).toEqual({ target: 'register' });
    expect(parseBookSurfaceFocus('status-summary')).toEqual({ target: 'status', stage: 'summary' });
    expect(parseBookSurfaceFocus('status-review')).toEqual({ target: 'status', stage: 'review' });
    expect(parseBookSurfaceFocus('status-style-baseline'))
      .toEqual({ target: 'status', stage: 'style-baseline' });
    expect(parseBookSurfaceFocus('chapter', '6')).toEqual({ target: 'chapter', chapterOrder: 6 });
  });

  it('round-trips against the token builder the chips use', () => {
    // The two halves live in one file precisely so they cannot drift; this asserts they have not.
    const requests: BookSurfaceFocusRequest[] = [
      { target: 'findings' },
      { target: 'story-bible' },
      { target: 'chapter-briefs' },
      { target: 'register' },
      { target: 'status', stage: 'summary' },
      { target: 'status', stage: 'review' },
      { target: 'status', stage: 'style-baseline' },
    ];
    for (const request of requests) {
      expect(parseBookSurfaceFocus(bookSurfaceFocusToken(request)))
        .withContext(bookSurfaceFocusToken(request))
        .toEqual(request);
    }
  });

  it('reads chapter 0 as a real chapter', () => {
    expect(parseBookSurfaceFocus('chapter', '0')).toEqual({ target: 'chapter', chapterOrder: 0 });
  });

  it('returns null for a chapter focus with no usable order', () => {
    // Falling back to "chapter 0" would open a chapter the author never asked for.
    for (const chapter of [undefined, null, '', 'six', '-1', '2.5']) {
      expect(parseBookSurfaceFocus('chapter', chapter)).withContext(String(chapter)).toBeNull();
    }
  });

  it('returns null for an unknown, blank or absent token', () => {
    for (const token of ['everything', 'FINDINGS-2', '', null, undefined]) {
      expect(parseBookSurfaceFocus(token)).withContext(String(token)).toBeNull();
    }
  });

  it('is case-insensitive on the token, so a hand-typed link still works', () => {
    expect(parseBookSurfaceFocus('Findings')).toEqual({ target: 'findings' });
  });
});

describe('BookSurfaceFocusService', () => {
  let svc: BookSurfaceFocusService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(BookSurfaceFocusService);
  });

  it('delivers a request to a live subscriber', () => {
    const seen: BookSurfaceFocusRequest[] = [];
    svc.focus$.subscribe(r => seen.push(r));
    svc.request({ target: 'findings' });
    expect(seen).toEqual([{ target: 'findings' }]);
  });

  it('does NOT replay the last request to a late subscriber', () => {
    // A focus is a gesture, not state. Replaying it would scroll the author away from wherever they
    // had got to, at whatever later moment a surface happened to mount.
    svc.request({ target: 'register' });
    const seen: BookSurfaceFocusRequest[] = [];
    svc.focus$.subscribe(r => seen.push(r));
    expect(seen).toEqual([]);
  });
});
