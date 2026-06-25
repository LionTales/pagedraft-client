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

// A full, well-formed LiteraryAnalysisResult JSON (camelCase, matching the backend shape). The backend
// stores this re-serialized into resultText; the History tab must route it to app-literary-result, not
// the generic metric-cards / raw textResult block.
const LITERARY_JSON = JSON.stringify({
  themes: [{ name: 'Isolation', description: 'Loneliness.', significance: 'major' }],
  tone: 'Melancholic',
  toneDescription: 'Wistful throughout.',
  narrativeVoice: 'First person',
  narrativeVoiceDescription: 'Confessional narrator.',
  rhetoricalDevices: [{ name: 'Metaphor', example: 'The city was a beast.', effect: 'Menace.' }],
  moodProgression: 'Somber to hopeful.',
  summary: 'A reflective chapter on solitude.',
});

function makeLiteraryResult(
  resultText: string | null = LITERARY_JSON,
  overrides: Partial<AnalysisResultDto> = {}
): AnalysisResultDto {
  return {
    id: 'r-lit',
    chapterId: 'chap-1',
    jobId: null,
    type: 'LiteraryAnalysis',
    analysisType: 'LiteraryAnalysis',
    resultText: resultText ?? '',
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

      // Chapter-scope result (sceneId null) compares against the BOOK, so phrases read "בספר".
      // rel for first: |0.44-0.48|/0.48 = 0.083 -> slightly-lower
      expect(rows[0].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain('מעט נמוך מהרגיל בספר');
      // rel for second: |15-9|/9 = 0.67 -> much-higher
      expect(rows[1].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain('גבוה בהרבה מהרגיל בספר');
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
      // Chapter-scope result compares against the BOOK, so phrases read "the book's usual".
      expect(rows[0].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain("much above the book's usual");
      expect(rows[1].nativeElement.querySelector('.deviation-values')?.textContent)
        .toContain("about the same as the book's usual");
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
  // 2. Consistency issues are no longer rendered by linguistic-result chips.
  //    They are now navigable + dismissable suggestion cards driven by
  //    result.suggestions (category consistency-*); coverage for that lives in
  //    the f03 navigation specs. The shared linguistic view must NOT render the
  //    old chip markup any more.
  // =========================================================================

  describe('consistency chips removed from the shared linguistic view', () => {
    it('does NOT render consistency-row / consistency-type chips even when consistencyIssues is present', () => {
      const result = makeLinguisticResult({
        consistencyIssues: [
          { type: 'register', span: 'span1', description: 'desc1' },
          { type: 'tense', span: 'span2', description: 'desc2' },
          { type: 'pov', span: 'span3', description: 'desc3' },
        ],
      });
      loadResult(result);

      expect(fixture.debugElement.queryAll(By.css('[data-testid="consistency-row"]')).length).toBe(0);
      expect(fixture.debugElement.queryAll(By.css('[data-testid="consistency-type"]')).length).toBe(0);
      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).toBeNull();
    });
  });

  // =========================================================================
  // 3. Empty states (deviations only; consistency is no longer chip-rendered)
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

    it('renders the deviations block (with rows) when deviations are present', () => {
      const result = makeLinguisticResult({
        deviations: [{ metric: 'wordCount', sceneValue: 100, chapterBaseline: 80, note: '' }],
        consistencyIssues: [],
      });
      loadResult(result);

      const rows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      expect(rows.length).toBe(1);
    });

    it('renders the deviations empty-state message when deviations are empty', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] });
      loadResult(result);

      const devEmpty = fixture.debugElement.query(By.css('[data-testid="deviations-empty"]'));
      expect(devEmpty).not.toBeNull();

      const devRows = fixture.debugElement.queryAll(By.css('[data-testid="deviation-row"]'));
      expect(devRows.length).toBe(0);
    });
  });

  // =========================================================================
  // 4. Consistency suggestion cards in history
  // =========================================================================

  describe('consistency suggestion cards in history (LinguisticAnalysis)', () => {
    function makeConsistencyDto(id: string, outcome: string | null = null) {
      return {
        id,
        analysisResultId: 'r-ling',
        originalText: 'She looked at him.',
        suggestedText: '',
        startOffset: 0,
        endOffset: 18,
        reason: 'POV shift',
        category: 'consistency-pov',
        explanation: null,
        outcome,
        orderIndex: 0,
        contextBefore: null,
        contextAfter: null,
      };
    }

    it('renders a read-only consistency card for each consistency-* suggestion in history', () => {
      const result = makeLinguisticResult(
        { deviations: [], consistencyIssues: [] },
        {
          id: 'r-ling',
          suggestions: [makeConsistencyDto('cs-1')],
        }
      );
      loadResult(result);

      const container = fixture.debugElement.query(By.css('[data-testid="consistency-history"]'));
      expect(container).not.toBeNull();
      const cards = fixture.debugElement.queryAll(
        By.css('[data-testid="consistency-history"] app-suggestion-card')
      );
      expect(cards.length).toBe(1);
    });

    it('consistency history block is absent when there are no consistency-* suggestions', () => {
      // A LineEdit suggestion (exact match "consistency", not prefixed) must NOT appear.
      const lineEditConsistency = {
        id: 'le-1',
        analysisResultId: 'r-ling',
        originalText: 'he walked.',
        suggestedText: 'he strode.',
        startOffset: 0,
        endOffset: 10,
        reason: null,
        category: 'consistency',  // exact match, NOT 'consistency-*'
        explanation: null,
        outcome: null,
        orderIndex: 0,
        contextBefore: null,
        contextAfter: null,
      };
      const result = makeLinguisticResult(
        { deviations: [], consistencyIssues: [] },
        { id: 'r-ling', suggestions: [lineEditConsistency] }
      );
      loadResult(result);

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-history"]'))).toBeNull();
    });

    it('filteredConsistencySuggestionsWithStatusForCurrent returns empty for non-LinguisticAnalysis result', () => {
      const nonLing: AnalysisResultDto = {
        id: 'r-pr',
        chapterId: 'chap-1',
        jobId: null,
        type: 'Proofread',
        analysisType: 'Proofread',
        resultText: '',
        modelName: 'model',
        createdAt: new Date().toISOString(),
        scope: 'Chapter',
        structuredResult: null,
        sceneId: null,
        bookId: 'book-1',
        language: 'he',
        status: 'Active',
        proofreadNoChangesHint: false,
        suggestions: [makeConsistencyDto('cs-x')],
      };
      loadResult(nonLing);

      expect(component.filteredConsistencySuggestionsWithStatusForCurrent.length).toBe(0);
    });

    it('dismissed outcome is reflected as status=dismissed on the history card', () => {
      const result = makeLinguisticResult(
        { deviations: [], consistencyIssues: [] },
        {
          id: 'r-ling',
          suggestions: [makeConsistencyDto('cs-2', 'Dismissed')],
        }
      );
      loadResult(result);

      const items = component.filteredConsistencySuggestionsWithStatusForCurrent;
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('dismissed');
    });

    it('pending consistency suggestion has status=pending in history', () => {
      const result = makeLinguisticResult(
        { deviations: [], consistencyIssues: [] },
        {
          id: 'r-ling',
          suggestions: [makeConsistencyDto('cs-3', null)],
        }
      );
      loadResult(result);

      const items = component.filteredConsistencySuggestionsWithStatusForCurrent;
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('pending');
    });

    it('consistencyCardLang returns "he" for a Hebrew LinguisticAnalysis history item', () => {
      const result = makeLinguisticResult(
        { deviations: [] },
        { id: 'r-ling', language: 'he' }
      );
      loadResult(result);
      expect(component.consistencyCardLang).toBe('he');
    });

    it('consistencyCardLang returns "en" for an English LinguisticAnalysis history item', () => {
      const result = makeLinguisticResult(
        { deviations: [] },
        { id: 'r-ling', language: 'en' }
      );
      loadResult(result);
      expect(component.consistencyCardLang).toBe('en');
    });
  });

  // =========================================================================
  // 4b. Unreliable proofread history item
  // =========================================================================

  describe('unreliable proofread in history', () => {
    function makeProofreadSuggestionDto(id: string, orderIndex = 0) {
      return {
        id,
        analysisResultId: 'r-pr',
        originalText: 'teh',
        suggestedText: 'the',
        startOffset: 0,
        endOffset: 3,
        reason: 'Spelling',
        category: null,
        explanation: null,
        outcome: null,
        orderIndex,
        contextBefore: null,
        contextAfter: null,
      };
    }

    function makeProofreadResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
      return {
        id: 'r-pr',
        chapterId: 'chap-1',
        jobId: null,
        type: 'Proofread',
        analysisType: 'Proofread',
        resultText: 'the dropped raw text',
        modelName: 'test-model',
        createdAt: new Date().toISOString(),
        scope: 'Chapter',
        structuredResult: null,
        sceneId: null,
        bookId: 'book-1',
        language: 'he',
        status: 'Active',
        proofreadNoChangesHint: false,
        suggestions: [makeProofreadSuggestionDto('ps-1'), makeProofreadSuggestionDto('ps-2', 1)],
        ...overrides,
      };
    }

    it('unreliable: shows ONLY the warning (no cards, no "what happened" block, no raw list/single)', () => {
      const result = makeProofreadResult({ proofreadResultUnreliable: true });
      loadResult(result);

      // Warning paragraph present.
      const hint = fixture.debugElement.query(By.css('.proofread-length-hint'));
      expect(hint).not.toBeNull();
      expect(hint.nativeElement.textContent).toContain('We could not produce a reliable proofread');

      // Proofread cards / "what happened" block absent.
      expect(fixture.debugElement.queryAll(By.css('app-suggestion-card')).length).toBe(0);
      const headings = fixture.debugElement
        .queryAll(By.css('h4'))
        .map(h => (h.nativeElement.textContent || '').trim());
      expect(headings).not.toContain('Suggestions: what happened');

      // Raw resultText fallback absent.
      expect(fixture.debugElement.query(By.css('.analysis-list'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.analysis-single'))).toBeNull();
    });

    it('reliable proofread with suggestions: cards render and the warning is absent (control)', () => {
      const result = makeProofreadResult({ proofreadResultUnreliable: false });
      loadResult(result);

      const cards = fixture.debugElement.queryAll(By.css('app-suggestion-card'));
      expect(cards.length).toBe(2);

      expect(fixture.debugElement.query(By.css('.proofread-length-hint'))).toBeNull();
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

  // Fixtures here are chapter-scope (scope 'Chapter', sceneId null), which compares against the BOOK,
  // so the deviations section title reads "from book" / "מהספר".
  describe('localization parity', () => {
    it('uses Hebrew section labels by default', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'he' });
      loadResult(result);

      const devsBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      expect(devsBlock.nativeElement.textContent).toContain('חריגות סגנון מהספר');

      // The consistency block was removed from this shared view (now suggestion-card driven).
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-consistency"]'))).toBeNull();
    });

    it('uses English section labels when language is "en"', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'en' });
      loadResult(result);

      const devsBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      expect(devsBlock.nativeElement.textContent).toContain('Style deviations from book');

      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-consistency"]'))).toBeNull();
    });

    it('uses English section labels when language starts with "en" (e.g. "en-US")', () => {
      const result = makeLinguisticResult({ deviations: [], consistencyIssues: [] }, { language: 'en-US' });
      loadResult(result);

      const devsBlock = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      expect(devsBlock.nativeElement.textContent).toContain('Style deviations from book');
    });
  });

  // =========================================================================
  // 7. Literary rendering in history
  //    A historical LiteraryAnalysis result must route to app-literary-result
  //    (the same dedicated renderer the Run tab now uses) and NEVER fall through
  //    to the generic metric-cards path or the raw textResult fallback. Mirrors
  //    the LinguisticAnalysis precedent above.
  // =========================================================================

  describe('literary rendering in history (LiteraryAnalysis)', () => {
    it('routes a historical LiteraryAnalysis result to app-literary-result with parsed sections', () => {
      loadResult(makeLiteraryResult());

      expect(fixture.debugElement.query(By.css('app-literary-result'))).not.toBeNull();
      const view = fixture.debugElement.query(By.css('[data-testid="literary-view"]'));
      expect(view).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-summary"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="theme-row"]'))).not.toBeNull();
    });

    it('does NOT dump the raw resultText JSON through the generic metric-cards / textResult block', () => {
      // structuredResult set too, to prove the metric-cards path is also excluded for Literary.
      loadResult(makeLiteraryResult(LITERARY_JSON, { structuredResult: LITERARY_JSON }));

      expect(fixture.debugElement.query(By.css('.metric-cards'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.analysis-list'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.analysis-single'))).toBeNull();

      // The raw JSON must not appear verbatim anywhere outside the (hidden) raw toggle <pre>.
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).not.toContain('"rhetoricalDevices"');
    });

    it('renders the literary view with dir=rtl for a Hebrew historical result', () => {
      loadResult(makeLiteraryResult(LITERARY_JSON, { language: 'he' }));

      const view = fixture.debugElement.query(By.css('[data-testid="literary-view"]'));
      expect(view).not.toBeNull();
      expect(view.nativeElement.getAttribute('dir')).toBe('rtl');
    });

    it('renders the literary view with dir=ltr for an English historical result', () => {
      loadResult(makeLiteraryResult(LITERARY_JSON, { language: 'en' }));

      const view = fixture.debugElement.query(By.css('[data-testid="literary-view"]'));
      expect(view).not.toBeNull();
      expect(view.nativeElement.getAttribute('dir')).toBe('ltr');
    });

    it('falls back gracefully (parse-error note, no throw, no generic raw block) for malformed Literary resultText', () => {
      expect(() => loadResult(makeLiteraryResult('{ not valid json'))).not.toThrow();

      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).not.toBeNull();
      // Still must not fall through to the generic raw block.
      expect(fixture.debugElement.query(By.css('.analysis-single'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.analysis-list'))).toBeNull();
    });

    it('does NOT render app-literary-result content for a non-LiteraryAnalysis result', () => {
      // app-literary-result is always in the DOM (host element), but its view section must be absent.
      loadResult(makeLinguisticResult({ deviations: [], consistencyIssues: [] }));

      expect(fixture.debugElement.query(By.css('[data-testid="literary-view"]'))).toBeNull();
    });
  });

  // =========================================================================
  // 8. Free-text (Custom / Summarize) history result rendered as Markdown.
  //    The literal **/* markers must not survive on screen, and the structured
  //    branches (Linguistic / Literary) must remain excluded.
  // =========================================================================

  describe('free-text (Custom) Markdown result in history', () => {
    function makeCustomResult(resultText: string, overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
      return {
        id: 'r-custom',
        chapterId: 'chap-1',
        jobId: null,
        type: 'Custom',
        analysisType: 'Custom',
        resultText,
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
        ...overrides,
      };
    }

    it('renders a past Custom result via app-markdown-text with no literal ** in the host text', () => {
      loadResult(makeCustomResult('**1. הדילמה:**\n* קושי ראשון\n* קושי שני'));

      const md = fixture.debugElement.query(By.css('[data-testid="history-markdown-result"]'));
      expect(md).not.toBeNull();
      expect(md.nativeElement.querySelector('strong')).not.toBeNull();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).not.toContain('**');
      // Not routed through the old plain-text fallback.
      expect(fixture.debugElement.query(By.css('.analysis-list'))).toBeNull();
      expect(host.querySelector('p.analysis-single')).toBeNull();
    });

    it('does NOT route a LinguisticAnalysis history result through the markdown component', () => {
      loadResult(makeLinguisticResult({ deviations: [], consistencyIssues: [] }));
      expect(fixture.debugElement.query(By.css('[data-testid="history-markdown-result"]'))).toBeNull();
    });

    it('does NOT route a LiteraryAnalysis history result through the markdown component', () => {
      loadResult(makeLiteraryResult());
      expect(fixture.debugElement.query(By.css('[data-testid="history-markdown-result"]'))).toBeNull();
    });
  });
});
