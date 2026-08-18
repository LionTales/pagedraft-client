import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';

import { FeedbackAvailabilityService } from '../../core/services/feedback-availability.service';

/**
 * THE FLAG GUARD for the owner's triage route (Show C2, `Feedback:TriageEnabled`).
 *
 * ── It learns the flag from `GET /api/feedback/availability`, and only from there ─────────────────
 * Every gated feedback endpoint answers a BODILESS `404` when the flag is off, which is
 * indistinguishable from a transport failure - so a guard that probed the list endpoint would hide the
 * triage view on any network hiccup and could never tell the two apart. The availability endpoint exists
 * for exactly this and is deliberately ungated: a gated availability check could not answer the question
 * it exists to answer. It carries no feedback data.
 *
 * ── `CanMatch`, not `CanActivate`, and that is the difference between "hidden" and "refused" ──────
 * With the flag off this returns FALSE, so the route does not MATCH at all: the lazy component is never
 * downloaded, and the URL falls through to the wildcard, which redirects to the books list. The author
 * lands where an unknown URL lands, which is the client-side mirror of the server answering a plain 404
 * rather than a 403. A `CanActivate` returning false would have blocked the navigation while leaving the
 * route in the table and the chunk on the wire.
 *
 * ── A FAILED READ IS TREATED AS OFF ───────────────────────────────────────────────────────────────
 * Deliberate, and it is the safe direction: the surface this gates composes MANUSCRIPT-BEARING evidence,
 * and the flag is what keeps it off a deployment that has no auth in front of it. Guessing "on" because a
 * request failed would open the one surface the flag exists to close. The cost of guessing wrong the
 * other way is that the owner retries a URL. Since e2 the rule is IMPLEMENTED in
 * `FeedbackAvailabilityService` rather than inline here, so that the header entry cannot fail open while
 * the route fails closed; it is restated here because it is the reason this route is gated at all.
 *
 * It is re-evaluated on every navigation to the route rather than cached, because a config flip should
 * not need a page reload to take effect, and the request is one small GET the owner makes deliberately.
 * That is why this reads {@link FeedbackAvailabilityService.read} and NOT its cached `once` twin: e2 gave
 * the flag a second reader (the dashboard header's entry link) and moved the derivation into that service
 * so the two cannot disagree, but the freshness decision above is the guard's own and survives the move.
 * The header may draw its link from a cached answer because a link is not the boundary; this is.
 */
export const feedbackTriageCanMatch: CanMatchFn = () => inject(FeedbackAvailabilityService).read();
