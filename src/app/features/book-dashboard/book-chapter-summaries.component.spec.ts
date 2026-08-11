/**
 * wb3-c04: Chapter summaries view + edit spec.
 *
 * Covers: the list renders one row per chapter; the dual-surface view loads per row; inline edit + save
 * (the user's authoritative flat summary); the explicit "re-derive analysis" OFFER appears only AFTER a save
 * and invokes the re-derive service; the edited + stale (analysis-out-of-date) badge states; and he/en
 * parity. All async flows use a held-OPEN rxjs Subject (never a synchronous of()/throwError()) so terminal
 * emits land inside the real in-flight window.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject } from 'rxjs';
import { BookChapterSummariesComponent } from './book-chapter-summaries.component';
import { BookService } from '../../core/services/book.service';
import { ChapterSummaryService } from '../../core/services/chapter-summary.service';
import { BookDetailDto } from '../../core/models/book';
import {
  ChapterSummaryViewDto,
  RederiveChapterSummaryResponse,
} from '../../core/models/chapter-summary';
import { StructuredChunkSummaryData } from '../../core/models/analysis-context';

function makeStructuredBrief(
  overrides: Partial<StructuredChunkSummaryData> = {}
): StructuredChunkSummaryData {
  return {
    plotEvents: ['Hero leaves home', 'Meets the mentor'],
    characterStates: [{ name: 'Dana', state: 'anxious', emotionalArc: 'hope to doubt' }],
    thematicMarkers: ['belonging'],
    toneNotes: 'somber',
    openThreads: ['Who sent the letter?'],
    ...overrides,
  };
}

function makeBookDetail(overrides: Partial<BookDetailDto> = {}): BookDetailDto {
  return {
    id: 'book-1',
    title: 'Book One',
    author: null,
    language: 'he',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aiTier: 'fast',
    chapters: [
      { id: 'ch-1', title: 'Chapter One', partName: null, order: 0, wordCount: 100, updatedAt: new Date().toISOString() },
      { id: 'ch-2', title: 'Chapter Two', partName: null, order: 1, wordCount: 200, updatedAt: new Date().toISOString() },
    ],
    ...overrides,
  };
}

function makeView(overrides: Partial<ChapterSummaryViewDto> = {}): ChapterSummaryViewDto {
  return {
    bookId: 'book-1',
    chapterId: 'ch-1',
    language: 'he',
    summaryText: 'A loaded summary.',
    hasSummary: true,
    hasStructuredBrief: true,
    summaryUserEdited: false,
    createdAt: new Date().toISOString(),
    summaryUserEditedAt: null,
    structuredBuiltAt: new Date().toISOString(),
    structuredBrief: null,
    ...overrides,
  };
}

describe('BookChapterSummariesComponent (wb3-c04)', () => {
  let component: BookChapterSummariesComponent;
  let fixture: ComponentFixture<BookChapterSummariesComponent>;

  // Held-open Subjects: every async flow resolves explicitly inside the test, never synchronously.
  let getByIdSubject: Subject<BookDetailDto>;
  let getSummarySubjects: Map<string, Subject<ChapterSummaryViewDto>>;
  let updateSubject: Subject<ChapterSummaryViewDto>;
  let rederiveSubject: Subject<RederiveChapterSummaryResponse>;

  let bookServiceMock: Pick<BookService, 'getById'>;
  let summaryServiceMock: Pick<
    ChapterSummaryService,
    'getChapterSummary' | 'updateChapterSummary' | 'rederiveChapterSummary'
  >;

  beforeEach(async () => {
    getByIdSubject = new Subject<BookDetailDto>();
    getSummarySubjects = new Map();
    updateSubject = new Subject<ChapterSummaryViewDto>();
    rederiveSubject = new Subject<RederiveChapterSummaryResponse>();

    bookServiceMock = {
    getById: () => getByIdSubject.asObservable(),
    };
    summaryServiceMock = {
      getChapterSummary: (_b: string, chapterId: string) => {
        if (!getSummarySubjects.has(chapterId)) {
          getSummarySubjects.set(chapterId, new Subject<ChapterSummaryViewDto>());
        }
        return getSummarySubjects.get(chapterId)!.asObservable();
      },
      updateChapterSummary: () => updateSubject.asObservable(),
      rederiveChapterSummary: () => rederiveSubject.asObservable(),
    };

    await TestBed.configureTestingModule({
      imports: [BookChapterSummariesComponent],
      providers: [
        { provide: BookService, useValue: bookServiceMock },
        { provide: ChapterSummaryService, useValue: summaryServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookChapterSummariesComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
  });

  function triggerInit(): void {
    component.ngOnChanges({
    bookId: new SimpleChange(null, 'book-1', true),
    });
    fixture.detectChanges();
  }

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }
  function queryAll(selector: string) {
    return fixture.debugElement.queryAll(By.css(selector));
  }

  /** Expand a row so its body is visible in the DOM (rows default to collapsed). */
  function expandRow(chapterId: string): void {
    const row = component.rows.find((r) => r.chapterId === chapterId);
    if (row) row.collapsed = false;
    fixture.detectChanges();
  }

  /** Expand ALL rows. */
  function expandAllRows(): void {
    component.rows.forEach((r) => { r.collapsed = false; });
    fixture.detectChanges();
  }

  // ── List render ───────────────────────────────────────────────────────────────

  it('renders one row per chapter once the chapter list resolves', () => {
    triggerInit();
    // Still loading the list: no rows yet.
    expect(query('[data-testid="cs-list-loading"]')).not.toBeNull();

    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    const rows = queryAll('.cs-row');
    expect(rows.length).toBe(2);
    expect(query('[data-testid="cs-row-ch-1"]')).not.toBeNull();
    expect(query('[data-testid="cs-row-ch-2"]')).not.toBeNull();
  });

  it('shows the list-error state when the chapter list fetch fails', () => {
    triggerInit();
    getByIdSubject.error(new Error('boom'));
    fixture.detectChanges();
    expect(query('[data-testid="cs-list-error"]')).not.toBeNull();
  });

  it('renders each loaded summary text', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Summary of one.' }));
    fixture.detectChanges();
    expandRow('ch-1');

    const row1 = query('[data-testid="cs-row-ch-1"]');
    const text = row1.query(By.css('[data-testid="cs-summary-text"]'));
    expect(text.nativeElement.textContent).toContain('Summary of one.');
  });

  // ── f05: skip the self-fetch when the host supplies `chapters` at first mount ──────
  // wave3-spine-fixes f05: this component used to always re-fetch the book detail itself
  // (BookService.getById), duplicating the SAME book detail the host (book-dashboard, and its own host
  // editor-page) already holds. Measured live as one of the "GET /api/books/{id} fires twice" duplicates.
  // The `chapters` @Input is optional and additive: every test above never binds it, so `component.chapters`
  // stays `null` and the original getById fetch runs exactly as before (pinned by 'renders one row per
  // chapter...' above still passing unchanged).
  describe('f05: host-supplied chapters @Input', () => {
    it('builds rows straight from `chapters` on first mount WITHOUT calling BookService.getById', () => {
      const getSpy = spyOn(bookServiceMock, 'getById');
      component.chapters = makeBookDetail().chapters;
      component.ngOnChanges({
        bookId: new SimpleChange(null, 'book-1', true),
        chapters: new SimpleChange(null, component.chapters, true),
      });
      fixture.detectChanges();

      expect(getSpy).not.toHaveBeenCalled();
      expect(query('[data-testid="cs-list-loading"]')).toBeNull();
      const rows = queryAll('.cs-row');
      expect(rows.length).toBe(2);
      expect(query('[data-testid="cs-row-ch-1"]')).not.toBeNull();
      expect(query('[data-testid="cs-row-ch-2"]')).not.toBeNull();
    });

    it('still loads each row summary after building rows from `chapters`', () => {
      component.chapters = [makeBookDetail().chapters[0]];
      component.ngOnChanges({
        bookId: new SimpleChange(null, 'book-1', true),
        chapters: new SimpleChange(null, component.chapters, true),
      });
      fixture.detectChanges();

      getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'From host chapters.' }));
      fixture.detectChanges();
      expandRow('ch-1');

      const row1 = query('[data-testid="cs-row-ch-1"]');
      const text = row1.query(By.css('[data-testid="cs-summary-text"]'));
      expect(text.nativeElement.textContent).toContain('From host chapters.');
    });

    it('renders the empty state (no getById fallback) when the host supplies an EMPTY chapters array', () => {
      const getSpy = spyOn(bookServiceMock, 'getById');
      component.chapters = [];
      component.ngOnChanges({
        bookId: new SimpleChange(null, 'book-1', true),
        chapters: new SimpleChange(null, [], true),
      });
      fixture.detectChanges();

      expect(getSpy).not.toHaveBeenCalled();
      expect(query('[data-testid="cs-empty"]')).not.toBeNull();
    });

    it('falls back to the self-fetch on a LATER book switch even with chapters bound (unchanged path)', () => {
      const getSpy = spyOn(bookServiceMock, 'getById').and.callThrough();
      // First mount, fast path: no fetch.
      component.chapters = makeBookDetail().chapters;
      component.ngOnChanges({
        bookId: new SimpleChange(null, 'book-1', true),
        chapters: new SimpleChange(null, component.chapters, true),
      });
      fixture.detectChanges();

      // A later book switch (this dashboard instance stays open): the host clears chapters to null while
      // its own reload is in flight, same as the real editor-page/book-dashboard sequence.
      component.bookId = 'book-2';
      component.chapters = null;
      component.ngOnChanges({
        bookId: new SimpleChange('book-1', 'book-2', false),
        chapters: new SimpleChange(makeBookDetail().chapters, null, false),
      });
      fixture.detectChanges();

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('takes the original self-fetch path when chapters is never bound (every pre-existing caller)', () => {
      // No chapters assignment at all - component.chapters stays at its default (null), and `changes` never
      // carries a 'chapters' key, matching every spec above this describe block.
      triggerInit();
      expect(query('[data-testid="cs-list-loading"]')).not.toBeNull();

      getByIdSubject.next(makeBookDetail());
      getByIdSubject.complete();
      fixture.detectChanges();

      expect(queryAll('.cs-row').length).toBe(2);
    });
  });

  // ── Refresh on build completion (rf-f04 / build-complete fan-out) ─────────────────

  it('re-fetches summaries IN PLACE when refreshSignal changes, replacing a stale "no summary" state', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    // Mounted mid-build: this chapter's brief is not built yet -> "no summary yet".
    // Expand the row so body elements are visible.
    expandRow('ch-1');
    getSummarySubjects.get('ch-1')!.next(
      makeView({ chapterId: 'ch-1', summaryText: '', hasSummary: false, hasStructuredBrief: false, structuredBrief: null })
    );
    fixture.detectChanges();
    expect(query('[data-testid="cs-no-summary"]')).not.toBeNull();

    // Build completes -> host bumps refreshSignal. The re-fetch must NOT clear/flash the list (in place).
    component.refreshSignal = 1;
    component.ngOnChanges({ refreshSignal: new SimpleChange(0, 1, false) });
    fixture.detectChanges();
    expect(query('[data-testid="cs-list-loading"]')).toBeNull();

    // The in-place re-fetch resolves with the now-built brief.
    getSummarySubjects.get('ch-1')!.next(
      makeView({ chapterId: 'ch-1', summaryText: '', hasSummary: false, hasStructuredBrief: true, structuredBrief: makeStructuredBrief() })
    );
    fixture.detectChanges();

    const refreshedRow = query('[data-testid="cs-row-ch-1"]');
    expect(query('[data-testid="cs-no-summary"]')).toBeNull();
    expect(refreshedRow.query(By.css('[data-testid="cs-structured-fallback"]'))).not.toBeNull();
    expect(refreshedRow.query(By.css('[data-testid="cs-badge-analysis"]'))).not.toBeNull();
  });

  // c02: same-key request supersession. A refresh that races an in-flight load for the SAME row must cancel
  // the prior request so a slow OLDER response cannot land after (and overwrite) a newer one — both pass the
  // same bookId/language stale-guard, so last-write-wins would render stale content.
  it('(c02) supersedes an in-flight row load: the OLDER response is ignored once a newer load is issued', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    expandRow('ch-1');

    // First (initial) load for ch-1 is in flight on the auto-created Subject; DO NOT resolve it yet.
    const firstSubject = getSummarySubjects.get('ch-1')!;

    // A refresh (build-complete fan-out) issues a SECOND load for the SAME row while the first is in flight.
    // Hand the second getChapterSummary call a DISTINCT Subject so we can control the two responses
    // independently — this models two separate HTTP requests for the same chapter.
    const secondSubject = new Subject<ChapterSummaryViewDto>();
    spyOn(summaryServiceMock, 'getChapterSummary').and.returnValue(secondSubject.asObservable());

    component.refreshSignal = 1;
    component.ngOnChanges({ refreshSignal: new SimpleChange(0, 1, false) });
    fixture.detectChanges();

    // Resolve the NEWER (second) request first with the fresh content.
    secondSubject.next(makeView({ chapterId: 'ch-1', summaryText: 'NEW content.' }));
    secondSubject.complete();
    fixture.detectChanges();
    expect(query('[data-testid="cs-summary-text"]').nativeElement.textContent).toContain('NEW content.');

    // Now the OLDER (first) request finally resolves LAST with stale content. Because the refresh cancelled
    // the first subscription BEFORE issuing the second, this emit must be ignored — the newer content stays.
    firstSubject.next(makeView({ chapterId: 'ch-1', summaryText: 'STALE content.' }));
    firstSubject.complete();
    fixture.detectChanges();

    const text = query('[data-testid="cs-summary-text"]').nativeElement.textContent;
    expect(text).toContain('NEW content.');
    expect(text).not.toContain('STALE content.');
    expect(component.rows[0].view?.summaryText).toBe('NEW content.');
  });

  // bug1: refreshSignal firing WHILE the initial chapter-list load is still in flight must NOT start a second
  // getById. rows is empty for the whole in-flight window (loadChapterList clears it synchronously and only
  // repopulates it in the async next handler), so without the loadingList guard the rows.length === 0 branch
  // would re-enter loadChapterList and open a duplicate list subscription.
  it('(bug1) does NOT start a second chapter-list load when refreshSignal fires while the list is still loading', () => {
    const getByIdSpy = spyOn(bookServiceMock, 'getById').and.returnValue(getByIdSubject.asObservable());
    triggerInit();

    // Initial list load is in flight: loadingList true, rows still empty, exactly one getById so far.
    expect(component.loadingList).toBeTrue();
    expect(component.rows.length).toBe(0);
    expect(getByIdSpy).toHaveBeenCalledTimes(1);

    // Host bumps refreshSignal mid-load (build-complete fan-out racing the initial mount fetch).
    component.refreshSignal = 1;
    component.ngOnChanges({ refreshSignal: new SimpleChange(0, 1, false) });
    fixture.detectChanges();

    // The in-flight load must not be duplicated.
    expect(getByIdSpy).toHaveBeenCalledTimes(1);

    // The original load still resolves normally and populates the rows once.
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();
    expect(component.rows.length).toBe(2);
    expect(getByIdSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores the initial refreshSignal binding (firstChange must not trigger a refetch)', () => {
    const spy = spyOn(component, 'refreshSummaries').and.callThrough();
    component.ngOnChanges({ refreshSignal: new SimpleChange(undefined, 0, true) });
    expect(spy).not.toHaveBeenCalled();
  });

  // f01: silent refresh preserves prior content on error
  it('(f01-a) silent refresh error keeps prior content visible and does NOT show the load-error state', () => {
    // Arrange: mount with one chapter, resolve the initial load with valid content.
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    expandRow('ch-1');

    // Initial (non-silent) load resolves with good content.
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Existing summary.' }));
    getSummarySubjects.get('ch-1')!.complete();
    fixture.detectChanges();

    // Confirm the good content is shown.
    expect(query('[data-testid="cs-summary-text"]')).not.toBeNull();
    expect(query('[data-testid="cs-row-error"]')).toBeNull();

    // Simulate build-complete: host bumps refreshSignal -> triggers silent re-fetch.
    // A NEW Subject is registered for the next getChapterSummary call (mock creates per-chapterId).
    // Reset the map entry so the mock creates a fresh Subject for the silent fetch.
    getSummarySubjects.delete('ch-1');
    component.refreshSignal = 1;
    component.ngOnChanges({ refreshSignal: new SimpleChange(0, 1, false) });
    fixture.detectChanges();

    // The silent re-fetch is in flight; prior content must remain (no loading flash, no error yet).
    expect(query('[data-testid="cs-row-loading"]')).toBeNull();
    expect(query('[data-testid="cs-summary-text"]')).not.toBeNull();

    // Now the silent re-fetch fails with a transient error.
    getSummarySubjects.get('ch-1')!.error(new Error('transient'));
    fixture.detectChanges();

    // (a) No load-error state — the silent failure must be invisible.
    expect(query('[data-testid="cs-row-error"]')).toBeNull();
    // (b) The previously-rendered content is still visible.
    expect(query('[data-testid="cs-summary-text"]')).not.toBeNull();
    expect(query('[data-testid="cs-summary-text"]').nativeElement.textContent).toContain('Existing summary.');
  });

  it('(f01-b) non-silent (initial) load error DOES surface the load-error state', () => {
    // Arrange: mount with one chapter, but the initial (non-silent) load fails.
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    expandRow('ch-1');

    // The initial non-silent fetch errors.
    getSummarySubjects.get('ch-1')!.error(new Error('network error'));
    fixture.detectChanges();

    // The load-error state MUST render for a non-silent failure.
    expect(query('[data-testid="cs-row-error"]')).not.toBeNull();
    // And there is no prior content to show.
    expect(query('[data-testid="cs-summary-text"]')).toBeNull();
  });

  // ── Edited + stale badges ───────────────────────────────────────────────────────

  it('shows the EDITED badge when the summary is user-edited', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryUserEdited: true }));
    fixture.detectChanges();

    const row1 = query('[data-testid="cs-row-ch-1"]');
    expect(row1.query(By.css('[data-testid="cs-badge-edited"]'))).not.toBeNull();
  });

  it('shows the STALE badge when the user edit is newer than the structured brief', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    const built = new Date('2026-01-01T00:00:00Z').toISOString();
    const editedLater = new Date('2026-01-02T00:00:00Z').toISOString();
    getSummarySubjects.get('ch-1')!.next(
      makeView({
        chapterId: 'ch-1',
        summaryUserEdited: true,
        hasStructuredBrief: true,
        structuredBuiltAt: built,
        summaryUserEditedAt: editedLater,
      })
    );
    fixture.detectChanges();

    const row1 = query('[data-testid="cs-row-ch-1"]');
    expect(row1.query(By.css('[data-testid="cs-badge-stale"]'))).not.toBeNull();
  });

  it('does NOT show the stale badge when the structured brief is newer than the edit', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    const edited = new Date('2026-01-01T00:00:00Z').toISOString();
    const builtLater = new Date('2026-01-02T00:00:00Z').toISOString();
    getSummarySubjects.get('ch-1')!.next(
      makeView({
        chapterId: 'ch-1',
        summaryUserEdited: true,
        hasStructuredBrief: true,
        structuredBuiltAt: builtLater,
        summaryUserEditedAt: edited,
      })
    );
    fixture.detectChanges();

    const row1 = query('[data-testid="cs-row-ch-1"]');
    expect(row1.query(By.css('[data-testid="cs-badge-stale"]'))).toBeNull();
  });

  // ── Structured-brief fallback (empty flat + AI brief present) ─────────────────────

  it('renders the read-only structured fallback with the FROM-ANALYSIS badge when flat is empty but a brief exists', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    getSummarySubjects.get('ch-1')!.next(
      makeView({
        chapterId: 'ch-1',
        summaryText: '',
        hasSummary: false,
        hasStructuredBrief: true,
        structuredBrief: makeStructuredBrief(),
      })
    );
    fixture.detectChanges();
    expandRow('ch-1');

    const row1 = query('[data-testid="cs-row-ch-1"]');
    // The "from analysis" badge distinguishes this from the user's own summary.
    expect(row1.query(By.css('[data-testid="cs-badge-analysis"]'))).not.toBeNull();
    // The user's "manually edited" badge must NOT show on the fallback.
    expect(row1.query(By.css('[data-testid="cs-badge-edited"]'))).toBeNull();
    // The read-only digest renders the structured facts; the "no summary" muted text does NOT.
    const digest = row1.query(By.css('[data-testid="cs-structured-fallback"]'));
    expect(digest).not.toBeNull();
    expect(digest.nativeElement.textContent).toContain('Hero leaves home');
    expect(digest.nativeElement.textContent).toContain('Dana');
    expect(digest.nativeElement.textContent).toContain('belonging');
    expect(row1.query(By.css('[data-testid="cs-no-summary"]'))).toBeNull();
  });

  it('shows the user OWN summary (not the fallback) when the flat summary is present', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    getSummarySubjects.get('ch-1')!.next(
      makeView({
        chapterId: 'ch-1',
        summaryText: 'My own understanding.',
        hasSummary: true,
        summaryUserEdited: true,
        hasStructuredBrief: true,
        structuredBrief: makeStructuredBrief(),
      })
    );
    fixture.detectChanges();
    expandRow('ch-1');

    const row1 = query('[data-testid="cs-row-ch-1"]');
    // The user's own summary shows; the structured fallback does NOT (no from-analysis badge / digest).
    expect(row1.query(By.css('[data-testid="cs-summary-text"]')).nativeElement.textContent)
      .toContain('My own understanding.');
    expect(row1.query(By.css('[data-testid="cs-structured-fallback"]'))).toBeNull();
    expect(row1.query(By.css('[data-testid="cs-badge-analysis"]'))).toBeNull();
    // The user's manually-edited badge shows instead.
    expect(row1.query(By.css('[data-testid="cs-badge-edited"]'))).not.toBeNull();
  });

  it('shows the plain "no summary" state when neither a flat summary nor a structured brief exists', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    getSummarySubjects.get('ch-1')!.next(
      makeView({ chapterId: 'ch-1', summaryText: '', hasSummary: false, hasStructuredBrief: false, structuredBrief: null })
    );
    fixture.detectChanges();
    expandRow('ch-1');

    const row1 = query('[data-testid="cs-row-ch-1"]');
    expect(row1.query(By.css('[data-testid="cs-no-summary"]'))).not.toBeNull();
    expect(row1.query(By.css('[data-testid="cs-structured-fallback"]'))).toBeNull();
    expect(row1.query(By.css('[data-testid="cs-badge-analysis"]'))).toBeNull();
  });

  it('Edit pre-fills the editor with the structured digest when in the from-analysis fallback', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(
      makeView({
        chapterId: 'ch-1',
        summaryText: '',
        hasSummary: false,
        hasStructuredBrief: true,
        structuredBrief: makeStructuredBrief(),
      })
    );
    fixture.detectChanges();
    expandRow('ch-1');

    // "Add summary" (no user summary yet) opens the editor pre-filled with the digest as a starting point.
    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();

    expect(query('[data-testid="cs-textarea-ch-1"]')).not.toBeNull();
    const draft = component.rows[0].draft;
    expect(draft).toContain('Hero leaves home');
    expect(draft).toContain('Dana');
    expect(draft.length).toBeGreaterThan(0);
  });

  // ── Inline edit + save ──────────────────────────────────────────────────────────

  it('enters edit mode, saves the edited summary, and surfaces the re-derive OFFER only after save', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Old text.' }));
    fixture.detectChanges();
    expandRow('ch-1');

    // No re-derive offer before any edit.
    expect(query('[data-testid="cs-rederive-offer"]')).toBeNull();

    // Enter edit mode.
    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="cs-textarea-ch-1"]')).not.toBeNull();

    // Change the buffer and save.
    component.rows[0].draft = 'My own understanding.';
    fixture.detectChanges();
    query('[data-testid="cs-save"]').nativeElement.click();

    // Held-open Subject: resolve the PUT explicitly.
    updateSubject.next(makeView({ chapterId: 'ch-1', summaryText: 'My own understanding.', summaryUserEdited: true }));
    updateSubject.complete();
    fixture.detectChanges();

    // The saved text is reflected and the re-derive OFFER now appears (asks the user).
    // The row stayed expanded because onEdit set collapsed=false.
    expect(query('[data-testid="cs-summary-text"]').nativeElement.textContent).toContain('My own understanding.');
    expect(query('[data-testid="cs-rederive-offer"]')).not.toBeNull();
  });

  it('PUT save failure shows save-error message, preserves draft, and does NOT set rederiveResult to error', () => {
    // Arrange: load the list and one row with an existing summary.
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Old text.' }));
    fixture.detectChanges();
    expandRow('ch-1');

    // Enter edit mode, change the draft.
    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();
    const originalDraft = 'My edited summary.';
    component.rows[0].draft = originalDraft;
    fixture.detectChanges();

    // Use a held-open Subject for the PUT - do NOT emit yet.
    const saveSubject = new Subject<ChapterSummaryViewDto>();
    spyOn(summaryServiceMock, 'updateChapterSummary').and.returnValue(saveSubject.asObservable());

    // Trigger save.
    query('[data-testid="cs-save"]').nativeElement.click();

    // Now emit an error from the held-open Subject (simulates server failure).
    saveSubject.error(new Error('server error'));
    fixture.detectChanges();

    // (a) The save-error message renders in the DOM.
    const saveErrorEl = query('[data-testid="cs-save-error"]');
    expect(saveErrorEl).not.toBeNull();

    // (b) row.draft is preserved (the user's edit is not lost).
    expect(component.rows[0].draft).toBe(originalDraft);

    // (c) row.rederiveResult is NOT 'error' (the mislabeled path is gone).
    expect(component.rows[0].rederiveResult).not.toBe('error');
  });

  it('cancel exits edit mode without calling the update service', () => {
    const updateSpy = spyOn(summaryServiceMock, 'updateChapterSummary').and.callThrough();
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1' }));
    fixture.detectChanges();
    expandRow('ch-1');

    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();
    query('[data-testid="cs-cancel"]').nativeElement.click();
    fixture.detectChanges();

    expect(query('[data-testid="cs-textarea-ch-1"]')).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ── Re-derive ────────────────────────────────────────────────────────────────────

  it('invokes the re-derive service from the offer and reflects the terminal result', () => {
    const rederiveSpy = spyOn(summaryServiceMock, 'rederiveChapterSummary').and.callThrough();
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Old.' }));
    fixture.detectChanges();
    expandRow('ch-1');

    // Edit + save to surface the offer.
    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();
    component.rows[0].draft = 'Edited.';
    fixture.detectChanges();
    query('[data-testid="cs-save"]').nativeElement.click();
    updateSubject.next(makeView({ chapterId: 'ch-1', summaryText: 'Edited.', summaryUserEdited: true }));
    updateSubject.complete();
    fixture.detectChanges();

    // Trigger the re-derive.
    query('[data-testid="cs-rederive"]').nativeElement.click();
    fixture.detectChanges();
    expect(rederiveSpy).toHaveBeenCalledWith('book-1', 'ch-1', 'he');

    // Held-open Subject: resolve the POST explicitly with a successful re-derive.
    rederiveSubject.next({
      bookId: 'book-1',
      chapterId: 'ch-1',
      language: 'he',
      rederived: true,
      hasStructuredBrief: true,
      structuredBuiltAt: new Date().toISOString(),
            message: 'ok',
    });
    rederiveSubject.complete();
    fixture.detectChanges();

    // The offer is consumed and a terminal result is shown.
    expect(query('[data-testid="cs-rederive-offer"]')).toBeNull();
    expect(query('[data-testid="cs-rederive-result"]')).not.toBeNull();
  });

  // P3-14: a re-derive is ONLY ever offered after a successful save of a NON-blank flat summary, so a
  // just-re-derived row always has hasSummary === true and the read-only structured-digest fallback (which
  // renders only when the flat summary is empty) is UNREACHABLE for it. The onRederive next handler therefore
  // adopts only the structured STAMPS (not the parsed structuredBrief) and adds no re-GET. This pins that the
  // fallback digest stays unrendered through the whole save -> re-derive cycle, so the un-adopted brief is
  // never user-visible.
  it('does NOT render the structured-digest fallback after a re-derive (fallback is unreachable on a saved row)', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    // Row starts with a flat summary AND a structured brief present.
    getSummarySubjects.get('ch-1')!.next(
      makeView({ chapterId: 'ch-1', summaryText: 'Old.', hasSummary: true, structuredBrief: makeStructuredBrief() })
    );
    fixture.detectChanges();
    expandRow('ch-1');

    // Edit + save a NON-blank summary to surface the re-derive offer.
    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();
    component.rows[0].draft = 'Edited.';
    fixture.detectChanges();
    query('[data-testid="cs-save"]').nativeElement.click();
    updateSubject.next(
      makeView({ chapterId: 'ch-1', summaryText: 'Edited.', hasSummary: true, summaryUserEdited: true })
    );
    updateSubject.complete();
    fixture.detectChanges();

    // Fallback already absent (flat summary present).
    expect(query('[data-testid="cs-structured-fallback"]')).toBeNull();

    // Re-derive succeeds.
    query('[data-testid="cs-rederive"]').nativeElement.click();
    fixture.detectChanges();
    rederiveSubject.next({
      bookId: 'book-1',
      chapterId: 'ch-1',
      language: 'he',
      rederived: true,
      hasStructuredBrief: true,
      structuredBuiltAt: new Date().toISOString(),
            message: 'ok',
    });
    rederiveSubject.complete();
    fixture.detectChanges();

    // The structured-digest fallback stays unrendered (the stale-brief no-op is not user-visible), the user's
    // own saved summary still shows, and the structured stamps were adopted (no stale badge, brief present).
    expect(query('[data-testid="cs-structured-fallback"]')).toBeNull();
    expect(query('[data-testid="cs-summary-text"]').nativeElement.textContent).toContain('Edited.');
    expect(component.rows[0].view?.hasStructuredBrief).toBeTrue();
    expect(component.showStructuredFallback(component.rows[0])).toBeFalse();
  });

  // ── i18n parity ────────────────────────────────────────────────────────────────

  it('renders English chrome + ltr when bookLanguage is en', () => {
    component.bookLanguage = 'en';
    fixture.detectChanges();
    expect(component.dir).toBe('ltr');
    expect(component.label('title')).toBe('Chapter briefs');
    expect(component.label('rederive')).toBe('Update analysis');
    // No em-dash in any user-facing string.
    const allHe = ['title', 'rederive', 'staleBadge', 'editedBadge', 'rederivePrompt']
      .map((k) => {
        component.bookLanguage = 'he';
        return component.label(k);
      })
      .join(' ');
    expect(allHe.includes('—')).toBe(false);
  });

  it('every label key resolves in both he and en (parity)', () => {
    const keys = [
      'title', 'loading', 'listError', 'rowError', 'empty', 'noSummary', 'edit', 'add', 'save',
      'saving', 'cancel', 'editAria', 'editedBadge', 'staleBadge', 'rederivePrompt', 'rederive',
      'rederiving', 'rederiveLater', 'saveError',
      'analysisBadge', 'analysisNote', 'digestPlot', 'digestCharacters', 'digestThemes',
      'digestTone', 'digestOpenThreads',
      'collapseAll', 'expandAll', 'expandRow',
    ];
    for (const key of keys) {
      component.bookLanguage = 'he';
      const he = component.label(key);
      component.bookLanguage = 'en';
      const en = component.label(key);
      expect(he).not.toBe(key);
      expect(en).not.toBe(key);
      expect(he).not.toBe(en); // genuinely localized, not a shared fallback
    }
  });

  // ── Single-inflight-edit guard ────────────────────────────────────────────────

  it('refuses a second onSave while a first row PUT is still in flight, then allows saves once the first completes', () => {
    // Arrange: load two chapters.
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    // Resolve both rows' summary GETs so they have existing text (makes isDirty() true after editing).
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Summary one.' }));
    getSummarySubjects.get('ch-2')!.next(makeView({ chapterId: 'ch-2', summaryText: 'Summary two.' }));
    fixture.detectChanges();

    // Hold the first row's PUT open with a Subject so we control when it completes.
    const firstSaveSubject = new Subject<ChapterSummaryViewDto>();
    const updateSpy = spyOn(summaryServiceMock, 'updateChapterSummary').and.returnValue(firstSaveSubject.asObservable());

    // Put row 1 into edit mode and make it dirty.
    const row1 = component.rows[0];
    const row2 = component.rows[1];
    component.onEdit(row1);
    row1.draft = 'Edited one.';
    fixture.detectChanges();

    // Start save for row 1 — this holds the PUT open.
    component.onSave(row1);
    expect(row1.saving).toBeTrue();
    expect(component.savingRowId).toBe('ch-1');
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // While row 1's save is in flight, attempt to save row 2.
    component.onEdit(row2);
    row2.draft = 'Edited two.';
    fixture.detectChanges();
    component.onSave(row2);

    // The guard must have blocked the second save: row 2 is NOT in saving state and the service was NOT called again.
    expect(row2.saving).toBeFalse();
    expect(updateSpy).toHaveBeenCalledTimes(1); // still 1, not 2

    // Now complete row 1's save.
    firstSaveSubject.next(makeView({ chapterId: 'ch-1', summaryText: 'Edited one.', summaryUserEdited: true }));
    firstSaveSubject.complete();
    fixture.detectChanges();

    // savingRowId is cleared after row 1's save completes.
    expect(component.savingRowId).toBeNull();
    expect(row1.saving).toBeFalse();

    // Now a save for row 2 should be accepted (no other save in flight).
    const secondSaveSubject = new Subject<ChapterSummaryViewDto>();
    updateSpy.and.returnValue(secondSaveSubject.asObservable());
    component.onSave(row2);
    expect(row2.saving).toBeTrue();
    expect(component.savingRowId).toBe('ch-2');
    expect(updateSpy).toHaveBeenCalledTimes(2);

    // Clean up: complete the second save.
    secondSaveSubject.next(makeView({ chapterId: 'ch-2', summaryText: 'Edited two.', summaryUserEdited: true }));
    secondSaveSubject.complete();
    fixture.detectChanges();
    expect(component.savingRowId).toBeNull();
  });

  // ── Collapse feature ─────────────────────────────────────────────────────────

  it('(collapse-default) rows default to collapsed — the row body is absent from the DOM, the header stays', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    // Header is always visible (title + toggle chevron).
    expect(query('[data-testid="cs-row-ch-1"]')).not.toBeNull();
    expect(query('[data-testid="cs-row-toggle-ch-1"]')).not.toBeNull();
    expect(query('[data-testid="cs-chapter-title"]') || query('.cs-chapter-title')).toBeTruthy();

    // Body is absent: the row body wrapper and its contents must not be in the DOM.
    expect(query('[data-testid="cs-row-body-ch-1"]')).toBeNull();
    expect(component.rows[0].collapsed).toBeTrue();
  });

  it('(collapse-toggle) clicking the chevron button expands then re-collapses a row', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'A summary.' }));
    fixture.detectChanges();

    // Initially collapsed — body absent.
    expect(query('[data-testid="cs-row-body-ch-1"]')).toBeNull();
    expect(component.isCollapsed(component.rows[0])).toBeTrue();

    // Click the toggle — body appears.
    query('[data-testid="cs-row-toggle-ch-1"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="cs-row-body-ch-1"]')).not.toBeNull();
    expect(component.isCollapsed(component.rows[0])).toBeFalse();

    // The title (in the header) is still visible.
    expect(query('[data-testid="cs-row-ch-1"]').query(By.css('.cs-chapter-title'))).not.toBeNull();

    // Click again — body collapses.
    query('[data-testid="cs-row-toggle-ch-1"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="cs-row-body-ch-1"]')).toBeNull();
    expect(component.isCollapsed(component.rows[0])).toBeTrue();
  });

  it('(collapse-all) collapse-all button collapses every row, expand-all expands them', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    // Start expanded so the "collapse all" action is meaningful.
    expandAllRows();
    expect(component.allCollapsed).toBeFalse();

    // Collapse all.
    query('[data-testid="cs-collapse-all-toggle"]').nativeElement.click();
    fixture.detectChanges();
    expect(component.rows.every((r) => component.isCollapsed(r))).toBeTrue();
    expect(component.allCollapsed).toBeTrue();

    // Button label is now "expand all" (he: הרחב הכל / en: Expand all).
    expect(query('[data-testid="cs-collapse-all-toggle"]').nativeElement.textContent).toContain(
      component.label('expandAll')
    );

    // Expand all.
    query('[data-testid="cs-collapse-all-toggle"]').nativeElement.click();
    fixture.detectChanges();
    expect(component.rows.every((r) => !component.isCollapsed(r))).toBeTrue();
    expect(component.allCollapsed).toBeFalse();

    // Button label is now "collapse all".
    expect(query('[data-testid="cs-collapse-all-toggle"]').nativeElement.textContent).toContain(
      component.label('collapseAll')
    );
  });

  it('(collapse-mid-edit) a row that is mid-edit stays expanded even if collapsed=true', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Text.' }));
    fixture.detectChanges();

    // Start editing via the direct method (which also sets collapsed=false).
    component.onEdit(component.rows[0]);
    fixture.detectChanges();

    // Force collapsed=true while editing to verify the guard overrides it.
    component.rows[0].collapsed = true;
    fixture.detectChanges();

    // isCollapsed returns false because editing=true overrides the collapsed flag.
    expect(component.isCollapsed(component.rows[0])).toBeFalse();
    // The body is still rendered (textarea visible).
    expect(query('[data-testid="cs-textarea-ch-1"]')).not.toBeNull();
  });

  it('(collapse-no-toggle-mid-edit) toggleRow() is a no-op while a row is being edited', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Text.' }));
    fixture.detectChanges();

    component.onEdit(component.rows[0]); // sets editing=true, collapsed=false
    fixture.detectChanges();

    // Attempt to toggle — must be ignored.
    component.toggleRow(component.rows[0]);
    fixture.detectChanges();

    // collapsed is still false (the no-op did NOT change it), and body is still visible.
    expect(component.rows[0].collapsed).toBeFalse();
    expect(component.isCollapsed(component.rows[0])).toBeFalse();
  });

  it('(collapse-after-save) row stays expanded after a successful save (body and rederive offer visible)', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();
    getSummarySubjects.get('ch-1')!.next(makeView({ chapterId: 'ch-1', summaryText: 'Old.' }));
    fixture.detectChanges();
    expandRow('ch-1');

    // Enter edit mode (onEdit also sets collapsed=false).
    query('[data-testid="cs-edit"]').nativeElement.click();
    fixture.detectChanges();
    component.rows[0].draft = 'Edited.';
    fixture.detectChanges();
    query('[data-testid="cs-save"]').nativeElement.click();
    updateSubject.next(makeView({ chapterId: 'ch-1', summaryText: 'Edited.', summaryUserEdited: true }));
    updateSubject.complete();
    fixture.detectChanges();

    // After save: editing=false but collapsed=false (set by onEdit), so body stays visible.
    expect(component.rows[0].collapsed).toBeFalse();
    expect(component.isCollapsed(component.rows[0])).toBeFalse();
    // Rederive offer is in the body — must be visible.
    expect(query('[data-testid="cs-rederive-offer"]')).not.toBeNull();
  });

  it('(collapse-he-en-labels) collapseAll / expandAll / expandRow labels present in both locales + no em-dash', () => {
    component.bookLanguage = 'he';
    fixture.detectChanges();
    const heCollapse = component.label('collapseAll');
    const heExpand = component.label('expandAll');
    const heRow = component.label('expandRow');
    expect(heCollapse).not.toBe('collapseAll');
    expect(heExpand).not.toBe('expandAll');
    expect(heRow).not.toBe('expandRow');
    expect(heCollapse.includes('—')).toBeFalse();
    expect(heExpand.includes('—')).toBeFalse();

    component.bookLanguage = 'en';
    fixture.detectChanges();
    const enCollapse = component.label('collapseAll');
    const enExpand = component.label('expandAll');
    const enRow = component.label('expandRow');
    expect(enCollapse).not.toBe('collapseAll');
    expect(enExpand).not.toBe('expandAll');
    expect(enRow).not.toBe('expandRow');
    // he and en genuinely differ
    expect(heCollapse).not.toBe(enCollapse);
    expect(heExpand).not.toBe(enExpand);
  });

  it('(collapse-rtl) chevron toggle button is present for RTL (Hebrew) books', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    // RTL book: dir='rtl' on the section.
    expect(query('[data-testid="chapter-summaries"]').nativeElement.getAttribute('dir')).toBe('rtl');
    // The toggle button renders in the header regardless of dir.
    expect(query('[data-testid="cs-row-toggle-ch-1"]')).not.toBeNull();
    // After expanding: aria-expanded=true.
    query('[data-testid="cs-row-toggle-ch-1"]').nativeElement.click();
    fixture.detectChanges();
    expect(
      query('[data-testid="cs-row-toggle-ch-1"]').nativeElement.getAttribute('aria-expanded')
    ).toBe('true');
  });

  // ── Re-derive offer / result collapse guard ───────────────────────────────

  it('(collapse-rederive-offer) collapseAll() skips a row with an active offerRederive, leaving it expanded', () => {
    triggerInit();
    // Two chapters so we can verify one collapses and the other stays expanded.
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    // Start all rows expanded.
    expandAllRows();
    expect(component.allCollapsed).toBeFalse();

    // Give row 0 a live re-derive offer.
    component.rows[0].offerRederive = true;
    fixture.detectChanges();

    // Collapse all.
    component.toggleCollapseAll();
    fixture.detectChanges();

    // Row 0 (offer live) must NOT be collapsed.
    expect(component.isCollapsed(component.rows[0])).toBeFalse();
    // Row 1 (no offer) must be collapsed.
    expect(component.isCollapsed(component.rows[1])).toBeTrue();
  });

  it('(collapse-rederive-result) collapseAll() skips a row with a terminal rederiveResult, leaving it expanded', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail());
    getByIdSubject.complete();
    fixture.detectChanges();

    expandAllRows();

    // Give row 1 a terminal result.
    component.rows[1].rederiveResult = 'done';
    fixture.detectChanges();

    component.toggleCollapseAll();
    fixture.detectChanges();

    // Row 1 (result live) stays expanded.
    expect(component.isCollapsed(component.rows[1])).toBeFalse();
    // Row 0 (no offer/result) collapses.
    expect(component.isCollapsed(component.rows[0])).toBeTrue();
  });

  it('(collapse-rederive-toggleRow) toggleRow() refuses to collapse a row with a live re-derive offer', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    // Start expanded and set a live offer.
    component.rows[0].collapsed = false;
    component.rows[0].offerRederive = true;
    fixture.detectChanges();

    expect(component.isCollapsed(component.rows[0])).toBeFalse();

    // Attempt to collapse via toggleRow — must be refused.
    component.toggleRow(component.rows[0]);
    fixture.detectChanges();

    // collapsed flag may have been toggled but isCollapsed must still return false.
    expect(component.isCollapsed(component.rows[0])).toBeFalse();
    // Body stays in the DOM (offer is visible).
    expect(query('[data-testid="cs-row-body-ch-1"]')).not.toBeNull();
    expect(query('[data-testid="cs-rederive-offer"]')).not.toBeNull();
  });

  it('(collapse-rederive-allCollapsed) allCollapsed is false while a row has a live re-derive offer even if collapsed=true', () => {
    triggerInit();
    getByIdSubject.next(makeBookDetail({ chapters: [makeBookDetail().chapters[0]] }));
    getByIdSubject.complete();
    fixture.detectChanges();

    // All rows start collapsed by default.
    expect(component.allCollapsed).toBeTrue();

    // Activate a live offer — now that row is forced-expanded, so allCollapsed must flip.
    component.rows[0].offerRederive = true;
    fixture.detectChanges();

    expect(component.allCollapsed).toBeFalse();
  });
});
