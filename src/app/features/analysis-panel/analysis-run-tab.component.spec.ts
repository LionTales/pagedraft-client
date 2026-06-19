import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { AnalysisResultDto, AnalysisSuggestion } from '../../core/models/analysis';

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

describe('AnalysisRunTabComponent', () => {
  let component: AnalysisRunTabComponent;
  let fixture: ComponentFixture<AnalysisRunTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisRunTabComponent],
      // Linguistic results never parse as Line Edit; stub keeps the test isolated.
      providers: [{ provide: LineEditParserService, useValue: { getLineEdit: () => null } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisRunTabComponent);
    component = fixture.componentInstance;
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // =========================================================================
  // Regression: a completed LinguisticAnalysis must not also show "no run yet"
  // =========================================================================

  describe('completed LinguisticAnalysis run', () => {
    const structured = JSON.stringify({
      deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }],
      consistencyIssues: [],
    });

    it('renders the dedicated linguistic view and NOT the "no analysis run yet" message', () => {
      component.latestResult = makeLinguisticResult(structured);
      component.streamingText = '';
      fixture.detectChanges();

      // Dedicated linguistic block renders, with the parsed deviation chip (not the raw stream).
      expect(query('[data-testid="linguistic-view"]')).not.toBeNull();
      expect(query('[data-testid="deviation-row"]')).not.toBeNull();
      // The generic empty-state must NOT contradict it.
      expect(query('[data-testid="no-run-yet"]')).toBeNull();
    });
  });

  // =========================================================================
  // The empty state still shows when nothing has run
  // =========================================================================

  describe('no run yet', () => {
    it('shows the "no analysis run yet" message when there is no result or stream', () => {
      component.latestResult = null;
      component.streamingText = '';
      component.proofreadSuggestions = [];
      component.lineEditRunSuggestions = [];
      fixture.detectChanges();

      expect(query('[data-testid="no-run-yet"]')).not.toBeNull();
      expect(query('[data-testid="linguistic-view"]')).toBeNull();
    });
  });

  // =========================================================================
  // While a linguistic run is still streaming, neither the dedicated block
  // nor the empty-state message should appear (live text owns the view).
  // =========================================================================

  describe('streaming linguistic run', () => {
    it('does not show the dedicated linguistic view or the "no run yet" message mid-stream', () => {
      component.latestResult = null;
      component.streamingText = 'partial tokens streaming in...';
      fixture.detectChanges();

      expect(query('[data-testid="linguistic-view"]')).toBeNull();
      expect(query('[data-testid="no-run-yet"]')).toBeNull();
    });
  });

  // =========================================================================
  // Consistency suggestions: Run tab wiring
  // =========================================================================

  describe('consistency suggestions in Run tab', () => {
    const consistencySuggestion: AnalysisSuggestion = {
      id: 'con-1',
      original: 'She ran toward him.',
      suggested: '',
      category: 'consistency-pov',
      startOffset: 100,
      endOffset: 119,
    };

    function setupLinguisticRunWithConsistency(): void {
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [], consistencyIssues: [] })
      );
      component.selectedAnalysisType = 'LinguisticAnalysis';
      component.consistencyRunSuggestions = [consistencySuggestion];
      component.streamingText = '';
      fixture.detectChanges();
    }

    it('renders a suggestion-card for each consistency suggestion', () => {
      setupLinguisticRunWithConsistency();
      const container = query('[data-testid="consistency-suggestions"]');
      expect(container).not.toBeNull();
      const cards = fixture.debugElement.queryAll(By.css('[data-testid="consistency-suggestions"] app-suggestion-card'));
      expect(cards.length).toBe(1);
    });

    it('consistency block is absent when consistencyRunSuggestions is empty', () => {
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [], consistencyIssues: [] })
      );
      component.consistencyRunSuggestions = [];
      component.streamingText = '';
      fixture.detectChanges();
      expect(query('[data-testid="consistency-suggestions"]')).toBeNull();
    });

    it('showInDocumentEvent is emitted when the card emits showInDocument', () => {
      setupLinguisticRunWithConsistency();

      const emitted: AnalysisSuggestion[] = [];
      component.showInDocumentEvent.subscribe((s: AnalysisSuggestion) => emitted.push(s));

      // Trigger showInDocument output on the child card via Show button click
      const show = fixture.debugElement.query(
        By.css('[data-testid="consistency-suggestions"] .btn-show')
      );
      expect(show).not.toBeNull();
      show.nativeElement.click();

      expect(emitted.length).toBe(1);
      expect(emitted[0].id).toBe('con-1');
    });

    it('consistencyDismiss output fires with suggestion + result when dismiss is clicked', () => {
      setupLinguisticRunWithConsistency();

      const dismissed: { suggestion: AnalysisSuggestion; result: AnalysisResultDto }[] = [];
      component.consistencyDismiss.subscribe((e) => dismissed.push(e));

      const btn = fixture.debugElement.query(
        By.css('[data-testid="consistency-suggestions"] .btn-dismiss')
      );
      expect(btn).not.toBeNull();
      btn.nativeElement.click();

      expect(dismissed.length).toBe(1);
      expect(dismissed[0].suggestion.id).toBe('con-1');
      expect(dismissed[0].result).toBe(component.latestResult as AnalysisResultDto);
    });

    it('consistencyCardLang returns "he" when bookLanguage is null (defaults to Hebrew)', () => {
      component.latestResult = makeLinguisticResult(null, { language: null });
      component.bookLanguage = null;
      expect(component.consistencyCardLang).toBe('he');
    });

    it('consistencyCardLang returns "en" when result language is "en"', () => {
      component.latestResult = makeLinguisticResult(null, { language: 'en' });
      component.bookLanguage = null;
      expect(component.consistencyCardLang).toBe('en');
    });
  });
});
