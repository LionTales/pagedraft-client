/**
 * c03: the accessibility primitives the run dialog needs while it is MODAL.
 *
 * Kept out of the component for two reasons: they are pure DOM functions with no Angular in them (so
 * they are unit-testable against a hand-built fragment, without a fixture), and the dialog component is
 * already near this repo's file-size ceiling.
 *
 * ── Why `inert` on the background rather than a click-eating backdrop ──────────────────────────────
 * A scrim stops the MOUSE and does nothing about the keyboard. The PageDraft run dialog sits over a
 * Syncfusion DocumentEditor, which is full of tabbable controls and grabs focus aggressively, so a
 * backdrop-only "disabled background" lets the user Tab straight into the blurred document that the UI
 * is claiming is unavailable - and `aria-modal="true"` would be a lie to a screen reader on top of it.
 *
 * The dialog is NOT portalled to `document.body` (it is declared inside the editor page template), so
 * `inert` cannot simply go on the app root: that is an ANCESTOR of the dialog and would disable the
 * dialog too. {@link applyBackgroundInert} therefore walks from the element it is GIVEN up to `<body>`
 * and marks every SIBLING at each level - the same containment strategy the CDK uses with
 * `aria-hidden`, but with `inert`, which covers pointer, keyboard AND assistive tech in one attribute.
 *
 * ── ANCHOR THE WALK ON THE COMPONENT HOST, NEVER ON THE OVERLAY ────────────────────────────────────
 * Which element you pass is load-bearing, not a detail. The run dialog renders TWO sibling fixed
 * layers inside its host - `.rd-backdrop` (the scrim) and `.rd-overlay` (the centring container) - so
 * anchoring the walk on the overlay marks the dialog's OWN scrim inert, and backdrop-click dismissal
 * silently stops working. The host is the boundary of "the dialog"; `AnalysisRunDialogComponent`
 * passes `hostRef.nativeElement` for exactly that reason. Anything else with more than one root-level
 * layer has the same obligation.
 *
 * ── The no-`inert` fallback ────────────────────────────────────────────────────────────────────────
 * Where `inert` is unsupported the attribute is inert itself (unknown attributes are ignored), so the
 * modal still has to hold on its own. It does: the `.rd-backdrop` element covers the viewport and eats
 * every pointer event, and {@link focusablesWithin} drives an explicit Tab/Shift+Tab cycle inside the
 * card, which is what actually contains the KEYBOARD. Nothing here branches on
 * {@link supportsInert}; it exists so a diagnostic can report which layer is doing the work.
 *
 * ── `inert` + a focus-on-open are NOT enough on their own (c01) ────────────────────────────────────
 * MEASURED on :4201 against the real editor, not reasoned about: `applyBackgroundInert` marks 25
 * elements, `aria-modal="true"` is on the overlay, the overlay really does take focus - and roughly
 * 55ms later `document.activeElement` is Syncfusion's `iframe.e-de-text-target`, which sits INSIDE the
 * inert subtree. Two facts make that possible, and both are why {@link containFocusWithin} exists:
 *
 *  1. `inert` does not reach into a NESTED BROWSING CONTEXT. The attribute on an ancestor in THIS
 *     document does not make the iframe's own document unfocusable, and Syncfusion focuses its hidden
 *     text target from inside that document.
 *  2. Because the move originates in the child document, the parent document sees NO `focusin` for it.
 *     The only parent-side evidence is a `focusout` on the element that lost focus, with
 *     `relatedTarget: null`. A containment layer listening to `focusin` alone would never fire.
 *
 * Consequence, measured before the fix: with focus parked in the iframe, four real Tab presses moved
 * focus nowhere and a real Escape did not dismiss the dialog, because BOTH key bindings live on
 * `.rd-overlay` and keydown bubbles from where focus actually is. `aria-modal="true"` was telling
 * assistive tech a story the DOM did not support.
 */

/** The attribute name, in one place, so the component and its specs cannot disagree about it. */
export const INERT_ATTR = 'inert';

/** Elements that are never interactive and are pointless (and noisy) to mark. */
const NEVER_INERT_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'META', 'TITLE', 'BASE']);

/**
 * True when this browser implements `inert`. Reported, never branched on: the backdrop plus the Tab
 * cycle are the containment that does not depend on it.
 */
export function supportsInert(doc: Document = document): boolean {
  const view = doc.defaultView;
  return !!view && INERT_ATTR in view.HTMLElement.prototype;
}

/**
 * Mark everything OUTSIDE `dialogEl` inert AS OF THIS MOMENT, and return the release function.
 *
 * `dialogEl` must be the component HOST, not an inner overlay - see the anchoring note in the module
 * docblock: a walk anchored on the overlay marks the dialog's own backdrop inert.
 *
 * Walks up from `dialogEl` to `<body>`, marking every sibling on the way. An element that ALREADY
 * carries `inert` (someone else owns it) is left alone and is NOT released later, so two overlapping
 * owners cannot un-inert each other's background.
 *
 * The returned function is idempotent: calling it twice removes nothing the second time.
 *
 * ── LIMITATION: this is a ONE-SHOT SNAPSHOT, not a standing guarantee ──────────────────────────────
 * Read the verb as "mark", not as "keep inert". The walk runs ONCE, at engage. There is no observer,
 * so anything that enters the background AFTERWARDS is never marked: a Syncfusion popup or dropdown
 * appended to `<body>`, a CDK overlay container, a toast, or any node a sibling grows while the dialog
 * is up. Such an element stays fully interactive and fully tabbable behind a dialog that claims
 * `aria-modal="true"`.
 *
 * Two other things also escape it, and they are not hypothetical - they are the c01 defect: an ancestor
 * marked `inert` does NOT propagate into a NESTED BROWSING CONTEXT (an iframe's own document), and an
 * element that already held focus when the walk ran is not necessarily blurred by acquiring `inert`.
 *
 * The layer that covers all of these is {@link containFocusWithin}, which is a live listener rather
 * than a snapshot: whatever takes focus outside the host, whenever it appears and however it got there,
 * is pulled back. `inert` remains the layer that stops pointer input and hides the background from
 * assistive tech; focus containment is the layer that holds the KEYBOARD. Neither replaces the other.
 */
