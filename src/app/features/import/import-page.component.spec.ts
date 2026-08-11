/**
 * c04: ImportPageComponent spec — the nav-state handoff payload + he/en localization.
 *
 * Covers:
 *  - confirm() navigates to /books/:bookId carrying the correct importedChapters / importedWords /
 *    importedParts in Router state, derived from the preview:
 *      · importedWords sums ONLY included chapters (the include-filter — excluded rows are not counted);
 *      · importedChapters counts included rows;
 *      · importedParts = count of DISTINCT non-empty partNames among included rows.
 *  - he/en label-map parity: the Hebrew and English maps have IDENTICAL key sets (drift guard);
 *    dir/isHebrew resolve from the book language (Hebrew-default; English only when language starts 'en').
 *  - summaryText renders the localized, thousands-separated, correctly-pluralized string
 *    (f08 behavior: n=1 singular, n>1 plural, 12000 -> '12,000').
 *
 * Async (BookService.getById) is a held-open Subject/stub so no real HTTP is exercised.
 * Router.navigate is spied and the state payload asserted directly.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ImportPageComponent } from './import-page.component';
import { ImportService } from '../../core/services/import.service';
import { BookService } from '../../core/services/book.service';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import {
  BookDetailDto,
  ImportPreviewChapterDto,
  ImportPreviewResponseDto,
} from '../../core/models/book';

function makeJob(overrides: Partial<TrackedJob> = {}): TrackedJob {
  return {
    id: 'j', kind: 'proofread', bookId: 'book-1', scopeLabel: 'פרק', titleHe: 'הגהה', titleEn: 'Proofread',
    status: 'running', percent: 10, completedChunks: null, totalChunks: null, chunkClock: EMPTY_CHUNK_CLOCK,
    message: '', startedAt: '', updatedAt: '', ...overrides,
  };
}

function makeChapter(overrides: Partial<ImportPreviewChapterDto> = {}): ImportPreviewChapterDto {
  return {
    tempId: 't-1',
    order: 1,
    title: 'Chapter One',
    partName: null,
    wordCount: 100,
    snippet: 'Once upon a time...',
    sfdtJson: '{}',
    ...overrides,
  };
}

function makePreview(
  chapters: ImportPreviewChapterDto[],
  overrides: Partial<ImportPreviewResponseDto> = {}
): ImportPreviewResponseDto {
  return {
    bookId: 'book-1',
    fileName: 'manuscript.docx',
    fileSize: 12345,
    pageCount: null,
    chapters,
    ...overrides,
  };
}

function makeBook(language: string): BookDetailDto {
  return {
    id: 'book-1',
    title: 'A Book',
    author: null,
    language,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aiTier: 'fast',
    chapters: [],
  };
}

describe('ImportPageComponent (c04)', () => {
  let component: ImportPageComponent;
  let fixture: ComponentFixture<ImportPageComponent>;
  let navigateSpy: jasmine.Spy;
  let book$: Subject<BookDetailDto>;
  /** Wave 3 / w3: the registry stream the hosted compact spine reads. Empty unless a test pushes a job. */
  let activeJobs$: BehaviorSubject<TrackedJob[]>;

  /**
   * Build the TestBed with a held-open Subject for the book-language fetch (so ngOnInit does not
   * synchronously resolve the language unless a test emits) plus stub Import/Route/Router providers.
   * Missing any constructor dep throws NullInjector for the whole suite — provide every one.
   */
  async function setup(bookId: string | null = 'book-1'): Promise<void> {
    book$ = new Subject<BookDetailDto>();
    activeJobs$ = new BehaviorSubject<TrackedJob[]>([]);

    await TestBed.configureTestingModule({
      imports: [ImportPageComponent],
      providers: [
        // Real Router (the template uses [routerLink], which needs the router wired) — we spy on
        // navigate() below to capture the confirm() nav-state payload.
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { params: bookId ? { bookId } : {} } },
        },
        {
          provide: ImportService,
          useValue: {
            uploadForPreview: () => new Subject<ImportPreviewResponseDto>(),
            confirmImport: () => of({}),
          },
        },
        { provide: BookService, useValue: { getById: () => book$.asObservable() } },
        // Wave 3 / w3: the page hosts the compact stage spine, whose `running` state comes from the job
        // registry. The stub emits no jobs, which is the honest default: the spine can only ever be
        // RAISED to running by a tracked build, never claimed idle by the absence of one.
        { provide: JobRegistryService, useValue: { activeJobs$: activeJobs$.asObservable() } },
      ],
    }).compileComponents();

    navigateSpy = spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(ImportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit -> reads bookId, subscribes to getById
  }

  /** Seed the component with a preview + include flags, as if an upload had resolved. */
  function seedPreview(chapters: ImportPreviewChapterDto[]): void {
    const preview = makePreview(chapters);
    component.preview = preview;
    component.chapters = chapters.map((c) => ({ ...c, include: true }));
  }

  // ── confirm(): nav-state handoff payload ──────────────────────────────────────

  it('confirm() navigates to /books/:bookId with imported=1 and the counts in Router state', async () => {
    await setup('book-1');
    seedPreview([
      makeChapter({ tempId: 't-1', wordCount: 100, partName: 'Part A' }),
      makeChapter({ tempId: 't-2', wordCount: 250, partName: 'Part B' }),
    ]);

    component.confirm();

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const [commands, extras] = navigateSpy.calls.mostRecent().args;
    expect(commands).toEqual(['/books', 'book-1']);
    expect(extras.queryParams).toEqual({ imported: 1 });
    expect(extras.state).toEqual({
      importedChapters: 2,
      importedWords: 350,
      importedParts: 2,
    });
  });

  it('importedWords sums ONLY included chapters (the include-filter — excluded rows are not counted)', async () => {
    await setup('book-1');
    seedPreview([
      makeChapter({ tempId: 't-1', wordCount: 100 }),
      makeChapter({ tempId: 't-2', wordCount: 250 }),
      makeChapter({ tempId: 't-3', wordCount: 999 }),
    ]);
    // Exclude the 999-word chapter.
    component.chapters[2].include = false;

    component.confirm();

    const [, extras] = navigateSpy.calls.mostRecent().args;
    expect(extras.state.importedChapters).toBe(2); // only the two included rows
    expect(extras.state.importedWords).toBe(350); // 999 excluded
  });

  it('importedParts counts DISTINCT non-empty partNames among included chapters (dedupes + drops empty/null)', async () => {
    await setup('book-1');
    seedPreview([
      makeChapter({ tempId: 't-1', partName: 'Part A' }),
      makeChapter({ tempId: 't-2', partName: 'Part A' }), // duplicate -> not a new part
      makeChapter({ tempId: 't-3', partName: 'Part B' }),
      makeChapter({ tempId: 't-4', partName: '' }), // empty -> ignored
      makeChapter({ tempId: 't-5', partName: null }), // null -> ignored
      makeChapter({ tempId: 't-6', partName: 'Part C' }), // excluded below
    ]);
    component.chapters[5].include = false; // Part C excluded -> not counted

    component.confirm();

    const [, extras] = navigateSpy.calls.mostRecent().args;
    // Distinct non-empty included parts: Part A, Part B => 2 (Part C excluded, '' and null dropped).
    expect(extras.state.importedParts).toBe(2);
  });

  it('confirm() is a no-op when nothing is selected (no navigation)', async () => {
    await setup('book-1');
    seedPreview([makeChapter({ tempId: 't-1' })]);
    component.chapters[0].include = false; // no selection

    component.confirm();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('confirm() is a no-op with no preview loaded', async () => {
    await setup('book-1');
    component.preview = null;
    component.chapters = [];

    component.confirm();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // ── he/en label-map parity + direction resolution ─────────────────────────────

  it('he and en label maps have IDENTICAL key sets (drift guard)', async () => {
    await setup('book-1');
    // The maps are module-private, so assert parity behaviorally through t(). t() returns `map[key]
    // ?? key`, so a MISSING key echoes the key back.
    //
    // Every user-facing label key the template references:
    const keys = [
      'title', 'subtitle', 'backToBook', 'dropHere', 'or', 'browse', 'selectedFile', 'bytes',
      'change', 'uploading', 'hint', 'modeAppend', 'modeOverwrite', 'selectAll', 'clearAll',
      'overwriteWarning', 'thInclude', 'thNum', 'thTitle', 'thPart', 'thWords', 'thSnippet',
      'importChapters', 'importing', 'cancel', 'errDocxOnly', 'errMissingBook', 'errAnalyzeFailed',
      'errImportFailed',
    ];

    // A few label VALUES legitimately equal their key name (English UI words) or are a shared symbol,
    // so the "echo" heuristic (t(key) === key) cannot flag a real miss for them. For those we fall
    // back to a cross-language differ/equal check instead.
    const enValueEqualsKey = new Set(['or', 'browse', 'bytes', 'change']); // EN value == key name
    const languageNeutral = new Set(['thNum']); // '#' — identical he/en (a symbol)

    // Hebrew coverage: Hebrew label values are non-Latin, so a Hebrew miss (echoing the ASCII key)
    // is detectable as `t(key) === key` for every key except the shared-symbol one.
    component.bookLanguage = 'he';
    const heValues = new Map<string, string>();
    for (const key of keys) {
      const v = component.t(key);
      if (!languageNeutral.has(key)) {
        expect(v).not.toBe(key); // he map covers the key (no echo)
      }
      heValues.set(key, v);
    }

    // English coverage: for the strong-signal keys, a miss echoes the ASCII key -> assert non-echo.
    // For the exempt keys, prove EN answers the slot via the cross-language relation instead.
    component.bookLanguage = 'en';
    for (const key of keys) {
      const en = component.t(key);
      if (languageNeutral.has(key)) {
        expect(en).toBe(heValues.get(key)!); // shared symbol -> identical across languages
      } else if (enValueEqualsKey.has(key)) {
        // EN value coincides with the key name; a real EN slot differs from the Hebrew translation.
        expect(en).not.toBe(heValues.get(key)!);
      } else {
        expect(en).not.toBe(key); // en map covers the key (no echo)
      }
    }
  });

  it('dir/isHebrew resolve from the book language (Hebrew-default until the fetch resolves)', async () => {
    await setup('book-1');
    // Before the book language fetch resolves: Hebrew-default.
    expect(component.bookLanguage).toBeNull();
    expect(component.isHebrew).toBeTrue();
    expect(component.dir).toBe('rtl');

    // English book -> LTR + English labels.
    book$.next(makeBook('en'));
    expect(component.bookLanguage).toBe('en');
    expect(component.isHebrew).toBeFalse();
    expect(component.dir).toBe('ltr');
    expect(component.t('cancel')).toBe('Cancel');
  });

  it('a Hebrew book language keeps RTL + Hebrew labels', async () => {
    await setup('book-1');
    book$.next(makeBook('he'));
    expect(component.isHebrew).toBeTrue();
    expect(component.dir).toBe('rtl');
    expect(component.t('cancel')).toBe('ביטול');
  });

  it('getById error falls back to Hebrew (non-fatal language load)', async () => {
    // Rebuild with an erroring getById so ngOnInit hits the error branch (-> bookLanguage = 'he').
    TestBed.resetTestingModule();
    const err$ = new Subject<BookDetailDto>();
    await TestBed.configureTestingModule({
      imports: [ImportPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { params: { bookId: 'book-1' } } } },
        {
          provide: ImportService,
          useValue: { uploadForPreview: () => new Subject(), confirmImport: () => of({}) },
        },
        { provide: BookService, useValue: { getById: () => err$.asObservable() } },
        { provide: JobRegistryService, useValue: { activeJobs$: of([]) } },
      ],
    }).compileComponents();

    const errFixture = TestBed.createComponent(ImportPageComponent);
    errFixture.detectChanges(); // ngOnInit subscribes to getById

    err$.error(new Error('404'));

    expect(errFixture.componentInstance.bookLanguage).toBe('he');
    expect(errFixture.componentInstance.isHebrew).toBeTrue();
    expect(errFixture.componentInstance.dir).toBe('rtl');
  });

  // ── summaryText: localized, thousands-separated, pluralized (f08) ──────────────

  it('summaryText (en): singular nouns for n=1', async () => {
    await setup('book-1');
    component.bookLanguage = 'en';
    seedPreview([makeChapter({ tempId: 't-1', wordCount: 1 })]);

    const text = component.summaryText;
    expect(text).toContain('1 chapter'); // singular chapter
    expect(text).toContain('1 word'); // singular word
    expect(text).not.toContain('chapters');
    expect(text).not.toContain('words');
  });

  it('summaryText (en): plural nouns + thousands-separators for large counts (12000 -> 12,000)', async () => {
    await setup('book-1');
    component.bookLanguage = 'en';
    // 3 chapters summing to 12,000 words, all included.
    seedPreview([
      makeChapter({ tempId: 't-1', wordCount: 4000 }),
      makeChapter({ tempId: 't-2', wordCount: 4000 }),
      makeChapter({ tempId: 't-3', wordCount: 4000 }),
    ]);

    const text = component.summaryText;
    expect(text).toContain('3 chapters'); // plural
    expect(text).toContain('12,000 words'); // thousands-separated + plural
    expect(text).toContain('3 selected'); // selectedCount interpolated
  });

  it('summaryText (he): plural Hebrew nouns + thousands-separator', async () => {
    await setup('book-1');
    component.bookLanguage = 'he';
    seedPreview([
      makeChapter({ tempId: 't-1', wordCount: 6000 }),
      makeChapter({ tempId: 't-2', wordCount: 6000 }),
    ]);

    const text = component.summaryText;
    expect(text).toContain('פרקים'); // plural chapters (he)
    expect(text).toContain('מילים'); // plural words (he)
    expect(text).toContain('12,000'); // thousands-separated
  });

  it('summaryText (he): singular Hebrew nouns for n=1', async () => {
    await setup('book-1');
    component.bookLanguage = 'he';
    seedPreview([makeChapter({ tempId: 't-1', wordCount: 1 })]);

    const text = component.summaryText;
    expect(text).toContain('פרק'); // singular chapter (he)
    expect(text).toContain('מילה'); // singular word (he)
  });

  it('summaryText reflects the include-filter in the "selected" count', async () => {
    await setup('book-1');
    component.bookLanguage = 'en';
    seedPreview([
      makeChapter({ tempId: 't-1', wordCount: 100 }),
      makeChapter({ tempId: 't-2', wordCount: 100 }),
      makeChapter({ tempId: 't-3', wordCount: 100 }),
    ]);
    component.chapters[2].include = false; // 2 of 3 selected

    const text = component.summaryText;
    expect(text).toContain('3 chapters'); // detected count = all rows
    expect(text).toContain('2 selected'); // selected respects include-filter
  });

  // ── Wave 3 / w3: the COMPACT stage spine on the import screen ────────────────────────────────────
  //
  // This is the second of the two app-level surfaces the compact spine mounts on, and the reason is the
  // same as the books list: a stage HAPPENS here (Import is this screen) and the product previously showed
  // no stage indicator on it at all. Its signals come from the book payload the page already loads for its
  // own language - no request is added - so what it can say is bounded by that payload, and it says the
  // rest is not known rather than fetching it.

  describe('the compact stage spine (w3)', () => {
    function compactSpine(): HTMLElement | null {
      return fixture.nativeElement.querySelector('[data-testid="stage-spine-compact"]');
    }

    function pipState(stage: string): string {
      return (compactSpine()!.querySelector(`[data-testid="spine-compact-pip-${stage}"]`) as HTMLElement)
        .dataset['state'] ?? '';
    }

    it('renders on the import screen', async () => {
      await setup('book-1');
      book$.next(makeBook('he'));
      fixture.detectChanges();
      expect(compactSpine()).not.toBeNull();
    });

    it('computes Import from the loaded book chapters, with NO extra request', async () => {
      await setup('book-1');
      book$.next({
        ...makeBook('he'),
        chapters: [
          { id: 'c1', title: 'One', partName: null, order: 0, wordCount: 900, updatedAt: '' },
          { id: 'c2', title: 'Two', partName: null, order: 1, wordCount: 0, updatedAt: '' },
        ],
      });
      fixture.detectChanges();
      expect(pipState('import')).toBe('ready');
      // The book-level statuses are not on that payload and are not worth a request for a widget.
      expect(pipState('briefs')).toBe('unknown');
      expect(pipState('review')).toBe('unknown');
    });

    it('a book with no chapters reads not-started here, which is the action this screen offers', async () => {
      await setup('book-1');
      book$.next(makeBook('he')); // chapters: []
      fixture.detectChanges();
      expect(pipState('import')).toBe('not-started');
      // Nothing on the screen may read done: the whole point of the page is that nothing is imported yet.
      expect(compactSpine()!.querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('follows the BOOK language, in both languages', async () => {
      await setup('book-1');
      book$.next(makeBook('en'));
      fixture.detectChanges();
      expect(compactSpine()!.getAttribute('dir')).toBe('ltr');
      expect(compactSpine()!.textContent).toContain('Import');

      TestBed.resetTestingModule();
      await setup('book-1');
      book$.next(makeBook('he'));
      fixture.detectChanges();
      expect(compactSpine()!.getAttribute('dir')).toBe('rtl');
      expect(compactSpine()!.textContent).toContain('ייבוא');
    });
  });

  // ── NIT 51: the per-chapter `running` mark is read from the registry, not hardcoded ─────────────────
  //
  // `rebuildSpineSignals` used to set `running: false` on every chapter signal unconditionally - the one
  // shape `StageSpineSignals` forbids ("nothing here may be synthesized by the host"). It now mirrors
  // book-dashboard's and editor-page's `CHAPTER_SCOPED_KINDS` idiom.

  describe('finding 51: the chapter breakdown reads real running state from the registry', () => {
    it('marks a chapter running when a CHAPTER_SCOPED_KINDS job (proofread) targets it', async () => {
      await setup('book-1');
      book$.next({
        ...makeBook('he'),
        chapters: [
          { id: 'c1', title: 'One', partName: null, order: 0, wordCount: 10, updatedAt: '' },
          { id: 'c2', title: 'Two', partName: null, order: 1, wordCount: 10, updatedAt: '' },
        ],
      });
      fixture.detectChanges();

      activeJobs$.next([makeJob({ id: 'j-1', kind: 'proofread', bookId: 'book-1', chapterId: 'c1' })]);
      fixture.detectChanges();

      expect(component.spineSignals.chapters?.find((c) => c.chapterId === 'c1')?.running).toBeTrue();
      expect(component.spineSignals.chapters?.find((c) => c.chapterId === 'c2')?.running).toBeFalse();
    });

    it('does not mark a chapter running for a kind outside CHAPTER_SCOPED_KINDS', async () => {
      await setup('book-1');
      book$.next({
        ...makeBook('he'),
        chapters: [{ id: 'c1', title: 'One', partName: null, order: 0, wordCount: 10, updatedAt: '' }],
      });
      fixture.detectChanges();

      activeJobs$.next([makeJob({ id: 'j-2', kind: 'style-baseline', bookId: 'book-1', chapterId: 'c1' })]);
      fixture.detectChanges();

      expect(component.spineSignals.chapters?.find((c) => c.chapterId === 'c1')?.running).toBeFalse();
    });

    it('does not mark a chapter running for a job scoped to a DIFFERENT book', async () => {
      await setup('book-1');
      book$.next({
        ...makeBook('he'),
        chapters: [{ id: 'c1', title: 'One', partName: null, order: 0, wordCount: 10, updatedAt: '' }],
      });
      fixture.detectChanges();

      activeJobs$.next([makeJob({ id: 'j-3', kind: 'proofread', bookId: 'other-book', chapterId: 'c1' })]);
      fixture.detectChanges();

      expect(component.spineSignals.chapters?.find((c) => c.chapterId === 'c1')?.running).toBeFalse();
    });
  });
});
