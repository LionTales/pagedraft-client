import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { FeedbackService } from './feedback.service';

/**
 * IS THE TRIAGE SURFACE SERVED BY THIS DEPLOYMENT? (`Feedback:TriageEnabled`, Show C2 / e2.)
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────────
 * The answer now has TWO readers - the route guard (`feedbackTriageCanMatch`) and the dashboard header's
 * entry link - and they share one DERIVATION so they can never disagree about what the flag MEANS: the
 * boolean is computed in exactly one place, here, and both readers take it from this service. What the
 * two readers do NOT share is FRESHNESS - see below - and that is deliberate, not an oversight: the
 * accepted cost is that the link can trail the guard by one stale read, never that the two disagree on
 * the read itself. The HTTP call itself still belongs to {@link FeedbackService.availability}, which
 * owns the endpoint; this service owns the INTERPRETATION of its answer.
 *
 * ── The fail-closed rule, preserved verbatim from the guard ───────────────────────────────────────
 * A failed read is OFF. Deliberate, and it is the safe direction: the gated surface composes
 * MANUSCRIPT-BEARING evidence and the flag is what keeps it off a deployment with no auth in front of it.
 * Guessing "on" because a request failed would open the one surface the flag exists to close; the cost of
 * guessing wrong the other way is that the owner retries a URL. `res?.triageEnabled === true` is likewise
 * exact rather than truthy: a body that answers something other than the boolean is not a yes.
 *
 * ── TWO METHODS, BECAUSE THE TWO READERS WANT DIFFERENT FRESHNESS ─────────────────────────────────
 * This is the one axis the two readers are allowed to differ on, and it is stated rather than collapsed.
 * {@link read} is LIVE and is what the guard uses: the guard's own doc records, as a decision, that it
 * re-evaluates on every navigation rather than caching, "because a config flip should not need a page
 * reload to take effect, and the request is one small GET the owner makes deliberately" - and its suite
 * pins that with a spec that flips the flag between two navigations. Caching the guard's read would
 * silently reverse that decision and fail that spec. {@link once} is the CACHED read, for chrome that
 * merely decides whether to draw an affordance: the dashboard header re-mounts on every return to the
 * books list, and re-probing on each of those would spend a request per mount to answer a question whose
 * answer is a server config value. The link is not the security boundary - the guard is - so this is the
 * accepted cost promised above: one wasted click. A stale "on" draws a link that the guard then re-checks
 * and bounces through the wildcard; a stale "off" costs the owner a typed URL that a fresh guard read
 * then honors. Both readers still agree on the DERIVATION - the interpretation, the fail-closed default -
 * at every instant; only the TIMING of when each last asked can differ.
 *
 * A FAILED read is NOT cached. The cache exists to avoid re-asking a settled question, and a transport
 * failure has not settled it; caching that answer would hide the owner's own entry for the rest of the
 * session over one blip. So the fail-closed `false` is still returned to the caller that hit the failure
 * (nothing is opened optimistically), and the next caller asks again.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackAvailabilityService {
  private readonly feedback = inject(FeedbackService);

  /** The in-flight or settled cached read, or null when nothing has been asked (or the last ask failed). */
  private cached: Observable<boolean> | null = null;

  /**
   * Read the flag NOW. One `GET /api/feedback/availability` per call, no caching, fail-closed.
   *
   * This is the guard's path, and its per-navigation freshness is a recorded decision - see the class doc.
   */
  read(): Observable<boolean> {
    return this.probe().pipe(catchError(() => of(false)));
  }

  /**
   * The same answer, read at most once per session and replayed to every later caller.
   *
   * `refCount: false` on purpose: a subscriber that unsubscribes while the request is still in flight
   * (a component destroyed mid-read) must not cancel it and leave the next mount to start over - the
   * whole point is one request. A failure clears the cache before answering, so the next caller retries.
   */
  once(): Observable<boolean> {
    if (!this.cached) {
      this.cached = this.probe().pipe(
        catchError(() => {
          this.cached = null;
          return of(false);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.cached;
  }

  /**
   * The read and its interpretation, with the failure still LIVE on the stream.
   *
   * The `triageEnabled === true` test lives here and nowhere else, so the two public methods cannot drift
   * into two different definitions of "on". They differ only in what they do with a FAILURE, which is why
   * this one must not swallow it: `read` turns it into a plain `false`, `once` has to see it in order not
   * to cache it.
   *
   * Because of that, a failure raised here never reaches a subscriber of `once()` as an error notification
   * - `once()`'s own `catchError` intercepts it and replays the fail-closed `false` as an ordinary next
   * value instead. A caller of `once()` may therefore subscribe with a next-only callback and no error
   * arm; that is not an omission, it is `once()` honoring its contract. `read()` gives the same guarantee
   * for the same reason (its own `catchError` does the same conversion). If either method's `catchError`
   * is ever removed, every next-only subscriber of it becomes wrong at the same time.
   */
  private probe(): Observable<boolean> {
    return this.feedback.availability().pipe(map(res => res?.triageEnabled === true));
  }
}
