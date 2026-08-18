/**
 * wb3-c01: BookDashboardComponent host spec. Verifies the dashboard renders the relocated book-scoped
 * status rows and wires the summary-terminal -> review-refresh relationship (preserving the Phase-2
 * "a summary terminal also refreshes review status" behavior across the component split).
 *
 * NOTE: the dashboard now hosts BookSummaryStatusRowComponent + BookReviewStatusRowComponent, which inject
 * BookSummaryService / BookReviewService / AnalysisProgressService. Those MUST be provided here or the
 * children fail to construct with a NullInjectorError (the "new constructor dep breaks the TestBed" trap).
 */
import { SimpleChange } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, NEVER, Observable, Subject, of } from 'rxjs';
import { BookProfileDto } from '../../core/models/book';
import {
  BookDashboardComponent,
  DASHBOARD_LABELS_EN,
  DASHBOARD_LABELS_HE,
  DashboardLabelKey,
} from './book-dashboard.component';
import { BookReviewStatusDto, ChapterAnchor } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { BookService } from '../../core/services/book.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { ChapterSummaryService } from '../../core/services/chapter-summary.service';
import { CharacterRegisterService } from '../../core/services/character-register.service';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { BookSurfaceFocusService } from '../../core/services/book-surface-focus.service';
import { GuidesService } from '../../core/services/guides.service';
import { orientationStorageKey } from './orientation-store';
import { stageGuideLink } from '../../shared/stage-spine/stage-guide';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import { AiTierService } from '../../core/services/ai-tier.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { TierToggleComponent } from '../../shared/tier-toggle/tier-toggle.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { SHOW_POINTER_STRINGS_EN, SHOW_POINTER_STRINGS_HE } from '../../core/i18n/show-pointer-strings';

