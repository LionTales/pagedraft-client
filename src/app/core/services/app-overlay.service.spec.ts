/**
 * AppOverlayService: the state of the ONE app dock (chatbot phase A.1, w1).
 *
 * c2's version of this service kept two competing overlays mutually exclusive. The owner's merge
 * turned that into tab selection, and these specs pin the properties the merge has to keep:
 *   - exactly one tab's content is ever on screen, which is now a consequence of the shape rather
 *     than a rule that has to be enforced;
 *   - the selected tab SURVIVES a close, so the launcher reopens where the author left off;
 *   - the stale-close guard from c2 still holds.
 */
import { TestBed } from '@angular/core/testing';

import { APP_DOCK_TABS, AppDockTab, AppOverlayService } from './app-overlay.service';

describe('AppOverlayService (chatbot phase A.1)', () => {
  let svc: AppOverlayService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(AppOverlayService);
  });

  it('starts closed, with the assistant tab pre-selected for the first open', () => {
    expect(svc.isOpen).toBeFalse();
    expect(svc.activeTab).toBe('assistant');
    expect(svc.isTabShowing('assistant')).toBeFalse();
    expect(svc.isTabShowing('activity')).toBeFalse();
  });

  it('opening a tab opens the dock ON that tab', () => {
    svc.openTab('activity');
    expect(svc.isOpen).toBeTrue();
    expect(svc.activeTab).toBe('activity');
    expect(svc.isTabShowing('activity')).toBeTrue();
  });

  it('selecting the other tab SWITCHES rather than opening a second surface', () => {
    svc.openTab('assistant');
    svc.selectTab('activity');

    expect(svc.isOpen).withContext('the dock stays open across a switch').toBeTrue();
    expect(svc.isTabShowing('activity')).toBeTrue();
    expect(svc.isTabShowing('assistant'))
      .withContext('the tab that was left must stop showing its content')
      .toBeFalse();
  });

  it('never reports two tabs showing, over an exhaustive open/select sweep', () => {
    // Non-vacuity first: prove the sweep actually puts a tab on screen before asserting "never two".
    let everShowing = 0;
    for (const a of APP_DOCK_TABS) {
      for (const b of APP_DOCK_TABS) {
        svc.openTab(a);
        svc.selectTab(b);
        const showing = APP_DOCK_TABS.filter(t => svc.isTabShowing(t)).length;
        if (showing === 1) everShowing++;
        expect(showing).withContext(`openTab(${a}) then selectTab(${b})`).toBeLessThan(2);
      }
    }
    expect(everShowing).withContext('the sweep must actually reach a showing state').toBeGreaterThan(0);
  });

  it('the launcher reopens on the tab that was last selected', () => {
    svc.openTab('activity');
    svc.close();
    expect(svc.isOpen).toBeFalse();
    expect(svc.activeTab).withContext('the selection outlives the close').toBe('activity');

    svc.open();
    expect(svc.isOpen).toBeTrue();
    expect(svc.isTabShowing('activity')).toBeTrue();
  });

  it('openTab is idempotent and does not re-emit', () => {
    const seen: boolean[] = [];
    svc.isOpen$.subscribe(v => seen.push(v));
    svc.openTab('assistant');
    svc.openTab('assistant');
    expect(seen).toEqual([false, true]);
  });

  it('closeTab(tab) is a NO-OP when the OTHER tab is the one showing', () => {
    // The stale-close case: a tab body's destroy hook (or a late Escape) firing after the author
    // already switched must not close the dock they are now looking at.
    svc.openTab('assistant');
    svc.selectTab('activity');
    svc.closeTab('assistant');

    expect(svc.isOpen)
      .withContext('a stale close from a tab that is no longer showing must not close the dock')
      .toBeTrue();
    expect(svc.isTabShowing('activity')).toBeTrue();
  });

  it('isTabShowing$ emits only when THIS tab comes or goes', () => {
    const seen: boolean[] = [];
    svc.isTabShowing$('assistant').subscribe(v => seen.push(v));
    svc.openTab('activity');    // not us: no emission
    svc.openTab('assistant');   // us: true
    svc.selectTab('activity');  // us: false
    svc.close();                // still not showing: de-duplicated
    expect(seen).toEqual([false, true, false]);
  });

  it('activeTab$ tracks the selection and de-duplicates a re-select', () => {
    const seen: AppDockTab[] = [];
    svc.activeTab$.subscribe(v => seen.push(v));
    svc.openTab('activity');
    svc.openTab('activity');
    svc.selectTab('assistant');
    expect(seen).toEqual(['assistant', 'activity', 'assistant']);
  });

  it('exposes no two-overlay vocabulary any more (the merged dock has one panel)', () => {
    // The plan asked for the mutual-exclusion path to be REMOVED rather than left dead. A dead
    // `open(id)` / `isAnyOpen$` pair would still compile and still be reachable from a future caller.
    const api = svc as unknown as Record<string, unknown>;
    expect(api['isAnyOpen$']).toBeUndefined();
    expect(api['openId']).toBeUndefined();
    expect(api['openId$']).toBeUndefined();

    // Same rule, applied to the two methods the review pass removed (f04): `toggle()` and
    // `toggleTab()` had no production caller. The launcher opens and the close button closes, and
    // there is no gesture that flips the dock's state without knowing what that state is. Pinned
    // here for the same reason as the three above: an unreferenced public method is an invitation.
    expect(api['toggle']).toBeUndefined();
    expect(api['toggleTab']).toBeUndefined();
  });
});
