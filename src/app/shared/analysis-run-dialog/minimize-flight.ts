/**
 * Wave 1d: the minimize transition of the analysis run dialog.
 *
 * The dialog card "flies" toward the app dock's launcher, which is where the job stays visible after
 * the dialog is dismissed (its badge carries the live count, and its activity tab carries the row).
 *
 * ── The target moved with the merge (chatbot phase A.1, w1) ────────────────────────────────────────
 * It used to be the Activity Center BELL, at `top/inset-inline-start`. That bell no longer exists: the
 * two app-level overlays were merged into one tabbed dock with a single launcher at the BOTTOM
 * inline-start corner. This module had to follow, because a target selector that matches nothing does
 * not fail loudly - it silently falls through to the fallback corner, which would have aimed every
 * minimize at an empty corner of the screen.
 *
 * ── Why the target is measured, never hardcoded ────────────────────────────────────────────────────
 * The launcher is pinned with `inset-inline-start` (app-dock.component.scss `.dock-launcher`), which is
 * PHYSICALLY on the right in RTL and on the left in LTR. Hebrew is the app default, so a flight aimed at
 * a hardcoded physical corner would fly the wrong way for most users. `resolveMinimizeTarget` therefore
 * reads the launcher's LIVE `getBoundingClientRect()`: the browser has already resolved the logical
 * property for the current direction, so the target flips for free and stays correct if it ever moves.
 *
 * Only when the launcher is unavailable (not yet mounted, or not rendered while the dock drawer is open,
 * which leaves nothing to measure) do we fall back to a computed corner, and even then the side is
 * derived from a resolved `direction`, never assumed.
 *
 * ── Which direction the FALLBACK must read (c3 live-browser finding, still binding) ────────────────
 * NOT the document's. The dock is APP-LEVEL chrome whose language is Hebrew-default and independent of
 * both the book language and the document: `AppDockComponent` hardcodes `appLang = 'he'` and binds
 * `[attr.dir]` on its own host, so `.dock-launcher`'s `inset-inline-start` resolves against THAT host,
 * not against `<body>`. Measured live in the running app when this bit as the bell: the affordance sat
 * at x ~ 1444 of a 1500px viewport (physical RIGHT) while `getComputedStyle(document.body).direction`
 * was `ltr`. A fallback keyed on the document therefore aimed at the opposite side of the screen -
 * exactly the wrong-way flight this module exists to prevent - and it triggered on a real path
 * (minimizing while the panel is open, which is when the launcher is not rendered). The fallback probes
 * the dock HOST's resolved direction, which survives the launcher being absent because only the
 * launcher goes, never the host.
 *
 * The flight itself is expressed as a PHYSICAL pixel delta between two measured points, so it needs no
 * direction awareness of its own.
 *
 * ── Why c03 (the centred modal) needed no change here ──────────────────────────────────────────────
 * VERIFIED, not assumed. Both ends of the flight are MEASURED at gesture time: the origin is the card's
 * live `getBoundingClientRect()` (taken in `AnalysisRunDialogComponent.minimize()` before anything
 * moves) and the target is the launcher's live rect. Neither end encodes where the card sits, so moving the
 * card from the block-end/inline-end corner to the viewport centre changes only the numbers. The ghost
 * is appended to `document.body` at `z-index: 2147483000`, far above the dialog's own backdrop
 * (`--pd-z-dialog`, 200), so it animates OVER the scrim; and the dialog releases its modality (backdrop
 * removal, background `inert`, focus restore) BEFORE emitting the gesture, so the page is already usable
 * while the ghost is still in the air.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────────────────────────────
 * Under `prefers-reduced-motion: reduce` the ghost cross-fades in place: no translation, no scaling, and
 * a shorter duration. The gesture still renders (the user gets the same "it went somewhere" confirmation
 * beat) without any movement across the viewport.
 */

/** A viewport-space point (CSS pixels, relative to the viewport like a DOMRect). */
export interface FlightPoint {
  x: number;
  y: number;
}

/** Class stamped on the transient ghost element, so a spec (or a debugger) can find it. */
export const MINIMIZE_GHOST_CLASS = 'rd-minimize-ghost';

