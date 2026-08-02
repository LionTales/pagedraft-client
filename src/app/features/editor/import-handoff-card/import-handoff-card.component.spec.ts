import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError, Subject } from 'rxjs';
import { ImportHandoffCardComponent } from './import-handoff-card.component';
import { BookSummaryService } from '../../../core/services/book-summary.service';
import { JobRegistryService } from '../../../core/services/job-registry.service';
import { BookSummaryStatusDto, StartBookSummaryBuildResponse } from '../../../core/models/book-summary';

// ── Factories ────────────────────────────────────────────────────────────────

function makeStatus(overrides: Partial<BookSummaryStatusDto> = {}): BookSummaryStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    totalChapters: 5,
    builtChapters: 0,
    staleCount: 0,
    hasSummary: false,
    ready: false,
    lastUpdatedAt: null,
    builtWithDifferentModel: false,
    activeBuildJobId: null,
    chaptersToBuild: 5,
    estimatedSeconds: 120,
    estimatedUsd: null,
    ...overrides,
  };
}

function makeReadyStatus(): BookSummaryStatusDto {
  return makeStatus({ hasSummary: true, ready: true, builtChapters: 5, staleCount: 0 });
}

function makeBuildingStatus(jobId = 'job-1'): BookSummaryStatusDto {
  return makeStatus({ activeBuildJobId: jobId });
}

function makeBuildResponse(overrides: Partial<StartBookSummaryBuildResponse> = {}): StartBookSummaryBuildResponse {
  return {
    jobId: 'job-1',
    language: 'he',
    noOp: false,
    ready: false,
    builtChapters: 0,
    totalChapters: 5,
    staleCount: 0,
    ...overrides,
  };
}

