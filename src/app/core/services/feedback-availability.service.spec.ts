/**
 * `FeedbackAvailabilityService` (Show C2 / e2) - the ONE owner of "does this deployment serve triage?".
 *
 * The claims worth pinning are not "it maps a boolean". They are the two properties that decide whether a
 * manuscript-bearing surface can be reached: it FAILS CLOSED, and its two readers (the route guard, live;
 * the dashboard's entry link, cached) cannot end up with different answers because the derivation happens
 * once, here. The guard's own suite proves the routing half end to end and is deliberately untouched by
 * this extraction - if it had needed a change, the extraction would have changed behaviour.
 *
 * Every assertion below collects EMITTED values into an array rather than a scalar, so "it answered
 * false" and "it never answered at all" cannot pass the same expectation.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Observable } from 'rxjs';

import { FeedbackAvailabilityService } from './feedback-availability.service';

describe('FeedbackAvailabilityService (Show C2 / e2)', () => {
  let service: FeedbackAvailabilityService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // FeedbackService reads the router for vote context; nothing here votes, but it must be injectable.
        provideRouter([]),
      ],
    });
    service = TestBed.inject(FeedbackAvailabilityService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Subscribe and collect. The array distinguishes "emitted false" from "emitted nothing". */
  function collect(source: Observable<boolean>): boolean[] {
    const seen: boolean[] = [];
    source.subscribe(v => seen.push(v));
    return seen;
  }

  /** Answer the one probe the service is allowed to make, by URL. */
  function answer(body: Record<string, unknown>): void {
    http.expectOne('/api/feedback/availability').flush(body);
  }

  /** Fail it the way a down server does. */
  function failProbe(): void {
    http.expectOne('/api/feedback/availability').flush('down', { status: 500, statusText: 'Server Error' });
  }

  describe('what counts as "on"', () => {
    it('is true only for an explicit triageEnabled: true', () => {
      const seen = collect(service.read());
      answer({ triageEnabled: true });
      expect(seen).toEqual([true]);
    });

    it('is false for triageEnabled: false', () => {
      const seen = collect(service.read());
      answer({ triageEnabled: false });
      expect(seen).toEqual([false]);
    });

    it('is false for a body that answers something else entirely, rather than truthy-guessing', () => {
      // A deployment that answers a shape this client does not understand has not said yes, and the one
      // surface this flag exists to close is not opened on a maybe.
      const seen = collect(service.read());
      answer({ somethingElse: 1 });
      expect(seen).toEqual([false]);
    });
  });

  describe('fail-closed', () => {
    it('treats a FAILED read as off, on read()', () => {
      const seen = collect(service.read());
      failProbe();
      expect(seen).toEqual([false]);
    });

    it('treats a FAILED read as off, on once() too - the cached path must not fail open', () => {
      const seen = collect(service.once());
      failProbe();
      expect(seen).toEqual([false]);
    });
  });

  describe('once() caches, read() does not', () => {
    it('makes ONE request however many callers ask, and replays the settled answer to a late one', () => {
      const first = collect(service.once());
      answer({ triageEnabled: true });
      // Late subscriber, after the request has already settled: it must be answered from the cache.
      const second = collect(service.once());

      expect(first).toEqual([true]);
      expect(second).toEqual([true]);
      // http.verify() in afterEach is the fence for "no second request".
    });

    it('does not re-request for a caller that arrives while the first read is still IN FLIGHT', () => {
      const first = collect(service.once());
      const second = collect(service.once());
      // expectOne inside answer() is the assertion: two in-flight probes would fail here.
      answer({ triageEnabled: true });

      expect(first).toEqual([true]);
      expect(second).toEqual([true]);
    });

    it('keeps the in-flight read alive when the only subscriber unsubscribes, so the next mount does not re-ask', () => {
      // The dashboard is destroyed and re-mounted on every return to the books list. `refCount: false`
      // is what makes that cost one request rather than one per mount.
      service.once().subscribe().unsubscribe();
      answer({ triageEnabled: true });

      expect(collect(service.once())).toEqual([true]);
    });

    it('read() asks EVERY time, because the guard re-evaluates on every navigation by decision', () => {
      const first = collect(service.read());
      answer({ triageEnabled: true });
      const second = collect(service.read());
      answer({ triageEnabled: false });

      // A config flip takes effect without a page reload. That is the guard's recorded decision, and it
      // is the reason `once` is a separate method instead of the only one.
      expect(first).toEqual([true]);
      expect(second).toEqual([false]);
    });

    it('does NOT cache a FAILURE: the next caller retries rather than losing the entry for the session', () => {
      // A transport blip has not settled the question. Caching its `false` would hide the owner's own
      // entry until they reload, which is a worse trade than one extra GET on the next mount.
      const first = collect(service.once());
      failProbe();
      expect(first).toEqual([false]);

      const second = collect(service.once());
      answer({ triageEnabled: true });
      expect(second).toEqual([true]);
    });
  });

  describe('the endpoint it is allowed to read', () => {
    it('learns the flag from the UNGATED availability endpoint and touches no gated one', () => {
      // Every gated feedback endpoint answers a BODILESS 404 with the flag off, which is
      // indistinguishable from a transport failure - so probing one could never tell the two apart.
      service.once().subscribe();
      http.expectNone(r => r.url === '/api/feedback');
      answer({ triageEnabled: true });
    });
  });
});
