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
import { IssuesResponse, LanguageEngineResult } from '../../core/models/language-engine';

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
 *  - the unavailable banner is suppressed entirely for a Hebrew book, because the expected absence is
 *    already stated once by the note.
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

    // ── The unavailable banner is suppressed entirely for Hebrew ──────────────
    it('suppresses the unavailable banner even when the server reports the checker unavailable', () => {
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
      // The failure must NOT read as a clean "no issues found" empty state.
      expect(component.hasDetected).toBe(false);
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
