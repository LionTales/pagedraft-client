/**
 * ConversationService: the wire shape of `/api/conversations` (Show C1, c2).
 *
 * The service is thin on purpose, so what is worth pinning is the boundary: the URLs and params the
 * server documented, and the ONE piece of behaviour that is not a pass-through - walking the message
 * pages, which exists because a partial read would break the byte-identity pin.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ConversationService } from './conversation.service';
import { ConversationMessageDto, ConversationMessagesDto } from '../models/conversation';

const ID = 'c0ffee00-0000-4000-8000-000000000001';
const BOOK = 'b1e7c0de-0000-4000-8000-00000000000a';

function msg(sequence: number): ConversationMessageDto {
  return {
    id: `m-${sequence}`,
    sequence,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    text: `turn-${sequence}`,
    failed: false,
    createdAt: '2026-08-16T10:00:00Z',
    askBookId: null,
    askChapterId: null,
    askChapterOrder: null,
    grounding: null,
  };
}

function page(items: ConversationMessageDto[], p: number, size: number, total: number): ConversationMessagesDto {
  return { items, page: p, pageSize: size, totalCount: total };
}

describe('ConversationService (Show C1)', () => {
  let svc: ConversationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ConversationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('list', () => {
    it('GETs the list with page and pageSize, and NO bookId when none is asked for', () => {
      // An omitted bookId means EVERY conversation, app-level ones included. Sending an empty or null
      // one would be a filter, and a history list that silently hid the book conversations would make
      // the feature look broken to the only author using it.
      svc.list(null).subscribe();
      const req = http.expectOne(r => r.url === '/api/conversations');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('pageSize')).toBe(String(ConversationService.ListPageSize));
      expect(req.request.params.has('bookId')).toBeFalse();
      req.flush({ items: [], page: 1, pageSize: 20, totalCount: 0, nearCapWarning: false });
    });

    it('passes the bookId through when one is asked for', () => {
      svc.list(BOOK, 3, 5).subscribe();
      const req = http.expectOne(r => r.url === '/api/conversations');
      expect(req.request.params.get('bookId')).toBe(BOOK);
      expect(req.request.params.get('page')).toBe('3');
      expect(req.request.params.get('pageSize')).toBe('5');
      req.flush({ items: [], page: 3, pageSize: 5, totalCount: 0, nearCapWarning: false });
    });
  });

  describe('allMessages', () => {
    it('reads ONE page when the conversation fits in one', () => {
      let got: ConversationMessageDto[] | undefined;
      svc.allMessages(ID).subscribe(m => (got = m));

      const req = http.expectOne(r => r.url === `/api/conversations/${ID}/messages`);
      expect(req.request.params.get('pageSize')).toBe(String(ConversationService.MessagePageSize));
      req.flush(page([msg(0), msg(1)], 1, ConversationService.MessagePageSize, 2));

      expect(got?.length).toBe(2);
      // Non-vacuity: the rows really did come back, so "one request" is a fact about a real read.
      expect(got?.[0].text).toBe('turn-0');
    });

    it('WALKS the pages, because the resend window is the LAST turns and page 1 holds the oldest', () => {
      // This is the failure the walk exists to prevent: the messages endpoint is oldest-first, so a
      // hydration that read page 1 alone would rebuild a transcript missing exactly the turns the next
      // question is composed from, and the resumed window would differ from the unbroken one.
      let got: ConversationMessageDto[] | undefined;
      svc.allMessages(ID).subscribe(m => (got = m));

      const first = http.expectOne(r => r.url === `/api/conversations/${ID}/messages`);
      expect(first.request.params.get('page')).toBe('1');
      first.flush(page([msg(0), msg(1)], 1, 2, 5));

      const second = http.expectOne(r => r.url === `/api/conversations/${ID}/messages`);
      expect(second.request.params.get('page')).toBe('2');
      second.flush(page([msg(2), msg(3)], 2, 2, 5));

      const third = http.expectOne(r => r.url === `/api/conversations/${ID}/messages`);
      expect(third.request.params.get('page')).toBe('3');
      third.flush(page([msg(4)], 3, 2, 5));

      expect(got?.map(m => m.sequence)).toEqual([0, 1, 2, 3, 4]);
      // And it STOPS: a fourth request would be one page past the end, and `http.verify()` in the
      // afterEach is what fails if one was made.
    });

    it('asks for no page past the end when the last page is exactly full', () => {
      let got: ConversationMessageDto[] | undefined;
      svc.allMessages(ID).subscribe(m => (got = m));

      http.expectOne(r => r.url === `/api/conversations/${ID}/messages`).flush(page([msg(0), msg(1)], 1, 2, 2));
      expect(got?.length).toBe(2);
    });
  });

  describe('rename', () => {
    it('PATCHes the trimmed title', () => {
      svc.rename(ID, '  My conversation  ').subscribe();
      const req = http.expectOne(`/api/conversations/${ID}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'My conversation' });
      req.flush({ id: ID, title: 'My conversation', bookId: null, createdAt: '', updatedAt: '', messageCount: 2 });
    });

    it('still SENDS a blank title rather than swallowing it, so the server\'s 400 is what says no', () => {
      // A client that silently refused would leave the author pressing a button that does nothing, and
      // would put the rule in two places where only one of them is true for every caller.
      let failed = false;
      svc.rename(ID, '   ').subscribe({ error: () => (failed = true) });
      const req = http.expectOne(`/api/conversations/${ID}`);
      expect(req.request.body).toEqual({ title: '' });
      req.flush({ error: 'titleRequired' }, { status: 400, statusText: 'Bad Request' });
      expect(failed).toBeTrue();
    });
  });

  describe('delete', () => {
    it('DELETEs the conversation', () => {
      let done = false;
      svc.delete(ID).subscribe(() => (done = true));
      const req = http.expectOne(`/api/conversations/${ID}`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(done).toBeTrue();
    });
  });

  describe('get', () => {
    it('GETs the metadata alone', () => {
      svc.get(ID).subscribe();
      const req = http.expectOne(`/api/conversations/${ID}`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: ID, title: 't', bookId: null, createdAt: '', updatedAt: '', messageCount: 0 });
    });
  });
});
