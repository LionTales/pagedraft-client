/**
 * Wave 1d (c2): the minimize transition. Re-aimed at the app dock's launcher in chatbot phase A.1 (w1),
 * when the Activity Center bell this used to fly to was removed by the two-overlay merge.
 *
 * The load-bearing claim under test is the RTL one. The launcher is pinned with `inset-inline-start`,
 * so it is physically on the RIGHT in Hebrew (the app default) and on the LEFT in English. An animation
 * aimed at a hardcoded corner would fly the wrong way for most users. These specs therefore mount a REAL
 * element carrying the SAME logical property the real launcher uses and let the browser resolve it, in
 * both directions - a stubbed rect could not prove that.
 *
 * The planted stand-ins use `top` rather than `bottom` on purpose: what is under test on the block axis
 * is only "the target follows the element", which the live-measurement spec drives by moving it. The
 * block corner the FALLBACK aims at is asserted separately, and it is a bottom corner now.
 */
import {
  DOCK_LAUNCHER_SELECTOR,
  DOCK_HOST_SELECTOR,
  MINIMIZE_FADE_MS,
  MINIMIZE_FALLBACK_INSET,
  MINIMIZE_FLIGHT_MS,
  MINIMIZE_GHOST_CLASS,
  buildFlightKeyframes,
  flyToActivityCenter,
  resolveLauncherSideDirection,
  resolveDocumentDirection,
  resolveMinimizeTarget,
} from './minimize-flight';

