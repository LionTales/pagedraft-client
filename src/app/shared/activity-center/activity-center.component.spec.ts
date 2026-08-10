/**
 * rf-f01: ActivityCenterComponent spec. Re-pointed at the dock's ACTIVITY TAB in chatbot phase A.1 (w1):
 * the bell and its badge are gone, so their coverage moved to the dock spec and everything that is
 * about this panel's CONTENT stayed here, driven through the same `panelOpen` seam as before.
 *
 * Covers:
 *  - the panel shows only while the activity tab is the one showing (and nothing leaks the other way)
 *  - panel renders running row (determinate bar), completed/done row, failed row from mocked jobs$
 *  - newest-first ordering
 *  - 'view' link present only when resultRoute is set
 *  - empty state when no jobs
 *  - host dir='rtl' when app language is Hebrew (currently hardcoded Hebrew-default)
 *  - he/en label parity (asserts a couple of labels resolve in both maps)
 *  - relative time uses formatRelativeTime (asserts a formatted string, NOT a raw ISO timestamp)
 *  - relative time refresh: 60s timer drives re-render for terminal jobs (fakeAsync)
 *
 * Uses a BehaviorSubject-backed JobRegistryService stub -- the real root service is NOT injected.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { provideRouter } from '@angular/router';

import { ActivityCenterComponent, LABELS_HE, LABELS_EN } from './activity-center.component';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    // c04: no chunk shape by default, so the compact "3/10" counts are absent unless a spec asks.
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
 * Stub for JobRegistryService: BehaviorSubject-backed so tests drive emissions directly.
 * Mirrors the public shape consumed by ActivityCenterComponent.
 */
class JobRegistryStub {
  private readonly allSubject = new BehaviorSubject<TrackedJob[]>([]);
  private readonly activeSubject = new BehaviorSubject<TrackedJob[]>([]);

  readonly jobs$ = this.allSubject.asObservable();
  readonly activeJobs$ = this.activeSubject.asObservable();

  /** Push a new jobs array into both subjects (tests call this to drive state). */
  setJobs(all: TrackedJob[]): void {
    this.allSubject.next(all);
    const active = all.filter(j => j.status === 'running' || j.status === 'pending');
    this.activeSubject.next(active);
  }

