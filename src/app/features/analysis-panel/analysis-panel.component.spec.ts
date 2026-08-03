import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { EMPTY, NEVER, Observable, Subject, of, throwError, takeUntil } from 'rxjs';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisRunOrchestrationService, AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto } from '../../core/models/analysis';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { AiTierService } from '../../core/services/ai-tier.service';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';

/**
 * c01: a host that mounts the panel behind a structural `@if`, exactly the way `editor-page.component.html`
 * does (`@if (editHelpView === 'analysis')` nested in `@else if (reviewMode === 'edit')`).
 *
 * The point is the BOUNDARY. The panel's `ngOnDestroy` cancels the in-flight run, and the host's run
 * dialog is NOT destroyed with it, so the terminal has to cross a real template binding on a component
 * Angular is in the middle of tearing down. Calling `ngOnDestroy()` by hand would prove nothing about
 * that: it would not exercise the destroy ORDER (Angular runs child ngOnDestroy hooks before it unhooks
 * the parent's output listeners), which is the only reason this mechanism works at all.
 */
@Component({
  standalone: true,
  imports: [AnalysisPanelComponent],
  template: `
    @if (mounted) {
      <app-analysis-panel
        [bookId]="'book-1'"
        [chapterId]="'chap-1'"
        (runEvent)="events.push($event)">
      </app-analysis-panel>
    }
  `,
})
class PanelUnmountHostComponent {
  mounted = true;
  readonly events: AnalysisRunEvent[] = [];
}

