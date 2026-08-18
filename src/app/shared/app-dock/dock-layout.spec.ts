/**
 * The dock, MEASURED (chatbot phase A.1, w1). Supersedes `product-chat/overlay-layout.spec.ts`, which
 * pinned the two-overlay arrangement that no longer exists.
 *
 * What is pinned here is the positioning contract the owner's feedback turned into a requirement:
 *   - in Hebrew (the app default) the drawer is on the PHYSICAL RIGHT. That is the side the owner
 *     asked for, and it is reached WITHOUT hard-coding a physical side: the dock is hosted on the
 *     Activity Center's existing `inset-inline-start` edge, which resolves to the right in RTL and the
 *     left in LTR, so English users keep the edge they already know.
 *   - the single launcher is at the BOTTOM of that same edge, and there is NOTHING in the top corner
 *     the Activity Center bell used to occupy. That corner is where the drawer's own header sits, and
 *     a fixed control there is what overlapped the assistant's title.
 *   - nothing occludes the drawer header, asserted by hit-testing rather than by counting elements.
 *
 * A single fixture, deliberately: `TestBed.createComponent` removes any previously inserted root, so a
 * geometry suite spread over two fixtures measures a detached tree and passes while proving nothing.
 */
import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AppDockComponent } from './app-dock.component';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';

/** Do two rects share any area? Touching edges is not an overlap. */
function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Stop an element's motion before measuring it.
 *
 * The drawer parks itself off the inline-start edge and transitions back, so a rect read in the same
 * frame as the open reports an edge the user never sees. Neutralizing motion changes no layout rule; it
 * just lets the final layout be read now.
 */
function settleMotion(el: HTMLElement): void {
  el.style.animation = 'none';
  el.style.transition = 'none';
}

/**
 * Minimal registry stub: this suite is about geometry, not about rows. `activeJobs$` is settable only
 * because the badge has a BOX, and a box is geometry - see the badge-fit spec at the bottom.
 */
class JobRegistryStub {
  private readonly activeSubject = new BehaviorSubject<TrackedJob[]>([]);

  readonly jobs$ = new BehaviorSubject<TrackedJob[]>([]).asObservable();
  readonly activeJobs$ = this.activeSubject.asObservable();

  setActive(count: number): void {
    this.activeSubject.next(
      Array.from({ length: count }, (_, i) => ({ id: `job-${i}`, status: 'running' } as TrackedJob)),
    );
  }
}

