/**
 * c06: IssuePanelComponent he/en chrome parity.
 *
 * The panel is the "Edit help -> Language" subnav under the redesigned IA. It was fully hardcoded
 * English; this spec pins the localized chrome so a Hebrew book (default) renders Hebrew and an
 * English book renders English.
 *
 * Covers:
 *  - default (no bookLanguage) renders Hebrew chrome (h3 'בעיות שפה', the rewrite button, empty state);
 *    NOTE: b2 removed the Hebrew DETECT button entirely - see the second describe block in this file;
 *  - bookLanguage='en' renders the English chrome ('Language Issues', 'Detect Issues', the empty prompt);
 *  - the langKey getter resolves 'he' by default and 'en' only for an English book;
 *  - the count chips localize (Hebrew has no trailing English 's');
 *  - an async detect driven by a HELD-OPEN Subject keeps the "Detecting..." pending window real
 *    (never synchronous of()/throwError).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NEVER, Subject } from 'rxjs';
import { IssuePanelComponent } from './issue-panel.component';
import { LanguageEngineService } from '../../core/services/language-engine.service';
import { IssuesResponse, LanguageEngineResult, LanguageIssue } from '../../core/models/language-engine';

describe('IssuePanelComponent (c06 he/en parity)', () => {
  let component: IssuePanelComponent;
  let fixture: ComponentFixture<IssuePanelComponent>;
  let serviceStub: {
    getIssues: jasmine.Spy;
    detectIssues: jasmine.Spy;
    rewriteText: jasmine.Spy;
  };

  beforeEach(async () => {
    serviceStub = {
      // Default to NEVER so the component does not auto-resolve issues during chrome assertions.
      getIssues: jasmine.createSpy('getIssues').and.returnValue(NEVER),
      detectIssues: jasmine.createSpy('detectIssues').and.returnValue(NEVER),
      rewriteText: jasmine.createSpy('rewriteText').and.returnValue(NEVER),
    };

    await TestBed.configureTestingModule({
      imports: [IssuePanelComponent],
      providers: [{ provide: LanguageEngineService, useValue: serviceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    component = fixture.componentInstance;
    // No bookId/chapterId by default => ngOnInit does not load; the empty/clean states render.
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // ── langKey getter ─────────────────────────────────────────────────────────

  describe('langKey getter', () => {
    it('defaults to he when bookLanguage is null', () => {
      expect(component.langKey).toBe('he');
    });

    it('is he for a Hebrew book', () => {
      component.bookLanguage = 'he';
      expect(component.langKey).toBe('he');
    });

    it('is en for an English book', () => {
      component.bookLanguage = 'en';
      expect(component.langKey).toBe('en');
    });

    it('is en for mixed-case / padded English (En-US)', () => {
      component.bookLanguage = '  En-US ';
      expect(component.langKey).toBe('en');
    });
  });

  // ── Default (Hebrew) chrome ─────────────────────────────────────────────────

  describe('default chrome (no bookLanguage => Hebrew)', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('renders the Hebrew h3 title', () => {
      const h3 = query('.panel-header h3');
      expect(h3.nativeElement.textContent.trim()).toBe('בעיות שפה');
    });

    // b2: the Hebrew detect button is GONE (see the b2 block at the bottom of this file). What used to
    // be asserted here - the button's Hebrew label and the "press Detect" empty-state line - are now
    // English-only surfaces, so those two cases moved to the English block below and the Hebrew case is
    // the note that replaced them.
    it('renders no detect button, only the rewrite button', () => {
      const buttons = fixture.debugElement.queryAll(By.css('.header-actions button'));
      expect(buttons.length).toBe(1);
      expect(buttons[0].nativeElement.textContent.trim()).toBe('שכתב');
    });
  });

  // ── English chrome ──────────────────────────────────────────────────────────

  describe('English chrome (bookLanguage = en)', () => {
    beforeEach(() => {
      component.bookLanguage = 'en';
      fixture.detectChanges();
    });

    it('renders the English h3 title', () => {
      const h3 = query('.panel-header h3');
      expect(h3.nativeElement.textContent.trim()).toBe('Language Issues');
    });

    it('renders the English Detect button', () => {
      const buttons = fixture.debugElement.queryAll(By.css('.header-actions button'));
      expect(buttons[0].nativeElement.textContent.trim()).toBe('Detect Issues');
    });

    it('renders the English empty-prompt empty-state line', () => {
      const prompt = query('.no-issues p');
      expect(prompt.nativeElement.textContent.trim()).toBe(
        'Click "Detect Issues" to check for language issues.'
      );
    });
  });

  // ── Count chips localize (no trailing English 's' on Hebrew) ────────────────

  describe('count chips', () => {
    it('errorChipLabel uses natural Hebrew plural with no trailing s', () => {
      component.bookLanguage = 'he';
      component.issues = [
        { startOffset: 0, endOffset: 1, message: 'm', category: 'grammar', severity: 'error', confidence: 1, suggestions: [] },
        { startOffset: 2, endOffset: 3, message: 'm', category: 'grammar', severity: 'error', confidence: 1, suggestions: [] },
      ];
      expect(component.errorChipLabel).toBe('2 שגיאות');
      expect(component.errorChipLabel).not.toContain('s');
    });

    it('errorChipLabel uses English singular/plural for an English book', () => {
      component.bookLanguage = 'en';
      component.issues = [
        { startOffset: 0, endOffset: 1, message: 'm', category: 'grammar', severity: 'error', confidence: 1, suggestions: [] },
      ];
      expect(component.errorChipLabel).toBe('1 error');
    });

    it('moreLabel localizes the overflow count', () => {
      component.bookLanguage = 'he';
      expect(component.moreLabel(3)).toBe('+ 3 נוספות');
      component.bookLanguage = 'en';
      expect(component.moreLabel(3)).toBe('+ 3 more');
    });
  });

  // ── Async detect: held-open Subject keeps the pending window real ───────────

  describe('detect pending window (held-open Subject)', () => {
    // b2: driven on an ENGLISH book, because a Hebrew book no longer has a detect button to press.
    it('shows the localized "Detecting..." label while the detect call is in flight, then settles', () => {
      const detect$ = new Subject<LanguageEngineResult>();
      serviceStub.detectIssues.and.returnValue(detect$);
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.bookLanguage = 'en';
      fixture.detectChanges();

      component.detectIssues();
      fixture.detectChanges();

      const buttons = fixture.debugElement.queryAll(By.css('.header-actions button'));
      // Subject is still open => pending label is shown (real optimistic window).
      expect(component.isDetecting).toBe(true);
      expect(buttons[0].nativeElement.textContent.trim()).toBe('Detecting...');

      // Now settle the call.
      detect$.next({ normalizedText: '', issues: [] });
      detect$.complete();
      fixture.detectChanges();

      expect(component.isDetecting).toBe(false);
      const after = fixture.debugElement.queryAll(By.css('.header-actions button'));
      expect(after[0].nativeElement.textContent.trim()).toBe('Detect Issues');
    });

    // The Hebrew arms of the detect labels are kept for the day a Hebrew checker exists (see the
    // comment at their site), so pin them at the getter even though the template cannot reach them.
    it('keeps the Hebrew detect labels available on the getters', () => {
      component.bookLanguage = 'he';
      expect(component.detectLabel).toBe('אתר בעיות');
      expect(component.detectingLabel).toBe('מאתר...');
    });
  });

  // ── Logic untouched: detect wiring still drives the service ─────────────────

  it('detectIssues delegates to the service with bookId + chapterId (logic preserved)', () => {
    const detect$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(detect$);
    component.bookId = 'book-9';
    component.chapterId = 'chap-9';
    component.bookLanguage = 'en'; // b2: detect is gated on a non-Hebrew book.
    fixture.detectChanges();

    component.detectIssues();
    expect(serviceStub.detectIssues).toHaveBeenCalledWith('book-9', 'chap-9');
  });
});

/**
 * b2 (bug 3, client half): Hebrew hides the dead feature, and every remaining message is localized.
 *
 * WHY THE BUTTON GOES AWAY. `LanguageToolEngine`'s Hebrew branch returns `Issues = []` with a
 * service-unavailable reason BY DESIGN - no Hebrew LanguageTool server is deployed - so on a Hebrew book
 * the button ran, found nothing, and then explained itself in the SERVER's English sentence, which the
 * panel rendered verbatim over its own correctly-localized fallback. This block pins the replacement:
 *
 *  - a Hebrew book renders no detect button and one localized note in its place;
 *  - an English book still gets the button;
 *  - each of the API's four `languageToolCode` values maps to localized copy in BOTH languages;
 *  - a LEGACY payload (message only, no code - i.e. an API that predates the code field) falls back to
 *    the localized fallback and never renders the server's English;
 *  - an HTTP failure raises its own banner instead of a console line;
 *  - the unavailable banner is suppressed for the EXPECTED absence on a Hebrew book, because that one
 *    reason is already stated once by the note. c13 narrowed this from "suppressed entirely for a
 *    Hebrew book", which swallowed every other reason too; the c13 block at the bottom of this file
 *    owns the rest of that cross product.
 */
