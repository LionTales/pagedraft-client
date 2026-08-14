import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, distinctUntilChanged, map } from 'rxjs';

/**
 * The tabs of the app dock. Adding one here is a commitment: it becomes a tab in the single
 * app-level drawer, not a new overlay.
 */
export type AppDockTab = 'assistant' | 'activity';

/** Every tab, in the order the dock renders them. Exported so a spec can sweep them exhaustively. */
export const APP_DOCK_TABS: readonly AppDockTab[] = ['assistant', 'activity'] as const;

/** Whether the dock is showing, and which tab it is showing. */
interface DockState {
  open: boolean;
  tab: AppDockTab;
}

/**
 * The state of the ONE app-level dock: is it open, and which tab is on.
 *
 * ── Why this is no longer a mutual exclusion (chatbot phase A.1, w1) ────────────────────────────────
 * c2 shipped two competing full-height overlays on opposite inline edges - the Activity Center panel
 * and the product-chat drawer - and this service existed to make them MUTUALLY EXCLUSIVE, because two
 * such panels cannot both fit on a narrow viewport and "which one wins" would otherwise have been
 * settled by z-index, i.e. by one silently occluding the other.
 *
 * The owner then asked for the two surfaces to be MERGED into one drawer with tabs and one launcher.
 * That removes the problem rather than arbitrating it: there is one panel, so there is no pair to keep
 * apart, and the old exclusivity collapses into ordinary tab selection. Nothing here still models "two
 * overlays": a dead exclusion path would be a rule nobody could see being applied.
 *
 * What SURVIVED the merge on purpose is the seam: `isTabShowing$(tab)` is the same shape as the old
 * `isOpen$(id)`, so `ActivityCenterComponent.panelOpen` and the chat drawer's own open gate still route
 * through this service and still render their content only when their tab is the one on screen. That is
 * what keeps each surface's content out of the other's tab.
 *
 * It is a root singleton with no dependencies of its own, so injecting it into a component adds no
 * transitive provider a TestBed has to learn about.
 */
@Injectable({ providedIn: 'root' })
export class AppOverlayService {
  /** Closed, remembering `assistant` as the tab the launcher will open onto first. */
  private readonly stateSubject = new BehaviorSubject<DockState>({ open: false, tab: 'assistant' });

  /** Whether the dock drawer is open at all. */
  readonly isOpen$: Observable<boolean> = this.stateSubject.pipe(
    map(s => s.open),
    distinctUntilChanged(),
  );

  /**
   * The selected tab, which is remembered while the dock is CLOSED as well: reopening from the
   * launcher returns the author to the tab they were last on rather than resetting them.
   */
  readonly activeTab$: Observable<AppDockTab> = this.stateSubject.pipe(
    map(s => s.tab),
    distinctUntilChanged(),
  );

  /** Snapshot: is the dock open. */
  get isOpen(): boolean {
    return this.stateSubject.value.open;
  }

  /** Snapshot: the selected tab (meaningful whether or not the dock is open). */
  get activeTab(): AppDockTab {
    return this.stateSubject.value.tab;
  }

  /**
   * Fires every time {@link openTab} is called for a tab, INCLUDING when the dock was already open on
   * that exact tab (finding C13). `activeTab$` and `isTabShowing$` only emit on a real state change, so
   * a pointer's "Open Show" button clicked while Show is already the tab on screen produces `commit`'s
   * early return and NOTHING happens - no re-render, no focus move, no feedback of any kind. This is
   * the channel a tab body listens on to do something on a REPEATED open, distinct from "the tab
   * changed": the assistant tab uses it to move focus into its composer, which is the only sensible
   * response to "open the thing that is already open" a text-input surface has.
   */
  readonly tabOpenRequested$ = new Subject<AppDockTab>();

  /** Whether `tab`'s content is on screen right now: the dock is open AND this is the selected tab. */
  isTabShowing(tab: AppDockTab): boolean {
    const { open, tab: active } = this.stateSubject.value;
    return open && active === tab;
  }

  /**
   * A stream of "is `tab`'s content on screen", de-duplicated so a sibling tab's comings and goings do
   * not churn it. This is the seam each tab body gates its own rendering on, which is what makes it
   * impossible for one tab's content to appear inside the other.
   */
  isTabShowing$(tab: AppDockTab): Observable<boolean> {
    return this.stateSubject.pipe(
      map(s => s.open && s.tab === tab),
      distinctUntilChanged(),
    );
  }

  /**
   * Open the dock on `tab`, selecting it if another tab was on.
   *
   * The STATE commit is idempotent (open on an already-open tab is a no-op write), but
   * {@link tabOpenRequested$} always fires, so a caller can still observe "the open gesture happened
   * again" even when nothing about the dock's state changed.
   */
  openTab(tab: AppDockTab): void {
    this.commit({ open: true, tab });
    this.tabOpenRequested$.next(tab);
  }

  /**
   * Select `tab`. Alias of {@link openTab}, named for the gesture that reads as switching rather than
   * opening; a tab click on a closed dock (there is no such gesture today, but a keyboard shortcut
   * would be one) opens it rather than silently selecting an invisible tab.
   */
  selectTab(tab: AppDockTab): void {
    this.openTab(tab);
  }

  /** Open the dock on whichever tab was last selected. The launcher's gesture. */
  open(): void {
    this.commit({ ...this.stateSubject.value, open: true });
  }

  /** Close the dock, remembering the selected tab for the next open. */
  close(): void {
    this.commit({ ...this.stateSubject.value, open: false });
  }

  /**
   * Close the dock only if `tab` is the one currently showing.
   *
   * The stale-close guard, kept from c2 and still load-bearing: a tab body's destroy hook, or an
   * Escape handled after the author already switched tabs, must not yank a surface out from under
   * them.
   */
  closeTab(tab: AppDockTab): void {
    if (this.isTabShowing(tab)) this.close();
  }

  /** Emit only on a real change, so an idempotent open does not re-render every subscriber. */
  private commit(next: DockState): void {
    const current = this.stateSubject.value;
    if (current.open === next.open && current.tab === next.tab) return;
    this.stateSubject.next(next);
  }
}
