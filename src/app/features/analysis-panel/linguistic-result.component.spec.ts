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
  // 3a. emptyStructured suppressed when consistency suggestions are present
  // =========================================================================

  describe('emptyStructured suppressed by consistency suggestions', () => {
    const RAW_TEXT = 'This is a non-trivial raw response longer than twenty characters.';

    it('does NOT render linguistic-empty-note or raw-toggle when result has a consistency suggestion', () => {
      // No summary, no deviations in structuredResult, but suggestions carry a consistency-pov item.
      setResult(makeLinguisticResult('{}', {
        resultText: RAW_TEXT,
        suggestions: [
          {
            id: 's-1',
            analysisResultId: 'r-ling',
            category: 'consistency-pov',
            text: 'POV shift detected.',
            severity: 'warning',
            sceneId: null,
            chapterStartOffset: null,
            chapterEndOffset: null,
            status: 'Active',
          } as any,
        ],
      }));

      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-empty-note"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-raw-toggle"]'))).toBeNull();
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
  // 5a. Non-object JSON payloads must not crash change detection
  // =========================================================================

  describe('non-object JSON payloads', () => {
    for (const payload of ['null', '123', '"just a string"', 'true', '[]']) {
      it(`treats JSON \`${payload}\` as a parse failure without throwing`, () => {
        // Reproduces the crash: detectChanges() evaluates the `view` getter, which used to read
        // parsed.summary off a non-object (e.g. null) and throw.
        expect(() => setResult(makeLinguisticResult(payload))).not.toThrow();
        expect(() => component.view).not.toThrow();

        const parseError = fixture.debugElement.query(By.css('[data-testid="linguistic-parse-error"]'));
        expect(parseError).not.toBeNull();
        expect(fixture.debugElement.query(By.css('[data-testid="deviation-row"]'))).toBeNull();
      });
    }
  });

  // =========================================================================
  // 5b. resultText fallback when structuredResult is absent
  // =========================================================================

  describe('resultText fallback', () => {
    // consistencyIssues are no longer rendered by this shared view (they are navigable suggestion
    // cards driven by result.suggestions; see analysis-run-tab / analysis-history-tab). This view
    // now renders only summary + deviations, so the fallback assertions check the deviation row.
    const validJson = JSON.stringify({
      deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }],
    });

    it('renders deviations from resultText when structuredResult is null', () => {
      setResult(makeLinguisticResult(null, { resultText: validJson }));

      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-parse-error"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="deviation-row"]'))).not.toBeNull();
    });

    it('prefers structuredResult over resultText when both are present', () => {
      const structured = JSON.stringify({ deviations: [], consistencyIssues: [] });
      setResult(makeLinguisticResult(structured, { resultText: validJson }));

      // structuredResult has no deviations, so none should render even though resultText has one.
      expect(fixture.debugElement.query(By.css('[data-testid="deviation-row"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="deviations-empty"]'))).not.toBeNull();
    });

    it('still shows parse-error when resultText is not JSON and structuredResult is null', () => {
      setResult(makeLinguisticResult(null, { resultText: 'just prose, definitely not json at all' }));

      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-parse-error"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="deviation-row"]'))).toBeNull();
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