describe('IssuePanelComponent (b2: Hebrew gate + localized reasons)', () => {
  let component: IssuePanelComponent;
  let fixture: ComponentFixture<IssuePanelComponent>;
  let serviceStub: {
    getIssues: jasmine.Spy;
    detectIssues: jasmine.Spy;
    rewriteText: jasmine.Spy;
  };

  beforeEach(async () => {
    serviceStub = {
      getIssues: jasmine.createSpy('getIssues').and.returnValue(NEVER),
      detectIssues: jasmine.createSpy('detectIssues').and.returnValue(NEVER),
      rewriteText: jasmine.createSpy('rewriteText').and.returnValue(NEVER),
    };

    await TestBed.configureTestingModule({
      imports: [IssuePanelComponent],
      providers: [{ provide: LanguageEngineService, useValue: serviceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    component = fixture.componentInstance;
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => el().querySelector(sel)?.textContent?.trim() ?? null;
  const detectButton = () =>
    fixture.debugElement
      .queryAll(By.css('.header-actions button'))
      .find(b => /אתר בעיות|Detect Issues|מאתר|Detecting/.test(b.nativeElement.textContent)) ?? null;

  /** Drive a detect response through the real subscribe path on an English book. */
  function detectWith(metadata: Record<string, unknown>): void {
    const detect$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(detect$);
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
    fixture.detectChanges();
    component.detectIssues();
    detect$.next({ normalizedText: '', issues: [], metadata });
    detect$.complete();
    fixture.detectChanges();
  }

  // ── 1. A Hebrew book hides the button and shows the note ───────────────────

  describe('Hebrew book (the default)', () => {
    beforeEach(() => {
      component.bookLanguage = 'he';
      fixture.detectChanges();
    });

    it('renders no detect button', () => {
      expect(component.canDetect).toBe(false);
      expect(detectButton()).toBeNull();
      // The rewrite button is NOT gated: the rewrite pass is a model call and works in Hebrew.
      const buttons = fixture.debugElement.queryAll(By.css('.header-actions button'));
      expect(buttons.length).toBe(1);
      expect(buttons[0].nativeElement.textContent.trim()).toBe('שכתב');
    });

    it('renders exactly one localized note in its place, not the "press Detect" prompt', () => {
      const lines = fixture.debugElement.queryAll(By.css('.no-issues p'));
      expect(lines.length).toBe(1);
      expect(lines[0].nativeElement.classList).toContain('detect-unsupported-note');
      expect(lines[0].nativeElement.textContent.trim()).toBe(
        'בודק השפה האוטומטי אינו תומך בעברית, ולכן איתור בעיות אינו זמין בספר הזה. להגהה בעברית אפשר להריץ את מעבר "הגהה" בלשונית "ניתוח".'
      );
      // The prompt that tells the reader to press a button that is not there must NOT render.
      expect(el().textContent).not.toContain('לחצו על "אתר בעיות"');
    });

    it('detectIssues() is a no-op even if called programmatically', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.detectIssues();
      expect(serviceStub.detectIssues).not.toHaveBeenCalled();
      expect(component.isDetecting).toBe(false);
    });

    // ── The unavailable banner is suppressed for the EXPECTED absence (c13 narrowed this) ─────
    it('suppresses the unavailable banner for the expected Hebrew-unsupported absence', () => {
      const load$ = new Subject<IssuesResponse>();
      serviceStub.getIssues.and.returnValue(load$);
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.loadIssues();
      load$.next({
        issues: [],
        languageToolUnavailable: true,
        languageToolCode: 'hebrew-unsupported',
        languageToolMessage: "The language checker doesn't support Hebrew.",
      });
      load$.complete();
      fixture.detectChanges();

      expect(component.serviceUnavailableMessage).toBeNull();
      expect(el().querySelector('.service-unavailable-banner')).toBeNull();
      // And the server's English never reaches the DOM.
      expect(el().textContent).not.toContain("doesn't support Hebrew");
    });
  });

  // ── 2. An English book keeps the button ───────────────────────────────────

  describe('English book', () => {
    beforeEach(() => {
      component.bookLanguage = 'en';
      fixture.detectChanges();
    });

    it('renders the detect button and the English "press Detect" prompt', () => {
      expect(component.canDetect).toBe(true);
      expect(detectButton()).not.toBeNull();
      expect(detectButton()!.nativeElement.textContent.trim()).toBe('Detect Issues');
      expect(text('.no-issues p')).toBe('Click "Detect Issues" to check for language issues.');
      expect(el().querySelector('.detect-unsupported-note')).toBeNull();
    });
  });

  // ── 3. Each code maps in both languages ───────────────────────────────────

  describe('languageToolCode -> localized copy', () => {
    const CASES: { code: string; he: string; en: string }[] = [
      {
        code: 'hebrew-unsupported',
        he: 'בודק השפה אינו תומך בעברית, ולכן הטקסט הזה לא נבדק.',
        en: 'The language checker does not support Hebrew, so this text was not checked.',
      },
      {
        code: 'disabled',
        he: 'בודק השפה כבוי בהגדרות השרת.',
        en: 'The language checker is turned off in the server settings.',
      },
      {
        code: 'unavailable',
        he: 'בודק השפה אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.',
        en: 'The language checker is not available right now. Please try again later.',
      },
      {
        code: 'timeout',
        he: 'בודק השפה לא הגיב בזמן. אפשר לנסות שוב.',
        en: 'The language checker did not respond in time. Please try again.',
      },
    ];

    for (const c of CASES) {
      it(`maps ${c.code} in both languages`, () => {
        component.bookLanguage = 'he';
        expect(component.unavailableCopyFor(c.code)).toBe(c.he);
        component.bookLanguage = 'en';
        expect(component.unavailableCopyFor(c.code)).toBe(c.en);
        // A mapped code must not silently collapse onto the generic fallback.
        expect(component.unavailableCopyFor(c.code)).not.toBe(component.serviceUnavailableFallback);
      });
    }

    it('renders the mapped sentence in the banner after a detect (English book)', () => {
      component.bookLanguage = 'en';
      detectWith({ languageToolUnavailable: true, languageToolCode: 'timeout' });
      expect(text('.service-unavailable-banner .banner-text')).toBe(
        'The language checker did not respond in time. Please try again.'
      );
    });

    it('falls back to the localized fallback for an unknown code', () => {
      component.bookLanguage = 'en';
      detectWith({ languageToolUnavailable: true, languageToolCode: 'something-new' });
      expect(text('.service-unavailable-banner .banner-text')).toBe(
        'The language checker is not available.'
      );
    });

    // Found by the browser gate, not by a spec: the clean line was rendering directly under the
    // unavailable banner, so the panel said "no issues" about text nothing had checked.
    it('does not claim the text is clean while the checker is unavailable', () => {
      component.bookLanguage = 'en';
      detectWith({ languageToolUnavailable: true, languageToolCode: 'unavailable' });
      expect(el().textContent).not.toContain('No issues detected');
      expect(text('.service-unavailable-banner .banner-text')).toBe(
        'The language checker is not available right now. Please try again later.'
      );
    });

    it('clears the banner when the checker answers normally', () => {
      component.bookLanguage = 'en';
      detectWith({ languageToolUnavailable: false, languageToolCode: 'timeout' });
      expect(component.serviceUnavailableMessage).toBeNull();
      expect(el().querySelector('.service-unavailable-banner')).toBeNull();
    });
  });

  // ── 4. A legacy (message-only) payload falls back, and never renders the English ──

  describe('legacy payload (message only, no code)', () => {
    it('falls back to the localized fallback on detect and does not render the server sentence', () => {
      component.bookLanguage = 'en';
      detectWith({
        languageToolUnavailable: true,
        languageToolMessage: 'LanguageTool service is unavailable (HTTP 503).',
      });
      expect(text('.service-unavailable-banner .banner-text')).toBe(
        'The language checker is not available.'
      );
      expect(el().textContent).not.toContain('HTTP 503');
    });

    it('falls back on the GET issues path too, in Hebrew, for an English-book chapter', () => {
      // Chrome language drives the copy; the legacy server sentence is dropped on the floor.
      const load$ = new Subject<IssuesResponse>();
      serviceStub.getIssues.and.returnValue(load$);
      component.bookLanguage = 'en';
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.loadIssues();
      load$.next({
        issues: [],
        languageToolUnavailable: true,
        languageToolMessage: 'LanguageTool service is unavailable (HTTP 503).',
      });
      load$.complete();
      fixture.detectChanges();

      expect(component.serviceUnavailableMessage).toBe('The language checker is not available.');
      expect(el().textContent).not.toContain('HTTP 503');
    });
  });

  // ── 5. An HTTP failure banners instead of writing a console line ──────────

  describe('HTTP failure', () => {
    it('banners a failed detect in the book language, and stops the spinner', () => {
      const detect$ = new Subject<LanguageEngineResult>();
      serviceStub.detectIssues.and.returnValue(detect$);
      component.bookLanguage = 'en';
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      fixture.detectChanges();

      component.detectIssues();
      fixture.detectChanges();
      expect(component.isDetecting).toBe(true);

      detect$.error({ status: 500 });
      fixture.detectChanges();

      expect(component.isDetecting).toBe(false);
      expect(text('.request-error-banner .banner-text')).toBe(
        'The language check failed. Please try again.'
      );
      // f01/f10: this cell used to assert `component.hasDetected === false`, which the INITIAL FIELD
      // VALUE satisfies - the error handler never touched the flag, so the assertion could not fail for
      // the reason its name claims, and that is why the clean-line-under-the-error-banner cell shipped.
      // Assert the RENDERED state instead: the banner is the panel's only statement about the text.
      expect(el().textContent).not.toContain('No issues detected');
      expect(el().querySelector('.no-issues-clean')).toBeNull();
      expect(el().querySelector('.detect-prompt')).toBeNull();
      expect(el().querySelectorAll('.issue-item').length).toBe(0);
    });

    it('banners a failed GET issues in Hebrew', () => {
      const load$ = new Subject<IssuesResponse>();
      serviceStub.getIssues.and.returnValue(load$);
      component.bookLanguage = 'he';
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      fixture.detectChanges();

      component.loadIssues();
      load$.error({ status: 500 });
      fixture.detectChanges();

      expect(text('.request-error-banner .banner-text')).toBe('בדיקת השפה נכשלה. אפשר לנסות שוב.');
    });

    it('clears the failure banner when the chapter changes', () => {
      component.bookLanguage = 'en';
      component.requestErrorMessage = 'stale';
      component.bookId = 'book-1';
      component.chapterId = 'chap-2';
      component.ngOnChanges({
        chapterId: { currentValue: 'chap-2', previousValue: 'chap-1', firstChange: false, isFirstChange: () => false },
      });
      expect(component.requestErrorMessage).toBeNull();
    });
  });
});

/**
 * f01: THE WHOLE EMPTY-STATE CROSS PRODUCT, materialized.
 *
 * The panel's empty state is a cross product of three axes and the code used to decide it with three
 * independent *ngIf conjunctions, so a cell could render two contradictory statements at once and no
 * spec named the cell. One such cell was found by the browser gate (the clean line under the
 * UNAVAILABLE banner) and closed one cell at a time; the REQUEST-ERROR twin was still open, which is
 * how a one-cell fix always ends. This block enumerates all 18 cells:
 *
 *   {he, en} x {not-yet-detected, detected-clean, detected-with-issues}
 *           x {no banner, unavailable banner, request-error banner}
 *
 * and asserts the EXACT set of statements each one renders. A statement is anything the panel says
 * about the text or the checker: either banner, either empty-state line, or the issue list itself.
 *
 * TWO CELLS ARE PINNED AS KNOWN GAPS rather than as intent; both are reported with the todo and both
 * are owned elsewhere:
 *  - `he` + request-error-banner renders the Hebrew capability note AND a banner that says "you can try
 *    again" next to a panel with no Detect button to press. The banner is only reachable on a Hebrew
 *    book because `loadIssues` is ungated there (f12 owns the gate, c13 owns the suppression scope).
 *  - detected-with-issues + unavailable-banner renders a real issue list under "the checker is not
 *    available". That is the API's fifth ServiceUnavailable path (the auto-retry-success branch, which
 *    sets the flag WITH a non-empty issue list and no code); the client cannot tell it apart from a
 *    genuine outage until the API assigns it a code (be-c02).
 *
 * THE `he` + unavailable-banner ROWS ARE NO LONGER HYPOTHETICAL. They were pinned here at field level
 * while `applyUnavailable` suppressed on `!canDetect`, i.e. while no response could reach them; c13
 * rescoped that suppression to the expected absence, so a Hebrew book with a switched-off, unreachable
 * or timing-out checker now reaches them THROUGH THE FLOW. The rows below did not change - the c13 block
 * at the bottom of this file drives the same cells from a real response instead.
 */
describe('IssuePanelComponent (f01: the empty-state cross product)', () => {
  let component: IssuePanelComponent;
  let fixture: ComponentFixture<IssuePanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IssuePanelComponent],
      providers: [
        {
          provide: LanguageEngineService,
          useValue: {
            getIssues: jasmine.createSpy('getIssues').and.returnValue(NEVER),
            detectIssues: jasmine.createSpy('detectIssues').and.returnValue(NEVER),
            rewriteText: jasmine.createSpy('rewriteText').and.returnValue(NEVER),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    component = fixture.componentInstance;
  });

  const el = () => fixture.nativeElement as HTMLElement;

  type DetectAxis = 'not-yet-detected' | 'detected-clean' | 'detected-with-issues';
  type BannerAxis = 'no-banner' | 'unavailable-banner' | 'request-error-banner';

  const ONE_ISSUE: LanguageIssue[] = [{
    startOffset: 0, endOffset: 4, message: 'm', category: 'grammar',
    severity: 'error', confidence: 1, suggestions: ['fix'],
  }];

  /** Put the panel in one cell of the cross product by setting the state each axis owns. */
  function renderCell(lang: 'he' | 'en', detect: DetectAxis, banner: BannerAxis): void {
    component.bookLanguage = lang;
    component.hasDetected = detect !== 'not-yet-detected';
    component.issues = detect === 'detected-with-issues' ? [...ONE_ISSUE] : [];
    component.serviceUnavailableMessage =
      banner === 'unavailable-banner' ? component.unavailableCopyFor('unavailable') : null;
    component.requestErrorMessage = banner === 'request-error-banner' ? component.requestFailedLabel : null;
    fixture.detectChanges();
  }

  /** Every statement the panel is currently making, in DOM order. */
  function statements(): string[] {
    const out: string[] = [];
    if (el().querySelector('.service-unavailable-banner')) out.push('unavailable-banner');
    if (el().querySelector('.request-error-banner')) out.push('request-error-banner');
    if (el().querySelectorAll('.issue-item').length > 0) out.push('issue-list');
    if (el().querySelector('.detect-unsupported-note')) out.push('unsupported-note');
    if (el().querySelector('.detect-prompt')) out.push('prompt');
    if (el().querySelector('.no-issues-clean')) out.push('clean-claim');
    return out;
  }

  const TABLE: { lang: 'he' | 'en'; detect: DetectAxis; banner: BannerAxis; expect: string[] }[] = [
    // ── Hebrew: the checker cannot run, so the capability note is the standing statement. ──────────
    { lang: 'he', detect: 'not-yet-detected',    banner: 'no-banner',             expect: ['unsupported-note'] },
    { lang: 'he', detect: 'detected-clean',      banner: 'no-banner',             expect: ['unsupported-note'] },
    { lang: 'he', detect: 'detected-with-issues', banner: 'no-banner',            expect: ['issue-list'] },
    // Reachable through the flow since c13 (a real outage on a Hebrew book); driven end to end below.
    { lang: 'he', detect: 'not-yet-detected',    banner: 'unavailable-banner',    expect: ['unavailable-banner', 'unsupported-note'] },
    { lang: 'he', detect: 'detected-clean',      banner: 'unavailable-banner',    expect: ['unavailable-banner', 'unsupported-note'] },
    { lang: 'he', detect: 'detected-with-issues', banner: 'unavailable-banner',   expect: ['unavailable-banner', 'issue-list'] },
    // KNOWN GAP (reported, owned by f12/c13): "you can try again" with no button to press.
    { lang: 'he', detect: 'not-yet-detected',    banner: 'request-error-banner',  expect: ['request-error-banner', 'unsupported-note'] },
    { lang: 'he', detect: 'detected-clean',      banner: 'request-error-banner',  expect: ['request-error-banner', 'unsupported-note'] },
    { lang: 'he', detect: 'detected-with-issues', banner: 'request-error-banner', expect: ['request-error-banner', 'issue-list'] },

    // ── English: the ordinary three empty states, and a banner silences all of them. ───────────────
    { lang: 'en', detect: 'not-yet-detected',    banner: 'no-banner',             expect: ['prompt'] },
    { lang: 'en', detect: 'detected-clean',      banner: 'no-banner',             expect: ['clean-claim'] },
    { lang: 'en', detect: 'detected-with-issues', banner: 'no-banner',            expect: ['issue-list'] },
    { lang: 'en', detect: 'not-yet-detected',    banner: 'unavailable-banner',    expect: ['unavailable-banner'] },
    { lang: 'en', detect: 'detected-clean',      banner: 'unavailable-banner',    expect: ['unavailable-banner'] },
    // KNOWN GAP (reported, owned by be-c02): the API's fifth ServiceUnavailable path.
    { lang: 'en', detect: 'detected-with-issues', banner: 'unavailable-banner',   expect: ['unavailable-banner', 'issue-list'] },
    // THE CELL THIS TODO EXISTS FOR: the clean claim must not survive under the failure banner.
    { lang: 'en', detect: 'not-yet-detected',    banner: 'request-error-banner',  expect: ['request-error-banner'] },
    { lang: 'en', detect: 'detected-clean',      banner: 'request-error-banner',  expect: ['request-error-banner'] },
    // Unreachable through the flow after f02 (a failure clears the list); pinned at field level.
    { lang: 'en', detect: 'detected-with-issues', banner: 'request-error-banner', expect: ['request-error-banner', 'issue-list'] },
  ];

  for (const cell of TABLE) {
    it(`${cell.lang} / ${cell.detect} / ${cell.banner} renders exactly [${cell.expect.join(', ')}]`, () => {
      renderCell(cell.lang, cell.detect, cell.banner);
      expect(statements()).toEqual(cell.expect);
      // No cell may render NOTHING: every cell says at least one thing.
      expect(statements().length).toBeGreaterThan(0);
      // At most one EMPTY-STATE line, ever - that is what the single getter buys.
      expect(el().querySelectorAll('.no-issues p').length).toBeLessThanOrEqual(1);
    });
  }

  it('never renders the clean claim beside either banner, in either language', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const banner of ['unavailable-banner', 'request-error-banner'] as const) {
        renderCell(lang, 'detected-clean', banner);
        expect(el().querySelector('.no-issues-clean'))
          .withContext(`${lang} / detected-clean / ${banner}`)
          .toBeNull();
        expect(el().textContent).not.toContain('No issues detected');
        expect(el().textContent).not.toContain('לא נמצאו בעיות');
      }
    }
  });

  it('never invites a second press while a failure banner is on screen', () => {
    renderCell('en', 'not-yet-detected', 'request-error-banner');
    expect(el().querySelector('.detect-prompt')).toBeNull();
    expect(el().textContent).not.toContain('Click "Detect Issues"');
  });

  it('emptyStateLine is a total function: every combination resolves to exactly one of the four names', () => {
    const seen = new Set<string>();
    for (const lang of ['he', 'en'] as const) {
      for (const detect of ['not-yet-detected', 'detected-clean'] as const) {
        for (const banner of ['no-banner', 'unavailable-banner', 'request-error-banner'] as const) {
          renderCell(lang, detect, banner);
          expect(['unsupported', 'prompt', 'clean', 'none']).toContain(component.emptyStateLine);
          seen.add(component.emptyStateLine);
        }
      }
    }
    // All four outcomes are actually reachable, so none of the four is dead code.
    expect(Array.from(seen).sort()).toEqual(['clean', 'none', 'prompt', 'unsupported']);
  });
});

/**
 * f02: WHAT A FAILED REQUEST LEAVES ON SCREEN, and the two error handlers agreeing about it.
 *
 * A failed re-detect used to leave the PREVIOUS issue list rendered as though it described the text now
 * in the editor - an author could click a suggestion whose offsets no longer match - and a previous
 * unavailable banner STACKED with the new failure banner, so the panel said "the checker is
 * unavailable" and "the check failed" at the same time. The rule is now one rule for both handlers:
 * clear the stale result, show only the failure banner.
 */
describe('IssuePanelComponent (f02: a failed request clears the stale result)', () => {
  let component: IssuePanelComponent;
  let fixture: ComponentFixture<IssuePanelComponent>;
  let serviceStub: { getIssues: jasmine.Spy; detectIssues: jasmine.Spy; rewriteText: jasmine.Spy };

  beforeEach(async () => {
    serviceStub = {
      getIssues: jasmine.createSpy('getIssues').and.returnValue(NEVER),
      detectIssues: jasmine.createSpy('detectIssues').and.returnValue(NEVER),
      rewriteText: jasmine.createSpy('rewriteText').and.returnValue(NEVER),
    };
    await TestBed.configureTestingModule({
      imports: [IssuePanelComponent],
      providers: [{ provide: LanguageEngineService, useValue: serviceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    component = fixture.componentInstance;
    component.bookLanguage = 'en';
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
  });

  const el = () => fixture.nativeElement as HTMLElement;

  const ISSUE: LanguageIssue = {
    startOffset: 10, endOffset: 14, message: 'spelling', category: 'grammar',
    severity: 'error', confidence: 1, suggestions: ['there'],
  };

  /** A first, SUCCESSFUL detect that leaves a real issue list (and an unavailable banner) on screen. */
  function succeedFirstDetect(withUnavailableBanner: boolean): void {
    const first$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(first$);
    fixture.detectChanges();
    component.detectIssues();
    first$.next({
      normalizedText: '',
      issues: [ISSUE],
      metadata: withUnavailableBanner
        ? { languageToolUnavailable: true, languageToolCode: 'timeout' }
        : undefined,
    });
    first$.complete();
    fixture.detectChanges();
  }

  it('a detect that fails after a successful one shows no issue list and exactly one banner', () => {
    succeedFirstDetect(false);
    expect(el().querySelectorAll('.issue-item').length).toBe(1);

    // The re-detect is held OPEN across the assertion, then failed: a synchronous throwError() would
    // collapse the window this defect lives in.
    const second$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(second$);
    component.detectIssues();
    fixture.detectChanges();
    expect(component.isDetecting).toBe(true);
    expect(el().querySelectorAll('.issue-item').length).toBe(1); // still the old list, still in flight

    second$.error({ status: 500 });
    fixture.detectChanges();

    expect(component.issues).toEqual([]);
    expect(component.hasDetected).toBe(false);
    expect(el().querySelectorAll('.issue-item').length).toBe(0);
    // No clickable suggestion can survive a failure - that click carries offsets into the editor.
    expect(el().querySelectorAll('.suggestion-btn').length).toBe(0);
    // Exactly one banner.
    expect(el().querySelectorAll('.service-unavailable-banner, .request-error-banner').length).toBe(1);
    expect(el().querySelector('.request-error-banner')).not.toBeNull();
    expect(component.isDetecting).toBe(false);
  });

  it('a failure does not stack its banner on a previous unavailable banner', () => {
    succeedFirstDetect(true);
    expect(component.serviceUnavailableMessage).not.toBeNull();
    expect(el().querySelector('.service-unavailable-banner')).not.toBeNull();

    const second$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(second$);
    component.detectIssues();
    second$.error({ status: 503 });
    fixture.detectChanges();

    expect(component.serviceUnavailableMessage).toBeNull();
    expect(el().querySelector('.service-unavailable-banner')).toBeNull();
    expect(el().querySelectorAll('.service-unavailable-banner, .request-error-banner').length).toBe(1);
    expect(el().textContent).not.toContain('did not respond in time');
  });

  it('the GET and the detect error handlers clear IDENTICALLY (sibling parity)', () => {
    interface Snapshot {
      issues: LanguageIssue[];
      hasDetected: boolean;
      serviceUnavailableMessage: string | null;
      requestErrorMessage: string | null;
      statements: number;
    }

    // Path 1: a failed detect.
    succeedFirstDetect(true);
    const detect$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(detect$);
    component.detectIssues();
    detect$.error({ status: 500 });
    fixture.detectChanges();
    const afterDetectFailure: Snapshot = {
      issues: component.issues,
      hasDetected: component.hasDetected,
      serviceUnavailableMessage: component.serviceUnavailableMessage,
      requestErrorMessage: component.requestErrorMessage,
      statements: el().querySelectorAll('.service-unavailable-banner, .request-error-banner').length,
    };

    // Path 2: the same starting state, failed on the GET path instead.
    component.issues = [ISSUE];
    component.hasDetected = true;
    component.serviceUnavailableMessage = component.unavailableCopyFor('timeout');
    const load$ = new Subject<IssuesResponse>();
    serviceStub.getIssues.and.returnValue(load$);
    component.loadIssues();
    load$.error({ status: 500 });
    fixture.detectChanges();
    const afterLoadFailure: Snapshot = {
      issues: component.issues,
      hasDetected: component.hasDetected,
      serviceUnavailableMessage: component.serviceUnavailableMessage,
      requestErrorMessage: component.requestErrorMessage,
      statements: el().querySelectorAll('.service-unavailable-banner, .request-error-banner').length,
    };

    expect(afterLoadFailure).toEqual(afterDetectFailure);
    expect(afterLoadFailure).toEqual({
      issues: [],
      hasDetected: false,
      serviceUnavailableMessage: null,
      requestErrorMessage: 'The language check failed. Please try again.',
      statements: 1,
    });
  });

  it('a failed detect falls back to the prompt only once the reader clears the failure by re-detecting', () => {
    succeedFirstDetect(false);
    const failing$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(failing$);
    component.detectIssues();
    failing$.error({ status: 500 });
    fixture.detectChanges();
    // While the banner stands it is the only statement (f01).
    expect(el().querySelectorAll('.no-issues p').length).toBe(0);

    const retry$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(retry$);
    component.detectIssues();
    fixture.detectChanges();
    expect(component.requestErrorMessage).toBeNull(); // cleared at issue time
    retry$.next({ normalizedText: '', issues: [] });
    retry$.complete();
    fixture.detectChanges();
    expect(el().querySelector('.no-issues-clean')).not.toBeNull();
  });
});

/**
 * c03: REQUEST-KEY STALE GUARDS AND SUPERSESSION - the data-corruption path in this panel.
 *
 * An issue's `startOffset`/`endOffset` index ONE chapter's text and `applySuggestion` emits them
 * straight to the editor, so chapter A's response landing after the reader has opened chapter B does
 * not merely look wrong: pressing the suggestion applies A's range into B's document. Neither
 * subscription was keyed or torn down, and `ngOnChanges` fired a new load while the previous was still
 * in flight.
 *
 * Every case here holds the request open with a Subject across the assertions. Synchronous
 * of()/throwError() collapses the window these defects live in and passes against the unfixed code.
 */
describe('IssuePanelComponent (c03: request-key stale guards)', () => {
  let component: IssuePanelComponent;
  let fixture: ComponentFixture<IssuePanelComponent>;
  let serviceStub: { getIssues: jasmine.Spy; detectIssues: jasmine.Spy; rewriteText: jasmine.Spy };

  beforeEach(async () => {
    serviceStub = {
      getIssues: jasmine.createSpy('getIssues').and.returnValue(NEVER),
      detectIssues: jasmine.createSpy('detectIssues').and.returnValue(NEVER),
      rewriteText: jasmine.createSpy('rewriteText').and.returnValue(NEVER),
    };
    await TestBed.configureTestingModule({
      imports: [IssuePanelComponent],
      providers: [{ provide: LanguageEngineService, useValue: serviceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    component = fixture.componentInstance;
    component.bookLanguage = 'en';
  });

  const el = () => fixture.nativeElement as HTMLElement;

  const issueAt = (start: number, label: string): LanguageIssue => ({
    startOffset: start, endOffset: start + 4, message: label, category: 'grammar',
    severity: 'error', confidence: 1, suggestions: [label],
  });

  /** Simulate the parent re-binding [chapterId], which is the only way the panel changes context. */
  function switchChapterTo(chapterId: string, previous: string): void {
    component.chapterId = chapterId;
    component.ngOnChanges({
      chapterId: { currentValue: chapterId, previousValue: previous, firstChange: false, isFirstChange: () => false },
    });
    fixture.detectChanges();
  }

  it('chapter A\'s response that lands after a switch to B reaches nothing in the view', () => {
    const a$ = new Subject<IssuesResponse>();
    const b$ = new Subject<IssuesResponse>();
    serviceStub.getIssues.and.callFake((_b: string, c: string) => (c === 'chap-a' ? a$ : b$));
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges(); // ngOnInit -> load for chapter A, held OPEN

    switchChapterTo('chap-b', 'chap-a');

    // A answers late, with a real issue whose offsets belong to A's text.
    a$.next({ issues: [issueAt(120, 'A-only')], languageToolUnavailable: true, languageToolCode: 'timeout' });
    a$.complete();
    fixture.detectChanges();

    expect(component.issues).toEqual([]);
    expect(component.hasDetected).toBe(false);
    expect(component.serviceUnavailableMessage).toBeNull();
    expect(el().textContent).not.toContain('A-only');
    // Nothing to click means no offset from A can be emitted into B's document.
    expect(el().querySelectorAll('.suggestion-btn').length).toBe(0);
    // And the abandoned request was actually torn down, not merely ignored.
    expect(a$.observed).toBe(false);

    // B still lands normally afterwards.
    b$.next({ issues: [issueAt(3, 'B-only')] });
    b$.complete();
    fixture.detectChanges();
    expect(el().textContent).toContain('B-only');
  });

  it('the guard itself (not only the teardown) drops a stale next AND a stale error', () => {
    // Bypass ngOnChanges so the subscription is NOT cancelled: this pins the in-handler guard on its
    // own, which is the layer that survives a future caller that changes context without the reset.
    const a$ = new Subject<IssuesResponse>();
    serviceStub.getIssues.and.returnValue(a$);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    component.loadIssues();
    component.chapterId = 'chap-b'; // context moved; subscription deliberately left alive

    a$.next({ issues: [issueAt(9, 'stale')], languageToolUnavailable: true, languageToolCode: 'disabled' });
    fixture.detectChanges();
    expect(component.issues).toEqual([]);
    expect(component.hasDetected).toBe(false);
    expect(component.serviceUnavailableMessage).toBeNull();

    // Same for the error arm: a stale failure must not banner over the chapter now open.
    const c$ = new Subject<IssuesResponse>();
    serviceStub.getIssues.and.returnValue(c$);
    component.chapterId = 'chap-c';
    component.loadIssues();
    component.chapterId = 'chap-d';
    c$.error({ status: 500 });
    fixture.detectChanges();
    expect(component.requestErrorMessage).toBeNull();
    expect(el().querySelector('.request-error-banner')).toBeNull();
  });

  it('a stale detect response cannot write the detect flags either (both detect handlers guarded)', () => {
    const d$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(d$);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges();
    component.detectIssues();
    expect(component.isDetecting).toBe(true);

    component.chapterId = 'chap-b'; // no ngOnChanges: the guard is on trial, not the teardown
    d$.next({ normalizedText: '', issues: [issueAt(50, 'stale-detect')] });
    fixture.detectChanges();
    expect(component.issues).toEqual([]);
    expect(component.hasDetected).toBe(false);
    expect(el().textContent).not.toContain('stale-detect');

    const e$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(e$);
    component.chapterId = 'chap-c';
    component.isDetecting = false;
    component.detectIssues();
    component.chapterId = 'chap-d';
    e$.error({ status: 500 });
    fixture.detectChanges();
    expect(component.requestErrorMessage).toBeNull();
  });

  it('two reads for the SAME chapter resolving out of order: the NEWER one wins', () => {
    const first$ = new Subject<IssuesResponse>();
    const second$ = new Subject<IssuesResponse>();
    let call = 0;
    serviceStub.getIssues.and.callFake(() => (++call === 1 ? first$ : second$));
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges(); // read #1, held open

    component.loadIssues();  // read #2 for the SAME key - a context guard alone cannot separate these
    expect(call).toBe(2);
    expect(first$.observed).toBe(false); // superseded, not merely ignored

    second$.next({ issues: [issueAt(1, 'newer')] });
    second$.complete();
    fixture.detectChanges();
    expect(el().textContent).toContain('newer');

    // The older, slower response now arrives LAST and must not win.
    first$.next({ issues: [issueAt(2, 'older')] });
    first$.complete();
    fixture.detectChanges();
    expect(el().textContent).toContain('newer');
    expect(el().textContent).not.toContain('older');
    expect(component.issues.length).toBe(1);
  });

  it('an in-flight GET is superseded by a detect for the same chapter and cannot overwrite it', () => {
    const load$ = new Subject<IssuesResponse>();
    const detect$ = new Subject<LanguageEngineResult>();
    serviceStub.getIssues.and.returnValue(load$);
    serviceStub.detectIssues.and.returnValue(detect$);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges(); // auto GET, held open

    component.detectIssues();
    expect(load$.observed).toBe(false);
    detect$.next({ normalizedText: '', issues: [issueAt(1, 'from-detect')] });
    detect$.complete();
    fixture.detectChanges();

    load$.next({ issues: [issueAt(2, 'from-get')] });
    load$.complete();
    fixture.detectChanges();
    expect(el().textContent).toContain('from-detect');
    expect(el().textContent).not.toContain('from-get');
  });

  // ── THE LATCH: a guarded early return must never strand the spinner ─────────────────────────────

  it('the spinner is down after a chapter switch during a detect (cancel path)', () => {
    const d$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(d$);
    serviceStub.getIssues.and.returnValue(NEVER);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges();
    component.detectIssues();
    fixture.detectChanges();
    expect(component.isDetecting).toBe(true);

    switchChapterTo('chap-b', 'chap-a');

    expect(component.isDetecting).toBe(false);
    expect(d$.observed).toBe(false);
    const button = fixture.debugElement.queryAll(By.css('.header-actions button'))[0];
    expect(button.nativeElement.textContent.trim()).toBe('Detect Issues');
    expect(button.nativeElement.disabled).toBe(false);

    // And the abandoned response arriving afterwards does not re-raise it.
    d$.next({ normalizedText: '', issues: [] });
    fixture.detectChanges();
    expect(component.isDetecting).toBe(false);
  });

  it('the spinner is down after the second cancel path: a GET issued while a detect is in flight', () => {
    const d$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(d$);
    serviceStub.getIssues.and.returnValue(NEVER);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges();
    component.detectIssues();
    expect(component.isDetecting).toBe(true);

    component.loadIssues(); // supersedes the detect for the same key

    expect(component.isDetecting).toBe(false);
    expect(d$.observed).toBe(false);
  });

  it('the spinner is down on the ordinary next and error paths too', () => {
    const ok$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(ok$);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    fixture.detectChanges();
    component.detectIssues();
    ok$.next({ normalizedText: '', issues: [] });
    ok$.complete();
    expect(component.isDetecting).toBe(false);

    const bad$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(bad$);
    component.detectIssues();
    expect(component.isDetecting).toBe(true);
    bad$.error({ status: 500 });
    expect(component.isDetecting).toBe(false);
  });

  it('teardown drops every in-flight request and lowers both latches', () => {
    const d$ = new Subject<LanguageEngineResult>();
    const r$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(d$);
    serviceStub.rewriteText.and.returnValue(r$);
    serviceStub.getIssues.and.returnValue(NEVER);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    component.issues = [issueAt(0, 'x')];
    fixture.detectChanges();
    // Rewrite first: `canRewrite` is false while a detect is in flight, so the other order cannot put
    // both requests in the air at once.
    component.rewriteText();
    component.detectIssues();
    expect(component.isDetecting).toBe(true);
    expect(component.isRewriting).toBe(true);

    fixture.destroy();

    expect(d$.observed).toBe(false);
    expect(r$.observed).toBe(false);
    expect(component.isDetecting).toBe(false);
    expect(component.isRewriting).toBe(false);
  });

  it('a rewrite for the previous chapter never becomes the current chapter\'s preview', () => {
    const r$ = new Subject<LanguageEngineResult>();
    serviceStub.rewriteText.and.returnValue(r$);
    serviceStub.getIssues.and.returnValue(NEVER);
    component.bookId = 'book-1';
    component.chapterId = 'chap-a';
    component.issues = [issueAt(0, 'x')];
    fixture.detectChanges();
    component.rewriteText();
    expect(component.isRewriting).toBe(true);

    component.chapterId = 'chap-b'; // guard on trial (no reset)
    r$.next({ normalizedText: '', issues: [], rewrittenText: 'chapter A rewritten' });
    fixture.detectChanges();

    expect(component.rewrittenText).toBeUndefined();
    expect(el().textContent).not.toContain('chapter A rewritten');
  });
});

/**
 * c13: WHICH ABSENCE A HEBREW BOOK IS ALLOWED TO HIDE - findings 29 and 30, which are one defect.
 *
 * b2 keyed the unavailable-banner suppression on `!canDetect`, i.e. on the BOOK'S LANGUAGE, so a Hebrew
 * book swallowed ALL FOUR `languageToolCode` values and the code-less legacy payload alike. A Hebrew
 * author whose checker was switched off in settings, unreachable, or timing out was told only "the
 * automatic language checker does not support Hebrew" - a confident, WRONG explanation of a real outage,
 * with the outage itself invisible. The asymmetry was the tell and it was measured in the browser before
 * this block was written: the SAME response (`languageToolUnavailable: true`, `languageToolCode:
 * "unavailable"`, LanguageTool genuinely down) put a banner on the English book and nothing at all on the
 * Hebrew one.
 *
 * The second half is the same defect seen from the strings: because the banner was set only when
 * `canDetect` was true, and `canDetect` is true only when `langKey === 'en'`, `entry[this.langKey]` could
 * never resolve its `he` arm. Every Hebrew sentence in `UNAVAILABLE_COPY`, and the Hebrew
 * `serviceUnavailableFallback`, was UNRENDERABLE - shipped, reviewed as DRAFT, assigned "the running app,
 * the שפה sub-tab" as its native-reading instrument, and unreachable by that instrument. The specs
 * "proved" them by calling `unavailableCopyFor` directly, which is exactly the proxy that cannot see this.
 * So every case below asserts THE RENDERED BANNER TEXT, not the getter.
 *
 * THE RULE, and it is a rule about the REASON rather than about the language: suppress only the expected
 * absence - the `hebrew-unsupported` code, or (on a code-less legacy build) a message that says the
 * checker does not support Hebrew. Everything else banners.
 *
 * ONE HEBREW STRING IS STILL UNREACHABLE ON PURPOSE and is pinned as such below:
 * `UNAVAILABLE_COPY['hebrew-unsupported'].he`. On a Hebrew book that code IS the expected absence and is
 * suppressed by design (the standing note says it once already); on an English book whose chapter holds
 * Hebrew text the same code banners, but in that book `langKey` is `en`. So its Hebrew arm renders in no
 * cell that exists today. That is a finding about the record, not a bug to fix here - see
 * HEBREW_NATIVE_REVIEW.md's language-issues group, which now says so instead of promising a screen.
 */
describe('IssuePanelComponent (c13: suppression scoped to the EXPECTED absence)', () => {
  let component: IssuePanelComponent;
  let fixture: ComponentFixture<IssuePanelComponent>;
  let serviceStub: { getIssues: jasmine.Spy; detectIssues: jasmine.Spy; rewriteText: jasmine.Spy };

  beforeEach(async () => {
    serviceStub = {
      getIssues: jasmine.createSpy('getIssues').and.returnValue(NEVER),
      detectIssues: jasmine.createSpy('detectIssues').and.returnValue(NEVER),
      rewriteText: jasmine.createSpy('rewriteText').and.returnValue(NEVER),
    };
    await TestBed.configureTestingModule({
      imports: [IssuePanelComponent],
      providers: [{ provide: LanguageEngineService, useValue: serviceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    component = fixture.componentInstance;
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const bannerText = () =>
    el().querySelector('.service-unavailable-banner .banner-text')?.textContent?.trim() ?? null;

  /** The exact rendered sentences, spelled out here rather than read back off the component. */
  const HE = {
    hebrewUnsupported: 'בודק השפה אינו תומך בעברית, ולכן הטקסט הזה לא נבדק.',
    disabled: 'בודק השפה כבוי בהגדרות השרת.',
    unavailable: 'בודק השפה אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.',
    timeout: 'בודק השפה לא הגיב בזמן. אפשר לנסות שוב.',
    fallback: 'בודק השפה אינו זמין.',
    note: 'בודק השפה האוטומטי אינו תומך בעברית, ולכן איתור בעיות אינו זמין בספר הזה. להגהה בעברית אפשר להריץ את מעבר "הגהה" בלשונית "ניתוח".',
  };

  /** The API's own English sentences, verbatim from LanguageToolEngine.cs - the legacy, code-less wire. */
  const SERVER_EN = {
    hebrewUnsupported:
      "The language checker doesn't support Hebrew. Use a LanguageTool server with Hebrew support (e.g. a community Docker image), or rely on other checks.",
    unavailable:
      "The language checker (LanguageTool) isn't available right now. Make sure the LanguageTool server is running, or try again later.",
    disabled: 'The language checker is turned off in settings.',
    timeout: 'The language checker took too long to respond. Try again in a moment.',
    /** The API's FIFTH ServiceUnavailable path: no code, and the check actually ran (be-c02 owns it). */
    autoRetrySucceeded:
      "Checked using auto-detected language (requested language isn't supported by this server).",
  };

  /**
   * Drive THE ONLY REQUEST A HEBREW BOOK EVER ISSUES: the auto GET.
   *
   * `detectIssues` early-returns on `!canDetect`, so there is no second path to drive here and driving
   * this one is not a convenience - it is the whole reachable surface. Held open with a Subject rather
   * than `of()`, per this file's standing rule.
   */
  function loadWith(lang: 'he' | 'en', payload: Omit<IssuesResponse, 'issues'> & { issues?: LanguageIssue[] }): void {
    const load$ = new Subject<IssuesResponse>();
    serviceStub.getIssues.and.returnValue(load$);
    component.bookLanguage = lang;
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
    fixture.detectChanges();
    component.loadIssues();
    load$.next({ issues: [], ...payload });
    load$.complete();
    fixture.detectChanges();
  }

  // ── 1. Every code, on a HEBREW book, through the real GET ──────────────────────────────────────

  const CODE_CASES: { code: string; banner: string | null; why: string }[] = [
    { code: 'hebrew-unsupported', banner: null, why: 'the EXPECTED absence: the standing note already says it' },
    { code: 'disabled', banner: HE.disabled, why: 'an operator switched it off - an event, and news' },
    { code: 'unavailable', banner: HE.unavailable, why: 'the server is down - an event, and news' },
    { code: 'timeout', banner: HE.timeout, why: 'it did not answer in time - an event, and news' },
  ];

  for (const c of CODE_CASES) {
    it(`he + ${c.code} renders ${c.banner ? 'the Hebrew banner' : 'no banner'} (${c.why})`, () => {
      loadWith('he', { languageToolUnavailable: true, languageToolCode: c.code });
      expect(bannerText()).toBe(c.banner);
      // The capability note stands in every one of these cells: the book still has no Detect button.
      expect(el().querySelector('.detect-unsupported-note')?.textContent?.trim()).toBe(HE.note);
      // And nothing English ever reaches a Hebrew reader.
      expect(el().textContent).not.toContain('language checker');
    });
  }

  it('the suppressed cell says the not-supported fact ONCE, not twice', () => {
    loadWith('he', { languageToolUnavailable: true, languageToolCode: 'hebrew-unsupported' });
    expect(component.serviceUnavailableMessage).toBeNull();
    expect(el().querySelector('.service-unavailable-banner')).toBeNull();
    expect(el().textContent).not.toContain(HE.hebrewUnsupported);
  });

  // ── 2. FINDING 30: the Hebrew copy is reachable in the RENDERED UI, not only from a getter ─────

  it('the three outage sentences reach the DOM on a Hebrew book (finding 30)', () => {
    const reached: string[] = [];
    for (const code of ['disabled', 'unavailable', 'timeout']) {
      loadWith('he', { languageToolUnavailable: true, languageToolCode: code });
      const rendered = bannerText();
      expect(rendered).withContext(`code=${code} rendered no banner`).not.toBeNull();
      // Rendered, not merely returned: the sentence is in the page text.
      expect(el().textContent).withContext(`code=${code}`).toContain(rendered!);
      reached.push(rendered!);
    }
    expect(reached).toEqual([HE.disabled, HE.unavailable, HE.timeout]);
  });

  it('the Hebrew serviceUnavailableFallback reaches the DOM too, via an unknown code (finding 30)', () => {
    loadWith('he', { languageToolUnavailable: true, languageToolCode: 'something-be-c02-added' });
    expect(bannerText()).toBe(HE.fallback);
    expect(component.serviceUnavailableFallback).toBe(HE.fallback);
  });

  /**
   * The one Hebrew string finding 30 does NOT close, pinned so the next reader does not have to
   * re-derive it. Suppressing `hebrew-unsupported` on a Hebrew book is the intent, and an English book
   * renders the same code's `en` arm, so no cell renders this sentence. It stays in the map for the day
   * `be-c02` changes which axis `canDetect` reads.
   */
  it('UNAVAILABLE_COPY[hebrew-unsupported].he stays deliberately unrendered, and still exists', () => {
    component.bookLanguage = 'he';
    expect(component.unavailableCopyFor('hebrew-unsupported')).toBe(HE.hebrewUnsupported);
    loadWith('he', { languageToolUnavailable: true, languageToolCode: 'hebrew-unsupported' });
    expect(el().textContent).not.toContain(HE.hebrewUnsupported);
    // On an English book the same code DOES banner - in English, because that book's chrome is English.
    loadWith('en', { languageToolUnavailable: true, languageToolCode: 'hebrew-unsupported' });
    expect(bannerText()).toBe('The language checker does not support Hebrew, so this text was not checked.');
  });

  // ── 3. The code-less legacy payload: the MESSAGE decides, and only for the expected absence ────

  it('a legacy Hebrew-unsupported message on a Hebrew book is suppressed like the code', () => {
    loadWith('he', { languageToolUnavailable: true, languageToolMessage: SERVER_EN.hebrewUnsupported });
    expect(component.serviceUnavailableMessage).toBeNull();
    expect(el().querySelector('.service-unavailable-banner')).toBeNull();
    expect(el().textContent).not.toContain('Docker');
  });

  it('a legacy OUTAGE message on a Hebrew book banners in the Hebrew fallback', () => {
    loadWith('he', { languageToolUnavailable: true, languageToolMessage: SERVER_EN.unavailable });
    expect(bannerText()).toBe(HE.fallback);
    // The server's English is read, never rendered.
    expect(el().textContent).not.toContain('LanguageTool');
  });

  it('the other two legacy sentences, and a code-less payload with no message at all, also banner', () => {
    for (const message of [SERVER_EN.disabled, SERVER_EN.timeout, SERVER_EN.autoRetrySucceeded]) {
      loadWith('he', { languageToolUnavailable: true, languageToolMessage: message });
      expect(bannerText()).withContext(message).toBe(HE.fallback);
    }
    // No code AND no message: unexplained, therefore not the expected absence, therefore news.
    loadWith('he', { languageToolUnavailable: true });
    expect(bannerText()).toBe(HE.fallback);
  });

  it('a message that merely mentions Hebrew is not enough - the negation is what is matched', () => {
    loadWith('he', {
      languageToolUnavailable: true,
      languageToolMessage: 'Hebrew rules were reloaded and the server restarted; try again.',
    });
    expect(bannerText()).toBe(HE.fallback);
  });

  // ── 4. Nothing about the ordinary cells moved ─────────────────────────────────────────────────

  it('a clean answer clears the banner on a Hebrew book', () => {
    loadWith('he', { languageToolUnavailable: true, languageToolCode: 'timeout' });
    expect(bannerText()).toBe(HE.timeout);
    loadWith('he', { languageToolUnavailable: false, languageToolCode: 'timeout' });
    expect(component.serviceUnavailableMessage).toBeNull();
    expect(el().querySelector('.service-unavailable-banner')).toBeNull();
  });

  it('an English book is untouched by the scoping: every code still banners in English', () => {
    const EN: Record<string, string> = {
      'hebrew-unsupported': 'The language checker does not support Hebrew, so this text was not checked.',
      disabled: 'The language checker is turned off in the server settings.',
      unavailable: 'The language checker is not available right now. Please try again later.',
      timeout: 'The language checker did not respond in time. Please try again.',
    };
    for (const [code, sentence] of Object.entries(EN)) {
      loadWith('en', { languageToolUnavailable: true, languageToolCode: code });
      expect(bannerText()).withContext(code).toBe(sentence);
    }
  });
});
