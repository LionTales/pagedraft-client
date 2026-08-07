/**
 * AppDockComponent: ONE launcher, ONE drawer, two tabs (chatbot phase A.1, w1).
 *
 * What this pins is what the merge had to get right:
 *  - the single launcher carries the live job badge and its pluralized accessible name. That coverage
 *    came from the Activity Center BELL spec, which could not survive the bell being deleted, so it
 *    lives here now against the affordance that actually exists;
 *  - switching tabs shows the other surface AND takes the first one off screen, so neither tab's
 *    content can leak into the other;
 *  - the top-corner affordance is GONE, not restyled, which is the thing that stopped the assistant's
 *    own title being overlapped.
 *
 * The geometry claims (which physical edge in which direction, and the narrow viewport) are measured
 * in `dock-layout.spec.ts` beside this file, because they need real layout rather than DOM presence.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AppDockComponent } from './app-dock.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import { DOCK_STRINGS_EN, DOCK_STRINGS_HE } from '../../core/i18n/dock-strings';
import { CHAT_STRINGS_EN, CHAT_STRINGS_HE } from '../../core/i18n/chat-strings';
import { LABELS_EN, LABELS_HE } from '../activity-center/activity-center.component';

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<TrackedJob> = {}): TrackedJob {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    kind: 'review',
    bookId: 'book-1',
    scopeLabel: 'הספר כולו',
    titleHe: 'סקירת הספר',
    titleEn: 'Reviewing book',
    status: 'running',
    percent: null,
    completedChunks: null,
    totalChunks: null,
    chunkClock: EMPTY_CHUNK_CLOCK,
    message: '',
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * `getComputedStyle` reports colours as `rgb(r, g, b)` while the design tokens are authored as hex,
 * so a colour assertion has to normalize one side. Returns lowercase `#rrggbb`.
 */
function hexOf(color: string): string {
  const parts = color.match(/\d+/g);
  if (!parts || parts.length < 3) return color.trim().toLowerCase();
  return '#' + parts.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
}

/** BehaviorSubject-backed JobRegistryService stub, mirroring the shape the dock and its tabs read. */
class JobRegistryStub {
  private readonly allSubject = new BehaviorSubject<TrackedJob[]>([]);
  private readonly activeSubject = new BehaviorSubject<TrackedJob[]>([]);

  readonly jobs$ = this.allSubject.asObservable();
  readonly activeJobs$ = this.activeSubject.asObservable();

  setJobs(all: TrackedJob[]): void {
    this.allSubject.next(all);
    this.activeSubject.next(all.filter(j => j.status === 'running' || j.status === 'pending'));
  }

  setActive(active: TrackedJob[]): void {
    this.activeSubject.next(active);
  }
}

