/**
 * Where a citation chip goes, per artifact type (chatbot phase B, c2).
 *
 * This is the todo's "citation chip routing per artifact type" spec. The rule it pins is the one that
 * decides whether a chip is useful or a lie: NAVIGATE where a surface exists, render UNLINKED where
 * none does. A chip that navigates "somewhere near" the thing it names is the failure mode.
 */
import { parseArtifactRef } from './chat-artifact-ref';
import { chatArtifactDestination } from './chat-artifact-routing';

const BOOK = 'b1e7c0de-0000-4000-8000-000000000001';

function destinationOf(raw: string, bookId: string | null = BOOK) {
  return chatArtifactDestination(parseArtifactRef(raw), bookId);
}

describe('chatArtifactDestination (chatbot phase B)', () => {
  describe('every artifact type that HAS a surface', () => {
    it('routes a FINDING to the findings ledger', () => {
      const d = destinationOf('finding:2f1c8b30-0000-4000-8000-000000000001');
      expect(d?.link).toEqual(['/books', BOOK]);
      expect(d?.queryParams).toEqual({ focus: 'findings' });
    });

    it('routes the BOOK BRIEF to the Story Bible, which is where it is legible', () => {
      expect(destinationOf('book-brief')?.queryParams).toEqual({ focus: 'story-bible' });
    });

    it('routes BOTH chapter-summary surfaces to the per-chapter briefs list', () => {
      // The generated brief and the author's own summary are two surfaces of one chapter's row, so
      // both land in the same place. Only the chip's LABEL distinguishes them, which is honest: the
      // destination cannot.
      expect(destinationOf('chapter-brief:6')?.queryParams).toEqual({ focus: 'chapter-briefs' });
      expect(destinationOf('chapter-summary:6')?.queryParams).toEqual({ focus: 'chapter-briefs' });
    });

    it('routes CHAPTER TEXT to that chapter in the editor, carrying the 0-based order', () => {
      // The one per-chapter destination. The order is passed through UNCONVERTED: the editor matches
      // it against Chapter.order, which is the same 0-based value the ref carried.
      expect(destinationOf('chapter-text:6')?.queryParams).toEqual({ focus: 'chapter', chapter: 6 });
      expect(destinationOf('chapter-text:0')?.queryParams).toEqual({ focus: 'chapter', chapter: 0 });
    });

    it('routes the REGISTER to the character register editor', () => {
      expect(destinationOf('register')?.queryParams).toEqual({ focus: 'register' });
    });

    it('routes each STATUS to its own row, keeping the stage on the link', () => {
      expect(destinationOf('status:summary')?.queryParams).toEqual({ focus: 'status-summary' });
      expect(destinationOf('status:review')?.queryParams).toEqual({ focus: 'status-review' });
      expect(destinationOf('status:style-baseline')?.queryParams)
        .toEqual({ focus: 'status-style-baseline' });
    });

    it('always links into the book the ANSWER was about', () => {
      const other = 'other-book';
      expect(chatArtifactDestination(parseArtifactRef('register'), other)?.link)
        .toEqual(['/books', other]);
    });
  });

  describe('the chips that must render UNLINKED', () => {
    it('an artifact with NO surface: history', () => {
      // The analysis-history metadata the server sends is per-chapter run records; the client's history
      // view is a tab inside the per-chapter analysis panel with no book-level equivalent. There is
      // nowhere honest to land, so the chip does not pretend there is.
      expect(destinationOf('history')).toBeNull();
    });

    it('an artifact type this build has never heard of', () => {
      expect(destinationOf('sudoku:7')).toBeNull();
    });

    it('a malformed ref, which must not fall through to a default surface', () => {
      expect(destinationOf('chapter-brief:seven')).toBeNull();
      expect(destinationOf('status:everything')).toBeNull();
    });

    it('any ref at all when no book is open', () => {
      // Structurally unreachable today (refs only come back for a book-scoped request) and handled
      // anyway: the alternative is a link to `/books/null`.
      for (const raw of ['register', 'finding:1', 'status:review', 'chapter-text:2']) {
        expect(destinationOf(raw, null)).withContext(raw).toBeNull();
      }
    });
  });
});