  /** Override the active list independently (for badge-count edge cases). */
  setActive(active: TrackedJob[]): void {
    this.activeSubject.next(active);
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ActivityCenterComponent (rf-f01)', () => {
  let fixture: ComponentFixture<ActivityCenterComponent>;
  let component: ActivityCenterComponent;
  let stub: JobRegistryStub;

  beforeEach(async () => {
    stub = new JobRegistryStub();

    await TestBed.configureTestingModule({
      imports: [ActivityCenterComponent],
      providers: [
        { provide: JobRegistryService, useValue: stub },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ActivityCenterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Badge count ─────────────────────────────────────────────────────────────
  //
  // The live-count badge (and the pluralized accessible name that went with it) moved to the dock's
  // single launcher when the two overlays were merged, because that is the affordance the author sees
  // while this panel is closed. Its coverage moved with it, unchanged in substance, to
  // `shared/app-dock/app-dock.component.spec.ts`.

  // ── Panel showing / hiding ──────────────────────────────────────────────────

  describe('tab showing', () => {
    it('should not show the panel initially', () => {
      expect(fixture.debugElement.query(By.css('.ac-panel'))).toBeNull();
    });

    it('should show the panel when the activity tab is selected', () => {
      // Driven through the shared service, which is the seam this component subscribes to: there is no
      // bell to click any more, and the dock owns the launcher that opens this tab.
      TestBed.inject(AppOverlayService).openTab('activity');
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.ac-panel'))).not.toBeNull();
    });

    it('should show NOTHING once the other tab takes the dock (no leak between tabs)', () => {
      component.panelOpen = true;
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('.ac-panel')))
        .withContext('non-vacuity: it really was on screen first')
        .not.toBeNull();

      TestBed.inject(AppOverlayService).openTab('assistant');
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.ac-panel'))).toBeNull();
      expect(component.panelOpen).toBeFalse();
    });

    it('should hide the panel when the dock closes', () => {
      component.panelOpen = true;
      fixture.detectChanges();

      component.panelOpen = false;
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.ac-panel'))).toBeNull();
    });
  });

  // ── Empty state ─────────────────────────────────────────────────────────────

  describe('empty state', () => {
    beforeEach(() => {
      component.panelOpen = true;
      stub.setJobs([]);
      fixture.detectChanges();
    });

    it('should render the empty state element', () => {
      const empty = fixture.debugElement.query(By.css('.ac-empty'));
      expect(empty).not.toBeNull();
    });

    it('should not render any job rows', () => {
      expect(fixture.debugElement.queryAll(By.css('.ac-row')).length).toBe(0);
    });
  });

  // ── Job rows ────────────────────────────────────────────────────────────────

  describe('job rows', () => {
    beforeEach(() => {
      component.panelOpen = true;
      fixture.detectChanges();
    });

    it('should render a running row with an indeterminate progress bar', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: null })]);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.ac-row'));
      expect(rows.length).toBe(1);

      const indet = rows[0].query(By.css('.ac-progress-fill--indet'));
      expect(indet).not.toBeNull();
      const det = rows[0].query(By.css('.ac-progress-fill--det'));
      expect(det).toBeNull();
    });

    it('should render a running row with a determinate progress bar when percent is set', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: 60 })]);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.ac-row'));
      const det = rows[0].query(By.css('.ac-progress-fill--det'));
      expect(det).not.toBeNull();
      // Width is bound via [style.width.%]
      expect((det.nativeElement as HTMLElement).style.width).toBe('60%');
    });

    it('should show a numeric percent readout on a determinate row (progress stats, not just a bar)', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: 60 })]);
      fixture.detectChanges();

      const pct = fixture.debugElement.query(By.css('.ac-progress-percent'));
      expect(pct).not.toBeNull();
      expect((pct.nativeElement as HTMLElement).textContent?.trim()).toBe('60%');
    });

    it('should show a 0% readout (determinate at zero), never hide the number for a live job', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: 0 })]);
      fixture.detectChanges();

      const pct = fixture.debugElement.query(By.css('.ac-progress-percent'));
      expect(pct).not.toBeNull();
      expect((pct.nativeElement as HTMLElement).textContent?.trim()).toBe('0%');
    });

    it('should NOT show a percent readout on an indeterminate row (no reliable number yet)', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: null })]);
      fixture.detectChanges();

      const pct = fixture.debugElement.query(By.css('.ac-progress-percent'));
      expect(pct).toBeNull();
    });

    it('should render a completed (succeeded) row', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'succeeded', percent: 100 })]);
      stub.setActive([]);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.ac-row'));
      expect(rows.length).toBe(1);
      const pill = rows[0].query(By.css('.status-done'));
      expect(pill).not.toBeNull();
    });

    it('should render a failed row', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'failed', percent: null })]);
      stub.setActive([]);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.ac-row'));
      expect(rows.length).toBe(1);
      const pill = rows[0].query(By.css('.status-failed'));
      expect(pill).not.toBeNull();
    });

    it('should render a canceled row', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'canceled', percent: null })]);
      stub.setActive([]);
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.ac-row'));
      const pill = rows[0].query(By.css('.status-canceled'));
      expect(pill).not.toBeNull();
    });
  });

  // ── Newest-first order ──────────────────────────────────────────────────────

  describe('newest-first ordering', () => {
    it('should display the most recently updated job first', () => {
      const older = makeJob({
        id: 'j-old',
        titleHe: 'ישן',       // DRAFT he - needs native review
        titleEn: 'Older job',
        updatedAt: '2026-07-01T10:00:00.000Z',
      });
      const newer = makeJob({
        id: 'j-new',
        titleHe: 'חדש',       // DRAFT he - needs native review
        titleEn: 'Newer job',
        updatedAt: '2026-07-01T11:00:00.000Z',
      });
      // Intentionally push older first (registry insertion order)
      stub.setJobs([older, newer]);
      component.panelOpen = true;
      fixture.detectChanges();

      const rows = fixture.debugElement.queryAll(By.css('.ac-row'));
      expect(rows.length).toBe(2);
      // First displayed row = newer (component is Hebrew-default, so titleHe is shown)
      const firstTitle = rows[0].query(By.css('.ac-title'));
      expect(firstTitle.nativeElement.textContent).toContain('חדש');
    });
  });

  // ── 'view' link ─────────────────────────────────────────────────────────────

  describe('view link', () => {
    beforeEach(() => {
      component.panelOpen = true;
      fixture.detectChanges();
    });

    it('should show a view link when resultRoute is set', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'succeeded', resultRoute: '/books/b1/review' })]);
      stub.setActive([]);
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('.ac-view-link'));
      expect(link).not.toBeNull();
    });

    it('should NOT show a view link when resultRoute is absent', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('.ac-view-link'));
      expect(link).toBeNull();
    });

    it('should NOT show a view link when resultRoute is undefined', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', resultRoute: undefined })]);
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('.ac-view-link'));
      expect(link).toBeNull();
    });

    it('should call closePanel() when the view link is clicked', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'succeeded', resultRoute: '/books/b1/review' })]);
      stub.setActive([]);
      fixture.detectChanges();

      const spy = spyOn(component, 'closePanel').and.callThrough();

      const link = fixture.debugElement.query(By.css('.ac-view-link'));
      expect(link).not.toBeNull();
      link.nativeElement.click();
      fixture.detectChanges();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(component.panelOpen).toBeFalse();
    });
  });

  // ── RTL dir ─────────────────────────────────────────────────────────────────

  describe('RTL direction', () => {
    it('should set dir="rtl" on the host element (Hebrew-default app)', () => {
      // The host @HostBinding sets [attr.dir] from the hardcoded appLang='he'
      const hostEl: HTMLElement = fixture.nativeElement;
      expect(hostEl.getAttribute('dir')).toBe('rtl');
    });
  });

  // ── he/en label parity ───────────────────────────────────────────────────────

  describe('he/en label parity', () => {
    it('should have identical key sets in LABELS_HE and LABELS_EN (drift guard)', () => {
      // If a new label is added to one map but not the other this test catches it immediately.
      expect(Object.keys(LABELS_HE).sort()).toEqual(Object.keys(LABELS_EN).sort());
    });

    it('should return the Hebrew panel title for the Hebrew app language', () => {
      // Component is Hebrew-default
      expect(component.label('panelTitle')).toBe('מרכז פעילות');
    });

    it('should have a non-empty Hebrew label for every key that has an English equivalent', () => {
      const keys = [
        'panelTitle', 'emptyState', 'view',
        'running', 'pending', 'succeeded', 'failed', 'canceled',
        // w5: `whole-book-analysis` is gone from this list because the KIND is gone. It was vocabulary
        // for a capability nothing in the client could ever produce, which is the defect class this wave
        // removes; a label with no producer is not parity, it is a dead label.
        'summary', 'review', 'proofread', 'style-baseline',
      ];
      for (const key of keys) {
        const label = component.label(key);
        expect(label).toBeTruthy(`expected a non-empty label for key "${key}"`);
      }
    });

    it('should return English labels when app language is en (via label internals)', () => {
      // Access via internal knowledge: appLang is private but we verify by patching it
      // via a cast -- this is acceptable in a unit test for label-map parity validation.
      (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
      expect(component.label('panelTitle')).toBe('Activity Center');
      expect(component.label('emptyState')).toBe('No activity yet');
      expect(component.label('succeeded')).toBe('Done');
      expect(component.label('failed')).toBe('Failed');
    });
  });

  // ── Relative time ────────────────────────────────────────────────────────────

  describe('relative time', () => {
    it('should delegate to formatRelativeTime with the job timestamp and app language (he)', () => {
      // Spy on the component method to verify it forwards to the helper correctly.
      const spy = spyOn(component, 'relativeTime').and.callThrough();
      const oneMinuteAgo = new Date(Date.now() - 90 * 1000).toISOString();

      const result = component.relativeTime(oneMinuteAgo);

      // The helper must have been called (via the component wrapper).
      expect(spy).toHaveBeenCalledWith(oneMinuteAgo);

      // The output must equal what formatRelativeTime produces for the same input + 'he'.
      // This asserts intent (the right helper, with the right language) rather than a
      // substring proxy, and stays non-brittle: it tolerates any future phrasing changes
      // in the helper as long as both sides stay in sync.
      expect(result).toBe(formatRelativeTime(oneMinuteAgo, 'he'));
    });

    it('should return "הרגע" for a just-now timestamp in Hebrew', () => {
      const justNow = new Date(Date.now() - 5000).toISOString();
      const result = component.relativeTime(justNow);
      expect(result).toBe('הרגע');
    });

    it('should return an empty string for a null/undefined timestamp', () => {
      expect(component.relativeTime(null)).toBe('');
      expect(component.relativeTime(undefined)).toBe('');
    });

    it('should call relativeTime for each rendered row and display a non-ISO string', () => {
      const oneMinuteAgo = new Date(Date.now() - 90 * 1000).toISOString();
      stub.setJobs([makeJob({ id: 'j1', updatedAt: oneMinuteAgo })]);
      component.panelOpen = true;
      fixture.detectChanges();

      const timeEl = fixture.debugElement.query(By.css('.ac-time'));
      expect(timeEl).not.toBeNull();
      // The displayed time should not be a raw ISO string
      expect(timeEl.nativeElement.textContent).not.toContain('T');
    });

    it('should re-render the relative time for a terminal job after the 60s timer ticks', fakeAsync(() => {
      // Job finished "just now" (within the 0-60s window -> renders 'הרגע').
      const justNow = new Date(Date.now()).toISOString();
      stub.setJobs([makeJob({ id: 'j1', status: 'succeeded', updatedAt: justNow })]);
      component.panelOpen = true;
      fixture.detectChanges();

      const timeEl = () => fixture.debugElement.query(By.css('.ac-time'));
      // At t=0 the job is "just now"
      const initialText = timeEl()?.nativeElement.textContent ?? '';
      expect(initialText).toBe('הרגע');

      // Advance fakeAsync clock by 61 seconds (past the "just now" bucket).
      // The component's timer(0, 60_000) will emit its next tick, triggering combineLatest
      // to re-project jobs$ and the async pipe to schedule a new render.
      tick(61_000);
      fixture.detectChanges();

      // After 61s the timestamp is now ~61s old, which falls into the "1 minute ago" bucket
      // via Intl.RelativeTimeFormat -- no longer 'הרגע'.
      const updatedText = timeEl()?.nativeElement.textContent ?? '';
      expect(updatedText).not.toBe('הרגע');
      // Must still be a non-empty, non-ISO string (the relative-time helper ran again).
      expect(updatedText.length).toBeGreaterThan(0);
      expect(updatedText).not.toContain('T');

      // Tear down timers before test exit.
      fixture.destroy();
    }));
  });

  // ── Kind icon ────────────────────────────────────────────────────────────────

  describe('kind icons', () => {
    it('should render a kind icon for a known kind', () => {
      stub.setJobs([makeJob({ id: 'j1', kind: 'review' })]);
      component.panelOpen = true;
      fixture.detectChanges();

      const icon = fixture.debugElement.query(By.css('.ac-kind-icon'));
      expect(icon).not.toBeNull();
      expect(icon.nativeElement.textContent.trim().length).toBeGreaterThan(0);
    });

    /**
     * Wave 3 / w5, the audit's second Activity Center content fix. EVERY chapter or scene analysis rides
     * the single `proofread` job kind, so a per-KIND icon gave an in-flight Summarize a proofreading
     * pencil beside a correct title. The row title already discriminates on `analysisType`; the icon now
     * uses the same discriminator, so the two cannot disagree.
     */
    it('does not dress an in-flight Summarize as a proofread run', () => {
      const summarize = component.kindIcon({ kind: 'proofread', analysisType: 'Summarization' });
      const proofread = component.kindIcon({ kind: 'proofread', analysisType: 'Proofread' });

      expect(summarize).not.toBe(proofread);
      expect(summarize.trim().length).toBeGreaterThan(0);
    });

    it('gives every analysis type sharing the proofread kind its own glyph', () => {
      const types = ['Proofread', 'LineEdit', 'LinguisticAnalysis', 'LiteraryAnalysis', 'Summarization', 'Custom'];
      const icons = types.map((analysisType) => component.kindIcon({ kind: 'proofread', analysisType }));
      expect(new Set(icons).size).withContext('one glyph per type, none shared').toBe(types.length);
    });

    it('falls back to the KIND glyph for an unknown or absent analysis type', () => {
      const byKind = component.kindIcon({ kind: 'proofread', analysisType: undefined });
      expect(component.kindIcon({ kind: 'proofread', analysisType: 'SomethingNew' })).toBe(byKind);
      expect(byKind.trim().length).toBeGreaterThan(0);
    });

    it('renders the per-type glyph in the row, not just from the helper', () => {
      stub.setJobs([
        makeJob({ id: 'j1', kind: 'proofread', analysisType: 'Summarization', titleHe: 'סיכום', titleEn: 'Summarize' }),
      ]);
      component.panelOpen = true;
      fixture.detectChanges();

      const icon = fixture.debugElement.query(By.css('.ac-kind-icon'));
      expect(icon.nativeElement.textContent.trim())
        .toBe(component.kindIcon({ kind: 'proofread', analysisType: 'Summarization' }));
    });
  });

  // ── Progressbar aria attributes ──────────────────────────────────────────────

  describe('progressbar aria attributes', () => {
    beforeEach(() => {
      component.panelOpen = true;
      fixture.detectChanges();
    });

    it('should NOT emit aria-valuenow on an indeterminate progress bar (percent === null)', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: null })]);
      fixture.detectChanges();

      const track = fixture.debugElement.query(By.css('.ac-progress-track'));
      expect(track).not.toBeNull();
      // The indeterminate track must not carry aria-valuenow (avoids aria-valuenow="null").
      expect(track.nativeElement.hasAttribute('aria-valuenow')).toBeFalse();
      // Also must not carry aria-valuemin / aria-valuemax (no value range for indeterminate).
      expect(track.nativeElement.hasAttribute('aria-valuemin')).toBeFalse();
      expect(track.nativeElement.hasAttribute('aria-valuemax')).toBeFalse();
    });

    it('should emit aria-valuenow, aria-valuemin, aria-valuemax on a determinate progress bar', () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running', percent: 42 })]);
      fixture.detectChanges();

      const track = fixture.debugElement.query(By.css('.ac-progress-track'));
      expect(track).not.toBeNull();
      expect(track.nativeElement.getAttribute('aria-valuenow')).toBe('42');
      expect(track.nativeElement.getAttribute('aria-valuemin')).toBe('0');
      expect(track.nativeElement.getAttribute('aria-valuemax')).toBe('100');
    });
  });

  // ── Launcher aria-label pluralization ───────────────────────────────────────
  //
  // Moved to the dock spec with the launcher that carries it, unchanged in substance: the singular /
  // plural Hebrew forms and the zero case are all still asserted, against
  // shared/app-dock/app-dock.component.spec.ts's launcher instead of a bell that no longer exists.
});