describe('minimize flight (Wave 1d c2)', () => {
  /** Everything appended to <body> during a spec, removed in afterEach. */
  let planted: HTMLElement[] = [];

  /**
   * Mount a stand-in for the dock launcher inside a container with an explicit `dir`, using the
   * launcher's OWN inline positioning property (`inset-inline-start`) so the browser resolves the
   * physical side exactly as it does in the app.
   */
  function plantLauncher(dir: 'rtl' | 'ltr', inset = 20): HTMLElement {
    const container = document.createElement('div');
    container.setAttribute('dir', dir);
    const launcher = document.createElement('button');
    launcher.className = DOCK_LAUNCHER_SELECTOR.slice(1);
    launcher.style.position = 'fixed';
    launcher.style.top = `${inset}px`;
    launcher.style.setProperty('inset-inline-start', `${inset}px`);
    launcher.style.width = '40px';
    launcher.style.height = '40px';
    container.appendChild(launcher);
    document.body.appendChild(container);
    planted.push(container);
    return launcher;
  }

  /**
   * Mount a stand-in for the REAL dock: the host element (which owns the app-level `dir`) wrapping a
   * launcher that uses the launcher's own logical positioning. This is the shape the running app has,
   * and the shape `plantLauncher` above deliberately does not have (it uses a bare `div` container).
   */
  function plantDockHost(dir: 'rtl' | 'ltr', inset = 16): HTMLElement {
    const host = document.createElement(DOCK_HOST_SELECTOR);
    host.setAttribute('dir', dir);
    const launcher = document.createElement('button');
    launcher.className = DOCK_LAUNCHER_SELECTOR.slice(1);
    launcher.style.position = 'fixed';
    launcher.style.top = `${inset}px`;
    launcher.style.setProperty('inset-inline-start', `${inset}px`);
    launcher.style.width = '40px';
    launcher.style.height = '40px';
    host.appendChild(launcher);
    document.body.appendChild(host);
    planted.push(host);
    return host;
  }

  function rect(init: Partial<DOMRect> & { left: number; top: number; width: number; height: number }): DOMRect {
    return {
      ...init,
      right: init.left + init.width,
      bottom: init.top + init.height,
      x: init.left,
      y: init.top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  afterEach(() => {
    planted.forEach(el => el.remove());
    planted = [];
    document.querySelectorAll(`.${MINIMIZE_GHOST_CLASS}`).forEach(el => el.remove());
    document.documentElement.removeAttribute('dir');
  });

  // ── the RTL claim ───────────────────────────────────────────────────────────

  describe('resolveMinimizeTarget flips with direction', () => {
    it('RTL: the target lands on the INLINE-START side, which is physically the RIGHT', () => {
      plantLauncher('rtl');

      const target = resolveMinimizeTarget();

      // Physically right: nearer the viewport's right edge than its left.
      expect(target.x).toBeGreaterThan(window.innerWidth / 2);
      expect(window.innerWidth - target.x).toBeLessThan(window.innerWidth / 4);
      expect(target.y).toBeLessThan(window.innerHeight / 2);
    });

    it('LTR: the SAME logical property resolves to the physical LEFT', () => {
      plantLauncher('ltr');

      const target = resolveMinimizeTarget();

      expect(target.x).toBeLessThan(window.innerWidth / 2);
      expect(target.x).toBeLessThan(window.innerWidth / 4);
    });

    it('the two directions really do resolve to OPPOSITE sides (same inset, mirrored x)', () => {
      plantLauncher('rtl');
      const rtl = resolveMinimizeTarget();
      planted.forEach(el => el.remove());
      planted = [];

      plantLauncher('ltr');
      const ltr = resolveMinimizeTarget();

      // Mirror images about the viewport centre. The tolerance absorbs the scrollbar gutter, which the
      // browser places on the inline-start side and therefore counts differently in the two directions.
      expect(Math.abs((window.innerWidth - rtl.x) - ltr.x)).toBeLessThan(24);
    });

    it('measures the launcher LIVE, so moving it moves the target', () => {
      const launcher = plantLauncher('ltr', 20);
      const before = resolveMinimizeTarget();

      launcher.style.top = '200px';
      const after = resolveMinimizeTarget();

      expect(after.y - before.y).toBeCloseTo(180, 0);
    });
  });

  describe('resolveMinimizeTarget fallback (launcher missing or collapsed)', () => {
    it('with NO launcher in the document and dir=rtl, still aims at the inline-start (right) corner', () => {
      document.documentElement.setAttribute('dir', 'rtl');

      const target = resolveMinimizeTarget();

      expect(target.x).toBeCloseTo(window.innerWidth - MINIMIZE_FALLBACK_INSET, 0);
      expect(target.y)
        .withContext('the dock launcher is a BOTTOM-corner affordance, unlike the bell it replaced')
        .toBe(window.innerHeight - MINIMIZE_FALLBACK_INSET);
    });

    it('with NO launcher and dir=ltr, aims at the inline-start (left) corner', () => {
      document.documentElement.setAttribute('dir', 'ltr');

      const target = resolveMinimizeTarget();

      expect(target.x).toBeCloseTo(MINIMIZE_FALLBACK_INSET, 0);
    });

    it('a launcher hidden with display:none (the drawer-open case) falls back instead of aiming at 0,0', () => {
      document.documentElement.setAttribute('dir', 'ltr');
      const launcher = plantLauncher('ltr');
      launcher.style.display = 'none';

      const target = resolveMinimizeTarget();

      // A zero rect would have produced {0, 0}; the fallback inset proves we rejected it.
      expect(target.x).toBeCloseTo(MINIMIZE_FALLBACK_INSET, 0);
      expect(target.y).toBe(window.innerHeight - MINIMIZE_FALLBACK_INSET);
    });

    /**
     * c3 live-browser regression. Reproduces the REAL app configuration measured in the running client:
     * the document resolves to `ltr`, but the dock host carries its own app-level `dir="rtl"`,
     * so the launcher is pinned on the physical RIGHT. Keying the fallback on the document (the previous
     * behaviour) aimed at the physical LEFT - the opposite side of the viewport from the real launcher.
     */
    it('keys the fallback on the DOCK HOST direction, not the document (c3 regression)', () => {
      document.documentElement.setAttribute('dir', 'ltr');
      const host = plantDockHost('rtl');
      const launcher = host.querySelector<HTMLElement>(DOCK_LAUNCHER_SELECTOR)!;

      // Where the launcher really is while it is still visible: the physical RIGHT.
      const visibleLauncherX = launcher.getBoundingClientRect().left;
      expect(visibleLauncherX).toBeGreaterThan(window.innerWidth / 2);

      // The drawer opens -> the launcher stops being rendered -> the fallback runs.
      launcher.style.display = 'none';
      const target = resolveMinimizeTarget();

      expect(target.x).toBeCloseTo(window.innerWidth - MINIMIZE_FALLBACK_INSET, 0);
      expect(target.x).toBeGreaterThan(window.innerWidth / 2);
    });

    it('an LTR dock host still falls back to the physical LEFT', () => {
      document.documentElement.setAttribute('dir', 'rtl');
      const host = plantDockHost('ltr');
      host.querySelector<HTMLElement>(DOCK_LAUNCHER_SELECTOR)!.style.display = 'none';

      expect(resolveMinimizeTarget().x).toBeCloseTo(MINIMIZE_FALLBACK_INSET, 0);
    });
  });

  describe('resolveLauncherSideDirection', () => {
    it('prefers the dock host over the document', () => {
      document.documentElement.setAttribute('dir', 'ltr');
      plantDockHost('rtl');

      expect(resolveLauncherSideDirection()).toBe('rtl');
      expect(resolveDocumentDirection()).toBe('ltr');
    });

    it('falls back to the document when no dock host is mounted', () => {
      document.documentElement.setAttribute('dir', 'rtl');

      expect(resolveLauncherSideDirection()).toBe('rtl');
    });
  });

  describe('resolveDocumentDirection', () => {
    it('reads the resolved direction of the document', () => {
      document.documentElement.setAttribute('dir', 'rtl');
      expect(resolveDocumentDirection()).toBe('rtl');

      document.documentElement.setAttribute('dir', 'ltr');
      expect(resolveDocumentDirection()).toBe('ltr');
    });
  });

  // ── keyframes ───────────────────────────────────────────────────────────────

  describe('buildFlightKeyframes', () => {
    const origin = rect({ left: 800, top: 600, width: 400, height: 200 });

    it('translates by the PHYSICAL delta between the two measured centres', () => {
      // Card centre (1000, 700) -> launcher centre (40, 40): dx = -960, dy = -660.
      const frames = buildFlightKeyframes(origin, { x: 40, y: 40 }, false);

      expect(frames.length).toBe(2);
      expect(frames[1]['transform']).toBe('translate(-960px, -660px) scale(0.12)');
    });

    it('a target on the OTHER side produces the opposite-signed delta (the RTL case)', () => {
      const frames = buildFlightKeyframes(origin, { x: 1880, y: 40 }, false);

      expect(frames[1]['transform']).toBe('translate(880px, -660px) scale(0.12)');
    });

    it('reduced motion cross-fades in place: opacity only, no transform', () => {
      const frames = buildFlightKeyframes(origin, { x: 40, y: 40 }, true);

      expect(frames.every(f => f['transform'] === undefined)).toBeTrue();
      expect(frames.map(f => f['opacity'])).toEqual([0.9, 0]);
    });
  });

  // ── the ghost ───────────────────────────────────────────────────────────────

  describe('flyToActivityCenter', () => {
    const origin = rect({ left: 100, top: 100, width: 300, height: 150 });

    it('renders a decorative ghost sized and placed from the live card rect', () => {
      const ghost = flyToActivityCenter(origin, { target: { x: 40, y: 40 }, reducedMotion: false })!;

      expect(ghost).not.toBeNull();
      expect(ghost.classList).toContain(MINIMIZE_GHOST_CLASS);
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.style.position).toBe('fixed');
      expect(ghost.style.left).toBe('100px');
      expect(ghost.style.width).toBe('300px');
      // Purely decorative: it must never eat a click on the chapter behind it.
      expect(ghost.style.pointerEvents).toBe('none');
    });

    it('the REDUCED-MOTION path still renders, and animates opacity only', () => {
      const ghost = flyToActivityCenter(origin, { target: { x: 40, y: 40 }, reducedMotion: true })!;

      expect(ghost).not.toBeNull();
      const animations = ghost.getAnimations();
      expect(animations.length).toBe(1);
      const effect = animations[0].effect as KeyframeEffect;
      expect(effect.getTiming().duration).toBe(MINIMIZE_FADE_MS);
      expect(effect.getKeyframes().every(f => f['transform'] === undefined)).toBeTrue();
    });

    it('the motion path animates for the full flight duration', () => {
      const ghost = flyToActivityCenter(origin, { target: { x: 40, y: 40 }, reducedMotion: false })!;

      const effect = ghost.getAnimations()[0].effect as KeyframeEffect;
      expect(effect.getTiming().duration).toBe(MINIMIZE_FLIGHT_MS);
    });

    it('removes itself when the animation finishes (no leaked nodes)', async () => {
      const ghost = flyToActivityCenter(origin, { target: { x: 40, y: 40 }, reducedMotion: true })!;
      expect(document.body.contains(ghost)).toBeTrue();

      await ghost.getAnimations()[0].finished;
      // The `finished` promise and the `onfinish` callback are queued independently; yield one macrotask
      // so the callback that does the removal has definitely run.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(document.body.contains(ghost)).toBeFalse();
    });

    it('does nothing when the card could not be measured', () => {
      expect(flyToActivityCenter(null)).toBeNull();
      expect(flyToActivityCenter(rect({ left: 0, top: 0, width: 0, height: 0 }))).toBeNull();
      expect(document.querySelector(`.${MINIMIZE_GHOST_CLASS}`)).toBeNull();
    });

    describe('when the Web Animations API is unavailable', () => {
      // The Animatable mixin puts `animate` on Element.prototype (HTMLElement inherits it from there),
      // so that is the prototype that has to lose it for `typeof ghost.animate !== 'function'` to hold.
      let originalAnimate: typeof Element.prototype.animate;

      beforeEach(() => {
        originalAnimate = Element.prototype.animate;
        delete (Element.prototype as unknown as { animate?: unknown }).animate;
      });

      afterEach(() => {
        Element.prototype.animate = originalAnimate;
      });

      it('returns null (not the ghost) and still removes the node it created', () => {
        const result = flyToActivityCenter(origin, { target: { x: 40, y: 40 } });

        expect(result).toBeNull();
        expect(document.querySelector(`.${MINIMIZE_GHOST_CLASS}`)).toBeNull();
      });
    });
  });
});
