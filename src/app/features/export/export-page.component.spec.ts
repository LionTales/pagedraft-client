/**
 * Wave 3 / w4 - the export screen.
 *
 * BOTH DOCUMENT PATHS ARE EXERCISED THROUGH THE UI HERE, not just at the wire (`export.service.spec.ts`
 * covers that half). Book-level export and single-chapter export are separate paths that have drifted
 * before, and this screen is the first surface that exposes both, so each of them is driven from a real
 * click: the right call with the right ids, the same running affordance, the same save, and error copy that
 * differs only where the paths genuinely differ (a 404 on a chapter is not a 404 on a book).
 *
 * The service is stubbed - this suite is about the screen, and the transfer has its own suite - but the stub
 * records what it was asked for, so a screen that called the book endpoint for the chapter kind would fail
 * here rather than pass quietly.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, Subject, throwError } from 'rxjs';

import { BookDetailDto, ChapterSummaryDto } from '../../core/models/book';
import {
  EXPORT_REASON_NOTHING_WRITTEN,
  ExportFailure,
  ExportSkipReport,
  ExportedFile,
} from '../../core/models/export';
import { BookService } from '../../core/services/book.service';
import { ExportService } from '../../core/services/export.service';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { ExportPageComponent } from './export-page.component';
import { EXPORT_COPY, EXPORT_ERRORS, EXPORT_KINDS, SKIPPED_UNKNOWN } from './export-kinds';

const BOOK_ID = 'book-1';

function chapter(order: number, overrides: Partial<ChapterSummaryDto> = {}): ChapterSummaryDto {
  return {
    id: `ch-${order}`,
    title: `Chapter ${order + 1}`,
    partName: null,
    order,
    wordCount: 900,
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

function book(language: string, chapters: ChapterSummaryDto[]): BookDetailDto {
  return {
    id: BOOK_ID,
    title: 'A Book',
    author: null,
    language,
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    aiTier: 'fast',
    chapters,
  };
}

/**
 * A landed file. The default skip report is what a current server sends on a complete export: a report of
 * ZERO, not an absent one - the two are different facts and the screen says something different for each.
 */
function file(name: string, skipped: ExportSkipReport | null = { count: 0, chapters: [] }): ExportedFile {
  return { blob: new Blob(['x']), fileName: name, skipped };
}

