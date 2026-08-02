/**
 * AiTierService: the per-book shared answer (tier-ux-rework fixes c02).
 *
 * The component suite proves what the toggles DO with the answer; this one proves the rules that decide which
 * answer they get, because those rules moved out of the components and into here. Two properties matter and
 * both are timing properties, so every test holds the request OPEN across its assertions rather than resolving
 * it synchronously:
 *
 *  - N mounted toggles for one book cost ONE GET, and all of them repaint from ONE toggle's write;
 *  - moving the answer into shared state did NOT weaken supersession. A stale read must be unable to repaint
 *    the book even when some other instance is still holding it open, which is precisely the case the old
 *    per-component `unsubscribe()` could not cover.
 */
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { HttpRequest } from '@angular/common/http';
import { AiTierService } from './ai-tier.service';
import { BookAiTierDto } from '../models/book';

function dto(overrides: Partial<BookAiTierDto> = {}): BookAiTierDto {
  return {
    bookId: 'book-1',
    tier: 'fast',
    thinkingReadiness: 'ready',
    fallbackActive: false,
    consentRequired: true,
    tasks: [
      {
        task: 'Proofread',
        storedTier: null,
        effectiveTier: 'fast',
        thinkingReadiness: 'ready',
        fallbackActive: false,
      },
    ],
    ...overrides,
  };
}

const isRead = (bookId: string) => (r: HttpRequest<unknown>) =>
  r.method === 'GET' && r.url === `/api/books/${bookId}/ai-tier`;