describe('ImportHandoffCardComponent', () => {
  let component: ImportHandoffCardComponent;
  let fixture: ComponentFixture<ImportHandoffCardComponent>;
  let summaryServiceSpy: jasmine.SpyObj<BookSummaryService>;
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    summaryServiceSpy = jasmine.createSpyObj('BookSummaryService', [
      'getBookSummaryStatus',
      'buildBookSummary',
    ]);
    jobRegistrySpy = jasmine.createSpyObj('JobRegistryService', ['track']);

    // Default: status returns not-built
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeStatus()));

    await TestBed.configureTestingModule({
      imports: [ImportHandoffCardComponent, RouterTestingModule],
      providers: [
        { provide: BookSummaryService, useValue: summaryServiceSpy },
        { provide: JobRegistryService, useValue: jobRegistrySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportHandoffCardComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.importedChapters = 5;
    component.importedWords = 12000;
    component.importedParts = 2;
    // Manually trigger ngOnChanges because setting inputs directly on a standalone component
    // does not cause Angular to invoke ngOnChanges automatically (no host binding involved).
    component.ngOnChanges({
      bookId: { currentValue: 'book-1', previousValue: null, firstChange: true, isFirstChange: () => true },
      bookLanguage: { currentValue: 'he', previousValue: null, firstChange: true, isFirstChange: () => true },
    });
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  // ── State: loadStatus on init ────────────────────────────────────────────────

  it('loads summary status on init and exposes summaryState', () => {
    expect(summaryServiceSpy.getBookSummaryStatus).toHaveBeenCalledWith('book-1', 'he');
    expect(component.summaryState).toBe('not-built');
  });

  it('summaryState is ready when status.ready is true', () => {
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeReadyStatus()));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: true, isFirstChange: () => true } });
    expect(component.summaryState).toBe('ready');
  });

  it('summaryState is building when activeBuildJobId is non-null', () => {
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeBuildingStatus()));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });
    expect(component.summaryState).toBe('building');
  });

  it('summaryState falls back to unknown when status load fails', () => {
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(throwError(() => new Error('fail')));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });
    expect(component.summaryState).toBe('unknown');
  });

  // ── Derived labels ───────────────────────────────────────────────────────────

  it('chapterCountLabel reflects importedChapters input (Hebrew)', () => {
    expect(component.chapterCountLabel).toContain('5');
    expect(component.chapterCountLabel).toContain('פרקים');
  });

  it('chapterCountLabel reflects importedChapters input (English)', () => {
    component.bookLanguage = 'en';
    expect(component.chapterCountLabel).toContain('5');
    expect(component.chapterCountLabel).toContain('chapters');
  });

  it('wordTotalLabel shows formatted word count', () => {
    expect(component.wordTotalLabel).toContain('12');
  });

  it('partsLabel shows part count when non-zero', () => {
    expect(component.partsLabel).toContain('2');
  });

  it('partsLabel is empty when importedParts is 0', () => {
    component.importedParts = 0;
    expect(component.partsLabel).toBe('');
  });

  it('estimateLabel is empty when status is ready', () => {
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeReadyStatus()));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });
    expect(component.estimateLabel).toBe('');
  });

  it('estimateLabel shows chapter + minute estimate when not-built', () => {
    // status is not-built by default; 120s = 2 min
    expect(component.estimateLabel).toContain('5');
    expect(component.estimateLabel).toContain('2');
  });

  it('consentInfoLabel is empty when already ready', () => {
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeReadyStatus()));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });
    expect(component.consentInfoLabel).toBe('');
  });

  // ── onStartReview: consent gate — NOT_BUILT ──────────────────────────────────

  it('onStartReview (not-built) calls buildBookSummary, registers job, emits startReview', fakeAsync(() => {
    let emitted = false;
    component.startReview.subscribe(() => emitted = true);
    summaryServiceSpy.buildBookSummary.and.returnValue(of(makeBuildResponse()));

    component.onStartReview();
    tick();

    expect(summaryServiceSpy.buildBookSummary).toHaveBeenCalledWith('book-1', 'he');
    expect(jobRegistrySpy.track).toHaveBeenCalledWith('summary', 'book-1', 'job-1');
    expect(emitted).toBe(true);
  }));

  it('onStartReview on a no-op build (already ready) still emits startReview', fakeAsync(() => {
    let emitted = false;
    component.startReview.subscribe(() => emitted = true);
    summaryServiceSpy.buildBookSummary.and.returnValue(of(makeBuildResponse({ noOp: true, jobId: null })));

    component.onStartReview();
    tick();

    expect(emitted).toBe(true);
    // No job to register when noOp
    expect(jobRegistrySpy.track).not.toHaveBeenCalled();
  }));

  it('onStartReview emits startReview even when buildBookSummary errors (non-blocking)', fakeAsync(() => {
    let emitted = false;
    component.startReview.subscribe(() => emitted = true);
    summaryServiceSpy.buildBookSummary.and.returnValue(throwError(() => new Error('build failed')));

    component.onStartReview();
    tick();

    expect(emitted).toBe(true);
  }));

  // ── onStartReview: READY state — skip build ──────────────────────────────────

  it('onStartReview (ready) skips buildBookSummary and emits startReview immediately', () => {
    let emitted = false;
    component.startReview.subscribe(() => emitted = true);
    // Force ready state
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeReadyStatus()));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });

    component.onStartReview();

    expect(summaryServiceSpy.buildBookSummary).not.toHaveBeenCalled();
    expect(emitted).toBe(true);
  });

  // ── onStartReview: BUILDING state — skip POST, attach to existing job ─────────

  it('onStartReview (building) skips buildBookSummary, tracks in registry, emits startReview', () => {
    let emitted = false;
    component.startReview.subscribe(() => emitted = true);
    summaryServiceSpy.getBookSummaryStatus.and.returnValue(of(makeBuildingStatus('job-running')));
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });

    component.onStartReview();

    expect(summaryServiceSpy.buildBookSummary).not.toHaveBeenCalled();
    expect(jobRegistrySpy.track).toHaveBeenCalledWith('summary', 'book-1', 'job-running');
    expect(emitted).toBe(true);
  });

  // ── Double-fire guard ─────────────────────────────────────────────────────────

  it('double-click on Start review does not fire buildBookSummary twice', fakeAsync(() => {
    const buildSubject = new Subject<StartBookSummaryBuildResponse>();
    summaryServiceSpy.buildBookSummary.and.returnValue(buildSubject.asObservable());

    component.onStartReview();
    component.onStartReview(); // second click while first is in flight

    buildSubject.next(makeBuildResponse());
    buildSubject.complete();
    tick();

    expect(summaryServiceSpy.buildBookSummary).toHaveBeenCalledTimes(1);
  }));

  it('startReviewDisabled is true after the first click (before response)', () => {
    const buildSubject = new Subject<StartBookSummaryBuildResponse>();
    summaryServiceSpy.buildBookSummary.and.returnValue(buildSubject.asObservable());

    component.onStartReview();

    expect(component.disabledStartReview).toBe(true);
    expect(component.startReviewDisabled).toBe(true);
  });

  // ── Escape hatch ──────────────────────────────────────────────────────────────

  it('onEditMode emits editMode without touching the build', () => {
    let emitted = false;
    component.editMode.subscribe(() => emitted = true);

    component.onEditMode();

    expect(emitted).toBe(true);
    expect(summaryServiceSpy.buildBookSummary).not.toHaveBeenCalled();
  });

  // ── Singular / plural + thousands separators ──────────────────────────────────

  it('chapterCountLabel uses singular noun for n=1 (Hebrew)', () => {
    component.importedChapters = 1;
    expect(component.chapterCountLabel).toBe('1 פרק');
  });

  it('chapterCountLabel uses plural noun for n>1 (Hebrew)', () => {
    component.importedChapters = 3;
    expect(component.chapterCountLabel).toContain('פרקים');
  });

  it('chapterCountLabel uses singular noun for n=1 (English)', () => {
    component.importedChapters = 1;
    component.bookLanguage = 'en';
    expect(component.chapterCountLabel).toBe('1 chapter');
  });

  it('chapterCountLabel uses plural noun for n>1 (English)', () => {
    component.importedChapters = 3;
    component.bookLanguage = 'en';
    expect(component.chapterCountLabel).toContain('chapters');
  });

  it('chapterCountLabel includes thousands separator for large numbers (English)', () => {
    component.importedChapters = 1000;
    component.bookLanguage = 'en';
    // toLocaleString produces '1,000' in en locale
    expect(component.chapterCountLabel).toContain('1,000');
    expect(component.chapterCountLabel).toContain('chapters');
  });

  it('wordTotalLabel uses singular noun for n=1 (Hebrew)', () => {
    component.importedWords = 1;
    expect(component.wordTotalLabel).toBe('1 מילה');
  });

  it('wordTotalLabel uses plural noun for n>1 (Hebrew)', () => {
    component.importedWords = 5;
    expect(component.wordTotalLabel).toContain('מילים');
  });

  it('wordTotalLabel uses singular noun for n=1 (English)', () => {
    component.importedWords = 1;
    component.bookLanguage = 'en';
    expect(component.wordTotalLabel).toBe('1 word');
  });

  it('wordTotalLabel uses plural noun for n>1 (English)', () => {
    component.importedWords = 5;
    component.bookLanguage = 'en';
    expect(component.wordTotalLabel).toContain('words');
  });

  it('wordTotalLabel applies thousands separator for large numbers (English)', () => {
    component.importedWords = 12000;
    component.bookLanguage = 'en';
    expect(component.wordTotalLabel).toContain('12,000');
    expect(component.wordTotalLabel).toContain('words');
  });

  it('partsLabel uses singular noun for n=1 (Hebrew)', () => {
    component.importedParts = 1;
    expect(component.partsLabel).toBe('1 חלק');
  });

  it('partsLabel uses plural noun for n>1 (Hebrew)', () => {
    component.importedParts = 3;
    expect(component.partsLabel).toContain('חלקים');
  });

  it('partsLabel uses singular noun for n=1 (English)', () => {
    component.importedParts = 1;
    component.bookLanguage = 'en';
    expect(component.partsLabel).toBe('1 part');
  });

  it('partsLabel uses plural noun for n>1 (English)', () => {
    component.importedParts = 3;
    component.bookLanguage = 'en';
    expect(component.partsLabel).toContain('parts');
  });

  it('partsLabel applies thousands separator for large numbers (English)', () => {
    component.importedParts = 1000;
    component.bookLanguage = 'en';
    expect(component.partsLabel).toContain('1,000');
    expect(component.partsLabel).toContain('parts');
  });

  // ── i18n / direction ──────────────────────────────────────────────────────────

  it('dir is rtl for Hebrew books', () => {
    component.bookLanguage = 'he';
    expect(component.dir).toBe('rtl');
    expect(component.isHe).toBe(true);
  });

  it('dir is ltr for English books', () => {
    component.bookLanguage = 'en';
    expect(component.dir).toBe('ltr');
    expect(component.isHe).toBe(false);
  });

  // ── Stale guard on book switch ────────────────────────────────────────────────

  it('drops a stale status response when bookId changes before it resolves', fakeAsync(() => {
    // Two separate subjects — one per book so the switch truly tests the stale guard.
    const book1Subject = new Subject<BookSummaryStatusDto>();
    const book2Subject = new Subject<BookSummaryStatusDto>();
    // First call (book-1) returns the slow subject; subsequent call (book-2) returns the second.
    summaryServiceSpy.getBookSummaryStatus.and.returnValues(
      book1Subject.asObservable(),
      book2Subject.asObservable(),
    );

    // Trigger load for book-1 (starts a subscription to book1Subject)
    component.bookId = 'book-1';
    component.ngOnChanges({ bookId: { currentValue: 'book-1', previousValue: null, firstChange: false, isFirstChange: () => false } });

    // Switch to book-2 BEFORE book-1 responds: resetState unsubscribes the book-1 subscription.
    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: { currentValue: 'book-2', previousValue: 'book-1', firstChange: false, isFirstChange: () => false } });

    // Now the book-1 response arrives on book1Subject. Since the subscription was unsubscribed
    // during resetState, the response is never delivered at all — summaryStatus stays null.
    book1Subject.next(makeReadyStatus());
    tick();

    // The state was already reset for book-2 (which has no response yet)
    expect(component.summaryStatus).toBeNull();
  }));

  // ── No bookId guard ───────────────────────────────────────────────────────────

  it('does not load status when bookId is null', () => {
    summaryServiceSpy.getBookSummaryStatus.calls.reset();
    component.bookId = null;
    component.ngOnChanges({ bookId: { currentValue: null, previousValue: 'book-1', firstChange: false, isFirstChange: () => false } });
    expect(summaryServiceSpy.getBookSummaryStatus).not.toHaveBeenCalled();
  });

  it('onStartReview emits startReview immediately when bookId is null (non-blocking)', () => {
    component.bookId = null;
    component.summaryStatus = null; // force unknown state
    let emitted = false;
    component.startReview.subscribe(() => emitted = true);

    component.onStartReview();

    expect(emitted).toBe(true);
    expect(summaryServiceSpy.buildBookSummary).not.toHaveBeenCalled();
  });

  // ── chapterCountLabel falls back to totalChapters from status when importedChapters is null ──

  it('chapterCountLabel falls back to totalChapters from status when importedChapters is null', () => {
    component.importedChapters = null;
    // status already loaded (makeStatus has totalChapters=5)
    expect(component.chapterCountLabel).toContain('5');
  });

  it('chapterCountLabel is empty when both importedChapters and summaryStatus are null', () => {
    component.importedChapters = null;
    component.summaryStatus = null;
    expect(component.chapterCountLabel).toBe('');
  });
});
