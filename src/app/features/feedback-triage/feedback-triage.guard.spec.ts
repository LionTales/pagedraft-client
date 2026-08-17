/**
 * THE FLAG GUARD (Show C2): flag off = NO ROUTE.
 *
 * Driven through a real `Router` against a real route table rather than by calling the guard function and
 * inspecting its boolean, because the claim being tested is about ROUTING and not about a predicate: with
 * the flag off the route must not match at all, so the URL has to fall through to the wildcard exactly as
 * an unknown URL does. A unit test of the returned value would pass just as happily against a
 * `canActivate` that blocked the navigation while leaving the route in the table and the chunk on the
 * wire, which is a different behaviour.
 */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';

import { feedbackTriageCanMatch } from './feedback-triage.guard';

@Component({ standalone: true, template: 'triage' })
class TriageStubComponent {}

@Component({ standalone: true, template: 'books' })
class BooksStubComponent {}

describe('feedbackTriageCanMatch (Show C2)', () => {
  let router: Router;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideLocationMocks(),
        provideRouter([
          { path: 'books', component: BooksStubComponent },
          { path: 'feedback', canMatch: [feedbackTriageCanMatch], component: TriageStubComponent },
          // The real table's wildcard. It is what makes "flag off" land somewhere honest rather than
          // erroring, and it is why the guard can return false instead of a UrlTree.
          { path: '**', redirectTo: 'books' },
        ]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Answer the availability probe, which is the ONLY thing the guard reads. */
  function answerAvailability(triageEnabled: boolean): void {
    http.expectOne('/api/feedback/availability').flush({ triageEnabled });
  }

  it('MATCHES the route when the flag is on', fakeAsync(() => {
    router.navigateByUrl('/feedback');
    tick();
    answerAvailability(true);
    tick();
    expect(router.url).toBe('/feedback');
  }));

  it('does NOT match, and the URL falls through to the wildcard, when the flag is off', fakeAsync(() => {
    router.navigateByUrl('/feedback');
    tick();
    answerAvailability(false);
    tick();
    // The client-side mirror of the server's plain bodiless 404: flag-off and route-absent look the same.
    expect(router.url).toBe('/books');
  }));

  it('treats a FAILED availability read as off, which is the safe direction', fakeAsync(() => {
    // The gated surface composes manuscript-bearing evidence. Guessing "on" because a request failed
    // would open the one surface the flag exists to close; guessing "off" costs a retried URL.
    router.navigateByUrl('/feedback');
    tick();
    http.expectOne('/api/feedback/availability').flush('down', { status: 500, statusText: 'Server Error' });
    tick();
    expect(router.url).toBe('/books');
  }));

  it('learns the flag from the UNGATED availability endpoint, never by probing a gated one', fakeAsync(() => {
    // A gated endpoint answers a BODILESS 404 with the flag off, which is indistinguishable from a
    // transport failure - so a guard that probed the list would hide triage on any network hiccup. This
    // asserts the probe by its URL, and that no gated endpoint is touched at all.
    router.navigateByUrl('/feedback');
    tick();
    http.expectNone(r => r.url === '/api/feedback');
    answerAvailability(true);
    tick();
    expect(router.url).toBe('/feedback');
  }));

  it('re-reads the flag on every navigation, so a config flip needs no page reload', fakeAsync(() => {
    router.navigateByUrl('/feedback');
    tick();
    answerAvailability(true);
    tick();
    expect(router.url).toBe('/feedback');

    router.navigateByUrl('/books');
    tick();
    expect(router.url).toBe('/books');

    router.navigateByUrl('/feedback');
    tick();
    answerAvailability(false);
    tick();
    expect(router.url).toBe('/books');
  }));
});