describe('AnalysisPanelComponent (focused logic)', () => {
  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;
  // rf-c02: the run tab publishes its style-baseline build to the registry on start. Spy so we can assert
  // track() and so the real (root) registry (with its transitive deps) is not pulled into this TestBed.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    // `jobById$` is read by the in-panel progress bar (app-job-progress-inline) inside the async banner.
    // Without it on the stub, every async-banner test dies with a TypeError from that grandchild.
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track', 'jobById$']);
    jobRegistrySpy.jobById$.and.returnValue(of(null));
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
        { provide: JobRegistryService, useValue: jobRegistrySpy },
        // tier-ux-rework c3: the hosted run tab renders the per-edit-type tier toggle, which injects
        // AiTierService (-> HttpClient). Stubbed so this suite does not fail with a NullInjector error
        // naming HttpClient rather than the grandchild that introduced it.
        {
          provide: AiTierService,
          useValue: {
            // `watch` is the shared per-book answer channel (tier-ux-rework fixes c02): the toggle subscribes
            // to it on every mount, so a stub without it fails this suite with a TypeError from a grandchild.
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

  it('mapDtoSuggestions passes large-span server suggestions through unfiltered', () => {
    // Regression: this used to drop any suggestion where original > 60 chars and suggested <= 5,
    // mirroring a server guard that no longer exists in that form. Removing an accidentally
    // duplicated sentence produces exactly that shape - measured live as a 64-char original
    // collapsing to a 5-char remainder - so a correct, server-verified correction was silently
    // discarded. The server owns suggestion validity now (it verifies every split against resultText
    // and only guards the spans that can actually be misaligned); the client must not second-guess it.
    const duplicated = 'לשאול. נעמי הביטה החוצה, אל הרחוב הרטוב, וחשבה על כל מה שלא נאמר';
    const result = makeResultWithSuggestions({
      suggestions: [
        {
          id: 's-1',
          analysisResultId: 'r-1',
          originalText: duplicated,
          suggestedText: 'לשאול',
          startOffset: 0,
          endOffset: duplicated.length,
          reason: 'Proofread',
          category: null,
          explanation: null,
          outcome: null,
          orderIndex: 0,
        },
      ],
    });

    expect(duplicated.length).toBeGreaterThan(60);
    const mapped = (component as any).mapDtoSuggestions(result) as any[];

    expect(mapped.length).toBe(1);
    expect(mapped[0].suggested).toBe('לשאול');
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
      // rf-c02: the reattached build is published to the registry so the editor affordance can read it.
      expect(jobRegistrySpy.track).toHaveBeenCalledWith('style-baseline', 'book-1', 'job-running');
    });

    // rf-c02: the run tab PUBLISHES its style-baseline build to the registry on start (track), so the
    // editor's single "review running" affordance can read it via jobRegistry.anyRunningForBook$.
    it('rf-c02: tracks the style-baseline build once with kind/bookId/jobId on a fresh build', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(styleSvc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildStyleBaseline();

      expect(jobRegistrySpy.track).toHaveBeenCalledOnceWith('style-baseline', 'book-1', 'job-1');
    });

    it('rf-c02: does NOT track a NO-OP style-baseline build (no jobId)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      spyOn(styleSvc, 'buildStyleBaseline').and.returnValue(of({ jobId: null, noOp: true } as any));
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildStyleBaseline();

      expect(jobRegistrySpy.track).not.toHaveBeenCalled();
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
      // styleBaselineProgressPercent is updated by the live poll — confirms it was not cancelled.
      expect(component.styleBaselineProgressPercent).toBe(60);
    });
  });

  // Bug 1 (rf-c01): starting an async chapter Proofread/Line Edit run must publish the job to the
  // registry on job-started, so the Activity Center + anyRunningForBook$ pick it up for THIS run and
  // not only after a reload reattaches to it.
  describe('job-started publishes the chapter analysis job to the registry', () => {
    it('tracks a fresh Proofread async job with kind proofread + analysisType + chapterId + scopeLabel', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';
      (component as any).prepareForRun(); // capture the run origin, as the real run path does

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-1' });

      expect(jobRegistrySpy.track).toHaveBeenCalledWith('proofread', 'book-1', 'async-1', {
        analysisType: 'Proofread',
        chapterId: 'chap-1',
        scopeLabel: 'פרק',
      });
    });

    it('carries analysisType LineEdit so an in-flight Line Edit does not title as proofreading', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'LineEdit';
      (component as any).prepareForRun();

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-le' });

      expect(jobRegistrySpy.track).toHaveBeenCalledWith('proofread', 'book-1', 'async-le', {
        analysisType: 'LineEdit',
        chapterId: 'chap-1',
        scopeLabel: 'פרק',
      });
    });

    it('carries analysisType LinguisticAnalysis so an in-flight linguistic run does not title as proofreading', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'LinguisticAnalysis';
      (component as any).prepareForRun();

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-la' });

      expect(jobRegistrySpy.track).toHaveBeenCalledWith('proofread', 'book-1', 'async-la', {
        analysisType: 'LinguisticAnalysis',
        chapterId: 'chap-1',
        scopeLabel: 'פרק',
      });
    });

    it('does NOT track when there is no bookId (guard)', () => {
      component.bookId = null;
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-x' });

      expect(jobRegistrySpy.track).not.toHaveBeenCalled();
    });

    it('tracks a fresh Linguistic async job with scopeLabel scene when sceneId is set', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.sceneId = 'scene-1';
      component.selectedAnalysisType = 'LinguisticAnalysis';
      (component as any).prepareForRun();

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-scene' });

      expect(jobRegistrySpy.track).toHaveBeenCalledWith('proofread', 'book-1', 'async-scene', {
        analysisType: 'LinguisticAnalysis',
        chapterId: 'chap-1',
        scopeLabel: 'סצנה',
      });
    });

    it('keys the tracked job off the run ORIGIN, not live panel state, when the user switches context before the async start response', () => {
      // The panel instance is reused across navigation and the async start response can arrive after a
      // context switch. The tracked job must reflect the scope/chapter/type the run (and API) began with.
      component.bookId = 'book-1';
      component.chapterId = 'chap-scene-origin';
      component.sceneId = 'scene-origin';
      component.selectedAnalysisType = 'LinguisticAnalysis';
      (component as any).prepareForRun(); // origin captured: scene scope, chap-scene-origin, LinguisticAnalysis

      // User navigates to a different, non-scene chapter and flips the analysis type BEFORE job-started.
      component.chapterId = 'chap-other';
      component.sceneId = null;
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-race' });

      expect(jobRegistrySpy.track).toHaveBeenCalledWith('proofread', 'book-1', 'async-race', {
        analysisType: 'LinguisticAnalysis',
        chapterId: 'chap-scene-origin',
        scopeLabel: 'סצנה',
      });
    });
  });

  // pf-f01: async non-blocking overlay and in-panel compact banner.
  describe('pf-f01 async job non-blocking overlay', () => {
    // c01: these two used to assert the `asyncJobStarted` @Output, which lost its last consumer when the
    // blocking overlay was deleted and has now been deleted with it. Their INTENT was the async handoff -
    // the job becomes visible exactly once, and the no-bookId guard skips the whole handoff - so they are
    // re-pointed at what actually performs it: `jobRegistry.track` plus the in-panel banner state it
    // raises. Both halves move together or a job is tracked with no indicator (or the reverse).
    it('publishes the job exactly once on job-started and raises the in-panel banner for it', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-1' });

      expect(jobRegistrySpy.track).toHaveBeenCalledTimes(1);
      expect(jobRegistrySpy.track.calls.mostRecent().args[2]).toBe('async-1');
      // The banner mirrors the id that was published, so it can never point at a different job.
      expect((component as any).currentRunJobId).toBe('async-1');
      expect(component.asyncJobInFlight).toBeTrue();
      expect((component as any).asyncBannerActiveForRun).toBeTrue();
    });

    it('does NOT publish the job (or raise the banner) when there is no bookId', () => {
      component.bookId = null;
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-x' });

      // The guard short-circuits: the job is never published, so no surface could render it...
      expect(jobRegistrySpy.track).not.toHaveBeenCalled();
      // ...and the banner must not claim a job that no surface can track.
      expect((component as any).currentRunJobId).toBeNull();
      expect(component.asyncJobInFlight).toBeFalse();
    });

    it('sets asyncJobInFlight true on job-started and clears it when the job result arrives', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-2' });
      expect(component.asyncJobInFlight).toBe(true);

      // Result arrives: asyncJobInFlight clears.
      (component as any).handleRunEvent({ kind: 'job-result', result: {} as any });
      expect(component.asyncJobInFlight).toBe(false);
    });

    it('clears asyncJobInFlight on error so the banner is not stuck', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-3' });
      expect(component.asyncJobInFlight).toBe(true);

      (component as any).handleRunEvent({ kind: 'error', message: 'network error' });
      expect(component.asyncJobInFlight).toBe(false);
    });

    it('dismissAsyncBanner clears asyncJobInFlight without affecting isRunning', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      (component as any).isRunning = true;
      component.asyncJobInFlight = true;

      component.dismissAsyncBanner();

      expect(component.asyncJobInFlight).toBe(false);
      // isRunning is not affected: the job keeps running in the background.
      expect((component as any).isRunning).toBe(true);
    });

    it('prepareForRun resets a lingering asyncJobInFlight to false at run start', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.asyncJobInFlight = true;

      (component as any).prepareForRun();

      expect(component.asyncJobInFlight).toBe(false);
    });

    it('track fires ONCE on async start (no double-poll: handleRunEvent is not a loop)', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-1' });

      // track must be called exactly once: the orchestration poll is reused, not forked.
      expect(jobRegistrySpy.track).toHaveBeenCalledTimes(1);
    });
  });

  // ── c01 remedy B: an `@if` unmount must not strand the host's run dialog ────────────────────────────
  //
  // The panel is `@if`-mounted in the editor; the run dialog is not. Switching the Edit-help sub-tab or
  // the Review/Edit control destroys the panel, and ngOnDestroy unsubscribes `runSubscription`, which
  // CANCELS the run. On the sync path nothing was ever registry-tracked, so before this fix the dialog sat
  // in "Starting..." with a live indeterminate bar forever, describing a run that no longer existed.
  //
  // Driven through a Subject held OPEN across the unmount: the whole defect lives in the window between
  // "a run is in flight" and "the run produced a terminal event", and of()/EMPTY collapses that window.
  describe('c01 the run terminal crosses the boundary when the panel is destroyed mid-run', () => {
    let host: PanelUnmountHostComponent;
    let hostFixture: ComponentFixture<PanelUnmountHostComponent>;
    let panel: AnalysisPanelComponent;
    let runStream$: Subject<AnalysisRunEvent>;

    beforeEach(() => {
      runStream$ = new Subject<AnalysisRunEvent>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      hostFixture = TestBed.createComponent(PanelUnmountHostComponent);
      host = hostFixture.componentInstance;
      hostFixture.detectChanges();
      panel = hostFixture.debugElement.query(By.directive(AnalysisPanelComponent))
        .componentInstance as AnalysisPanelComponent;
      panel.selectedAnalysisType = 'Proofread';
      panel.documentText = 'Hello world';
    });

    afterEach(() => hostFixture.destroy());

    it('emits run-finished ONCE to the host when an untracked (sync-path) run is unmounted mid-flight', () => {
      panel.runAnalysis();
      runStream$.next({ kind: 'status', message: 'Running Proofread analysis...' });
      hostFixture.detectChanges();

      // Precondition: genuinely mid-flight, and nothing has told the host the run is over.
      expect((panel as any).isRunning).toBeTrue();
      expect(host.events.some(e => e.kind === 'run-finished')).toBeFalse();

      // The user switches the Edit-help sub-tab: the `@if` destroys the panel and cancels the run.
      host.mounted = false;
      hostFixture.detectChanges();

      expect(hostFixture.debugElement.query(By.directive(AnalysisPanelComponent))).toBeNull();
      // The terminal crossed the binding even though the emitter was being torn down.
      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(1);
      // ...and it is the LAST thing the host heard, so the dialog resolves rather than hanging.
      expect(host.events[host.events.length - 1].kind).toBe('run-finished');
      // The run really was cancelled: the client stream has no subscriber left.
      expect(runStream$.observed).toBeFalse();
    });

    it('emits run-finished on unmount for a TRACKED run too (the dialog, not the panel, guards state (b))', () => {
      panel.runAnalysis();
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });
      hostFixture.detectChanges();
      expect(panel.asyncJobInFlight).toBeTrue();

      host.mounted = false;
      hostFixture.detectChanges();

      // The panel does not second-guess the host: it reports that ITS run is over. Whether the card
      // resolves is the dialog's call, and the dialog keeps a registry-tracked job waiting (d1 item 6) -
      // pinned by "does NOT resolve a TRACKED run" in analysis-run-dialog.component.spec.ts. Keeping the
      // guard in ONE place stops the two surfaces from disagreeing about what "tracked" means.
      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(1);
    });

    it('does NOT emit run-finished when the panel is destroyed with no run in flight', () => {
      // No run was started, so there is nothing to report and nothing to resolve.
      host.mounted = false;
      hostFixture.detectChanges();

      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(0);
    });
  });

  // ── c01 remedy A: the subscription's own terminal reaches the host ─────────────────────────────────
  //
  // `onRunFinished` is the panel's AUTHORITATIVE run terminal (the subscription's complete/error, plus a
  // rejected pre-run save). It used to emit `analysisCompleted`, an @Output the editor stopped binding,
  // so a run that ended without one of the orchestration service's own terminal EVENTS told the host
  // nothing at all. Subjects are held OPEN so the terminal is pushed while the run is genuinely
  // mid-flight.
  describe('c01 the run subscription terminal reaches the host on runEvent', () => {
    let runStream$: Subject<AnalysisRunEvent>;
    let hostEvents: AnalysisRunEvent[];

    /** Start a run wired to a Subject we control, and record what crosses the output. */
    function startRun(): void {
      runStream$ = new Subject<AnalysisRunEvent>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      hostEvents = [];
      component.runEvent.subscribe(e => hostEvents.push(e));
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      component.runAnalysis();
    }

    const terminals = () => hostEvents.filter(e => e.kind === 'run-finished').length;

    it('emits run-finished when the run stream ERRORS with nothing else to report', () => {
      startRun();
      runStream$.next({ kind: 'status', message: 'Running Proofread analysis...' });
      expect(terminals()).withContext('mid-flight: nothing has ended yet').toBe(0);

      // e.g. saveBeforeRun() rejected inside runAnalysisAfterSave, or a link in the chain threw outside
      // its catchError: the observable errors and no error EVENT was ever produced.
      runStream$.error(new Error('save failed'));

      expect(terminals()).toBe(1);
      expect((component as any).isRunning).toBeFalse();
    });

    it('emits run-finished when the run stream COMPLETES with nothing else to report', () => {
      startRun();
      expect(terminals()).toBe(0);

      runStream$.complete();

      expect(terminals()).toBe(1);
    });

    it('emits run-finished exactly ONCE even though a real terminal event preceded it', () => {
      startRun();
      // The normal shape of a sync run: a result event, then the stream completes.
      runStream$.next({ kind: 'sync-result', result: makeResultWithSuggestions({ chapterId: 'chap-1' }) });
      runStream$.complete();

      // onRunFinished is guarded on isRunning, which the result already cleared, so the host is not told
      // twice. (The dialog is single-resolve anyway, but two terminals for one run is a lie either way.)
      expect(terminals()).toBe(0);
      expect(hostEvents.filter(e => e.kind === 'sync-result').length).toBe(1);
    });

    it('emits run-finished when a rejected pre-run save stops a STREAMING run before it starts', fakeAsync(() => {
      hostEvents = [];
      component.runEvent.subscribe(e => hostEvents.push(e));
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      // This branch never creates a subscription at all, so it is the one terminal route that cannot
      // reach the complete/error handlers. Latent today (saveCurrentDocumentPromise always resolves).
      component.saveBeforeRun = () => Promise.reject(new Error('save failed'));

      component.runStreaming();
      tick();

      expect(terminals()).toBe(1);
      expect((component as any).isRunning).toBeFalse();
    }));
  });

  // c01: pf-f01 made long runs non-blocking, and the panel instance is REUSED across navigation. A run
  // started on chapter A whose terminal arrives AFTER the user switched to chapter B must NOT inject A's
  // result over B (and must not leave A's "running" banner lingering on B). Drive the run through a
  // controllable Subject so the async window stays OPEN across the context switch - of()/throwError would
  // collapse it synchronously and never reproduce the mid-run switch.
  describe('c01 stale-context async result is dropped, not injected', () => {
    // Build an AnalysisResultDto whose origin context is chapter A. It carries proofread suggestions so an
    // injection would be observable (latestResult + allAnalyses + activeSubTab='run' + restored cards).
    function makeChapterAResult(): AnalysisResultDto {
      return makeResultWithSuggestions({
        id: 'r-A',
        chapterId: 'chap-A',
        sceneId: null,
        bookId: 'book-1',
      });
    }

    /** Wire the orchestration run stream to a Subject we control, and start a run on chapter A. */
    function startRunOnChapterA(): Subject<any> {
      const runStream$ = new Subject<any>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = null;
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';

      component.runAnalysis(); // prepareForRun captures runOrigin = chap-A
      // Simulate the async job starting: the overlay is dismissed and the banner takes over.
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });
      expect(component.asyncJobInFlight).toBeTrue();
      return runStream$;
    }

    it('drops the prior chapter result after a chapterId switch: no injection, banner cleared', () => {
      const runStream$ = startRunOnChapterA();

      // Snapshot chapter B state before the terminal lands.
      component.chapterId = 'chap-B';
      component.sceneId = null;
      component.ngOnChanges({
      chapterId: new SimpleChange('chap-A', 'chap-B', false),
      });
      // ngOnChanges clears the lingering banner from chapter A immediately.
      expect(component.asyncJobInFlight).toBeFalse();

      const latestBefore = component['latestResult'];
      const allBefore = component.allAnalyses;
      component.activeSubTab = 'history';

      // c01: the run's resolution reaches the host on the `runEvent` channel (the former
      // `analysisCompleted` @Output had no consumer left and was deleted). c06 superseded WHICH event
      // that is for a discarded result: the drop is decided BEFORE the fan-out now, so the host learns
      // the run ended AND that nothing came of it, instead of being handed a result the panel threw away.
      const hostEvents: any[] = [];
      component.runEvent.subscribe(e => hostEvents.push(e));

      // Chapter A's terminal arrives while the user is on chapter B.
      runStream$.next({ kind: 'job-result', result: makeChapterAResult() });

      // Not injected: latestResult/allAnalyses unchanged, sub-tab NOT forced to 'run'.
      expect(component['latestResult']).toBe(latestBefore as any);
      expect(component.allAnalyses).toBe(allBefore);
      expect(component.activeSubTab).toBe('history');
      expect(component.proofreadSuggestions.length).toBe(0);
      // Transient flags stay clear so nothing sticks on chapter B.
      expect(component.asyncJobInFlight).toBeFalse();
      expect((component as any).isRunning).toBeFalse();
      // The run still resolved for the host, so its run dialog clears instead of hanging on the dropped
      // result: exactly one terminal event crossed the boundary, and it is the DROP signal, not the
      // result (c06).
      expect(hostEvents.filter(e => e.kind === 'result-dropped').length).toBe(1);
      expect(hostEvents.filter(e => e.kind === 'job-result').length).toBe(0);
    });

    it('drops the prior scene result after a sceneId switch within the same chapter', () => {
      const runStream$ = new Subject<any>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = 'scene-1';
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      component.runAnalysis(); // runOrigin = (chap-A, scene-1)
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });

      // Switch to a DIFFERENT scene in the same chapter.
      component.sceneId = 'scene-2';
      component.ngOnChanges({
      sceneId: new SimpleChange('scene-1', 'scene-2', false),
      });
      const latestBefore = component['latestResult'];
      component.activeSubTab = 'history';

      runStream$.next({
        kind: 'job-result',
        result: makeResultWithSuggestions({ id: 'r-A', chapterId: 'chap-A', sceneId: 'scene-1' }),
      });

      expect(component['latestResult']).toBe(latestBefore as any);
      expect(component.activeSubTab).toBe('history');
      expect(component.asyncJobInFlight).toBeFalse();
    });

    it('control: a matching-context result still applies normally (no drop when the user stayed put)', () => {
      const runStream$ = new Subject<any>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = null;
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      component.documentChapterId = 'chap-A';
      component.documentSceneId = null;
      component.activeSubTab = 'history';

      component.runAnalysis(); // runOrigin = chap-A
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });

      // User stays on chapter A; the terminal for chapter A arrives.
      const result = makeResultWithSuggestions({ id: 'r-A', chapterId: 'chap-A', sceneId: null });
      runStream$.next({ kind: 'job-result', result });

      // Applied exactly as before: latestResult adopted, sub-tab forced to 'run', history rebuilt, cards shown.
      expect(component['latestResult']).toBe(result);
      expect(component.activeSubTab).toBe('run');
      expect(component.allAnalyses.some(r => r.id === 'r-A')).toBeTrue();
      expect(component.proofreadSuggestions.length).toBeGreaterThan(0);
      expect(component.asyncJobInFlight).toBeFalse();
    });
  });

  // ── c06: what the HOST is told about a result this panel discards ──────────────────────────────────
  //
  // The fan-out used to hand the raw `sync-result` / `job-result` to the host BEFORE the origin guard
  // decided to drop it. On the sync path the run dialog is in state (a) with no jobId, so that event
  // latches succeeded / 100% / "Done" - and under c02's book-scoped contract the card then survives the
  // very chapter switch that caused the drop. The user saw a green "Done" for suggestions that reached no
  // surface at all: not the panel (dropped), and not the Activity Center (a sync run is never tracked).
  //
  // The decision now precedes the fan-out, and the PAYLOAD is what changes: `{ kind: 'result-dropped' }`
  // in place of the result event. Nothing is reordered - it is still emitted from the same synchronous
  // handleRunEvent call, before onRunResultReceived touches a single field.
  //
  // Every case is driven through a Subject held OPEN across the navigation, because the whole defect
  // lives in the window between "a run is in flight" and "its result lands"; of() collapses that window
  // and passes against the bug.
  describe('c06 a discarded result is not reported to the host as a success', () => {
    /** Start a SYNC-path run on chapter A (no `job-started`, so nothing is registry-tracked). */
    function startSyncRunOnChapterA(): Subject<AnalysisRunEvent> {
      const runStream$ = new Subject<AnalysisRunEvent>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = null;
      component.documentChapterId = 'chap-A';
      component.documentSceneId = null;
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      component.activeSubTab = 'history';

      component.runAnalysis(); // prepareForRun captures runOrigin = chap-A
      return runStream$;
    }

    function chapterAResult(): AnalysisResultDto {
      return makeResultWithSuggestions({ id: 'r-A', chapterId: 'chap-A', sceneId: null });
    }

    function switchChapter(from: string, to: string): void {
      component.chapterId = to;
      component.ngOnChanges({ chapterId: new SimpleChange(from, to, false) });
    }

    it('sends result-dropped, NOT sync-result, when the chapter changed while the run was in flight', () => {
      const runStream$ = startSyncRunOnChapterA();
      const hostEvents: AnalysisRunEvent[] = [];
      component.runEvent.subscribe(e => hostEvents.push(e));

      // Precondition: genuinely mid-flight, and nothing has been reported yet.
      expect((component as any).isRunning).withContext('the run must still be open').toBeTrue();
      expect(hostEvents.length).toBe(0);

      switchChapter('chap-A', 'chap-B');

      // Chapter A's result arrives while the user is on chapter B.
      runStream$.next({ kind: 'sync-result', result: chapterAResult() });

      expect(hostEvents.filter(e => e.kind === 'sync-result').length)
        .withContext('a discarded result must NOT reach the host as a success: the run dialog latches a '
          + 'sync-result as "Done" at 100%, for suggestions this panel just threw away')
        .toBe(0);
      expect(hostEvents.filter(e => e.kind === 'result-dropped').length).toBe(1);
      // ...and it really was discarded, so there is genuinely nothing behind a "Done" card.
      expect(component.activeSubTab).toBe('history');
      expect(component.proofreadSuggestions.length).toBe(0);
    });

    it('sends the raw result when the user switched away and came BACK before it landed', () => {
      const runStream$ = startSyncRunOnChapterA();
      const hostEvents: AnalysisRunEvent[] = [];
      component.runEvent.subscribe(e => hostEvents.push(e));

      // Away, and back again, all while the single run is still open.
      switchChapter('chap-A', 'chap-B');
      switchChapter('chap-B', 'chap-A');

      const result = chapterAResult();
      runStream$.next({ kind: 'sync-result', result });

      expect(hostEvents.filter(e => e.kind === 'result-dropped').length)
        .withContext('the guard compares the run origin against the context at ARRIVAL time, not against '
          + 'wherever the user wandered in between, so this result is KEPT and must keep its terminal card')
        .toBe(0);
      expect(hostEvents.filter(e => e.kind === 'sync-result').length).toBe(1);
      // The panel applied it, which is what makes the "Done" card truthful here.
      expect(component['latestResult']).toBe(result);
      expect(component.activeSubTab).toBe('run');
      expect(component.proofreadSuggestions.length).toBeGreaterThan(0);
    });

    it('a scene switch inside the same chapter drops the same way', () => {
      const runStream$ = new Subject<AnalysisRunEvent>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = 'scene-1';
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      component.runAnalysis();

      const hostEvents: AnalysisRunEvent[] = [];
      component.runEvent.subscribe(e => hostEvents.push(e));

      component.sceneId = 'scene-2';
      component.ngOnChanges({ sceneId: new SimpleChange('scene-1', 'scene-2', false) });

      runStream$.next({
        kind: 'sync-result',
        result: makeResultWithSuggestions({ id: 'r-A', chapterId: 'chap-A', sceneId: 'scene-1' }),
      });

      expect(hostEvents.filter(e => e.kind === 'sync-result').length).toBe(0);
      expect(hostEvents.filter(e => e.kind === 'result-dropped').length).toBe(1);
    });

    it('does the same for a TRACKED run: the panel never fences state (b), the dialog does', () => {
      const runStream$ = startSyncRunOnChapterA();
      const hostEvents: AnalysisRunEvent[] = [];
      component.runEvent.subscribe(e => hostEvents.push(e));
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });
      expect(component.asyncJobInFlight).toBeTrue();

      switchChapter('chap-A', 'chap-B');
      runStream$.next({ kind: 'job-result', result: chapterAResult() });

      // The panel reports what IT did - it discarded the result - and says nothing about whether the
      // card should resolve. Keeping the `jobId === null` fence in ONE place (the dialog) is what stops
      // the two surfaces from disagreeing about what "tracked" means; pinned by "does NOT touch a
      // TRACKED card" in analysis-run-dialog.component.spec.ts.
      expect(hostEvents.filter(e => e.kind === 'result-dropped').length).toBe(1);
      expect(hostEvents.filter(e => e.kind === 'job-result').length).toBe(0);
      // The job-started event itself is untouched by c06's payload split.
      expect(hostEvents.filter(e => e.kind === 'job-started').length).toBe(1);
    });
  });

  // c01 (P2-1): pf-f01 made long runs non-blocking and the panel instance is REUSED across navigation.
  // `isRunning` is a single panel-instance flag, so before the fix a mid-run switch left the NEW chapter
  // with a disabled "Running…" Run button and no banner, and returning to the origin never restored the
  // banner. The fix gates the button label/disabled state + the run guards on `isRunningForCurrentContext`
  // (origin-scoped) and reconstructs the transient banner from a persistent `asyncBannerActiveForRun` flag.
  // Drive the run through a Subject held OPEN across the switch so the async window survives the navigation
  // (of()/throwError would collapse it synchronously and never reproduce the mid-run switch).
  describe('c01 mid-run navigation reconciles the Run button + banner to the current context', () => {
    function runButton(): HTMLButtonElement {
      return fixture.nativeElement.querySelector('.actions-row .run-btn') as HTMLButtonElement;
    }
    function bannerEl(): Element | null {
      return fixture.nativeElement.querySelector('.async-job-banner');
    }

    /** Start a Proofread async run on chapter A wired to a Subject we hold OPEN across the switch. */
    function startAsyncRunOnChapterA(): Subject<any> {
      const runStream$ = new Subject<any>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = null;
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      fixture.detectChanges();

      component.runAnalysis(); // prepareForRun captures runOrigin = chap-A, isRunning = true
      runStream$.next({ kind: 'job-started', jobId: 'job-A' }); // async banner takes over
      fixture.detectChanges();
      return runStream$;
    }

    it('gives a DIFFERENT chapter a usable Run button mid-run, then reconstructs the origin banner on return', () => {
      const runStream$ = startAsyncRunOnChapterA();

      // On the origin (chapter A) the button is the running affordance and the banner shows.
      expect(component.isRunningForCurrentContext).toBeTrue();
      expect(component.asyncJobInFlight).toBeTrue();
      expect(runButton().disabled).toBeTrue();
      expect(runButton().textContent!.trim()).toBe(component.panelLabel('running'));
      expect(bannerEl()).not.toBeNull();

      // Switch to a DIFFERENT chapter WHILE the run is still in flight (Subject still open).
      component.chapterId = 'chap-B';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-A', 'chap-B', false) });
      fixture.detectChanges();

      // The background job is NOT abandoned: still running, and its client stream is still subscribed.
      expect((component as any).isRunning).toBeTrue();
      expect(runStream$.observed).toBeTrue();
      // But chapter B has no live run of its own: button usable ("Run", enabled), no banner.
      expect(component.isRunningForCurrentContext).toBeFalse();
      expect(component.asyncJobInFlight).toBeFalse();
      expect(runButton().disabled).toBeFalse();
      expect(runButton().textContent!.trim()).toBe(component.panelLabel('run'));
      expect(bannerEl()).toBeNull();

      // Return to the still-running origin: the running affordance + banner reconstruct.
      component.chapterId = 'chap-A';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-B', 'chap-A', false) });
      fixture.detectChanges();

      expect(component.isRunningForCurrentContext).toBeTrue();
      expect(component.asyncJobInFlight).toBeTrue();
      expect(runButton().disabled).toBeTrue();
      expect(runButton().textContent!.trim()).toBe(component.panelLabel('running'));
      expect(bannerEl()).not.toBeNull();
    });

    it('reconciles on a scene switch within the same chapter (scene-precise), restoring on return', () => {
      const runStream$ = new Subject<any>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStream$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-A';
      component.sceneId = 'scene-1';
      component.selectedAnalysisType = 'Proofread';
      component.documentText = 'Hello world';
      fixture.detectChanges();

      component.runAnalysis(); // runOrigin = (chap-A, scene-1)
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });
      fixture.detectChanges();
      expect(component.isRunningForCurrentContext).toBeTrue();

      // Switch to a DIFFERENT scene in the same chapter mid-run.
      component.sceneId = 'scene-2';
      component.ngOnChanges({ sceneId: new SimpleChange('scene-1', 'scene-2', false) });
      fixture.detectChanges();

      expect((component as any).isRunning).toBeTrue();
      expect(runStream$.observed).toBeTrue();
      expect(component.isRunningForCurrentContext).toBeFalse();
      expect(component.asyncJobInFlight).toBeFalse();
      expect(runButton().disabled).toBeFalse();

      // Return to the running scene: state reconstructs.
      component.sceneId = 'scene-1';
      component.ngOnChanges({ sceneId: new SimpleChange('scene-2', 'scene-1', false) });
      fixture.detectChanges();

      expect(component.isRunningForCurrentContext).toBeTrue();
      expect(component.asyncJobInFlight).toBeTrue();
      expect(runButton().disabled).toBeTrue();
    });

    it('lets the user START a new run on a different context mid-run, without cancelling the origin job', () => {
      const runStreamA$ = startAsyncRunOnChapterA();
      // The origin job was published to the registry, so it survives via the Activity Center even after
      // its client stream is torn down by the next run.
      expect(jobRegistrySpy.track).toHaveBeenCalledWith(
        'proofread', 'book-1', 'job-A', jasmine.objectContaining({ analysisType: 'Proofread' })
      );

      // Switch to chapter B mid-run.
      component.chapterId = 'chap-B';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-A', 'chap-B', false) });
      fixture.detectChanges();

      // Rewire the orchestration to a fresh Subject for chapter B's run so we can confirm the run starts.
      const runStreamB$ = new Subject<any>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => runStreamB$.asObservable();

      component.runAnalysis(); // the guard must NOT short-circuit on chapter B

      // A new run really started for chapter B: origin re-captured to B, still running, subscribed.
      expect((component as any).runOriginChapterId).toBe('chap-B');
      expect((component as any).isRunning).toBeTrue();
      expect(runStreamB$.observed).toBeTrue();
      // Starting B's run tore down A's client stream (single runSubscription) but did not cancel A's job:
      // A stays tracked in the registry (asserted above), recoverable via loadHistory on return.
      expect(runStreamA$.observed).toBeFalse();
    });

    it('keeps a dismissed banner dismissed across a navigation round-trip (dismiss is sticky for the run)', () => {
      startAsyncRunOnChapterA();
      expect(component.asyncJobInFlight).toBeTrue();

      // User dismisses the banner while on the origin.
      component.dismissAsyncBanner();
      fixture.detectChanges();
      expect(component.asyncJobInFlight).toBeFalse();
      expect(bannerEl()).toBeNull();

      // Navigate away and back to the still-running origin: the banner must NOT reappear.
      component.chapterId = 'chap-B';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-A', 'chap-B', false) });
      fixture.detectChanges();
      component.chapterId = 'chap-A';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-B', 'chap-A', false) });
      fixture.detectChanges();

      // Still running (button shows the running affordance) but the dismissed banner stays hidden.
      expect(component.isRunningForCurrentContext).toBeTrue();
      expect(component.asyncJobInFlight).toBeFalse();
      expect(bannerEl()).toBeNull();
    });
  });

  // P3-5/P3-7: chunk thresholds are language-keyed server-side, so a bookLanguage change must re-fetch them
  // with the NEW (canonicalized) language - but the ngOnInit load already covers the FIRST change, so that
  // one must be suppressed to avoid a duplicate request. The language sent must be canonicalized (lowercase,
  // base code before any '-'/'_') so a locale-tagged value like `en-US` still matches the server's dense-vs-
  // Latin chunking bucket, and buildRunContext must send the SAME canonical value (the run must use the
  // language the server actually chunks with).
  describe('chunk-threshold language canonicalization + refetch (P3-5/P3-7)', () => {
    it('re-fires loadChunkThresholds with the NEW language on a bookLanguage change', () => {
      const svc = TestBed.inject(AnalysisService);
      const spy = spyOn(svc, 'getChunkThresholds').and.returnValue(
        of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 })
      );

      component.bookLanguage = 'en';
      component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('en');
    });

    it('suppresses the FIRST bookLanguage change so it does not double-fetch alongside the ngOnInit load', () => {
      const svc = TestBed.inject(AnalysisService);
      const spy = spyOn(svc, 'getChunkThresholds').and.returnValue(
        of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 })
      );

      component.bookLanguage = 'he';
      component.ngOnChanges({ bookLanguage: new SimpleChange(undefined, 'he', true) });

      expect(spy).not.toHaveBeenCalled();
    });

    it('canonicalizes a locale-tagged bookLanguage to its base code before sending it to getChunkThresholds', () => {
      const svc = TestBed.inject(AnalysisService);
      const spy = spyOn(svc, 'getChunkThresholds').and.returnValue(
        of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 })
      );

      component.bookLanguage = 'en-US';
      component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en-US', false) });

      expect(spy).toHaveBeenCalledWith('en');
    });

    it('keeps buildRunContext language IN SYNC with the canonicalized chunk-threshold language', () => {
      component.bookLanguage = 'He'; // mixed case, no locale suffix
      component.chapterId = 'chap-1';
      component.documentText = 'Hello world';

      const ctx = (component as any).buildRunContext();

      expect(ctx.language).toBe('he');
    });
  });
});