describe('AppDockComponent (chatbot phase A.1)', () => {
  let fixture: ComponentFixture<AppDockComponent>;
  let component: AppDockComponent;
  let overlays: AppOverlayService;
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
    overlays = TestBed.inject(AppOverlayService);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function q(sel: string) {
    return fixture.debugElement.query(By.css(sel));
  }

  function qa(sel: string) {
    return fixture.debugElement.queryAll(By.css(sel));
  }

  /** Open the dock the way the author does. */
  function openDock(): void {
    (q('.dock-launcher').nativeElement as HTMLElement).click();
    fixture.detectChanges();
  }

  /** Click a tab by its rendered label. */
  function clickTab(label: string): void {
    const tab = qa('.dock-tab').find(t => (t.nativeElement as HTMLElement).textContent?.includes(label));
    expect(tab).withContext(`a tab labelled "${label}" must exist`).toBeDefined();
    (tab!.nativeElement as HTMLElement).click();
    fixture.detectChanges();
  }

  function useEnglish(): void {
    (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
    fixture.detectChanges();
  }

  // ── One launcher, and no second affordance ──────────────────────────────────────────────────────

  describe('the single launcher', () => {
    it('renders exactly ONE app-level launcher, and no top-corner bell', () => {
      expect(qa('.dock-launcher').length).toBe(1);
      // The merge's whole point: the bell that used to occupy the top inline-start corner (and overlap
      // the assistant's own title in Hebrew) is GONE, not restyled.
      expect(q('.ac-bell')).withContext('the Activity Center bell must not exist any more').toBeNull();
      expect(q('.pc-launcher')).withContext('nor the chat drawer\'s own second launcher').toBeNull();
    });

    it('opens the drawer, and stops rendering itself while the drawer covers its corner', () => {
      expect(q('.dock-drawer--is-open')).toBeNull();

      openDock();

      expect(q('.dock-drawer--is-open')).not.toBeNull();
      expect(q('.dock-launcher'))
        .withContext('the launcher must not float over the panel it opened')
        .toBeNull();
    });

    it('closes on the close button and on Escape', () => {
      openDock();
      const close = qa('.dock-icon-btn')
        .find(b => (b.nativeElement as HTMLElement).getAttribute('aria-label') === component.label('close'));
      close!.nativeElement.click();
      fixture.detectChanges();
      expect(q('.dock-drawer--is-open')).toBeNull();

      openDock();
      component.onEscape();
      fixture.detectChanges();
      expect(q('.dock-drawer--is-open')).toBeNull();
    });

    it('reopens on the tab the author left, rather than resetting them to the first one', () => {
      openDock();
      clickTab(component.tabLabel('activity'));
      expect(component.activeTab).toBe('activity');

      component.close();
      fixture.detectChanges();
      openDock();

      expect(component.activeTab).toBe('activity');
      expect(q('.ac-panel')).withContext('and the activity content really is what came back').not.toBeNull();
    });
  });

  // ── The live badge, inherited from the bell ─────────────────────────────────────────────────────

  describe('launcher badge (the reason the bell existed)', () => {
    it('does not render the badge when there are zero active jobs', () => {
      registry.setJobs([]);
      fixture.detectChanges();
      expect(q('.dock-badge')).toBeNull();
    });

    it('renders the badge with the correct count when there are active jobs', () => {
      registry.setJobs([
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'running' }),
      ]);
      fixture.detectChanges();

      const badge = q('.dock-badge');
      expect(badge).not.toBeNull();
      expect((q('.dock-badge .dock-badge-count').nativeElement as HTMLElement).textContent?.trim())
        .toBe('2');
    });

    it('NAMES the count as running work, so a number on the chat glyph cannot read as unread messages', () => {
      // c02. The launcher's glyph is a speech bubble and the badge is a numeric corner badge, which is
      // the unread-messages idiom in every product that ships one - and this number means the opposite.
      // Pinned so a future simplification cannot quietly put a bare digit back on a speech bubble.
      registry.setJobs([
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'running' }),
        makeJob({ id: 'j3', status: 'pending' }),
      ]);
      fixture.detectChanges();

      const badge = q('.dock-badge');
      expect(badge).withContext('non-vacuity: the badge must be on screen to be judged').not.toBeNull();

      const mark = q('.dock-badge .dock-badge-mark');
      expect(mark).withContext('the badge must carry an activity mark beside the number').not.toBeNull();
      expect((mark.nativeElement as HTMLElement).textContent?.trim())
        .withContext('the mark that says "running" rather than "waiting to be read"')
        .toBe('⟳');
      expect((q('.dock-badge .dock-badge-count').nativeElement as HTMLElement).textContent?.trim())
        .toBe('3');

      // And the number is still the FIRST thing said in words, so the visual mark and the accessible
      // name agree rather than one of them carrying the meaning alone.
      const aria = (q('.dock-launcher').nativeElement as HTMLElement).getAttribute('aria-label');
      expect(aria).toBe(`${DOCK_STRINGS_HE['launcher']}, 3 ${DOCK_STRINGS_HE['activeCount']}`);

      // The badge stays hidden from the a11y tree: the count is already in the name above, and a
      // screen reader must not hear the mark glyph read out as punctuation.
      expect((badge.nativeElement as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    });

    it('paints the badge with the RUNNING colour, not the failure colour', () => {
      // `--pd-cut` is this app's failure red (`.status-failed` in the Activity Center wears it), and a
      // red badge on a chat bubble reads as an urgent unread. These jobs are running, and running work
      // is painted `--pd-primary-600` everywhere else in the app, including the progress bars of the
      // very rows this badge counts.
      registry.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();

      const fill = getComputedStyle(q('.dock-badge').nativeElement as HTMLElement).backgroundColor;
      const primary = getComputedStyle(document.documentElement)
        .getPropertyValue('--pd-primary-600').trim();
      const cut = getComputedStyle(document.documentElement).getPropertyValue('--pd-cut').trim();

      expect(primary).withContext('non-vacuity: the token must resolve').not.toBe('');
      expect(cut).withContext('non-vacuity: the token must resolve').not.toBe('');
      expect(primary).not.toBe(cut);
      expect(hexOf(fill)).toBe(primary.toLowerCase());
      expect(hexOf(fill)).not.toBe(cut.toLowerCase());
    });

    it('hides the badge when every job is terminal', () => {
      registry.setJobs([
        makeJob({ id: 'j1', status: 'succeeded' }),
        makeJob({ id: 'j2', status: 'failed' }),
      ]);
      registry.setActive([]);
      fixture.detectChanges();

      expect(q('.dock-badge')).toBeNull();
    });

    it('keeps the count visible on the ACTIVITY TAB while the drawer hides the launcher', () => {
      // The regression the merge could most easily have introduced: one affordance means one place the
      // number can live, and while the drawer is open that place is not on screen.
      registry.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();
      openDock();

      expect(q('.dock-launcher')).withContext('non-vacuity: the launcher really is gone').toBeNull();
      const tabBadge = q('.dock-tab-badge');
      expect(tabBadge).not.toBeNull();
      expect((q('.dock-tab-badge .dock-badge-count').nativeElement as HTMLElement).textContent?.trim())
        .toBe('1');

      // It is the SAME number handed over from the launcher, so it must not change appearance on the
      // way: same mark, same fill. A count that restyles itself when the drawer opens reads as a
      // different thing having happened.
      expect((q('.dock-tab-badge .dock-badge-mark').nativeElement as HTMLElement).textContent?.trim())
        .toBe('⟳');
      expect(hexOf(getComputedStyle(tabBadge.nativeElement as HTMLElement).backgroundColor))
        .toBe(getComputedStyle(document.documentElement)
          .getPropertyValue('--pd-primary-600').trim().toLowerCase());
    });

    it('names the launcher with the SINGULAR form for exactly one active job, composed with the affordance name, in both languages', () => {
      registry.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();

      const label = (q('.dock-launcher').nativeElement as HTMLElement).getAttribute('aria-label');
      expect(label).toBe(`${DOCK_STRINGS_HE['launcher']}, 1 משימה פעילה`);
      expect(label).not.toContain('משימות');
      // The actual defect: the count must never replace the affordance name.
      expect(label).toContain(DOCK_STRINGS_HE['launcher']);

      // launcherAria$ only recomputes when activeJobs$ emits, so re-emit AFTER switching language
      // rather than relying on the language switch alone to refresh the label.
      useEnglish();
      registry.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();
      const enLabel = (q('.dock-launcher').nativeElement as HTMLElement).getAttribute('aria-label');
      expect(enLabel).toBe(`${DOCK_STRINGS_EN['launcher']}, 1 active task`);
      expect(enLabel).toContain(DOCK_STRINGS_EN['launcher']);
    });

    it('names the launcher with the plural form for 2+, and with the surface for zero, in both languages', () => {
      registry.setJobs([
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'running' }),
      ]);
      fixture.detectChanges();
      const pluralLabel = (q('.dock-launcher').nativeElement as HTMLElement).getAttribute('aria-label');
      expect(pluralLabel).toBe(`${DOCK_STRINGS_HE['launcher']}, 2 משימות פעילות`);
      // The actual defect: the count must never replace the affordance name.
      expect(pluralLabel).toContain(DOCK_STRINGS_HE['launcher']);

      // launcherAria$ only recomputes when activeJobs$ emits, so re-emit AFTER switching language
      // rather than relying on the language switch alone to refresh the label.
      useEnglish();
      registry.setJobs([
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'running' }),
      ]);
      fixture.detectChanges();
      const enPluralLabel = (q('.dock-launcher').nativeElement as HTMLElement).getAttribute('aria-label');
      expect(enPluralLabel).toBe(`${DOCK_STRINGS_EN['launcher']}, 2 active tasks`);
      expect(enPluralLabel).toContain(DOCK_STRINGS_EN['launcher']);

      registry.setJobs([]);
      fixture.detectChanges();
      expect((q('.dock-launcher').nativeElement as HTMLElement).getAttribute('aria-label'))
        .toBe(DOCK_STRINGS_EN['launcher']);
    });
  });

  // ── Tabs ────────────────────────────────────────────────────────────────────────────────────────

  describe('tabs', () => {
    beforeEach(() => openDock());

    it('names each tab after the surface it opens, in the app language', () => {
      const labels = qa('.dock-tab').map(t => (t.nativeElement as HTMLElement).textContent?.trim());
      expect(labels.length).toBe(2);
      expect(labels[0]).toBe(CHAT_STRINGS_HE['drawerTitle']);
      expect(labels[1]).toContain(LABELS_HE['panelTitle']);
    });

    it('opens on the ASSISTANT tab, showing the assistant and NOT the activity list', () => {
      expect(component.activeTab).toBe('assistant');
      expect(q('.pc-pane')).withContext('the assistant surface is on screen').not.toBeNull();
      expect(q('.ac-panel')).withContext('and the activity surface is not').toBeNull();
      expect(q('.ac-row')).toBeNull();
    });

    it('switching to activity swaps the CONTENT, with nothing left over from the other tab', () => {
      registry.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();

      clickTab(component.tabLabel('activity'));

      expect(q('.ac-panel')).withContext('the activity surface is on screen').not.toBeNull();
      expect(q('.ac-row')).withContext('non-vacuity: it really rendered a row').not.toBeNull();
      expect(q('.pc-pane')).withContext('and the assistant surface is gone').toBeNull();
      expect(q('.pc-composer')).withContext('including its composer').toBeNull();
      expect(q('.pc-empty')).toBeNull();
    });

    it('switching back shows the assistant again and drops the activity rows', () => {
      registry.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();

      clickTab(component.tabLabel('activity'));
      expect(q('.ac-row')).not.toBeNull();

      clickTab(component.tabLabel('assistant'));

      expect(q('.pc-pane')).not.toBeNull();
      expect(q('.ac-panel')).toBeNull();
      expect(q('.ac-row')).toBeNull();
    });

    it('marks exactly one tab selected, for a screen reader as well as for the eye', () => {
      const selected = () => qa('.dock-tab')
        .filter(t => (t.nativeElement as HTMLElement).getAttribute('aria-selected') === 'true');

      expect(selected().length).toBe(1);
      expect(qa('.dock-tab--active').length).toBe(1);

      clickTab(component.tabLabel('activity'));

      expect(selected().length).toBe(1);
      expect(qa('.dock-tab--active').length).toBe(1);
      expect((selected()[0].nativeElement as HTMLElement).textContent).toContain(LABELS_HE['panelTitle']);
    });

    it('points the tabpanel at the tab that is selected', () => {
      const panel = () => q('.dock-panel').nativeElement as HTMLElement;
      expect(panel().getAttribute('aria-labelledby')).toBe('dock-tab-assistant');

      clickTab(component.tabLabel('activity'));
      expect(panel().getAttribute('aria-labelledby')).toBe('dock-tab-activity');
    });

    it('a tab switch does NOT throw away the other tab\'s state', async () => {
      // The chat transcript lives in the tab body for the life of the session. Unmounting it on a
      // switch would silently discard the author's conversation, which is why both bodies stay mounted.
      const chat = fixture.debugElement.query(By.css('app-product-chat')).componentInstance as
        { draft: string };
      chat.draft = 'a half-typed question';

      clickTab(component.tabLabel('activity'));
      clickTab(component.tabLabel('assistant'));

      expect(chat.draft)
        .withContext('the tab body instance itself must survive the switch')
        .toBe('a half-typed question');

      // ...and it must come BACK on screen, not merely survive in a field. NgModel writes the model
      // into a freshly created control in a microtask, so the view is only settled after the zone
      // drains; asserting before that would read the empty textarea Angular has not filled in yet.
      await fixture.whenStable();
      fixture.detectChanges();
      expect((q('.pc-input').nativeElement as HTMLTextAreaElement).value).toBe('a half-typed question');
    });
  });

  // ── Widen ───────────────────────────────────────────────────────────────────────────────────────

  describe('widen', () => {
    it('widens the drawer, per the owner\'s "expandable toward the side panel"', () => {
      openDock();
      const drawer = q('.dock-drawer').nativeElement as HTMLElement;
      drawer.style.transition = 'none';
      const narrow = drawer.getBoundingClientRect().width;

      const expand = qa('.dock-icon-btn')
        .find(b => (b.nativeElement as HTMLElement).getAttribute('aria-label') === component.label('expand'));
      expect(expand).withContext('the widen control must exist').toBeDefined();
      expand!.nativeElement.click();
      fixture.detectChanges();

      expect(drawer.classList.contains('dock-drawer--wide')).toBeTrue();
      expect(drawer.getBoundingClientRect().width)
        .withContext('the widened drawer must actually be wider')
        .toBeGreaterThan(narrow);
    });
  });

  // ── Language ────────────────────────────────────────────────────────────────────────────────────

  describe('RTL and LTR chrome', () => {
    it('is Hebrew and RTL by default (app-level chrome convention)', () => {
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(component.label('dockTitle')).toBe(DOCK_STRINGS_HE['dockTitle']);
    });

    it('renders English chrome and English tab names when the app language is English', () => {
      useEnglish();
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
      openDock();

      const labels = qa('.dock-tab').map(t => (t.nativeElement as HTMLElement).textContent?.trim());
      expect(labels[0]).toBe(CHAT_STRINGS_EN['drawerTitle']);
      expect(labels[1]).toContain(LABELS_EN['panelTitle']);
      expect((q('.dock-launcher') ?? q('.dock-tabs')).nativeElement).toBeTruthy();
      expect(component.label('close')).toBe(DOCK_STRINGS_EN['close']);
    });
  });

  // ── Phase boundary ──────────────────────────────────────────────────────────────────────────────

  it('the dock header offers NO phase C affordance', () => {
    openDock();
    const html = (q('.dock-header').nativeElement as HTMLElement).innerHTML;
    expect(html).not.toMatch(/quota|token|histor|previous conversation|customi[sz]/i);
    expect(qa('.dock-header button').length)
      .withContext('2 tabs + widen + close = 4 controls, nothing more')
      .toBe(4);
  });

  // ── The seam ────────────────────────────────────────────────────────────────────────────────────

  it('drives everything through AppOverlayService, so a sibling can move the dock', () => {
    overlays.openTab('activity');
    fixture.detectChanges();
    expect(q('.dock-drawer--is-open')).not.toBeNull();
    expect(q('.ac-panel')).not.toBeNull();

    overlays.close();
    fixture.detectChanges();
    expect(q('.dock-drawer--is-open')).toBeNull();
    expect(q('.dock-launcher')).not.toBeNull();
  });
});
