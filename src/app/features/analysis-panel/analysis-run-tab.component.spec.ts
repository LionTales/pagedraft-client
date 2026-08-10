import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER } from 'rxjs';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { AiTierService } from '../../core/services/ai-tier.service';
import { ANALYSIS_TYPE_LABELS, AnalysisResultDto, AnalysisSuggestion } from '../../core/models/analysis';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';

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

function makeBaselineStatus(
  overrides: Partial<BookStyleBaselineStatusDto> = {}
): BookStyleBaselineStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    totalChapters: 5,
    builtChapters: 5,
    staleCount: 0,
    hasBaseline: true,
    ready: true,
    lastUpdatedAt: new Date().toISOString(),
    builtWithDifferentModel: false,
    activeBuildJobId: null,
    chaptersToBuild: 0,
    estimatedSeconds: 0,
    estimatedUsd: null,
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
      providers: [
        // Linguistic results never parse as Line Edit; stub keeps the test isolated.
        { provide: LineEditParserService, useValue: { getLineEdit: () => null } },
        // tier-ux-rework c3: the run tab now hosts the per-edit-type tier toggle, which injects AiTierService
        // (-> HttpClient). Without this stub every test in this suite fails with a NullInjector error naming
        // HttpClient rather than the child that introduced it.
        {
          provide: AiTierService,
          useValue: {
            // `watch` is the shared per-book answer channel (tier-ux-rework fixes c02): the toggle subscribes
            // to it on every mount, so a stub without it fails this suite with a TypeError from a child.
            watch: () => NEVER,
            refresh: () => NEVER,
            get: () => NEVER,
            setTask: () => NEVER,
            setBookDefault: () => NEVER,
            clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisRunTabComponent);
    component = fixture.componentInstance;
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // =========================================================================
  // tier-ux-rework c3: the per-edit-type tier toggle lives on the run surface
  // =========================================================================

  describe('per-edit-type tier toggle', () => {
    it('mounts one toggle bound to the book and to the CURRENTLY selected analysis type', () => {
      component.bookId = 'book-1';
      component.bookLanguage = 'he';
      component.selectedAnalysisType = 'Proofread';
      fixture.detectChanges();

      const toggles = fixture.debugElement.queryAll(By.css('app-tier-toggle'));
      expect(toggles.length).toBe(1);
      expect(toggles[0].componentInstance.bookId).toBe('book-1');
      expect(toggles[0].componentInstance.bookLanguage).toBe('he');
      expect(toggles[0].componentInstance.task).toBe('Proofread');
      expect(toggles[0].componentInstance.scope).toBe('task');
    });

    /**
     * The toggle must FOLLOW the picker: a run tab still showing the Proofread tier while the user has
     * selected Line Edit would state the wrong setting for the button they are about to press.
     */
    it('re-binds to the new type when the picker changes', () => {
      component.bookId = 'book-1';
      component.selectedAnalysisType = 'Proofread';
      fixture.detectChanges();

      component.selectedAnalysisType = 'LineEdit';
      fixture.detectChanges();

      expect(query('app-tier-toggle').componentInstance.task).toBe('LineEdit');
    });

    /**
     * tier-ux-rework fixes c04. This tab RENDERS the style-baseline status row (with its cross-model
     * staleness warning) but the analysis panel above OWNS the fetch and its supersession guard, so the tab's
     * only job on a tier change is to pass the event up. A tab that swallowed it would leave the warning
     * rendered right below the toggle stale until a manual page reload.
     */
    it('passes the toggle\'s tierChanged up to the panel that owns the baseline fetch', () => {
      component.bookId = 'book-1';
      component.selectedAnalysisType = 'LinguisticAnalysis';
      fixture.detectChanges();

      let bubbled = 0;
      component.tierChanged.subscribe(() => bubbled++);

      query('app-tier-toggle').componentInstance.tierChanged.emit();

      expect(bubbled).withContext('one toggle event, one tab event').toBe(1);
    });
  });

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
  // Regression: a completed LiteraryAnalysis routes to app-literary-result and
  // NEVER dumps the raw resultText JSON through the generic runDisplayText block.
  // =========================================================================

  describe('completed LiteraryAnalysis run', () => {
    const literaryJson = JSON.stringify({
      themes: [{ name: 'Isolation', description: 'Loneliness.', significance: 'major' }],
      tone: 'Melancholic',
      toneDescription: 'Wistful throughout.',
      narrativeVoice: 'First person',
      narrativeVoiceDescription: 'Confessional narrator.',
      rhetoricalDevices: [{ name: 'Metaphor', example: 'The city was a beast.', effect: 'Menace.' }],
      moodProgression: 'Somber to hopeful.',
      summary: 'A reflective chapter on solitude.',
    });

    function makeLiteraryResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
      return {
        id: 'r-lit',
        chapterId: 'chap-1',
        jobId: null,
        type: 'LiteraryAnalysis',
        analysisType: 'LiteraryAnalysis',
        resultText: literaryJson,
        createdAt: new Date().toISOString(),
        scope: 'Chapter',
        structuredResult: null,
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

    it('renders the dedicated app-literary-result view with parsed sections', () => {
      component.latestResult = makeLiteraryResult();
      component.selectedAnalysisType = 'LiteraryAnalysis';
      component.streamingText = '';
      fixture.detectChanges();

      expect(query('app-literary-result')).not.toBeNull();
      expect(query('[data-testid="literary-view"]')).not.toBeNull();
      expect(query('[data-testid="literary-summary"]')).not.toBeNull();
      expect(query('[data-testid="theme-row"]')).not.toBeNull();
    });

    it('does NOT dump the raw resultText JSON through the generic block', () => {
      component.latestResult = makeLiteraryResult();
      component.selectedAnalysisType = 'LiteraryAnalysis';
      component.streamingText = '';
      fixture.detectChanges();

      // The generic single/list block must not render the raw JSON for a Literary result.
      const single = query('.analysis-single');
      const list = query('.analysis-list');
      expect(single).toBeNull();
      expect(list).toBeNull();

      // Belt-and-braces: no element renders the literal raw JSON brace soup as its text.
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.analysis-single')).toBeNull();
      // The raw JSON string must not appear verbatim anywhere outside the (hidden) raw toggle <pre>.
      expect(host.textContent).not.toContain('"rhetoricalDevices"');
    });

    it('does NOT show the "no analysis run yet" message for a completed Literary run', () => {
      component.latestResult = makeLiteraryResult();
      component.selectedAnalysisType = 'LiteraryAnalysis';
      component.streamingText = '';
      fixture.detectChanges();

      expect(query('[data-testid="no-run-yet"]')).toBeNull();
    });

    it('falls back gracefully (parse-error note, no throw) for malformed Literary resultText', () => {
      component.latestResult = makeLiteraryResult({ resultText: '{ not valid json' });
      component.selectedAnalysisType = 'LiteraryAnalysis';
      component.streamingText = '';
      expect(() => fixture.detectChanges()).not.toThrow();

      expect(query('[data-testid="literary-parse-error"]')).not.toBeNull();
      // Still must not fall through to the generic raw block.
      expect(query('.analysis-single')).toBeNull();
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

    function setupNoRun(): void {
      component.latestResult = null;
      component.streamingText = '';
      component.proofreadSuggestions = [];
      component.lineEditRunSuggestions = [];
    }

    it('localizes the chapter empty-state in Hebrew by default (no bookLanguage)', () => {
      setupNoRun();
      component.sceneId = null;
      fixture.detectChanges();

      const el = query('[data-testid="no-run-yet"]');
      expect(el).not.toBeNull();
      expect(el.nativeElement.textContent.trim()).toBe('עדיין לא בוצע ניתוח עבור פרק זה.');
      expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    });

    it('localizes the scene empty-state in English when bookLanguage is en', () => {
      setupNoRun();
      component.bookLanguage = 'en';
      component.sceneId = 'scene-1';
      fixture.detectChanges();

      const el = query('[data-testid="no-run-yet"]');
      expect(el).not.toBeNull();
      expect(el.nativeElement.textContent.trim()).toBe('No analysis run yet for this scene.');
      expect(el.nativeElement.getAttribute('dir')).toBe('ltr');
    });

    it('shows the linguistic clarifying note for LinguisticAnalysis (he)', () => {
      setupNoRun();
      component.selectedAnalysisType = 'LinguisticAnalysis';
      fixture.detectChanges();

      const note = query('[data-testid="no-run-yet-linguistic-note"]');
      expect(note).not.toBeNull();
      // w5: the artifact's user-facing name changed with its move ("style baseline" was engineering
      // vocabulary), and the note now also says WHERE it is built, since it is no longer built here.
      expect(note.nativeElement.textContent).toContain('סגנון הכתיבה של הספר');
      expect(note.nativeElement.textContent).toContain('בלוח הספר');
      expect(note.nativeElement.getAttribute('dir')).toBe('rtl');
    });

    it('shows the linguistic clarifying note for LinguisticAnalysis (en)', () => {
      setupNoRun();
      component.bookLanguage = 'en';
      component.selectedAnalysisType = 'LinguisticAnalysis';
      fixture.detectChanges();

      const note = query('[data-testid="no-run-yet-linguistic-note"]');
      expect(note).not.toBeNull();
      expect(note.nativeElement.textContent).toContain("Your book's writing style");
      expect(note.nativeElement.textContent).toContain('built on the book dashboard');
    });

    it('does NOT show the linguistic clarifying note for a non-linguistic type (Proofread)', () => {
      setupNoRun();
      component.selectedAnalysisType = 'Proofread';
      fixture.detectChanges();

      // The base empty-state still renders, but the linguistic note must not.
      expect(query('[data-testid="no-run-yet"]')).not.toBeNull();
      expect(query('[data-testid="no-run-yet-linguistic-note"]')).toBeNull();
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
  // Free-text (Custom / Summarize) result: rendered as Markdown, NOT plain text.
  // The literal ** / * markers must not survive on screen, and the structured
  // branches (Linguistic / Literary / Proofread) must be unaffected.
  // =========================================================================

  describe('free-text (Custom) Markdown result', () => {
    function makeCustomResult(resultText: string, overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
      return {
        id: 'r-custom',
        chapterId: 'chap-1',
        jobId: null,
        type: 'Custom',
        analysisType: 'Custom',
        resultText,
        createdAt: new Date().toISOString(),
        scope: 'Chapter',
        structuredResult: null,
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

    it('renders the completed Custom result via app-markdown-text with no literal ** in the host text', () => {
      // The exact failing shape from the bug report: a bold numbered heading + a bullet.
      component.latestResult = makeCustomResult('**1. הדילמה:**\n* קושי ראשון\n* קושי שני');
      component.selectedAnalysisType = 'Custom';
      component.streamingText = '';
      fixture.detectChanges();

      const md = query('[data-testid="run-markdown-result"]');
      expect(md).not.toBeNull();
      // Markdown was applied: a <strong> exists and the literal asterisks are gone.
      expect(md.nativeElement.querySelector('strong')).not.toBeNull();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).not.toContain('**');
      // It is NOT routed through the old plain-text fallback.
      expect(query('.analysis-list')).toBeNull();
      // The legacy plain <p.analysis-single> is replaced by the markdown component.
      expect(host.querySelector('p.analysis-single')).toBeNull();
    });

    it('renders the streaming partial as plain pre-wrapped text (NOT markdown) while streaming', () => {
      component.latestResult = null;
      component.streamingText = '**partial** tokens';
      component.selectedAnalysisType = 'Custom';
      fixture.detectChanges();

      // Streaming text is plain (asterisks still present mid-stream); markdown component is not used.
      expect(query('[data-testid="run-markdown-result"]')).toBeNull();
      const streaming = query('.analysis-streaming');
      expect(streaming).not.toBeNull();
      expect(streaming.nativeElement.textContent).toContain('**partial**');
    });

    it('does NOT route a LinguisticAnalysis result through the markdown component', () => {
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }], consistencyIssues: [] })
      );
      component.selectedAnalysisType = 'LinguisticAnalysis';
      component.streamingText = '';
      fixture.detectChanges();

      expect(query('[data-testid="run-markdown-result"]')).toBeNull();
      expect(query('[data-testid="linguistic-view"]')).not.toBeNull();
    });

    it('does NOT route a Proofread-with-suggestions result through the markdown component', () => {
      component.latestResult = makeProofreadResult({ proofreadResultUnreliable: false });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [{
      id: 'p-1', original: 'teh', suggested: 'the', category: 'spelling', startOffset: 0, endOffset: 3,
      }];
      component.streamingText = '';
      fixture.detectChanges();

      expect(query('[data-testid="run-markdown-result"]')).toBeNull();
      expect(query('.suggestions-block')).not.toBeNull();
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
  // Each shows exactly one message, never a "looks clean" alongside a warning (or vice versa), and never
  // the model that produced the result: these headers used to print it, which is what put
  // "(Ollama:gemma4:12b)" on a user's screen.
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
    it('UNRELIABLE + has suggestions: warning renders, cards do NOT, NO model name in header', () => {
      component.bookLanguage = 'en';
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: true,
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

      // The result header names the analysis type only. Model identity is internal IP (see the IP pin below).
      const header = warning.nativeElement.closest('article').querySelector('h4');
      expect(header.textContent).toContain('Proofread');
      expect(header.textContent).not.toContain('Ollama:dicta');
      expect(header.textContent).not.toContain('(');
    });

    // ---- State 1b: UNRELIABLE + no suggestions ---------------------------
    it('UNRELIABLE + no suggestions: warning renders, "looks clean" does NOT, NO model name in header', () => {
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: true,
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
      expect(header.textContent).not.toContain('Ollama:dicta');
      expect(header.textContent).not.toContain('(');
    });

    // ---- State 2: RELIABLE + has suggestions (PROBLEM 1 regression) -------
    it('RELIABLE + has suggestions: cards render, warning does NOT, NO model name in header', () => {
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: false,
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

      // The suggestions header names the analysis type only, never the model that produced it.
      // bookLanguage not set -> chromeLang defaults to 'he', so type label is localized.
      const header = block.nativeElement.querySelector('h4');
      expect(header.textContent).toContain('הגהה'); // Hebrew localized label for 'Proofread'
      expect(header.textContent).not.toContain('Ollama:dicta');
      expect(header.textContent).not.toContain('(');
    });

    // ---- c05: an English book renders the ENGLISH analysis-type label in the
    //          rendered header, NOT the Hebrew label. This is the end-to-end
    //          guard that the host-threaded bookLanguage='en' reaches the header
    //          (analysisTypeLabel -> chromeLang). The State 2 test above proves
    //          the same header defaults to Hebrew ('הגהה') when bookLanguage is
    //          absent, so together they pin both branches of the language switch.
    it('c05: RELIABLE proofread header shows the ENGLISH type label (not Hebrew) for an English book', () => {
      component.bookLanguage = 'en';
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: false,
              });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [oneSuggestion];
      component.streamingText = '';
      fixture.detectChanges();

      const header = query('.suggestions-block').nativeElement.querySelector('h4');
      // English label from the shared map, and the Hebrew label must be gone.
      expect(header.textContent).toContain(ANALYSIS_TYPE_LABELS['en']['Proofread']); // 'Proofread'
      expect(header.textContent).not.toContain(ANALYSIS_TYPE_LABELS['he']['Proofread']); // 'הגהה'
    });

    it('c05: LineEdit run header shows the ENGLISH type label ("Line Edit") for an English book', () => {
      component.bookLanguage = 'en';
      component.latestResult = makeProofreadResult({
        // Reuse the proofread factory but flip the type to LineEdit; a single suggestion routes it
        // through the LineEdit run branch whose header also reads analysisTypeLabel(...).
        type: 'LineEdit',
        analysisType: 'LineEdit',
              });
      component.selectedAnalysisType = 'LineEdit';
      component.lineEditRunSuggestions = [{
      id: 'le-1', original: 'he walked', suggested: 'he strode', category: 'style', startOffset: 0, endOffset: 9,
      }];
      component.streamingText = '';
      fixture.detectChanges();

      const header = query('.result-view h4');
      expect(header).not.toBeNull();
      expect(header.nativeElement.textContent).toContain(ANALYSIS_TYPE_LABELS['en']['LineEdit']); // 'Line Edit'
      expect(header.nativeElement.textContent).not.toContain(ANALYSIS_TYPE_LABELS['he']['LineEdit']); // 'עריכת שורה'
    });

    // ---- State 3: RELIABLE + no suggestions ------------------------------
    it('RELIABLE + no suggestions: "looks clean" renders, warning does NOT, NO model name in header', () => {
      component.bookLanguage = 'en';
      component.latestResult = makeProofreadResult({
        proofreadResultUnreliable: false,
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
      expect(header.textContent).not.toContain('Ollama:dicta');
      expect(header.textContent).not.toContain('(');
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
      component.bookLanguage = 'en';
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

  // =========================================================================
  // The book-wide writing style, as this per-chapter surface may still speak about it
  // =========================================================================

  // Wave 3 / w5 (MOVE-1 + MOVE-2 + the D13 retarget). `describe('style baseline status row')` LIVED HERE
  // and covered a row that no longer exists on this per-chapter surface: the status row, its build and
  // refresh actions, its consent gate, its estimate, its paid-tier note and its cross-model warning all
  // moved to the book dashboard, and that coverage moved WITH them (see
  // `book-style-baseline-status-row.component.spec.ts`). What remains here is the cross-scope POINTER the
  // audit deliberately keeps, and the guarantee that nothing on a chapter surface can start a book build.
  describe('w5: the writing-style build is gone from the Run tab; the deviations pointer is retargeted', () => {
    beforeEach(() => {
      component.selectedAnalysisType = 'LinguisticAnalysis';
    });

    it('renders NO writing-style status row, and no build or consent affordance, on any pass', () => {
      component.styleBaselineStatus = makeBaselineStatus({ hasBaseline: false, ready: false, builtChapters: 0 });
      fixture.detectChanges();

      expect(query('[data-testid="style-baseline-row"]')).toBeNull();
      expect(query('[data-testid="sb-build-now"]')).toBeNull();
      expect(query('[data-testid="sb-refresh"]')).toBeNull();
      expect(query('[data-testid="sb-consent"]')).toBeNull();
      expect(query('[data-testid="sb-consent-estimate"]')).toBeNull();
      expect(query('[data-testid="sb-consent-paid-note"]')).toBeNull();
      expect(query('[data-testid="sb-cross-model-warning"]')).toBeNull();
    });

    it('deviations empty-state hint still shows when the writing style is missing/insufficient', () => {
      component.styleBaselineStatus = makeBaselineStatus({
        hasBaseline: false, ready: false, builtChapters: 0,
      });
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [], consistencyIssues: [] })
      );
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.baselineMissingOrInsufficient).toBeTrue();
      expect(query('[data-testid="sb-deviations-hint"]')).not.toBeNull();
    });

    it('deviations empty-state hint is absent when the writing style is ready', () => {
      component.styleBaselineStatus = makeBaselineStatus();
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [], consistencyIssues: [] })
      );
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.baselineMissingOrInsufficient).toBeFalse();
      expect(query('[data-testid="sb-deviations-hint"]')).toBeNull();
    });

    it('RETARGET: the hint action raises openStyleBaselineHome instead of opening a whole-book consent', () => {
      let raised = 0;
      component.openStyleBaselineHome.subscribe(() => raised++);
      component.styleBaselineStatus = makeBaselineStatus({
        hasBaseline: false, ready: false, builtChapters: 0,
      });
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [], consistencyIssues: [] })
      );
      component.streamingText = '';
      fixture.detectChanges();

      const action = query('[data-testid="sb-deviations-hint-action"]');
      expect(action).not.toBeNull();
      action.nativeElement.click();

      expect(raised).toBe(1);
      // And it opened nothing here: the destination is the dashboard, not this panel.
      fixture.detectChanges();
      expect(query('[data-testid="sb-consent"]')).toBeNull();
    });

    it('the stale reading points at the same home, with stale-flavoured copy (he and en)', () => {
      const stale = { hasBaseline: true, ready: false, staleCount: 3, builtChapters: 5 };
      component.styleBaselineStatus = makeBaselineStatus(stale);
      component.latestResult = makeLinguisticResult(
        JSON.stringify({ deviations: [], consistencyIssues: [] })
      );
      component.streamingText = '';
      fixture.detectChanges();

      expect(component.baselineState).toBe('stale');
      const heHint = query('[data-testid="sb-deviations-hint"]').nativeElement.textContent as string;
      expect(heHint).toContain('אינו עדכני');
      expect(heHint).toContain(component.baselineLabel('hintGoToHome'));

      component.bookLanguage = 'en';
      fixture.detectChanges();
      const enHint = query('[data-testid="sb-deviations-hint"]').nativeElement.textContent as string;
      expect(enHint).toContain('out of date');
      expect(enHint).toContain('Open the book dashboard');
    });

    it('the pointer copy carries no em-dash and no model identity, in either language', () => {
      const keys = ['hintBuild', 'hintRefresh', 'hintGoToHome', 'linguisticNoRunNote'];
      for (const lang of ['he', 'en']) {
        component.bookLanguage = lang;
        for (const key of keys) {
          const text = component.baselineLabel(key);
          expect(text).not.toContain('\u2014');
          expect(text).not.toContain('\u2013');
          expect(text.toLowerCase()).not.toContain('gpt');
          expect(text.toLowerCase()).not.toContain('gemma');
          expect(text.toLowerCase()).not.toContain('ollama');
        }
      }
    });
  });

  // =========================================================================
  // f01 he/en parity: proofread + line-edit cards receive [lang] from chromeLang
  // =========================================================================

  describe('f01: proofread suggestion-card renders Hebrew labels for a Hebrew book', () => {
    const proofreadSuggestion: AnalysisSuggestion = {
      id: 'pf-1',
      original: 'הוא הלך',
      suggested: 'הוא צעד',
      category: 'style',
      startOffset: 0,
      endOffset: 7,
      reason: 'מילה חלשה',
    };

    function setupHebrewProofreadRun(): void {
      component.bookLanguage = 'he';
      component.latestResult = makeProofreadResult({ proofreadResultUnreliable: false });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [proofreadSuggestion];
      component.streamingText = '';
      fixture.detectChanges();
    }

    it('chromeLang returns "he" when bookLanguage is "he"', () => {
      component.bookLanguage = 'he';
      expect(component.chromeLang).toBe('he');
    });

    it('chromeLang returns "he" when bookLanguage is null (default)', () => {
      component.bookLanguage = null;
      expect(component.chromeLang).toBe('he');
    });

    it('proofread card on a Hebrew book renders Hebrew rationale label (נימוק) when opened', () => {
      setupHebrewProofreadRun();

      // Open the rationale section on the card.
      const rationaleToggle = fixture.debugElement.query(
        By.css('.suggestions-block .rationale-toggle')
      );
      expect(rationaleToggle).not.toBeNull();
      // The toggle label itself should be in Hebrew.
      expect(rationaleToggle.nativeElement.textContent).toContain('נימוק');
    });

    it('proofread card on an English book renders English rationale label (Rationale)', () => {
      component.bookLanguage = 'en';
      component.latestResult = makeProofreadResult({ proofreadResultUnreliable: false });
      component.selectedAnalysisType = 'Proofread';
      component.proofreadSuggestions = [proofreadSuggestion];
      component.streamingText = '';
      fixture.detectChanges();

      const rationaleToggle = fixture.debugElement.query(
        By.css('.suggestions-block .rationale-toggle')
      );
      expect(rationaleToggle).not.toBeNull();
      expect(rationaleToggle.nativeElement.textContent).toContain('Rationale');
    });
  });

  // =========================================================================
  // f01 label parity: Run-tab must produce the SAME Hebrew label as the shared
  // ANALYSIS_TYPE_LABELS map for every analysis type. Regression guard against
  // a drifted local copy returning 'ניתוח לשוני' / 'ניתוח ספרותי' instead of
  // the canonical short forms 'לשוני' / 'ספרותי'.
  // =========================================================================

  describe('f01 label parity: analysisTypeLabel matches ANALYSIS_TYPE_LABELS for he and en', () => {
    beforeEach(() => {
      // No result needed; we only exercise the pure helper method.
      component.latestResult = null;
      component.streamingText = '';
      component.proofreadSuggestions = [];
    });

    it('LinguisticAnalysis he label matches the shared map (not the drifted long form)', () => {
      component.bookLanguage = 'he';
      expect(component.analysisTypeLabel('LinguisticAnalysis'))
        .toBe(ANALYSIS_TYPE_LABELS['he']['LinguisticAnalysis']);
    });

    it('LiteraryAnalysis he label matches the shared map (not the drifted long form)', () => {
      component.bookLanguage = 'he';
      expect(component.analysisTypeLabel('LiteraryAnalysis'))
        .toBe(ANALYSIS_TYPE_LABELS['he']['LiteraryAnalysis']);
    });

    it('LinguisticAnalysis en label matches the shared map', () => {
      component.bookLanguage = 'en';
      expect(component.analysisTypeLabel('LinguisticAnalysis'))
        .toBe(ANALYSIS_TYPE_LABELS['en']['LinguisticAnalysis']);
    });

    it('LiteraryAnalysis en label matches the shared map', () => {
      component.bookLanguage = 'en';
      expect(component.analysisTypeLabel('LiteraryAnalysis'))
        .toBe(ANALYSIS_TYPE_LABELS['en']['LiteraryAnalysis']);
    });

    it('unknown type falls back to the raw value', () => {
      component.bookLanguage = 'he';
      expect(component.analysisTypeLabel('UnknownType')).toBe('UnknownType');
    });
  });

  /**
   * IP PIN. The result heading used to render the model beside the analysis name, so a finished run showed
   * e.g. "ספרותי (Ollama:gemma4:12b)". Which model ran is internal IP: the server no longer sends
   * `modelName` at all, and no heading may reintroduce it from any other source. This replaces the old
   * `visibleModelName` suite, whose whole job was hiding ONE sentinel ("chunked") while letting every real
   * model name through - the wrong shape of guard for the decision that has since been taken.
   */
  describe('result headings never expose model identity', () => {
    const MODEL_STRINGS = [
      'Ollama:gemma4:12b',
      'gemma4:12b',
      'OpenRouter:google/gemma-4-31b-it',
      'chunked',
      'stream',
    ];

    MODEL_STRINGS.forEach(model => {
      it(`renders no model parenthetical when a result carries "${model}"`, () => {
        component.bookLanguage = 'he';
        component.selectedAnalysisType = 'Proofread';
        // Cast through any: `modelName` is deliberately gone from AnalysisResultDto. Setting it anyway is
        // the point - even if a stale server or a cached payload still carried it, nothing may render it.
        component.latestResult = {
          analysisType: 'Proofread',
          type: 'Proofread',
          modelName: model,
          language: 'he',
          proofreadResultUnreliable: false,
        } as any;
        component.proofreadSuggestions = [
          { id: 's1', originalText: 'a', suggestedText: 'b', startOffset: 0, endOffset: 1 } as any,
        ];
        fixture.detectChanges();

        const heading = fixture.nativeElement.querySelector('.suggestions-block h4') as HTMLElement;
        expect(heading).not.toBeNull();
        // Non-vacuous: the heading still names the analysis type.
        expect(heading.textContent).toContain('הגהה');
        expect(heading.textContent).not.toContain(model);
        expect(heading.textContent).not.toContain('(');
      });
    });

    it('exposes no visibleModelName helper (the parenthetical has no source left)', () => {
      expect((component as any).visibleModelName).toBeUndefined();
    });
  });
});
