/**
 * AmbientChapterService: the publication seam that carries the open chapter out of the editor and into
 * app-level chrome (chatbot phase B, a2).
 *
 * There is almost nothing to it by design, so what is worth pinning is the two properties a reader
 * depends on: a late subscriber still learns the current state (the drawer is opened long after the
 * chapter was), and {@link AmbientChapterService.forBook} refuses a snapshot that belongs to a
 * different book.
 */
import { TestBed } from '@angular/core/testing';

import { AmbientChapterService, AmbientChapterState } from './ambient-chapter.service';

const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

function state(over: Partial<AmbientChapterState> = {}): AmbientChapterState {
  return {
    bookId: BOOK_A,
    openChapter: { id: 'ch-1', order: 0, title: 'פרק 28' },
    chapters: [{ id: 'ch-1', order: 0, title: 'פרק 28' }],
    ...over,
  };
}

describe('AmbientChapterService (chatbot phase B, a2)', () => {
  let svc: AmbientChapterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(AmbientChapterService);
  });

  it('starts null: nothing is publishing until a book surface mounts', () => {
    expect(svc.ambient).toBeNull();
    let seen: AmbientChapterState | null | undefined;
    svc.ambient$.subscribe(s => (seen = s));
    expect(seen).toBeNull();
  });

  it('REPLAYS the current state to a subscriber that arrives later', () => {
    // The load-bearing property: the drawer is mounted once for the life of the app and can be opened
    // long after the author opened the chapter. A plain event channel would leave it chapter-blind
    // until the next chapter change.
    svc.publish(state());
    let seen: AmbientChapterState | null | undefined;
    svc.ambient$.subscribe(s => (seen = s));
    expect(seen?.openChapter?.id).toBe('ch-1');
  });

  describe('forBook', () => {
    it('returns the state when the book matches', () => {
      svc.publish(state());
      expect(svc.forBook(BOOK_A)?.openChapter?.order).toBe(0);
    });

    it('REFUSES a snapshot belonging to a DIFFERENT book', () => {
      // A book switch moves the route-derived book and this pushed chapter on different ticks. Sending
      // the pair from that window would ground an answer about book B in a chapter of book A, which is
      // the same wrong-chapter fabrication the plan exists to prevent with the books swapped.
      svc.publish(state({ bookId: BOOK_A }));
      expect(svc.forBook(BOOK_B)).toBeNull();
    });

    it('refuses when the reader is outside any book', () => {
      svc.publish(state());
      expect(svc.forBook(null)).toBeNull();
      expect(svc.forBook(undefined)).toBeNull();
      expect(svc.forBook('')).toBeNull();
    });
  });

  describe('the two kinds of null', () => {
    it('distinguishes "no surface is publishing" from "a book is open with no chapter"', () => {
      // The wire keeps this distinction (an explicit null vs an absent key), so the service has to hold
      // it too rather than collapsing both to a bare null.
      svc.publish(state({ openChapter: null, chapters: [] }));
      expect(svc.ambient).not.toBeNull();
      expect(svc.ambient?.openChapter).toBeNull();

      svc.clear();
      expect(svc.ambient).toBeNull();
    });

    it('clear() is idempotent: a second teardown emits nothing', () => {
      const seen: (AmbientChapterState | null)[] = [];
      svc.ambient$.subscribe(s => seen.push(s));
      svc.clear();
      svc.clear();
      expect(seen).toEqual([null]);
    });
  });
});