describe('AiTierService (shared per-book state, tier-ux-rework fixes c02)', () => {
  let service: AiTierService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AiTierService],
    });
    service = TestBed.inject(AiTierService);
    http = TestBed.inject(HttpTestingController);
  });

  function reads(bookId = 'book-1'): TestRequest[] {
    return http.match(isRead(bookId));
  }

  /** Collects everything published on a book's channel, the way a mounted toggle would receive it. */
  function watcher(bookId = 'book-1') {
    const seen: BookAiTierDto[] = [];
    const sub = service.watch(bookId).subscribe({ next: (d) => seen.push(d), error: () => seen.push(null!) });
    return { seen, sub, last: () => seen[seen.length - 1] };
  }

  it('issues ONE request for two concurrent reads of the same book, and answers both', () => {
    const a: BookAiTierDto[] = [];
    const b: BookAiTierDto[] = [];
    service.get('book-1').subscribe((d) => a.push(d));
    service.get('book-1').subscribe((d) => b.push(d));

    const pending = reads();
    expect(pending.length).withContext('two callers, one GET').toBe(1);

    pending[0].flush(dto());
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it('does not join a read for a DIFFERENT book', () => {
    service.get('book-1').subscribe();
    service.get('book-2').subscribe();

    expect(reads('book-1').length).toBe(1);
    expect(reads('book-2').length).toBe(1);
  });

  it('publishes a read answer to every watcher of that book, and to no other book', () => {
    const one = watcher('book-1');
    const two = watcher('book-1');
    const other = watcher('book-2');

    service.get('book-1').subscribe();
    reads()[0].flush(dto({ tier: 'thinking' }));

    expect(one.last().tier).toBe('thinking');
    expect(two.last().tier).toBe('thinking');
    expect(other.seen.length).withContext('a book-1 answer is not a fact about book-2').toBe(0);
  });

  it('publishes a WRITE answer to every watcher, which is what makes one toggle repaint the others', () => {
    const one = watcher();
    const two = watcher();

    service.setBookDefault('book-1', 'fast').subscribe();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/books/book-1/ai-tier');
    expect(put.request.body).toEqual({ tier: 'fast' });
    put.flush(dto({ tier: 'fast' }));

    expect(one.seen.length).toBe(1);
    expect(two.seen.length).toBe(1);
    expect(two.last().tier).toBe('fast');
  });

  it('drops a read answer once a newer request has been issued for the book', () => {
    const seen = watcher();

    service.get('book-1').subscribe({ error: () => {} });
    const stale = reads()[0];
    // A second caller forces a fresh read, which supersedes the first by construction.
    service.refresh('book-1').subscribe({ error: () => {} });
    const fresh = reads()[0];

    fresh.flush(dto({ tier: 'thinking' }));
    stale.flush(dto({ tier: 'fast' }));

    expect(seen.seen.length).withContext('only the newest read may paint').toBe(1);
    expect(seen.last().tier).toBe('thinking');
  });

  /**
   * The case a per-component `unsubscribe()` could never cover: the read is still LIVE, held by another
   * instance, when a write lands under it. The server gives no read-after-write guarantee across an in-flight
   * window, so that read may carry pre-write state and must not be allowed to undo the write.
   */
  it('drops a read that a write landed on top of, even while the read is still held open', () => {
    const seen = watcher();

    service.get('book-1').subscribe({ error: () => {} });
    const openRead = reads()[0];

    service.setBookDefault('book-1', 'fast').subscribe();
    http.expectOne((r) => r.method === 'PUT').flush(dto({ tier: 'fast' }));
    expect(seen.last().tier).toBe('fast');

    openRead.flush(dto({ tier: 'thinking' }));

    expect(seen.seen.length).withContext('the pre-write answer must not repaint').toBe(1);
    expect(seen.last().tier).toBe('fast');
  });

  it('will not JOIN a read that a write has already doomed: the joiner gets its own fresh read', () => {
    // The write is issued FIRST, so the read that follows it is still the newest STAMP for the book while
    // being doomed by the write landing under it. That is the case the stamp check alone does not catch.
    service.setBookDefault('book-1', 'fast').subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    service.get('book-1').subscribe({ error: () => {} });
    const doomed = reads()[0];
    put.flush(dto({ tier: 'fast' }));

    service.get('book-1').subscribe({ error: () => {} });

    expect(reads().length).withContext('joining an answer that can never paint would hang the joiner').toBe(1);
    expect(doomed.cancelled).toBeFalse();
  });

  /**
   * ADOPTION (trap b). A toggle mounting while another one is displaying an answer must not issue a second
   * identical GET - the real dashboard mounts its two about 140ms apart, so joining an in-flight read cannot
   * cover it. What makes handing over the held answer safe is that it dies with the entry: see the eviction
   * test below, and `does not adopt anything once the book has no watchers`.
   */
  it('adopts the answer the book already has instead of issuing a second identical GET', async () => {
    const seen = watcher();
    service.get('book-1').subscribe({ error: () => {} });
    reads()[0].flush(dto({ tier: 'thinking' }));
    expect(seen.seen.length).toBe(1);

    let adopted: BookAiTierDto | null = null;
    service.get('book-1').subscribe({ next: (d) => (adopted = d), error: () => {} });
    expect(reads().length).withContext('no second GET').toBe(0);
    expect(adopted).withContext('delivered asynchronously, like a real answer').toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(adopted!).toEqual(dto({ tier: 'thinking' }));
    expect(seen.seen.length).withContext('republished on the one channel').toBe(2);
  });

  it('does not adopt once anything newer has been issued', () => {
    service.get('book-1').subscribe({ error: () => {} });
    reads()[0].flush(dto({ tier: 'thinking' }));

    service.refresh('book-1').subscribe({ error: () => {} }); // something newer is now in flight
    const inFlight = reads();
    expect(inFlight.length).toBe(1);

    service.get('book-1').subscribe({ error: () => {} });
    expect(reads().length).withContext('it joins the newer read rather than adopting the older answer').toBe(0);
    expect(inFlight[0].cancelled).toBeFalse();
  });

  it('does not adopt anything once the book has no watchers: the next visit reads', async () => {
    const w = watcher('book-1');
    const sub = service.get('book-1').subscribe({ error: () => {} });
    reads()[0].flush(dto({ tier: 'thinking' }));
    sub.unsubscribe();
    w.sub.unsubscribe(); // the last toggle for this book unmounts

    let answered: BookAiTierDto | null = null;
    service.get('book-1').subscribe({ next: (d) => (answered = d), error: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(answered).withContext('no snapshot from the previous visit').toBeNull();
    expect(reads().length).withContext('a fresh visit reads').toBe(1);
  });

  it('lets a write answer through even when a read was issued after it (a write answer is post-write)', () => {
    const seen = watcher();

    service.setBookDefault('book-1', 'thinking').subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    service.refresh('book-1').subscribe({ error: () => {} });
    const later = reads()[0];

    put.flush(dto({ tier: 'thinking' }));

    expect(seen.last().tier).withContext('the write still paints').toBe('thinking');
    later.flush(dto({ tier: 'fast' }));
    expect(seen.seen.length).withContext('and the read it superseded does not').toBe(1);
  });

  it('does not let an older write land after a newer one', () => {
    const seen = watcher();

    service.setBookDefault('book-1', 'thinking').subscribe();
    const first = http.match((r) => r.method === 'PUT')[0];
    service.setBookDefault('book-1', 'fast').subscribe();
    const second = http.match((r) => r.method === 'PUT')[0];

    second.flush(dto({ tier: 'fast' }));
    first.flush(dto({ tier: 'thinking' }));

    expect(seen.seen.length).toBe(1);
    expect(seen.last().tier).toBe('fast');
  });

  it('refresh() always issues a fresh request, get() joins one', () => {
    // NOTE: `http.match` DRAINS what it matches from the open list, so each assertion below counts only the
    // requests issued since the previous one. That is the quantity of interest: did THIS call go to the wire.
    service.get('book-1').subscribe({ error: () => {} });
    service.get('book-1').subscribe({ error: () => {} });
    const joined = http.match(isRead('book-1'));
    expect(joined.length).withContext('the second get joins the first').toBe(1);

    service.refresh('book-1').subscribe({ error: () => {} });
    expect(http.match(isRead('book-1')).length).withContext('refresh never joins').toBe(1);

    service.get('book-1').subscribe({ error: () => {} });
    expect(http.match(isRead('book-1')).length).withContext('and the fresh read becomes the joinable one').toBe(0);
  });

  it('aborts the shared read only when its LAST subscriber detaches', () => {
    const first = service.get('book-1').subscribe({ error: () => {} });
    const second = service.get('book-1').subscribe({ error: () => {} });
    const shared = reads()[0];

    first.unsubscribe();
    expect(shared.cancelled).withContext('one detaching is not a decision for the other').toBeFalse();

    second.unsubscribe();
    expect(shared.cancelled).toBeTrue();
  });

  it('a failed read publishes nothing and leaves the book without an answer', () => {
    const seen = watcher();
    let errored = false;
    service.get('book-1').subscribe({ error: () => (errored = true) });

    reads()[0].flush('boom', { status: 500, statusText: 'Server Error' });

    expect(errored).withContext('the caller owns the failure').toBeTrue();
    expect(seen.seen.length).withContext('a failure is not an answer about the book').toBe(0);
  });

  it('a failed write publishes nothing either', () => {
    const seen = watcher();
    let status = 0;
    service.setTask('book-1', 'Proofread', 'thinking').subscribe({ error: (e) => (status = e.status) });

    http.expectOne((r) => r.method === 'PUT').flush(null, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
    expect(seen.seen.length).toBe(0);
  });

  it('clears a task override through DELETE and publishes the answer like any other write', () => {
    const seen = watcher();
    service.clearTask('book-1', 'Proofread').subscribe();

    const del = http.expectOne((r) => r.method === 'DELETE');
    expect(del.request.url).toBe('/api/books/book-1/ai-tier/Proofread');
    del.flush(dto());

    expect(seen.seen.length).toBe(1);
  });

  /**
   * The map is app-lifetime (the service is `providedIn: 'root'`), so it must not accumulate an entry per book
   * the session has ever opened. Asserted on the internal map because the property IS the internal map; there
   * is no observable behaviour that distinguishes "evicted" from "kept" when nothing is cached in it.
   */
  it('evicts a book once nothing watches it and nothing is in flight', () => {
    const channels = () => (service as unknown as { channels: Map<string, unknown> }).channels;

    const w = watcher('book-1');
    const sub = service.get('book-1').subscribe({ error: () => {} });
    expect(channels().size).toBe(1);

    reads()[0].flush(dto());
    expect(channels().size).withContext('still watched').toBe(1);

    sub.unsubscribe();
    w.sub.unsubscribe();
    expect(channels().size).withContext('idle books are dropped, not accumulated').toBe(0);
  });

  it('keeps a book while a request is still in flight, even with nothing watching', () => {
    const channels = () => (service as unknown as { channels: Map<string, unknown> }).channels;

    const sub = service.get('book-1').subscribe({ error: () => {} });
    expect(channels().size).toBe(1);
    sub.unsubscribe(); // last subscriber: the request is aborted, so the entry may go
    expect(channels().size).toBe(0);

    const held = service.get('book-2').subscribe({ error: () => {} });
    const kept = service.get('book-2').subscribe({ error: () => {} });
    held.unsubscribe();
    expect(channels().size).withContext('one subscriber left, request still live').toBe(1);
    kept.unsubscribe();
    expect(channels().size).toBe(0);
  });
});
