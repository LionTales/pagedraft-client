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
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NEVER, Observable, Subject, of } from 'rxjs';
import { BookProfileDto } from '../../core/models/book';
import {
  BookDashboardComponent,
  DASHBOARD_LABELS_EN,
  DASHBOARD_LABELS_HE,
  DashboardLabelKey,
} from './book-dashboard.component';
import { BookReviewStatusDto, ChapterAnchor } from '../../core/models/book-review';
import { BookService } from '../../core/services/book.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { ChapterSummaryService } from '../../core/services/chapter-summary.service';
import { CharacterRegisterService } from '../../core/services/character-register.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { AiTierService } from '../../core/services/ai-tier.service';
import { TierToggleComponent } from '../../shared/tier-toggle/tier-toggle.component';

describe('BookDashboardComponent (wb3-c01 host)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  // rf-c02: the hosted status rows publish their build to the registry. Spy so the real (root) registry is
  // not pulled in and so we can assert the row->registry publish when a build is driven through the host.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    // `activeJobs$` is read by the dashboard itself since Wave 3 / w2 (the spine's stage-4 running marks),
    // so the spy must carry it or every spec in this file dies on `.subscribe of undefined`.
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>(
      'JobRegistryService',
      ['track'],
      { activeJobs$: of([]) },
    );
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        { provide: JobRegistryService, useValue: jobRegistrySpy },
        {
          provide: BookService,
          // Spies so individual tests can re-stub getProfile (e.g. to return a loaded profile).
          // Default getProfile returns NEVER: no profile, so the profile section stays collapsed while
          // the relocated status rows still render.
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER,
            refreshProfile: NEVER,
            ask: NEVER,
            // The hosted chapter-summaries child (wb3-c04) fetches the chapter list on init.
            getById: NEVER,
          }),
        },
        // Transitive deps of the hosted status-row children (NullInjector guard).
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

    fixture = TestBed.createComponent(BookDashboardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    fixture.detectChanges();
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
    const registers = fixture.debugElement.queryAll(
      By.css('.book-dashboard > .character-register-card app-character-register')
    );
    expect(component.profile).toBeNull();
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
  // The host keeps THIS instance alive and just changes [bookId]; the dashboard-owned profile card +
  // Ask answer + active review tab must reset and the profile must reload, without double-loading on init.
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

    it('reloads the profile and resets reviewTab/lastAnswer/askQuestion when bookId changes in place', () => {
      const bookSvc = TestBed.inject(BookService);
      const getProfile = bookSvc.getProfile as jasmine.Spy;

      // Hold the next profile open so the reset is observable before the new profile arrives.
      const profile$ = new Subject<BookProfileDto>();
      getProfile.and.returnValue(profile$.asObservable());

      // Simulate the prior book's lingering dashboard-owned state (set by the user before the switch).
      component.reviewTab = 'bible';
      component.askQuestion = 'who is the villain?';
      component.lastAnswer = { resultText: 'old answer' } as any;
      component.citationChapterIds = ['Ch 1'];
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
      expect(component.askQuestion).toBe('');
      expect(component.lastAnswer).toBeNull();
      expect(component.citationChapterIds).toEqual([]);
      expect(component.synopsisExpanded).toBeFalse();
      expect(component.expandedPlotNode).toBeNull();

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
      expect(stateOf('export')).toBe('unavailable');
      // The Import row is the one that opens, and it is the one that offers the action.
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="spine-action-import"]'))).not.toBeNull();
      // NOTHING claims readiness anywhere in the spine.
      const spine = fixture.debugElement.query(By.css('[data-testid="stage-spine"]')).nativeElement as HTMLElement;
      expect(spine.querySelectorAll('[data-state="ready"]').length).toBe(0);
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
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER,
            refreshProfile: NEVER,
            ask: NEVER,
            getById: NEVER,
          }),
        },
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
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, ask: NEVER, getById: NEVER,
          }),
        },
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

    const refresh = fixture.nativeElement.querySelector('.refresh-btn') as HTMLElement;
    expect(refresh.getAttribute('title')).toBe('Refresh profile');
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
 * c01: the dashboard's own SERVER calls must carry the book language, not just its chrome.
 *
 * The chrome was made book-scoped (the suite above) while onRefresh/onAsk still called the service with no
 * language argument, so both fell through to the service default of 'he' and then the controller default of
 * "he". That is not display-only: RefreshProfileAsync threads the language into the chapter summarize and
 * profile build, which STAMP it onto ChunkSummary.Language and BookProfile.Language. An English book
 * therefore spent a whole-book AI run producing Hebrew briefs AND mislabelled the language-keyed cache rows
 * that the briefs and style-baseline paths read back.
 *
 * These drive the REAL onRefresh/onAsk (nothing on the component is stubbed) with BookService mocked, and
 * assert on the argument that reaches the service. The service/controller defaults are left alone on
 * purpose: they are a correct backstop, the caller was the defect.
 */
