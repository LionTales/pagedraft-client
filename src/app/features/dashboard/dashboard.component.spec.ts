import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { DashboardComponent } from './dashboard.component';
import { BookDto } from '../../core/models/book';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import { STAGE_NAMES } from '../../shared/stage-spine/stage-spine.copy';

/**
 * Wave 3 / w3 - the BOOKS LIST as the first place a user is oriented.
 *
 * This surface had NO stage indicator at all, which is exactly where it hurt: the books list is where
 * importing is the next action, so the one stage the product could not compute there was the one the user
 * was standing on. It now renders the COMPACT stage spine per row.
 *
 * THE COST CONTRACT IS THE POINT OF THIS SUITE. A per-book indicator is only worth having if it does not
 * turn one list request into 1 + 4N. `describe('the request budget')` pins that: exactly one HTTP request
 * for the whole page, whatever the row count, and no status request is ever issued for a row. Where a
 * stage cannot be computed from that single payload the row says so ("not known here") rather than
 * fetching, which is the standing rule - show less, never guess and never fan out.
 */

function book(overrides: Partial<BookDto> = {}): BookDto {
  return {
    id: 'book-1',
    title: 'My Book',
    author: null,
    language: 'he',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    aiTier: 'fast',
    chapterCount: 0,
    chaptersWithTextCount: 0,
    ...overrides,
  };
}

function runningJob(bookId: string, kind: 'summary' | 'review'): TrackedJob {
  return {
    id: `${kind}-${bookId}`, kind, bookId, scopeLabel: 'Whole book',
    titleHe: 'בנייה', titleEn: 'Build', status: 'running', percent: 5,
    completedChunks: null, totalChunks: null, chunkClock: EMPTY_CHUNK_CLOCK,
    message: '', startedAt: '', updatedAt: '',
  };
}

