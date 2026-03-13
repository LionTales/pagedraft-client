import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY, of } from 'rxjs';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisRunOrchestrationService } from '../../core/services/analysis-run-orchestration.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto } from '../../core/models/analysis';

describe('AnalysisPanelComponent (focused logic)', () => {
  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getTemplates: () => of([]),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => of({ explanation: 'because' }),
            run: () => of({} as AnalysisResultDto),
            startAsync: () => of({ jobId: 'job-1', analysisType: 'Proofread', scope: 'Chapter' }),
            getByJob: () => of({} as AnalysisResultDto),
            runStream: () => of(''),
            createTemplate: () => of(),
          },
        },
        {
          provide: DocumentVersionService,
          useValue: {
            list: () => of([]),
            create: () => of(),
            get: () => of(),
          },
        },
        {
          provide: AnalysisRunOrchestrationService,
          useValue: {
            stopProgressPolling: () => {},
            confirmReanalysisIfPendingSuggestions: () => true,
            emitInitialStatusForRun: () => 'Running…',
            setLastRunDuration: () => null,
            runAnalysisAfterSave: () => EMPTY,
            doRunStreaming: () => EMPTY,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisPanelComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
    fixture.detectChanges();
  });

  function makeResultWithSuggestions(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
    const sug: AnalysisSuggestionDto = {
      id: 's-1',
      analysisResultId: 'r-1',
      originalText: 'world',
      suggestedText: 'friend',
      startOffset: 6,
      endOffset: 11,
      reason: 'Proofread',
      category: null,
      explanation: null,
      outcome: null,
      orderIndex: 0,
    };
    return {
      id: 'r-1',
      chapterId: 'chap-1',
      jobId: null,
      type: 'Proofread',
      resultText: 'Hello friend',
      modelName: 'test-model',
      createdAt: new Date().toISOString(),
      scope: 'Chapter',
      analysisType: 'Proofread',
      structuredResult: null,
      sceneId: null,
      bookId: 'book-1',
      language: 'he',
      status: 'Active',
      proofreadNoChangesHint: false,
      suggestions: [sug],
      ...overrides,
    };
  }

  it('mapDtoSuggestions respects adjustOffsets and heuristic filter', () => {
    const result = makeResultWithSuggestions({
      suggestions: [
        {
          id: 's-1',
          analysisResultId: 'r-1',
          originalText: 'a'.repeat(80),
          suggestedText: 'x',
          startOffset: 0,
          endOffset: 80,
          reason: 'Proofread',
          category: null,
          explanation: null,
          outcome: null,
          orderIndex: 0,
        },
      ],
    });

    (component as any).documentText = 'a'.repeat(80);

    const withoutFilter = (component as any).mapDtoSuggestions(result, true, false) as any[];
    const withFilter = (component as any).mapDtoSuggestions(result, true, true) as any[];

    expect(withoutFilter.length).toBe(1);
    expect(withFilter.length).toBe(0);
  });

  it('rebuildHistoryFromAllAnalyses filters by historyFilterType and sorts by createdAt', () => {
    const newer = makeResultWithSuggestions({ id: 'r-new', createdAt: new Date(Date.now() + 1000).toISOString() });
    const older = makeResultWithSuggestions({ id: 'r-old', createdAt: new Date(Date.now() - 1000).toISOString(), analysisType: 'LineEdit' });

    (component as any).allAnalyses = [older, newer];
    component.historyFilterType = null;

    (component as any).rebuildHistoryFromAllAnalyses();

    expect(component['history'].length).toBe(2);
    expect(component['history'][0].id).toBe('r-new');

    component.historyFilterType = 'LineEdit';
    (component as any).rebuildHistoryFromAllAnalyses();
    expect(component['history'].length).toBe(1);
    expect(component['history'][0].id).toBe('r-old');
  });

  it('applyOutcomeToSuggestionDtos updates in-memory DTO across latestResult and allAnalyses', () => {
    const latestResult = makeResultWithSuggestions();
    const historyResult = makeResultWithSuggestions({ id: 'r-2' });
    component['latestResult'] = latestResult;
    (component as any).allAnalyses = [historyResult];

    (component as any).applyOutcomeToSuggestionDtos('s-1', 'Accepted');

    expect(component['latestResult']!.suggestions![0].outcome).toBe('Accepted');
    expect((component as any).allAnalyses[0].suggestions[0].outcome).toBe('Accepted');
  });

  it('applyExplanationToSuggestionDtos caches explanation on DTO', () => {
    const latestResult = makeResultWithSuggestions();
    const historyResult = makeResultWithSuggestions({ id: 'r-2' });
    component['latestResult'] = latestResult;
    (component as any).allAnalyses = [historyResult];

    (component as any).applyExplanationToSuggestionDtos('s-1', 'because');

    expect(component['latestResult']!.suggestions![0].explanation).toBe('because');
    expect((component as any).allAnalyses[0].suggestions[0].explanation).toBe('because');
  });

  it('loadVersions de-duplicates by suggestionId when present, falling back to text pair', () => {
    const service = TestBed.inject(DocumentVersionService);
    const versions: any[] = [
      {
        id: 'v-new',
        bookId: 'book-1',
        chapterId: 'chap-1',
        createdAt: new Date(Date.now()).toISOString(),
        suggestionId: 's-1',
        originalText: 'world',
        suggestedText: 'friend',
      },
      {
        id: 'v-old',
        bookId: 'book-1',
        chapterId: 'chap-1',
        createdAt: new Date(Date.now() - 1000).toISOString(),
        suggestionId: 's-1',
        originalText: 'world',
        suggestedText: 'friend',
      },
      {
        id: 'v-legacy-new',
        bookId: 'book-1',
        chapterId: 'chap-1',
        createdAt: new Date(Date.now()).toISOString(),
        suggestionId: null,
        originalText: 'legacy',
        suggestedText: 'version',
      },
      {
        id: 'v-legacy-old',
        bookId: 'book-1',
        chapterId: 'chap-1',
        createdAt: new Date(Date.now() - 1000).toISOString(),
        suggestionId: null,
        originalText: 'legacy',
        suggestedText: 'version',
      },
    ];

    spyOn(service, 'list').and.returnValue(of(versions as any));

    component.loadVersions();

    expect(component.versions.length).toBe(2);
    const ids = component.versions.map(v => v.id);
    expect(ids).toContain('v-new');
    expect(ids).toContain('v-legacy-new');
  });

  // ─── getLineEdit fallback chain ───────────────────────────────────

  function makeLineEditResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
    return {
      id: 'r-le',
      chapterId: 'chap-1',
      jobId: null,
      type: 'LineEdit',
      resultText: '',
      modelName: 'test-model',
      createdAt: new Date().toISOString(),
      scope: 'Chapter',
      analysisType: 'LineEdit',
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

  const VALID_STRUCTURED_JSON = JSON.stringify({
    suggestions: [
      { original: 'old text', suggested: 'new text', reason: 'clarity', category: 'clarity' }
    ],
    overallFeedback: 'Good writing overall.'
  });

  it('getLineEdit returns parsed result from structuredResult', () => {
    const result = makeLineEditResult({ structuredResult: VALID_STRUCTURED_JSON });
    const parsed = component.getLineEdit(result);

    expect(parsed).not.toBeNull();
    expect(parsed!.suggestions.length).toBe(1);
    expect(parsed!.suggestions[0].original).toBe('old text');
    expect(parsed!.suggestions[0].suggested).toBe('new text');
    expect(parsed!.suggestions[0].category).toBe('clarity');
    expect(parsed!.overallFeedback).toBe('Good writing overall.');
  });

  it('getLineEdit falls back to resultText when structuredResult is null', () => {
    const result = makeLineEditResult({
      structuredResult: null,
      resultText: VALID_STRUCTURED_JSON,
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).not.toBeNull();
    expect(parsed!.suggestions.length).toBe(1);
    expect(parsed!.suggestions[0].original).toBe('old text');
    expect(parsed!.overallFeedback).toBe('Good writing overall.');
  });

  it('getLineEdit falls back to resultText when structuredResult is empty string', () => {
    const result = makeLineEditResult({
      structuredResult: '',
      resultText: VALID_STRUCTURED_JSON,
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).not.toBeNull();
    expect(parsed!.suggestions.length).toBe(1);
  });

  it('getLineEdit returns null when both structuredResult and resultText are null', () => {
    const result = makeLineEditResult({
      structuredResult: null,
      resultText: '',
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).toBeNull();
  });

  it('getLineEdit returns null when both fields contain malformed JSON', () => {
    const result = makeLineEditResult({
      structuredResult: 'not valid json {{{',
      resultText: 'also not valid json',
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).toBeNull();
  });

  it('getLineEdit returns null for non-LineEdit analysis type', () => {
    const result = makeLineEditResult({
      analysisType: 'Proofread',
      type: 'Proofread',
      structuredResult: VALID_STRUCTURED_JSON,
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).toBeNull();
  });

  it('getLineEdit returns null when suggestions is not an array', () => {
    const result = makeLineEditResult({
      structuredResult: JSON.stringify({ suggestions: 'not-an-array', overallFeedback: 'ok' }),
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).toBeNull();
  });

  it('getLineEdit handles empty suggestions array with overallFeedback', () => {
    const result = makeLineEditResult({
      structuredResult: JSON.stringify({ suggestions: [], overallFeedback: 'Excellent text.' }),
    });
    const parsed = component.getLineEdit(result);

    expect(parsed).not.toBeNull();
    expect(parsed!.suggestions.length).toBe(0);
    expect(parsed!.overallFeedback).toBe('Excellent text.');
  });

  it('emitSuggestionRanges emits LineEdit ranges when latestResult is LineEdit', () => {
    const lineEditResult = makeLineEditResult();
    component.latestResult = lineEditResult;
    component.highlightSuggestionsInDocument = true;

    component['lineEditRunSuggestions'] = [
      {
        id: 'le-1',
        original: 'old',
        suggested: 'new',
        reason: 'clarity',
        category: 'clarity',
        startOffset: 5,
        endOffset: 8,
      } as AnalysisSuggestion,
    ];

    const emitSpy = spyOn(component.suggestionRangesChange, 'emit');

    (component as any).emitSuggestionRanges();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const arg = emitSpy.calls.mostRecent().args[0] as Array<{ suggestionId?: string; startOffset: number; endOffset: number }>;
    expect(arg.length).toBe(1);
    expect(arg[0]).toEqual({ suggestionId: 'le-1', startOffset: 5, endOffset: 8 });
  });

  it('getLineEdit logs diagnostics only once per result id and type', () => {
    const warnSpy = spyOn(console, 'warn');
    const infoSpy = spyOn(console, 'info');

    const malformed = 'not valid json {{{';
    const result = makeLineEditResult({
      structuredResult: malformed,
      resultText: malformed,
    });

    // First call should emit each diagnostic once.
    const first = component.getLineEdit(result);
    expect(first).toBeNull();

    // Second call with the same failing DTO should not emit duplicate diagnostics.
    const second = component.getLineEdit(result);
    expect(second).toBeNull();

    // For this particular payload we expect:
    // - Two warn diagnostics (parse-fail, parse-error)
    // - One info diagnostic (salvage path with no "suggestions" key)
    expect(warnSpy.calls.count()).toBe(2);
    expect(infoSpy.calls.count()).toBe(1);
  });

  it('getLineEdit tolerates control characters inside JSON strings by normalizing them', () => {
    const badJsonObject = {
      suggestions: [
        {
          original: 'בלילה הוא שוב חלם',
          suggested: 'בלילה הוא שוב חלם,',
          reason: 'clarity',
          category: 'clarity',
        },
      ],
      overallFeedback: 'טקסט טוב' + String.fromCharCode(0x0b) + ' מאוד',
    };

    const raw = JSON.stringify(badJsonObject);
    const result = makeLineEditResult({
      structuredResult: raw,
    });

    const parsed = component.getLineEdit(result);

    expect(parsed).not.toBeNull();
    expect(parsed!.suggestions.length).toBe(1);
    expect(parsed!.suggestions[0].original).toBe('בלילה הוא שוב חלם');
  });

  it('getLineEdit salvages truncated suggestions array by dropping incomplete last suggestion', () => {
    const full = {
      suggestions: [
        { original: 'one', suggested: 'one+', reason: 'r1', category: 'clarity' },
        { original: 'two', suggested: 'two+', reason: 'r2', category: 'clarity' },
      ],
      overallFeedback: 'ok',
    };

    const json = JSON.stringify(full);
    const cutPoint = json.lastIndexOf('{');
    const truncated = json.slice(0, cutPoint + 5); // cut in the middle of the second object

    const result = makeLineEditResult({
      structuredResult: truncated,
      resultText: truncated,
    });

    const parsed = component.getLineEdit(result);

    expect(parsed).not.toBeNull();
    expect(parsed!.suggestions.length).toBe(1);
    expect(parsed!.suggestions[0].original).toBe('one');
  });

  // ─── restoreLineEditStateFromResult ───────────────────────────────

  it('restoreLineEditStateFromResult uses DTO suggestions when available (primary path)', () => {
    const result = makeLineEditResult({
      suggestions: [
        {
          id: 'sug-1',
          analysisResultId: 'r-le',
          originalText: 'old text',
          suggestedText: 'new text',
          startOffset: 0,
          endOffset: 8,
          reason: 'clarity',
          category: 'clarity',
          explanation: null,
          outcome: null,
          orderIndex: 0,
        },
      ],
    });

    (component as any).documentText = 'old text in document';
    (component as any).restoreLineEditStateFromResult(result);

    expect(component['lineEditRunSuggestions'].length).toBe(1);
    expect(component['lineEditRunSuggestions'][0].original).toBe('old text');
    expect(component['hasRestoredLineEditForCurrentContext']).toBeTrue();
  });

  it('restoreLineEditStateFromResult falls back to getLineEdit when no DTO suggestions', () => {
    const result = makeLineEditResult({
      suggestions: [],
      structuredResult: null,
      resultText: VALID_STRUCTURED_JSON,
    });

    (component as any).documentText = 'old text in the document here';
    (component as any).restoreLineEditStateFromResult(result);

    expect(component['lineEditRunSuggestions'].length).toBe(1);
    expect(component['lineEditRunSuggestions'][0].original).toBe('old text');
    expect(component['hasRestoredLineEditForCurrentContext']).toBeTrue();
  });

  it('restoreLineEditStateFromResult yields empty when all parsing fails', () => {
    const result = makeLineEditResult({
      suggestions: [],
      structuredResult: null,
      resultText: 'not valid json',
    });

    (component as any).restoreLineEditStateFromResult(result);

    expect(component['lineEditRunSuggestions'].length).toBe(0);
    expect(component['hasRestoredLineEditForCurrentContext']).toBeTrue();
  });

  // ─── onShowInDocument fallback ──────────────────────────────────────

  it('onShowInDocument emits with offsets when both are present', () => {
    const emitted: any[] = [];
    component.showInDocument.subscribe((v: any) => emitted.push(v));

    const suggestion: AnalysisSuggestion = {
      id: 'sug-1',
      original: 'hello',
      suggested: 'world',
      startOffset: 5,
      endOffset: 10,
    };
    component.onShowInDocument(suggestion);

    expect(emitted.length).toBe(1);
    expect(emitted[0].startOffset).toBe(5);
    expect(emitted[0].endOffset).toBe(10);
    expect(emitted[0].originalText).toBe('hello');
  });

  it('onShowInDocument emits with originalText only when offsets are null', () => {
    const emitted: any[] = [];
    component.showInDocument.subscribe((v: any) => emitted.push(v));

    const suggestion: AnalysisSuggestion = {
      id: 'sug-2',
      original: 'some text',
      suggested: 'new text',
    };
    component.onShowInDocument(suggestion);

    expect(emitted.length).toBe(1);
    expect(emitted[0].startOffset).toBeUndefined();
    expect(emitted[0].endOffset).toBeUndefined();
    expect(emitted[0].originalText).toBe('some text');
    expect(emitted[0].suggestionId).toBe('sug-2');
  });

  it('onShowInDocument does not emit when offsets and original are both missing', () => {
    const emitted: any[] = [];
    component.showInDocument.subscribe((v: any) => emitted.push(v));

    const suggestion: AnalysisSuggestion = {
      original: '',
      suggested: 'x',
    };
    component.onShowInDocument(suggestion);

    expect(emitted.length).toBe(0);
  });

  // ─── offset-recompute ─────────────────────────────────────────────

  it('recomputeLineEditOffsets fills in null offsets when documentText becomes available', () => {
    const suggestions: AnalysisSuggestion[] = [
      { original: 'word one', suggested: 'word ONE', reason: 'style', category: 'style' },
      { original: 'word two', suggested: 'word TWO', reason: 'style', category: 'style' },
    ];

    component['lineEditRunSuggestions'] = suggestions;
    expect(suggestions[0].startOffset).toBeUndefined();
    expect(suggestions[1].startOffset).toBeUndefined();

    (component as any).documentText = 'prefix word one middle word two suffix';
    (component as any).recomputeLineEditOffsets();

    expect(component['lineEditRunSuggestions'][0].startOffset).toBe(7);
    expect(component['lineEditRunSuggestions'][0].endOffset).toBe(15);
    expect(component['lineEditRunSuggestions'][1].startOffset).toBe(23);
    expect(component['lineEditRunSuggestions'][1].endOffset).toBe(31);
  });

  it('recomputeLineEditOffsets does not overwrite existing offsets', () => {
    const suggestions: AnalysisSuggestion[] = [
      { original: 'word', suggested: 'WORD', reason: 'r', category: 'c', startOffset: 100, endOffset: 104 },
    ];

    component['lineEditRunSuggestions'] = suggestions;
    (component as any).documentText = 'word appears at start';
    (component as any).recomputeLineEditOffsets();

    expect(component['lineEditRunSuggestions'][0].startOffset).toBe(100);
    expect(component['lineEditRunSuggestions'][0].endOffset).toBe(104);
  });

  it('ngOnChanges triggers offset-recompute when documentText changes and suggestions have null offsets', () => {
    const suggestions: AnalysisSuggestion[] = [
      { original: 'target', suggested: 'TARGET', reason: 'r', category: 'c' },
    ];
    component['lineEditRunSuggestions'] = suggestions;
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'some target text';

    component.ngOnChanges({
      documentText: {
        currentValue: 'some target text',
        previousValue: '',
        firstChange: false,
        isFirstChange: () => false,
      },
    });

    expect(component['lineEditRunSuggestions'][0].startOffset).toBe(5);
    expect(component['lineEditRunSuggestions'][0].endOffset).toBe(11);
  });

  it('restoreLineEditStateFromResult filters out Accepted/Dismissed suggestions', () => {
    const result = makeLineEditResult({
      suggestions: [
        {
          id: 'sug-1',
          analysisResultId: 'r-le',
          originalText: 'accepted text',
          suggestedText: 'new1',
          startOffset: 0,
          endOffset: 13,
          reason: 'style',
          category: 'style',
          explanation: null,
          outcome: 'Accepted',
          orderIndex: 0,
        },
        {
          id: 'sug-2',
          analysisResultId: 'r-le',
          originalText: 'pending text',
          suggestedText: 'new2',
          startOffset: 14,
          endOffset: 26,
          reason: 'clarity',
          category: 'clarity',
          explanation: null,
          outcome: null,
          orderIndex: 1,
        },
      ],
    });

    (component as any).documentText = 'accepted text pending text';
    (component as any).restoreLineEditStateFromResult(result);

    expect(component['lineEditRunSuggestions'].length).toBe(1);
    expect(component['lineEditRunSuggestions'][0].original).toBe('pending text');
  });

});

