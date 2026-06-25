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
    builtWithModel: 'gemma4:12b',
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

    const row1 = query('[data-testid="cs-row-ch-1"]');
    const text = row1.query(By.css('[data-testid="cs-summary-text"]'));
    expect(text.nativeElement.textContent).toContain('Summary of one.');
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
      builtWithModel: 'gemma4:12b',
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
      builtWithModel: 'gemma4:12b',
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
    expect(component.label('title')).toBe('Chapter summaries');
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
});