describe('DashboardComponent (books list, Wave 3 / w3)', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let httpMock: HttpTestingController;
  let activeJobs$: BehaviorSubject<TrackedJob[]>;

  beforeEach(async () => {
    activeJobs$ = new BehaviorSubject<TrackedJob[]>([]);
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The registry is an in-memory view-model; the stub emits nothing until a test pushes a job, which
        // is the honest default (absence of a tracked job is not evidence that nothing is running).
        { provide: JobRegistryService, useValue: { activeJobs$: activeJobs$.asObservable() } },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Render the page and answer the books-list request with the given rows. */
  function load(books: BookDto[]): void {
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith('/api/books')).flush(books);
    fixture.detectChanges();
  }

  function compactSpines(): HTMLElement[] {
    return fixture.debugElement
      .queryAll(By.css('[data-testid="stage-spine-compact"]'))
      .map(d => d.nativeElement as HTMLElement);
  }

  function pipState(rowIndex: number, stage: string): string {
    const spine = compactSpines()[rowIndex];
    return (spine.querySelector(`[data-testid="spine-compact-pip-${stage}"]`) as HTMLElement)
      .dataset['state'] ?? '';
  }

  // ── THE REQUEST BUDGET ──────────────────────────────────────────────────────────────────────────

  describe('the request budget', () => {
    it('makes EXACTLY ONE request for the whole page, with three books on it', () => {
      fixture.detectChanges();
      const list = httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith('/api/books'));
      list.flush([
        book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 }),
        book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 }),
        book({ id: 'c', chapterCount: 3, chaptersWithTextCount: 0 }),
      ]);
      fixture.detectChanges();

      // Three rows, three spines - and no second request of any kind. httpMock.verify() in afterEach is
      // the fence: any per-row status/summary/review/chapters call would fail the suite here.
      expect(compactSpines().length).toBe(3);
      httpMock.verify();
    });

    it('issues no per-row status request even when a row has chapters and could have briefs', () => {
      load([book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 })]);
      // The rule: rather than fetch the briefs status per row, the row says it does not know from here.
      expect(pipState(0, 'briefs')).toBe('unknown');
      expect(pipState(0, 'review')).toBe('unknown');
      expect(compactSpines()[0].textContent).toContain('לא ידוע מכאן');
    });
  });

  // ── WHAT THE ROW ACTUALLY COMPUTES ──────────────────────────────────────────────────────────────

  describe('what a row computes from the M1 counts', () => {
    it('an EMPTY book reads not-started on Import and blocked on everything downstream', () => {
      load([book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 })]);
      expect(pipState(0, 'import')).toBe('not-started');
      expect(pipState(0, 'briefs')).toBe('blocked');
      expect(pipState(0, 'review')).toBe('blocked');
      // NOTHING reads done. That defect is the reason this wave exists.
      expect(compactSpines()[0].querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('a book with text reads ready on Import', () => {
      load([book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 })]);
      expect(pipState(0, 'import')).toBe('ready');
    });

    it('chapters with NO text are not an import: the row stays not-started', () => {
      load([book({ id: 'c', chapterCount: 3, chaptersWithTextCount: 0 })]);
      expect(pipState(0, 'import')).toBe('not-started');
    });

    // w4: Export became REAL on this surface for free. It is derived from `chapterCount` alone, which the
    // books-list payload already carries, so the books list needed no new request to stop saying "no
    // export screen" - and it says something different per row, which a constant never could.
    it('Export reads ready on a row with chapters, now that the export screen exists (w4)', () => {
      load([book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 })]);
      expect(pipState(0, 'export')).toBe('ready');
    });

    it('Export reads blocked on an EMPTY book row: there is nothing to put in a file', () => {
      load([book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 })]);
      expect(pipState(0, 'export')).toBe('blocked');
    });

    it('never reads unavailable on any row, whatever the counts say', () => {
      load([
        book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 }),
        book({ id: 'b', chapterCount: 3, chaptersWithTextCount: 0 }),
        book({ id: 'c', chapterCount: 9, chaptersWithTextCount: 9 }),
      ]);
      [0, 1, 2].forEach(row => expect(pipState(row, 'export')).not.toBe('unavailable'));
    });
  });

  // ── THE RUNNING SIGNAL, FOR FREE ────────────────────────────────────────────────────────────────

  describe('the running signal', () => {
    it('raises the row whose build the registry is tracking, and only that row, and only that stage', () => {
      load([
        book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 }),
        book({ id: 'b', chapterCount: 4, chaptersWithTextCount: 4 }),
      ]);
      expect(pipState(0, 'briefs')).toBe('unknown');

      activeJobs$.next([runningJob('a', 'summary')]);
      fixture.detectChanges();

      expect(pipState(0, 'briefs')).toBe('running');
      // A briefs build is not a review build.
      expect(pipState(0, 'review')).toBe('unknown');
      // And book b, which has no tracked job, is NOT claimed idle - it is still simply not known.
      expect(pipState(1, 'briefs')).toBe('unknown');
    });

    it('drops back to not-known (never to "done") when the build finishes', () => {
      load([book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 })]);
      activeJobs$.next([runningJob('a', 'review')]);
      fixture.detectChanges();
      expect(pipState(0, 'review')).toBe('running');

      activeJobs$.next([]);
      fixture.detectChanges();
      expect(pipState(0, 'review')).toBe('unknown');
    });
  });

  // ── THE LANGUAGE RULE ───────────────────────────────────────────────────────────────────────────

  describe('the language rule at the compact-to-full transition', () => {
    it('each row speaks ITS OWN BOOK language, so opening the book never flips the spine', () => {
      load([
        book({ id: 'he-book', language: 'he', chapterCount: 0, chaptersWithTextCount: 0 }),
        book({ id: 'en-book', language: 'en', chapterCount: 0, chaptersWithTextCount: 0 }),
      ]);

      const [heSpine, enSpine] = compactSpines();
      expect(heSpine.getAttribute('dir')).toBe('rtl');
      expect(heSpine.textContent).toContain(STAGE_NAMES['import'].he);
      expect(enSpine.getAttribute('dir')).toBe('ltr');
      expect(enSpine.textContent).toContain(STAGE_NAMES['import'].en);
      expect(enSpine.textContent).not.toContain(STAGE_NAMES['import'].he);
    });

    it('the app-level chrome around the rows stays Hebrew-default, unchanged by the per-book rule', () => {
      load([book({ id: 'en-book', language: 'en' })]);
      const page = fixture.nativeElement.querySelector('.dashboard') as HTMLElement;
      expect(page.getAttribute('dir')).toBe('rtl');
      expect(component.label('newBook')).toBe('ספר חדש');
    });
  });
});