/**
 * tier-ux-rework fixes c04: the panel re-reads the STYLE BASELINE status when the run tab's tier toggle
 * commits a change.
 *
 * WHY THIS IS A DEFECT AND NOT A NICETY. The toggle mounts DIRECTLY ABOVE the style-baseline status row, and
 * that row's `builtWithDifferentModel` flag is computed server-side against the ACTIVE MODEL - which is
 * exactly what changing the LinguisticAnalysis tier changes. Before this wiring the cross-model staleness
 * warning (and the STALE state that carries the Refresh affordance) appeared only after a manual page reload,
 * so the user was told the baseline was fine by a row sitting under the control that had just invalidated it.
 *
 * The status GET is held OPEN across assertions rather than resolved with `of()`: the point is not merely
 * that a second fetch happens, but that it SUPERSEDES an overlapping first one instead of racing it, and a
 * synchronous stub closes the very window that ordering lives in.
 */
describe('AnalysisPanelComponent tier-change refresh (tier-ux-rework fixes c04)', () => {
  interface OpenStatusRequest {
    subject: Subject<BookStyleBaselineStatusDto>;
    /** True once the panel unsubscribed from this request, i.e. it was superseded/cancelled. */
    cancelled: boolean;
  }

  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;
  let opened: OpenStatusRequest[];

  function makeBaselineStatus(overrides: Partial<BookStyleBaselineStatusDto> = {}): BookStyleBaselineStatusDto {
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

  beforeEach(async () => {
    opened = [];
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
            explainSuggestion: () => NEVER,
            run: () => NEVER,
            startAsync: () => NEVER,
            getByJob: () => NEVER,
            runStream: () => NEVER,
            createTemplate: () => NEVER,
          },
        },
        { provide: DocumentVersionService, useValue: { list: () => of([]), create: () => NEVER, get: () => NEVER } },
        {
          provide: AnalysisRunOrchestrationService,
          useValue: {
            stopProgressPolling: () => {},
            confirmReanalysisIfPendingSuggestions: () => true,
            emitInitialStatusForRun: () => 'Running',
            formatRunDuration: () => null,
            runAnalysisAfterSave: () => EMPTY,
            doRunStreaming: () => EMPTY,
          },
        },
        {
          provide: SuggestionAnchorService,
          useValue: jasmine.createSpyObj('SuggestionAnchorService', { relocateAll: [], relocateOne: null }),
        },
        {
          provide: StyleBaselineService,
          useValue: {
            // Each call hands back its OWN long-lived stream, so "which request is still subscribed" is an
            // observable fact rather than something inferred from a call count.
            getStyleBaselineStatus: () => {
              const entry: OpenStatusRequest = {
                subject: new Subject<BookStyleBaselineStatusDto>(),
                cancelled: false,
              };
              opened.push(entry);
              return new Observable<BookStyleBaselineStatusDto>((sub) => {
                const inner = entry.subject.subscribe(sub);
                return () => {
                  entry.cancelled = true;
                  inner.unsubscribe();
                };
              });
            },
            buildStyleBaseline: () => NEVER,
          },
        },
        {
          provide: AnalysisProgressService,
          useValue: { pollProgress: () => NEVER, pollStyleBaselineProgress: () => NEVER },
        },
        {
          provide: JobRegistryService,
          // `jobById$` feeds the in-panel progress bar inside the async banner (Wave 1d c2).
          useValue: jasmine.createSpyObj<JobRegistryService>('JobRegistryService', {
            track: undefined,
            jobById$: of(null),
          }),
        },
        {
          provide: AiTierService,
          useValue: {
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

    fixture = TestBed.createComponent(AnalysisPanelComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
    component.bookLanguage = 'he';
    component.selectedAnalysisType = 'LinguisticAnalysis';
    fixture.detectChanges();
  });

  /** The hosted run tab, i.e. the component the toggle's event actually travels through. */
  function runTab(): AnalysisRunTabComponent {
    const found = fixture.debugElement.query(By.directive(AnalysisRunTabComponent));
    expect(found).withContext('the run tab must be mounted for this wiring to exist').not.toBeNull();
    return found.componentInstance as AnalysisRunTabComponent;
  }

  it('(e) re-reads the style-baseline status when the run tab reports a tier change', () => {
    const before = opened.length;

    runTab().tierChanged.emit();

    expect(opened.length).withContext('exactly one re-read, not zero and not two').toBe(before + 1);

    opened[opened.length - 1].subject.next(makeBaselineStatus({ builtWithDifferentModel: true }));
    fixture.detectChanges();

    expect(component.styleBaselineStatus?.builtWithDifferentModel)
      .withContext('the newly-active model made the baseline cross-model')
      .toBeTrue();
  });

  it('(e) the tier-change re-read SUPERSEDES an in-flight status read instead of racing it', () => {
    // A status read is already in flight (the panel loads one on a context change; this is that window).
    component.loadStyleBaselineStatus();
    const inFlight = opened[opened.length - 1];
    expect(inFlight.cancelled).withContext('precondition: still open').toBeFalse();

    runTab().tierChanged.emit();
    const fresh = opened[opened.length - 1];

    expect(fresh).withContext('a NEW request, not a reuse').not.toBe(inFlight);
    expect(inFlight.cancelled)
      .withContext('the older request must be cancelled, not left to answer over the newer one')
      .toBeTrue();

    // Even if the abandoned request somehow answers, its stale snapshot must not paint.
    inFlight.subject.next(makeBaselineStatus({ builtWithDifferentModel: false }));
    fresh.subject.next(makeBaselineStatus({ builtWithDifferentModel: true }));
    fixture.detectChanges();

    expect(component.styleBaselineStatus?.builtWithDifferentModel)
      .withContext('the newer answer wins')
      .toBeTrue();
  });

  it('renders the cross-model warning under the toggle once the re-read lands, with no page reload', () => {
    runTab().tierChanged.emit();
    opened[opened.length - 1].subject.next(makeBaselineStatus({ builtWithDifferentModel: true }));
    fixture.detectChanges();

    const warning = fixture.debugElement.query(By.css('[data-testid="sb-cross-model-warning"]'));
    expect(warning).withContext('the warning row the whole todo exists for').not.toBeNull();
  });
});

