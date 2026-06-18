import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LinguisticResultComponent } from './linguistic-result.component';
import { AnalysisResultDto } from '../../core/models/analysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLinguisticResult(
  structuredResult: string | null,
  overrides: Partial<AnalysisResultDto> = {}
): AnalysisResultDto {
  return {
    id: 'r-ling',
    chapterId: 'chap-1',
    jobId: null,
    type: 'LinguisticAnalysis',
    analysisType: 'LinguisticAnalysis',
    resultText: '',
    modelName: 'test-model',
    createdAt: new Date().toISOString(),
    scope: 'Chapter',
    structuredResult,
    sceneId: null,
    bookId: 'book-1',
    language: 'he',
    status: 'Active',
    proofreadNoChangesHint: false,
    suggestions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('LinguisticResultComponent', () => {
  let component: LinguisticResultComponent;
  let fixture: ComponentFixture<LinguisticResultComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LinguisticResultComponent],
      providers: [],
    }).compileComponents();

    fixture = TestBed.createComponent(LinguisticResultComponent);
    component = fixture.componentInstance;
  });

  function setResult(result: AnalysisResultDto): void {
    component.result = result;
    fixture.detectChanges();
  }

  // =========================================================================
  // 1. parseFailed: invalid JSON
  // =========================================================================

  describe('parseFailed branch', () => {
    it('renders parse-error and raw-toggle when structuredResult is invalid JSON', () => {
      setResult(makeLinguisticResult('{not valid json'));

      const parseError = fixture.debugElement.query(By.css('[data-testid="linguistic-parse-error"]'));
      const rawToggle = fixture.debugElement.query(By.css('[data-testid="linguistic-raw-toggle"]'));
      expect(parseError).not.toBeNull();
      expect(rawToggle).not.toBeNull();
    });

    it('does NOT render structured blocks when structuredResult is invalid JSON', () => {
      setResult(makeLinguisticResult('{not valid json'));

      const deviations = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      const consistency = fixture.debugElement.query(By.css('[data-testid="linguistic-consistency"]'));
      expect(deviations).toBeNull();
      expect(consistency).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. parseFailed: null structuredResult
    // -------------------------------------------------------------------------

    it('renders parse-error and raw-toggle when structuredResult is null', () => {
      setResult(makeLinguisticResult(null));

      const parseError = fixture.debugElement.query(By.css('[data-testid="linguistic-parse-error"]'));
      const rawToggle = fixture.debugElement.query(By.css('[data-testid="linguistic-raw-toggle"]'));
      expect(parseError).not.toBeNull();
      expect(rawToggle).not.toBeNull();
    });

    it('does NOT render structured blocks when structuredResult is null', () => {
      setResult(makeLinguisticResult(null));

      const deviations = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      const consistency = fixture.debugElement.query(By.css('[data-testid="linguistic-consistency"]'));
      expect(deviations).toBeNull();
      expect(consistency).toBeNull();
    });
  });

  // =========================================================================
  // 3. emptyStructured + hasRawText
  // =========================================================================

  describe('emptyStructured + hasRawText branch', () => {
    const RAW_TEXT = 'This is a non-trivial raw response longer than twenty characters.';

    it('renders [data-testid="linguistic-empty-note"] when parsed result is empty and rawText is long', () => {
      setResult(makeLinguisticResult('{}', { resultText: RAW_TEXT }));

      const emptyNote = fixture.debugElement.query(By.css('[data-testid="linguistic-empty-note"]'));
      expect(emptyNote).not.toBeNull();
    });

    it('does NOT show raw block initially, then shows it after clicking raw-toggle', () => {
      setResult(makeLinguisticResult('{}', { resultText: RAW_TEXT }));

      // Raw block should be hidden initially.
      let rawBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-raw"]'));
      expect(rawBlock).toBeNull();

      // Click the toggle button.
      const toggleBtn = fixture.debugElement.query(By.css('[data-testid="linguistic-raw-toggle"]'));
      expect(toggleBtn).not.toBeNull();
      (toggleBtn.nativeElement as HTMLButtonElement).click();
      fixture.detectChanges();

      // Raw block should now be visible and contain the resultText.
      rawBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-raw"]'));
      expect(rawBlock).not.toBeNull();
      expect((rawBlock.nativeElement as HTMLElement).textContent).toContain(RAW_TEXT);
    });
  });

  // =========================================================================
  // 4. 'notably' comparison band (en)
  // =========================================================================

  describe('deviation comparison phrases', () => {
    it('shows "notably above the chapter\'s usual" for sceneValue 11, chapterBaseline 9 (rel ~0.22, en)', () => {
      // rel = |11 - 9| / 9 = 2/9 ~= 0.222 which falls in [0.10, 0.30] => 'notably-higher'
      const structured = JSON.stringify({
        deviations: [
          { metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' },
        ],
      });
      setResult(makeLinguisticResult(structured, { language: 'en' }));

      const row = fixture.debugElement.query(By.css('[data-testid="deviation-row"]'));
      expect(row).not.toBeNull();
      const valuesEl = row.nativeElement.querySelector('.deviation-values') as HTMLElement | null;
      expect(valuesEl).not.toBeNull();
      expect(valuesEl?.textContent).toContain("notably above the chapter's usual");
    });
  });

  // =========================================================================
  // 5. Non-LinguisticAnalysis result: view is absent
  // =========================================================================

  describe('non-LinguisticAnalysis result', () => {
    it('does NOT render [data-testid="linguistic-view"] for a Proofread result', () => {
      const proofread: AnalysisResultDto = {
        id: 'r-pr',
        chapterId: 'chap-1',
        jobId: null,
        type: 'Proofread',
        analysisType: 'Proofread',
        resultText: 'Some proofread result.',
        modelName: 'test-model',
        createdAt: new Date().toISOString(),
        scope: 'Chapter',
        structuredResult: null,
        sceneId: null,
        bookId: 'book-1',
        language: 'he',
        status: 'Active',
        proofreadNoChangesHint: false,
        suggestions: [],
      };
      setResult(proofread);

      const view = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect(view).toBeNull();
    });

    it('returns null from view getter for a non-LinguisticAnalysis type', () => {
      const proofread: AnalysisResultDto = {
        id: 'r-pr2',
        chapterId: 'chap-1',
        jobId: null,
        type: 'Proofread',
        analysisType: 'Proofread',
        resultText: '',
        modelName: 'test-model',
        createdAt: new Date().toISOString(),
        scope: 'Chapter',
        structuredResult: null,
        sceneId: null,
        bookId: 'book-1',
        language: 'he',
        status: 'Active',
        proofreadNoChangesHint: false,
        suggestions: [],
      };
      component.result = proofread;
      expect(component.view).toBeNull();
    });
  });

  // =========================================================================
  // 6. Result language drives text direction (RTL default, LTR for English)
  // =========================================================================

  describe('result language drives text direction', () => {
    const structured = JSON.stringify({ deviations: [], consistencyIssues: [] });

    it('defaults to RTL/Hebrew when the result has no language', () => {
      setResult(makeLinguisticResult(structured, { language: '' }));

      expect(component.view!.dir).toBe('rtl');
      const view = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect((view.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
    });

    it('renders LTR when the result language is English', () => {
      setResult(makeLinguisticResult(structured, { language: 'en' }));

      expect(component.view!.dir).toBe('ltr');
      const view = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect((view.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
    });
  });
});
