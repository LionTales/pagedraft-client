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
});
