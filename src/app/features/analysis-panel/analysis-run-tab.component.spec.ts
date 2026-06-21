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
    proofreadResultUnreliable: false,
    suggestions: [],
    ...overrides,
  };
}

function makeProofreadResult(
  overrides: Partial<AnalysisResultDto> = {}
): AnalysisResultDto {
  return {
    id: 'r-proof',
    chapterId: 'chap-1',
    jobId: null,
    type: 'Proofread',
    analysisType: 'Proofread',
    resultText: '',
    modelName: 'test-model',
    createdAt: new Date().toISOString(),
    scope: 'Scene',
    structuredResult: null,
    sceneId: 'scene-1',
    bookId: 'book-1',
    language: 'he',
    status: 'Active',
    proofreadNoChangesHint: false,
    proofreadResultUnreliable: false,
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

  // =========================================================================
  // Proofread Run-tab states: the four mutually-exclusive completed-run states.
  // Each shows the model name in its header, exactly one message, and never a
  // "looks clean" alongside a warning (or vice versa).
  // =========================================================================

  describe('Proofread Run-tab states', () => {
    const oneSuggestion: AnalysisSuggestion = {
      id: 'p-1',
      original: 'teh',
      suggested: 'the',
      category: 'spelling',
      startOffset: 0,
      endOffset: 3,
    };

    function suggestionCards() {
      return fixture.debugElement.queryAll(By.css('.suggestions-block app-suggestion-card'));
    }

    // ---- State 1: UNRELIABLE + has suggestions (PROBLEM 2) ----------------
    it('UNRELIABLE + has suggestions: warning renders, cards do NOT, model name in header', () => {
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: true,
        modelName: 'Ollama:dicta',
      });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [oneSuggestion];
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.isProofreadResultUnreliable).toBe(true);

      const warning = query('.proofread-length-hint');
      expect(warning).not.toBeNull();
      expect(warning.nativeElement.textContent).toContain('We could not produce a reliable proofread');

      // Suggestion cards (and the whole suggestions block) must be suppressed.
      expect(query('.suggestions-block')).toBeNull();
      expect(suggestionCards().length).toBe(0);

      // "looks clean" must not render alongside the warning.
      expect(query('.proofread-all-good')).toBeNull();
      // Exactly one warning paragraph.
      expect(fixture.debugElement.queryAll(By.css('.proofread-length-hint')).length).toBe(1);

      // Model name appears in the (sole) result header.
      const header = warning.nativeElement.closest('article').querySelector('h4');
      expect(header.textContent).toContain('Proofread');
      expect(header.textContent).toContain('Ollama:dicta');
    });

    // ---- State 1b: UNRELIABLE + no suggestions ---------------------------
    it('UNRELIABLE + no suggestions: warning renders, "looks clean" does NOT, model name present', () => {
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: true,
        modelName: 'Ollama:dicta',
      });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [];
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.isProofreadResultUnreliable).toBe(true);

      const warning = query('.proofread-length-hint');
      expect(warning).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.proofread-length-hint')).length).toBe(1);
      expect(query('.proofread-all-good')).toBeNull();
      // No stray "no run yet" message either.
      expect(query('[data-testid="no-run-yet"]')).toBeNull();

      const header = warning.nativeElement.closest('article').querySelector('h4');
      expect(header.textContent).toContain('Ollama:dicta');
    });

    // ---- State 2: RELIABLE + has suggestions (PROBLEM 1 regression) -------
    it('RELIABLE + has suggestions: cards render, warning does NOT, model name in header', () => {
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: false,
        modelName: 'Ollama:dicta',
      });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [oneSuggestion];
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.isProofreadResultUnreliable).toBe(false);

      const block = query('.suggestions-block');
      expect(block).not.toBeNull();
      expect(suggestionCards().length).toBe(1);

      // Warning and "looks clean" must both be absent.
      expect(query('.proofread-length-hint')).toBeNull();
      expect(query('.proofread-all-good')).toBeNull();

      // Model name now shows in the suggestions header (regression for PROBLEM 1).
      const header = block.nativeElement.querySelector('h4');
      expect(header.textContent).toContain('Proofread');
      expect(header.textContent).toContain('Ollama:dicta');
    });

    // ---- State 3: RELIABLE + no suggestions ------------------------------
    it('RELIABLE + no suggestions: "looks clean" renders, warning does NOT, model name present', () => {
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: false,
        modelName: 'Ollama:dicta',
      });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [];
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.isProofreadResultUnreliable).toBe(false);

      const allGood = query('.proofread-all-good');
      expect(allGood).not.toBeNull();
      expect(allGood.nativeElement.textContent).toContain('No changes needed. Your text looks clean.');

      expect(query('.proofread-length-hint')).toBeNull();
      expect(query('.suggestions-block')).toBeNull();

      const header = allGood.nativeElement.closest('article').querySelector('h4');
      expect(header.textContent).toContain('Ollama:dicta');
    });

    it('CLEAN: treats an undefined proofreadResultUnreliable as reliable', () => {
      component.latestResult = makeProofreadResult({ proofreadResultUnreliable: undefined });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [];
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.isProofreadResultUnreliable).toBe(false);
      expect(query('.proofread-all-good')).not.toBeNull();
      expect(query('.proofread-length-hint')).toBeNull();
    });

    // ---- State 4: FINALIZING (streaming just finished, loadHistory in flight) ----
    it('FINALIZING + no suggestions: "looks clean" is suppressed and a finalizing hint shows instead', () => {
      // Synthetic streaming row: no suggestions, no reliability flag yet. Without the finalizing guard this
      // would wrongly render "No changes needed" even though the run may still surface edits / a warning.
      component.latestResult = makeProofreadResult({ proofreadResultUnreliable: undefined });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [];
      component.streamingText = '';
      component.proofreadFinalizing = true;
      fixture.detectChanges();

      expect(query('.proofread-all-good')).toBeNull();
      const finalizing = query('.proofread-finalizing');
      expect(finalizing).not.toBeNull();
      expect(finalizing.nativeElement.textContent).toContain('Finalizing');
    });

    it('FINALIZING cleared: once finalizing ends with no suggestions, "looks clean" renders', () => {
      component.latestResult = makeProofreadResult({ proofreadResultUnreliable: false });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [];
      component.streamingText = '';
      component.proofreadFinalizing = false;
      fixture.detectChanges();

      expect(query('.proofread-finalizing')).toBeNull();
      expect(query('.proofread-all-good')).not.toBeNull();
    });
  });
});