describe('BookDashboardComponent (wb3-c01 host)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  // rf-c02: the hosted status rows publish their build to the registry. Spy so the real (root) registry is
  // not pulled in and so we can assert the row->registry publish when a build is driven through the host.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    // `activeJobs$` is read by the dashboard itself since Wave 3 / w2 (the spine's stage-4 running marks),
    // so the spy must carry it or every spec in this file dies on `.subscribe of undefined`.
    // `jobs$` joined it in c04: the hosted briefs row injects the shared profile continuation, which
    // watches the registry for briefs builds reaching their terminal - the wiring that makes the profile
    // get built when nothing is mounted to see it happen.
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>(
      'JobRegistryService',
      ['track'],
      { activeJobs$: of([]), jobs$: of([]) },
    );
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jobRegistrySpy },
        {
          provide: BookService,
          // Spies so individual tests can re-stub getProfile (e.g. to return a loaded profile).
          // Default getProfile returns NEVER: no profile, so the profile section stays collapsed while
          // the relocated status rows still render.
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER,
            refreshProfile: NEVER,
            // The hosted chapter-summaries child (wb3-c04) fetches the chapter list on init.
            getById: NEVER,
          }),
        },
        // Transitive deps of the hosted status-row children (NullInjector guard).
        // w5 (MOVE-1): transitive dep of the relocated writing-style row hosted by the dashboard.
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        {
          provide: BookSummaryService,
          useValue: {
            getBookSummaryStatus: () => NEVER,
            buildBookSummary: () => NEVER,
          },
        },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER,
            buildReview: () => NEVER,
            getReviewProgress: () => NEVER,
            // The hosted findings panel (wb3-c02) fetches findings when mounted (review ready/stale).
            getReviewFindings: () => NEVER,
            patchFindingStatus: () => NEVER,
          },
        },
        {
          provide: AnalysisProgressService,
          useValue: {
          pollBookSummaryProgress: () => NEVER,
          },
        },
        // Transitive dep of the hosted chapter-summaries child (wb3-c04) (NullInjector guard).
        {
          provide: ChapterSummaryService,
          useValue: {
            getChapterSummary: () => NEVER,
            updateChapterSummary: () => NEVER,
            rederiveChapterSummary: () => NEVER,
          },
        },
        // Transitive dep of the hosted character-register child (character-register-editing c2)
        // (NullInjector guard): the register section fetches on init, so without this stub EVERY test in
        // this suite fails with "No provider for HttpClient", naming the transitive dep rather than the
        // component that introduced it.
        {
          provide: CharacterRegisterService,
          useValue: {
            getRegister: () => NEVER,
            applyEdits: () => NEVER,
          },
        },
        // Transitive dep of the hosted tier toggles (tier-ux-rework c3): the book-default row at the foot of
        // the dashboard AND the one inside the hosted review status row (NullInjector guard). Without this
        // every test in this suite fails with "No provider for HttpClient", naming the transitive dep rather
        // than the component that introduced it.
        {
          provide: AiTierService,
          useValue: {
            // `watch` is the shared per-book answer channel (tier-ux-rework fixes c02): the toggle subscribes
            // to it on every mount, so a stub without it fails this suite with a TypeError from a grandchild.
            watch: () => NEVER,
            refresh: () => NEVER,
            get: () => NEVER,
            setTask: () => NEVER,
            setBookDefault: () => NEVER,
            clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    // w5: the collapse directive persists per book in localStorage. Karma shares one origin across the
    // whole run, so without this a test that folds a section would leak that fold into every later test
    // and into other suites. Cleared before AND after each case, so the leak cannot travel either way.
    localStorage.removeItem('pd:dashboard-collapse:book-1');

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('pd:dashboard-collapse:book-1');
    localStorage.removeItem('pd:dashboard-collapse:book-2');
  });

  /**
   * w5: open a collapsible section by clicking its real header button, the way a reader does. Used by the
   * cases that assert on content inside a section which DEFAULTS to collapsed (the two long content
   * lists). Deliberately drives the DOM rather than setting the child's `collapsed` field, so a change
   * that breaks the toggle breaks these tests too.
   */
  function expandSection(sectionId: string): void {
    const toggle = fixture.debugElement.query(By.css(`[data-testid="collapse-toggle-${sectionId}"]`));
    expect(toggle).withContext(`no collapse toggle for section "${sectionId}"`).not.toBeNull();
    (toggle.nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  /**
   * w8, THE 300px LAYOUT CONTRACT FOR THE HEADER (brief section 2.6, the same constraint the spine's own
   * suite pins for the five stage names).
   *
   * The header holds the book title plus an action cluster that does not shrink, and the cluster grew a
   * second button in w6 ("How this works" beside "Export"). At the 300px minimum panel width in ENGLISH
   * the two labels measure roughly 211px of the roughly 257px of content width available, so the row
   * could not fit on one line: the header overflowed its own container (`scrollWidth` past `clientWidth`)
   * by 41px, in a panel the user cannot widen without a drag. Because the Export button is the LAST
   * control in the row, its right edge IS the row's own overflow edge, so "the Export button was drawn
   * 41px past the panel" names the same 41px, not a second number - see the non-vacuity note below for
   * the measured coordinates. The live gate found it; the fix is `flex-wrap` on the header and on the
   * cluster, so the cluster takes its own line instead of pushing a control out of view.
   *
   * ENGLISH IS THE CASE THAT FAILS, and it is asserted first for that reason: the Hebrew labels are
   * shorter and fitted on one line the whole time, so a Hebrew-only test would have passed over the
   * defect. Hebrew is asserted after it, as the mirror.
   *
   * This measures real layout - Karma runs Chrome and the TestBed applies the component's own styles -
   * rather than asserting the CSS property, because what matters is that nothing lands outside the box.
   *
   * NON-VACUITY, CHECKED RATHER THAN ASSUMED (RE-MEASURED r01, replacing an earlier hand-copied figure
   * that had drifted from this same repro - see `wave3-w6-orientation-fixes-2026-08-11.plan.md`). With
   * the header CSS as it stood before this contract (`.dashboard-header` and `.header-actions` not
   * wrapping, and `.dashboard-title` at its default `min-width: auto`) the English case fails here
   * exactly as it failed in the browser: header `scrollWidth` 298 against a `clientWidth` of 257, i.e.
   * overflowing its own container by 41px, with the Export button - the row's last control, so its right
   * edge is the row's own overflow edge - drawn from 223 to 298, the same 41px outside the panel.
   * Hebrew passes either way, which is why the English case is the one that had to exist.
   */
  describe('the 300px header layout contract (brief section 2.6)', () => {
    /**
     * THE HOST IS 257px, NOT 300px, AND THAT NUMBER IS THE POINT. 300 is the width of the PANEL; the
     * dashboard is drawn inside it, and the panel's own padding takes roughly 21px a side, so the content
     * box this component actually lays out in measures 257px. Measured on the running app at :4201 with
     * the panel dragged to its minimum: `aside.review-panel` 300, `.review-body` 299, `.book-dashboard`
     * 257. Asserting at a 300px host would be a test of a width the component never gets, and it would
     * pass over the defect this contract exists to hold: 213px of buttons and a title fit in 300 and do
     * not fit in 257, which is exactly the band the bug lived in.
     */
    const PANEL_MIN_CONTENT_WIDTH = '257px';

    function headerAt300(lang: string): HTMLElement {
      const host = fixture.nativeElement as HTMLElement;
      host.style.width = PANEL_MIN_CONTENT_WIDTH;
      host.style.boxSizing = 'border-box';
      component.bookLanguage = lang;
      component.bookTitle = lang === 'en' ? 'c4 EN verification book' : 'ספר בדיקה ארוך למדי';
      fixture.detectChanges();
      return fixture.debugElement.query(By.css('.dashboard-header')).nativeElement as HTMLElement;
    }

    function assertInside(header: HTMLElement, testid: string, lang: string): void {
      const el = fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement as HTMLElement;
      const box = el.getBoundingClientRect();
      const bounds = header.getBoundingClientRect();
      expect(box.width).withContext(`${lang} ${testid} has no width`).toBeGreaterThan(8);
      expect(box.left).withContext(`${lang} ${testid} starts before the header`).toBeGreaterThanOrEqual(bounds.left - 0.5);
      expect(box.right).withContext(`${lang} ${testid} runs past the header`).toBeLessThanOrEqual(bounds.right + 0.5);
    }

    (['en', 'he'] as const).forEach(lang => {
      it(`keeps the whole header inside 300px in ${lang}, with both actions drawn in the panel`, () => {
        const header = headerAt300(lang);

        expect(header.scrollWidth)
          .withContext(`${lang} header overflows its own container`)
          .toBeLessThanOrEqual(header.clientWidth + 0.5);

        assertInside(header, 'dashboard-orientation-btn', lang);
        assertInside(header, 'dashboard-export-btn', lang);
      });
    });
  });

  it('constructs the dashboard and its hosted status-row children without a NullInjector error', () => {
    expect(component).toBeTruthy();
    expect(fixture.debugElement.query(By.css('app-book-summary-status-row'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-book-review-status-row'))).not.toBeNull();
  });

  /**
   * tier-ux-rework c3. The verbose per-book tier card is GONE from the dashboard hero position: the decision
   * that matters is per edit type and now lives on each run surface. What remains here is one compact
   * book-DEFAULT toggle at the FOOT of the page, which only seeds the types nobody has decided individually.
   */
  it('no longer renders the old central model-tier control', () => {
    expect(fixture.debugElement.query(By.css('app-book-ai-tier'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.book-ai-tier-card'))).toBeNull();
  });

  it('renders exactly one book-default tier toggle, in book scope, at the foot of the page', () => {
    const toggles = fixture.debugElement.queryAll(By.css('.book-dashboard > .book-tier-default-card app-tier-toggle'));
    expect(toggles.length).toBe(1);
    expect(toggles[0].componentInstance.scope).toBe('book');
    expect(toggles[0].componentInstance.bookId).toBe('book-1');
    expect(toggles[0].componentInstance.bookLanguage).toBe('he');

    // Foot of the page, not the hero position: the status rows come first.
    const sections = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.book-dashboard > section')
    );
    expect(sections[sections.length - 1].classList).toContain('book-tier-default-card');
  });

  /**
   * character-register-editing c2. The register is BOOK-scoped, so it mounts on the book-level
   * intelligence/settings page (here), not in the per-chapter editor. It must render OUTSIDE the profile
   * guard: this suite's default BookService stub returns NEVER for getProfile, so `profile` is null and
   * anything inside that guard would be absent - which is exactly the case a book with no profile hits.
   */
  it('mounts the book-scoped character register, outside the profile guard, with the book context', () => {
    // w5: the register is one of the two LONG CONTENT LISTS the collapse directive defaults to collapsed,
    // so its body is not in the DOM until the section is opened. The card and its toggle still are: what
    // the directive may hide is content, never the affordance that reveals it.
    expect(component.profile).toBeNull();
    expect(fixture.debugElement.query(By.css('.book-dashboard > .character-register-card'))).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="collapse-toggle-character-register"]'))
    ).not.toBeNull();

    expandSection('character-register');

    const registers = fixture.debugElement.queryAll(
      By.css('.book-dashboard > .character-register-card app-character-register')
    );
    expect(registers.length).toBe(1);
    expect(registers[0].componentInstance.bookId).toBe('book-1');
    expect(registers[0].componentInstance.bookLanguage).toBe('he');
  });

  it('forwards bookId + bookLanguage to both hosted status rows', () => {
    const summary = fixture.debugElement.query(By.css('app-book-summary-status-row')).componentInstance;
    const review = fixture.debugElement.query(By.css('app-book-review-status-row')).componentInstance;
    expect(summary.bookId).toBe('book-1');
    expect(summary.bookLanguage).toBe('he');
    expect(review.bookId).toBe('book-1');
    expect(review.bookLanguage).toBe('he');
  });

  it('refreshes the review row when the summary row emits summaryTerminal (Phase-2 cross-row behavior)', () => {
    const reviewLoadSpy = spyOn(component.reviewRow!, 'loadBookReviewStatus');
    const summary = fixture.debugElement.query(By.css('app-book-summary-status-row')).componentInstance;

    // A summary build reaching terminal emits this; the host must refresh the review row's gate.
    summary.summaryTerminal.emit();

    expect(reviewLoadSpy).toHaveBeenCalled();
  });

  it('onSummaryTerminal is a safe no-op when the review row is not yet available', () => {
    component.reviewRow = undefined;
    expect(() => component.onSummaryTerminal()).not.toThrow();
  });

  // ── wb3-c02: scorecard/ledger gating + navigation seam ──────────────────────

  it('does NOT mount the findings panel until the review row reports ready/stale', () => {
    expect(component.showFindings).toBeFalse();
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).toBeNull();

    component.onReviewStateChange('not-built');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).toBeNull();
  });

  it('mounts the findings panel when the review row reports ready or stale', () => {
    component.onReviewStateChange('ready');
    fixture.detectChanges();
    expect(component.showFindings).toBeTrue();
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).not.toBeNull();

    component.onReviewStateChange('stale');
    fixture.detectChanges();
    expect(component.showFindings).toBeTrue();
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).not.toBeNull();
  });

  it('bumps the findings refresh token on the transition INTO a findings-bearing state', () => {
    const before = component.findingsRefreshToken;
    component.onReviewStateChange('ready'); // unknown -> ready : a real transition
    expect(component.findingsRefreshToken).toBe(before + 1);

    // Staying within ready/stale does not bump again (avoids redundant re-reads).
    component.onReviewStateChange('stale');
    expect(component.findingsRefreshToken).toBe(before + 1);
  });

  // ── c01: a user-initiated rebuild cycle must refresh the findings panel ──────
  // The row now emits 'building' at the START of a rebuild, so the panel unmounts during the build and
  // the return to ready/stale is a fresh transition INTO a showing state -> the token bumps and the
  // findings panel re-reads. Without the 'building' emit a ready->ready rebuild would be a no-op bump and
  // the user would keep seeing the PREVIOUS findings.
  it('rebuild cycle (ready -> building -> ready) bumps the findings token so the panel re-reads', () => {
    // Establish a showing state first (the review already built once).
    component.onReviewStateChange('ready');
    const afterFirstBuild = component.findingsRefreshToken;

    // User rebuilds: the row emits 'building' up front, then ready when the build finishes.
    component.onReviewStateChange('building');
    expect(component.showFindings).toBeFalse(); // panel unmounted during the build
    expect(component.findingsRefreshToken).toBe(afterFirstBuild); // no bump on the way out

    component.onReviewStateChange('ready');
    expect(component.showFindings).toBeTrue();
    // building -> ready is a fresh transition into a showing state: the token bumps so the panel re-reads.
    expect(component.findingsRefreshToken).toBe(afterFirstBuild + 1);
  });

  it('rebuild cycle ending in STALE (building -> stale) also bumps the token', () => {
    component.onReviewStateChange('stale');
    const afterFirstBuild = component.findingsRefreshToken;

    component.onReviewStateChange('building');
    component.onReviewStateChange('stale');
    expect(component.findingsRefreshToken).toBe(afterFirstBuild + 1);
  });

  it('onOpenChapterFromFinding emits openChapter with the anchor (wb3-f01 navigation seam)', () => {
    const anchor: ChapterAnchor = { chapterId: 'c-1', order: 1, title: 'Ch 1' };
    const emitted: ChapterAnchor[] = [];
    component.openChapter.subscribe((a) => emitted.push(a));

    component.onOpenChapterFromFinding(anchor);

    expect(emitted.length).toBe(1);
    expect(emitted[0].chapterId).toBe('c-1');
    expect(emitted[0].order).toBe(1);
    expect(emitted[0].title).toBe('Ch 1');
  });

  // ── wb3-c03: Findings | Story Bible tab toggle ──────────────────────────────

  it('shows the Findings tab by default and toggles to the Story Bible tab (review ready)', () => {
    component.onReviewStateChange('ready');
    fixture.detectChanges();

    // Default: the Findings ledger is mounted, the Story Bible is not.
    expect(component.reviewTab).toBe('findings');
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-book-story-bible'))).toBeNull();

    // Click the Story Bible tab: the bible mounts, the ledger unmounts.
    fixture.debugElement.query(By.css('[data-testid="review-tab-bible"]')).nativeElement.click();
    fixture.detectChanges();

    expect(component.reviewTab).toBe('bible');
    expect(fixture.debugElement.query(By.css('app-book-story-bible'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).toBeNull();
  });

  // ── d1: openFinding waits for the ledger to mount, then forwards ────────────

  it('d1: openFinding selects the Findings tab and forwards to the ledger once it has mounted', (done) => {
    component.onReviewStateChange('ready');
    component.reviewTab = 'bible';
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-book-review-findings'))).toBeNull();

    component.openFinding('f-9');
    // Held, not dropped: the ledger is @if-mounted behind the tab this call just selected.
    expect(component.reviewTab).toBe('findings');
    expect((component as any).pendingOpenFindingId).toBe('f-9');

    fixture.detectChanges();
    const ledger = component.findingsPanel;
    expect(ledger).toBeDefined();
    const openSpy = spyOn(ledger!, 'openFinding');
    // The drain runs from ngAfterViewChecked, which detectChanges above has already triggered once;
    // the request is published on a timer so the ledger's view state is not mutated inside that pass.
    setTimeout(() => {
      expect(openSpy).toHaveBeenCalledOnceWith('f-9');
      done();
    });
  });

  it('d1: a held finding is dropped if the reader moves to the Story Bible before the ledger mounts', () => {
    component.onReviewStateChange('ready');
    component.openFinding('f-9');
    component.reviewTab = 'bible';

    component.ngAfterViewChecked();

    expect((component as any).pendingOpenFindingId).toBeNull();
  });

  it('does NOT render the review tabs until the review is ready/stale', () => {
    expect(fixture.debugElement.query(By.css('[data-testid="review-tab-findings"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-book-story-bible'))).toBeNull();

    component.onReviewStateChange('not-built');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="review-tab-findings"]'))).toBeNull();
  });

  it('forwards bookId/bookLanguage/refreshToken + the openChapter seam to the Story Bible', () => {
    component.onReviewStateChange('ready');
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="review-tab-bible"]')).nativeElement.click();
    fixture.detectChanges();

    const bible = fixture.debugElement.query(By.css('app-book-story-bible')).componentInstance;
    expect(bible.bookId).toBe('book-1');
    expect(bible.bookLanguage).toBe('he');
    expect(bible.refreshToken).toBe(component.findingsRefreshToken);

    // The bible's openChapter routes through the same host stub as the findings panel (no throw).
    expect(() => bible.openChapter.emit({ chapterId: 'c-1', order: 1, title: 'Ch 1' })).not.toThrow();
  });

  it('localizes the review tab labels (he default, en when book language is English)', () => {
    expect(component.reviewTabLabel('findings')).toBe('ממצאים');
    expect(component.reviewTabLabel('bible')).toBe('ספר הסיפור');
    component.bookLanguage = 'en';
    expect(component.reviewTabLabel('findings')).toBe('Findings');
    expect(component.reviewTabLabel('bible')).toBe('Story Bible');
  });

  // ── rf-c02: registry-derived build state ─────────────────────────────────────
  // rf-c02: the dashboard NO LONGER owns the host "review running" affordance (the deleted buildRunningChange
  // @Output). That affordance is now derived by the editor from the job registry, which the status rows publish
  // to via track(). The dashboard's OWN aggregate `buildRunning` getter is kept (it reflects its internal
  // review/summary state) and the hosted summary row must publish its build to the registry when it starts.
  describe('rf-c02: registry-derived build state (buildRunningChange @Output removed)', () => {
    it('no longer exposes a buildRunningChange @Output', () => {
      expect((component as any).buildRunningChange).toBeUndefined();
    });

    it('buildRunning getter still derives from the review row state (internal aggregate)', () => {
      component.onReviewStateChange('building');
      expect(component.buildRunning).toBeTrue();

      component.onReviewStateChange('ready');
      expect(component.buildRunning).toBeFalse();
    });

    it('buildRunning getter still derives from the SUMMARY row building flag (internal aggregate)', () => {
      component.onSummaryBuildingChange(true);
      expect(component.buildRunning).toBeTrue();

      component.onSummaryBuildingChange(false);
      expect(component.buildRunning).toBeFalse();
    });

    it('publishes the summary build to the job registry (track) when a build is driven through the hosted row', () => {
      // Re-stub the summary service so the real hosted summary row drives a Subject-backed build.
      const summarySvc = TestBed.inject(BookSummaryService) as any;
      const progressSvc = TestBed.inject(AnalysisProgressService) as any;
      summarySvc.buildBookSummary = () => of({ jobId: 'job-1', noOp: false } as any);
      summarySvc.getBookSummaryStatus = () => NEVER;
      progressSvc.pollBookSummaryProgress = () => NEVER;

      const summaryRow = fixture.debugElement
        .query(By.css('app-book-summary-status-row'))
        .componentInstance as { bookId: string; bookLanguage: string; onBuildBookSummary: () => void };
      summaryRow.bookId = 'book-1';
      summaryRow.bookLanguage = 'he';
      summaryRow.onBuildBookSummary();

      // The row published its build to the single registry so the editor affordance can read it.
      expect(jobRegistrySpy.track).toHaveBeenCalledWith('summary', 'book-1', 'job-1');
    });
  });

  // ── c01: summary-build-complete fan-out to EVERY summary-derived surface (rf-f04) ──
  // When a book-summary build COMPLETES (buildingChange true->false), the dashboard must re-fetch every
  // summary-derived surface: the chapter-summaries list + the Story Bible (both via [refreshSignal]) AND the
  // dashboard-owned profile card (via loadProfile()). Only a true->false transition fans out; a build START
  // (false->true) and no-change ticks must not.
  describe('summary-build-complete fan-out (c01 / rf-f04)', () => {
    it('bumps summaryDerivedRefresh and reloads the profile on a build COMPLETION (true -> false)', () => {
      const bookSvc = TestBed.inject(BookService);
      const getProfile = bookSvc.getProfile as jasmine.Spy;
      const profileCallsBefore = getProfile.calls.count();
      const refreshBefore = component.summaryDerivedRefresh;

      // A build starts (false -> true): no fan-out yet (nothing has completed).
      component.onSummaryBuildingChange(true);
      expect(component.summaryDerivedRefresh).toBe(refreshBefore);
      expect(getProfile.calls.count()).toBe(profileCallsBefore);

      // The build COMPLETES (true -> false): fan out to all summary-derived surfaces.
      component.onSummaryBuildingChange(false);
      expect(component.summaryDerivedRefresh).toBe(refreshBefore + 1);
      // The dashboard-owned profile card is re-fetched (its own [refreshSignal] does not exist).
      expect(getProfile.calls.count()).toBe(profileCallsBefore + 1);
    });

    it('does NOT fan out on a build START or a no-change tick', () => {
      const bookSvc = TestBed.inject(BookService);
      const getProfile = bookSvc.getProfile as jasmine.Spy;
      const profileCallsBefore = getProfile.calls.count();
      const refreshBefore = component.summaryDerivedRefresh;

      // false -> false (no build in flight, no completion).
      component.onSummaryBuildingChange(false);
      // false -> true (build starts).
      component.onSummaryBuildingChange(true);
      // true -> true (still building).
      component.onSummaryBuildingChange(true);

      expect(component.summaryDerivedRefresh).toBe(refreshBefore);
      expect(getProfile.calls.count()).toBe(profileCallsBefore);
    });

    it('binds summaryDerivedRefresh to the chapter-summaries surface', () => {
      // w5 / Q8-C: the chapter-brief list is now the "inputs to this build" group inside stage 2's row
      // group, and it is a long content list, so it defaults to collapsed. Open it before asserting the
      // binding it still carries.
      expandSection('inputs');
      const cs = fixture.debugElement.query(By.css('app-book-chapter-summaries')).componentInstance;
      expect(cs.refreshSignal).toBe(component.summaryDerivedRefresh);

      // A completion bump propagates to the child's [refreshSignal].
      component.onSummaryBuildingChange(true);
      component.onSummaryBuildingChange(false);
      fixture.detectChanges();
      expect(cs.refreshSignal).toBe(component.summaryDerivedRefresh);
    });

    it('binds summaryDerivedRefresh to the Story Bible surface (when the review is ready/stale)', () => {
      // Mount the Story Bible: review ready + switch to the bible tab.
      component.onReviewStateChange('ready');
      fixture.detectChanges();
      fixture.debugElement.query(By.css('[data-testid="review-tab-bible"]')).nativeElement.click();
      fixture.detectChanges();

      const bible = fixture.debugElement.query(By.css('app-book-story-bible')).componentInstance;
      expect(bible.refreshSignal).toBe(component.summaryDerivedRefresh);

      // A completion bump propagates to the bible's [refreshSignal] (independent of its refreshToken).
      component.onSummaryBuildingChange(true);
      component.onSummaryBuildingChange(false);
      fixture.detectChanges();
      expect(bible.refreshSignal).toBe(component.summaryDerivedRefresh);
    });
  });

  it('renders the book profile sections once a profile loads (existing behavior intact)', () => {
    const bookSvc = TestBed.inject(BookService);
    (bookSvc.getProfile as jasmine.Spy).and.returnValue(
      of({ genre: 'Fantasy', synopsis: null, charactersJson: null, storyStructureJson: null } as any)
    );
    // Re-init to pick up the now-returning profile.
    component.bookId = 'book-2';
    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-2';
    component.bookLanguage = 'he';
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.overview-card'))).not.toBeNull();
  });

  // ── c02: reset the dashboard's OWN state when the editor switches book in place ──
  // The host keeps THIS instance alive and just changes [bookId]; the dashboard-owned profile card and
  // active review tab must reset and the profile must reload, without double-loading on init.
  // (The Ask answer was a third member of that set until Wave 3 / w7 removed the ask card.)
  describe('reset on book switch (c02)', () => {
    function profileFor(genre: string): BookProfileDto {
      return {
        genre,
        synopsis: null,
        charactersJson: null,
        storyStructureJson: null,
      } as unknown as BookProfileDto;
    }

    it('loads the profile exactly once on first init (ngOnInit loads, ngOnChanges firstChange does not)', () => {
      const bookSvc = TestBed.inject(BookService);
      const getProfile = bookSvc.getProfile as jasmine.Spy;
      // The component was already created + detectChanges() in the outer beforeEach (one init load).
      expect(getProfile).toHaveBeenCalledTimes(1);
      expect(getProfile).toHaveBeenCalledWith('book-1');
    });

    it('reloads the profile and resets reviewTab and the parsed profile state when bookId changes in place', () => {
      const bookSvc = TestBed.inject(BookService);
      const getProfile = bookSvc.getProfile as jasmine.Spy;

      // Hold the next profile open so the reset is observable before the new profile arrives.
      const profile$ = new Subject<BookProfileDto>();
      getProfile.and.returnValue(profile$.asObservable());

      // Simulate the prior book's lingering dashboard-owned state (set by the user before the switch).
      component.reviewTab = 'bible';
      component.synopsisExpanded = true;
      component.expandedPlotNode = 'climax';
      component.profile = profileFor('OldGenre');

      const callsBefore = getProfile.calls.count();

      // The editor switches book in place: only [bookId] changes (non-firstChange).
      const previous = component.bookId;
      component.bookId = 'book-2';
      component.ngOnChanges({
      bookId: new SimpleChange(previous, 'book-2', false),
      });

      // Transient own-state cleared immediately on the switch (before the new profile resolves).
      expect(component.reviewTab).toBe('findings');
      expect(component.synopsisExpanded).toBeFalse();
      expect(component.expandedPlotNode).toBeNull();
      // Book A's profile card must not keep rendering under book B's title while the new GET is still
      // in flight: resetOwnState() nulls it synchronously (loadProfile() itself only assigns on `next`).
      expect(component.profile).withContext('OldGenre must not leak into the gap before NewGenre resolves').toBeNull();

      // Profile reloaded for the new book.
      expect(getProfile.calls.count()).toBe(callsBefore + 1);
      expect(getProfile).toHaveBeenCalledWith('book-2');

      // The new book's profile arrives on the held-open stream and replaces the stale one.
      profile$.next(profileFor('NewGenre'));
      expect(component.profile?.genre).toBe('NewGenre');
    });

    it('resets its internal review/summary state on book switch so book A\'s building does not leak into '
      + 'book B\'s dashboard aggregate during the gap before its status loads', () => {
      // Book A's developmental review is running: reviewState='building' and the dashboard aggregate is true.
      component.onReviewStateChange('building');
      expect(component.buildRunning).toBeTrue();

      // The editor switches book in place (non-firstChange). The new book's review status has NOT loaded
      // yet (getReviewStatus is the default NEVER), so the review row will not re-emit for a while.
      const previous = component.bookId;
      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange(previous, 'book-2', false) });

      // rf-c02: the cached review state is reset immediately, so the stale 'building' from book A cannot keep
      // the dashboard's own aggregate lit for book B across the async status-load gap. (The HOST "review
      // running" affordance's wrong-book guard now lives in the editor: it re-subscribes anyRunningForBook$ to
      // the new bookId, so a book-A job can never light book B - covered in the editor spec.)
      expect(component.reviewState).toBe('unknown');
      expect(component.buildRunning).toBeFalse();
    });

    it('does NOT reload or reset on the first ngOnChanges (firstChange) so init loads only once', () => {
      const bookSvc = TestBed.inject(BookService);
      const getProfile = bookSvc.getProfile as jasmine.Spy;
      const callsBefore = getProfile.calls.count();

      component.reviewTab = 'bible';
      // The very first @Input binding fires ngOnChanges with firstChange=true; it must be a no-op
      // here (ngOnInit already owns the one init load).
      component.ngOnChanges({
      bookId: new SimpleChange(undefined, component.bookId, true),
      });

      expect(getProfile.calls.count()).toBe(callsBefore);
      expect(component.reviewTab).toBe('bible'); // untouched on firstChange
    });
  });

  // ── rf-f04: staging/prominence: profile readable + review as primary next action ────────────────
  //
  // (e) Profile/Story-Bible must stay readable (not blocked by a full-panel spinner) while the
  //     review is building. The `loading && !profile` guard only shows the "טוען" text when there
  //     is NO profile at all; once a profile exists it is always shown regardless of loading state.
  //
  // (f) When summary is READY but the review is NOT built, the stepper Assess CTA is present and
  //     represents the primary next action. The review is the leading visible next step.

  describe('rf-f04: staging/prominence', () => {
    it('(e) profile sections remain rendered during a review build (loading && !profile guard is false when profile exists)', () => {
      // Simulate a profile already loaded and a review build starting.
      // component.profile is private — stub it via the bookService returning a profile on init.
      const bookSvc = TestBed.inject(BookService);
      (bookSvc.getProfile as jasmine.Spy).and.returnValue(
        of({ genre: 'Fantasy', synopsis: 'A tale of two cities', charactersJson: null, storyStructureJson: null } as any)
      );

      // Re-create the component so ngOnInit loads the stubbed profile.
      fixture = TestBed.createComponent(BookDashboardComponent);
      component = fixture.componentInstance;
      component.bookId = 'book-loaded';
      component.bookLanguage = 'he';
      fixture.detectChanges();

      // Profile is now loaded: overview-card is rendered.
      expect(fixture.debugElement.query(By.css('.overview-card'))).not.toBeNull();

      // Now a review build starts (reviewState => 'building'). The review row emits 'building'.
      component.onReviewStateChange('building');
      // Also simulate the loading flag being true (e.g. re-fetch triggered elsewhere).
      // Even with loading=true, because profile is non-null the guard (loading && !profile) is false.
      (component as any).loading = true;
      fixture.detectChanges();

      // Profile sections remain visible: no blank panel, no full-page blocking spinner.
      expect(fixture.debugElement.query(By.css('.overview-card'))).not.toBeNull();
      // The "טוען" placeholder is NOT shown because profile is non-null.
      const loadingHint = fixture.debugElement.nativeElement.querySelector('.empty-hint');
      // .empty-hint may appear as "no profile" hint — it must NOT be the loading text when profile exists.
      // The loading guard is `@if (loading && !profile)` so with a profile present, no hint is shown.
      expect(loadingHint).toBeNull();
    });

    it('(e) no full-panel blank while review builds: buildRunning true but profile stays rendered', () => {
      // Stub a pre-loaded profile.
      const bookSvc = TestBed.inject(BookService);
      (bookSvc.getProfile as jasmine.Spy).and.returnValue(
        of({ genre: 'Thriller', synopsis: null, charactersJson: null, storyStructureJson: null } as any)
      );
      fixture = TestBed.createComponent(BookDashboardComponent);
      component = fixture.componentInstance;
      component.bookId = 'book-2';
      component.bookLanguage = 'he';
      fixture.detectChanges();

      // Profile loaded.
      expect(fixture.debugElement.query(By.css('.overview-card'))).not.toBeNull();

      // Review build starts.
      component.onReviewStateChange('building');
      expect(component.buildRunning).toBeTrue();
      fixture.detectChanges();

      // Profile must remain visible, showFindings is false (building state), but profile card is present.
      expect(component.showFindings).toBeFalse();
      expect(fixture.debugElement.query(By.css('.overview-card'))).not.toBeNull();
    });

    it('(f) the review build is the spine\'s offered action when briefs are ready and the review is not built', () => {
      // Wave 3 / w2: the four-step stepper is gone; the spine derives stage 3 from the review payload.
      // Briefs present, review never built -> stage 3 is `not-started` and offers the build.
      component.chapters = [
        { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 120, updatedAt: '2026-01-01T00:00:00Z' },
      ];
      component.onReviewStatusChange({
        bookId: 'book-1', language: 'he', hasReview: false, findingCount: 0, openFindingCount: 0,
        resolvedFindingCount: 0, lastUpdatedAt: null, builtWithDifferentModel: false, staleVsBriefs: false,
        hasBriefs: true, activeBuildJobId: null, ready: false, chaptersReviewed: 0, chaptersTotal: 1,
        windowCount: 0, ranSynthesis: false, ranContinuityReduce: false, failedWindows: 0,
      });
      component.onReviewStateChange('not-built');
      fixture.detectChanges();

      expect(
        fixture.debugElement.query(By.css('[data-testid="spine-stage-review"]'))?.nativeElement.dataset.state,
      ).toBe('not-started');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-action-review"]'))).not.toBeNull();
    });

    it('(f) review is the prominent next action: showFindings is false and the review row Build CTA is the leading action', () => {
      // When review state is not-built, the findings panel is hidden (owned by the review status row),
      // so the primary visible action is the Build assessment CTA in the status row.
      component.onReviewStateChange('not-built');
      fixture.detectChanges();

      // No findings panel: the review CTA in the status row is the only review-related action.
      expect(component.showFindings).toBeFalse();
      expect(fixture.debugElement.query(By.css('app-book-review-findings'))).toBeNull();
      // The review status row is always present (it owns the Build CTA while not built).
      expect(fixture.debugElement.query(By.css('app-book-review-status-row'))).not.toBeNull();
    });
  });

  // ── Wave 3 / w2: the spine's actions land on the mechanisms this page already has ─────────────────
  //
  // The spine NAMES an intent; the dashboard maps it. The distinction that has to survive is the one the
  // retired stepper's two CTAs encoded: going to the BUILD (the status rows) and going to the FINDINGS
  // (the ledger) are different destinations, and the second one also has to select the Findings tab.

  describe('w2: spine action dispatch', () => {
    it('open-findings selects the Findings tab, emits switchToReview and scrolls to the findings anchor', () => {
      component.reviewTab = 'bible';
      let emitCount = 0;
      component.switchToReview.subscribe(() => emitCount++);
      const findingsScrollSpy = jasmine.createSpy('findingsScroll');
      const statusRowsScrollSpy = jasmine.createSpy('statusRowsScroll');
      (component as any).findingsAnchor = { nativeElement: { scrollIntoView: findingsScrollSpy } };
      (component as any).statusRowsAnchor = { nativeElement: { scrollIntoView: statusRowsScrollSpy } };

      component.onSpineAction({ stage: 'review', action: 'open-findings' });

      expect(component.reviewTab).toBe('findings');
      expect(emitCount).toBe(1);
      expect(findingsScrollSpy).toHaveBeenCalledOnceWith({ behavior: 'smooth', block: 'start' });
      expect(statusRowsScrollSpy).not.toHaveBeenCalled();
    });

    it('build-briefs and build-review scroll to the STATUS ROWS and leave the review tab alone', () => {
      const findingsScrollSpy = jasmine.createSpy('findingsScroll');
      const statusRowsScrollSpy = jasmine.createSpy('statusRowsScroll');
      (component as any).findingsAnchor = { nativeElement: { scrollIntoView: findingsScrollSpy } };
      (component as any).statusRowsAnchor = { nativeElement: { scrollIntoView: statusRowsScrollSpy } };
      component.reviewTab = 'bible';

      component.onSpineAction({ stage: 'briefs', action: 'build-briefs' });
      component.onSpineAction({ stage: 'review', action: 'build-review' });

      expect(statusRowsScrollSpy).toHaveBeenCalledTimes(2);
      expect(findingsScrollSpy).not.toHaveBeenCalled();
      expect(component.reviewTab).toBe('bible');
    });

    it('a blocked review stage offers build-briefs, and it lands on the briefs row (the fix, not a dead end)', () => {
      const statusRowsScrollSpy = jasmine.createSpy('statusRowsScroll');
      (component as any).statusRowsAnchor = { nativeElement: { scrollIntoView: statusRowsScrollSpy } };
      component.chapters = [
        { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 90, updatedAt: '2026-01-01T00:00:00Z' },
      ];
      component.onReviewStatusChange({
        bookId: 'book-1', language: 'he', hasReview: false, findingCount: 0, openFindingCount: 0,
        resolvedFindingCount: 0, lastUpdatedAt: null, builtWithDifferentModel: false, staleVsBriefs: false,
        hasBriefs: false, activeBuildJobId: null, ready: false, chaptersReviewed: 0, chaptersTotal: 1,
        windowCount: 0, ranSynthesis: false, ranContinuityReduce: false, failedWindows: 0,
      });
      fixture.detectChanges();

      const row = fixture.debugElement.query(By.css('[data-testid="spine-stage-review"]'));
      expect(row.nativeElement.dataset.state).toBe('blocked');
      const action = fixture.debugElement.query(By.css('[data-testid="spine-action-review"]'));
      action.nativeElement.click();

      expect(statusRowsScrollSpy).toHaveBeenCalledOnceWith({ behavior: 'smooth', block: 'start' });
    });

    it('open-import bubbles up rather than routing here (the host owns the Router)', () => {
      let imports = 0;
      component.openImport.subscribe(() => imports++);

      component.onSpineAction({ stage: 'import', action: 'open-import' });

      expect(imports).toBe(1);
    });

    it('a chapter picked out of stage 4 is emitted through the EXISTING openChapter seam', () => {
      const seen: ChapterAnchor[] = [];
      component.openChapter.subscribe(a => seen.push(a));

      component.onSpineOpenChapter({ chapterId: 'ch-7', title: 'Seven', order: 6, running: false });

      expect(seen).toEqual([{ chapterId: 'ch-7', order: 6, title: 'Seven' }]);
    });

    it('spine actions are safe no-ops when the anchors are not yet available', () => {
      (component as any).findingsAnchor = undefined;
      (component as any).statusRowsAnchor = undefined;
      expect(() => component.onSpineAction({ stage: 'review', action: 'open-findings' })).not.toThrow();
      expect(() => component.onSpineAction({ stage: 'briefs', action: 'build-briefs' })).not.toThrow();
      expect(() => component.onSpineAction({ stage: 'export', action: 'open-export' })).not.toThrow();
    });

    // ── w4: the two ways to reach the export screen ────────────────────────────────────────────────

    it('the spine Export action leaves the page through the openExport output (the host owns routing)', () => {
      let exports = 0;
      component.openExport.subscribe(() => exports++);

      component.onSpineAction({ stage: 'export', action: 'open-export' });

      expect(exports).toBe(1);
    });

    it('the header Export button raises the SAME output, so both entry points land in one place', () => {
      let exports = 0;
      component.openExport.subscribe(() => exports++);

      const btn = fixture.debugElement.query(By.css('[data-testid="dashboard-export-btn"]'));
      expect(btn).withContext('the dashboard carries its own way to export').not.toBeNull();
      (btn.nativeElement as HTMLElement).click();

      expect(exports).toBe(1);
    });
  });

  // ── Wave 3 / w2: the live contradiction the brief reproduced, asserted on the HOST ────────────────
  //
  // On a book with no chapters the retired strip reported `Structure: Done` and `Revise: Available` and
  // offered a prominent `Build review`, while the panel one scroll below said the briefs were not built.
  // That is the single clearest demonstration of why this wave exists, so it is pinned here as well as
  // in the spine's own suite: it has to be dead through the real host wiring, not only in isolation.

  describe('w2: an empty book contradicts nothing', () => {
    it('shows Import as the lit stage and the review as blocked, with nothing reading done', () => {
      component.chapters = [];
      component.onReviewStatusChange(null);
      component.onSummaryStatusChange(null);
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();

      const stateOf = (id: string) =>
        fixture.debugElement.query(By.css(`[data-testid="spine-stage-${id}"]`)).nativeElement.dataset.state;

      expect(stateOf('import')).toBe('not-started');
      expect(stateOf('briefs')).toBe('blocked');
      expect(stateOf('review')).toBe('blocked');
      expect(stateOf('chapter-passes')).toBe('blocked');
      // w4: the export screen exists, so stage 5 states this BOOK's truth (nothing to export yet).
      expect(stateOf('export')).toBe('blocked');
      // The Import row is the one that opens, and it is the one that offers the action.
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="spine-action-import"]'))).not.toBeNull();
      // NOTHING claims readiness anywhere in the spine.
      const spine = fixture.debugElement.query(By.css('[data-testid="stage-spine"]')).nativeElement as HTMLElement;
      expect(spine.querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('offers the SAME walkable action on every blocked row (no CTA contradicts another)', () => {
      component.chapters = [];
      component.onReviewStatusChange(null);
      component.onSummaryStatusChange(null);
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();

      // The review row used to offer build-briefs here, landing the user on a briefs row that also could
      // not build. Every blocked stage now points at the one door that opens.
      let imports = 0;
      component.openImport.subscribe(() => imports++);
      for (const stage of ['briefs', 'review', 'chapter-passes', 'export']) {
        fixture.debugElement
          .query(By.css(`[data-testid="spine-stage-head-${stage}"]`))
          .nativeElement.click();
        fixture.detectChanges();
        fixture.debugElement
          .query(By.css(`[data-testid="spine-action-${stage}"]`))
          .nativeElement.click();
      }
      expect(imports).toBe(4);
    });

    it('hands the build rows the SAME chapter count the spine derives from, so they cannot disagree', () => {
      component.chapters = [];
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();

      const rows = [
        fixture.debugElement.query(By.css('app-book-summary-status-row')),
        fixture.debugElement.query(By.css('app-book-review-status-row')),
        fixture.debugElement.query(By.css('app-book-style-baseline-status-row')),
      ];
      for (const row of rows) {
        expect(row).not.toBeNull();
        expect(row.componentInstance.chapterCount).toBe(0);
        expect(row.componentInstance.blockedByImport)
          .withContext(`${row.name} must refuse its build on a book with no chapters`)
          .toBeTrue();
      }
      expect(component.spineSignals.chapterCount).toBe(0);
    });

    it('leaves the build rows alone while the chapter list has NOT arrived (null is not empty)', () => {
      component.chapters = null;
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();

      const row = fixture.debugElement.query(By.css('app-book-summary-status-row'));
      expect(row.componentInstance.chapterCount).toBeNull();
      expect(row.componentInstance.chaptersWithText).toBeNull();
      expect(row.componentInstance.blockedByImport).toBeFalse();
    });

    /**
     * final-r02. `chapterCount` alone answered only the empty book. On a book whose chapters were all
     * created empty the spine (which reads both counts since c01) rendered stage 1 "there are 3 chapters,
     * but nothing has been written in them" and stage 5 `blocked`, while these three rows stayed ENABLED
     * roughly 200px below and offered a real model run. The host now feeds BOTH counts from one getter
     * each, and the rows and the spine read them through the same predicate.
     */
    it('hands the build rows the TEXT count too, so rows-with-no-text cannot escape the precondition', () => {
      component.chapters = [
        { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 0, updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'ch-2', title: 'Two', partName: null, order: 1, wordCount: 0, updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'ch-3', title: 'Three', partName: null, order: 2, wordCount: 0, updatedAt: '2026-01-01T00:00:00Z' },
      ];
      // Stage 5's own signal, which the host binds from the book payload (w8 / F2): nothing here can be
      // exported either, which is what the server would say about three chapters with nothing in them.
      component.exportableChapterCount = 0;
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();

      const rows = [
        fixture.debugElement.query(By.css('app-book-summary-status-row')),
        fixture.debugElement.query(By.css('app-book-review-status-row')),
        fixture.debugElement.query(By.css('app-book-style-baseline-status-row')),
      ];
      for (const row of rows) {
        expect(row).not.toBeNull();
        expect(row.componentInstance.chapterCount).toBe(3);
        expect(row.componentInstance.chaptersWithText).toBe(0);
        expect(row.componentInstance.blockedByImport)
          .withContext(`${row.name} must refuse a build the server would answer as a no-op`)
          .toBeTrue();
      }
      // And the spine beside them is derived from the SAME two numbers, so the screen cannot contradict
      // itself: stage 5 blocked is what made this visible live. Stage 5 reads a THIRD number since
      // w8 / F2 (the exporter's own count, an @Input from the host); this book has none of the three.
      expect(component.spineSignals.chapterCount).toBe(3);
      expect(component.spineSignals.chaptersWithText).toBe(0);
      expect(component.spineSignals.chaptersExportable).toBe(0);
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-export"]')).attributes['data-state'])
        .toBe('blocked');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-briefs"]')).attributes['data-state'])
        .toBe('blocked');
    });

    /**
     * D14. `ngOnChanges` rebuilt the spine on `bookId`, `bookLanguage` and `chapters` and not on
     * `exportableChapterCount`, which is a SEPARATE input that can move on its own: a chapter's stored
     * document becomes renderable without the chapter list changing at all, which is exactly what the
     * first save into a freshly imported book does. Both of today's hosts rebind the pair off one
     * refreshed `book` object, so `chapters` covered for it; a host that re-asks the server for the count
     * alone left stage 5 rendering the previous answer with nothing to notice it by.
     *
     * The rebind goes through `ngOnChanges` explicitly because setting an `@Input` FIELD fires none.
     */
    it('rebuilds the spine when only exportableChapterCount is rebound (D14)', () => {
      const chapters = [
        { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 900, updatedAt: '2026-01-01T00:00:00Z' },
      ];
      component.chapters = chapters;
      component.exportableChapterCount = 0;
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-export"]')).attributes['data-state'])
        .withContext('imported and never opened: rows exist, the exporter can make nothing from them')
        .toBe('blocked');

      // The host re-asked the SERVER and only the count came back different. The chapter list is the same
      // array, so `changes['chapters']` cannot be what saves this.
      component.exportableChapterCount = 1;
      component.ngOnChanges({ exportableChapterCount: new SimpleChange(0, 1, false) });
      fixture.detectChanges();

      expect(component.chapters).withContext('the list must be untouched, or this proves nothing').toBe(chapters);
      expect(component.spineSignals.chaptersExportable).toBe(1);
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-export"]')).attributes['data-state'])
        .withContext('stage 5 must follow the count it is given, not the one it happened to mount with')
        .toBe('ready');
    });

    it('re-enables every build row as soon as one chapter carries text', () => {
      component.chapters = [
        { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 42, updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'ch-2', title: 'Two', partName: null, order: 1, wordCount: 0, updatedAt: '2026-01-01T00:00:00Z' },
      ];
      (component as any).rebuildSpineSignals();
      fixture.detectChanges();

      for (const sel of ['app-book-summary-status-row', 'app-book-review-status-row', 'app-book-style-baseline-status-row']) {
        const row = fixture.debugElement.query(By.css(sel));
        expect(row.componentInstance.chaptersWithText).toBe(1);
        expect(row.componentInstance.blockedByImport).withContext(sel).toBeFalse();
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // Wave 3 / w5: the dashboard consolidation
  // ══════════════════════════════════════════════════════════════════════════════════════════════════

  describe('w5 / Q4-A: the bare circular arrow is folded into the formal build row', () => {
    it('renders NO icon-only refresh control anywhere in the header', () => {
      expect(fixture.debugElement.query(By.css('.refresh-btn'))).toBeNull();
      const header = fixture.debugElement.query(By.css('.dashboard-header')).nativeElement as HTMLElement;
      expect(header.textContent).not.toContain('⟳');
    });

    it('keeps the Export button in the header action cluster (it must not vanish with the arrow)', () => {
      const cluster = fixture.debugElement.query(By.css('.dashboard-header .header-actions'));
      expect(cluster).not.toBeNull();
      const btn = cluster.query(By.css('[data-testid="dashboard-export-btn"]'));
      expect(btn).not.toBeNull();

      let exports = 0;
      component.openExport.subscribe(() => exports++);
      (btn.nativeElement as HTMLElement).click();
      expect(exports).withContext('the Export button still raises openExport').toBe(1);
    });

    it('the empty profile state points at the build row instead of at a removed icon', () => {
      // The default BookService stub returns NEVER for getProfile, so `profile` is null: this IS the
      // empty state a book with no profile hits.
      component.loading = false;
      fixture.detectChanges();
      const hint = fixture.debugElement.query(By.css('.empty-hint')).nativeElement as HTMLElement;
      expect(hint.textContent).not.toContain('⟳');
      expect(hint.textContent).toContain('תקצירי ספר');
    });
  });

  describe('w5 / Q6-A + MOVE-1: the writing-style build lives beside the other whole-book builds', () => {
    it('mounts the writing-style row inside the SAME status card as the briefs and review rows', () => {
      const card = fixture.debugElement.query(By.css('.book-status-card'));
      expect(card.query(By.css('app-book-summary-status-row'))).not.toBeNull();
      expect(card.query(By.css('app-book-review-status-row'))).not.toBeNull();
      expect(card.query(By.css('app-book-style-baseline-status-row')))
        .withContext('the relocated build must sit beside its peers, not in an area of its own')
        .not.toBeNull();
    });

    it('forwards the book context to the writing-style row', () => {
      const row = fixture.debugElement.query(By.css('app-book-style-baseline-status-row')).componentInstance;
      expect(row.bookId).toBe('book-1');
      expect(row.bookLanguage).toBe('he');
    });

    it('passes the retarget focus token through to the row that owns the scroll', () => {
      component.focusBaselineToken = 3;
      fixture.detectChanges();
      const row = fixture.debugElement.query(By.css('app-book-style-baseline-status-row')).componentInstance;
      expect(row.focusToken).toBe(3);
    });
  });

  describe('w5 / Q8-C: the chapter-brief card reads as the inputs to stage 2s build', () => {
    it('sits INSIDE the briefs row group, after the briefs row, not as a card of its own', () => {
      const group = fixture.debugElement.query(By.css('.book-status-card [data-testid="inputs-to-this-build"]'));
      expect(group).withContext('the inputs group belongs to stage 2s row group').not.toBeNull();
      expect(fixture.debugElement.query(By.css('.book-dashboard > .chapter-summaries-card')))
        .withContext('the standalone chapter-summaries card is gone')
        .toBeNull();
    });

    it('carries the explanation OUTSIDE the fold, so the relationship survives a collapse', () => {
      const explainer = fixture.debugElement.query(By.css('[data-testid="inputs-to-this-build"] .inputs-explainer'));
      expect(explainer).not.toBeNull();
      // Option C's accepted cost: the copy has to carry the whole explanation, so it must name both the
      // build it feeds and the effect of editing one by hand.
      expect(explainer.nativeElement.textContent).toContain('תקצירי הספר');
      expect(explainer.nativeElement.textContent).toContain('עריכה ידנית');
      // It is outside the collapsible, so folding the list does not fold the explanation away.
      expect(explainer.nativeElement.closest('.cs-body')).toBeNull();
    });

    it('names the group "the inputs to this build" in both languages', () => {
      const headingText = () =>
        (fixture.debugElement.query(By.css('[data-testid="collapse-toggle-inputs"]')).nativeElement as HTMLElement)
          .textContent ?? '';
      expect(headingText()).toContain('הקלט לבנייה הזו');

      component.bookLanguage = 'en';
      fixture.detectChanges();
      expect(headingText()).toContain('The inputs to this build');
    });
  });

  describe('w5 / the collapse directive: what folds, what must never fold', () => {
    /** Every collapsible section the dashboard renders, by its section id. */
    function sectionIds(): string[] {
      return fixture.debugElement
        .queryAll(By.css('app-collapsible-section .cs'))
        .map((d) => (d.nativeElement as HTMLElement).getAttribute('data-section') ?? '');
    }

    it('collapses at two levels: a major part (the review findings group) and inner elements', () => {
      component.reviewState = 'ready';
      fixture.detectChanges();
      const ids = sectionIds();
      expect(ids).toContain('review-findings');   // a major part
      expect(ids).toContain('inputs');            // an element inside stage 2s row group
      expect(ids).toContain('character-register');
    });

    it('DEFAULTS to the current layout: expanded everywhere except the two long content lists', () => {
      component.reviewState = 'ready';
      fixture.detectChanges();
      // Expanded by default: nothing the reader sees today is hidden by this change.
      expect(fixture.debugElement.query(By.css('[data-testid="collapse-body-review-findings"]'))).not.toBeNull();
      // Collapsed by default: the two long lists.
      expect(fixture.debugElement.query(By.css('[data-testid="collapse-body-inputs"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="collapse-body-character-register"]'))).toBeNull();
    });

    /**
     * THE NEVER-COLLAPSE CLASS, asserted against the rendered DOM (wave3-spine fixes c08, findings 25+26).
     *
     * `collapse-store.ts` used to claim this class was "enforced by placement ... so no key for them can
     * ever exist". Nothing enforced it: the review found `settings` wrapped with the tier toggle's
     * server-driven fallback warning inside the fold, and the key `settings` duly in the stored map. This
     * spec is what enforcement looks like. It fails in BOTH directions a regression can take:
     *
     *  - wrapped in an EXPANDED collapsible -> the element has a `[data-testid^="collapse-body-"]`
     *    ancestor, and the ancestor assertion goes red;
     *  - wrapped in a COLLAPSED one -> Ivy leaves the projected nodes unattached, so the element is not in
     *    the DOM at all and the presence assertion goes red first.
     *
     * The `.closest()` target is the collapse BODY rather than `app-collapsible-section`, because the body
     * is the thing that actually disappears.
     */
    it('the never-collapse class: nothing whose visibility IS the warning may sit inside a fold', () => {
      component.reviewState = 'ready';
      fixture.detectChanges();

      const neverCollapse: Array<[string, string]> = [
        ['app-stage-spine', 'the spine is the wave centerpiece; it must not be foldable out of sight'],
        ['app-book-summary-status-row', 'a blocked / stale / building / consent state must not be foldable'],
        ['app-book-review-status-row', 'a blocked / stale / building / consent state must not be foldable'],
        ['app-book-style-baseline-status-row', 'a blocked / stale / building / consent state must not be foldable'],
        // Finding 25. It renders `fallbackWarning` off a server flag that arrives with NO user action, plus
        // `saveError` and the consent prompt. Scoped to the foot-of-page card because the OTHER mounted
        // toggle lives inside the review status row, and a bare `app-tier-toggle` would let that one
        // satisfy the presence assertion for a settings row that had been folded back out of the DOM.
        ['.book-tier-default-card app-tier-toggle', 'the book-default tier row carries the server-driven fallback warning'],
      ];

      for (const [selector, why] of neverCollapse) {
        const found = fixture.debugElement.queryAll(By.css(selector));
        expect(found.length).withContext(`${selector} is not rendered at all: ${why}`).toBeGreaterThan(0);
        for (const one of found) {
          expect((one.nativeElement as HTMLElement).closest('[data-testid^="collapse-body-"]'))
            .withContext(`${selector} must not sit inside a collapsible body: ${why}`)
            .toBeNull();
        }
      }
    });

    it('records a verdict for EVERY section it renders, so the set stays complete', () => {
      component.reviewState = 'ready';
      fixture.detectChanges();
      // The collapsible set, DISCOVERED from the DOM rather than restated, against the sections whose
      // collapse verdict is argued in the component template. A NEW `app-collapsible-section` goes red here
      // until its verdict is written down beside the others - which is how `settings` should have been
      // caught. The four profile cards and Ask carry the sixth verdict (the comment above them in the
      // template) and are absent here only because this fixture's `getProfile` never answers.
      expect(sectionIds().sort()).toEqual(
        ['character-register', 'inputs', 'review-findings'].sort(),
      );
    });

    it('persists a fold per book, under a book-scoped key', () => {
      expandSection('inputs');
      expect(fixture.debugElement.query(By.css('[data-testid="collapse-body-inputs"]'))).not.toBeNull();

      const raw = localStorage.getItem('pd:dashboard-collapse:book-1');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)['inputs']).toBeFalse();
    });

    it('restores the remembered fold on the next mount of the same book', () => {
      // `review-findings` rather than `settings`: c08 gave settings a never-collapse verdict, so it has no
      // stored key any more. This one defaults EXPANDED, so a stored `true` proves storage outranks the
      // default rather than merely agreeing with it.
      localStorage.setItem('pd:dashboard-collapse:book-1', JSON.stringify({ 'review-findings': true }));

      const second = TestBed.createComponent(BookDashboardComponent);
      second.componentInstance.bookId = 'book-1';
      second.componentInstance.bookLanguage = 'he';
      second.componentInstance.reviewState = 'ready';
      second.detectChanges();

      expect(second.debugElement.query(By.css('[data-testid="collapse-toggle-review-findings"]')))
        .withContext('the section must be mounted for this to mean anything')
        .not.toBeNull();
      expect(second.debugElement.query(By.css('[data-testid="collapse-body-review-findings"]')))
        .withContext('a section the reader folded stays folded for that book')
        .toBeNull();
      second.destroy();
    });
  });
});

/**
 * tier-ux-rework fixes c04: a tier change on the dashboard re-reads BOTH model-dependent statuses.
 *
 * The dashboard mounts TWO tier toggles against one book - the book-default row at the foot and the one
 * inside the review status row - and both the summary status and the review status carry a
 * `builtWithDifferentModel` flag computed against the ACTIVE MODEL. So whichever toggle is used, both rows'
 * cross-model staleness verdicts are stale the instant the write lands, and used to stay stale until reload.
 *
 * The two things this suite is really for:
 *  - BOTH dispatch branches inherit the SAME guarded loaders. A branch that refreshed only one row, or that
 *    issued a fetch of its own beside the row's, is the shape this codebase has already shipped once.
 *  - the re-read SUPERSEDES an in-flight status read rather than racing it, asserted on the older request
 *    being cancelled - which needs the request held OPEN across assertions, not an `of()` that has already
 *    closed the window by the time the assertion runs.
 */
describe('BookDashboardComponent tier-change refresh (tier-ux-rework fixes c04)', () => {
  interface OpenRequest<T> {
    /** Held OPEN across assertions: the caller decides when (and whether) this request ever answers. */
    subject: Subject<T>;
    /** True once the caller detached from this request, i.e. it was superseded/cancelled. */
    cancelled: boolean;
  }

  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let summaryReads: OpenRequest<unknown>[];
  let reviewReads: OpenRequest<BookReviewStatusDto>[];

  /** A status GET that answers only on demand and records when the caller detaches from it. */
  function trackedRead<T>(log: OpenRequest<T>[]): Observable<T> {
    const entry: OpenRequest<T> = { subject: new Subject<T>(), cancelled: false };
    log.push(entry);
    return new Observable<T>((sub) => {
      const inner = entry.subject.subscribe(sub);
      return () => {
        entry.cancelled = true;
        inner.unsubscribe();
      };
    });
  }

  /** A NOT-BUILT review status: enough for the row (and therefore its tier toggle) to render at all. */
  function notBuiltReview(): BookReviewStatusDto {
    return {
      bookId: 'book-1',
      language: 'he',
      hasReview: false,
      findingCount: 0,
      openFindingCount: 0,
      resolvedFindingCount: 0,
      lastUpdatedAt: null,
      builtWithDifferentModel: false,
      staleVsBriefs: false,
      hasBriefs: true,
      activeBuildJobId: null,
      ready: false,
      chaptersReviewed: 0,
      chaptersTotal: 0,
      windowCount: 0,
      ranSynthesis: false,
      ranContinuityReduce: false,
      failedWindows: 0,
    };
  }

  beforeEach(async () => {
    summaryReads = [];
    reviewReads = [];
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER,
            refreshProfile: NEVER,
            getById: NEVER,
          }),
        },
        // w5 (MOVE-1): transitive dep of the relocated writing-style row hosted by the dashboard.
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        {
          provide: BookSummaryService,
          useValue: {
            getBookSummaryStatus: () => trackedRead(summaryReads),
            buildBookSummary: () => NEVER,
          },
        },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => trackedRead(reviewReads),
            buildReview: () => NEVER,
            getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER,
            patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: {
            getChapterSummary: () => NEVER,
            updateChapterSummary: () => NEVER,
            rederiveChapterSummary: () => NEVER,
          },
        },
        // Transitive dep of the hosted character-register child (character-register-editing c2).
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER,
            refresh: () => NEVER,
            get: () => NEVER,
            setTask: () => NEVER,
            setBookDefault: () => NEVER,
            clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    fixture.detectChanges();
    // The review row (and with it the BookReview tier toggle) is hidden until a status arrives, so answer
    // the mount read. The summary read is deliberately left unanswered: this suite only counts and cancels it.
    reviewReads[reviewReads.length - 1].subject.next(notBuiltReview());
    fixture.detectChanges();
  });

  /** The book-DEFAULT toggle at the foot of the page. */
  function footToggle(): TierToggleComponent {
    const found = fixture.debugElement.query(By.css('.book-tier-default-card app-tier-toggle'));
    expect(found).withContext('the foot-of-page book default toggle').not.toBeNull();
    return found.componentInstance as TierToggleComponent;
  }

  /** The BookReview toggle mounted inside the review status row. */
  function reviewRowToggle(): TierToggleComponent {
    const found = fixture.debugElement.query(By.css('app-book-review-status-row app-tier-toggle'));
    expect(found).withContext('the BookReview toggle on the review row').not.toBeNull();
    return found.componentInstance as TierToggleComponent;
  }

  it('the FOOT (book default) toggle refreshes BOTH the summary and the review status', () => {
    const summaryBefore = summaryReads.length;
    const reviewBefore = reviewReads.length;

    footToggle().tierChanged.emit();

    expect(summaryReads.length).withContext('summary re-read exactly once').toBe(summaryBefore + 1);
    expect(reviewReads.length).withContext('review re-read exactly once').toBe(reviewBefore + 1);
  });

  it('the REVIEW ROW toggle refreshes BOTH statuses too, through the same handler', () => {
    const summaryBefore = summaryReads.length;
    const reviewBefore = reviewReads.length;

    reviewRowToggle().tierChanged.emit();

    expect(summaryReads.length)
      .withContext('the sibling row goes stale too: both flags read the same active model')
      .toBe(summaryBefore + 1);
    expect(reviewReads.length).toBe(reviewBefore + 1);
  });

  it('the tier-change re-read SUPERSEDES the in-flight status reads instead of racing them', () => {
    // The rows each have a read open from their own mount; that is the window under test.
    const openSummary = summaryReads[summaryReads.length - 1];
    const openReview = reviewReads[reviewReads.length - 1];
    expect(openSummary.cancelled).withContext('precondition').toBeFalse();
    expect(openReview.cancelled).withContext('precondition').toBeFalse();

    footToggle().tierChanged.emit();

    expect(openSummary.cancelled).withContext('the older summary read must be cancelled').toBeTrue();
    expect(openReview.cancelled).withContext('the older review read must be cancelled').toBeTrue();
    expect(summaryReads[summaryReads.length - 1]).not.toBe(openSummary);
    expect(reviewReads[reviewReads.length - 1]).not.toBe(openReview);
  });

  it('does not throw when a row is not mounted yet (the handler is view-child optional)', () => {
    (component as any).summaryRow = undefined;
    (component as any).reviewRow = undefined;
    expect(() => component.onTierChanged()).not.toThrow();
  });
});

