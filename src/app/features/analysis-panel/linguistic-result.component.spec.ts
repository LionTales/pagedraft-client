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

    it('recomputes emptyStructured when consistency suggestions arrive on the SAME result object', () => {
      // Initially no consistency suggestions: empty parsed JSON + long raw text => empty note shows.
      const result = makeLinguisticResult('{}', { resultText: RAW_TEXT, suggestions: [] });
      setResult(result);
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-empty-note"]'))).not.toBeNull();
      expect(component.view!.emptyStructured).toBeTrue();

      // The persisted row's consistency suggestions arrive on the SAME object - id, language,
      // structuredResult and resultText are all unchanged. The cached view must still recompute, or
      // the stale "no structured content" note lingers while consistency cards render elsewhere.
      result.suggestions = [{ category: 'consistency-pov' } as any];
      fixture.detectChanges();

      expect(component.view!.emptyStructured).toBeFalse();
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-empty-note"]'))).toBeNull();
    });
  });

  // =========================================================================
  // 3b. "no consistency issues found" empty-state
  // =========================================================================

  describe('no-consistency-issues empty-state', () => {
    const structured = JSON.stringify({ deviations: [], consistencyIssues: [] });

    it('renders [data-testid="consistency-empty"] for a parsed linguistic result with zero consistency suggestions', () => {
      setResult(makeLinguisticResult(structured, { suggestions: [] }));

      const empty = fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'));
      expect(empty).not.toBeNull();
      expect(component.view!.noConsistencyIssues).toBeTrue();
    });

    it('resolves the Hebrew label by default (no language)', () => {
      setResult(makeLinguisticResult(structured, { language: '', suggestions: [] }));

      const empty = fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'));
      expect(empty).not.toBeNull();
      expect((empty.nativeElement as HTMLElement).textContent?.trim()).toBe('לא נמצאו בעיות עקביות.');
    });

    it('resolves the English label when the result language is English', () => {
      setResult(makeLinguisticResult(structured, { language: 'en', suggestions: [] }));

      const empty = fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'));
      expect(empty).not.toBeNull();
      expect((empty.nativeElement as HTMLElement).textContent?.trim()).toBe('No consistency issues found.');
    });

    it('still renders the empty-state when the result has deviations but zero consistency suggestions', () => {
      const withDeviation = JSON.stringify({
        deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }],
      });
      setResult(makeLinguisticResult(withDeviation, { suggestions: [] }));

      expect(fixture.debugElement.query(By.css('[data-testid="deviation-row"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).not.toBeNull();
    });

    it('does NOT render the empty-state when the result has at least one consistency suggestion', () => {
      setResult(makeLinguisticResult(structured, {
        suggestions: [{ category: 'consistency-pov' } as any],
      }));

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).toBeNull();
      expect(component.view!.noConsistencyIssues).toBeFalse();
    });

    it('does NOT render the empty-state on parse failure', () => {
      setResult(makeLinguisticResult('{not valid json', { suggestions: [] }));

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).toBeNull();
      expect(component.view!.noConsistencyIssues).toBeFalse();
    });

    it('does NOT render the empty-state for a non-LinguisticAnalysis (Proofread) result', () => {
      const proofread: AnalysisResultDto = {
        id: 'r-pr3',
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

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).toBeNull();
      expect(component.view).toBeNull();
    });

    it('clears the empty-state once consistency suggestions arrive on the SAME result object', () => {
      const result = makeLinguisticResult(structured, { suggestions: [] });
      setResult(result);
      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).not.toBeNull();

      // Suggestions arrive on the same object (id/language/structuredResult/resultText unchanged):
      // the consistency-count cache key must force a recompute so the empty-state disappears.
      result.suggestions = [{ category: 'consistency-pov' } as any];
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).toBeNull();
      expect(component.view!.noConsistencyIssues).toBeFalse();
    });
  });

  // =========================================================================
  // 3c. "consistency issues detected but not locatable" empty-state
  // =========================================================================

  describe('consistency-undetectable empty-state', () => {
    // structuredResult carries a non-empty consistencyIssues array, but suggestions (anchored cards)
    // are empty - anchoring dropped everything.
    const structuredWithIssues = JSON.stringify({
      deviations: [],
      consistencyIssues: [{ type: 'pov', span: 'x', description: 'y' }],
    });

    it('renders [data-testid="consistency-undetectable"] when structuredResult has consistencyIssues but suggestions is empty', () => {
      setResult(makeLinguisticResult(structuredWithIssues, { suggestions: [] }));

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-undetectable"]'))).not.toBeNull();
      expect(component.view!.consistencyUndetectable).toBeTrue();
    });

    it('does NOT render [data-testid="consistency-empty"] in the undetectable branch', () => {
      setResult(makeLinguisticResult(structuredWithIssues, { suggestions: [] }));

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-empty"]'))).toBeNull();
      expect(component.view!.noConsistencyIssues).toBeFalse();
    });

    it('resolves the Hebrew label (he default) for the undetectable branch', () => {
      setResult(makeLinguisticResult(structuredWithIssues, { language: '', suggestions: [] }));

      const el = fixture.debugElement.query(By.css('[data-testid="consistency-undetectable"]'));
      expect(el).not.toBeNull();
      expect((el.nativeElement as HTMLElement).textContent?.trim())
        .toBe('בעיות עקביות זוהו אך לא ניתן היה לאתר אותן בטקסט.');
    });

    it('resolves the English label for the undetectable branch when language is English', () => {
      setResult(makeLinguisticResult(structuredWithIssues, { language: 'en', suggestions: [] }));

      const el = fixture.debugElement.query(By.css('[data-testid="consistency-undetectable"]'));
      expect(el).not.toBeNull();
      expect((el.nativeElement as HTMLElement).textContent?.trim())
        .toBe('Consistency issues were detected but could not be located in the text.');
    });

    it('does NOT render the contradictory linguistic-empty-note even with a long resultText', () => {
      // Regression: the JSON carries consistencyIssues (so consistencyUndetectable is shown) AND the
      // resultText is long enough to satisfy hasRawText. emptyStructured must stay false so the
      // "no structured content" empty-note does not render alongside the undetectable message.
      const RAW_TEXT = 'This is a non-trivial raw response longer than twenty characters.';
      setResult(makeLinguisticResult(structuredWithIssues, { resultText: RAW_TEXT, suggestions: [] }));

      expect(fixture.debugElement.query(By.css('[data-testid="consistency-undetectable"]'))).not.toBeNull();
      expect(component.view!.emptyStructured).toBeFalse();
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-empty-note"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="linguistic-raw-toggle"]'))).toBeNull();
    });
  });

  // =========================================================================
  // 4. deviation comparison phrases - reference depends on scope
  // =========================================================================

  describe('deviation comparison phrases', () => {
    // Helper: extract the .deviation-values text of the first deviation row.
    function getDeviationValuesText(): string | null | undefined {
      const row = fixture.debugElement.query(By.css('[data-testid="deviation-row"]'));
      if (!row) return null;
      const el = row.nativeElement.querySelector('.deviation-values') as HTMLElement | null;
      return el?.textContent;
    }

    // Chapter-scope (no sceneId) -> reference = 'book'
    it('chapter-scope result (no sceneId): shows "notably above the book\'s usual" (en)', () => {
      // rel = |11 - 9| / 9 = 2/9 ~= 0.222 which falls in [0.10, 0.30] => 'notably-higher'
      const structured = JSON.stringify({
        deviations: [
          { metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' },
        ],
      });
      setResult(makeLinguisticResult(structured, { language: 'en', scope: 'Chapter', sceneId: null }));

      expect(getDeviationValuesText()).toContain("notably above the book's usual");
    });

    it('chapter-scope result (no sceneId): shows "גבוה משמעותית מהרגיל בספר" (he)', () => {
      const structured = JSON.stringify({
        deviations: [
          { metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' },
        ],
      });
      setResult(makeLinguisticResult(structured, { language: 'he', scope: 'Chapter', sceneId: null }));

      expect(getDeviationValuesText()).toContain('גבוה משמעותית מהרגיל בספר');
    });

    // Scene-scope (sceneId set) -> reference = 'chapter'
    it('scene-scope result (sceneId set): shows "notably above the chapter\'s usual" (en)', () => {
      const structured = JSON.stringify({
        deviations: [
          { metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' },
        ],
      });
      setResult(makeLinguisticResult(structured, { language: 'en', scope: 'Scene', sceneId: 'scene-1' }));

      expect(getDeviationValuesText()).toContain("notably above the chapter's usual");
    });

    it('scene-scope result (sceneId set): shows "גבוה משמעותית מהרגיל בפרק" (he)', () => {
      const structured = JSON.stringify({
        deviations: [
          { metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' },
        ],
      });
      setResult(makeLinguisticResult(structured, { language: 'he', scope: 'Scene', sceneId: 'scene-1' }));

      expect(getDeviationValuesText()).toContain('גבוה משמעותית מהרגיל בפרק');
    });

    // scope='Scene' without sceneId (edge case) -> should still resolve to 'chapter' reference
    it('scope="Scene" with no sceneId: still uses chapter reference (en)', () => {
      const structured = JSON.stringify({
        deviations: [
          { metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' },
        ],
      });
      setResult(makeLinguisticResult(structured, { language: 'en', scope: 'Scene', sceneId: null }));

      expect(getDeviationValuesText()).toContain("notably above the chapter's usual");
    });
  });

  // =========================================================================
  // 4a. Deviations section title is reference-aware (chapter vs book)
  // =========================================================================

  describe('deviations title is reference-aware', () => {
    const structured = JSON.stringify({ deviations: [], consistencyIssues: [] });

    function getDeviationsTitleText(): string | undefined {
      const block = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      const el = block?.nativeElement.querySelector('.linguistic-block-title') as HTMLElement | null;
      return el?.textContent?.trim();
    }

    // Chapter-scope (no sceneId) -> reference = 'book' -> title reads "...from book".
    it('chapter-scope result (no sceneId): title reads "Style deviations from book" (en)', () => {
      setResult(makeLinguisticResult(structured, { language: 'en', scope: 'Chapter', sceneId: null }));
      expect(getDeviationsTitleText()).toBe('Style deviations from book');
    });

    it('chapter-scope result (no sceneId): title reads "חריגות סגנון מהספר" (he)', () => {
      setResult(makeLinguisticResult(structured, { language: 'he', scope: 'Chapter', sceneId: null }));
      expect(getDeviationsTitleText()).toBe('חריגות סגנון מהספר');
    });

    // Scene-scope (sceneId set) -> reference = 'chapter' -> title reads "...from chapter".
    it('scene-scope result (sceneId set): title reads "Style deviations from chapter" (en)', () => {
      setResult(makeLinguisticResult(structured, { language: 'en', scope: 'Scene', sceneId: 'scene-1' }));
      expect(getDeviationsTitleText()).toBe('Style deviations from chapter');
    });

    it('scene-scope result (sceneId set): title reads "חריגות סגנון מהפרק" (he)', () => {
      setResult(makeLinguisticResult(structured, { language: 'he', scope: 'Scene', sceneId: 'scene-1' }));
      expect(getDeviationsTitleText()).toBe('חריגות סגנון מהפרק');
    });
  });

  // =========================================================================
  // 4b. Scope/sceneId change must bust the cached view (regression)
  // =========================================================================

  describe('scope change busts the cached view (regression)', () => {
    // The cached view is keyed by the inputs buildLinguisticView reads. scope + sceneId pick the
    // deviation reference (chapter vs book), so they MUST be in the key: when the SAME result id and
    // JSON payload are shown again at a different scope, an old key would return the stale view with
    // the wrong "בפרק/בספר" wording and the wrong section title.
    const structured = JSON.stringify({
      deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }],
    });

    function getTitle(): string | undefined {
      const block = fixture.debugElement.query(By.css('[data-testid="linguistic-deviations"]'));
      const el = block?.nativeElement.querySelector('.linguistic-block-title') as HTMLElement | null;
      return el?.textContent?.trim();
    }
    function getRowPhrase(): string | null | undefined {
      const row = fixture.debugElement.query(By.css('[data-testid="deviation-row"]'));
      const el = row?.nativeElement.querySelector('.deviation-values') as HTMLElement | null;
      return el?.textContent;
    }

    it('re-shows the same result id/JSON at scene scope with chapter wording, not the cached book wording (he)', () => {
      // First render: chapter scope (no sceneId) -> reference = book -> "...מהספר" / "...בספר".
      setResult(makeLinguisticResult(structured, { language: 'he', scope: 'Chapter', sceneId: null }));
      expect(getTitle()).toBe('חריגות סגנון מהספר');
      expect(getRowPhrase()).toContain('בספר');

      // Same id + JSON + language (only scope/sceneId differ) -> reference = chapter. A view cache that
      // omitted scope/sceneId would hit and keep the stale "מהספר/בספר" wording here.
      setResult(makeLinguisticResult(structured, { language: 'he', scope: 'Scene', sceneId: 'scene-1' }));
      expect(getTitle()).toBe('חריגות סגנון מהפרק');
      expect(getRowPhrase()).toContain('בפרק');
    });

    it('recomputes the title from book to chapter when scope/sceneId change on the SAME result object (en)', () => {
      // Mirrors the consistency-count recompute: scope/sceneId can be populated on the same object
      // after the initial render (e.g. a run DTO that lacked scope is later refreshed with it).
      const result = makeLinguisticResult(structured, { language: 'en', scope: 'Chapter', sceneId: null });
      setResult(result);
      expect(getTitle()).toBe('Style deviations from book');

      result.scope = 'Scene';
      result.sceneId = 'scene-9';
      fixture.detectChanges();
      expect(getTitle()).toBe('Style deviations from chapter');
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
