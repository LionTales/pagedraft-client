import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { EMPTY, NEVER, Subject, of, throwError, takeUntil } from 'rxjs';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisRunOrchestrationService } from '../../core/services/analysis-run-orchestration.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto } from '../../core/models/analysis';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';

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
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
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
            formatRunDuration: () => null,
            runAnalysisAfterSave: () => EMPTY,
            doRunStreaming: () => EMPTY,
          },
        },
        {
          provide: SuggestionAnchorService,
          useFactory: () => {
            const spy = jasmine.createSpyObj('SuggestionAnchorService', ['relocateAll', 'relocateOne']);
            spy.relocateAll.and.callFake((suggestions: any[]) =>
              suggestions.map((s: any) => ({
                ...s,
                relocatedStart: s.startOffset ?? 0,
                relocatedEnd: s.endOffset ?? (s.startOffset ?? 0) + (s.original?.length ?? 0),
                stale: false,
              }))
            );
            spy.relocateOne.and.callFake((s: any) => ({
              ...s,
              relocatedStart: s.startOffset ?? 0,
              relocatedEnd: s.endOffset ?? (s.startOffset ?? 0) + (s.original?.length ?? 0),
              stale: false,
            }));
            return spy;
          },
        },
        {
          provide: StyleBaselineService,
          useValue: {
            getStyleBaselineStatus: () => NEVER,
            buildStyleBaseline: () => NEVER,
          },
        },
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => NEVER,
            pollStyleBaselineProgress: () => NEVER,
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

  it('mapDtoSuggestions respects heuristic filter', () => {
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

    const withoutFilter = (component as any).mapDtoSuggestions(result, false) as any[];
    const withFilter = (component as any).mapDtoSuggestions(result, true) as any[];

    expect(withoutFilter.length).toBe(1);
    expect(withFilter.length).toBe(0);
  });

  it('applyProofreadOrLineEditResultToRunTab suppresses cards AND highlights for an unreliable proofread', () => {
    // An unreliable proofread returns a flood of bogus suggestions; the Run tab shows the warning and
    // we must NOT surface those suggestions as cards or as document highlights.
    const result = makeResultWithSuggestions({ proofreadResultUnreliable: true });
    component.documentText = 'Hello world';
    component.highlightSuggestionsInDocument = true;
    component.latestResult = result;

    const emissions: any[][] = [];
    component.suggestionRangesChange.subscribe((ranges: any[]) => emissions.push(ranges));

    (component as any).applyProofreadOrLineEditResultToRunTab(result);

    expect(component['proofreadSuggestions'].length).toBe(0);
    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions[emissions.length - 1]).toEqual([]);
  });

  it('applyProofreadOrLineEditResultToRunTab still surfaces suggestions for a reliable proofread (no over-suppression)', () => {
    const result = makeResultWithSuggestions({ proofreadResultUnreliable: false });
    component.documentText = 'Hello world';
    component.highlightSuggestionsInDocument = true;
    component.latestResult = result;

    (component as any).applyProofreadOrLineEditResultToRunTab(result);

    expect(component['proofreadSuggestions'].length).toBeGreaterThan(0);
  });

  it('restoreProofreadStateFromLatestResult clears suggestions AND highlights for an unreliable proofread (History/context restore)', () => {
    // Reloaded/History unreliable proofread carries proofreadResultUnreliable. Restoring must NOT
    // surface the bogus suggestions as cards or re-paint highlights - mirrors the live Run-tab guard.
    const result = makeResultWithSuggestions({ proofreadResultUnreliable: true });
    component.documentText = 'Hello world';
    component.highlightSuggestionsInDocument = true;
    component.latestResult = result;

    const emissions: any[][] = [];
    component.suggestionRangesChange.subscribe((ranges: any[]) => emissions.push(ranges));

    (component as any).restoreProofreadStateFromLatestResult();

    expect(component['proofreadSuggestions'].length).toBe(0);
    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions[emissions.length - 1]).toEqual([]);
  });

  it('restoreProofreadStateFromLatestResult still restores suggestions for a reliable proofread (no over-suppression)', () => {
    const result = makeResultWithSuggestions({ proofreadResultUnreliable: false });
    component.documentText = 'Hello world';
    component.highlightSuggestionsInDocument = true;
    component.latestResult = result;

    (component as any).restoreProofreadStateFromLatestResult();

    expect(component['proofreadSuggestions'].length).toBeGreaterThan(0);
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

  // ─── content-anchored suggestion tests ─────────────────────────────

  it('emitSuggestionRanges calls SuggestionAnchorService.relocateAll when offsetsDirty is true', () => {
    const anchorSpy = TestBed.inject(SuggestionAnchorService) as jasmine.SpyObj<SuggestionAnchorService>;
    const sug: AnalysisSuggestion = {
      id: 's-1', original: 'world', suggested: 'friend', startOffset: 6, endOffset: 11,
    };

    component.latestResult = makeResultWithSuggestions();
    component.highlightSuggestionsInDocument = true;
    component['proofreadSuggestions'] = [sug];
    (component as any).offsetsDirty = true;
    component.documentText = 'Hello world';

    anchorSpy.relocateAll.and.returnValue([
      { ...sug, relocatedStart: 6, relocatedEnd: 11, stale: false },
    ]);

    (component as any).emitSuggestionRanges();

    expect(anchorSpy.relocateAll).toHaveBeenCalledOnceWith([sug], 'Hello world');
  });

  it('stale suggestions are excluded from emitted highlight ranges', () => {
    const anchorSpy = TestBed.inject(SuggestionAnchorService) as jasmine.SpyObj<SuggestionAnchorService>;
    const good: AnalysisSuggestion = {
      id: 's-good', original: 'hello', suggested: 'hi', startOffset: 0, endOffset: 5,
    };
    const stale: AnalysisSuggestion = {
      id: 's-stale', original: 'removed', suggested: 'gone', startOffset: 10, endOffset: 17, outcome: 'Reverted',
    };

    component.latestResult = makeResultWithSuggestions();
    component.highlightSuggestionsInDocument = true;
    component['proofreadSuggestions'] = [good, stale];
    (component as any).offsetsDirty = true;
    component.documentText = 'hello new text removed here';

    anchorSpy.relocateAll.and.returnValue([
      { ...good, relocatedStart: 0, relocatedEnd: 5, stale: false },
      { ...stale, relocatedStart: 10, relocatedEnd: 17, stale: true },
    ]);

    const emitSpy = spyOn(component.suggestionRangesChange, 'emit');
    (component as any).emitSuggestionRanges();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const ranges = emitSpy.calls.mostRecent().args[0] as any[];
    expect(ranges.length).toBe(1);
    expect(ranges[0].suggestionId).toBe('s-good');
  });

  it('onProofreadAccept does not emit applyCorrection for stale suggestions', () => {
    const emitted: any[] = [];
    component.applyCorrection.subscribe((v: any) => emitted.push(v));

    const staleSug: AnalysisSuggestion = {
      id: 's-stale', original: 'old', suggested: 'new', startOffset: 0, endOffset: 3, stale: true,
    };
    component.staleSuggestionIds = new Set(['s-stale']);
    component.latestResult = makeResultWithSuggestions();

    component.onProofreadAccept(staleSug);

    expect(emitted.length).toBe(0);
  });

  it('documentText change sets offsetsDirty to true', () => {
    (component as any).lastAnalysisDocumentText = 'original text';
    (component as any).offsetsDirty = false;
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'modified text';

    component.ngOnChanges({
      documentText: {
        currentValue: 'modified text',
        previousValue: 'original text',
        firstChange: false,
        isFirstChange: () => false,
      },
    });

    expect((component as any).offsetsDirty).toBeTrue();
  });

  // ─── streaming completion: clear streamingText + surface linguistic structuredResult ──

  function makeStreamingResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
    return {
      id: '',
      chapterId: 'chap-1',
      type: 'LinguisticAnalysis',
      analysisType: 'LinguisticAnalysis',
      resultText: '',
      modelName: '',
      createdAt: new Date().toISOString(),
      ...overrides,
    } as AnalysisResultDto;
  }

  it('onStreamingCompleted clears streamingText so post-run views can render', () => {
    component['streamingText'] = 'a streamed summary response';
    const result = makeStreamingResult({
      type: 'Summarization',
      analysisType: 'Summarization',
      resultText: 'a streamed summary response',
    });

    (component as any).onStreamingCompleted(result);

    expect(component['streamingText']).toBe('');
    // Non-linguistic types are not given a synthetic structuredResult.
    expect(component['latestResult']!.structuredResult).toBeUndefined();
  });

  it('onStreamingCompleted surfaces the streamed JSON as structuredResult for LinguisticAnalysis', () => {
    const json = JSON.stringify({
      deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }],
      consistencyIssues: [],
    });
    component['streamingText'] = json;
    const result = makeStreamingResult({ resultText: json });

    (component as any).onStreamingCompleted(result);

    expect(component['streamingText']).toBe('');
    expect(component['latestResult']!.structuredResult).toBe(json);
  });

  it('onStreamingCompleted does not overwrite an existing structuredResult', () => {
    const existing = JSON.stringify({ deviations: [], consistencyIssues: [] });
    const result = makeStreamingResult({ resultText: 'raw', structuredResult: existing });

    (component as any).onStreamingCompleted(result);

    expect(component['latestResult']!.structuredResult).toBe(existing);
  });

  // ─── streaming LinguisticAnalysis adopts the persisted API row (consistency cards) ──

  it('loadHistory swaps a synthetic streaming LinguisticAnalysis result for the persisted API row carrying consistency suggestions', () => {
    component.selectedAnalysisType = 'LinguisticAnalysis';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'Some analyzed chapter text.';
    // The run's persisted row ('ling-persisted') is brand new: it was NOT among the ids known before
    // the run, so it is recognized as this run's output and adopted.
    component['analysisResultIdsBeforeRun'] = new Set<string>();

    // Synthetic streaming result: no id, no suggestions, client timestamp NEWER than the server row.
    component['latestResult'] = makeStreamingResult({
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const consistencyDto: AnalysisSuggestionDto = {
      id: 'cs-1',
      analysisResultId: 'ling-persisted',
      originalText: 'she walked',
      suggestedText: '',
      startOffset: 0,
      endOffset: 10,
      reason: 'POV shift',
      category: 'consistency-pov',
      explanation: null,
      outcome: null,
      orderIndex: 0,
    };
    const persisted = makeResultWithSuggestions({
      id: 'ling-persisted',
      type: 'LinguisticAnalysis',
      analysisType: 'LinguisticAnalysis',
      structuredResult: '{}',
      // Server createdAt is EARLIER than the synthetic client timestamp; the swap must still win.
      createdAt: new Date().toISOString(),
      suggestions: [consistencyDto],
    });
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([persisted]);

    (component as any).loadHistory(true);

    // latestResult must be the persisted row (has id + suggestions), not the synthetic placeholder.
    expect(component['latestResult']!.id).toBe('ling-persisted');
    // ...and consistency cards are restored for the Run tab from result.suggestions.
    expect(component.consistencyRunSuggestions.length).toBe(1);
    expect(component.consistencyRunSuggestions[0].category).toBe('consistency-pov');
    // The synthetic placeholder must NOT also linger in History as a duplicate (it has no id).
    expect(component.history.some(r => !r.id)).toBeFalse();
  });

  // ─── streaming Proofread adopts the persisted row when that row is UNRELIABLE ──

  it('loadHistory swaps a synthetic streaming Proofread result for the persisted API row when that row is unreliable, suppressing cards', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'Some proofread chapter text.';
    component.activeSubTab = 'run';
    // This run's persisted row ('pr-unreliable') is brand new (not known before the run), so it is
    // recognized as this run's output and adopted.
    component['analysisResultIdsBeforeRun'] = new Set<string>();

    // Synthetic streaming Proofread result: no id, no proofreadResultUnreliable flag, client timestamp
    // NEWER than the server row. Client-diff already produced a card on the Run tab.
    component['latestResult'] = makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    });
    component['proofreadSuggestions'] = [
      { original: 'teh', suggested: 'the', startOffset: 0, endOffset: 3 } as AnalysisSuggestion,
    ];

    // Persisted row for this run: server flagged it as unreliable.
    const persisted = makeResultWithSuggestions({
      id: 'pr-unreliable',
      type: 'Proofread',
      analysisType: 'Proofread',
      proofreadResultUnreliable: true,
      // Server createdAt EARLIER than the synthetic client timestamp; the swap must still win.
      createdAt: new Date().toISOString(),
      suggestions: [],
    });
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([persisted]);

    (component as any).loadHistory(true);

    // latestResult must be the persisted (flagged) row, so the existing unreliable suppression applies.
    expect(component['latestResult']!.id).toBe('pr-unreliable');
    expect(component['latestResult']!.proofreadResultUnreliable).toBeTrue();
    // The bogus client-diff cards must be cleared (warning shows instead, no highlights).
    expect(component.proofreadSuggestions.length).toBe(0);
  });

  // ─── streaming Proofread defers surfacing to the reliability-checked server row (no flash) ──

  it('onStreamingCompleted does NOT surface bogus client-diff cards/highlights when the run is UNRELIABLE', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'teh cat';
    component.highlightSuggestionsInDocument = true;
    component.activeSubTab = 'run';
    // This run's persisted row is brand new, so loadHistory recognizes it as this run's output.
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    component['streamingText'] = 'the cat';

    // Server flagged this run's persisted row as unreliable.
    const persistedUnreliable = makeResultWithSuggestions({
      id: 'pr-unreliable',
      proofreadResultUnreliable: true,
      suggestions: [],
      createdAt: new Date().toISOString(),
    });
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([persistedUnreliable]);

    const rangesSpy = spyOn(component.suggestionRangesChange, 'emit');
    const showSpy = spyOn(component.showInDocument, 'emit');

    // Synthetic streaming result: no id, no unreliable flag, client timestamp newer than the server row.
    const synthetic = makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    });
    (component as any).onStreamingCompleted(synthetic);

    // The flagged server row is adopted; the client-diff is never surfaced as cards.
    expect(component['latestResult']!.id).toBe('pr-unreliable');
    expect(component['latestResult']!.proofreadResultUnreliable).toBeTrue();
    expect(component.proofreadSuggestions.length).toBe(0);
    // No document highlights leak (last emission is empty) and the first suggestion is not auto-shown.
    expect(rangesSpy.calls.mostRecent().args[0]).toEqual([]);
    expect(showSpy).not.toHaveBeenCalled();
  });

  it('onStreamingCompleted surfaces client-diff cards (and auto-shows the first) for a RELIABLE run via the loadHistory adopt path', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'teh cat';
    component.highlightSuggestionsInDocument = true;
    component.activeSubTab = 'run';
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    component['streamingText'] = 'the cat';

    // This run's persisted (reliable) row IS present in the response, so reliability is known: the synthetic
    // is kept and its client diff drives the Run tab (no need to wait/retry).
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([
      makeResultWithSuggestions({ id: 'pr-reliable', proofreadResultUnreliable: false }),
    ]);

    const showSpy = spyOn(component.showInDocument, 'emit');

    const synthetic = makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
      createdAt: new Date().toISOString(),
    });
    (component as any).onStreamingCompleted(synthetic);

    // Synthetic kept (reliable row present, not adopted); client-diff cards surfaced.
    expect(component['latestResult']!.id).toBe('');
    expect(component.proofreadSuggestions.length).toBeGreaterThan(0);
    // Original document stashed under the synthetic run key so Accept can map offsets later.
    const runKey = (component as any).suggestionKeyService.proofreadRunKeyForResult(synthetic);
    expect(component['proofreadOriginalDocumentByRunKey'].get(runKey)).toBe('teh cat');
    // The deferred auto-show one-shot fires exactly once, then clears.
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(component['autoShowFirstProofreadAfterRestore']).toBeFalse();
  });

  // ─── streaming Proofread "finalizing" window (no premature / stuck "looks clean") ──

  it('onStreamingCompleted marks a CHANGED streaming proofread as finalizing while loadHistory is in flight', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'teh cat';
    component.activeSubTab = 'run';
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    component['streamingText'] = 'the cat';

    // loadHistory never resolves => we are stuck in the post-stream / pre-adopt window.
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => NEVER;

    (component as any).onStreamingCompleted(makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
      createdAt: new Date().toISOString(),
    }));

    // No cards surfaced yet (deferred), but the run is flagged finalizing so the Run tab shows the hint
    // instead of a premature "No changes needed".
    expect(component.proofreadSuggestions.length).toBe(0);
    expect(component.proofreadFinalizing).toBeTrue();
  });

  it('onStreamingCompleted does NOT finalize a genuinely CLEAN streaming proofread (empty diff surfaces immediately)', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'the cat sat';
    component.activeSubTab = 'run';
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    // Model output identical to the document => empty client diff => genuinely clean.
    component['streamingText'] = 'the cat sat';

    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => NEVER; // even with history pending, the clean state is known client-side

    (component as any).onStreamingCompleted(makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat sat',
      createdAt: new Date().toISOString(),
    }));

    // Clean state surfaces immediately: no finalizing hint, no cards (the Run tab shows "looks clean").
    expect(component.proofreadFinalizing).toBeFalse();
    expect(component.proofreadSuggestions.length).toBe(0);
  });

  it('onStreamingCompleted finalizes (never shows "looks clean") when the stream produced NO usable output', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'the cat sat';
    component.activeSubTab = 'run';
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    // Empty/absent stream output: indeterminate (likely an unreliable empty run), NOT a clean result.
    component['streamingText'] = '';

    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => NEVER;

    (component as any).onStreamingCompleted(makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: '',
      createdAt: new Date().toISOString(),
    }));

    expect(component.proofreadFinalizing).toBeTrue();
    expect(component.proofreadSuggestions.length).toBe(0);
  });

  it('loadHistory FAILURE clears finalizing and falls back to the client diff so "looks clean" never sticks', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'teh cat';
    component.highlightSuggestionsInDocument = true;
    component.activeSubTab = 'run';
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    component['streamingText'] = 'the cat';

    // History load fails: without a fallback the synthetic row would be stuck with 0 suggestions and no
    // reliability flag => a permanent (wrong) "No changes needed".
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => throwError(() => new Error('history unavailable'));

    (component as any).onStreamingCompleted(makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
      createdAt: new Date().toISOString(),
    }));

    // Finalizing resolved and the client diff was surfaced as a degraded fallback (edits visible, not a
    // stuck clean message).
    expect(component.proofreadFinalizing).toBeFalse();
    expect(component.proofreadSuggestions.length).toBeGreaterThan(0);
  });

  // ─── Bug 2: do not surface the client diff before THIS run's persisted row replicates ──

  it('Bug 2: while finalizing, a history response missing this run\'s row holds the diff and retries; it surfaces only after retries exhaust', fakeAsync(() => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'teh cat';
    component.highlightSuggestionsInDocument = true;
    component.activeSubTab = 'run';
    // The run's row has NOT replicated: the only row present is an OLD id known before the run.
    component['analysisResultIdsBeforeRun'] = new Set<string>(['old-id']);
    component['streamingText'] = 'the cat';

    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([makeResultWithSuggestions({ id: 'old-id', proofreadResultUnreliable: false })]);

    (component as any).onStreamingCompleted(makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
      createdAt: new Date().toISOString(),
    }));

    // Row not arrived => keep finalizing, do NOT surface the (possibly unreliable) client diff yet.
    expect(component.proofreadFinalizing).toBeTrue();
    expect(component.proofreadSuggestions.length).toBe(0);

    // Each retry re-loads; the row never arrives, so after the retry budget is spent we surface optimistically.
    tick(600);
    expect(component.proofreadFinalizing).toBeTrue();
    tick(600);
    tick(600);

    expect(component.proofreadFinalizing).toBeFalse();
    expect(component.proofreadSuggestions.length).toBeGreaterThan(0);
  }));

  it('Bug 2: while finalizing, once this run\'s UNRELIABLE row replicates, the diff is suppressed (not surfaced)', () => {
    component.selectedAnalysisType = 'Proofread';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'teh cat';
    component.activeSubTab = 'run';
    component['analysisResultIdsBeforeRun'] = new Set<string>();
    component['streamingText'] = 'the cat';

    // This run's NEW row is present and flagged unreliable => adopt + suppress (no client-diff flood).
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([
      makeResultWithSuggestions({ id: 'pr-unreliable', proofreadResultUnreliable: true, suggestions: [] }),
    ]);

    (component as any).onStreamingCompleted(makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    expect(component.proofreadFinalizing).toBeFalse();
    expect(component['latestResult']!.proofreadResultUnreliable).toBeTrue();
    expect(component.proofreadSuggestions.length).toBe(0);
  });

  // ─── Bug 1: stale loadHistory responses must not touch the new context's finalizing window ──

  it('Bug 1: a stale loadHistory SUCCESS from a prior navigation does not clear the new context finalizing', () => {
    const subject = new Subject<AnalysisResultDto[]>();
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => subject.asObservable();

    component.chapterId = 'chap-1';
    component.proofreadFinalizing = true;
    (component as any).loadHistory(true); // captures loadingChapterId = 'chap-1'

    // User navigates away; the new chapter's own run is finalizing.
    component.chapterId = 'chap-2';
    component.proofreadFinalizing = true;

    subject.next([]); // late response for the OLD request

    // The stale-guard runs first, so the new context's finalizing flag is untouched.
    expect(component.proofreadFinalizing).toBeTrue();
  });

  it('Bug 1: a stale loadHistory ERROR from a prior navigation does not clear the new context finalizing', () => {
    const subject = new Subject<AnalysisResultDto[]>();
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => subject.asObservable();

    component.chapterId = 'chap-1';
    (component as any).loadHistory(true);

    component.chapterId = 'chap-2';
    component.proofreadFinalizing = true;

    subject.error(new Error('late failure'));

    expect(component.proofreadFinalizing).toBeTrue();
  });

  // ─── Bug 3: chapter/scene change resets the streaming-proofread finalize one-shots ──

  it('Bug 3: a chapter change resets autoShow + finalizing so a prior run cannot auto-open in the new context', () => {
    component['autoShowFirstProofreadAfterRestore'] = true;
    component.proofreadFinalizing = true;
    component['proofreadFinalizeRetriesLeft'] = 3;

    component.chapterId = 'chap-2';
    component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });

    expect(component['autoShowFirstProofreadAfterRestore']).toBeFalse();
    expect(component.proofreadFinalizing).toBeFalse();
    expect(component['proofreadFinalizeRetriesLeft']).toBe(0);
  });

  // ─── a documentText update during the finalizing window must NOT surface the synthetic diff early ──

  it('a documentText change while finalizing does NOT diff the synthetic result early (no cards / highlight / auto-show)', () => {
    component.selectedAnalysisType = 'Proofread';
    component.chapterId = 'chap-1';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.sceneId = null;
    component.activeSubTab = 'run';

    // Finalizing window: synthetic streaming proofread deferred (no suggestions, reliability unknown).
    component['latestResult'] = makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
    });
    component['proofreadSuggestions'] = [];
    component['hasRestoredProofreadForCurrentContext'] = false;
    component.proofreadFinalizing = true;
    component['autoShowFirstProofreadAfterRestore'] = true;

    const showSpy = spyOn(component.showInDocument, 'emit');

    // A document update arrives mid-window (context still matches, so the guard - not the context check -
    // is what suppresses the early restore).
    component.documentText = 'teh cat';
    component.ngOnChanges({ documentText: new SimpleChange(undefined, 'teh cat', false) });

    // Deferred: nothing surfaced, no highlight/auto-show, the one-shot is preserved for the loadHistory path.
    expect(component.proofreadSuggestions.length).toBe(0);
    expect(showSpy).not.toHaveBeenCalled();
    expect(component['autoShowFirstProofreadAfterRestore']).toBeTrue();
  });

  it('a documentText change restores proofread state when NOT finalizing (guard is specific to the window)', () => {
    component.selectedAnalysisType = 'Proofread';
    component.chapterId = 'chap-1';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.sceneId = null;
    component.activeSubTab = 'run';

    component['latestResult'] = makeStreamingResult({
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'the cat',
    });
    component['proofreadSuggestions'] = [];
    component['hasRestoredProofreadForCurrentContext'] = false;
    component.proofreadFinalizing = false; // window resolved

    component.documentText = 'teh cat';
    component.ngOnChanges({ documentText: new SimpleChange(undefined, 'teh cat', false) });

    expect(component.proofreadSuggestions.length).toBeGreaterThan(0);
  });

  it('emitSuggestionRanges emits NO document highlights when the Proofread latestResult is flagged unreliable', () => {
    component.latestResult = makeResultWithSuggestions({ proofreadResultUnreliable: true });
    component.highlightSuggestionsInDocument = true;
    // Even with a populated suggestion array (e.g. a transient client-diff), an unreliable result
    // must never paint highlights.
    component['proofreadSuggestions'] = [
      { original: 'teh', suggested: 'the', startOffset: 0, endOffset: 3 } as AnalysisSuggestion,
    ];

    const emitSpy = spyOn(component.suggestionRangesChange, 'emit');
    (component as any).emitSuggestionRanges();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.calls.mostRecent().args[0]).toEqual([]);
  });

  it('emitSuggestionRanges emits Proofread ranges when the latestResult is reliable', () => {
    component.latestResult = makeResultWithSuggestions({ proofreadResultUnreliable: false });
    component.highlightSuggestionsInDocument = true;
    component['proofreadSuggestions'] = [
      { id: 'p-1', original: 'teh', suggested: 'the', startOffset: 0, endOffset: 3 } as AnalysisSuggestion,
    ];

    const emitSpy = spyOn(component.suggestionRangesChange, 'emit');
    (component as any).emitSuggestionRanges();

    const arg = emitSpy.calls.mostRecent().args[0] as Array<{ startOffset: number; endOffset: number }>;
    expect(arg.length).toBe(1);
    expect(arg[0].startOffset).toBe(0);
    expect(arg[0].endOffset).toBe(3);
  });

  it('loadHistory keeps the fresh synthetic result when the response has only a PRE-EXISTING (stale) persisted row', () => {
    component.selectedAnalysisType = 'LinguisticAnalysis';
    component.documentChapterId = 'chap-1';
    component.documentSceneId = null;
    component.documentText = 'Some analyzed chapter text.';

    // The synthetic result the user just received (fresh structured output, no id yet).
    const freshStructured = '{"summary":"the run the user just received"}';
    component['latestResult'] = makeStreamingResult({
      structuredResult: freshStructured,
      resultText: freshStructured,
    });

    // This run's persisted row has NOT arrived yet; the response carries only an OLDER analysis whose
    // id was already known before the run started.
    component['analysisResultIdsBeforeRun'] = new Set<string>(['old-ling']);
    const stalePersisted = makeResultWithSuggestions({
      id: 'old-ling',
      type: 'LinguisticAnalysis',
      analysisType: 'LinguisticAnalysis',
      structuredResult: '{"summary":"a previous run"}',
      createdAt: new Date(Date.now() - 600_000).toISOString(),
      suggestions: [
        {
          id: 'old-cs', analysisResultId: 'old-ling', originalText: 'old span', suggestedText: '',
          startOffset: 0, endOffset: 8, reason: 'old', category: 'consistency-tense',
          explanation: null, outcome: null, orderIndex: 0,
        } as AnalysisSuggestionDto,
      ],
    });
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([stalePersisted]);

    (component as any).loadHistory(true);

    // The fresh synthetic result must be kept (NOT replaced by the older analysis).
    expect(component['latestResult']!.id).toBe('');
    expect(component['latestResult']!.structuredResult).toBe(freshStructured);
    // ...and the stale row's consistency cards must NOT leak onto the Run tab.
    expect(component.consistencyRunSuggestions.length).toBe(0);
  });

  // ─── full reload resets dismissed-consistency keys; merge keeps them ──

  it('loadHistory(false) clears dismissedConsistencyKeys; loadHistory(true) preserves them', () => {
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => of([]);

    component['dismissedConsistencyKeys'] = new Set(['stale-key']);
    (component as any).loadHistory(false);
    expect(component['dismissedConsistencyKeys'].size).toBe(0);

    component['dismissedConsistencyKeys'] = new Set(['stale-key']);
    (component as any).loadHistory(true);
    expect(component['dismissedConsistencyKeys'].has('stale-key')).toBeTrue();
  });

  it('auto-dismiss fires for stale Pending suggestions only, not for Accepted or Reverted', () => {
    const anchorSpy = TestBed.inject(SuggestionAnchorService) as jasmine.SpyObj<SuggestionAnchorService>;
    const pending: AnalysisSuggestion = {
      id: 's-pending', original: 'pending text', suggested: 'new1', startOffset: 0, endOffset: 12,
    };
    const reverted: AnalysisSuggestion = {
      id: 's-reverted', original: 'reverted text', suggested: 'new2', startOffset: 20, endOffset: 33, outcome: 'Reverted',
    };
    const accepted: AnalysisSuggestion = {
      id: 's-accepted', original: 'accepted text', suggested: 'new3', startOffset: 40, endOffset: 53, outcome: 'Accepted',
    };

    component.latestResult = makeResultWithSuggestions();
    component.highlightSuggestionsInDocument = true;
    component['proofreadSuggestions'] = [pending, reverted, accepted];
    (component as any).offsetsDirty = true;
    component.documentText = 'some completely different document text here';

    anchorSpy.relocateAll.and.returnValue([
      { ...pending, relocatedStart: 0, relocatedEnd: 12, stale: true },
      { ...reverted, relocatedStart: 20, relocatedEnd: 33, stale: true },
      { ...accepted, relocatedStart: 40, relocatedEnd: 53, stale: true },
    ]);

    (component as any).emitSuggestionRanges();

    const remainingIds = component['proofreadSuggestions'].map((s: AnalysisSuggestion) => s.id);
    expect(remainingIds).not.toContain('s-pending');
    expect(remainingIds).toContain('s-reverted');
    expect(remainingIds).toContain('s-accepted');
  });

  // =========================================================================
  // DEF-2: reattach to an in-progress style-baseline build on status load
  // =========================================================================
  describe('style baseline reattach (DEF-2)', () => {
    function makeBaselineStatus(overrides: Partial<BookStyleBaselineStatusDto> = {}): BookStyleBaselineStatusDto {
      return {
        bookId: 'book-1',
        language: 'he',
        totalChapters: 5,
        builtChapters: 2,
        staleCount: 0,
        hasBaseline: false,
        ready: false,
        lastUpdatedAt: null,
        builtWithModel: null,
        activeModel: 'gemma4:12b',
        builtWithDifferentModel: false,
        activeBuildJobId: null,
        chaptersToBuild: 5,
        estimatedSeconds: 120,
        estimatedUsd: null,
        ...overrides,
      };
    }

    it('reattaches (BUILDING + polls that jobId) when status has a non-null activeBuildJobId', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ activeBuildJobId: 'job-running' }))
      );
      // Keep the progress stream open so the component stays in BUILDING during the assertion.
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);

      component.loadStyleBaselineStatus();

      expect(pollSpy).toHaveBeenCalledWith('book-1', 'job-running', jasmine.anything());
      expect(component.styleBaselineBuilding).toBeTrue();
    });

    it('does NOT reattach when activeBuildJobId is null', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ activeBuildJobId: null }))
      );
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);

      component.loadStyleBaselineStatus();

      expect(pollSpy).not.toHaveBeenCalled();
      expect(component.styleBaselineBuilding).toBeFalse();
    });

    it('does NOT double-subscribe when a build is already being tracked in this tab', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ activeBuildJobId: 'job-running' }))
      );
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);
      // Simulate a build the user just started in THIS tab.
      component.styleBaselineBuilding = true;

      component.loadStyleBaselineStatus();

      expect(pollSpy).not.toHaveBeenCalled();
    });

    it('does NOT reattach a second time to a jobId already driven to terminal (loop guard)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      // Server keeps advertising the SAME activeBuildJobId even after the job is terminal (lingering entry).
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ activeBuildJobId: 'J' }))
      );
      // Controllable progress stream so we can emit a terminal 'succeeded' for 'J'.
      const progress$ = new Subject<any>();
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(progress$.asObservable());

      // First load: reattaches and starts polling 'J'.
      component.loadStyleBaselineStatus();
      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(pollSpy).toHaveBeenCalledWith('book-1', 'J', jasmine.anything());
      expect(component.styleBaselineBuilding).toBeTrue();

      // Drive 'J' to terminal. The component records 'J' as handled and re-reads status, which STILL
      // returns activeBuildJobId 'J' -> must NOT reattach again.
      progress$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });

      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(component.styleBaselineBuilding).toBeFalse();
    });

    it('reattaches to a DIFFERENT new jobId even after a prior jobId was handled (regression)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);
      // Pretend 'J' was already driven to terminal in this component instance.
      (component as any).styleBaselineHandledTerminalJobId = 'J';

      // Status now advertises a genuinely NEW build with a different jobId.
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ activeBuildJobId: 'K' }))
      );

      component.loadStyleBaselineStatus();

      expect(pollSpy).toHaveBeenCalledTimes(1);
      expect(pollSpy).toHaveBeenCalledWith('book-1', 'K', jasmine.anything());
      expect(component.styleBaselineBuilding).toBeTrue();
    });

    it('resets the in-flight build/poll on a bookLanguage change and ignores a stale OLD-language poll emit (c01)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);

      // Build for the CURRENT language ('he'): returns a jobId so the component starts polling.
      spyOn(styleSvc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'job-he', noOp: false } as any));
      // Hold the 'he' poll open so the component stays in BUILDING with a live poll.
      const hePoll$ = new Subject<any>();
      spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(hePoll$.asObservable());
      // After the language switch, the NEW language ('en') reports no active build.
      const statusSpy = spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ language: 'en', activeBuildJobId: null }))
      );

      // Start a build for 'he'.
      component.bookLanguage = 'he';
      component.onBuildStyleBaseline();
      expect(component.styleBaselineBuilding).toBeTrue();
      expect(progressSvc.pollStyleBaselineProgress).toHaveBeenCalledWith('book-1', 'job-he', jasmine.anything());

      // Switch the book language to 'en' (no bookId change).
      component.bookLanguage = 'en';
      component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

      // The OLD-language in-flight build/poll must be torn down for the new language.
      expect(component.styleBaselineBuilding).toBeFalse();
      expect((component as any).styleBaselineProgressStop$).toBeNull();
      // The new language re-read its own status.
      expect(statusSpy).toHaveBeenCalledWith('book-1', 'en');

      // A late emit on the OLD 'he' poll Subject must NOT flip BUILDING back true for the new language.
      hePoll$.next({ status: 'running', message: 'still going', estimatedCompletionPercent: 50 });
      expect(component.styleBaselineBuilding).toBeFalse();
    });

    it('cancels an earlier in-flight status fetch so a slower OLDER response cannot overwrite the newer snapshot (Bug 1)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);

      const olderReq$ = new Subject<BookStyleBaselineStatusDto>();
      const newerReq$ = new Subject<BookStyleBaselineStatusDto>();
      // Two overlapping fetches for the SAME (book, language): first call → olderReq$, second → newerReq$.
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValues(olderReq$.asObservable(), newerReq$.asObservable());
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);

      component.loadStyleBaselineStatus(); // older, still in flight
      component.loadStyleBaselineStatus(); // newer, supersedes the older

      // The newer request resolves FIRST with the current snapshot...
      newerReq$.next(makeBaselineStatus({ builtChapters: 5, activeBuildJobId: null }));
      // ...then the OLDER request resolves LATE with a now-stale snapshot + a stale active build.
      olderReq$.next(makeBaselineStatus({ builtChapters: 1, activeBuildJobId: 'stale-job' }));

      // The newer snapshot wins, and the stale older response neither overwrites it nor reattaches a poll.
      expect(component.styleBaselineStatus?.builtChapters).toBe(5);
      expect(pollSpy).not.toHaveBeenCalled();
      expect(component.styleBaselineBuilding).toBeFalse();
    });

    it('onBuildStyleBaseline does NOT interrupt or duplicate a build already in flight (reattach guard, Bug 1)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);

      // A poll is already reattached (DEF-2) to an in-flight job; the component is BUILDING. Mirror the
      // real service's takeUntil(stop$) wiring so the poll is a faithful live subscription.
      const livePoll$ = new Subject<any>();
      spyOn(progressSvc, 'pollStyleBaselineProgress').and.callFake(
        (_b: string, _j: string, stop$: any) => livePoll$.asObservable().pipe(takeUntil(stop$))
      );
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(makeBaselineStatus({ activeBuildJobId: 'live-job' }))
      );
      const buildSpy = spyOn(styleSvc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'dup', noOp: false } as any));

      component.loadStyleBaselineStatus();
      expect(component.styleBaselineBuilding).toBeTrue();
      const stopBefore = (component as any).styleBaselineProgressStop$;
      expect(stopBefore).not.toBeNull();

      // A stray Confirm arrives while the build is in flight (e.g. a lingering consent prompt). It must be
      // a no-op: NO second build POST, BUILDING stays true, and the live poll keeps tracking the job.
      component.onBuildStyleBaseline();

      expect(buildSpy).not.toHaveBeenCalled();
      expect(component.styleBaselineBuilding).toBeTrue();
      expect((component as any).styleBaselineProgressStop$).toBe(stopBefore);

      // The in-flight poll is still live and still updates progress for the tracked job.
      livePoll$.next({ status: 'running', message: 'tracked job progressing', estimatedCompletionPercent: 60 });
      expect(component.styleBaselineProgressMessage).toBe('tracked job progressing');
    });
  });
});

