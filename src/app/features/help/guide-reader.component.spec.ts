/**
 * The single-guide READER at `/help/:guideId` (chatbot phase A.2, c1).
 *
 * What is pinned here is the rendered document, in BOTH languages, because that is the whole promise
 * of this route: the assistant cites a guide, and this page has to be able to show it. Hebrew is
 * asserted on the SIBLING FILE's own text rather than on a 200 plus a language flag - a reader that
 * showed the English document under a Hebrew label would satisfy the weaker assertion.
 *
 * The markdown itself is rendered by the shared `app-markdown-text` in its `document` variant; the
 * constructs the real guides use (headings, lists, bold, inline code, hard-wrapped prose) are pinned in
 * that component's own spec. Here they are checked once, end to end, through the real component.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { GuideReaderComponent } from './guide-reader.component';
import { GuideContentDto } from '../../core/models/guide';
import { GUIDES_STRINGS_EN, GUIDES_STRINGS_HE } from '../../core/i18n/guides-strings';

const ENGLISH_BODY = [
  '# Importing your manuscript',
  '',
  'Import turns one DOCX file into the chapters of a book. It is the first stage, because every',
  'later stage reads the chapter text import saves.',
  '',
  '## What is accepted',
  '',
  'A `.docx` file. Other formats are refused.',
  '',
  '- **Heading 1 paragraphs.** Each one starts a new chapter, and its text becomes the chapter',
  '  title.',
  '- A short standalone line that reads as a section marker.',
].join('\n');

const HEBREW_BODY = [
  '# ייבוא כתב היד',
  '',
  'הייבוא הופך קובץ DOCX אחד לפרקים של ספר.',
  '',
  '## אילו קבצים מתקבלים',
  '',
  'קובץ `.docx` בלבד.',
].join('\n');

function content(over: Partial<GuideContentDto> = {}): GuideContentDto {
  return {
    id: 'import',
    stage: 'import',
    audience: 'author',
    language: 'he',
    title: 'ייבוא כתב היד',
    updated: '2026-08-02',
    order: 10,
    body: HEBREW_BODY,
    ...over,
  };
}

describe('GuideReaderComponent (chatbot phase A.2, c1)', () => {
  let fixture: ComponentFixture<GuideReaderComponent>;
  let component: GuideReaderComponent;
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  /**
   * Push the route state, THEN mount. The subjects are BehaviorSubjects handed to the component as the
   * ActivatedRoute, so it sees the state as its initial emission - which is what a real navigation
   * looks like, and what makes "one request per first render" a meaningful assertion.
   */
  function create(guideId = 'import', lang: string | null = null): void {
    params.next(convertToParamMap({ guideId }));
    queryParams.next(convertToParamMap(lang === null ? {} : { lang }));

    fixture = TestBed.createComponent(GuideReaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function flushGuide(dto: GuideContentDto, language = 'he'): void {
    const req = http.expectOne(r => r.url === '/api/guides/import' && r.params.get('language') === language);
    req.flush(dto);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ guideId: 'import' }));
    queryParams = new BehaviorSubject(convertToParamMap({}));

    await TestBed.configureTestingModule({
      imports: [GuideReaderComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: queryParams.asObservable() },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────────

  describe('rendering the document', () => {
    it('renders the guide\'s markdown as a page: real headings, lists, bold and inline code', () => {
      create('import', 'en');
      flushGuide(content({ language: 'en', title: 'Importing your manuscript', body: ENGLISH_BODY }), 'en');

      const doc = fixture.debugElement.query(By.css('.reader-doc')).nativeElement as HTMLElement;

      // The document's own H1 IS the page heading; a `##` is a real section heading under it.
      expect(doc.querySelector('h1')?.textContent).toBe('Importing your manuscript');
      expect(doc.querySelector('h2')?.textContent).toBe('What is accepted');

      // Lists survive, including a hard-wrapped item, which must NOT become a stray paragraph.
      const items = doc.querySelectorAll('li');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toContain('its text becomes the chapter title');
      expect(items[0].querySelector('strong')?.textContent).toBe('Heading 1 paragraphs.');

      // Inline code renders as code, not as literal backticks.
      expect(doc.querySelector('code')?.textContent).toBe('.docx');
      expect(doc.textContent).not.toContain('`');

      // And no markdown marker leaked through as text.
      expect(doc.textContent).not.toContain('**');
      expect(doc.textContent).not.toContain('# ');
    });

    it('joins a hard-wrapped paragraph instead of breaking it mid-sentence', () => {
      create('import', 'en');
      flushGuide(content({ language: 'en', body: ENGLISH_BODY }), 'en');

      const paragraph = fixture.debugElement.query(By.css('.reader-doc p:not(.reader-stamp)'))
        .nativeElement as HTMLElement;
      expect(paragraph.querySelectorAll('br').length)
        .withContext('a source wrap is not a line break')
        .toBe(0);
      expect(paragraph.textContent).toContain('It is the first stage, because every later stage reads');
    });

    it('shows the guide\'s updated stamp, formatted rather than raw', () => {
      create('import', 'en');
      flushGuide(content({ language: 'en', body: ENGLISH_BODY }), 'en');

      const stamp = fixture.debugElement.query(By.css('.reader-stamp')).nativeElement.textContent;
      expect(stamp).toContain(GUIDES_STRINGS_EN['updatedPrefix']);
      expect(stamp).not.toContain('2026-08-02');
    });

    it('offers the way back to the index, keeping the language', () => {
      create('import', 'en');
      flushGuide(content({ language: 'en', body: ENGLISH_BODY }), 'en');

      const back = fixture.debugElement.query(By.css('.reader-back')).nativeElement as HTMLAnchorElement;
      expect(back.getAttribute('href')).toBe('/help?lang=en');
      expect(back.textContent).toContain(GUIDES_STRINGS_EN['backToIndex']);
    });

    it('also offers the way back to the books list, in Hebrew', () => {
      create('import');
      flushGuide(content());

      const back = fixture.debugElement.query(By.css('.reader-back-books')).nativeElement as HTMLAnchorElement;
      expect(back.getAttribute('href')).toBe('/books');
      expect(back.textContent).toContain(GUIDES_STRINGS_HE['backToBooks']);
    });

    it('also offers the way back to the books list, in English', () => {
      create('import', 'en');
      flushGuide(content({ language: 'en', body: ENGLISH_BODY }), 'en');

      const back = fixture.debugElement.query(By.css('.reader-back-books')).nativeElement as HTMLAnchorElement;
      expect(back.getAttribute('href')).toBe('/books');
      expect(back.textContent).toContain(GUIDES_STRINGS_EN['backToBooks']);
    });
  });

  // ── Language: the sibling FILE, not a translation ───────────────────────────────────────────────

  describe('language', () => {
    it('defaults to Hebrew, asks for the Hebrew sibling, and lays the page out RTL', () => {
      create('import');
      flushGuide(content());

      expect(component.lang).toBe('he');
      expect(fixture.debugElement.query(By.css('.reader')).nativeElement.getAttribute('dir')).toBe('rtl');
      const doc = fixture.debugElement.query(By.css('.reader-doc')).nativeElement as HTMLElement;
      expect(doc.querySelector('h1')?.textContent).toBe('ייבוא כתב היד');
      expect(doc.querySelector('h2')?.textContent).toBe('אילו קבצים מתקבלים');
    });

    it('switching language re-fetches the SIBLING FILE and shows ITS text, not a translation', () => {
      create('import');
      flushGuide(content());

      queryParams.next(convertToParamMap({ lang: 'en' }));
      fixture.detectChanges();
      flushGuide(content({ language: 'en', title: 'Importing your manuscript', body: ENGLISH_BODY }), 'en');

      expect(component.lang).toBe('en');
      expect(fixture.debugElement.query(By.css('.reader')).nativeElement.getAttribute('dir')).toBe('ltr');
      const doc = fixture.debugElement.query(By.css('.reader-doc')).nativeElement as HTMLElement;
      expect(doc.querySelector('h1')?.textContent).toBe('Importing your manuscript');
      expect(doc.textContent).not.toContain('ייבוא כתב היד');
    });

    it('the toggle moves the language through the URL', () => {
      create('import');
      flushGuide(content());
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

      const buttons = fixture.debugElement.queryAll(By.css('.reader-lang-btn'));
      expect(buttons.length).toBe(2);
      buttons[1].nativeElement.click();

      expect(navigate.calls.mostRecent().args[1]?.queryParams).toEqual({ lang: 'en' });
    });

    it('issues exactly ONE request for a first render (id and language come from one stream)', () => {
      create('import', 'he');
      // http.verify() in afterEach would fail on a second, unflushed request; expectOne fails on two.
      flushGuide(content());
      expect(component.guide).not.toBeNull();
    });
  });

  // ── Two answers to one question ─────────────────────────────────────────────────────────────────
  //
  // A language switch asks the SAME component the same question twice, so `takeUntil(destroy$)` guards
  // nothing here (nothing was destroyed) and the two answers can come back in either order. Both specs
  // below hold BOTH reads open across the assertion, because that window is the whole defect: a
  // synchronous flush closes it, and would pass just as well against a reader with no supersession.

  describe('a superseded read', () => {
    /**
     * Start the Hebrew read, leave it UNANSWERED, then switch to English. Returns the two open reads,
     * oldest first: the abandoned Hebrew one and the English one the page is now waiting for.
     */
    function heThenEn(): [TestRequest, TestRequest] {
      create('import');
      queryParams.next(convertToParamMap({ lang: 'en' }));
      fixture.detectChanges();

      const pending = http.match(r => r.url === '/api/guides/import');
      expect(pending.length).withContext('both reads should be open before either answers').toBe(2);
      expect(pending[0].request.params.get('language')).toBe('he');
      expect(pending[1].request.params.get('language')).toBe('en');
      return [pending[0], pending[1]];
    }

    const english = () =>
      content({ language: 'en', title: 'Importing your manuscript', body: ENGLISH_BODY });

    it('renders the language now being read, even when the abandoned one answers LAST', () => {
      const [stale, fresh] = heThenEn();

      fresh.flush(english());
      fixture.detectChanges();

      // A superseded read is cancelled, and a cancelled request can be neither flushed nor errored, so
      // the stale answer is delivered only when the component left the read open. That is exactly the
      // un-superseded case this spec exists for: there the Hebrew body really does arrive last.
      if (!stale.cancelled) {
        stale.flush(content());
        fixture.detectChanges();
      }

      const doc = fixture.debugElement.query(By.css('.reader-doc')).nativeElement as HTMLElement;
      expect(doc.querySelector('h1')?.textContent).toBe('Importing your manuscript');
      expect(doc.textContent)
        .withContext('the Hebrew body must not render under English chrome')
        .not.toContain('ייבוא כתב היד');
      expect(component.lang).toBe('en');
      expect(fixture.debugElement.query(By.css('.reader')).nativeElement.getAttribute('dir')).toBe('ltr');
    });

    it('shows no failure banner when the abandoned read is the one that FAILS', () => {
      const [stale, fresh] = heThenEn();

      fresh.flush(english());
      fixture.detectChanges();

      if (!stale.cancelled) {
        stale.error(new ProgressEvent('network error'));
        fixture.detectChanges();
      }

      expect(component.failure)
        .withContext('a failure on the language the reader has left is not this page\'s state')
        .toBeNull();
      expect(fixture.debugElement.query(By.css('.reader-failure'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.reader-doc'))).not.toBeNull();
      expect(component.loading).toBeFalse();
    });
  });

  // ── Honest failure ──────────────────────────────────────────────────────────────────────────────

  describe('failure', () => {
    it('an unknown guide says it does not exist, and points at the index', () => {
      create('import');
      http.expectOne(r => r.url === '/api/guides/import')
        .flush({ error: 'guideNotFound', availableLanguages: [] },
               { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();

      expect(component.failure).toBe('missing');
      expect(fixture.debugElement.query(By.css('.reader-failure-title')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['guideNotFoundTitle']);
      expect(fixture.debugElement.query(By.css('.reader-doc'))).toBeNull();
    });

    it('a guide with no sibling in this language OFFERS the language it does have', () => {
      create('guides-not-translated');
      http.expectOne(r => r.url === '/api/guides/guides-not-translated')
        .flush({ error: 'guideLanguageUnavailable', availableLanguages: ['en'] },
               { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();

      expect(component.failure).toBe('language');
      expect(component.otherLanguage).toBe('en');
      expect(fixture.debugElement.query(By.css('.reader-failure-title')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['guideLanguageUnavailableTitle']);

      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      fixture.debugElement.query(By.css('.reader-failure button')).nativeElement.click();
      expect(navigate.calls.mostRecent().args[1]?.queryParams).toEqual({ lang: 'en' });
    });

    it('a 503 corpus fault is its own state, distinct from a transport failure', () => {
      create('import');
      http.expectOne(r => r.url === '/api/guides/import')
        .flush({ guides: [], count: 0, fault: 'guides-unavailable' },
               { status: 503, statusText: 'Service Unavailable' });
      fixture.detectChanges();

      expect(component.failure).toBe('corpus');
      expect(fixture.debugElement.query(By.css('.reader-failure-body')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['corpusUnavailable']);

      // Retry stays available: a redeployed server does recover from this fault.
      fixture.debugElement.query(By.css('.reader-failure button')).nativeElement.click();
      flushGuide(content());
      expect(component.failure).toBeNull();
      expect(component.guide).not.toBeNull();
    });

    it('a transport failure is its own state, and retry asks again', () => {
      create('import');
      http.expectOne(r => r.url === '/api/guides/import').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(component.failure).toBe('network');
      expect(fixture.debugElement.query(By.css('.reader-failure-body')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['loadFailedBody']);

      fixture.debugElement.query(By.css('.reader-failure button')).nativeElement.click();
      flushGuide(content());
      expect(component.failure).toBeNull();
      expect(component.guide).not.toBeNull();
    });
  });

  // ── No guide named ──────────────────────────────────────────────────────────────────────────────

  it('an empty guide id shows not-found instead of loading forever, and asks the server nothing', () => {
    create('');

    expect(component.loading).toBeFalse();
    expect(fixture.debugElement.query(By.css('.reader-failure-title')).nativeElement.textContent.trim())
      .toBe(GUIDES_STRINGS_HE['guideNotFoundTitle']);
    http.expectNone(() => true);
  });

  // ── The corpus's own index document is not a page ───────────────────────────────────────────────

  it('redirects the index document to /help instead of rendering its table of file links', () => {
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    create('guides-index');

    // No request at all: the redirect happens before any fetch.
    http.expectNone(() => true);
    expect(navigate.calls.mostRecent().args[0]).toEqual(['/help']);
    expect(navigate.calls.mostRecent().args[1]?.replaceUrl).toBeTrue();
  });
});