/** Selector of the dock launcher: the affordance the minimized job remains visible on. */
export const DOCK_LAUNCHER_SELECTOR = '.dock-launcher';

/**
 * Selector of the app dock HOST. Its own resolved `direction` (app-level, Hebrew-default) is what
 * `.dock-launcher`'s `inset-inline-start` is laid out against, so it is the only correct input to the
 * fallback corner. The host stays in the DOM (and keeps its direction) while the launcher itself is not
 * rendered, which is exactly the case the fallback exists for.
 */
export const DOCK_HOST_SELECTOR = 'app-dock';

/** Flight duration (ms) with motion allowed, and the shorter cross-fade used under reduced motion. */
export const MINIMIZE_FLIGHT_MS = 320;
export const MINIMIZE_FADE_MS = 140;

/**
 * Distance from the viewport's inline-start and BLOCK-END edges to the FALLBACK target's centre, used
 * only when the launcher cannot be measured. Approximates the launcher's own
 * `bottom/inset-inline-start: var(--pd-space-5)` plus half of its 48px box.
 *
 * The block axis flipped with the merge: the old bell was a TOP-corner affordance, the dock launcher is
 * a BOTTOM one. A fallback still aimed at the top would send the ghost to a corner that has held nothing
 * since the two overlays became one.
 */
export const MINIMIZE_FALLBACK_INSET = 40;

export interface MinimizeFlightOptions {
  /** Document to render the ghost into. Defaults to the ambient document. */
  doc?: Document;
  /** Window used for `matchMedia` / viewport width. Defaults to the ambient window. */
  win?: Window;
  /** Force the reduced-motion branch (specs). Defaults to the live media query. */
  reducedMotion?: boolean;
  /** Override the resolved target (specs). Defaults to {@link resolveMinimizeTarget}. */
  target?: FlightPoint;
}