/**
 * Book-scoped chrome i18n parity. The dashboard's own profile card was originally Hebrew-only: the root
 * container was hardcoded dir="rtl" and roughly 30 strings were inline literals, so an English book rendered
 * a half-Hebrew, right-to-left page while every CHILD component on the same page correctly followed
 * [bookLanguage]. Found by loading an English book in a real browser; no spec covered it because the
 * existing suite only ever set bookLanguage = 'he'. These lock the rule in both directions.
 */
describe('BookDashboardComponent book-scoped chrome i18n parity', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, getById: NEVER,
          }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        // Transitive dep of the hosted character-register child (character-register-editing c2).
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
  });

  /**
   * Derived from the real Hebrew map, so a key added to the maps is covered by the per-key suites below
   * without anyone editing this file. The list is only as complete as DASHBOARD_LABELS_HE itself; the
   * set-equality suite below is what ties the English map to it at runtime.
   */
  const ALL_KEYS = Object.keys(DASHBOARD_LABELS_HE) as DashboardLabelKey[];

  const HEBREW = /[\u0590-\u05FF]/;

  it('derives a non-empty key list (an empty derivation would pass every per-key loop vacuously)', () => {
    expect(ALL_KEYS.length).withContext('Object.keys(DASHBOARD_LABELS_HE) must not be empty').toBeGreaterThan(0);
  });

  it('holds the same key set in both language maps, in both directions', () => {
    const heKeys = Object.keys(DASHBOARD_LABELS_HE);
    const enKeys = Object.keys(DASHBOARD_LABELS_EN);
    const missingFromEn = heKeys.filter((k) => !enKeys.includes(k));
    const missingFromHe = enKeys.filter((k) => !heKeys.includes(k));

    expect(missingFromEn)
      .withContext(`keys in the Hebrew map with no English counterpart: ${missingFromEn.join(', ')}`)
      .toEqual([]);
    expect(missingFromHe)
      .withContext(`keys in the English map with no Hebrew counterpart: ${missingFromHe.join(', ')}`)
      .toEqual([]);
  });

  it('resolves every label in both languages, with no key falling back to the other language', () => {
    component.bookLanguage = 'he';
    const he = ALL_KEYS.map((k) => component.label(k));
    component.bookLanguage = 'en';
    const en = ALL_KEYS.map((k) => component.label(k));

    he.forEach((v, i) => {
      expect(v).withContext(`he label for "${ALL_KEYS[i]}" must be non-empty`).toBeTruthy();
      expect(HEBREW.test(v)).withContext(`he label for "${ALL_KEYS[i]}" must be Hebrew`).toBeTrue();
    });
    en.forEach((v, i) => {
      expect(v).withContext(`en label for "${ALL_KEYS[i]}" must be non-empty`).toBeTruthy();
      expect(HEBREW.test(v)).withContext(`en label for "${ALL_KEYS[i]}" must NOT contain Hebrew`).toBeFalse();
    });
  });

  it('carries no em-dash or en-dash in any user-facing string (project text rule)', () => {
    (['he', 'en'] as const).forEach((lang) => {
      component.bookLanguage = lang;
      ALL_KEYS.forEach((k) => {
        const v = component.label(k);
        expect(v.includes('\u2014')).withContext(`${lang}/${k} must not contain an em-dash`).toBeFalse();
        expect(v.includes('\u2013')).withContext(`${lang}/${k} must not contain an en-dash`).toBeFalse();
      });
    });
  });

  it('follows the BOOK language for direction, not a hardcoded rtl (the shipped defect)', () => {
    component.bookLanguage = 'en';
    expect(component.bookDir).toBe('ltr');
    component.bookLanguage = 'he';
    expect(component.bookDir).toBe('rtl');
    // An unset/unknown language stays Hebrew-default, matching the rest of the app.
    component.bookLanguage = null;
    expect(component.bookDir).toBe('rtl');
  });

  it('keeps reviewDir consistent with the dashboard direction', () => {
    component.bookLanguage = 'en';
    expect(component.reviewDir).toBe(component.bookDir);
    component.bookLanguage = 'he';
    expect(component.reviewDir).toBe(component.bookDir);
  });

  it('renders an English book with an ltr container and English chrome (no Hebrew in the DOM)', () => {
    component.bookLanguage = 'en';
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.book-dashboard') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('ltr');

    const title = fixture.nativeElement.querySelector('.dashboard-title') as HTMLElement;
    expect(title.textContent).toContain('Book dashboard');
    expect(HEBREW.test(title.textContent ?? '')).withContext('English book must not render Hebrew chrome').toBeFalse();

    // w5 (Q4-A): the bare circular-arrow refresh button is GONE, so there is no `.refresh-btn` to check a
    // localized tooltip on. The English-chrome guarantee is now carried by the Export action beside it and
    // by the collapse headings, which are the header's remaining localized strings.
    expect(fixture.nativeElement.querySelector('.refresh-btn'))
      .withContext('the unmetered icon-only whole-book build must not come back')
      .toBeNull();
    const exportBtn = fixture.nativeElement.querySelector('[data-testid="dashboard-export-btn"]') as HTMLElement;
    expect(exportBtn.textContent?.trim()).toBe('Export');
    // c08 finding 25: `.settings-heading` is in this list because the settings heading LEFT the collapsible
    // when that section took its never-collapse verdict; without it, unwrapping a section would silently
    // drop its heading out of this i18n sweep.
    const headings = Array.from(
      fixture.nativeElement.querySelectorAll('app-collapsible-section .cs-title, .settings-heading')
    ) as HTMLElement[];
    expect(headings.length).withContext('the collapse headings are localized chrome too').toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('.settings-heading')?.textContent?.trim())
      .withContext('the unwrapped settings heading is localized chrome too')
      .toBe('Settings');
    for (const h of headings) {
      expect(HEBREW.test(h.textContent ?? ''))
        .withContext(`English book must not render Hebrew section heading: ${h.textContent}`)
        .toBeFalse();
    }
  });

  it('renders a Hebrew book with an rtl container and Hebrew chrome', () => {
    component.bookLanguage = 'he';
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.book-dashboard') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('rtl');

    const title = fixture.nativeElement.querySelector('.dashboard-title') as HTMLElement;
    expect(HEBREW.test(title.textContent ?? '')).toBeTrue();
  });
});