describe('ExportPageComponent (Wave 3 / w4)', () => {
  let fixture: ComponentFixture<ExportPageComponent>;
  let component: ExportPageComponent;
  /**
   * The CURRENT book-load Subject. Reassigned by tests that need a fresh one (a same-route bookId change
   * needs its OWN Subject, held open independently of the first book's, because `getById` is stubbed to
   * always read whatever this variable currently points at - see {@link bookRequests}).
   */
  let bookSubject: Subject<BookDetailDto>;
  /** Every id the screen asked `BookService.getById` for, in order - what proves a reload actually fired. */
  let bookRequests: string[];
  /**
   * The route's `bookId` param, as a held-open `BehaviorSubject` rather than a fixed `snapshot`: Finding 15
   * is exactly this - a same-route navigation changes this value without the route or the component being
   * recreated, and the fix is a `params` subscription that reacts to it.
   */
  let paramsSubject: BehaviorSubject<{ bookId: string | null }>;
  let activeJobs$: BehaviorSubject<TrackedJob[]>;

  /** What the screen asked the service for, in order. The seam that catches a mis-wired kind. */
  let calls: string[];
  /** Files the screen handed to the browser. */
  let saved: ExportedFile[];
  /**
   * What each call answers with. Held-open Subjects by default, so a test can assert the IN-FLIGHT window
   * before deciding the outcome; a failure test replaces the whole factory with a throwing one.
   */
  let bookFiles: Subject<ExportedFile>;
  let chapterFiles: Subject<ExportedFile>;
  let bookResponse: () => Observable<ExportedFile>;
  let chapterResponse: () => Observable<ExportedFile>;

  beforeEach(async () => {
    bookSubject = new Subject<BookDetailDto>();
    bookRequests = [];
    paramsSubject = new BehaviorSubject<{ bookId: string | null }>({ bookId: BOOK_ID });
    activeJobs$ = new BehaviorSubject<TrackedJob[]>([]);
    calls = [];
    saved = [];
    bookFiles = new Subject<ExportedFile>();
    chapterFiles = new Subject<ExportedFile>();
    bookResponse = () => bookFiles.asObservable();
    chapterResponse = () => chapterFiles.asObservable();

    const exportStub: Partial<ExportService> = {
      exportBook: (bookId: string) => {
        calls.push(`book:${bookId}`);
        return bookResponse();
      },
      exportChapter: (bookId: string, chapterId: string) => {
        calls.push(`chapter:${bookId}:${chapterId}`);
        return chapterResponse();
      },
      saveAs: (f: ExportedFile) => {
        saved.push(f);
      },
    };

    await TestBed.configureTestingModule({
      imports: [ExportPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { params: paramsSubject.asObservable() } },
        {
          provide: BookService,
          useValue: {
            getById: (id: string) => {
              bookRequests.push(id);
              return bookSubject.asObservable();
            },
          },
        },
        { provide: ExportService, useValue: exportStub },
        { provide: JobRegistryService, useValue: { activeJobs$: activeJobs$.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Land the book payload and render. */
  function loadBook(language = 'he', chapters: ChapterSummaryDto[] = [chapter(0), chapter(1), chapter(2)]): void {
    bookSubject.next(book(language, chapters));
    bookSubject.complete();
    fixture.detectChanges();
  }

  function el(testId: string): HTMLElement | null {
    const found = fixture.debugElement.query(By.css(`[data-testid="${testId}"]`));
    return found ? (found.nativeElement as HTMLElement) : null;
  }

  function click(testId: string): void {
    const target = el(testId);
    expect(target).withContext(`[data-testid="${testId}"] must exist`).not.toBeNull();
    target!.click();
    fixture.detectChanges();
  }

  // ── The list of kinds ────────────────────────────────────────────────────────────────────────────

  describe('the list of export kinds', () => {
    it('renders one row per kind in the catalog, not two hardcoded buttons', () => {
      loadBook();
      const rows = fixture.debugElement.queryAll(By.css('[data-testid^="export-kind-"]'));
      expect(rows.length).toBe(EXPORT_KINDS.length);
      EXPORT_KINDS.forEach(kind => expect(el(`export-kind-${kind.id}`)).not.toBeNull());
    });

    it('offers the chapter picker on the chapter kind only, seeded to the first chapter', () => {
      loadBook();
      expect(el('export-chapter-select')).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('[data-testid="export-chapter-select"]')).length).toBe(1);
      expect(component.selectedChapterId).toBe('ch-0');
    });
  });

  // ── BOTH DOCUMENT PATHS, driven from the UI ─────────────────────────────────────────────────────

  describe('the book path', () => {
    it('calls the book export for this book and saves the file the server named', () => {
      loadBook();
      click('export-download-book-docx');

      expect(calls).toEqual([`book:${BOOK_ID}`]);

      bookFiles.next(file('הספר שלי.docx'));
      fixture.detectChanges();

      expect(saved.map(f => f.fileName)).toEqual(['הספר שלי.docx']);
      expect(el('export-done-book-docx')!.textContent).toContain('הספר שלי.docx');
    });

    it('shows the in-progress affordance while the request is in flight, and clears it after', () => {
      loadBook();
      click('export-download-book-docx');

      expect(el('export-busy-book-docx')).not.toBeNull();
      expect((el('export-download-book-docx') as HTMLButtonElement).disabled).toBeTrue();
      expect(el('export-download-book-docx')!.textContent!.trim()).toBe(EXPORT_COPY.preparing.he);

      bookFiles.next(file('b.docx'));
      fixture.detectChanges();

      expect(el('export-busy-book-docx')).toBeNull();
      expect((el('export-download-book-docx') as HTMLButtonElement).disabled).toBeFalse();
    });

    it('does not start a second export while one is running', () => {
      loadBook();
      click('export-download-book-docx');
      component.startExport(EXPORT_KINDS[0]);
      expect(calls.length).toBe(1);
    });
  });

  describe('the chapter path', () => {
    it('calls the CHAPTER export with the picked chapter, never the book export', () => {
      loadBook();
      component.selectedChapterId = 'ch-2';
      fixture.detectChanges();

      click('export-download-chapter-docx');

      expect(calls).toEqual([`chapter:${BOOK_ID}:ch-2`]);
    });

    it('saves the chapter file under the name the server chose', () => {
      loadBook();
      click('export-download-chapter-docx');
      chapterFiles.next(file('פרק שני.docx'));
      fixture.detectChanges();

      expect(saved.map(f => f.fileName)).toEqual(['פרק שני.docx']);
      expect(el('export-done-chapter-docx')!.textContent).toContain('פרק שני.docx');
    });

    it('shows its own in-progress affordance, on its own row only', () => {
      loadBook();
      click('export-download-chapter-docx');
      expect(el('export-busy-chapter-docx')).not.toBeNull();
      expect(el('export-busy-book-docx')).toBeNull();
    });
  });

  // ── Honest errors ────────────────────────────────────────────────────────────────────────────────

  describe('failures', () => {
    function failWith(failure: ExportFailure, path: 'book' | 'chapter'): void {
      if (path === 'book') bookResponse = () => throwError(() => failure);
      else chapterResponse = () => throwError(() => failure);
    }

    it('says there is nothing to export when the server answers 409 noChapters', () => {
      loadBook();
      failWith({ status: 409, reason: 'noChapters' }, 'book');
      click('export-download-book-docx');

      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.noChapters.he);
      expect(el('export-busy-book-docx')).toBeNull();
    });

    it('a 404 on the BOOK path speaks about the book', () => {
      loadBook();
      failWith({ status: 404, reason: null }, 'book');
      click('export-download-book-docx');
      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.bookNotFound.he);
    });

    it('a 404 on the CHAPTER path speaks about the chapter, which is the path-specific case', () => {
      loadBook();
      failWith({ status: 404, reason: null }, 'chapter');
      click('export-download-chapter-docx');
      expect(el('export-error-chapter-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.chapterNotFound.he);
    });

    it('a request that never reached the server names the connection, not the book', () => {
      loadBook();
      failWith({ status: 0, reason: null }, 'book');
      click('export-download-book-docx');
      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.offline.he);
    });

    it('an unrecognized failure gets the generic sentence rather than an invented cause', () => {
      loadBook();
      failWith({ status: 500, reason: null }, 'book');
      click('export-download-book-docx');
      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.generic.he);
    });

    it('clears the previous error when the same kind is retried', () => {
      loadBook();
      failWith({ status: 500, reason: null }, 'book');
      click('export-download-book-docx');
      expect(el('export-error-book-docx')).not.toBeNull();

      bookResponse = () => bookFiles.asObservable();
      click('export-download-book-docx');
      expect(el('export-error-book-docx')).toBeNull();
      bookFiles.next(file('b.docx'));
      fixture.detectChanges();
      expect(saved.length).toBe(1);
    });

    /**
     * The server's SECOND 409 token. The book kind and the chapter kind get different sentences on purpose:
     * a whole book with no writing in it can be filled by an import, a single empty chapter cannot.
     */
    it('says the file would have been empty when the BOOK path answers 409 nothingWritten', () => {
      loadBook();
      failWith({ status: 409, reason: EXPORT_REASON_NOTHING_WRITTEN }, 'book');
      click('export-download-book-docx');

      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.nothingWrittenBook.he);
      // Not the no-chapters sentence: this book HAS chapters, and telling the author to import is wrong.
      expect(el('export-error-book-docx')!.textContent!.trim()).not.toBe(EXPORT_ERRORS.noChapters.he);
    });

    it('speaks about the CHAPTER when the chapter path answers 409 nothingWritten, which used to be a 200', () => {
      loadBook();
      failWith({ status: 409, reason: EXPORT_REASON_NOTHING_WRITTEN }, 'chapter');
      click('export-download-chapter-docx');

      expect(el('export-error-chapter-docx')!.textContent!.trim())
        .toBe(EXPORT_ERRORS.nothingWrittenChapter.he);
    });

    it('renders the nothingWritten sentences in English on an English book, both kinds', () => {
      loadBook('en');
      failWith({ status: 409, reason: EXPORT_REASON_NOTHING_WRITTEN }, 'book');
      click('export-download-book-docx');
      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.nothingWrittenBook.en);

      failWith({ status: 409, reason: EXPORT_REASON_NOTHING_WRITTEN }, 'chapter');
      click('export-download-chapter-docx');
      expect(el('export-error-chapter-docx')!.textContent!.trim())
        .toBe(EXPORT_ERRORS.nothingWrittenChapter.en);
    });

    it('leaves an error on the row that produced it, not on the other kind', () => {
      loadBook();
      failWith({ status: 404, reason: null }, 'chapter');
      click('export-download-chapter-docx');
      expect(el('export-error-chapter-docx')).not.toBeNull();
      expect(el('export-error-book-docx')).toBeNull();
    });
  });

  // ── What the downloaded file does NOT contain (be-c02's client half) ────────────────────────────
  //
  // The exporter leaves out a chapter with nothing written in it. Told nothing, an author who finds a gap
  // in their own manuscript cannot tell a skip from data loss, so a successful download names what it left
  // out - from the SERVER's headers, never from a client-side guess at which chapters look empty.

  describe('chapters left out of a downloaded file', () => {
    it('says nothing extra when the server reports a complete file', () => {
      loadBook();
      click('export-download-book-docx');
      bookFiles.next(file('b.docx', { count: 0, chapters: [] }));
      fixture.detectChanges();

      expect(el('export-done-book-docx')).not.toBeNull();
      expect(el('export-skipped-book-docx')).toBeNull();
    });

    it('names the skipped chapters, numbered as the picker numbers them', () => {
      loadBook();
      click('export-download-book-docx');
      // Raw zero-based orders on the wire; the screen owns display numbering.
      bookFiles.next(file('b.docx', {
        count: 2,
        chapters: [{ order: 1, title: 'הסופה' }, { order: 4, title: 'הלילה הארוך' }],
      }));
      fixture.detectChanges();

      const notice = el('export-skipped-book-docx')!.textContent!;
      expect(notice).toContain('2');
      expect(notice).toContain('2. הסופה');
      expect(notice).toContain('5. הלילה הארוך');
    });

    /**
     * The server bounds the named list so a long book cannot blow a proxy's header budget: the COUNT is
     * authoritative and the list may name fewer. The sentence must not read as if the list were all of it.
     */
    it('renders the authoritative count when the list names fewer chapters than it', () => {
      loadBook();
      click('export-download-book-docx');
      bookFiles.next(file('b.docx', { count: 25, chapters: [{ order: 0, title: 'A' }] }));
      fixture.detectChanges();

      const notice = el('export-skipped-book-docx')!.textContent!;
      expect(notice).toContain('25');
      expect(notice).toContain('1. A');
    });

    it('renders the count alone when the server named no chapters at all', () => {
      loadBook();
      click('export-download-book-docx');
      bookFiles.next(file('b.docx', { count: 3, chapters: [] }));
      fixture.detectChanges();

      expect(el('export-skipped-book-docx')!.textContent).toContain('3');
    });

    /**
     * THE ABSENT HEADER. It means "an old server, or a proxy that stripped it", which is not "nothing was
     * skipped" - so the screen says it does not know rather than implying a complete manuscript.
     */
    it('says it was not told, rather than nothing, when the skip report is absent', () => {
      loadBook();
      click('export-download-book-docx');
      bookFiles.next(file('b.docx', null));
      fixture.detectChanges();

      expect(el('export-skipped-book-docx')!.textContent!.trim()).toBe(SKIPPED_UNKNOWN.he);
    });

    it('reports skips on the chapter path with the same rendering', () => {
      loadBook();
      click('export-download-chapter-docx');
      chapterFiles.next(file('c.docx', null));
      fixture.detectChanges();

      expect(el('export-skipped-chapter-docx')!.textContent!.trim()).toBe(SKIPPED_UNKNOWN.he);
      expect(el('export-skipped-book-docx')).toBeNull();
    });

    it('renders the notice in English on an English book', () => {
      loadBook('en');
      click('export-download-book-docx');
      bookFiles.next(file('b.docx', { count: 1, chapters: [{ order: 2, title: 'The Storm' }] }));
      fixture.detectChanges();

      const notice = el('export-skipped-book-docx')!.textContent!;
      expect(notice).toContain('3. The Storm');
      expect(notice).toContain('One chapter');
    });

    it('clears the previous notice when the same kind is exported again', () => {
      loadBook();
      click('export-download-book-docx');
      bookFiles.next(file('b.docx', { count: 2, chapters: [] }));
      fixture.detectChanges();
      expect(el('export-skipped-book-docx')).not.toBeNull();

      click('export-download-book-docx');
      expect(el('export-skipped-book-docx')).toBeNull();
    });
  });

  // ── The preconditions the screen can state before anything is pressed ───────────────────────────

  describe('a book with nothing in it', () => {
    it('says so once, disables both kinds, and points at import', () => {
      loadBook('he', []);

      expect(el('export-no-chapters')).not.toBeNull();
      expect(el('export-goto-import')).not.toBeNull();
      expect((el('export-download-book-docx') as HTMLButtonElement).disabled).toBeTrue();
      expect((el('export-download-chapter-docx') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('presses nothing when a disabled kind is invoked directly', () => {
      loadBook('he', []);
      component.startExport(EXPORT_KINDS[0]);
      component.startExport(EXPORT_KINDS[1]);
      expect(calls).toEqual([]);
    });
  });

  describe('a book that could not be read', () => {
    beforeEach(() => {
      bookSubject.error(new Error('boom'));
      fixture.detectChanges();
    });

    it('says the book could not be loaded, and does NOT claim the book is empty', () => {
      expect(el('export-book-failed')).not.toBeNull();
      expect(el('export-no-chapters')).toBeNull();
    });

    it('keeps both kinds disabled, because it does not know what is in the book', () => {
      expect((el('export-download-book-docx') as HTMLButtonElement).disabled).toBeTrue();
      expect((el('export-download-chapter-docx') as HTMLButtonElement).disabled).toBeTrue();
      expect(calls).toEqual([]);
    });
  });

  // ── Language and direction: book-scoped, both ways ──────────────────────────────────────────────

  describe('book-scoped language', () => {
    it('renders Hebrew right to left for a Hebrew book', () => {
      loadBook('he');
      expect(el('export-page')!.getAttribute('dir')).toBe('rtl');
      expect(el('export-kind-book-docx')!.textContent).toContain(EXPORT_KINDS[0].name.he);
    });

    it('renders English left to right for an ENGLISH book, even though the app default is Hebrew', () => {
      loadBook('en');
      expect(el('export-page')!.getAttribute('dir')).toBe('ltr');
      expect(el('export-kind-book-docx')!.textContent).toContain(EXPORT_KINDS[0].name.en);
      expect(el('export-download-book-docx')!.textContent!.trim()).toBe(EXPORT_COPY.download.en);
    });

    it('falls back to Hebrew, the primary language, when the book language is missing', () => {
      loadBook('');
      expect(el('export-page')!.getAttribute('dir')).toBe('rtl');
    });

    it('speaks the failure in the book language too', () => {
      loadBook('en');
      chapterResponse = () => throwError(() => ({ status: 404, reason: null } as ExportFailure));
      click('export-download-chapter-docx');
      expect(el('export-error-chapter-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.chapterNotFound.en);
    });
  });

  // ── Teardown: an in-flight export must not touch a dead component (Finding 14) ──────────────────
  //
  // Both regression tests use a held-open `Subject` and fire it AFTER the teardown, deliberately: a
  // synchronous mock (`of()`/`throwError()`) resolves before teardown can matter and would pass whether or
  // not the subscription is actually closed, which is the exact vacuity shape this fix must not repeat.

  describe('teardown of an in-flight export', () => {
    it('does not save a file that lands after the component is destroyed', () => {
      loadBook();
      click('export-download-book-docx');
      expect(calls).toEqual([`book:${BOOK_ID}`]);

      fixture.destroy();
      bookFiles.next(file('too-late.docx'));

      expect(saved).toEqual([]);
    });

    it('does not throw writing into a destroyed component when a failure lands late either', () => {
      loadBook();
      click('export-download-chapter-docx');
      fixture.destroy();

      expect(() => chapterFiles.error({ status: 500, reason: null })).not.toThrow();
    });
  });

  // ── A same-route bookId change must not leak the previous book (Finding 15) ─────────────────────

  describe('a same-route bookId change', () => {
    /** A fresh Subject: the previous one already completed, and a completed Subject replays nothing. */
    function navigateTo(nextBookId: string): void {
      bookSubject = new Subject<BookDetailDto>();
      paramsSubject.next({ bookId: nextBookId });
      fixture.detectChanges();
    }

    it('resets every book-scoped field immediately, then reloads for the new book', () => {
      loadBook('he', [chapter(0)]);
      click('export-download-book-docx');
      bookFiles.next(file('book-a.docx', { count: 1, chapters: [{ order: 0, title: 'X' }] }));
      fixture.detectChanges();
      expect(component.downloadedFor(EXPORT_KINDS[0])).toBe('book-a.docx');
      expect(component.selectedChapterId).toBe('ch-0');

      navigateTo('book-2');

      // Reset immediately - before the new book's own response has even landed.
      expect(component.bookId).toBe('book-2');
      expect(component.downloadedFor(EXPORT_KINDS[0])).toBeNull();
      expect(component.chapters).toEqual([]);
      expect(component.selectedChapterId).toBeNull();
      expect(el('export-loading')).not.toBeNull();

      bookSubject.next(book('en', [chapter(0, { title: 'Only Chapter' })]));
      bookSubject.complete();
      fixture.detectChanges();

      expect(bookRequests).toEqual([BOOK_ID, 'book-2']);
      expect(component.bookLanguage).toBe('en');
      expect(el('export-page')!.getAttribute('dir')).toBe('ltr');
      expect(component.chapters.map(c => c.id)).toEqual(['ch-0']);
    });

    it('does not let a stale response for the OLD book land on the new book\'s screen', () => {
      loadBook('he', [chapter(0)]);
      click('export-download-book-docx');
      expect(calls).toEqual([`book:${BOOK_ID}`]);

      // Navigate away before book A's export resolves.
      navigateTo('book-2');

      // Book A's export answers LATE, after the route moved on - it must not write into book B's screen.
      bookFiles.next(file('book-a-late.docx'));
      fixture.detectChanges();

      expect(saved).toEqual([]);
      expect(component.downloadedFor(EXPORT_KINDS[0])).toBeNull();
    });

    it('does not let book A\'s book-load response land on book B\'s screen either', () => {
      loadBook('he', [chapter(0)]);
      navigateTo('book-2');

      // The OLD bookSubject (book A's) is a separate reference at this point; landing it now must not
      // resurrect book A's chapters under book B's title.
      expect(bookRequests).toEqual([BOOK_ID, 'book-2']);

      bookSubject.next(book('en', [chapter(0), chapter(1)]));
      bookSubject.complete();
      fixture.detectChanges();

      expect(component.bookId).toBe('book-2');
      expect(component.chapters.length).toBe(2);
      expect(component.bookLanguage).toBe('en');
    });
  });

  // ── The file must be on disk before the screen says so (Finding 37) ─────────────────────────────

  describe('a save that fails after the file already left the wire', () => {
    it('does not claim the file downloaded when saveAs throws, and shows an honest error instead', () => {
      loadBook();
      const exportSvc = TestBed.inject(ExportService);
      spyOn(exportSvc, 'saveAs').and.throwError('disk write failed');

      click('export-download-book-docx');
      bookFiles.next(file('b.docx'));
      fixture.detectChanges();

      expect(el('export-done-book-docx')).toBeNull();
      expect(component.downloadedFor(EXPORT_KINDS[0])).toBeNull();
      expect(el('export-error-book-docx')).not.toBeNull();
      expect(el('export-error-book-docx')!.textContent!.trim()).toBe(EXPORT_ERRORS.generic.he);
    });
  });

  // ── A deleted book must not be blamed on the chapter (Finding 38) ───────────────────────────────

  describe('a 404 on the chapter path that could be the book, not the chapter', () => {
    it('does not promise that picking another chapter will fix it', () => {
      loadBook();
      chapterResponse = () => throwError(() => ({ status: 404, reason: null } as ExportFailure));
      click('export-download-chapter-docx');

      const message = el('export-error-chapter-docx')!.textContent!.trim();
      expect(message).toBe(EXPORT_ERRORS.chapterNotFound.he);
      // The old copy told the author to "pick another chapter", which cannot help when the whole book is
      // what is gone - the message must at least raise that possibility.
      expect(message).toContain('הספר');
    });
  });

  // ── The spine on this screen ────────────────────────────────────────────────────────────────────

  describe('the compact spine', () => {
    it('reads stage 5 as ready on a book with chapters, on the screen that does the exporting', () => {
      loadBook();
      const pip = el('spine-compact-pip-export');
      expect(pip).not.toBeNull();
      expect(pip!.dataset['state']).toBe('ready');
    });

    it('reads stage 5 as blocked on an empty book, and claims nothing is done', () => {
      loadBook('he', []);
      expect(el('spine-compact-pip-export')!.dataset['state']).toBe('blocked');
      const spine = el('stage-spine-compact')!;
      expect(spine.querySelectorAll('[data-state="ready"]').length).toBe(0);
    });
  });

  // ── The standing copy constraints ───────────────────────────────────────────────────────────────

  describe('copy constraints', () => {
    /** Every string this screen can render, in one language. */
    function allCopy(lang: 'he' | 'en'): string {
      const parts: string[] = [];
      for (const value of Object.values(EXPORT_COPY)) parts.push(value[lang]);
      for (const value of Object.values(EXPORT_ERRORS)) parts.push(value[lang]);
      for (const kind of EXPORT_KINDS) {
        parts.push(kind.name[lang], kind.description[lang]);
        if (!kind.availability.available) parts.push(kind.availability.reason[lang]);
      }
      return parts.join(' ');
    }

    it('has he/en parity: every string exists in both languages and neither is blank', () => {
      for (const lang of ['he', 'en'] as const) {
        for (const value of Object.values(EXPORT_COPY)) expect(value[lang].trim().length).toBeGreaterThan(0);
        for (const value of Object.values(EXPORT_ERRORS)) expect(value[lang].trim().length).toBeGreaterThan(0);
        for (const kind of EXPORT_KINDS) {
          expect(kind.name[lang].trim().length).toBeGreaterThan(0);
          expect(kind.description[lang].trim().length).toBeGreaterThan(0);
        }
      }
    });

    it('uses no em-dash and no en-dash, in either language', () => {
      expect(allCopy('he')).not.toMatch(/[–—]/);
      expect(allCopy('en')).not.toMatch(/[–—]/);
    });

    it('names no model, vendor or provider, in either language', () => {
      const forbidden = /gemma|ollama|openai|gpt|claude|anthropic|azure|nemotron|dicta|mistral|llama/i;
      expect(allCopy('he')).not.toMatch(forbidden);
      expect(allCopy('en')).not.toMatch(forbidden);
    });

    it('never promises formatting options this screen does not have', () => {
      loadBook('en');
      const page = el('export-page')!.textContent!.toLowerCase();
      expect(page).not.toContain('font');
      expect(page).not.toContain('margin');
      expect(page).not.toContain('page size');
    });
  });
});
