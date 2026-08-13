/**
 * ProductChatService: the wire shape of `POST /api/product-chat` (chatbot phase A, c2).
 *
 * The service is thin on purpose, so what is worth pinning is exactly the boundary: the request body
 * the server documented, and the bound this client puts on it.
 */
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { ProductChatService } from './product-chat.service';
import { ProductChatRequest, ProductChatResponseDto, ProductChatTurnDto } from '../models/product-chat';

describe('ProductChatService (chatbot phase A)', () => {
  let svc: ProductChatService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ProductChatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function grounded(): ProductChatResponseDto {
    return {
      answer: 'Import accepts DOCX.',
      guideIds: ['import'],
      language: 'en',
      isGrounded: true,
      faultReason: null,
    };
  }

  it('POSTs to /api/product-chat with question, history and language', () => {
    let got: ProductChatResponseDto | undefined;
    svc.ask('how do I import?', [{ role: 'user', content: 'hi' }], 'en').subscribe(r => (got = r));

    const req = http.expectOne('/api/product-chat');
    expect(req.request.method).toBe('POST');

    const body = req.request.body as ProductChatRequest;
    expect(body.question).toBe('how do I import?');
    expect(body.language).toBe('en');
    expect(body.history).toEqual([{ role: 'user', content: 'hi' }]);

    req.flush(grounded());
    expect(got?.guideIds).toEqual(['import']);
  });

  it('sends an empty history array rather than omitting the field', () => {
    svc.ask('q', [], 'he').subscribe();
    const req = http.expectOne('/api/product-chat');
    expect((req.request.body as ProductChatRequest).history).toEqual([]);
    req.flush(grounded());
  });

  it('sends only the LAST MaxSentTurns turns, oldest-first within that window', () => {
    const turns: ProductChatTurnDto[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn-${i}`,
    }));

    svc.ask('q', turns, 'he').subscribe();

    const req = http.expectOne('/api/product-chat');
    const body = req.request.body as ProductChatRequest;
    expect(body.history.length).toBe(ProductChatService.MaxSentTurns);
    // The window is the TAIL: the most recent turns are the ones that carry the thread.
    expect(body.history[body.history.length - 1].content).toBe('turn-19');
    expect(body.history[0].content).toBe(`turn-${20 - ProductChatService.MaxSentTurns}`);
    req.flush(grounded());
  });

  it('does not mutate or alias the caller\'s history array', () => {
    const turns: ProductChatTurnDto[] = [{ role: 'user', content: 'a' }];
    svc.ask('q', turns, 'he').subscribe();

    const req = http.expectOne('/api/product-chat');
    const body = req.request.body as ProductChatRequest;
    expect(body.history).not.toBe(turns as unknown as ProductChatTurnDto[]);
    expect(body.history[0]).not.toBe(turns[0]);
    expect(turns.length).toBe(1);
    req.flush(grounded());
  });

  it('passes a fail-safe response THROUGH untouched (the client decides how to render it)', () => {
    // The service must not translate a fault into prose or swallow it: `isGrounded` is the surface's
    // branch to take, and a service that "helpfully" normalized it would erase the distinction.
    let got: ProductChatResponseDto | undefined;
    svc.ask('q', [], 'he').subscribe(r => (got = r));

    http.expectOne('/api/product-chat').flush({
      answer: 'I cannot reach the guides right now.',
      guideIds: [],
      language: 'he',
      isGrounded: false,
      faultReason: 'guides-unavailable',
    } satisfies ProductChatResponseDto);

    expect(got?.isGrounded).toBeFalse();
    expect(got?.faultReason).toBe('guides-unavailable');
    expect(got?.guideIds).toEqual([]);
  });

  it('surfaces a transport failure as an error rather than a fabricated answer', () => {
    let errored = false;
    svc.ask('q', [], 'he').subscribe({ error: () => (errored = true) });
    http.expectOne('/api/product-chat').error(new ProgressEvent('network error'));
    expect(errored).toBeTrue();
  });

  // ── Phase B: the book id on the wire ────────────────────────────────────────────────────────────

  describe('bookId (chatbot phase B)', () => {
    it('sends the bookId when one is supplied', () => {
      svc.ask('what happens in chapter 3?', [], 'en', 'b1e7c0de-0000-4000-8000-000000000001').subscribe();

      const body = http.expectOne('/api/product-chat').request.body as ProductChatRequest;
      expect(body.bookId).toBe('b1e7c0de-0000-4000-8000-000000000001');
      http.verify();
    });

    it('OMITS the property entirely with no book, keeping the phase-A body byte-identical', () => {
      // Not `bookId: null`. The server treats absent and null the same, but phase A's gate verdict is a
      // measurement of a body with no such property, and the cheapest way to keep the no-book path
      // unchanged in fact is to keep it unchanged on the wire.
      for (const absent of [undefined, null, '']) {
        svc.ask('q', [], 'he', absent).subscribe();
        const body = http.expectOne('/api/product-chat').request.body as ProductChatRequest;
        expect(Object.keys(body))
          .withContext(`bookId=${JSON.stringify(absent)} must not add a property`)
          .toEqual(['question', 'history', 'language']);
        http.verify();
      }
    });

    it('reads back artifactRefs and bookFaultReason without touching them', () => {
      // The service stays thin: it is the SURFACE that decides what a ref renders as and whether a
      // book fault is a note or a failure. A service that normalized either would be re-deciding the
      // contract at the transport layer.
      let got: ProductChatResponseDto | undefined;
      svc.ask('q', [], 'he', 'book-1').subscribe(r => (got = r));

      http.expectOne('/api/product-chat').flush({
        answer: 'a',
        guideIds: [],
        language: 'he',
        isGrounded: true,
        faultReason: null,
        artifactRefs: ['chapter-brief:6', 'status:review'],
        bookFaultReason: 'findings-unreadable',
      } satisfies ProductChatResponseDto);

      expect(got?.artifactRefs).toEqual(['chapter-brief:6', 'status:review']);
      expect(got?.bookFaultReason).toBe('findings-unreadable');
      // The phase-A contract is untouched by a PARTIAL book fault: the answer still stands.
      expect(got?.isGrounded).toBeTrue();
      expect(got?.faultReason).toBeNull();
    });
  });

  // ── Phase B / a2: the AMBIENT CHAPTER on the wire ───────────────────────────────────────────────

  describe('the ambient chapter (chatbot phase B, a2)', () => {
    const BOOK = 'b1e7c0de-0000-4000-8000-000000000001';

    function bodyOf(): ProductChatRequest {
      const body = http.expectOne('/api/product-chat').request.body as ProductChatRequest;
      http.verify();
      return body;
    }

    it('sends the open chapter\'s id AND order alongside the book', () => {
      svc.ask('זה פרק שעבר עריכה', [], 'he', BOOK, { id: 'ch-9', order: 4 }).subscribe();
      const body = bodyOf();
      expect(body.ambientChapterId).toBe('ch-9');
      expect(body.ambientChapterOrder).toBe(4);
    });

    it('sends ORDER 0 as 0, not as "no chapter"', () => {
      // `Chapter.Order` is 0-based and the owner's real book is a single chapter AT ORDER 0. A `||`
      // fallback anywhere on this path would send "nothing is open" for the exact book this feature
      // was written about, and the request would still look perfectly well-formed.
      svc.ask('q', [], 'he', BOOK, { id: 'ch-1', order: 0 }).subscribe();
      const body = bodyOf();
      expect(body.ambientChapterOrder).toBe(0);
      expect(body.ambientChapterId).toBe('ch-1');
    });

    it('sends BOTH keys as EXPLICIT NULL when a book is open and no chapter is', () => {
      // Not omitted. "The drawer is open on the book dashboard" and "this client is too old to say"
      // must not be the same request, and the only thing that separates them is whether the key is
      // present. `in` rather than a value check, because `undefined` and a written null both read as
      // null once the body is compared loosely.
      for (const none of [undefined, null]) {
        svc.ask('q', [], 'he', BOOK, none).subscribe();
        const body = bodyOf();
        expect('ambientChapterId' in body)
          .withContext(`ambient=${JSON.stringify(none)} must still emit the key`)
          .toBeTrue();
        expect('ambientChapterOrder' in body).toBeTrue();
        expect(body.ambientChapterId).toBeNull();
        expect(body.ambientChapterOrder).toBeNull();
      }
    });

    it('emits exactly the four phase-B properties inside a book, in a stable shape', () => {
      svc.ask('q', [], 'he', BOOK, { id: 'ch-1', order: 0 }).subscribe();
      expect(Object.keys(bodyOf()))
        .toEqual(['question', 'history', 'language', 'bookId', 'ambientChapterId', 'ambientChapterOrder']);
    });

    it('OMITS both ambient keys with NO book, keeping the phase-A body byte-identical', () => {
      // The no-book path is what phase A's gate verdict measured. An ambient key there would change a
      // request whose behaviour is not allowed to move, and it would say nothing: there is no book for
      // a chapter to be a chapter OF.
      for (const chapter of [undefined, null, { id: 'ch-1', order: 0 }]) {
        svc.ask('how do I import?', [], 'he', null, chapter).subscribe();
        expect(Object.keys(bodyOf()))
          .withContext(`chapter=${JSON.stringify(chapter)} must not add a property outside a book`)
          .toEqual(['question', 'history', 'language']);
      }
    });

    it('reads back needsChapterClarification without touching it', () => {
      // The service stays thin here too: whether an ask for clarification becomes chips is the
      // SURFACE's decision, and the one-chapter guard lives with the surface that would render them.
      let got: ProductChatResponseDto | undefined;
      svc.ask('q', [], 'he', BOOK, null).subscribe(r => (got = r));

      http.expectOne('/api/product-chat').flush({
        answer: 'Which chapter did you mean?',
        guideIds: [],
        language: 'en',
        isGrounded: true,
        faultReason: null,
        needsChapterClarification: true,
      } satisfies ProductChatResponseDto);

      expect(got?.needsChapterClarification).toBeTrue();
    });

    it('leaves needsChapterClarification UNDEFINED when the server omits it', () => {
      // A phase-A-shaped response, or a server that predates the field. `=== true` is the reading rule
      // at the surface, so an absent field must arrive absent rather than defaulted to anything.
      let got: ProductChatResponseDto | undefined;
      svc.ask('q', [], 'he', BOOK, null).subscribe(r => (got = r));
      http.expectOne('/api/product-chat').flush(grounded());
      expect(got?.needsChapterClarification).toBeUndefined();
    });
  });
});