export function applyBackgroundInert(dialogEl: Element, doc: Document = document): () => void {
  const marked: Element[] = [];
  let node: Element | null = dialogEl;

  while (node && node.parentElement && node !== doc.body) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue;
      if (NEVER_INERT_TAGS.has(sibling.tagName)) continue;
      if (sibling.hasAttribute(INERT_ATTR)) continue;
      sibling.setAttribute(INERT_ATTR, '');
      marked.push(sibling);
    }
    node = parent;
  }

  return () => {
    for (const el of marked) el.removeAttribute(INERT_ATTR);
    marked.length = 0;
  };
}

/**
 * Keep focus inside `hostEl` for as long as the returned release function has not been called (c01).
 *
 * This is the containment layer `applyBackgroundInert` cannot be: a live listener rather than a
 * one-shot snapshot. Whenever focus lands outside `hostEl`, `focusTarget()` is focused instead. See the
 * module docblock for the measurement that made it necessary.
 *
 * ── Why BOTH `focusin` and a deferred `focusout` ───────────────────────────────────────────────────
 * `focusin` (capture, on the DOCUMENT) covers the ordinary case: something in this document takes
 * focus, and the event carries it as `target`.
 *
 * It does NOT cover the case this was written for. When focus moves into a nested browsing context -
 * Syncfusion focusing its hidden text-target iframe from inside that iframe's own document - the parent
 * document gets NO `focusin` at all. The only parent-side signal is a `focusout` on whatever just lost
 * focus, with `relatedTarget: null`. So `focusout` is listened to as well.
 *
 * `focusout` fires BEFORE the new element is focused, so acting on it synchronously would set focus and
 * then be immediately overridden by the move already in flight. The handler therefore defers one
 * macrotask and re-reads `activeElement` - measured, not assumed: the live probe that established this
 * mechanism on :4201 re-asserted from exactly this path (`focusin` never fired for the steal) and
 * landed focus on the overlay while the run was still modal.
 *
 * ── It cannot recurse, and that is structural ──────────────────────────────────────────────────────
 * Moving focus fires `focusin` again, so the guard is on the DESTINATION rather than on a re-entrancy
 * flag: `reassert` returns immediately when `activeElement` is already inside `hostEl`, and the
 * `focusin` handler ignores any target inside `hostEl`. Once focus is back in the host, every path is a
 * no-op. Pending deferred checks are coalesced (at most one in flight) and cancelled on release.
 *
 * ── Release ordering is the caller's obligation ────────────────────────────────────────────────────
 * The release function must run BEFORE the caller restores focus to whatever held it before the modal,
 * or this listener will fight that restore and yank focus back into a dialog that is going away. The
 * `released` flag makes the listeners inert the instant it is called, so there is no window.
 *
 * @param hostEl      the boundary of "the dialog" - the same element `applyBackgroundInert` is anchored
 *                    on, so the two layers agree about what is inside.
 * @param focusTarget resolved lazily on every re-assertion, because the element is re-created by
 *                    Angular across renders. Returning null (not yet rendered, or torn down) skips.
 */
export function containFocusWithin(
  hostEl: HTMLElement,
  focusTarget: () => HTMLElement | null,
  doc: Document = document,
): () => void {
  let released = false;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const isInside = (node: EventTarget | null): boolean =>
    node instanceof Node && hostEl.contains(node);

  const reassert = (): void => {
    if (released) return;
    // Guard on the DESTINATION: if focus is already ours there is nothing to do, which is also what
    // stops our own `focus()` call from re-entering this function forever.
    if (isInside(doc.activeElement)) return;
    const target = focusTarget();
    if (!target || !target.isConnected) return;
    target.focus({ preventScroll: true });
  };

  const onFocusIn = (event: Event): void => {
    if (released) return;
    if (isInside(event.target)) return;
    reassert();
  };

  const onFocusOut = (): void => {
    if (released || pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      reassert();
    });
  };

  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);

  return () => {
    if (released) return;
    released = true;
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('focusout', onFocusOut, true);
  };
}

/** Selector for things a keyboard user can reach. The dialog's own controls are all plain buttons. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(', ');

/** An element is "rendered" if it has a box. Cheap stand-in for full visibility computation. */
function isRendered(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/**
 * Every focusable element inside `root`, in DOM order - the cycle the focus trap moves through.
 *
 * Excludes `tabindex="-1"` (programmatically focusable, but not part of the Tab order: the overlay
 * CONTAINER itself is exactly that, which is why the trap cycles within the CARD and not the overlay)
 * and anything already marked inert.
 */
export function focusablesWithin(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => el.tabIndex >= 0 && !el.hasAttribute(INERT_ATTR) && isRendered(el),
  );
}