/**
 * c01 (history) / w5+w7 (what is left): the dashboard's own SERVER calls, and the closing statement of
 * two removals.
 *
 * c01 found that the chrome was made book-scoped while onRefresh/onAsk still called the service with no
 * language argument, so both fell through to the service default of 'he' and then the controller default
 * of "he" - not display-only, since RefreshProfileAsync threads the language into the chapter summarize
 * and profile build, which STAMP it onto ChunkSummary.Language and BookProfile.Language. That drove FIVE
 * language-threading cases over `onAsk`, plus a `driveAsk` helper, which lived in this describe.
 *
 * Both callers are gone now: `refreshProfile`'s bare-arrow caller moved to the Book briefs row in w5
 * (asserted there, in `book-summary-status-row.component.spec.ts`, describe 'Q4-A'), and `onAsk` /
 * `BookService.ask` were removed outright in w7. The property did NOT weaken, it EMPTIED - there is
 * nothing left on this component to thread a language INTO - so this describe no longer asserts anything
 * about language (finding C7); it is honestly retitled below to what the one surviving test actually
 * checks: that after both removals, a full mount issues exactly one BookService call and no others.
 */
describe('BookDashboardComponent issues no extra whole-book server call, now that w5 and w7 removed its other two (c01 history)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let bookService: jasmine.SpyObj<BookService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, getById: NEVER,
          }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        // Transitive dep of the hosted character-register child (character-register-editing c2).
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    bookService = TestBed.inject(BookService) as jasmine.SpyObj<BookService>;
    component.bookId = 'book-1';
  });

  /**
   * Wave 3 / w7: the FIVE language-threading cases over `onAsk` LIVED HERE, and so did the `driveAsk`
   * helper that fed them. They asserted that the ask card sent the book's language rather than falling
   * through to the service default, which was the c01 defect. The card is gone, `BookService.ask` is
   * gone with it, and there is nothing left on this component to thread a language INTO.
   *
   * The property did not weaken, it emptied: this suite's other subject, `refreshProfile`, had already
   * moved to the Book briefs row in w5 (asserted there, in `book-summary-status-row.component.spec.ts`,
   * describe 'Q4-A'), and the language threading for every remaining book-level call is asserted on the
   * row that issues it. What is left here is the closing statement of both removals, phrased as a
   * property of the component rather than of a handler: after a full mount, the dashboard has issued
   * exactly one BookService call, the profile GET, and no build or ask call of its own.
   */
  it('issues no whole-book server call of its own beyond the profile read (w5 arrow + w7 ask, both gone)', () => {
    // No `component.bookLanguage = 'en'` here: that assignment was inert (setting an `@Input` field
    // directly fires no `ngOnChanges`, and nothing this test asserts reads the language anyway - see
    // the describe doc comment for where language threading IS still covered). `bookId` alone, set in
    // `beforeEach`, is enough to drive `ngOnInit`'s profile load.
    fixture.detectChanges();

    expect(bookService.getProfile)
      .withContext('the profile read is the one server call this component still owns')
      .toHaveBeenCalledWith('book-1');
    expect(bookService.refreshProfile)
      .withContext('w5: the bare refresh arrow folded into the Book briefs build row')
      .not.toHaveBeenCalled();
    // The w7 `BookService.ask` pin used to live here, asserted at the class rather than at this
    // TestBed's spy for the same reason given above. Moved to `book.service.spec.ts` (finding C7): it
    // is a fact about `BookService`, not about this component, and a future feature legitimately
    // re-adding `ask()` should not turn a dashboard spec red with a misleading message.
  });
});

