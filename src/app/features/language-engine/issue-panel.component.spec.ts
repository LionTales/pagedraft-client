/**
 * c06: IssuePanelComponent he/en chrome parity.
 *
 * The panel is the "Edit help -> Language" subnav under the redesigned IA. It was fully hardcoded
 * English; this spec pins the localized chrome so a Hebrew book (default) renders Hebrew and an
 * English book renders English.
 *
 * Covers:
 *  - default (no bookLanguage) renders Hebrew chrome (h3 'בעיות שפה', Detect button, empty-state line);
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
import { LanguageEngineResult } from '../../core/models/language-engine';

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

    it('renders the Hebrew Detect button', () => {
      const buttons = fixture.debugElement.queryAll(By.css('.header-actions button'));
      expect(buttons[0].nativeElement.textContent.trim()).toBe('אתר בעיות');
    });

    it('renders the Hebrew empty-prompt empty-state line', () => {
      const prompt = query('.no-issues p');
      expect(prompt.nativeElement.textContent.trim()).toBe(
        'לחצו על "אתר בעיות" כדי לבדוק בעיות שפה.'
      );
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
    it('shows the localized "Detecting..." label while the detect call is in flight, then settles', () => {
      const detect$ = new Subject<LanguageEngineResult>();
      serviceStub.detectIssues.and.returnValue(detect$);
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.bookLanguage = 'he';
      fixture.detectChanges();

      component.detectIssues();
      fixture.detectChanges();

      const buttons = fixture.debugElement.queryAll(By.css('.header-actions button'));
      // Subject is still open => pending label is shown (real optimistic window).
      expect(component.isDetecting).toBe(true);
      expect(buttons[0].nativeElement.textContent.trim()).toBe('מאתר...');

      // Now settle the call.
      detect$.next({ normalizedText: '', issues: [] });
      detect$.complete();
      fixture.detectChanges();

      expect(component.isDetecting).toBe(false);
      const after = fixture.debugElement.queryAll(By.css('.header-actions button'));
      expect(after[0].nativeElement.textContent.trim()).toBe('אתר בעיות');
    });
  });

  // ── Logic untouched: detect wiring still drives the service ─────────────────

  it('detectIssues delegates to the service with bookId + chapterId (logic preserved)', () => {
    const detect$ = new Subject<LanguageEngineResult>();
    serviceStub.detectIssues.and.returnValue(detect$);
    component.bookId = 'book-9';
    component.chapterId = 'chap-9';
    fixture.detectChanges();

    component.detectIssues();
    expect(serviceStub.detectIssues).toHaveBeenCalledWith('book-9', 'chap-9');
  });
});
