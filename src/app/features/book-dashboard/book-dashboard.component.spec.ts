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
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of } from 'rxjs';
import { BookProfileDto } from '../../core/models/book';
import { BookDashboardComponent } from './book-dashboard.component';
import { ChapterAnchor } from '../../core/models/book-review';
import { BookService } from '../../core/services/book.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { ChapterSummaryService } from '../../core/services/chapter-summary.service';

describe('BookDashboardComponent (wb3-c01 host)', () => {
  let component: BookDashboardComponent;
  let fixture: ComponentFixture<BookDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookDashboardComponent],
      providers: [
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

  // ── P2-6: buildRunningChange aggregation (drives the editor "review running" affordance) ─────
  // The dashboard aggregates "any whole-book build running" from the summary row's buildingChange
  // output AND the review row's reviewStateChange === 'building', and re-emits the in-flight value
  // at unmount so the host's affordance survives the dashboard being @if-destroyed (close / focus).
  describe('buildRunningChange aggregation (P2-6)', () => {
    it('emits true when the review row reports building and false when it leaves building', () => {
      const events: boolean[] = [];
      component.buildRunningChange.subscribe((b) => events.push(b));

      // The review row enters BUILDING (e.g. a user-initiated review build started).
      component.onReviewStateChange('building');
      expect(component.buildRunning).toBeTrue();
      expect(events).toEqual([true]);

      // Staying building is de-duped (no redundant emit).
      component.onReviewStateChange('building');
      expect(events).toEqual([true]);

      // Build finishes -> ready: aggregate flips false, emitted once.
      component.onReviewStateChange('ready');
      expect(component.buildRunning).toBeFalse();
      expect(events).toEqual([true, false]);
    });

    it('emits true when the SUMMARY row reports building via buildingChange (held-open Subject)', () => {
      // Re-stub the summary service so the real hosted summary row drives a Subject-backed build.
      const summarySvc = TestBed.inject(BookSummaryService) as any;
      const progressSvc = TestBed.inject(AnalysisProgressService) as any;
      summarySvc.buildBookSummary = () => of({ jobId: 'job-1', noOp: false } as any);
      summarySvc.getBookSummaryStatus = () => NEVER;
      const poll$ = new Subject<any>();
      progressSvc.pollBookSummaryProgress = () => poll$.asObservable();

      const events: boolean[] = [];
      component.buildRunningChange.subscribe((b) => events.push(b));

      const summaryRow = fixture.debugElement
        .query(By.css('app-book-summary-status-row'))
        .componentInstance as { bookLanguage: string; onBuildBookSummary: () => void };
      summaryRow.bookLanguage = 'he';
      summaryRow.onBuildBookSummary();

      // The summary row emitted buildingChange(true); the dashboard aggregated it and emitted true.
      expect(component.buildRunning).toBeTrue();
      expect(events).toEqual([true]);

      // Terminal on the OPEN Subject clears it.
      poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });
      expect(component.buildRunning).toBeFalse();
      expect(events).toEqual([true, false]);
    });

    it('keeps the host flag TRUE across unmount: ngOnDestroy does not flip a running build to false', () => {
      const events: boolean[] = [];
      component.buildRunningChange.subscribe((b) => events.push(b));

      // A review build is running.
      component.onReviewStateChange('building');
      expect(events).toEqual([true]);

      // The dashboard is @if-destroyed (panel closed / focus mode) WHILE the build runs. The
      // re-emit at unmount must NOT report false — the build is still running server-side.
      component.ngOnDestroy();
      expect(events).toEqual([true]); // still true; no false emitted at unmount
    });

    it('re-syncs the host on REMOUNT: the first reported state being non-building emits false (clears a host '
      + 'flag left stuck true by a build that finished while the dashboard was unmounted)', () => {
      // Remount-after-finish: this fresh instance starts buildRunning=false and lastBuildRunning=null. Its
      // review row reattaches to the now-FINISHED server job and reports a terminal, non-building state as
      // its FIRST emit. The host (editor) is still showing the "review running" affordance from before the
      // unmount, so the dashboard MUST emit false to clear it — even though false matches this fresh
      // instance's own default. Pre-fix, the dedup against a false baseline swallowed this first emit and
      // the host stayed stuck true forever.
      const events: boolean[] = [];
      component.buildRunningChange.subscribe((b) => events.push(b));

      component.onReviewStateChange('ready'); // first signal after reattach: the build is already done
      expect(component.buildRunning).toBeFalse();
      expect(events).toEqual([false]);
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

    it('clears buildRunning on book switch so the previous book\'s review-building does not leak into the '
      + 'new book during the gap before its review status loads', () => {
      const events: boolean[] = [];
      component.buildRunningChange.subscribe((b) => events.push(b));

      // Book A's developmental review is running: reviewState='building' and the host affordance is lit.
      component.onReviewStateChange('building');
      expect(component.buildRunning).toBeTrue();
      expect(events).toEqual([true]);

      // The editor switches book in place (non-firstChange). The new book's review status has NOT loaded
      // yet (getReviewStatus is the default NEVER), so the review row will not re-emit for a while.
      const previous = component.bookId;
      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange(previous, 'book-2', false) });

      // The cached review state is reset and the host is told false immediately — the stale 'building' from
      // book A cannot keep the "review running" affordance lit for book B across the async status-load gap.
      expect(component.reviewState).toBe('unknown');
      expect(component.buildRunning).toBeFalse();
      expect(events).toEqual([true, false]);
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
});