/**
 * c02: the dashboard must watch bookLanguage, not just bookId, and must drop responses from the language it
 * has left behind.
 *
 * The book language is mutable in-session (BookService.update writes it; the editor binds
 * [bookLanguage]="book.language" off that same record), and ngOnChanges only keyed on bookId. So on a
 * language switch the chrome flipped (pure getters) while the profile card kept content generated in the
 * PREVIOUS language and no reload was issued. There was also no language in the in-flight guard, so a load
 * started under one language was accepted after the switch.
 *
 * Every request here is driven through an rxjs Subject held OPEN across the assertions. of()/throwError()
 * resolve synchronously, which closes the in-flight window before the context can change, and would pass
 * against the unfixed code.
 */
describe('BookDashboardComponent watches bookLanguage and drops stale responses (c02)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let bookService: jasmine.SpyObj<BookService>;
  /** One entry per getProfile / refreshProfile call, in issue order, each answerable on demand. */
  let profileLoads: Subject<BookProfileDto>[];
  let refreshes: Subject<BookProfileDto>[];

  function queued<T>(log: Subject<T>[]): Observable<T> {
    const subject = new Subject<T>();
    log.push(subject);
    return subject.asObservable();
  }

  function profileFor(genre: string): BookProfileDto {
    return { genre, synopsis: null, charactersJson: null, storyStructureJson: null } as unknown as BookProfileDto;
  }

  /** Rebind [bookLanguage] the way the host does: set the input, then run ngOnChanges (non-firstChange). */
  function switchLanguageTo(next: string): void {
    const previous = component.bookLanguage;
    component.bookLanguage = next;
    component.ngOnChanges({ bookLanguage: new SimpleChange(previous, next, false) });
  }

  beforeEach(async () => {
    profileLoads = [];
    refreshes = [];
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, getById: NEVER,
          }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        // Transitive dep of the hosted character-register child (character-register-editing c2).
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    bookService = TestBed.inject(BookService) as jasmine.SpyObj<BookService>;
    bookService.getProfile.and.callFake(() => queued(profileLoads));
    bookService.refreshProfile.and.callFake(() => queued(refreshes));

    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    // ngOnInit issues the first profile load under 'he'; it is left OPEN (the Subject never completes).
    fixture.detectChanges();
    expect(profileLoads.length).withContext('precondition: one profile load in flight under he').toBe(1);
  });

  it('treats a bookLanguage change like a book switch: resets own state and reloads the profile', () => {
    // Own state the user built up under the Hebrew book.
    component.reviewTab = 'bible';
    component.synopsisExpanded = true;
    component.expandedPlotNode = 'climax';

    switchLanguageTo('en');

    expect(component.reviewTab).withContext('a language switch must reset the dashboard-owned tab').toBe('findings');
    expect(component.synopsisExpanded).toBeFalse();
    expect(component.expandedPlotNode).toBeNull();
    expect(profileLoads.length)
      .withContext('the profile is language-keyed server content, so a language switch must reload it')
      .toBe(2);
  });

  it('does NOT reload on the FIRST bookLanguage binding (ngOnInit owns the one init load)', () => {
    component.ngOnChanges({ bookLanguage: new SimpleChange(undefined, 'he', true) });
    expect(profileLoads.length).toBe(1);
  });

  it('IGNORES a profile load response that resolves after the language switched (next handler)', () => {
    const staleLoad = profileLoads[0]; // issued under 'he'

    switchLanguageTo('en'); // resets, and issues the 'en' load which is still in flight
    expect(profileLoads.length).toBe(2);

    // The abandoned 'he' request finally answers.
    staleLoad.next(profileFor('HebrewGenre'));

    expect(component.profile)
      .withContext('a profile generated in the PREVIOUS language must never populate the card')
      .toBeNull();
    expect(component.loading)
      .withContext('the stale response cleared the CURRENT load latch: guard must run before the latch clear')
      .toBeTrue();

    // The guard is not over-broad: the load for the current language is still accepted.
    profileLoads[1].next(profileFor('EnglishGenre'));
    expect(component.profile?.genre).toBe('EnglishGenre');
    expect(component.loading).toBeFalse();
  });

  it('IGNORES a profile load ERROR that arrives after the language switched (error handler)', () => {
    const staleLoad = profileLoads[0];

    switchLanguageTo('en');

    staleLoad.error({ status: 500, message: 'he-side failure' });

    expect(component.error)
      .withContext('a failure from the abandoned language must not surface as the current error')
      .toBeNull();
    expect(component.loading)
      .withContext('the stale error cleared the CURRENT load latch: guard must run before the latch clear')
      .toBeTrue();
  });

  // w5 (Q4-A): four `onRefresh` stale-response tests LIVED HERE. They pinned the abandoned-request
  // contract for the bare arrow's refreshProfile call, which is no longer issued by this component. The
  // same contract is asserted on the component that issues it now, the Book briefs row, against the same
  // (book, language) key (see `book-summary-status-row.component.spec.ts`, describe 'Q4-A'). The
  // getProfile and ask halves of the contract are untouched and still covered above and below.

  // Wave 3 / w7 (Q5): THREE `onAsk` stale-response tests LIVED HERE, exactly parallel to the four
  // `onRefresh` ones noted just above and removed for the same reason: the handler they pinned is gone
  // with the ask card. What each asserted (guard-before-latch-clear in the next handler, the same in
  // the error handler, and the switch settling an abandoned request's latch) is a property of the
  // CONTRACT rather than of `onAsk`, and the contract's remaining participant on this component,
  // `loadProfile`, is asserted on all three counts by the three tests above.

  it('still drops a response abandoned by a bookId switch (the pre-existing axis stays guarded)', () => {
    const staleLoad = profileLoads[0];

    const previous = component.bookId;
    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange(previous, 'book-2', false) });

    staleLoad.next(profileFor('BookOneGenre'));

    expect(component.profile).withContext('book-1 content must not paint book-2').toBeNull();
    expect(component.loading).toBeTrue();
  });
});

