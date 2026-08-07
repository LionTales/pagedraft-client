import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  HostListener,
  OnDestroy,
  inject,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Subject, map, takeUntil } from 'rxjs';

import { ActivityCenterComponent, LABELS_EN, LABELS_HE } from '../activity-center/activity-center.component';
import { ProductChatComponent } from '../product-chat/product-chat.component';
import { AppDockTab, AppOverlayService } from '../../core/services/app-overlay.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { ChatChromeLang, chatString } from '../../core/i18n/chat-strings';
import { DockStringKey, dockString, launcherAriaLabel } from '../../core/i18n/dock-strings';

/**
 * The app dock: ONE launcher and ONE drawer with tabs, mounted once for every route
 * (chatbot phase A.1, w1).
 *
 * ── What this replaced, and why ────────────────────────────────────────────────────────────────────
 * c2 shipped two separate app-level surfaces: the Activity Center (a bell in the TOP inline-start
 * corner plus a panel on the inline-start edge) and the product-chat drawer (a launcher in the bottom
 * inline-end corner plus a drawer on the inline-end edge). Driving it, the owner asked for one drawer
 * with tabs and one launcher. Two affordances is also what produced the visible defect: the bell sat
 * in the top corner the chat drawer's own header title occupies in Hebrew, so it overlapped the word
 * "עוזר". Restyling the bell would have left the overlap one layout change away; the top-corner
 * affordance is GONE instead, and the single launcher lives at the BOTTOM.
 *
 * ── HOSTING EDGE: inline-START, i.e. the Activity Center's existing edge ───────────────────────────
 * The owner asked for the drawer on the RIGHT, twice, and the app is Hebrew/RTL by default. Rather
 * than hard-code a physical side, the merged dock is hosted on the edge the Activity Center already
 * owned: `inset-inline-start`. In Hebrew that IS the physical right, which is what the owner asked
 * for; in English it stays on the left, which is where every existing Activity Center user already
 * reaches for it. A hard-coded physical right would have satisfied Hebrew and moved the surface out
 * from under English users for no reason.
 *
 * ── Why both tab bodies stay MOUNTED ───────────────────────────────────────────────────────────────
 * `<app-product-chat>` and `<app-activity-center>` are rendered unconditionally, and each one gates
 * its own CONTENT on `AppOverlayService.isTabShowing$(...)`. That is deliberate on both counts:
 *   - Mounted: the chat transcript lives in the component for the life of the session, so destroying
 *     it on a tab switch (or on a close) would silently throw away the author's conversation. The
 *     component instance therefore outlives both gestures; only its DOM comes and goes.
 *   - Content-gated by the service: exactly one tab can be showing, so neither tab's content can leak
 *     into the other, and the gate is the SAME seam c2 introduced rather than a second mechanism.
 *
 * ── Language ───────────────────────────────────────────────────────────────────────────────────────
 * App-level chrome, so Hebrew-default, following the Activity Center's convention: this surface is
 * reachable from every route including ones where no book is open, so there is no book language to
 * follow. `appLang` is hardcoded until a global i18n service exists, exactly as the two tab bodies
 * hardcode theirs.
 *
 * The two TAB LABELS are read from the surfaces they name (`chat-strings` and the Activity Center's
 * own label map) rather than copied into the dock's map, so a tab cannot drift from the panel it
 * opens.
 *
 * ── Z RUNGS ────────────────────────────────────────────────────────────────────────────────────────
 * backdrop `--pd-z-overlay` (100), drawer `+5` (105), launcher `+10` (110). The launcher is above the
 * drawer's rung but is not rendered while the drawer is open, so nothing floats over the panel.
 */
