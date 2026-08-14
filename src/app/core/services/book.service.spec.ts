import { BookService } from './book.service';

/**
 * w7 (Q5): `BookService.ask` is retired.
 *
 * Asserted at the CLASS rather than at a test double: a `jasmine.createSpyObj('BookService', [...])`
 * will happily mint an `ask` spy for a method that no longer exists, so a "was not called" assertion
 * against the double would pass whether or not the real removal happened. This pin used to live inside
 * the book dashboard's spec (the ask card's own former home), which meant a future feature legitimately
 * re-adding `ask()` would turn a DASHBOARD spec red with a misleading message, naming a component that
 * has nothing to do with the change. It belongs here, on the class the fact is actually about
 * (finding C7).
 */
describe('BookService (w7 / Q5)', () => {
  it('has no ask method: the ask card is gone, and nothing else in the client ever posted to /ask', () => {
    // The server surface is untouched (`POST /api/books/{id}/ask`, `AnalysisType.QA`) - this pins the
    // CLIENT removal only.
    expect(Object.getOwnPropertyNames(BookService.prototype))
      .withContext('w7: BookService.ask is removed, so no client surface can post to /ask any more')
      .not.toContain('ask');
  });
});