/**
 * c03: the three localized error labels must actually render.
 *
 * All three handlers used to read `err.message || this.label(...)`. BookService wraps nothing in catchError
 * and the app registers no HttpInterceptor (app.config.ts calls provideHttpClient() bare), so every error
 * reaching these handlers is an HttpErrorResponse whose `message` Angular ALWAYS generates non-empty. The
 * left operand was therefore always truthy: the labels were unreachable in BOTH maps, and the user was shown
 * a raw English transport string inside a Hebrew right-to-left card.
 *
 * These specs use a REAL HttpErrorResponse rather than a hand-rolled object, so the `message` under test is
 * the one Angular actually produces; a precondition on every case asserts it is populated, which is what
 * keeps the whole block from passing vacuously against a hypothetical empty-message error.
 *
 * Every request is answered through a Subject held open, and no bookId/language change happens between the
 * request and the error, so the c02 stale guard at the top of each handler PASSES and the assertions really
 * reach the message line.
 *
 * final-r02: the body cases assert the label wins over the SERVER STRING too, not just over the transport
 * string. This API has no user-presentable error body: every deliberate one is `{ error: "..." }` or a bare
 * string, none carries a `message` field, and all of them are English-only internal text written without
 * reference to the request language. Letting one through would reintroduce the same defect from the other
 * side, so the card shows the label whatever the body is and the body stays in the console.
 */
describe('BookDashboardComponent surfaces localized error messages, not transport text (c03)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let bookService: jasmine.SpyObj<BookService>;
  let profileLoads: Subject<BookProfileDto>[];
  let refreshes: Subject<BookProfileDto>[];

  const PROFILE_URL = 'http://localhost:5114/api/books/book-1/profile';

  function queued<T>(log: Subject<T>[]): Observable<T> {
    const subject = new Subject<T>();
    log.push(subject);
    return subject.asObservable();
  }

  /**
   * The error Angular really delivers for a 500: `message` is generated by the HttpErrorResponse
   * constructor as "Http failure response for <url>: 500 Internal Server Error".
   */
  function transportFailure(url: string, body: unknown = null): HttpErrorResponse {
    const err = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error', url, error: body });
    expect(err.message)
      .withContext('precondition: Angular populates message, so the old left operand was always truthy')
      .toContain('Http failure response');
    return err;
  }

  /** Bring the component up in the given language with its init profile load in flight. */
  function startIn(language: string): void {
    component.bookId = 'book-1';
    component.bookLanguage = language;
    fixture.detectChanges();
    expect(profileLoads.length).withContext('precondition: one profile load in flight').toBe(1);
  }

  beforeEach(async () => {
    profileLoads = [];
    refreshes = [];
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, getById: NEVER,
          }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        // Transitive dep of the hosted character-register child (character-register-editing c2).
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    bookService = TestBed.inject(BookService) as jasmine.SpyObj<BookService>;
    bookService.getProfile.and.callFake(() => queued(profileLoads));
    bookService.refreshProfile.and.callFake(() => queued(refreshes));
    // The handlers log the raw error for the developer surface; keep the Karma output readable and let the
    // diagnostic-preserved spec below assert on it.
    spyOn(console, 'error');
  });

  describe('loadProfile', () => {
    it('shows the Hebrew label, never the transport string, on a 500', () => {
      startIn('he');

      profileLoads[0].error(transportFailure(PROFILE_URL));

      expect(component.error).toBe('שגיאה בטעינת הפרופיל');
      expect(component.error).not.toContain('Http failure');
      expect(component.error).not.toContain('500');
    });

    it('shows the English label, never the transport string, on a 500', () => {
      startIn('en');

      profileLoads[0].error(transportFailure(PROFILE_URL));

      expect(component.error).toBe('Could not load the profile');
      expect(component.error).not.toContain('Http failure');
    });

    it('keeps the label even when the body carries the API error shape, which is English-only', () => {
      startIn('he');

      profileLoads[0].error(transportFailure(PROFILE_URL, { error: 'Server is shutting down; cannot start new build.' }));

      expect(component.error)
        .withContext('the API writes error bodies in English regardless of the request language')
        .toBe('שגיאה בטעינת הפרופיל');
    });

    it('falls back to the label when the body is a non-JSON string', () => {
      startIn('en');

      profileLoads[0].error(transportFailure(PROFILE_URL, 'Internal Server Error'));

      expect(component.error).toBe('Could not load the profile');
    });

    it('still renders the no-profile empty state on a 404 (the untouched branch)', () => {
      startIn('he');

      profileLoads[0].error(new HttpErrorResponse({ status: 404, statusText: 'Not Found', url: PROFILE_URL }));

      expect(component.profile).withContext('404 means no profile yet, not a failure').toBeNull();
      expect(component.error).withContext('the empty state must not render an error card').toBeNull();
      expect(component.loading).toBeFalse();
    });
  });
  // w5 (Q4-A): `describe('onRefresh')` LIVED HERE. Its three cases pinned that a failed profile refresh
  // shows a localized label rather than Angular's English transport string. This component no longer
  // issues that call, and the row that does reports the failure of the profile HALF specifically (so a
  // succeeded briefs build is not misreported as a total failure), covered in
  // `book-summary-status-row.component.spec.ts`. The loadProfile cases above are untouched.
  //
  // Wave 3 / w7 (Q5): `describe('onAsk')` LIVED HERE, with four cases parallel to loadProfile's. Same
  // reason again: the handler is gone with the ask card. `failureMessage` itself is unchanged and its
  // whole contract (always the localized label, never `err.message`, never a server body, raw error to
  // the console) is still asserted by the loadProfile block above and the diagnostic case below, which
  // is what those four were re-proving for a second caller.

  it('keeps the diagnostic on the developer surface: the raw error is logged, not shown', () => {
    startIn('he');
    const raw = transportFailure(PROFILE_URL);

    profileLoads[0].error(raw);

    expect(console.error)
      .withContext('the transport string is the only place the failed call status and URL are visible')
      .toHaveBeenCalledWith(jasmine.any(String), raw);
    expect(component.error).not.toContain(PROFILE_URL);
  });
});

/**
 * c03. THE REAL TRANSITION, not a first mount: a book whose language changes while the dashboard stays
 * mounted and both status rows already hold a loaded status.
 *
 * The hosted rows reset their context from `ngOnChanges`, which runs INSIDE this component's
 * change-detection pass. The reset nulls the row's status, the row publishes it, and this host assigns a
 * new `spineSignals` object - a binding that `<app-stage-spine>` (declared ABOVE the rows in the template)
 * has already been checked against in the same pass.
 *
 * PREMISE CORRECTION, measured here: this does NOT throw NG0100 on the shipped template. Angular's
 * dev-mode verification pass compares with `devModeEqual`, which treats any two non-iterable objects as
 * equal, and `spineSignals` is an object - so the verification tolerates it. What is observable is the
 * write itself: the mounted spine is left holding an object the host has already replaced, and nothing in
 * this pass corrects it. That is what these cases assert, plus the row-level rule (in the two row specs)
 * that the publish must land outside the pass at all, which is what keeps the first primitive the host
 * ever derives from a row status from turning this into a hard error.
 *
 * The `===` early-return in each row's status setter is what keeps a FIRST MOUNT quiet (null -> null does
 * not publish), which is why no happy-path spec saw this. These cases load a status first, so the reset is
 * a real value change, and then drive the switch the way the editor does.
 */
describe('BookDashboardComponent survives an in-session language change with loaded row statuses (c03)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  /** One entry per hosted-row status GET, in issue order, each answerable on demand. */
  let summaryStatusReads: Subject<BookSummaryStatusDto>[];
  let reviewStatusReads: Subject<BookReviewStatusDto>[];

  function queued<T>(log: Subject<T>[]): Observable<T> {
    const subject = new Subject<T>();
    log.push(subject);
    return subject.asObservable();
  }

  function summaryStatus(language: string): BookSummaryStatusDto {
    return {
      bookId: 'book-1', language, totalChapters: 3, builtChapters: 3, staleCount: 0,
      hasSummary: true, ready: true, lastUpdatedAt: new Date().toISOString(),
      builtWithDifferentModel: false, summaryCoversBuiltChapters: true, activeBuildJobId: null,
      chaptersToBuild: 0, estimatedSeconds: 0, estimatedUsd: null,
    };
  }

  function reviewStatus(language: string): BookReviewStatusDto {
    return {
      bookId: 'book-1', language, hasReview: true, findingCount: 4, openFindingCount: 4,
      resolvedFindingCount: 0, lastUpdatedAt: new Date().toISOString(), builtWithDifferentModel: false,
      staleVsBriefs: false, hasBriefs: true, activeBuildJobId: null, ready: true,
      chaptersReviewed: 3, chaptersTotal: 3, windowCount: 0, ranSynthesis: false,
      ranContinuityReduce: false, failedWindows: 0,
    };
  }

  /** Rebind [bookLanguage] the way the editor host does: set the input, then run ngOnChanges. */
  function switchLanguageTo(next: string): void {
    const previous = component.bookLanguage;
    component.bookLanguage = next;
    component.ngOnChanges({ bookLanguage: new SimpleChange(previous, next, false) });
  }

  beforeEach(async () => {
    summaryStatusReads = [];
    reviewStatusReads = [];
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, getById: NEVER,
          }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        {
          provide: BookSummaryService,
          useValue: {
            getBookSummaryStatus: () => queued(summaryStatusReads),
            buildBookSummary: () => NEVER,
          },
        },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => queued(reviewStatusReads), buildReview: () => NEVER,
            getReviewProgress: () => NEVER, getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    localStorage.removeItem('pd:dashboard-collapse:book-1');
    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('pd:dashboard-collapse:book-1');
  });

  /** Answer both hosted rows' Hebrew status reads OUTSIDE a change-detection pass, as real HTTP does. */
  function loadHebrewStatuses(): void {
    expect(summaryStatusReads.length)
      .withContext('precondition: the mounted briefs row issued its status read')
      .toBe(1);
    expect(reviewStatusReads.length)
      .withContext('precondition: the mounted review row issued its status read')
      .toBe(1);
    summaryStatusReads[0].next(summaryStatus('he'));
    reviewStatusReads[0].next(reviewStatus('he'));
    fixture.detectChanges();
    expect(component.spineSignals.summary)
      .withContext('precondition: the spine holds the briefs payload, so the reset is a real value change')
      .not.toBeNull();
    expect(component.spineSignals.review)
      .withContext('precondition: the spine holds the review payload, so the reset is a real value change')
      .not.toBeNull();
  }

  it('leaves the mounted spine holding the signals the host actually has, not an object superseded mid-pass', () => {
    loadHebrewStatuses();

    switchLanguageTo('en');
    fixture.detectChanges();

    const spine = fixture.debugElement.query(By.css('app-stage-spine'))
      .componentInstance as { signals: unknown };
    expect(spine.signals)
      .withContext('a row that publishes from ngOnChanges rewrites this binding after the spine was checked against it')
      .toBe(component.spineSignals);

    // The verification half of a dev-mode tick, run explicitly (the fixture's detectChanges() does not run
    // it in this Angular version). It tolerates an object-to-object change, so it cannot catch the defect
    // above on its own - it is here as the guard for the day a primitive above the rows derives from a
    // row status, which is the same write with a harder failure mode.
    expect(() => fixture.checkNoChanges()).not.toThrow();
  });

  it('leaves the spine describing the NEW language rather than the previous one', async () => {
    loadHebrewStatuses();

    switchLanguageTo('en');
    fixture.detectChanges();
    // The deferred publish drains on the microtask queue, i.e. after the pass that would have thrown.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.spineSignals.summary)
      .withContext('the Hebrew briefs payload must not survive into the English page')
      .toBeNull();
    expect(component.spineSignals.review)
      .withContext('the Hebrew review payload must not survive into the English page')
      .toBeNull();
    expect(summaryStatusReads.length)
      .withContext('the row re-read its status for the new language')
      .toBe(2);
    expect(reviewStatusReads.length).toBe(2);
  });

  /**
   * The English answers land after the switch: the spine must end up describing them. Proves the deferred
   * reset publish cannot clobber a status that arrives before it drains (it re-reads the row's CURRENT
   * status rather than replaying the null it was scheduled with).
   */
  it('publishes the NEW language status even when it answers before the deferred reset drains', async () => {
    loadHebrewStatuses();

    switchLanguageTo('en');
    fixture.detectChanges();
    summaryStatusReads[1].next(summaryStatus('en'));
    reviewStatusReads[1].next(reviewStatus('en'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.spineSignals.summary?.language)
      .withContext('a stale null from the context reset must never overwrite the answer for the new language')
      .toBe('en');
    expect(component.spineSignals.review?.language).toBe('en');
  });
});