/** True when the user asked for reduced motion. Treats an absent `matchMedia` as "motion allowed". */
export function prefersReducedMotion(win: Window = window): boolean {
  try {
    return !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

/**
 * Resolve the direction the document currently renders in. Prefers the RESOLVED computed `direction` of
 * the body (which accounts for a `dir` attribute anywhere up the tree plus any CSS) and falls back to the
 * root element's `dir` attribute.
 */
export function resolveDocumentDirection(doc: Document = document, win: Window = window): 'rtl' | 'ltr' {
  const probe = doc.body ?? doc.documentElement;
  try {
    const computed = probe && win.getComputedStyle ? win.getComputedStyle(probe).direction : '';
    if (computed === 'rtl' || computed === 'ltr') return computed;
  } catch {
    // fall through to the attribute probe
  }
  const attr = (doc.documentElement?.getAttribute('dir') ?? '').trim().toLowerCase();
  return attr === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * Resolve the direction the LAUNCHER is pinned against: the app dock host's own resolved direction.
 *
 * This is deliberately NOT the document's direction. The dock sets `dir` on its own host from its
 * app-level (Hebrew-default) language, so the launcher can be on the physical right while the document
 * resolves to `ltr`. Falls back to the document only when the host is absent (e.g. an isolated spec
 * fixture that plants a bare launcher), which keeps the existing planted-element specs meaningful.
 */
export function resolveLauncherSideDirection(doc: Document = document, win: Window = window): 'rtl' | 'ltr' {
  const host = doc.querySelector(DOCK_HOST_SELECTOR) as HTMLElement | null;
  if (host) {
    try {
      const computed = win.getComputedStyle ? win.getComputedStyle(host).direction : '';
      if (computed === 'rtl' || computed === 'ltr') return computed;
    } catch {
      // fall through to the attribute probe
    }
    const attr = (host.getAttribute('dir') ?? '').trim().toLowerCase();
    if (attr === 'rtl' || attr === 'ltr') return attr;
  }
  return resolveDocumentDirection(doc, win);
}

/**
 * Where the minimize flight lands: the centre of the dock launcher as it is CURRENTLY laid out.
 *
 * Measuring the live element is what makes this RTL-correct: `.dock-launcher` is positioned with
 * `inset-inline-start`, so its physical x is already the right edge under RTL and the left edge under LTR.
 * The fallback (launcher absent or collapsed to a zero rect) derives the same inline-start side from
 * {@link resolveLauncherSideDirection} - the dock's own direction, not the document's - and the same
 * BLOCK-END corner the launcher sits in.
 */
export function resolveMinimizeTarget(doc: Document = document, win: Window = window): FlightPoint {
  const launcher = doc.querySelector(DOCK_LAUNCHER_SELECTOR) as HTMLElement | null;
  if (launcher) {
    const rect = launcher.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
  const rtl = resolveLauncherSideDirection(doc, win) === 'rtl';
  const viewportWidth = win.innerWidth || doc.documentElement?.clientWidth || 0;
  const viewportHeight = win.innerHeight || doc.documentElement?.clientHeight || 0;
  return {
    x: rtl ? viewportWidth - MINIMIZE_FALLBACK_INSET : MINIMIZE_FALLBACK_INSET,
    y: viewportHeight - MINIMIZE_FALLBACK_INSET,
  };
}

/**
 * Keyframes for the flight. With motion allowed the ghost translates by the PHYSICAL delta between the
 * card centre and the target centre and shrinks into it; under reduced motion it only fades, in place.
 */
export function buildFlightKeyframes(origin: DOMRect, target: FlightPoint, reducedMotion: boolean): Keyframe[] {
  if (reducedMotion) {
    return [{ opacity: 0.9 }, { opacity: 0 }];
  }
  const dx = target.x - (origin.left + origin.width / 2);
  const dy = target.y - (origin.top + origin.height / 2);
  return [
    { transform: 'translate(0px, 0px) scale(1)', opacity: 0.9 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0 },
  ];
}

/**
 * Play the minimize transition and return the ghost element (or null when there is nothing to animate).
 *
 * The ghost is a purely decorative, `aria-hidden`, pointer-transparent clone of the card's BOX (not its
 * content), appended to `document.body` so it is not clipped by the dialog's own removal. It removes
 * itself when the animation finishes or is cancelled, and immediately when the Web Animations API is
 * unavailable, so no stray node can ever be left behind.
 */
export function flyToActivityCenter(
  origin: DOMRect | null,
  options: MinimizeFlightOptions = {},
): HTMLElement | null {
  const doc = options.doc ?? document;
  const win = options.win ?? window;
  if (!origin || origin.width <= 0 || origin.height <= 0 || !doc.body) return null;

  const target = options.target ?? resolveMinimizeTarget(doc, win);
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion(win);

  const ghost = doc.createElement('div');
  ghost.className = MINIMIZE_GHOST_CLASS;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.position = 'fixed';
  ghost.style.left = `${origin.left}px`;
  ghost.style.top = `${origin.top}px`;
  ghost.style.width = `${origin.width}px`;
  ghost.style.height = `${origin.height}px`;
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '2147483000';
  ghost.style.borderRadius = 'var(--pd-radius-lg, 12px)';
  ghost.style.border = '1px solid var(--pd-border, #d9d9d9)';
  ghost.style.background = 'var(--pd-surface, #ffffff)';
  ghost.style.boxShadow = 'var(--pd-shadow-4, 0 12px 32px rgba(0, 0, 0, 0.18))';
  ghost.style.transformOrigin = 'center center';
  doc.body.appendChild(ghost);

  const remove = () => ghost.parentNode?.removeChild(ghost);

  const animate = (ghost as HTMLElement & { animate?: Element['animate'] }).animate;
  if (typeof animate !== 'function') {
    // No Web Animations API: the gesture is still correct, just instant. Never leak the node, and
    // report nothing is on screen, matching the "or null when there is nothing to animate" contract.
    remove();
    return null;
  }

  const animation = ghost.animate(buildFlightKeyframes(origin, target, reducedMotion), {
    duration: reducedMotion ? MINIMIZE_FADE_MS : MINIMIZE_FLIGHT_MS,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'forwards',
  });
  animation.onfinish = remove;
  animation.oncancel = remove;
  return ghost;
}