describe('AppDock layout (chatbot phase A.1)', () => {
  let fixture: ComponentFixture<AppDockComponent>;
  let component: AppDockComponent;
  let registry: JobRegistryStub;
  let http: HttpTestingController;

  beforeEach(async () => {
    registry = new JobRegistryStub();

    await TestBed.configureTestingModule({
      imports: [AppDockComponent],
      providers: [
        { provide: JobRegistryService, useValue: registry },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppDockComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function q(sel: string) {
    return fixture.debugElement.query(By.css(sel));
  }

  function rect(sel: string): DOMRect {
    const el = q(sel);
    expect(el).withContext(`${sel} must be on screen to be measured`).not.toBeNull();
    return (el.nativeElement as HTMLElement).getBoundingClientRect();
  }

  /** The viewport WITHOUT the scrollbar, which is what a fixed element's inline edges align to. */
  function viewportWidth(): number {
    return document.documentElement.clientWidth;
  }

  function viewportHeight(): number {
    return document.documentElement.clientHeight;
  }

  function openDock(): void {
    (q('.dock-launcher').nativeElement as HTMLElement).click();
    fixture.detectChanges();
    settleMotion(q('.dock-drawer').nativeElement as HTMLElement);
  }

  /** Point the dock at an app language, the way the Activity Center's own spec does. */
  function useLang(lang: 'he' | 'en'): void {
    (component as unknown as { appLang: 'he' | 'en' }).appLang = lang;
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
  }

  it('puts the drawer on the PHYSICAL RIGHT in Hebrew, which is what the owner asked for', () => {
    openDock();
    const drawer = rect('.dock-drawer');

    // Non-vacuity: a zero-width drawer, or one still parked off-viewport, would pass any edge test.
    expect(drawer.width).withContext('the drawer must have a box').toBeGreaterThan(100);
    expect(drawer.left).withContext('the drawer must be on screen').toBeGreaterThan(-1);

    expect(Math.abs(drawer.right - viewportWidth()))
      .withContext('RTL: the drawer hugs the physical RIGHT edge')
      .toBeLessThan(2);
  });

  it('and flips to the physical LEFT in English, so LTR users keep the edge they know', () => {
    useLang('en');
    openDock();
    const drawer = rect('.dock-drawer');

    expect(drawer.width).toBeGreaterThan(100);
    expect(drawer.left)
      .withContext('LTR: the same logical edge resolves to the physical LEFT')
      .toBeLessThan(2);
  });

  it('puts the single launcher at the BOTTOM, and leaves the old bell corner EMPTY', () => {
    expect(viewportHeight()).toBeGreaterThan(300);

    for (const lang of ['he', 'en'] as const) {
      useLang(lang);
      const launcher = rect('.dock-launcher');

      expect(launcher.width).withContext(`${lang}: non-vacuity, the launcher has a box`).toBeGreaterThan(0);
      expect(launcher.top)
        .withContext(`${lang}: the launcher is a BOTTOM affordance`)
        .toBeGreaterThan(viewportHeight() / 2);

      // The corner the Activity Center bell used to hold: top inline-start, i.e. top-right in Hebrew.
      // It has to be EMPTY, because that is the corner the drawer's own header occupies.
      const inlineStartX = lang === 'he' ? viewportWidth() - 40 : 40;
      const topCorner = document.elementFromPoint(inlineStartX, 40);
      expect(topCorner?.closest('.dock-launcher'))
        .withContext(`${lang}: no launcher may sit in the top inline-start corner`)
        .toBeNull();
    }
  });

  it('the launcher and the drawer are never on screen together', () => {
    // One affordance, one panel: there is no pair left to arbitrate with a z-index.
    expect(q('.dock-launcher')).not.toBeNull();
    openDock();
    expect(q('.dock-launcher')).toBeNull();
  });

  it('NOTHING occludes the drawer header, in either direction', () => {
    // The defect that drove this merge, asserted by hit-testing rather than by counting elements: the
    // author reported the bell sitting on top of the word "עוזר" in the header. Whatever is topmost at
    // the header tab's own centre must BE that tab.
    for (const lang of ['he', 'en'] as const) {
      useLang(lang);
      if (!component.isOpen) openDock();
      settleMotion(q('.dock-drawer').nativeElement as HTMLElement);

      const tab = q('.dock-tab').nativeElement as HTMLElement;
      const box = tab.getBoundingClientRect();
      expect(box.width).withContext(`${lang}: non-vacuity, the tab has a box`).toBeGreaterThan(10);

      const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      expect(topmost)
        .withContext(`${lang}: something is on top of the drawer's own tab strip`)
        .toBe(tab as Element);
    }
  });

  it('the drawer stays inside the viewport in the narrow regime, in either direction', () => {
    // Raising --dock-width out of reach makes the viewport-relative clamp the ACTIVE width term, which
    // is the branch a phone takes. This exercises the real rule rather than simulating it.
    const host = fixture.nativeElement as HTMLElement;
    host.style.setProperty('--dock-width', '100000px');
    host.style.setProperty('--dock-width-wide', '100000px');
    fixture.detectChanges();

    for (const lang of ['he', 'en'] as const) {
      useLang(lang);
      if (!component.isOpen) openDock();
      settleMotion(q('.dock-drawer').nativeElement as HTMLElement);
      const drawer = rect('.dock-drawer');

      expect(drawer.width)
        .withContext(`${lang}: the viewport clamp must be the ACTIVE width term`)
        .toBeLessThan(viewportWidth());
      expect(drawer.width)
        .withContext(`${lang}: and it must still take nearly the whole viewport`)
        .toBeGreaterThan(viewportWidth() - 120);
      expect(drawer.left).withContext(`${lang}: the drawer must be on screen`).toBeGreaterThan(-1);
      expect(drawer.right)
        .withContext(`${lang}: the drawer must be on screen`)
        .toBeLessThan(viewportWidth() + 1);
    }
  });

  it('keeps the documented z rungs: backdrop below drawer below launcher', () => {
    const launcherZ = Number(getComputedStyle(q('.dock-launcher').nativeElement).zIndex);
    openDock();
    const drawerZ = Number(getComputedStyle(q('.dock-drawer').nativeElement).zIndex);
    const backdropZ = Number(getComputedStyle(q('.dock-backdrop').nativeElement).zIndex);

    expect(Number.isFinite(drawerZ)).withContext('non-vacuity: the rungs must resolve').toBeTrue();
    expect(backdropZ).toBe(100);
    expect(drawerZ).toBe(105);
    expect(launcherZ).toBe(110);
    expect(backdropZ).toBeLessThan(drawerZ);
  });

  it('the closed drawer is not merely transparent: it is out of the hit-test and the a11y tree', () => {
    const drawer = q('.dock-drawer').nativeElement as HTMLElement;
    expect(getComputedStyle(drawer).visibility)
      .withContext('a closed drawer that is only transparent would still swallow clicks')
      .toBe('hidden');
    expect(drawer.querySelector('.pc-pane')).withContext('and it renders no content at all').toBeNull();
    expect(drawer.querySelector('.ac-panel')).toBeNull();
  });

  it('the marked badge still FITS the 56px launcher, on the outer corner in both directions', () => {
    // c02 chose to widen the badge (a `⟳` mark beside the number) rather than change the launcher's
    // icon, so the thing that could go wrong is crowding: the badge is two glyphs wide on a small
    // control. Measured rather than eyeballed, at the widest count the badge is likely to carry.
    // A.2 swapped the icon itself (emoji -> Show's avatar) and this measurement is why: a bigger icon
    // leaves the badge less room, so the clearance below is doing real work.
    // f2b took the button 48 -> 56 and the icon 32 -> 48, which CLOSES that clearance rather than
    // opening it: the icon grew by 16 and the button by only 8, so the gap between the badge and the
    // face is 4px narrower than the arrangement this spec was first written against. The size below is
    // re-pinned, not relaxed, and every clearance assertion after it is unchanged.
    registry.setActive(12);
    fixture.detectChanges();

    for (const lang of ['he', 'en'] as const) {
      useLang(lang);
      const launcher = rect('.dock-launcher');
      const badge = rect('.dock-badge');
      const icon = rect('.dock-launcher-icon');

      expect(badge.width).withContext(`${lang}: non-vacuity, the badge has a box`).toBeGreaterThan(0);
      expect(launcher.width).withContext(`${lang}: the launcher is the documented 56px`).toBe(56);
      expect(icon.width)
        .withContext(`${lang}: and the face inside it is the documented 48px`)
        .toBe(48);

      // It may overhang the corner (it is designed to, by 4px) but it must not grow into a second
      // control: the badge stays no wider than the button it annotates.
      expect(badge.width)
        .withContext(`${lang}: the badge must stay a badge, not become a pill across the launcher`)
        .toBeLessThanOrEqual(launcher.width);

      // And it must not COVER the icon it annotates. Any-pixel overlap is the wrong predicate here
      // (the badge is designed to sit on the rim); what matters is that Show's face is still
      // recognizable, so the test is that the icon's own centre is not underneath the badge.
      const iconCentre = { x: icon.left + icon.width / 2, y: icon.top + icon.height / 2 };
      const coversGlyph =
        iconCentre.x > badge.left && iconCentre.x < badge.right &&
        iconCentre.y > badge.top && iconCentre.y < badge.bottom;
      expect(coversGlyph)
        .withContext(`${lang}: the badge must not sit on top of the launcher's own glyph`)
        .toBeFalse();
      expect(badge.bottom)
        .withContext(`${lang}: the badge stays in the launcher's top half`)
        .toBeLessThan(launcher.top + launcher.height / 2);

      // The OUTER corner, resolved from `dir` rather than hard-coded: inline-end is the physical left
      // in Hebrew and the physical right in English. A `right:` here would pin the wrong corner in he.
      if (lang === 'he') {
        expect(badge.left)
          .withContext('he: the badge hangs off the launcher\'s physical LEFT corner')
          .toBeLessThan(launcher.left + 1);
      } else {
        expect(badge.right)
          .withContext('en: the badge hangs off the launcher\'s physical RIGHT corner')
          .toBeGreaterThan(launcher.right - 1);
      }
      expect(badge.top).withContext(`${lang}: and off the TOP of it`).toBeLessThan(launcher.top + 1);
    }
  });

  it('the launcher itself is what a click lands on, not the face drawn inside it', () => {
    // f2b added this because the comment in app-dock.component.scss claimed it already existed. It did
    // not: the only `elementFromPoint` contract in this file was the drawer TAB's, and the launcher's
    // `pointer-events: none` was load-bearing but unpinned. It matters more at f2b's sizes than it did
    // before - the face now fills 48 of the button's 56px, so an icon that swallowed pointer events
    // would swallow nearly the whole control, and the click handler and accessible name are both on
    // the BUTTON. Hit-tested at the dead centre, which is the one point the icon certainly covers.
    //
    // THE VISIBILITY LINE BELOW IS WHAT MAKES THIS TEST NON-VACUOUS, and dropping it would silently
    // gut the spec. Karma's headless Chrome reports `prefers-reduced-motion: no-preference`, so the
    // flip block applies and the <img> is `visibility: hidden` - and a hidden element is not
    // hit-testable AT ALL, so the button would come back topmost whether or not `pointer-events` were
    // ever declared. Forcing the image visible reproduces exactly what a reader who has asked for
    // reduced motion sees, which is the branch where the property actually does the work, and leaves
    // `pointer-events: none` as the only thing standing between the icon and the click.
    for (const lang of ['he', 'en'] as const) {
      useLang(lang);
      const launcher = q('.dock-launcher').nativeElement as HTMLElement;
      const iconEl = q('.dock-launcher-icon').nativeElement as HTMLElement;
      iconEl.style.visibility = 'visible';

      const box = launcher.getBoundingClientRect();
      expect(box.width).withContext(`${lang}: non-vacuity, the launcher has a box`).toBeGreaterThan(10);

      // Non-vacuity for the hit test itself: the icon must actually BE there and actually cover the
      // centre, or "the button is topmost" would be true of an empty button and prove nothing.
      const icon = iconEl.getBoundingClientRect();
      const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      expect(icon.left < centre.x && centre.x < icon.right && icon.top < centre.y && centre.y < icon.bottom)
        .withContext(`${lang}: the icon must cover the centre for this test to mean anything`)
        .toBeTrue();
      expect(getComputedStyle(iconEl).visibility)
        .withContext(`${lang}: and it must be hit-testable, or pointer-events is not what is being read`)
        .toBe('visible');

      expect(document.elementFromPoint(centre.x, centre.y))
        .withContext(`${lang}: the icon (or the flip overlay) is intercepting the launcher's clicks`)
        .toBe(launcher as Element);

      iconEl.style.visibility = '';
    }
  });

  it('intersects() is a real predicate (guard against a vacuous overlap helper)', () => {
    const a = { left: 0, right: 10, top: 0, bottom: 10 } as DOMRect;
    const b = { left: 5, right: 15, top: 5, bottom: 15 } as DOMRect;
    const c = { left: 20, right: 30, top: 20, bottom: 30 } as DOMRect;
    expect(intersects(a, b)).toBeTrue();
    expect(intersects(a, c)).toBeFalse();
  });
});