// ─── c07 finding 19: the per-chapter running mark is scoped to CHAPTER_SCOPED_KINDS ──────────────────
describe('BookDashboardComponent finding 19: the chapter breakdown reads an explicit kind allowlist', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let activeJobs$: BehaviorSubject<TrackedJob[]>;

  function job(overrides: Partial<TrackedJob> = {}): TrackedJob {
    return {
      id: 'j', kind: 'proofread', bookId: 'book-1', scopeLabel: 'פרק', titleHe: 'הגהה', titleEn: 'Proofread',
      status: 'running', percent: 10, completedChunks: null, totalChunks: null, chunkClock: EMPTY_CHUNK_CLOCK,
      message: '', startedAt: '', updatedAt: '', ...overrides,
    };
  }

  beforeEach(async () => {
    // A live BehaviorSubject, held open, so a test can push a second snapshot AFTER the component has
    // already mounted and subscribed - mirrors RegistryStub.active in editor-page.component.spec.ts.
    activeJobs$ = new BehaviorSubject<TrackedJob[]>([]);
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        // w6: the first-run orientation panel reads the served guides through GuidesService, which
        // injects HttpClient. Stubbed in EVERY TestBed in this file rather than only in the ones that
        // render the panel: the "new constructor dep breaks the TestBed" trap names the transitive dep
        // (HttpClient), not the component that introduced it, so a future test that happens to open the
        // panel would fail somewhere that reads nothing like this change.
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$, jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', { getProfile: NEVER, refreshProfile: NEVER, getById: NEVER }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: { watch: () => NEVER, refresh: () => NEVER, get: () => NEVER, setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER },
        },
      ],
    }).compileComponents();

    localStorage.removeItem('pd:dashboard-collapse:book-1');
    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.chapters = [
      { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 10, updatedAt: '' },
      { id: 'ch-2', title: 'Two', partName: null, order: 1, wordCount: 10, updatedAt: '' },
    ];
    fixture.detectChanges();
  });

  /**
   * Verified independently before this fix (not just trusted from the review): today only `proofread`
   * ever carries a `chapterId` - `job-registry.service.ts`'s `analysisJobToSource` (the ONLY place a
   * `TrackedJob.chapterId` is ever set from a reattach) hardcodes `kind: 'proofread'`, and the three
   * book-level reattach sources (summary/review/style-baseline) never set `chapterId` at all. So this
   * exact scenario - a NON-proofread kind carrying a chapterId - cannot happen in the shipped product
   * today. It is exactly the scenario `CHAPTER_SCOPED_KINDS` exists to guard against: a future kind that
   * starts carrying a chapterId without this reader being updated to know about it. Fails on the reverted
   * code, which read the bare presence of `chapterId` with no kind check at all (the twin of the
   * editor-page.component.spec.ts regression test for the same finding).
   */
  it('ignores a chapterId on a job whose kind is not in CHAPTER_SCOPED_KINDS', () => {
    activeJobs$.next([
      job({ id: 'j-1', kind: 'proofread', chapterId: 'ch-1' }),
      job({ id: 'j-2', kind: 'style-baseline', titleHe: 'סגנון', titleEn: 'Style', chapterId: 'ch-2' }),
    ]);

    const running = component.spineSignals.chapters?.filter(c => c.running).map(c => c.chapterId);
    expect(running).toEqual(['ch-1']);
  });
});

// ─── Wave 3 / w6 (Q10-D): the first-run orientation lifecycle ────────────────────────────────────────
//
// The panel itself is pinned by `first-run-orientation.component.spec.ts`. What is pinned HERE is the
// half the page owns and the panel cannot see: WHEN it is offered, that a dismissal is permanent and per
// book, that the re-open affordance survives that dismissal, and that a status which has not arrived is
// never read as "no builds".
describe('BookDashboardComponent w6: first-run orientation', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  /**
   * The two status reads the hosted rows issue, as Subjects that stay OPEN. Reassignable, because a
   * Subject that has errored is dead and the retry path re-subscribes; the service stubs read the
   * variable at call time, so a fresh Subject assigned before a retry is the one that retry gets.
   */
  let summaryStatus$: Subject<BookSummaryStatusDto>;
  let reviewStatus$: Subject<BookReviewStatusDto>;

  function w6Summary(overrides: Partial<BookSummaryStatusDto> = {}): BookSummaryStatusDto {
    return {
      bookId: 'book-1', language: 'he', totalChapters: 2, builtChapters: 0, staleCount: 0,
      hasSummary: false, ready: false, lastUpdatedAt: null, builtWithDifferentModel: false,
      summaryCoversBuiltChapters: true, activeBuildJobId: null, chaptersToBuild: 2,
      estimatedSeconds: 0, estimatedUsd: null, ...overrides,
    };
  }

  function w6Review(overrides: Partial<BookReviewStatusDto> = {}): BookReviewStatusDto {
    return {
      bookId: 'book-1', language: 'he', hasReview: false, findingCount: 0, openFindingCount: 0,
      resolvedFindingCount: 0, lastUpdatedAt: null, builtWithDifferentModel: false,
      staleVsBriefs: false, hasBriefs: false, activeBuildJobId: null, ready: false,
      chaptersReviewed: 0, chaptersTotal: 2, windowCount: 0, ranSynthesis: false,
      ranContinuityReduce: false, failedWindows: 0, ...overrides,
    };
  }

  /** Deliver both statuses, which is what unlocks the orientation decision. */
  function landStatuses(summary = w6Summary(), review = w6Review()): void {
    component.onSummaryStatusChange(summary);
    component.onReviewStatusChange(review);
    fixture.detectChanges();
  }

  function panel() {
    return fixture.debugElement.query(By.css('[data-testid="first-run-orientation"]'));
  }

  function reopenBtn(): HTMLElement {
    return fixture.debugElement.query(By.css('[data-testid="dashboard-orientation-btn"]'))
      .nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    localStorage.removeItem(orientationStorageKey('book-1'));
    localStorage.removeItem(orientationStorageKey('book-2'));
    summaryStatus$ = new Subject<BookSummaryStatusDto>();
    reviewStatus$ = new Subject<BookReviewStatusDto>();

    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', { getProfile: NEVER, refreshProfile: NEVER, getById: NEVER }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        // An un-fed Subject behaves exactly like the NEVER these were: the read is issued and stays
        // outstanding, which is the state every test below that does not touch it relies on.
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => summaryStatus$, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => reviewStatus$, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.chapters = [];
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(orientationStorageKey('book-1'));
    localStorage.removeItem(orientationStorageKey('book-2'));
  });

  // ── FIRST VISIT ──────────────────────────────────────────────────────────────────────────────────

  it('offers the panel on a first visit to a book with no builds', () => {
    expect(panel()).withContext('nothing may be decided before the statuses land').toBeNull();

    landStatuses();

    expect(panel()).toBeTruthy();
  });

  /**
   * THE NULL RULE, the same one the spine derives its stages by: a status that has not arrived is the
   * ABSENCE of an answer, never the answer "nothing is built". Judging first-run off an unarrived payload
   * would flash the panel over a fully built book on every page load.
   */
  it('decides nothing while either status is still unknown', () => {
    component.onSummaryStatusChange(w6Summary());
    fixture.detectChanges();
    expect(panel()).withContext('one status is not both').toBeNull();

    component.onReviewStatusChange(w6Review());
    fixture.detectChanges();
    expect(panel()).toBeTruthy();
  });

  // ── A READ THAT FAILED IS NOT A READ THAT HAS NOT ANSWERED (w6 fixes c01) ────────────────────────
  //
  // Both status rows used to publish NOTHING when their status GET failed, so the host's payload stayed
  // null for the life of the mount and the decision deferred forever - on the one book the panel exists
  // for, in a state that renders exactly like a decided-closed one, which is why nothing surfaced it.
  //
  // These drive the REAL rows over Subjects held OPEN across the assertions. A synchronous `of()` or
  // `throwError()` would collapse the very window the defect lives in: the point is the interval during
  // which one half has answered and the other has not, and what the page concludes when the second half
  // ends in a failure instead of an answer.

  it('resolves the decision when a status read FAILS, instead of deferring it forever', () => {
    reviewStatus$.next(w6Review());
    fixture.detectChanges();
    expect(component.orientationDecided)
      .withContext('the briefs read is still outstanding, so there is nothing to decide from')
      .toBeFalse();

    summaryStatus$.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();

    expect(component.orientationDecided)
      .withContext('the briefs read is OVER and it failed, so the question has its answer')
      .toBeTrue();
    expect(panel())
      .withContext('and the answer is NOT offered: an unreadable book may well be a built one')
      .toBeNull();
  });

  /** The review row is the worse half: it renders nothing on a failed read, so it is silent on both ends. */
  it('resolves the decision when it is the REVIEW read that fails', () => {
    summaryStatus$.next(w6Summary());
    fixture.detectChanges();
    expect(component.orientationDecided).toBeFalse();

    reviewStatus$.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();

    expect(component.orientationDecided).toBeTrue();
    expect(panel()).toBeNull();
  });

  /**
   * THE OTHER DIRECTION, and the one the fix must not trade away: a read that has simply not come back
   * yet still decides nothing. The window is held open by an un-fed Subject for the whole assertion,
   * exactly as a slow network holds it open in the product.
   */
  it('still defers while a status is merely outstanding, and resolves when it lands', () => {
    reviewStatus$.next(w6Review());
    fixture.detectChanges();

    expect(component.orientationDecided)
      .withContext('an outstanding read is the ABSENCE of an answer, never the answer "nothing is built"')
      .toBeFalse();
    expect(panel()).toBeNull();

    summaryStatus$.next(w6Summary());
    fixture.detectChanges();

    expect(component.orientationDecided).toBeTrue();
    expect(panel()).withContext('both halves answered, and both say untouched').toBeTruthy();
  });

  /**
   * The not-offered answer taken on an unreadable half is PROVISIONAL: it was taken under a fault the
   * row offers a retry for. This is behavior the page had BEFORE the fix (the state was still undecided
   * when the retry answered), so resolving the decision must not cost it.
   */
  it('re-takes the decision when the failed read is retried and answers', () => {
    reviewStatus$.next(w6Review());
    summaryStatus$.error(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
    fixture.detectChanges();
    expect(panel()).toBeNull();

    // The briefs row's own retry control re-issues the same read; give it a live Subject to land on.
    summaryStatus$ = new Subject<BookSummaryStatusDto>();
    component.summaryRow!.loadBookSummaryStatus();
    summaryStatus$.next(w6Summary());
    fixture.detectChanges();

    expect(panel())
      .withContext('the retry answered, and it says the book is untouched: this IS a first run')
      .toBeTruthy();
  });

  it('does not offer the panel on a book that already has briefs', () => {
    landStatuses(w6Summary({ hasSummary: true }), w6Review());
    expect(panel()).withContext('briefs exist, so this is not a first run').toBeNull();
  });

  it('does not offer the panel on a book whose review exists', () => {
    landStatuses(w6Summary(), w6Review({ hasReview: true }));
    expect(panel()).toBeNull();
  });

  /**
   * It does not vanish under the author because a build they started while reading it finished. Builds
   * take minutes and the panel must survive them; a panel that disappeared mid-sentence would be the
   * blocking failure Q10 constraint names, in its other direction.
   */
  it('stays open once offered, even after the book gains a build', () => {
    landStatuses();
    expect(panel()).toBeTruthy();

    landStatuses(w6Summary({ hasSummary: true }), w6Review({ hasBriefs: true }));

    expect(panel()).toBeTruthy();
  });

  // ── DISMISS, AND RE-OPEN ─────────────────────────────────────────────────────────────────────────

  it('dismisses permanently, per book, and remembers it in storage', () => {
    landStatuses();
    expect(panel()).toBeTruthy();

    component.onOrientationDismissed();
    fixture.detectChanges();

    expect(panel()).toBeNull();
    expect(localStorage.getItem(orientationStorageKey('book-1'))).toBe('1');
  });

  it('does not offer the panel again on a book that was already dismissed', () => {
    localStorage.setItem(orientationStorageKey('book-1'), '1');

    landStatuses();

    expect(panel()).toBeNull();
  });

  /**
   * THE FAILURE MODE THE BRIEF NAMES for option C, "undiscoverable when they want it back". The re-open
   * control is in the header, in every state, and it works after a permanent dismissal.
   */
  it('keeps a visible re-open affordance, and it works after the dismissal', () => {
    landStatuses();
    component.onOrientationDismissed();
    fixture.detectChanges();
    expect(panel()).toBeNull();

    expect(reopenBtn()).withContext('the re-open control must survive the dismissal').toBeTruthy();
    reopenBtn().click();
    fixture.detectChanges();

    expect(panel()).toBeTruthy();
  });

  it('shows the re-open affordance even before any status has landed', () => {
    expect(panel()).toBeNull();
    expect(reopenBtn()).toBeTruthy();
    expect(reopenBtn().textContent!.trim().length).toBeGreaterThan(0);
  });

  /** A second book is a second first run: the flag is keyed per book and the decision is re-taken. */
  it('re-decides on a book switch, so a dismissal on one book does not silence another', () => {
    landStatuses();
    component.onOrientationDismissed();
    fixture.detectChanges();
    expect(panel()).toBeNull();

    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    fixture.detectChanges();
    expect(panel()).withContext('undecided until the new book answers').toBeNull();

    landStatuses(w6Summary({ bookId: 'book-2' }), w6Review({ bookId: 'book-2' }));

    expect(panel()).toBeTruthy();
  });

  // ── The guide pointers this page owns ────────────────────────────────────────────────────────────

  it('raises ONE output for both guide entry points, carrying the book language', () => {
    const opened: { guideId: string; lang: string }[] = [];
    component.openGuide.subscribe(e => opened.push(e));

    component.onOpenGuide('workflow-overview');
    component.onSpineOpenGuide(stageGuideLink('briefs'));

    expect(opened).toEqual([
      { guideId: 'workflow-overview', lang: 'he' },
      { guideId: 'book-setup-and-intelligence', lang: 'he' },
    ]);
  });

  it('opens a guide in an ENGLISH book in English, leaving the reader default alone', () => {
    const opened: { guideId: string; lang: string }[] = [];
    component.bookLanguage = 'en';
    component.openGuide.subscribe(e => opened.push(e));

    component.onSpineOpenGuide(stageGuideLink('export'));

    expect(opened).toEqual([{ guideId: 'export', lang: 'en' }]);
  });

  // ── Chatbot phase B: a citation chip's focus request lands on a real surface ───────────────────────
  //
  // Without these the chips would navigate to the book page and stop there, which is the exact
  // "half-dead chip" the todo rules out. The assertions are on the mechanisms the dashboard ALREADY
  // owns (the review-mode output, the review tab, the open tokens), because that is the rule this
  // handler follows: a chip must not open a second way of doing something a surface already owns.

  describe('a citation chip asked for a surface', () => {
    let focus: BookSurfaceFocusService;
    let switched: number;

    beforeEach(() => {
      focus = TestBed.inject(BookSurfaceFocusService);
      switched = 0;
      component.switchToReview.subscribe(() => switched++);
    });

    it('the FINDINGS ledger: review mode, the findings tab', () => {
      component.reviewTab = 'bible';
      focus.request({ target: 'findings' });
      expect(switched).toBe(1);
      expect(component.reviewTab).toBe('findings');
    });

    it('the BOOK BRIEF: review mode, the Story Bible tab beside the ledger', () => {
      component.reviewTab = 'findings';
      focus.request({ target: 'story-bible' });
      expect(switched).toBe(1);
      expect(component.reviewTab).toBe('bible');
    });

    it('the per-chapter BRIEFS: review mode, and the collapsed section is asked to open', () => {
      const before = component.inputsOpenToken;
      focus.request({ target: 'chapter-briefs' });
      expect(switched).toBe(1);
      expect(component.inputsOpenToken).toBe(before + 1);
    });

    it('the character REGISTER: review mode, and its collapsed section is asked to open', () => {
      const before = component.registerOpenToken;
      focus.request({ target: 'register' });
      expect(switched).toBe(1);
      expect(component.registerOpenToken).toBe(before + 1);
    });

    it('a STATUS: review mode, for every one of the three stages', () => {
      for (const stage of ['summary', 'review', 'style-baseline'] as const) {
        focus.request({ target: 'status', stage });
      }
      expect(switched).toBe(3);
    });

    it('a CHAPTER is not this component\'s to answer, so it does nothing here', () => {
      // A chapter's text lives in the editor; the host consumes that one before it reaches the service.
      const tab = component.reviewTab;
      focus.request({ target: 'chapter', chapterOrder: 6 });
      expect(switched).toBe(0);
      expect(component.reviewTab).toBe(tab);
    });

    it('stops listening once destroyed, so a torn-down dashboard cannot be driven', () => {
      component.ngOnDestroy();
      focus.request({ target: 'findings' });
      expect(switched).toBe(0);
    });
  });

  // ── c01: the deep link has to land on the FIRST (cold) click ──────────────────────────────────────
  //
  // Review finding #4, measured live at a 900px viewport: the findings heading sat at `top: 1442` on the
  // first click (the dashboard was not mounted when the chip was pressed) and at `top: 556` on the
  // second, and a cold `?focus=register` left the register card at `top: 3691` WITH ITS SECTION
  // CORRECTLY EXPANDED. The mode switch, the open token and the anchor were all already right; the
  // scroll was measured against a page that had not been built yet and the arriving content then pushed
  // the anchor out from under it.
  //
  // THESE TESTS DRIVE THE WINDOW RATHER THAN COLLAPSING IT. The profile GET is a Subject held OPEN
  // across the assertions, so "the content is still arriving" is a state each case OCCUPIES. A
  // synchronous `of()` would deliver every byte before the request was ever made, which makes the
  // broken one-shot scroll pass: the old code lands correctly whenever the page is already complete,
  // and that is precisely the second click, the one that does not matter.
  describe('c01: a cold deep link lands on the surface it cites', () => {
    let focus: BookSurfaceFocusService;
    let profile$: Subject<BookProfileDto>;

    /** What one scrollIntoView call saw at the moment it was made. */
    interface ScrollObservation {
      /** Total rendered height of the scroll container - the number late content moves. */
      height: number;
      /** Whether the held-open profile had already rendered its cards. */
      contentLanded: boolean;
      /** Whether the character register's collapsed section was already unfolded. */
      registerExpanded: boolean;
    }

    beforeEach(() => {
      // The outer fixture already spent its init load against the default NEVER, so build a fresh
      // dashboard whose profile GET is a Subject this spec owns.
      fixture.destroy();
      profile$ = new Subject<BookProfileDto>();
      (TestBed.inject(BookService).getProfile as jasmine.Spy).and.returnValue(profile$.asObservable());
      fixture = TestBed.createComponent(BookDashboardComponent);
      component = fixture.componentInstance;
      component.bookId = 'book-1';
      component.bookLanguage = 'he';
      fixture.detectChanges();
      focus = TestBed.inject(BookSurfaceFocusService);
    });

    /**
     * A profile rich enough that rendering it REALLY changes the page's height: the four cards replace a
     * one-line loading hint. Karma runs a real Chrome and the TestBed applies this component's own
     * styles, so the heights recorded below are measured layout, not a stubbed number.
     */
    function loadedProfile(): BookProfileDto {
      return {
        genre: 'מתח',
        synopsis: 'סינופסיס ארוך למדי. '.repeat(40),
        charactersJson: JSON.stringify({
          characters: [
            { name: 'רות', role: 'protagonist', description: 'תיאור ארוך של הדמות הראשית. '.repeat(10) },
            { name: 'דן', role: 'antagonist', description: 'תיאור ארוך של היריב. '.repeat(10) },
          ],
          relationships: [{ from: 'רות', to: 'דן', type: 'יריבות', description: 'סכסוך' }],
        }),
        storyStructureJson: null,
      } as unknown as BookProfileDto;
    }

    /**
     * Record what every scrollIntoView on `anchor` saw. The ordering property the fix guarantees is
     * stated in terms of these observations: the FIRST request is made after the openToken expansion has
     * been applied, and the LAST request is made against a page that already carries the late content
     * (a strictly greater container height).
     */
    function watchAnchor(anchor: 'findingsAnchor' | 'registerAnchor'): ScrollObservation[] {
      const seen: ScrollObservation[] = [];
      const el = (component as unknown as Record<string, { nativeElement: HTMLElement }>)[anchor].nativeElement;
      const root = fixture.nativeElement as HTMLElement;
      spyOn(el, 'scrollIntoView').and.callFake(() => {
        seen.push({
          height: (root.querySelector('.book-dashboard') as HTMLElement).scrollHeight,
          contentLanded: !!root.querySelector('.overview-card'),
          registerExpanded: !!root.querySelector('[data-testid="collapse-body-character-register"]'),
        });
      });
      return seen;
    }

    it('the FINDINGS ledger: the scroll is re-asserted once the page\'s late content has landed', () => {
      const seen = watchAnchor('findingsAnchor');

      focus.request({ target: 'findings' });
      fixture.detectChanges();

      // The cold click still scrolls straight away - a deep link must not feel deferred - but it is
      // scrolling a page that is still a skeleton, which is exactly the measured defect.
      expect(seen.length).withContext('the cold click must scroll at once').toBe(1);
      expect(seen[0].contentLanded)
        .withContext('the held-open profile has deliberately NOT arrived yet').toBeFalse();

      // The load lands. On the live page this is one of eight such arrivals (the two status rows, the
      // spine, the orientation panel, the ledger, the register and the baseline row are the others);
      // it is the one a TestBed can hold open deterministically.
      profile$.next(loadedProfile());
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.overview-card'))
        .withContext('the content really did land').not.toBeNull();
      expect(seen.length)
        .withContext('arriving content must re-aim the scroll, not silently invalidate it')
        .toBeGreaterThan(1);
      const last = seen[seen.length - 1];
      expect(last.contentLanded)
        .withContext('the LAST scroll must be measured against the loaded page').toBeTrue();
      expect(last.height)
        .withContext('and against a taller page than the first scroll saw').toBeGreaterThan(seen[0].height);
    });

    it('the character REGISTER: its collapsed section is unfolded BEFORE the first scroll is measured', () => {
      // This target is strictly worse than `findings`, and this is why: its openToken expansion is
      // applied on the change-detection pass AFTER the request, so a scroll taken inline with the
      // request is measured against a page that is still missing the height the unfolded section adds.
      const seen = watchAnchor('registerAnchor');
      expect(fixture.nativeElement.querySelector('[data-testid="collapse-body-character-register"]'))
        .withContext('the register section starts folded, which is the whole difficulty').toBeNull();

      focus.request({ target: 'register' });
      fixture.detectChanges();

      expect(seen.length).toBe(1);
      expect(seen[0].registerExpanded)
        .withContext('expansion must be ordered BEFORE the first measurement').toBeTrue();

      profile$.next(loadedProfile());
      fixture.detectChanges();

      expect(seen.length)
        .withContext('and the late content must re-aim it too').toBeGreaterThan(1);
      expect(seen[seen.length - 1].height)
        .withContext('the last scroll must see a taller page than the first').toBeGreaterThan(seen[0].height);
    });

    it('a book switch drops the held scroll, so the NEXT book\'s arriving content is not scrolled by '
      + 'the previous book\'s chip', () => {
      const seen = watchAnchor('findingsAnchor');
      focus.request({ target: 'findings' });
      fixture.detectChanges();
      expect(seen.length).toBe(1);

      // The editor switches book in place; resetOwnState() drops the previous book's transient state.
      const previous = component.bookId;
      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange(previous, 'book-2', false) });

      // Book 2's profile arrives on the re-issued GET (the same Subject stub) and grows the page.
      profile$.next(loadedProfile());
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.overview-card')).not.toBeNull();
      expect(seen.length)
        .withContext('a focus is a gesture about ONE book and must not survive the switch').toBe(1);
    });

    it('the correction window is BOUNDED, so content arriving long afterwards is not scrolled', fakeAsync(() => {
      const seen = watchAnchor('findingsAnchor');
      focus.request({ target: 'findings' });
      fixture.detectChanges();
      expect(seen.length).toBe(1);

      // Past the ceiling. Nothing was waiting on this timer - the scroll above already happened - it
      // only stops the page from re-aiming at a surface the author asked for in another context.
      tick(5000);
      profile$.next(loadedProfile());
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.overview-card')).not.toBeNull();
      expect(seen.length)
        .withContext('past the ceiling the window is closed and must not re-aim the scroll').toBe(1);
      flush();
    }));
  });
});

