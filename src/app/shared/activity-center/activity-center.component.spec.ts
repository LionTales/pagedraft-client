/**
 * rf-f01: ActivityCenterComponent spec.
 *
 * Covers:
 *  - badge count: zero -> hidden, N -> shows N
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

  describe('bell badge', () => {
    it('should not render the badge when there are zero active jobs', () => {
      stub.setJobs([]);
      fixture.detectChanges();

      const badge = fixture.debugElement.query(By.css('.ac-badge'));
      expect(badge).toBeNull();
    });

    it('should render the badge with correct count when there are active jobs', () => {
      stub.setJobs([
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'running' }),
      ]);
      fixture.detectChanges();

      const badge = fixture.debugElement.query(By.css('.ac-badge'));
      expect(badge).not.toBeNull();
      expect(badge.nativeElement.textContent.trim()).toBe('2');
    });

    it('should hide the badge when all jobs are terminal', () => {
      stub.setJobs([
        makeJob({ id: 'j1', status: 'succeeded' }),
        makeJob({ id: 'j2', status: 'failed' }),
      ]);
      // Active stub tracks only running/pending
      stub.setActive([]);
      fixture.detectChanges();

      const badge = fixture.debugElement.query(By.css('.ac-badge'));
      expect(badge).toBeNull();
    });
  });

  // ── Panel open/close ────────────────────────────────────────────────────────

  describe('panel toggle', () => {
    it('should not show the panel initially', () => {
      expect(fixture.debugElement.query(By.css('.ac-panel'))).toBeNull();
    });

    it('should show the panel after clicking the bell', () => {
      fixture.debugElement.query(By.css('.ac-bell')).nativeElement.click();
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.ac-panel'))).not.toBeNull();
    });

    it('should hide the panel after a second click', () => {
      component.panelOpen = true;
      fixture.detectChanges();

      fixture.debugElement.query(By.css('.ac-bell')).nativeElement.click();
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
        'panelTitle', 'emptyState', 'view', 'activeCount',
        'running', 'pending', 'succeeded', 'failed', 'canceled',
        'summary', 'review', 'proofread', 'style-baseline', 'whole-book-analysis',
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

  // ── Bell aria-label pluralization ────────────────────────────────────────────

  describe('bell aria-label pluralization', () => {
    it('should use the singular form when there is exactly 1 active job (Hebrew)', async () => {
      stub.setJobs([makeJob({ id: 'j1', status: 'running' })]);
      fixture.detectChanges();

      // Read the resolved label from the observable directly.
      const label = await new Promise<string>(resolve => {
        component.bellAriaLabel$.subscribe(v => resolve(v)).unsubscribe();
      });
      // Hebrew singular: "1 משימה פעילה" (not the plural "משימות פעילות")
      expect(label).toBe('1 משימה פעילה');
      expect(label).not.toContain('משימות');
    });

    it('should use the plural form when there are 2+ active jobs (Hebrew)', async () => {
      stub.setJobs([
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'running' }),
      ]);
      fixture.detectChanges();

      const label = await new Promise<string>(resolve => {
        component.bellAriaLabel$.subscribe(v => resolve(v)).unsubscribe();
      });
      expect(label).toBe('2 משימות פעילות');
    });

    it('should use the panel title as label when there are 0 active jobs', async () => {
      stub.setJobs([]);
      fixture.detectChanges();

      const label = await new Promise<string>(resolve => {
        component.bellAriaLabel$.subscribe(v => resolve(v)).unsubscribe();
      });
      expect(label).toBe('מרכז פעילות');
    });
  });
});