@Component({
  selector: 'app-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, ActivityCenterComponent, ProductChatComponent],
  templateUrl: './app-dock.component.html',
  styleUrl: './app-dock.component.scss',
})
export class AppDockComponent implements OnDestroy {
  private readonly overlays = inject(AppOverlayService);
  private readonly registry = inject(JobRegistryService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly destroy$ = new Subject<void>();

  /**
   * App-level chrome language. Hebrew-default per the app-level i18n convention. Hardcoded for now
   * because no global i18n service exists; kept private and readable through {@link lang} so a spec
   * can flip it the way the Activity Center's spec flips its own.
   */
  private appLang: ChatChromeLang = 'he';

  /** Mirrors of the dock state, so the OnPush template reads plain fields. */
  private openState = false;
  private tabState: AppDockTab = 'assistant';

  /** Widened to roughly a side-panel's worth. The owner asked for "expandable toward the side panel". */
  expanded = false;

  constructor() {
    this.overlays.isOpen$.pipe(takeUntil(this.destroy$)).subscribe(open => {
      this.openState = open;
      this.cdr.markForCheck();
    });
    this.overlays.activeTab$.pipe(takeUntil(this.destroy$)).subscribe(tab => {
      this.tabState = tab;
      this.cdr.markForCheck();
    });
  }

  /** Dir on the host, so the drawer, the tabs and the launcher all mirror with the app language. */
  @HostBinding('attr.dir')
  get dir(): 'rtl' | 'ltr' {
    return this.appLang === 'he' ? 'rtl' : 'ltr';
  }

  /** The chrome language, for the template and for specs. */
  get lang(): ChatChromeLang {
    return this.appLang;
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get activeTab(): AppDockTab {
    return this.tabState;
  }

  // ── Live job count ──────────────────────────────────────────────────────────────────────────────

  /**
   * Non-terminal jobs, counted for the launcher badge.
   *
   * This is why the Activity Center bell existed, so it had to survive the merge: the count is now
   * carried by the ONE launcher (and, while the drawer is open and the launcher is therefore not
   * rendered, by the activity tab itself, so the number never disappears mid-run).
   *
   * Both badges render the number beside a `⟳` mark rather than alone (c02). The launcher's glyph is a
   * speech bubble, and a bare number on a speech bubble reads as unread MESSAGES, which is the opposite
   * of what this counts. The mark and the composed accessible name below say the same thing, one to the
   * eye and one to a screen reader.
   */
  readonly activeCount$ = this.registry.activeJobs$.pipe(map(jobs => jobs.length));

  /** The launcher's accessible name, which carries the count rather than hiding it in a glyph. */
  readonly launcherAria$ = this.activeCount$.pipe(
    map(count => launcherAriaLabel(this.appLang, count)),
  );

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────────

  /** Resolve a localized dock string. */
  label(key: DockStringKey): string {
    return dockString(this.appLang, key);
  }

  /**
   * A tab's label, taken from the surface the tab opens rather than from the dock's own map, so the
   * tab and the panel it names cannot drift apart.
   */
  tabLabel(tab: AppDockTab): string {
    if (tab === 'assistant') return chatString(this.appLang, 'drawerTitle');
    return (this.appLang === 'he' ? LABELS_HE : LABELS_EN)['panelTitle'];
  }

  /** DOM ids for the tab/tabpanel wiring. */
  tabId(tab: AppDockTab): string {
    return `dock-tab-${tab}`;
  }

  panelId(tab: AppDockTab): string {
    return `dock-panel-${tab}`;
  }

  // ── Gestures ────────────────────────────────────────────────────────────────────────────────────

  /** The launcher: open onto whichever tab the author was last on. */
  openDock(): void {
    this.overlays.open();
  }

  close(): void {
    this.overlays.close();
  }

  /** Select a tab. Switching does not close the dock and does not touch the other tab's state. */
  select(tab: AppDockTab): void {
    this.overlays.selectTab(tab);
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  /** Escape closes the dock, matching the dismissal both merged surfaces already had. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }

  ngOnDestroy(): void {
    // Unsubscribe FIRST, so releasing the dock below cannot call markForCheck on a view on its way out.
    this.destroy$.next();
    this.destroy$.complete();
    this.overlays.close();
  }
}