/**
 * ── Wave 3 / w7 (Q5): THE ASK CARD IS GONE, AND A POINTER TO SHOW STANDS WHERE IT STOOD ───────────
 *
 * The card had an input, a send button, an in-flight line, an answer block and a citation strip; Show
 * is the ask surface now. What replaces it is deliberately NOT a second ask box: it is a sentence and
 * a button that opens the dock, kept at the old address for one release so the capability is
 * discoverable where the author last saw it.
 *
 * Everything here is asserted against the RENDERED dashboard rather than against the component's
 * fields, because "the handler is deleted" and "the affordance is off the screen" are different
 * claims and only the second one is the removal. Both languages and both directions, since the
 * dashboard is book-scoped chrome.
 *
 * The card only rendered once a profile had loaded, and so does the pointer, so this TestBed answers
 * `getProfile` rather than leaving it open the way most suites in this file do.
 */
describe('BookDashboardComponent - the ask card is gone and Show is pointed to (w7)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let overlays: AppOverlayService;

  const profile = {
    genre: 'Fantasy',
    synopsis: null,
    charactersJson: null,
    storyStructureJson: null,
  } as unknown as BookProfileDto;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        { provide: GuidesService, useValue: { get: () => NEVER, list: () => NEVER } },
        {
          provide: JobRegistryService,
          useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]), jobs$: of([]) }),
        },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', { getProfile: of(profile), refreshProfile: NEVER, getById: NEVER }),
        },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER } },
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER,
            getReviewFindings: () => NEVER, patchFindingStatus: () => NEVER,
          },
        },
        { provide: AnalysisProgressService, useValue: { pollBookSummaryProgress: () => NEVER } },
        {
          provide: ChapterSummaryService,
          useValue: { getChapterSummary: () => NEVER, updateChapterSummary: () => NEVER, rederiveChapterSummary: () => NEVER },
        },
        { provide: CharacterRegisterService, useValue: { getRegister: () => NEVER, applyEdits: () => NEVER } },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    // The REAL dock state owner, so "the button opens Show" is a fact about the surface the launcher
    // opens rather than about a spy nobody reads.
    overlays = TestBed.inject(AppOverlayService);

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.chapters = [];
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(orientationStorageKey('book-1'));
  });

  // ── (a) the card ────────────────────────────────────────────────────────────────────────────────

  it('renders no ask card, and no free-text input in the region the ask card used to occupy', () => {
    // A RENDERED precondition, not a component-state one: a template that drew nothing at all below
    // the `@else` would still satisfy `component.profile` being truthy, so assert the region the ask
    // card stood in actually rendered something (finding C6). `.show-pointer-card` is what replaced
    // the card at that address (see the note at the template).
    const region = fixture.debugElement.query(By.css('.show-pointer-card'));
    expect(region)
      .withContext('precondition: the profile-loaded branch actually rendered the region the card stood in')
      .toBeTruthy();

    // Scoped to that region rather than swept over the whole fixture (finding C5): a query over the
    // entire fixture would also catch an unrelated future input elsewhere on the page (the character
    // register, for instance) and fail this w7-removal test while naming the ask card.
    expect(region.query(By.css('.ask-card')))
      .withContext('the ask card is removed')
      .toBeNull();
    expect(region.query(By.css('.ask-input')))
      .withContext('its question input is removed')
      .toBeNull();
    expect(region.query(By.css('input[type="text"]')))
      .withContext('the ask card\'s former region has no free-text input left in it')
      .toBeNull();
  });

  // `carries none of the ask card's strings in either language map` (finding C6) is deleted, not
  // strengthened: DASHBOARD_LABELS_HE/EN are typed `Record<DashboardLabelKey, string>` over a closed
  // union, so a leftover retired key is already a compile error and this assertion could never fail at
  // runtime without also failing to build. The removal (above) and the compiler between them are the
  // coverage; this test named neither a rendered fact nor anything the type system does not already
  // guarantee.

  // ── the pointer, in both languages and both directions ──────────────────────────────────────────

  it('renders the Show pointer in Hebrew, right to left', () => {
    const card = fixture.debugElement.query(By.css('.show-pointer-card'));
    expect(card).withContext('the pointer must stand where the ask card stood').toBeTruthy();

    expect(card.query(By.css('.show-pointer-title')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_HE.title);
    expect(card.query(By.css('.show-pointer-body')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_HE.dashboardBody);

    const button = card.query(By.css('.show-pointer-btn'));
    expect(button.nativeElement.textContent.trim()).toBe(SHOW_POINTER_STRINGS_HE.open);
    expect(button.nativeElement.getAttribute('aria-label')).toBe(SHOW_POINTER_STRINGS_HE.openAria);

    expect(fixture.debugElement.query(By.css('.book-dashboard')).nativeElement.getAttribute('dir'))
      .withContext('a Hebrew book renders the page, and so the pointer, right to left')
      .toBe('rtl');
  });

  it('renders the Show pointer in English, left to right', () => {
    component.bookLanguage = 'en';
    fixture.detectChanges();

    const card = fixture.debugElement.query(By.css('.show-pointer-card'));
    expect(card.query(By.css('.show-pointer-title')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_EN.title);
    expect(card.query(By.css('.show-pointer-body')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_EN.dashboardBody);

    expect(fixture.debugElement.query(By.css('.book-dashboard')).nativeElement.getAttribute('dir'))
      .toBe('ltr');
  });

  it('opens the dock on the assistant tab, and does not block the page it was used from', () => {
    expect(overlays.isOpen).withContext('precondition: the dock starts closed').toBeFalse();

    fixture.debugElement.query(By.css('.show-pointer-btn')).nativeElement.click();

    expect(overlays.isOpen).withContext('the pointer must OPEN Show, not merely name it').toBeTrue();
    expect(overlays.activeTab).toBe('assistant');
    // Not a modal, not a takeover: the dashboard is still mounted and still rendering its own content.
    expect(fixture.debugElement.query(By.css('.overview-card'))).toBeTruthy();
  });

  // ── C9: one shared string set, two visual weights ───────────────────────────────────────────────
  //
  // The SAME pointer content sits in two slots (here, and the analysis panel). Before this fix the
  // dashboard's copy carried a heading that was a peer of the page <h3> title and a filled-primary
  // button, making it the strongest call to action on the page, while the panel's copy was a quiet
  // outline button under a body-sized heading. One shared string set must not read two different ways.

  it('uses an h4 heading, a peer of the settings row\'s heading, not h3 (C9)', () => {
    const card = fixture.debugElement.query(By.css('.show-pointer-card'));
    const heading = card.query(By.css('.show-pointer-title')).nativeElement as HTMLElement;
    expect(heading.tagName.toLowerCase())
      .withContext('the pointer is one card among several, not a second page title; .settings-heading, the sibling section heading further down this page, is h4')
      .toBe('h4');
  });

  it('gives the button the quiet outline weight, not the filled-primary CTA style (C9)', () => {
    const button = fixture.debugElement.query(By.css('.show-pointer-btn')).nativeElement as HTMLElement;
    const style = getComputedStyle(button);
    expect(parseFloat(style.borderWidth))
      .withContext('a quiet outline button carries a visible border; the filled-primary style this replaces used border: none, making a pointer to a discovery surface the strongest CTA on the dashboard')
      .toBeGreaterThan(0);
  });
});