describe('BookDashboardComponent threads the book language into its server calls (c01)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;
  let bookService: jasmine.SpyObj<BookService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, ask: NEVER, getById: NEVER,
          }),
        },
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

  /** Drive the two real server-calling handlers once each, with a question set so onAsk does not bail. */
  function driveBothCalls(): void {
    component.onRefresh();
    component.askQuestion = 'who is the protagonist?';
    component.onAsk();
  }

  it('sends the English language on BOTH refreshProfile and ask for an English book', () => {
    component.bookLanguage = 'en';

    driveBothCalls();

    expect(bookService.refreshProfile).toHaveBeenCalledWith('book-1', 'en');
    expect(bookService.ask).toHaveBeenCalledWith('book-1', 'who is the protagonist?', 'en');
  });

  it('sends the Hebrew language on BOTH calls for a Hebrew book', () => {
    component.bookLanguage = 'he';

    driveBothCalls();

    expect(bookService.refreshProfile).toHaveBeenCalledWith('book-1', 'he');
    expect(bookService.ask).toHaveBeenCalledWith('book-1', 'who is the protagonist?', 'he');
  });

  it('falls back to Hebrew on BOTH calls when the book language is null', () => {
    component.bookLanguage = null;

    driveBothCalls();

    expect(bookService.refreshProfile).toHaveBeenCalledWith('book-1', 'he');
    expect(bookService.ask).toHaveBeenCalledWith('book-1', 'who is the protagonist?', 'he');
  });

  it('falls back to Hebrew on BOTH calls when the book language is blank or whitespace', () => {
    component.bookLanguage = '   ';

    driveBothCalls();

    expect(bookService.refreshProfile).toHaveBeenCalledWith('book-1', 'he');
    expect(bookService.ask).toHaveBeenCalledWith('book-1', 'who is the protagonist?', 'he');
  });

  it('passes a language argument explicitly rather than relying on the service default', () => {
    component.bookLanguage = 'en';

    driveBothCalls();

    expect(bookService.refreshProfile.calls.mostRecent().args.length)
      .withContext('refreshProfile must receive the language argument, not fall through to its default')
      .toBe(2);
    expect(bookService.ask.calls.mostRecent().args.length)
      .withContext('ask must receive the language argument, not fall through to its default')
      .toBe(3);
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
  /** One entry per getProfile / refreshProfile / ask call, in issue order, each answerable on demand. */
  let profileLoads: Subject<BookProfileDto>[];
  let refreshes: Subject<BookProfileDto>[];
  let asks: Subject<any>[];

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
    asks = [];
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, ask: NEVER, getById: NEVER,
          }),
        },
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
    bookService.ask.and.callFake(() => queued(asks));

    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    // ngOnInit issues the first profile load under 'he'; it is left OPEN (the Subject never completes).
    fixture.detectChanges();
    expect(profileLoads.length).withContext('precondition: one profile load in flight under he').toBe(1);
  });

  it('treats a bookLanguage change like a book switch: resets own state and reloads the profile', () => {
    // Own state the user built up under the Hebrew book.
    component.reviewTab = 'bible';
    component.askQuestion = 'who is the villain?';
    component.lastAnswer = { resultText: 'old Hebrew answer' } as any;
    component.citationChapterIds = ['Ch 1'];
    component.synopsisExpanded = true;
    component.expandedPlotNode = 'climax';

    switchLanguageTo('en');

    expect(component.reviewTab).withContext('a language switch must reset the dashboard-owned tab').toBe('findings');
    expect(component.askQuestion).toBe('');
    expect(component.lastAnswer).withContext('the answer was produced in the previous language').toBeNull();
    expect(component.citationChapterIds).toEqual([]);
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

  it('leaves no refreshing latch raised for a refresh abandoned by the switch (the reset settles it)', () => {
    component.onRefresh();
    expect(component.refreshing).withContext('precondition: a he refresh is in flight').toBeTrue();

    switchLanguageTo('en');

    expect(component.refreshing)
      .withContext('the switch abandons the refresh, so the switch must settle its latch')
      .toBeFalse();
    // Proof the button is usable again: a new refresh can start under the new language.
    component.onRefresh();
    expect(refreshes.length).toBe(2);
    expect(bookService.refreshProfile.calls.mostRecent().args).toEqual(['book-1', 'en']);
  });

  it('a stale refresh response must not settle the CURRENT refresh (next handler ordering)', () => {
    component.onRefresh();
    const staleRefresh = refreshes[0]; // issued under 'he'

    switchLanguageTo('en');
    component.onRefresh(); // a fresh refresh under 'en' is now the one in flight
    expect(component.refreshing).withContext('precondition: an en refresh is in flight').toBeTrue();
    expect(refreshes.length).toBe(2);

    staleRefresh.next(profileFor('HebrewGenre'));

    expect(component.profile)
      .withContext('a profile refreshed in the PREVIOUS language must never populate the card')
      .toBeNull();
    expect(component.refreshing)
      .withContext('the stale response cleared the CURRENT refresh latch: guard must run first')
      .toBeTrue();
  });

  it('a stale refresh ERROR must not settle or fail the CURRENT refresh (error handler ordering)', () => {
    component.onRefresh();
    const staleRefresh = refreshes[0];

    switchLanguageTo('en');
    component.onRefresh();

    staleRefresh.error({ message: 'he-side refresh failure' });

    expect(component.error)
      .withContext('a failure from the abandoned language must not surface as the current error')
      .toBeNull();
    expect(component.refreshing)
      .withContext('the stale error cleared the CURRENT refresh latch: guard must run first')
      .toBeTrue();
  });

  it('leaves no asking latch raised for an ask abandoned by the switch, and drops its answer', () => {
    component.askQuestion = 'who is the villain?';
    component.onAsk();
    expect(component.asking).withContext('precondition: a he ask is in flight').toBeTrue();
    const staleAsk = asks[0];

    switchLanguageTo('en');

    expect(component.asking)
      .withContext('the switch abandons the ask, so the switch must settle its latch')
      .toBeFalse();

    staleAsk.next({ resultText: 'Hebrew answer', structuredResult: null } as any);

    expect(component.lastAnswer)
      .withContext('an answer produced in the PREVIOUS language must not be shown')
      .toBeNull();
    expect(component.asking).toBeFalse();
  });

  it('a stale ask response must not settle the CURRENT ask (next handler ordering)', () => {
    component.askQuestion = 'who is the villain?';
    component.onAsk();
    const staleAsk = asks[0]; // issued under 'he'

    switchLanguageTo('en');
    component.askQuestion = 'who is the protagonist?';
    component.onAsk(); // a fresh ask under 'en' is now the one in flight
    expect(component.asking).withContext('precondition: an en ask is in flight').toBeTrue();
    expect(asks.length).toBe(2);

    staleAsk.next({ resultText: 'Hebrew answer', structuredResult: null } as any);

    expect(component.lastAnswer)
      .withContext('an answer produced in the PREVIOUS language must not be shown')
      .toBeNull();
    expect(component.asking)
      .withContext('the stale answer cleared the CURRENT ask latch: guard must run first')
      .toBeTrue();
  });

  it('a stale ask ERROR must not settle or fail the CURRENT ask (error handler ordering)', () => {
    component.askQuestion = 'who is the villain?';
    component.onAsk();
    const staleAsk = asks[0];

    switchLanguageTo('en');
    component.askQuestion = 'who is the protagonist?';
    component.onAsk();

    staleAsk.error({ message: 'he-side ask failure' });

    expect(component.askError)
      .withContext('a failure from the abandoned language must not surface as the current ask error')
      .toBeNull();
    expect(component.asking)
      .withContext('the stale error cleared the CURRENT ask latch: guard must run first')
      .toBeTrue();
  });

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
  let asks: Subject<any>[];

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
    asks = [];
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
        { provide: JobRegistryService, useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track'], { activeJobs$: of([]) }) },
        {
          provide: BookService,
          useValue: jasmine.createSpyObj('BookService', {
            getProfile: NEVER, refreshProfile: NEVER, ask: NEVER, getById: NEVER,
          }),
        },
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
    bookService.ask.and.callFake(() => queued(asks));
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

  describe('onRefresh', () => {
    it('shows the Hebrew label, never the transport string, on a 500', () => {
      startIn('he');
      component.onRefresh();

      refreshes[0].error(transportFailure(`${PROFILE_URL}/refresh`));

      expect(component.error).toBe('שגיאה ברענון הפרופיל');
      expect(component.error).not.toContain('Http failure');
      expect(component.refreshing).toBeFalse();
    });

    it('shows the English label, never the transport string, on a 500', () => {
      startIn('en');
      component.onRefresh();

      refreshes[0].error(transportFailure(`${PROFILE_URL}/refresh`));

      expect(component.error).toBe('Could not refresh the profile');
      expect(component.error).not.toContain('Http failure');
    });

    it('keeps the label even when the body carries the API error shape', () => {
      startIn('he');
      component.onRefresh();

      refreshes[0].error(transportFailure(`${PROFILE_URL}/refresh`, { error: 'No chapters to summarize' }));

      expect(component.error)
        .withContext('an English server string must not land in a Hebrew card')
        .toBe('שגיאה ברענון הפרופיל');
    });
  });

  describe('onAsk', () => {
    function ask(): void {
      component.askQuestion = 'who is the protagonist?';
      component.onAsk();
    }

    it('shows the Hebrew label, never the transport string, on a 500', () => {
      startIn('he');
      ask();

      asks[0].error(transportFailure('http://localhost:5114/api/books/book-1/ask'));

      expect(component.askError).toBe('שגיאה בשאלה');
      expect(component.askError).not.toContain('Http failure');
      expect(component.asking).toBeFalse();
    });

    it('shows the English label, never the transport string, on a 500', () => {
      startIn('en');
      ask();

      asks[0].error(transportFailure('http://localhost:5114/api/books/book-1/ask'));

      expect(component.askError).toBe('Could not answer the question');
      expect(component.askError).not.toContain('Http failure');
    });

    it('keeps the label even when the body carries the API error shape', () => {
      startIn('he');
      ask();

      asks[0].error(transportFailure('http://localhost:5114/api/books/book-1/ask', { error: 'Question is required.' }));

      expect(component.askError)
        .withContext('no error body this API writes is localized, so none of them may reach the card')
        .toBe('שגיאה בשאלה');
    });

    it('shows the label rather than a body that happens to carry a message field', () => {
      startIn('en');
      ask();

      // Nothing in the API writes this shape; the assertion pins that the card ignores it if anything ever does.
      asks[0].error(transportFailure('http://localhost:5114/api/books/book-1/ask', { message: 'Ollama connection refused' }));

      expect(component.askError).toBe('Could not answer the question');
    });
  });

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
