import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AnalysisHistoryTabComponent } from './analysis-history-tab.component';
import { AnalysisResultDto } from '../../core/models/analysis';
import { LinguisticAnalysis } from '../../core/models/language-engine';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLinguisticResult(
  linguisticData: Partial<LinguisticAnalysis>,
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
    structuredResult: JSON.stringify(linguisticData),
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

describe('AnalysisHistoryTabComponent – linguistic rendering', () => {
  let component: AnalysisHistoryTabComponent;
  let fixture: ComponentFixture<AnalysisHistoryTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisHistoryTabComponent],
      providers: [
        LineEditParserService,
        SuggestionKeyService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisHistoryTabComponent);
    component = fixture.componentInstance;
    // Minimal required inputs so ngOnChanges does not throw.
    component.history = [];
    component.analysisTypes = [];
    fixture.detectChanges();
  });

  // -------------------------------------------------------------------------
  // Utility: load a single linguistic history item and trigger CD.
  // -------------------------------------------------------------------------
  function loadResult(result: AnalysisResultDto): void {
    component.history = [result];
    fixture.detectChanges();
  }

  // =========================================================================
  // 1. Deviations
  // =========================================================================

  describe('deviations', () => {
    it('renders one deviation-row per deviation', () => {
      const result = makeLinguisticResult({
        deviations: [
          { metric: 'averageSentenceLength', sceneValue: 12, chapterBaseline: 8, note: 'Long sentences' },
          { metric: 'sentenceCount', sceneValue: 5, chapterBaseline: 10, note: 'Few sentences' },
          { metric: 'wordCount', sceneValue: 300, chapterBaseline: 250, note: '' },
        ],
      });
      loadResult(result);

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      expect(rows.length).toBe(3);
    });

    it('renders metric label, scene value, chapter baseline and note for each deviation', () => {
      const result = makeLinguisticResult({
        deviations: [
          { metric: 'averageSentenceLength', sceneValue: 15, chapterBaseline: 9, note: 'Very long' },
          { metric: 'sentenceCount', sceneValue: 3, chapterBaseline: 7, note: 'Too few' },
        ],
      });
      loadResult(result);

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      expect(rows.length).toBe(2);

      const firstRowEl: HTMLElement = rows[0].nativeElement;
      expect(firstRowEl.querySelector('.deviation-metric')?.textContent).toContain('אורך משפט ממוצע');
      // Raw numbers appear inside the muted suffix span inside .deviation-values.
      expect(firstRowEl.querySelector('.deviation-values')?.textContent).toContain('15');
      expect(firstRowEl.querySelector('.deviation-values')?.textContent).toContain('9');
      expect(firstRowEl.querySelector('.deviation-note')?.textContent).toContain('Very long');

      const secondRowEl: HTMLElement = rows[1].nativeElement;
      expect(secondRowEl.querySelector('.deviation-metric')?.textContent).toContain('מספר משפטים');
      expect(secondRowEl.querySelector('.deviation-values')?.textContent).toContain('3');
      expect(secondRowEl.querySelector('.deviation-values')?.textContent).toContain('7');
      expect(secondRowEl.querySelector('.deviation-note')?.textContent).toContain('Too few');
    });

    it('renders a friendly comparison phrase as the main deviation-values text (he)', () => {
      // 0.52 vs 0.48: rel = 0.04/0.48 = 0.083 -> slightly-lower in Hebrew
      const result = makeLinguisticResult({
        deviations: [
          { metric: 'lexicalDensity', sceneValue: 0.44, chapterBaseline: 0.48, note: '' },
          { metric: 'averageSentenceLength', sceneValue: 15, chapterBaseline: 9, note: '' },
        ],
      }, { language: 'he' });
      loadResult(result);

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));

      // rel for first: |0.44-0.48|/0.48 = 0.083 -> slightly-lower
      expect(rows[0].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain('מעט נמוך מהרגיל בפרק');
      // rel for second: |15-9|/9 = 0.67 -> much-higher
      expect(rows[1].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain('גבוה בהרבה מהרגיל בפרק');
    });

    it('renders a friendly comparison phrase as the main deviation-values text (en)', () => {
      const result = makeLinguisticResult({
        deviations: [
          // rel = |15-9|/9 = 0.67 -> much-higher
          { metric: 'averageSentenceLength', sceneValue: 15, chapterBaseline: 9, note: '' },
          // rel = 0 -> same
          { metric: 'sentenceCount', sceneValue: 10, chapterBaseline: 10, note: '' },
        ],
      }, { language: 'en' });
      loadResult(result);

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      expect(rows[0].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain("much above the chapter's usual");
      expect(rows[1].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain("about the same as the chapter's usual");
    });

    it('shows raw numbers in the muted suffix inside deviation-values', () => {
      const result = makeLinguisticResult({
        deviations: [
          { metric: 'averageSentenceLength', sceneValue: 15, chapterBaseline: 9, note: '' },
        ],
      }, { language: 'he' });
      loadResult(result);

      const row = fixture.debugElement.query(By.css('[data-testid="deviation-row"]'));
      const rawSpan = row.nativeElement.querySelector('.deviation-values-raw') as HTMLElement | null;
      expect(rawSpan).not.toBeNull();
      expect(rawSpan?.textContent).toContain('15');
      expect(rawSpan?.textContent).toContain('9');
      // Hebrew raw-vs separator
      expect(rawSpan?.textContent).toContain('לעומת');
    });
  });

  // =========================================================================
  // 2. Consistency issues
  // =========================================================================

  describe('consistency issues', () => {
    it('renders one consistency-row per issue', () => {
      const result = makeLinguisticResult({
        consistencyIssues: [
          { type: 'register', span: 'span1', description: 'desc1' },
          { type: 'tense', span: 'span2', description: 'desc2' },
          { type: 'pov', span: 'span3', description: 'desc3' },
        ],
      });
      loadResult(result);

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="consistency-row"]'));
      expect(rows.length).toBe(3);
    });

    it('each chip has the correct consistency-type-{type} class (Hebrew default)', () => {
      const result = makeLinguisticResult({
        consistencyIssues: [
          { type: 'register', span: '', description: 'Register shift' },
          { type: 'tense', span: '', description: 'Tense inconsistency' },
          { type: 'pov', span: '', description: 'POV shift' },
        ],
      });
      loadResult(result);

      const chips = fixture.debugElement.queryAll(By.css('[data-testid="consistency-type"]'));
      expect(chips.length).toBe(3);

      expect(chips[0].nativeElement.classList).toContain('consistency-type-register');
      expect(chips[1].nativeElement.classList).toContain('consistency-type-tense');
      expect(chips[2].nativeElement.classList).toContain('consistency-type-pov');
    });

    it('renders Hebrew localized labels for consistency type chips (default language)', () => {
      const result = makeLinguisticResult(
        {
          consistencyIssues: [
            { type: 'register', span: '', description: 'Register shift' },
            { type: 'tense', span: '', description: 'Tense inconsistency' },
            { type: 'pov', span: '', description: 'POV shift' },
          ],
        },
        { language: 'he' }
      );
      loadResult(result);

      const chips = fixture.debugElement.queryAll(By.css('[data-testid="consistency-type"]'));
      expect(chips[0].nativeElement.textContent.trim()).toBe('רישום');
      expect(chips[1].nativeElement.textContent.trim()).toBe('זמן דקדוקי');
      expect(chips[2].nativeElement.textContent.trim()).toBe('נקודת מבט');
    });

    it('renders English localized labels for consistency type chips when language starts with "en"', () => {
      const result = makeLinguisticResult(
        {
          consistencyIssues: [
            { type: 'register', span: '', description: 'Register shift' },
            { type: 'tense', span: '', description: 'Tense inconsistency' },
            { type: 'pov', span: '', description: 'POV shift' },
          ],
        },
        { language: 'en' }
      );
      loadResult(result);

      const chips = fixture.debugElement.queryAll(By.css('[data-testid="consistency-type"]'));
      expect(chips[0].nativeElement.textContent.trim()).toBe('Register');
      expect(chips[1].nativeElement.textContent.trim()).toBe('Tense');
      expect(chips[2].nativeElement.textContent.trim()).toBe('POV');
    });

    it('renders description and span for each consistency row', () => {
      const result = makeLinguisticResult({
        consistencyIssues: [
          { type: 'register', span: 'my span text', description: 'a register description' },
        ],
      });
      loadResult(result);

      const row = fixture.debugElement.query(By.css('[data-testid="consistency-row"]'));
      expect(row.nativeElement.querySelector('.consistency-description')?.textContent).toContain('a register description');
      expect(row.nativeElement.querySelector('.consistency-span')?.textContent).toContain('my span text');
    });
  });

  // =========================================================================
  // 3. Empty states
  // =========================================================================

  describe('empty states', () => {
    it('renders [data-testid="deviations-empty"] and no deviation-rows when deviations is empty', () => {
      const result = makeLinguisticResult({
        deviations: [],
        consistencyIssues: [{ type: 'register', span: '', description: 'desc' }],
      });
      loadResult(result);

      const empty = fixture.debugElement.query(By.css('[data-testid="deviations-empty"]'));
      expect(empty).not.toBeNull();

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      expect(rows.length).toBe(0);
    });

    it('renders [data-testid="consistency-empty"] and no consistency-rows when consistencyIssues is empty', () => {
      const result = makeLinguisticResult({
        deviations: [{ metric: 'wordCount', sceneValue: 100, chapterBaseline: 80, note: '' }],
        consistencyIssues: [],
      });
      loadResult(result);

      const empty = fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'));
      expect(empty).not.toBeNull();

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="consistency-row"]'));
      expect(rows.length).toBe(0);
    });

    it('renders both empty-state messages when both arrays are empty', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] });
      loadResult(result);

      const devEmpty = fixture.debugElement.query(By.css('[data-testid="deviations-empty"]'));
      const conEmpty = fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'));
      expect(devEmpty).not.toBeNull();
      expect(conEmpty).not.toBeNull();

      const devRows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      const conRows = fixture.debugElement.queryAll(By.css('[data-testid="consistency-row"]'));
      expect(devRows.length).toBe(0);
      expect(conRows.length).toBe(0);
    });
  });

  // =========================================================================
  // 5. Linguistic view section is absent for non-LinguisticAnalysis results
  // =========================================================================

  describe('linguistic-view section visibility', () => {
    it('does NOT render [data-testid="linguistic-view"] for a non-LinguisticAnalysis result', () => {
      const nonLing: AnalysisResultDto = {
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
      loadResult(nonLing);

      const view = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect(view).toBeNull();
    });

    it('renders [data-testid="linguistic-view"] with dir=rtl for a Hebrew LinguisticAnalysis result', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'he' });
      loadResult(result);

      const view = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect(view).not.toBeNull();
      expect(view.nativeElement.getAttribute('dir')).toBe('rtl');
    });

    it('renders [data-testid="linguistic-view"] with dir=ltr for an English LinguisticAnalysis result', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'en' });
      loadResult(result);

      const view = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect(view).not.toBeNull();
      expect(view.nativeElement.getAttribute('dir')).toBe('ltr');
    });

    it('suppresses raw resultText blob (.analysis-list and .analysis-single) when analysisType is LinguisticAnalysis', () => {
      const rawBlob = '{"syntaxMetrics":{"sentenceCount":3},"summary":"raw"}';
      const result = makeLinguisticResult(
        { deviations: [], consistencyIssues: [] },
        { resultText: rawBlob, structuredResult: rawBlob }
      );
      loadResult(result);

      const linguisticView = fixture.debugElement.query(By.css('[data-testid="linguistic-view"]'));
      expect(linguisticView).not.toBeNull();

      const list = fixture.debugElement.query(By.css('.analysis-list'));
      expect(list).toBeNull();

      const single = fixture.debugElement.query(By.css('.analysis-single'));
      expect(single).toBeNull();
    });
  });

  // =========================================================================
  // 6. Localization parity
  // =========================================================================

  describe('localization parity', () => {
    it('uses Hebrew section labels by default', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'he' });
      loadResult(result);

      const devsBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      expect(devsBlock.nativeElement.textContent).toContain('חריגות סגנון מהפרק');

      const conBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-consistency"]'));
      expect(conBlock.nativeElement.textContent).toContain('בעיות עקביות');
    });

    it('uses English section labels when language is "en"', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'en' });
      loadResult(result);

      const devsBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      expect(devsBlock.nativeElement.textContent).toContain('Style deviations from chapter');

      const conBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-consistency"]'));
      expect(conBlock.nativeElement.textContent).toContain('Consistency issues');
    });

    it('uses English section labels when language starts with "en" (e.g. "en-US")', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'en-US' });
      loadResult(result);

      const devsBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      expect(devsBlock.nativeElement.textContent).toContain('Style deviations from chapter');
    });
  });
});
