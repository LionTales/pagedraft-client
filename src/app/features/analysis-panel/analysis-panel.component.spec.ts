import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, SimpleChange } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, EMPTY, NEVER, Observable, ReplaySubject, Subject, firstValueFrom, of, throwError, takeUntil } from 'rxjs';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { AnalysisService } from '../../core/services/analysis.service';
import {
  ActiveRunContext,
  AnalysisRunOrchestrationService,
  AnalysisRunEvent,
  RunTerminalScope,
  UnheardRunTerminal,
} from '../../core/services/analysis-run-orchestration.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto } from '../../core/models/analysis';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { CHAPTER_SCOPED_KINDS, JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import { AiTierService } from '../../core/services/ai-tier.service';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';
import { runString } from '../../core/i18n/run-strings';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { SHOW_POINTER_STRINGS_EN, SHOW_POINTER_STRINGS_HE } from '../../core/i18n/show-pointer-strings';

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

/** The shape `startRun` needs off a run context; the stub never reads more than this. */
interface AnalysisRunContextLike {
  bookId: string;
  chapterId: string;
  sceneId: string | null;
  selectedAnalysisType: string;
}

/** The orchestration stub's own surface, so `startRun` can reach its (re-stubbed) siblings. */
interface OrchestrationStub {
  runAnalysisAfterSave(ctx: AnalysisRunContextLike, save?: () => Promise<void>): Observable<AnalysisRunEvent>;
  __runSub?: { unsubscribe(): void };
}

/** Monotonic run ids for the stub, so two runs in one spec are distinguishable. */
let stubRunSeq = 0;

/**
 * c06: the terminal the orchestration service is holding because NO surface heard it.
 *
 * The service records one when an owned run ends in an error with nobody subscribed - a run superseded by
 * a start on another chapter, a 500, the start-budget expiry - and hands it to the next surface for that
 * unit. A spec sets this and mounts a panel to stand in the position of the instance that comes back.
 * The stub below models the real contract: SCOPED to the unit, and SINGLE-SHOT (the read clears it).
 */
let pendingUnheardTerminal: UnheardRunTerminal | null = null;

function takeUnheardStub(scope: RunTerminalScope): UnheardRunTerminal | null {
  const pending = pendingUnheardTerminal;
  if (!pending
    || pending.bookId !== scope.bookId
    || pending.chapterId !== scope.chapterId
    || pending.sceneId !== (scope.sceneId ?? null)
    || pending.analysisType !== scope.analysisType) {
    return null;
  }
  pendingUnheardTerminal = null;
  return pending;
}

describe('AnalysisPanelComponent (focused logic)', () => {
  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;
  // rf-c02: the run tab publishes its style-baseline build to the registry on start. Spy so we can assert
  // track() and so the real (root) registry (with its transitive deps) is not pulled into this TestBed.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;
  /** a1: the registry's job list, so a spec can drive the panel's derived "a run is in flight" state. */
  let registryJobs: BehaviorSubject<TrackedJob[]>;
  /** a1: the orchestration service's owned run, same purpose for the SYNC half. */
  let ownedRun: BehaviorSubject<ActiveRunContext | null>;

  beforeEach(async () => {
    // `jobById$` is read by the in-panel progress bar (app-job-progress-inline) inside the async banner.
    // Without it on the stub, every async-banner test dies with a TypeError from that grandchild.
    // a1: `jobs$` is a PROPERTY, not a method - the panel derives "is a run in flight for this context?"
    // from it - so it goes in createSpyObj's third (property) argument. `registryJobs` is the handle a
    // spec pushes through to drive that derivation.
    registryJobs = new BehaviorSubject<TrackedJob[]>([]);
    ownedRun = new BehaviorSubject<ActiveRunContext | null>(null);
    // c06: module-level, so it has to be reset or one spec's pending notice paints another's panel.
    pendingUnheardTerminal = null;
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>(
      'JobRegistryService',
      ['track', 'jobById$'],
      { jobs$: registryJobs.asObservable() },
    );
    jobRegistrySpy.jobById$.and.returnValue(of(null));
    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => of({ explanation: 'because' }),
            run: () => of({} as AnalysisResultDto),
            startAsync: () => of({ jobId: 'job-1', analysisType: 'Proofread', scope: 'Chapter' }),
            getByJob: () => of({} as AnalysisResultDto),
            runStream: () => of(''),
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
          // a1: `startRun` is what the panel calls now, and the stub DELEGATES to `runAnalysisAfterSave`
          // so the specs that swap that method in to drive a run keep working unchanged. f13 (2026-08-19)
          // recounted in the current tree: `runAnalysisAfterSave` is assigned 14 times total across this
          // spec file - 3 are provider defaults (here, and the two other `TestBed.configureTestingModule`
          // blocks below), the other 11 are reassignments (`orch.runAnalysisAfterSave = ...`, some in a
          // single `it`, some in a `describe`'s shared `beforeEach` reaching every `it` under it) that
          // swap this default out to drive a specific run. `activeRun$`
          // / `activeRun` are the service's published description of the run it owns; the stub keeps them
          // inert by default and a spec drives them through `ownedRun` when that is what it is testing.
          useValue: {
            confirmReanalysisIfPendingSuggestions: () => true,
            emitInitialStatusForRun: () => 'Running…',
            formatRunDuration: () => null,
            runAnalysisAfterSave: () => EMPTY,
            doRunStreaming: () => EMPTY,
            // c06: the panel asks this on every run-state derivation, so it is required on every stub.
            takeUnheardRunTerminal: takeUnheardStub,
            activeRun$: ownedRun.asObservable(),
            get activeRun() { return ownedRun.value; },
            /**
             * a1: models the REAL contract, not a pass-through - the two properties that matter to the
             * panel are that the service subscribes the run ITSELF (so the caller unsubscribing does not
             * cancel it) and that it publishes a description of the run while it is in flight. A stub
             * that merely handed the cold stream back would let an unmount spec pass against the very
             * cancellation this todo removed.
             */
            startRun(ctx: AnalysisRunContextLike, save?: () => Promise<void>) {
              const self = this as unknown as OrchestrationStub;
              const events = new ReplaySubject<AnalysisRunEvent>(64);
              ownedRun.next({
                runId: `stub-run-${++stubRunSeq}`,
                bookId: ctx.bookId,
                chapterId: ctx.chapterId,
                sceneId: ctx.sceneId ?? null,
                analysisType: ctx.selectedAnalysisType,
                jobId: null,
              });
              const end = () => {
                if (ownedRun.value) ownedRun.next(null);
                events.complete();
              };
              self.__runSub?.unsubscribe();
              self.__runSub = self.runAnalysisAfterSave(ctx, save).subscribe({
                next: (event: AnalysisRunEvent) => {
                  if (event.kind === 'job-started' && ownedRun.value) {
                    ownedRun.next({ ...ownedRun.value, jobId: event.jobId });
                  }
                  events.next(event);
                },
                error: end,
                complete: end,
              });
              return events.asObservable();
            },
          } as OrchestrationStub,
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

  // ─── c07: SUPERSESSION - two reads for the SAME key must not race ──
  //
  // The Bug 1 specs above cover the other question (a read whose key the reader has left). These cover
  // the one a context-CHANGE guard cannot see: two reads for the SAME (chapter, scene) that both pass
  // that guard, resolving out of order, so the slower OLDER answer overwrites `allAnalyses` with a
  // snapshot taken before the just-finished run's row existed.
  //
  // THE INSTRUMENT IS THE SUBJECT'S SUBSCRIBER COUNT, not the rendered result: a stub whose first read
  // simply never completes stays subscribed and greens any result-only assertion, so each spec asserts
  // both that a second request was really ISSUED (`calls`) and that issuing it CANCELLED the first
  // (`observed`).

  /** Hand each `getHistory` call its own Subject, and keep the handles + the call count. */
  function stubHistorySubjects(): { subjects: Subject<AnalysisResultDto[]>[]; calls: () => number } {
    const subjects: Subject<AnalysisResultDto[]>[] = [];
    const svc = TestBed.inject(AnalysisService) as any;
    svc.getHistory = () => {
      const s = new Subject<AnalysisResultDto[]>();
      subjects.push(s);
      return s.asObservable();
    };
    return { subjects, calls: () => subjects.length };
  }

  it('c07: two loadHistory reads for the SAME key - the OLDER answer arriving LAST does not win', () => {
    const { subjects, calls } = stubHistorySubjects();

    component.chapterId = 'chap-1';
    (component as any).loadHistory(true); // read A
    (component as any).loadHistory(true); // read B, same (chapter, scene)

    // A second request was really made, and issuing it cancelled the first.
    expect(calls()).toBe(2);
    expect(subjects[0].observed).toBeFalse();
    expect(subjects[1].observed).toBeTrue();

    // Out of order: the NEWER read answers first, the older one lands after it.
    subjects[1].next([makeResultWithSuggestions({ id: 'newer' })]);
    subjects[0].next([makeResultWithSuggestions({ id: 'older' })]);

    expect(component.allAnalyses.map(r => r.id)).toEqual(['newer']);
  });

  it('c07: the latch is DOWN on every path - a superseded read cannot strand proofreadFinalizing or write late', () => {
    const { subjects, calls } = stubHistorySubjects();

    component.chapterId = 'chap-1';
    component.proofreadFinalizing = true;
    (component as any).loadHistory(true); // read A - the read the finalizing window is waiting on
    (component as any).loadHistory(true); // read B supersedes A, destroying A's handlers

    expect(calls()).toBe(2);
    expect(subjects[0].observed).toBeFalse();
    // The cancel itself neither lowers the latch nor strands it: it hands it to the read that cancelled.
    expect(component.proofreadFinalizing).toBeTrue();

    // B's ERROR arm is one of the two places the latch comes down, and it runs after the stale check.
    subjects[1].error(new Error('history unavailable'));
    expect(component.proofreadFinalizing).toBeFalse();
    expect(component['proofreadFinalizeRetriesLeft']).toBe(0);

    // A is gone: its late SUCCESS reaches nothing.
    subjects[0].next([makeResultWithSuggestions({ id: 'older' })]);
    expect(component.allAnalyses).toEqual([]);
    expect(component.proofreadFinalizing).toBeFalse();
  });

  it('c07: superseding a read mid-retry-chain CONTINUES the chain rather than killing it', fakeAsync(() => {
    const { subjects, calls } = stubHistorySubjects();

    // A finalizing streaming Proofread: a synthetic latestResult (no id) whose persisted row has not
    // replicated yet, with one retry left in the budget.
    component.chapterId = 'chap-1';
    component.selectedAnalysisType = 'Proofread';
    component.latestResult = { ...makeResultWithSuggestions(), id: undefined as any };
    component.proofreadFinalizing = true;
    component['proofreadFinalizeRetriesLeft'] = 1;

    (component as any).loadHistory(true); // read A
    (component as any).loadHistory(true); // read B supersedes A

    expect(calls()).toBe(2);
    expect(subjects[0].observed).toBeFalse();

    // B answers without the run's row, so the window must RETRY - the supersession did not lose the
    // budget, and the read that cancelled A re-entered the same retry logic.
    subjects[1].next([]);
    expect(component.proofreadFinalizing).toBeTrue();
    expect(component['proofreadFinalizeRetriesLeft']).toBe(0);

    tick(600);
    expect(calls()).toBe(3); // the retry timer really re-issued the read

    // The retry's own answer exhausts the budget and resolves the window: the latch is down.
    subjects[2].next([]);
    expect(component.proofreadFinalizing).toBeFalse();
    expect(component['proofreadFinalizeRetryTimer']).toBeNull();
  }));

  it('c07: loadVersions supersedes too - the OLDER version list arriving LAST does not win', () => {
    const subjects: Subject<any[]>[] = [];
    const versionsService = TestBed.inject(DocumentVersionService) as any;
    versionsService.list = () => {
      const s = new Subject<any[]>();
      subjects.push(s);
      return s.asObservable();
    };

    component.chapterId = 'chap-1';
    component.loadVersions(); // read A
    component.loadVersions(); // read B, same key

    expect(subjects.length).toBe(2);
    expect(subjects[0].observed).toBeFalse();

    subjects[1].next([{ id: 'v-newer', bookId: 'book-1', chapterId: 'chap-1', createdAt: new Date().toISOString() }]);
    subjects[0].next([{ id: 'v-older', bookId: 'book-1', chapterId: 'chap-1', createdAt: new Date().toISOString() }]);

    expect(component.versions.map(v => v.id)).toEqual(['v-newer']);
  });

  it('c07: a loadVersions answer for a chapter the reader has LEFT writes nothing (neither arm)', () => {
    const subjects: Subject<any[]>[] = [];
    const versionsService = TestBed.inject(DocumentVersionService) as any;
    versionsService.list = () => {
      const s = new Subject<any[]>();
      subjects.push(s);
      return s.asObservable();
    };

    component.chapterId = 'chap-1';
    component.loadVersions();
    component.chapterId = 'chap-2';
    component.versions = [{ id: 'v-chap-2' } as any];

    subjects[0].next([{ id: 'v-chap-1', bookId: 'book-1', chapterId: 'chap-1', createdAt: new Date().toISOString() }]);
    expect(component.versions.map(v => v.id)).toEqual(['v-chap-2']);

    // And the error arm, which used to blank the list of whatever chapter was on screen.
    component.chapterId = 'chap-1';
    component.loadVersions();
    component.chapterId = 'chap-3';
    component.versions = [{ id: 'v-chap-3' } as any];
    subjects[1].error(new Error('late failure'));
    expect(component.versions.map(v => v.id)).toEqual(['v-chap-3']);
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
  // Wave 3 / w5 (MOVE-1 + MOVE-2). `describe('style baseline reattach (DEF-2)')` LIVED HERE and covered a
  // build this panel no longer owns: the build POST, its progress poll, its registry track() and its
  // DEF-2 reattach all moved to `BookStyleBaselineStatusRowComponent` on the book dashboard, and that
  // coverage moved WITH them (see `book-style-baseline-status-row.component.spec.ts`) rather than being
  // deleted. What this panel must still be pinned on is the OPPOSITE property: that it only READS.
  describe('w5: the writing-style build is gone from this per-chapter panel; only the status read remains', () => {
    function baselineStatus(overrides: Partial<BookStyleBaselineStatusDto> = {}): BookStyleBaselineStatusDto {
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

    it('still reads the status, because the Linguistic result pointer needs to know it is missing/stale', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const getSpy = spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(of(baselineStatus()));

      component.loadStyleBaselineStatus();

      expect(getSpy).toHaveBeenCalledWith('book-1', 'he');
      expect(component.styleBaselineStatus).not.toBeNull();
    });

    it('does NOT reattach to (or track) an in-flight build reported by the status read', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(
        of(baselineStatus({ activeBuildJobId: 'job-running' }))
      );
      const pollSpy = spyOn(progressSvc, 'pollStyleBaselineProgress').and.returnValue(NEVER);

      component.loadStyleBaselineStatus();

      // The dashboard row owns the reattach: it is the only surface that can also show the progress.
      expect(pollSpy).not.toHaveBeenCalled();
      expect(jobRegistrySpy.track).not.toHaveBeenCalledWith('style-baseline', 'book-1', 'job-running');
    });

    it('exposes no build entry point at all (a book-wide build must not start from a chapter surface)', () => {
      expect((component as any).onBuildStyleBaseline).toBeUndefined();
      expect((component as any).pollStyleBaselineBuild).toBeUndefined();
      expect((component as any).styleBaselineBuilding).toBeUndefined();
    });

    // wave3-spine-fixes f05: `loadStyleBaselineStatus()` used to sit in an ngOnChanges branch keyed on
    // `changes['bookId'] || changes['chapterId'] || changes['sceneId']`, so a same-book chapter switch
    // re-fired it even though the book-wide baseline it reads cannot have changed - measured live as one
    // of three style-baseline GETs firing before any interaction. Pinning the fix at the READ boundary
    // (bookId is already set from the outer beforeEach) rather than the network layer.
    it('does NOT re-read the style baseline status on a chapterId-only change (same book, same language)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const getSpy = spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(of(baselineStatus()));

      component.chapterId = 'chap-2';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });

      expect(getSpy).not.toHaveBeenCalled();
    });

    it('does NOT re-read the style baseline status on a sceneId-only change (same book, same language)', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const getSpy = spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(of(baselineStatus()));

      component.sceneId = 'scene-2';
      component.ngOnChanges({ sceneId: new SimpleChange('scene-1', 'scene-2', false) });

      expect(getSpy).not.toHaveBeenCalled();
    });

    it('DOES re-read the style baseline status on a real bookId change', () => {
      const styleSvc = TestBed.inject(StyleBaselineService);
      const getSpy = spyOn(styleSvc, 'getStyleBaselineStatus').and.returnValue(of(baselineStatus()));

      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });

      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith('book-2', 'he');
    });
  });

  // c06: the other half of "a terminal nobody heard". This panel instance SURVIVES navigation, so the
  // surface that comes back to the abandoned run's chapter is often this same instance rather than a
  // fresh one - which is the case for finding 7, where the author started a run on chapter B and the
  // chapter A run they left behind was cancelled with no message anywhere.
  describe('c06 a pending run terminal is claimed by the unit it belongs to', () => {
    const message = 'הרצה קודמת הופסקה';

    it('leaves a terminal for ANOTHER chapter alone, and shows it when the reader returns to that chapter', () => {
      pendingUnheardTerminal = {
        runId: 'run-3',
        bookId: 'book-1',
        chapterId: 'chap-2',
        sceneId: null,
        analysisType: 'Proofread',
        message,
      };

      // Still on chapter 1. A registry emission re-derives run state, which is where the claim is made,
      // so this is a real attempt to claim it and not merely an absence of one.
      registryJobs.next([]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.run-error'))
        .withContext('chapter A\'s failure must not appear over chapter B')
        .toBeNull();

      component.chapterId = 'chap-2';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('.run-error') as HTMLElement | null;
      expect(banner)
        .withContext('coming back to the chapter is the moment the author can be told what happened to it')
        .not.toBeNull();
      expect(banner!.textContent!.trim()).toBe(message);
    });

    it('takes the failure banner off the chapter it was raised on when the reader leaves it', () => {
      component.runError = 'הניתוח נכשל.';
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.run-error')).not.toBeNull();

      component.chapterId = 'chap-2';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.run-error'))
        .withContext('the banner is scoped to a unit like the suggestions and the history beside it; a '
          + 'notice that follows the reader to the next chapter describes nothing on screen')
        .toBeNull();
    });

    // final-r01: the THIRD state, between c06's two. This instance keeps its run subscription across a
    // chapter switch (a1, on purpose), so a failure can be HEARD by a surface that has already moved on.
    // The service correctly holds nothing for it - a subscriber existed - and the panel used to write
    // `runError` unconditionally, so the failure appeared under the wrong chapter and c06's own reset
    // then wiped it, leaving the origin chapter permanently silent about its own run.
    it('does NOT banner a failure whose run started on a chapter the reader has since left', () => {
      component.runAnalysis();
      expect((component as any).runOriginChapterId)
        .withContext('precondition: the run captured chapter 1 as its origin')
        .toBe('chap-1');

      component.chapterId = 'chap-2';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });
      fixture.detectChanges();

      (component as any).handleRunEvent({ kind: 'error', message: 'הניתוח נכשל.' });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.run-error'))
        .withContext('chapter 1\'s failure is not news about chapter 2, and saying it here is the same '
          + 'misattribution the origin check on the SUCCESS path already prevents')
        .toBeNull();
    });

    it('shows that same failure when the reader returns to the chapter the run started on', () => {
      component.runAnalysis();
      component.chapterId = 'chap-2';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });
      (component as any).handleRunEvent({ kind: 'error', message: 'הניתוח נכשל.' });
      fixture.detectChanges();

      component.chapterId = 'chap-1';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-2', 'chap-1', false) });
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('.run-error') as HTMLElement | null;
      expect(banner)
        .withContext('dropping it instead would be strictly worse than the misattribution it replaces: '
          + 'before c06 the banner at least survived until the reader wandered back')
        .not.toBeNull();
      expect(banner!.textContent!.trim()).toBe('הניתוח נכשל.');

      // Single-shot, like the service's slot: leaving and returning a second time must not re-raise it.
      component.chapterId = 'chap-2';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-1', 'chap-2', false) });
      component.chapterId = 'chap-1';
      component.ngOnChanges({ chapterId: new SimpleChange('chap-2', 'chap-1', false) });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.run-error'))
        .withContext('one failure, reported once')
        .toBeNull();
    });

    it('still banners immediately when the run\'s origin IS the unit on screen (the ordinary path)', () => {
      component.runAnalysis();
      fixture.detectChanges();

      (component as any).handleRunEvent({ kind: 'error', message: 'הניתוח נכשל.' });
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('.run-error') as HTMLElement | null;
      expect(banner).withContext('the common case must not have been deferred by the fix').not.toBeNull();
      expect(banner!.textContent!.trim()).toBe('הניתוח נכשל.');
    });
  });

  // Bug 1 (rf-c01): starting an async chapter Proofread/Line Edit run must publish the job to the
  // registry on job-started, so the Activity Center and the per-chapter running marks pick it up for
  // THIS run and not only after a reload reattaches to it.
  //
  // c01 (registry-write-survives-unmount): that publish MOVED off this component. It is performed by
  // `AnalysisRunOrchestrationService.publishJobToRegistry`, from the same `startRun` subscription that
  // owns the run, because this panel is `@if`-mounted and a dispatch POST that answers after an
  // Edit-help tab switch reached the old call site on a destroyed component - so the job was published
  // nowhere at all. The whole describe that used to sit here (the analysisType variants, the scene
  // scope label, the no-bookId decline and its warn, and the "keys the tracked job off the run ORIGIN"
  // case) moved WITH the code, to `analysis-run-orchestration.service.spec.ts`. Asserting it here now
  // would only be asserting the fidelity of this suite's orchestration STUB.
  //
  // What stays in this file is the panel's own half of `job-started` (the in-page banner state below)
  // and the end-to-end unmount case that proves the write survives this component, which needs the REAL
  // service and the REAL registry and therefore has its own TestBed at the bottom of this file.

  // pf-f01: async non-blocking overlay and in-panel compact banner.
  describe('pf-f01 async job non-blocking overlay', () => {
    // c01: these two used to assert the `asyncJobStarted` @Output, which lost its last consumer when the
    // blocking overlay was deleted and has now been deleted with it. Their INTENT was the async handoff -
    // the job becomes visible exactly once, and the no-bookId guard skips the whole handoff - so they are
    // re-pointed at what actually performs it: the in-panel banner state, plus (registry-write-survives-
    // unmount) the id it mirrors. The PUBLISH half of the handoff is the orchestration service's now;
    // its own spec pins it, and the unmount case at the bottom of this file pins that the two halves
    // still describe the same job after this component is gone.
    it('mirrors the started job id exactly once on job-started and raises the in-panel banner for it', () => {
      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-1' });

      // The banner mirrors the id the service published, so it can never point at a different job.
      expect((component as any).currentRunJobId).toBe('async-1');
      expect(component.asyncJobInFlight).toBeTrue();
      expect((component as any).asyncBannerActiveForRun).toBeTrue();
    });

    it('does NOT raise the banner when there is no bookId', () => {
      component.bookId = null;
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';

      (component as any).handleRunEvent({ kind: 'job-started', jobId: 'async-x' });

      // The service declines to publish on this same missing value, so the banner must not claim a job
      // that no surface can render: `app-job-progress-inline` resolves `currentRunJobId` through
      // `jobById$`, and there is no row for it.
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

    // ── final-r01: the PRODUCTION-SOURCE half of the c02 "a sync run is on none of the three
    //    surfaces" decision ────────────────────────────────────────────────────────────────────────
    //
    // `three-surface-parity.spec.ts` pins the RENDERED consequence of that decision, but its host is a
    // synthetic fixture that drives JobRegistryService itself. MEASURED during the closing review:
    // adding a client-minted synthetic `track()` to `runAnalysis()` - the exact change the decision
    // forbids - left the whole suite green, so nothing anywhere actually guarded it.
    //
    // c01: the `track()` call site itself is now the orchestration service's, and the "a sync run is
    // never tracked" half moved there with it. What is still guarded HERE is the change's most natural
    // LOCATION: `runAnalysis()`, where a synthetic id would be minted at run start, before any event
    // exists. This panel must reach the registry from nowhere at all.
    it('c02: this panel never writes the registry for a run, least of all at run START', () => {
      const run$ = new Subject<AnalysisRunEvent>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.runAnalysisAfterSave = () => run$.asObservable();

      component.bookId = 'book-1';
      component.chapterId = 'chap-1';
      component.selectedAnalysisType = 'Proofread';
      jobRegistrySpy.track.calls.reset();

      // The REAL entry point, not handleRunEvent: a synthetic id would most naturally be minted at run
      // start, before any event exists, and that is precisely where handleRunEvent cannot see it.
      component.runAnalysis();
      expect(jobRegistrySpy.track)
        .withContext('a run has no id to track at start; minting one here is the change c02 rejected')
        .not.toHaveBeenCalled();

      // The whole sync lifecycle: the client-composed opener, then the blocking call returning.
      run$.next({ kind: 'status', message: 'running' });
      run$.next({ kind: 'sync-result', result: { id: 'r-1', chapterId: 'chap-1', type: 'Proofread', analysisType: 'Proofread', resultText: 'ok', createdAt: new Date().toISOString() } as AnalysisResultDto });
      run$.complete();

      expect(jobRegistrySpy.track)
        .withContext('a sync run persists with a NULL JobId, cannot be reattached, and dies with this '
          + 'panel: a registry row would promise durability it does not have')
        .not.toHaveBeenCalled();
      expect((component as any).currentRunJobId)
        .withContext('and the in-page indicator must have nothing to point at either')
        .toBeNull();
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

    // a1 INVERTED THE TWO CASES BELOW, and the inversion is the point of the todo. `run-finished` said
    // "the run is over with nothing to report", and the dialog reads it as `canceled`. That was TRUE only
    // because destroying the panel cancelled the run. `AnalysisRunOrchestrationService.startRun` owns the
    // subscription now, so the run survives the unmount and the terminal would be a lie.
    it('does NOT emit run-finished when a SERVICE-OWNED run is unmounted mid-flight: it is still running', () => {
      panel.runAnalysis();
      runStream$.next({ kind: 'status', message: 'Running Proofread analysis...' });
      hostFixture.detectChanges();

      expect((panel as any).isRunning).toBeTrue();
      expect(host.events.some(e => e.kind === 'run-finished')).toBeFalse();

      // The user switches the Edit-help sub-tab: the `@if` destroys the panel.
      host.mounted = false;
      hostFixture.detectChanges();

      expect(hostFixture.debugElement.query(By.directive(AnalysisPanelComponent))).toBeNull();
      // No terminal, because there IS no terminal: reporting one would put a "Canceled" card over a run
      // the server is still working on, which is exactly the bug this todo removes.
      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(0);
      // And the run really did survive: the service is still subscribed to it.
      expect(runStream$.observed).toBeTrue();
    });

    it('does NOT emit run-finished on unmount for a TRACKED run either (the registry owns it)', () => {
      panel.runAnalysis();
      runStream$.next({ kind: 'job-started', jobId: 'job-A' });
      hostFixture.detectChanges();
      expect(panel.asyncJobInFlight).toBeTrue();

      host.mounted = false;
      hostFixture.detectChanges();

      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(0);
      expect(runStream$.observed).toBeTrue();
    });

    it('STILL emits run-finished for a PANEL-owned run (the streaming path), which an unmount does cancel', () => {
      // `runStreaming` subscribes `doRunStreaming` directly - the service owns nothing - so this panel's
      // subscription really is the only thing holding that run open. The c01 protection is kept exactly
      // for this branch rather than deleted wholesale, and a future panel-owned call site inherits it.
      const streamEvents$ = new Subject<AnalysisRunEvent>();
      const orch = TestBed.inject(AnalysisRunOrchestrationService) as any;
      orch.doRunStreaming = () => streamEvents$.asObservable();

      panel.runStreaming();
      streamEvents$.next({ kind: 'streaming-token', token: 'x' });
      hostFixture.detectChanges();
      expect((panel as any).isRunning).toBeTrue();

      host.mounted = false;
      hostFixture.detectChanges();

      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(1);
      expect(streamEvents$.observed).toBeFalse();
    });

    it('bug 1: a run that ANSWERS while the panel is unmounted lands on the instance that remounts', () => {
      // The other half of the inversion above, and the todo's bug 1 end to end. Not derivable from the
      // "does not emit run-finished" cases: those prove the run survived the unmount, this proves its
      // result reaches the user - through a BRAND NEW instance whose own fields know nothing about it.
      //
      // finding 60: the RESULT is made to depend on the run having survived, which it did not used to.
      // The spec re-stubbed `getHistory` to hand the finished row to anyone who asked, so the remount's
      // ordinary `ngOnChanges -> loadHistory()` produced it whether or not the unmount had cancelled the
      // request - i.e. the assertion named for bug 1 passed against bug 1. The server here answers ONLY
      // while the request is still open, and persists the row on the same condition, which is what an
      // aborted request really means: the run this panel started produced nothing, and there is nothing
      // for the remount to find. `runStream$.observed` is therefore both the precondition and the thing
      // that makes the final assertion discriminate.
      const analysis = TestBed.inject(AnalysisService) as any;
      const finished = {
        id: 'res-late', chapterId: 'chap-1', type: 'Proofread', analysisType: 'Proofread',
        resultText: 'fixed while you were away', createdAt: '2026-08-18T02:00:00.000Z', status: 'Active',
      } as AnalysisResultDto;

      // The "server": whatever it has persisted so far, which is nothing until a live request answers.
      let persisted: AnalysisResultDto[] = [];
      analysis.getHistory = () => of(persisted.slice());
      const serverAnswers = () => {
        // An ABORTED request is not answered and writes no row. Cancelling the run is what the panel's
        // ngOnDestroy used to do, so this is the one branch the pre-a1 code took.
        if (!runStream$.observed) return;
        persisted = [finished];
        runStream$.next({ kind: 'sync-result', result: finished });
      };

      panel.runAnalysis();
      runStream$.next({ kind: 'status', message: 'Running Proofread analysis...' });
      hostFixture.detectChanges();

      // The Edit-help sub-tab switch destroys the panel mid-run.
      host.mounted = false;
      hostFixture.detectChanges();
      expect(runStream$.observed)
        .withContext('precondition: before a1 the unmount cancelled this request, so there was no result to land')
        .toBeTrue();

      // The server answers with NO panel on screen at all.
      serverAnswers();
      runStream$.complete();

      // The user comes back to the Analysis sub-tab.
      host.mounted = true;
      hostFixture.detectChanges();
      const remounted = hostFixture.debugElement.query(By.directive(AnalysisPanelComponent))
        .componentInstance as AnalysisPanelComponent;

      expect(remounted).not.toBe(panel);
      expect(remounted.latestResult?.id)
        .withContext('the finished result is on screen for an instance that never started the run - and it '
          + 'exists at all only because the unmount did not cancel the request that produced it')
        .toBe('res-late');
    });

    it('does NOT emit run-finished when the panel is destroyed with no run in flight', () => {
      // No run was started, so there is nothing to report and nothing to resolve.
      host.mounted = false;
      hostFixture.detectChanges();

      expect(host.events.filter(e => e.kind === 'run-finished').length).toBe(0);
    });
  });

  // ── a1: run state that outlives the instance ─────────────────────────────────────────────────────
  //
  // The panel is destroyed on every Edit-help tab switch while the run keeps going, so a FRESH instance
  // has to answer two questions with no help from its own fields: "is a run in flight for what I am
  // showing?" (the analyze button - bug 2) and "did one just finish?" (the result - bug 1). Both are
  // answered off the two owners that survive an unmount, and both are driven here through those owners.
  describe('a1 the registry and the owned run answer for an instance that was not there', () => {
    let host: PanelUnmountHostComponent;
    let hostFixture: ComponentFixture<PanelUnmountHostComponent>;

    /** A tracked chapter-analysis job for the host's own (book-1, chap-1, no scene, Proofread) unit. */
    function proofreadJob(status: TrackedJob['status'], id = 'job-A'): TrackedJob {
      return {
        id,
        kind: 'proofread',
        bookId: 'book-1',
        chapterId: 'chap-1',
        analysisType: 'Proofread',
        scopeLabel: 'פרק',
        titleHe: 'הגהה',
        titleEn: 'Proofreading',
        status,
        percent: status === 'succeeded' ? 100 : 40,
        completedChunks: null,
        totalChunks: null,
        chunkClock: EMPTY_CHUNK_CLOCK,
        message: '',
        startedAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      };
    }

    function mountHost(): AnalysisPanelComponent {
      hostFixture = TestBed.createComponent(PanelUnmountHostComponent);
      host = hostFixture.componentInstance;
      hostFixture.detectChanges();
      return hostFixture.debugElement.query(By.directive(AnalysisPanelComponent))
        .componentInstance as AnalysisPanelComponent;
    }

    function runButton(): HTMLButtonElement {
      return hostFixture.nativeElement.querySelector('.actions-row .run-btn') as HTMLButtonElement;
    }

    beforeEach(() => {
      // The file-level `fixture` mounts a SECOND panel against the same service stubs and the same
      // registry stream, so it answers this describe's registry pushes too - and doubles every history
      // read counted below. Drop it: these cases are about ONE instance's reaction to the owners.
      fixture?.destroy();
    });

    afterEach(() => hostFixture?.destroy());

    it('bug 2: a panel MOUNTED mid-run renders the analyze button disabled, having started no run itself', () => {
      // The run was started by an instance that no longer exists; only the registry remembers it.
      registryJobs.next([proofreadJob('running')]);

      const panel = mountHost();
      hostFixture.detectChanges();

      expect(panel.isRunningForCurrentContext)
        .withContext('a fresh instance answers from the registry, not from its own blank fields')
        .toBeTrue();
      expect(runButton().disabled).toBeTrue();

      // ...and it is genuinely SCOPED: the same job in a different chapter must not disable this one.
      registryJobs.next([{ ...proofreadJob('running'), chapterId: 'chap-2' }]);
      hostFixture.detectChanges();
      expect(panel.isRunningForCurrentContext).toBeFalse();
      expect(runButton().disabled).toBeFalse();
    });

    it('54: a panel MOUNTED mid-run also gets the banner and the job the in-panel bar mirrors', () => {
      // The button was only ever HALF the remount. `asyncJobInFlight`, `asyncBannerActiveForRun` and
      // `currentRunJobId` are per-instance and blank on a fresh mount, so a1 left the author looking at
      // a Running button with no banner beneath it and nothing for `app-job-progress-inline` to read -
      // the one surface they had open was the only one of the three with no percent on it.
      registryJobs.next([proofreadJob('running')]);

      const panel = mountHost();
      hostFixture.detectChanges();

      expect(panel.asyncJobInFlight)
        .withContext('the banner is the in-page indicator for a background run; a remount had none')
        .toBeTrue();
      expect((panel as any).currentRunJobId)
        .withContext('read back out of the REGISTRY, so the bar, the dialog and the Activity Center '
          + 'cannot show different numbers for one job')
        .toBe('job-A');
      expect(hostFixture.nativeElement.querySelector('.async-job-banner')).not.toBeNull();
      expect(hostFixture.nativeElement.querySelector('app-job-progress-inline')).not.toBeNull();
    });

    it('54: the restored banner still DISMISSES, and a progress tick does not put it back', () => {
      // The restore runs on every registry emission, and a running job emits one every couple of
      // seconds. Without the one-shot ledger behind it, dismissing the banner would last until the next
      // poll tick and no longer.
      registryJobs.next([proofreadJob('running')]);
      const panel = mountHost();
      hostFixture.detectChanges();
      expect(panel.asyncJobInFlight).withContext('precondition: the banner was restored').toBeTrue();

      panel.dismissAsyncBanner();
      hostFixture.detectChanges();
      expect(hostFixture.nativeElement.querySelector('.async-job-banner')).toBeNull();

      // The registry's next poll answer for the SAME job.
      registryJobs.next([{ ...proofreadJob('running'), percent: 70 }]);
      hostFixture.detectChanges();

      expect(panel.asyncJobInFlight)
        .withContext('a dismiss is sticky for the rest of the run, restored banner or not')
        .toBeFalse();
      expect(hostFixture.nativeElement.querySelector('.async-job-banner')).toBeNull();
    });

    it('54: a SCENE run does not raise the chapter-scoped panel\'s banner either', () => {
      // The restore is read off the same context-matched list the button is, so it inherits the scope
      // rather than re-deriving it: a job that must not disable this panel must not banner it either.
      registryJobs.next([{ ...proofreadJob('running'), sceneId: 'scene-9' }]);

      const panel = mountHost();
      hostFixture.detectChanges();

      expect(panel.asyncJobInFlight).toBeFalse();
      expect((panel as any).currentRunJobId).toBeNull();
    });

    it('bug 2: a SCENE run does not disable the chapter-scoped panel showing the same chapter', () => {
      registryJobs.next([{ ...proofreadJob('running'), sceneId: 'scene-9' }]);

      const panel = mountHost();
      hostFixture.detectChanges();

      expect(panel.isRunningForCurrentContext)
        .withContext('the scene half of the scope is carried now, so the two runs are different jobs')
        .toBeFalse();
    });

    it('bug 1: a job that finishes while this instance is showing the chapter refetches history ONCE', () => {
      const analysis = TestBed.inject(AnalysisService) as any;
      let historyReads = 0;
      const finished: AnalysisResultDto = {
        id: 'res-new', chapterId: 'chap-1', type: 'Proofread', analysisType: 'Proofread',
        resultText: 'fixed', createdAt: '2026-08-18T01:00:00.000Z', status: 'Active',
      } as AnalysisResultDto;
      analysis.getHistory = () => { historyReads++; return of([finished]); };

      registryJobs.next([proofreadJob('running')]);
      const panel = mountHost();
      const readsAfterMount = historyReads;

      // The run this panel never started reaches its terminal.
      registryJobs.next([proofreadJob('succeeded')]);
      hostFixture.detectChanges();

      expect(historyReads).toBe(readsAfterMount + 1);
      expect(panel.latestResult?.id)
        .withContext('the finished result is selected, not merely fetched')
        .toBe('res-new');

      // Deduped per instance: a re-emission of the same terminal is not a second event.
      registryJobs.next([proofreadJob('succeeded')]);
      hostFixture.detectChanges();
      expect(historyReads).toBe(readsAfterMount + 1);
    });

    it('c06: a terminal NOBODY was there to hear is reported by the instance that comes back', () => {
      // The run ended in an error with no panel on screen: a 500, the 180s start-budget expiry, or the
      // author starting a run on another chapter, which supersedes this one. Before c06 the ONLY thing a
      // remounted instance did about a finished run was `noteRunTerminal -> loadHistory(true)`, and a run
      // that FAILED has no history row to find - so the author got the previous result back, unchanged and
      // unexplained. The service holds the terminal; this is the surface that owes the author the sentence.
      const message = runString('en', 'runSuperseded', { type: 'Proofread' });
      pendingUnheardTerminal = {
        runId: 'run-7',
        bookId: 'book-1',
        chapterId: 'chap-1',
        sceneId: null,
        analysisType: 'Proofread',
        message,
      };

      mountHost();
      hostFixture.detectChanges();

      const banner = hostFixture.nativeElement.querySelector('.run-error') as HTMLElement | null;
      expect(banner)
        .withContext('an instance that never started the run is the only surface left to say it ended')
        .not.toBeNull();
      expect(banner!.textContent!.trim()).toBe(message);

      // SINGLE-SHOT. The claim is what consumed it, so the next instance for this unit is not told again
      // about a failure the author has already been shown.
      hostFixture.destroy();
      mountHost();
      hostFixture.detectChanges();
      expect(hostFixture.nativeElement.querySelector('.run-error'))
        .withContext('one failure, reported once')
        .toBeNull();
    });

    it('bug 1: a terminal for a job this instance never saw RUNNING is history, not news', () => {
      const analysis = TestBed.inject(AnalysisService) as any;
      let historyReads = 0;
      analysis.getHistory = () => { historyReads++; return of([]); };

      // Already finished before this panel existed: the ordinary mount-time load covers it.
      registryJobs.next([proofreadJob('succeeded')]);
      mountHost();
      const readsAfterMount = historyReads;

      registryJobs.next([proofreadJob('succeeded')]);
      hostFixture.detectChanges();

      expect(historyReads).toBe(readsAfterMount);
    });

    it('f09: a terminal arriving while chapterId is momentarily null is NOT permanently claimed', () => {
      // The dedupe ledger (`handledRunTerminals`) must only be written on the path that actually
      // refetches. If it were written ahead of the id guard, a terminal that lands while chapterId is
      // transiently null (e.g. mid chapter-switch teardown) would be marked "handled" forever, and this
      // instance would never refetch once the ids come back for the SAME run's re-delivered terminal.
      const analysis = TestBed.inject(AnalysisService) as any;
      let historyReads = 0;
      analysis.getHistory = () => { historyReads++; return of([]); };

      const panel = mountHost();
      const readsAfterMount = historyReads;

      panel.chapterId = null;
      (panel as any).noteRunTerminal('job-A');

      expect(historyReads)
        .withContext('no chapterId means no refetch is possible, so the ledger must not claim one happened')
        .toBe(readsAfterMount);

      // The id comes back and the SAME run's terminal is re-delivered (the registry/service still hold it).
      panel.chapterId = 'chap-1';
      (panel as any).noteRunTerminal('job-A');

      expect(historyReads)
        .withContext('the earlier no-op must not have permanently claimed the key')
        .toBe(readsAfterMount + 1);
    });

    it('refetches history when the analysis TYPE is switched, instead of rendering the cache alone', () => {
      const analysis = TestBed.inject(AnalysisService) as any;
      let historyReads = 0;
      analysis.getHistory = () => { historyReads++; return of([]); };

      const panel = mountHost();
      const readsAfterMount = historyReads;

      panel.onSelectAnalysisType('LineEdit');

      expect(historyReads)
        .withContext('the cached array can be arbitrarily old for the type just selected')
        .toBe(readsAfterMount + 1);
    });

    it('refetches history when the HISTORY sub-tab is opened', () => {
      const analysis = TestBed.inject(AnalysisService) as any;
      let historyReads = 0;
      analysis.getHistory = () => { historyReads++; return of([]); };

      const panel = mountHost();
      const readsAfterMount = historyReads;

      panel.selectSubTab('history');

      expect(historyReads).toBe(readsAfterMount + 1);
      expect(panel.activeSubTab).toBe('history');
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
      // The origin job survives via the Activity Center even after its client stream is torn down by
      // the next run, because the registry row belongs to the RUN, not to this view. c01 moved the
      // write that creates it into the orchestration service (pinned in that service's own spec); what
      // this panel still holds for job A is the id its banner mirrors.
      expect((component as any).currentRunJobId).toBe('job-A');

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

  // c10 / finding 19: `.analysis-panel { min-height: 100% }` is a CYCLIC percentage - its containing
  // block is `app-analysis-panel`, whose height c1 made content-derived - and the worry was that an
  // engine resolves it to 0, in which case a short or empty result floats at the top of a taller column
  // instead of filling it. Chrome resolves it against the host's post-flex used height, measured in the
  // live app on 2026-08-19 across 12 cells. This is the only assertion that can catch a regression to 0,
  // and it is deliberately a LAYOUT assertion against the shipped stylesheet rather than a check that
  // the declaration is still typed in the file.
  describe('c10 the panel column fills its host rather than collapsing (finding 19)', () => {
    it('resolves `min-height: 100%` against the host, so a short column is taller than its content', () => {
      const hostFixture = TestBed.createComponent(PanelHeightChainHostComponent);
      hostFixture.detectChanges();

      const hostEl = hostFixture.nativeElement.querySelector('app-analysis-panel') as HTMLElement;
      const panelEl = hostFixture.nativeElement.querySelector('.analysis-panel') as HTMLElement | null;
      expect(panelEl).withContext('the panel column is rendered').toBeTruthy();

      const filled = panelEl!.getBoundingClientRect().height;
      const hostHeight = hostEl.getBoundingClientRect().height;

      // The height this column would have if the cyclic percentage resolved to 0: the minimum switched
      // off, everything else identical. Restored immediately so the fixture is not left mutated.
      panelEl!.style.minHeight = '0px';
      const natural = panelEl!.getBoundingClientRect().height;
      panelEl!.style.minHeight = '';

      expect(hostHeight).withContext('the stand-in host has a real height').toBeGreaterThan(0);
      expect(natural)
        .withContext('the seeded state is SHORT - a column already taller than its host proves nothing')
        .toBeLessThan(hostHeight);

      expect(filled).withContext('the column fills the host').toBeCloseTo(hostHeight, 0);
      expect(filled)
        .withContext('the percentage resolved to a real length, not to 0')
        .toBeGreaterThan(natural);

      hostFixture.destroy();
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
    pendingUnheardTerminal = null;
    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => NEVER,
            run: () => NEVER,
            startAsync: () => NEVER,
            getByJob: () => NEVER,
            runStream: () => NEVER,
          },
        },
        { provide: DocumentVersionService, useValue: { list: () => of([]), create: () => NEVER, get: () => NEVER } },
        {
          provide: AnalysisRunOrchestrationService,
          useValue: {
            confirmReanalysisIfPendingSuggestions: () => true,
            emitInitialStatusForRun: () => 'Running',
            formatRunDuration: () => null,
            runAnalysisAfterSave: () => EMPTY,
            doRunStreaming: () => EMPTY,
            // a1: `startRun` is the panel's entry point now. Inert here: neither of these describes
            // drives a run, they only need the injection to resolve.
            activeRun$: of(null),
            activeRun: null,
            startRun: () => EMPTY,
            // c06: read on every run-state derivation, so the injection is not resolvable without it.
            takeUnheardRunTerminal: takeUnheardStub,
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
          // a1: `jobs$` is a property, so it goes in the third argument (see the top-of-file twin).
          useValue: jasmine.createSpyObj<JobRegistryService>(
            'JobRegistryService',
            { track: undefined, jobById$: of(null) },
            { jobs$: of([] as TrackedJob[]) },
          ),
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

  /**
   * w5: the cross-model WARNING moved to the dashboard row with the build, because it is a reason to
   * refresh the artifact and the refresh action no longer exists on this per-chapter surface (its own
   * rendering is covered in `book-style-baseline-status-row.component.spec.ts`). What this panel still
   * owes the reader is the pointer: a re-read that reports the artifact is no longer current must make
   * the Linguistic result say so, in place, with no page reload. That is the same property this case was
   * always guarding, asserted on the surface that still carries it.
   */
  it('makes the deviations pointer reflect the re-read once it lands, with no page reload', () => {
    runTab().tierChanged.emit();
    opened[opened.length - 1].subject.next(
      makeBaselineStatus({ hasBaseline: true, ready: false, staleCount: 0, builtWithDifferentModel: true })
    );
    fixture.detectChanges();

    expect(component.styleBaselineStatus?.builtWithDifferentModel).toBeTrue();
    expect(runTab().baselineState)
      .withContext('a cross-model artifact reads as stale, so the pointer offers the way to fix it')
      .toBe('stale');
    expect(runTab().baselineMissingOrInsufficient).toBeTrue();
    // And the build itself is nowhere on this surface.
    expect(fixture.debugElement.query(By.css('[data-testid="style-baseline-row"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="sb-cross-model-warning"]'))).toBeNull();
  });
});

/**
 * c01: the final-result retry must not become a back door around the stale-context drop guard.
 *
 * The retry adds up to ~1.8s of extra life to a run's terminal read. That is exactly long enough for the
 * user to switch chapters in between, so a retry that SUCCEEDS lands in a context the run does not belong
 * to. It must therefore arrive as an ordinary `job-result` event and meet `resultBelongsToRunOrigin` like
 * any other late result - dropped, with `{ kind: 'result-dropped' }` told to the host - rather than
 * injecting the previous chapter's suggestions (and its offsets) into the document now open.
 *
 * This suite deliberately uses the REAL AnalysisRunOrchestrationService, unlike the main panel suite which
 * stubs it: the whole point is that the retry and the drop guard are on the same path. Only the two
 * HTTP-shaped services are stubbed, each handing back an open Subject so the run stays mid-flight across
 * the navigation.
 */
describe('AnalysisPanelComponent final-result retry vs a context change (c01)', () => {
  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;
  /** One open Subject per `getByJob` CALL, in call order. */
  let attempts: Subject<AnalysisResultDto>[];
  /** The progress poll for the run, held open so the run only resolves when this spec says so. */
  let progress$: Subject<any>;

  const RETRY_DELAY_MS = 600;

  function notFound(): HttpErrorResponse {
    return new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
  }

  function chapterAResult(): AnalysisResultDto {
    return {
      id: 'r-A',
      chapterId: 'chap-A',
      sceneId: null,
      bookId: 'book-1',
      jobId: 'job-A',
      type: 'Proofread',
      analysisType: 'Proofread',
      resultText: 'chapter A output',
      createdAt: new Date().toISOString(),
      suggestions: [
        {
          id: 's-1',
          suggestionType: 'Proofread',
          originalText: 'teh',
          suggestedText: 'the',
          rationale: 'typo',
          startOffset: 0,
          endOffset: 3,
          outcome: 'Pending',
        } as unknown as AnalysisSuggestionDto,
      ],
    };
  }

  beforeEach(async () => {
    attempts = [];
    progress$ = new Subject<any>();
    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => NEVER,
            run: () => NEVER,
            startAsync: () => of({ jobId: 'job-A', analysisType: 'Proofread', scope: 'Chapter' }),
            getByJob: () => {
              const attempt = new Subject<AnalysisResultDto>();
              attempts.push(attempt);
              return attempt.asObservable();
            },
            runStream: () => NEVER,
          },
        },
        { provide: DocumentVersionService, useValue: { list: () => of([]), create: () => NEVER, get: () => NEVER } },
        // NOT stubbed: the real orchestration service is the subject under test here.
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => progress$.asObservable(),
            pollStyleBaselineProgress: () => NEVER,
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
                relocatedEnd: s.endOffset ?? 0,
                stale: false,
              }))
            );
            spy.relocateOne.and.callFake((s: any) => ({ ...s, relocatedStart: 0, relocatedEnd: 0, stale: false }));
            return spy;
          },
        },
        {
          provide: StyleBaselineService,
          useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER },
        },
        {
          provide: JobRegistryService,
          // a1: `jobs$` is a property, so it goes in the third argument (see the top-of-file twin).
          useValue: jasmine.createSpyObj<JobRegistryService>(
            'JobRegistryService',
            { track: undefined, jobById$: of(null) },
            { jobs$: of([] as TrackedJob[]) },
          ),
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
    component.chapterId = 'chap-A';
    component.sceneId = null;
    component.documentChapterId = 'chap-A';
    component.documentSceneId = null;
    component.selectedAnalysisType = 'Proofread';
    // Long enough to cross the 500-word Proofread threshold, so the run takes the ASYNC job path and
    // therefore reaches loadFinalResultForJob at all.
    component.documentText = Array(600).fill('word').join(' ');
    fixture.detectChanges();
  });

  /** Run on chapter A, poll to `succeeded`, and let the first final-result read 404. */
  function runToPendingRetry(hostEvents: AnalysisRunEvent[]): void {
    component.runEvent.subscribe(e => hostEvents.push(e));
    component.runAnalysis();
    expect((component as any).isRunning).withContext('precondition: the run is open').toBeTrue();

    progress$.next({
      jobId: 'job-A',
      analysisType: 'Proofread',
      scope: 'Chapter',
      bookId: 'book-1',
      chapterId: 'chap-A',
      sceneId: null,
      status: 'succeeded',
      currentChunk: 3,
      totalChunks: 3,
      completedChunks: 3,
      message: '',
      estimatedCompletionPercent: 100,
    });

    expect(attempts.length).withContext('the final-result read fires on succeeded').toBe(1);
    attempts[0].error(notFound());
    expect(hostEvents.some(e => e.kind === 'error'))
      .withContext('the transient 404 must not be reported as a failed run')
      .toBeFalse();
  }

  it('a retry that succeeds AFTER a chapter switch is dropped, not injected', fakeAsync(() => {
    const hostEvents: AnalysisRunEvent[] = [];
    runToPendingRetry(hostEvents);

    // The user navigates away while the retry is pending - this is the window the retry created.
    component.chapterId = 'chap-B';
    component.ngOnChanges({ chapterId: new SimpleChange('chap-A', 'chap-B', false) });
    component.activeSubTab = 'history';
    const latestBefore = component['latestResult'];

    tick(RETRY_DELAY_MS);
    expect(attempts.length).withContext('the retry really did fire after the switch').toBe(2);
    attempts[1].next(chapterAResult());
    attempts[1].complete();

    expect(component['latestResult'])
      .withContext('chapter A\'s result must never be injected into chapter B: its offsets map into a '
        + 'different document, which is a corruption risk on accept')
      .toBe(latestBefore as any);
    expect(component.activeSubTab).toBe('history');
    expect(component.proofreadSuggestions.length).toBe(0);
    expect(hostEvents.filter(e => e.kind === 'job-result').length)
      .withContext('a dropped result must not reach the host as a success')
      .toBe(0);
    expect(hostEvents.filter(e => e.kind === 'result-dropped').length)
      .withContext('the retry travels the ORDINARY job-result channel, so resultBelongsToRunOrigin sees '
        + 'it and the host is told the truth - the retry is not a back door around that guard')
      .toBe(1);

    component.ngOnDestroy();
  }));

  it('control: a retry that succeeds with the user still on the origin chapter applies normally', fakeAsync(() => {
    const hostEvents: AnalysisRunEvent[] = [];
    component.activeSubTab = 'history';
    runToPendingRetry(hostEvents);

    tick(RETRY_DELAY_MS);
    const result = chapterAResult();
    attempts[1].next(result);
    attempts[1].complete();

    expect(component['latestResult'])
      .withContext('the retry is only worth having if a recovered result is actually surfaced')
      .toBe(result);
    expect(component.activeSubTab).toBe('run');
    expect(hostEvents.filter(e => e.kind === 'job-result').length).toBe(1);
    expect(hostEvents.filter(e => e.kind === 'error').length)
      .withContext('the run recovered, so no failure was ever reported')
      .toBe(0);

    component.ngOnDestroy();
  }));

});

// ── c02: the panel's own failure banner is localized too ────────────────────────────────────────────
//
// `.run-error` is the FOURTH run surface (the three PROGRESS surfaces have their own rendered-DOM spec
// in `shared/analysis-run-dialog/run-chrome-i18n.spec.ts`). It had TWO independent English sources, on
// two DIFFERENT run paths, and both are driven here because either one alone leaves the other's literal
// live:
//
//   (A) the SYNC-with-jobId path. `startProgressPollingIfNeeded` emits a `progress` event and NEVER an
//       `error` one, so a failed poll leaves the PANEL's own literal on screen. This is the only path
//       that renders it: on (B) the orchestration error event lands in the same synchronous turn and
//       overwrites it, which is exactly why a test that drove only (B) passed against the un-localized
//       panel literal.
//   (B) the ASYNC-job path. `startProgressPollingForJob` emits `progress` AND then `error`, so the
//       banner ends up showing the ORCHESTRATION service's message.
//
// Both are asserted through the RENDERED banner rather than through the `runError` field: the field
// could be localized and the template still bind something else.
describe('AnalysisPanelComponent run-failure banner i18n (c02)', () => {
  let fixture: ComponentFixture<AnalysisPanelComponent>;
  let component: AnalysisPanelComponent;
  let progress$: Subject<any>;
  /** Answers the SYNC /analyze call. Handing back a jobId is what starts the sync-path progress poll. */
  let syncRun$: Subject<AnalysisResultDto>;

  const SHORT_TEXT = 'a few words only';
  const LONG_TEXT = Array(600).fill('word').join(' ');

  function failedProgress(): any {
    return {
      jobId: 'job-A',
      analysisType: 'Proofread',
      scope: 'Chapter',
      bookId: 'book-1',
      chapterId: 'chap-A',
      sceneId: null,
      status: 'failed',
      currentChunk: 1,
      totalChunks: 3,
      completedChunks: 1,
      // The backend's own prose. It must not reach the banner in either language.
      message: 'Proofread failed: System.InvalidOperationException',
      estimatedCompletionPercent: 33,
    };
  }

  function bannerText(): string {
    const el = fixture.debugElement.query(By.css('.run-error'));
    return (el?.nativeElement as HTMLElement | undefined)?.textContent?.trim() ?? '';
  }

  beforeEach(async () => {
    progress$ = new Subject<any>();
    syncRun$ = new Subject<AnalysisResultDto>();

    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => NEVER,
            run: () => syncRun$.asObservable(),
            startAsync: () => of({ jobId: 'job-A', analysisType: 'Proofread', scope: 'Chapter' }),
            getByJob: () => NEVER,
            runStream: () => NEVER,
          },
        },
        { provide: DocumentVersionService, useValue: { list: () => of([]), create: () => NEVER, get: () => NEVER } },
        // NOT stubbed: the real orchestration service composes the strings under test.
        {
          provide: AnalysisProgressService,
          useValue: { pollProgress: () => progress$.asObservable(), pollStyleBaselineProgress: () => NEVER },
        },
        {
          provide: SuggestionAnchorService,
          useValue: jasmine.createSpyObj('SuggestionAnchorService', { relocateAll: [], relocateOne: null }),
        },
        {
          provide: StyleBaselineService,
          useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER },
        },
        {
          provide: JobRegistryService,
          // a1: `jobs$` is a property, so it goes in the third argument (see the top-of-file twin).
          useValue: jasmine.createSpyObj<JobRegistryService>(
            'JobRegistryService',
            { track: undefined, jobById$: of(null) },
            { jobs$: of([] as TrackedJob[]) },
          ),
        },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisPanelComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.chapterId = 'chap-A';
    component.sceneId = null;
    component.documentChapterId = 'chap-A';
    component.documentSceneId = null;
    component.selectedAnalysisType = 'Proofread';
  });

  afterEach(() => component.ngOnDestroy());

  /** (A) short text -> sync /analyze, whose response carries a jobId, so a progress poll starts. */
  function failOnTheSyncPath(bookLanguage: string): void {
    component.bookLanguage = bookLanguage;
    component.documentText = SHORT_TEXT;
    fixture.detectChanges();

    component.runAnalysis();
    syncRun$.next({
      id: 'r-A', chapterId: 'chap-A', jobId: 'job-A', type: 'Proofread', analysisType: 'Proofread',
      resultText: '', createdAt: new Date().toISOString(),
    });
    progress$.next(failedProgress());
    fixture.detectChanges();
  }

  /** (B) long text -> the async analysis-jobs path. */
  function failOnTheAsyncPath(bookLanguage: string): void {
    component.bookLanguage = bookLanguage;
    component.documentText = LONG_TEXT;
    fixture.detectChanges();

    component.runAnalysis();
    progress$.next(failedProgress());
    fixture.detectChanges();
  }

  describe("(A) the SYNC path, where the PANEL's own literal is what renders", () => {
    it('a HEBREW book renders the banner in Hebrew, with no Latin letters and no em-dash', () => {
      failOnTheSyncPath('he');

      expect(bannerText())
        .withContext('the banner must actually render, or the Latin check below is vacuous')
        .toBe(runString('he', 'runFailed', { type: 'הגהה' }));
      expect(bannerText()).not.toMatch(/[A-Za-z]/);
      expect(bannerText()).not.toContain('—');
    });

    it('an ENGLISH book renders the same sentence in English (the control)', () => {
      failOnTheSyncPath('en');
      expect(bannerText()).toBe(runString('en', 'runFailed', { type: 'Proofread' }));
    });
  });

  describe("(B) the ASYNC path, where the ORCHESTRATION service's message is what renders", () => {
    it('a HEBREW book renders the banner in Hebrew, with no Latin letters and no em-dash', () => {
      failOnTheAsyncPath('he');

      expect(bannerText()).toBe(runString('he', 'runFailed', { type: 'הגהה' }));
      expect(bannerText()).not.toMatch(/[A-Za-z]/);
      expect(bannerText()).not.toContain('—');
    });

    it('an ENGLISH book renders the same sentence in English (the control)', () => {
      failOnTheAsyncPath('en');
      expect(bannerText()).toBe(runString('en', 'runFailed', { type: 'Proofread' }));
    });
  });
});


/**
 * ── Wave 3 / w7 (Q5 + Q7-A): THE REMOVALS, ASSERTED ON THE RENDERED PANEL ─────────────────────────
 *
 * Three surfaces left this panel: the Custom free-form prompt box, the save-as-template button beside
 * it, and Custom's button in the run-tab pass picker. Deleting code proves none of that on its own, so
 * each is asserted here against the DOM the author actually sees, and the two SEPARATE type lists the
 * panel now binds (startable to the picker, the full vocabulary to the history tab's chips) are pinned
 * against each other so a future edit cannot collapse them back into one and silently take the history
 * filter with it. The history side of that pair is asserted where it renders, in
 * `analysis-history-tab.component.spec.ts`.
 *
 * The pointer that replaced the prompt box is asserted in BOTH languages and BOTH directions, and its
 * button is asserted to really open the dock rather than to merely exist.
 */
describe('AnalysisPanelComponent - the w7 removals and the Show pointer', () => {
  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;
  let overlays: AppOverlayService;

  beforeEach(async () => {
    pendingUnheardTerminal = null;
    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => NEVER,
            run: () => NEVER,
            startAsync: () => NEVER,
            getByJob: () => NEVER,
            runStream: () => NEVER,
          },
        },
        { provide: DocumentVersionService, useValue: { list: () => of([]), create: () => NEVER, get: () => NEVER } },
        {
          provide: AnalysisRunOrchestrationService,
          useValue: {
            confirmReanalysisIfPendingSuggestions: () => true,
            emitInitialStatusForRun: () => 'Running',
            formatRunDuration: () => null,
            runAnalysisAfterSave: () => EMPTY,
            doRunStreaming: () => EMPTY,
            // a1: `startRun` is the panel's entry point now. Inert here: neither of these describes
            // drives a run, they only need the injection to resolve.
            activeRun$: of(null),
            activeRun: null,
            startRun: () => EMPTY,
            // c06: read on every run-state derivation, so the injection is not resolvable without it.
            takeUnheardRunTerminal: takeUnheardStub,
          },
        },
        {
          provide: SuggestionAnchorService,
          useValue: jasmine.createSpyObj('SuggestionAnchorService', { relocateAll: [], relocateOne: null }),
        },
        {
          provide: StyleBaselineService,
          useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER },
        },
        {
          provide: AnalysisProgressService,
          useValue: { pollProgress: () => NEVER, pollStyleBaselineProgress: () => NEVER },
        },
        {
          provide: JobRegistryService,
          // a1: `jobs$` is a property, so it goes in the third argument (see the top-of-file twin).
          useValue: jasmine.createSpyObj<JobRegistryService>(
            'JobRegistryService',
            { track: undefined, jobById$: of(null) },
            { jobs$: of([] as TrackedJob[]) },
          ),
        },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    // The REAL overlay service, not a double: the pointer's whole claim is that it opens the surface
    // the dock's own launcher opens, and a stub would let a call to a method nobody reads pass for that.
    overlays = TestBed.inject(AppOverlayService);

    fixture = TestBed.createComponent(AnalysisPanelComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
    component.bookLanguage = 'he';
    fixture.detectChanges();
  });

  /** The pass picker's buttons, by their rendered label. */
  function pickerLabels(): string[] {
    return fixture.debugElement
      .queryAll(By.css('.type-picker button'))
      .map(b => b.nativeElement.textContent.trim());
  }

  // ── (b) the Custom free-form prompt block ───────────────────────────────────────────────────────

  it('renders no free-form prompt box, whatever pass is selected', () => {
    for (const type of ['Proofread', 'LineEdit', 'LinguisticAnalysis', 'LiteraryAnalysis', 'Summarization', 'Custom']) {
      component.selectedAnalysisType = type;
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.prompt-section')))
        .withContext(`a prompt section rendered for ${type}`)
        .toBeNull();
      expect(fixture.debugElement.query(By.css('textarea')))
        .withContext(`a free-form textarea rendered for ${type}`)
        .toBeNull();
    }
  });

  // ── (d) save as template ────────────────────────────────────────────────────────────────────────

  it('offers no save-as-template affordance, and the panel no longer knows how to make one', () => {
    component.selectedAnalysisType = 'Custom';
    fixture.detectChanges();

    const buttonText = fixture.debugElement
      .queryAll(By.css('button'))
      .map(b => b.nativeElement.textContent.trim());
    for (const label of ['שמור כתבנית', 'Save as template']) {
      expect(buttonText).withContext('the save-as-template button is removed').not.toContain(label);
    }
    // Asserted on the CLASS rather than on this TestBed's service double, for the same reason the
    // dashboard asserts BookService.ask on the real class: a double will happily answer for a method
    // that no longer exists.
    expect(Object.getOwnPropertyNames(AnalysisService.prototype))
      .withContext('w7: template creation is removed from the client entirely')
      .not.toContain('createTemplate');
    expect(Object.getOwnPropertyNames(AnalysisService.prototype))
      .withContext('w7: nothing reads templates either, so the GET is gone too')
      .not.toContain('getTemplates');
  });

  // ── (c) Custom leaves the picker, WITHOUT leaving the vocabulary ────────────────────────────────

  it('does not offer Custom as a startable pass, in either language', () => {
    component.bookLanguage = 'he';
    fixture.detectChanges();
    // A positive claim, not just the negative one below (finding C10): the negative half alone would
    // stay green even if the Hebrew label map broke and the picker rendered raw wire values instead of
    // labels - none of those would equal 'מותאם' either. The exact list is the same positive claim the
    // English half already makes in the next test.
    expect(pickerLabels())
      .withContext('the Hebrew picker\'s exact rendered labels')
      .toEqual(['הגהה', 'עריכת שורה', 'לשוני', 'ספרותי', 'תמצית פרק']);
    expect(pickerLabels()).withContext('the Hebrew picker STILL offers מותאם, which w7 retired')
      .not.toContain('מותאם');

    component.bookLanguage = 'en';
    fixture.detectChanges();
    expect(pickerLabels()).withContext('the English picker STILL offers Custom, which w7 retired')
      .not.toContain('Custom');
  });

  it('still offers every pass that DID survive, so the picker was not emptied by accident', () => {
    component.bookLanguage = 'en';
    fixture.detectChanges();

    expect(pickerLabels()).toEqual(['Proofread', 'Line Edit', 'Linguistic', 'Literary', 'Chapter recap']);
  });

  it('binds the STARTABLE list to the picker and the FULL vocabulary to the history chips', () => {
    // The trap this pins: one constant used to feed both, so retiring a pass from the picker silently
    // retired its history filter chip too.
    expect(component.startableAnalysisTypes.map(t => t.value as string))
      .withContext('the picker offers what can be started')
      .not.toContain('Custom');
    expect(component.analysisTypes.map(t => t.value as string))
      .withContext('the history chips must still offer what can be FOUND')
      .toContain('Custom');
  });

  it('needs nothing but an open chapter to enable Run, now that no pass carries a prompt', () => {
    component.selectedAnalysisType = 'Proofread';
    expect(component.canRun).toBeTrue();

    component.chapterId = null;
    expect(component.canRun).withContext('a chapter is still required').toBeFalse();
  });

  // ── the Show pointer ────────────────────────────────────────────────────────────────────────────

  it('renders the Show pointer in Hebrew, right to left, with a real button', () => {
    component.bookLanguage = 'he';
    fixture.detectChanges();

    const section = fixture.debugElement.query(By.css('.show-pointer-section'));
    expect(section).withContext('the pointer must stand where the prompt block stood').toBeTruthy();
    expect(section.query(By.css('.show-pointer-body')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_HE.panelBody);

    const button = section.query(By.css('.show-pointer-btn'));
    expect(button.nativeElement.textContent.trim()).toBe(SHOW_POINTER_STRINGS_HE.open);
    expect(button.nativeElement.getAttribute('aria-label')).toBe(SHOW_POINTER_STRINGS_HE.openAria);

    expect(fixture.debugElement.query(By.css('.analysis-panel')).nativeElement.getAttribute('dir'))
      .withContext('a Hebrew book renders the panel, and therefore the pointer, right to left')
      .toBe('rtl');
  });

  it('renders the Show pointer in English, left to right', () => {
    component.bookLanguage = 'en';
    fixture.detectChanges();

    const section = fixture.debugElement.query(By.css('.show-pointer-section'));
    expect(section.query(By.css('.show-pointer-body')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_EN.panelBody);
    expect(section.query(By.css('.show-pointer-btn')).nativeElement.textContent.trim())
      .toBe(SHOW_POINTER_STRINGS_EN.open);

    expect(fixture.debugElement.query(By.css('.analysis-panel')).nativeElement.getAttribute('dir'))
      .toBe('ltr');
  });

  it('opens the dock on the assistant tab when the pointer is used, and blocks nothing', () => {
    fixture.detectChanges();
    expect(overlays.isOpen).withContext('precondition: the dock starts closed').toBeFalse();

    fixture.debugElement.query(By.css('.show-pointer-btn')).nativeElement.click();

    expect(overlays.isOpen).withContext('the pointer must OPEN Show, not merely describe it').toBeTrue();
    expect(overlays.activeTab).toBe('assistant');
    // Not a modal: the panel it was clicked from is still mounted and still rendering.
    expect(fixture.debugElement.query(By.css('.type-picker'))).toBeTruthy();
  });

  // ── C1: placement and visibility ────────────────────────────────────────────────────────────────
  //
  // The block the pointer replaced was conditional on `selectedAnalysisType === 'Custom'` and stood
  // ABOVE the Run button. The pointer shipped unconditional and ABOVE Run, so it rendered on every
  // pass, on every sub-tab (Run, History, Versions), pushing the result list down in a 300-380px
  // panel even on tabs that show past results rather than a place to ask something new. The fix scopes
  // it to the Run sub-tab (the tab discoverability was actually lost from, and the only one where
  // "ask something new" fits) and moves it below Run (the one action every visit to this tab is FOR).

  it('renders on the Run sub-tab, and NOT on History or Versions (C1)', () => {
    fixture.detectChanges();
    expect(component.activeSubTab).withContext('precondition: Run is the default sub-tab').toBe('run');
    expect(fixture.debugElement.query(By.css('.show-pointer-section')))
      .withContext('the pointer must still show on Run, where it replaces the Custom prompt block')
      .toBeTruthy();

    component.activeSubTab = 'history';
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.show-pointer-section')))
      .withContext('History reviews PAST results, not a place to compose a new free-form question')
      .toBeNull();

    component.activeSubTab = 'versions';
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.show-pointer-section')))
      .withContext('Versions reviews PAST documents, same reasoning as History')
      .toBeNull();

    component.activeSubTab = 'run';
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.show-pointer-section')))
      .withContext('switching back to Run must bring the pointer back')
      .toBeTruthy();
  });

  it('stands BELOW the Run button, not above it (C1)', () => {
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.analysis-panel') as HTMLElement;
    const runBtn = panel.querySelector('.run-btn') as HTMLElement;
    const pointer = panel.querySelector('.show-pointer-section') as HTMLElement;
    expect(runBtn).withContext('precondition: the Run button rendered').toBeTruthy();
    expect(pointer).withContext('precondition: the pointer rendered (default sub-tab is Run)').toBeTruthy();

    // eslint-disable-next-line no-bitwise
    expect(!!(runBtn.compareDocumentPosition(pointer) & Node.DOCUMENT_POSITION_FOLLOWING))
      .withContext('the pointer must come AFTER the Run button in document order, not before it')
      .toBeTrue();
  });
});

// â”€â”€ c01 (registry-write-survives-unmount): the run's registry write must OUTLIVE this panel â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// THE DEFECT, and why it needs its own TestBed. `AnalysisPanelComponent` is mounted under
// `@if (editHelpView === 'analysis')` inside `@else if (reviewMode === 'edit')`, so switching the
// Edit-help sub-tab or the Review/Edit control DESTROYS it, and `ngOnDestroy` unsubscribes
// `runSubscription`. a1 made `AnalysisRunOrchestrationService` the OWNER of the run (so the request
// itself survives) and made `JobRegistryService` the single authority on async run state - but left the
// registry's one WRITE inside this component's `'job-started'` case. So an async run whose dispatch POST
// answered AFTER the tab switch was published NOWHERE: no Activity Center row, no per-chapter running
// mark on the dashboard or the editor spine, no in-panel bar, and nothing for a remounted panel to
// derive its state from. Only a page reload's `reattach` recovered it.
//
// WHY THE REAL SERVICES. Every other describe in this file stubs both the orchestration service and the
// registry, and a stub cannot answer the question "does the write survive this component" - it IS the
// component's collaborator, alive for as long as the TestBed is. This one wires the REAL orchestration
// service to the REAL registry over HTTP doubles, so the write travels the production path.
//
// WHY A SUBJECT AND NOT `of()`. The whole defect lives in the window between "the dispatch went out"
// and "it answered". A synchronous `of()` closes that window inside `runAnalysis()`, before the panel
// could possibly be destroyed, so every case here would pass against the unfixed code and prove
// nothing. The dispatch is held open, the panel is destroyed FOR REAL through a structural `@if`, and
// only then does the server answer.
describe('c01 the registry write outlives the panel (a dispatch that answers after unmount)', () => {
  /** The dispatch POST, held open so it can answer after the panel is gone. */
  let startAsyncSubject: Subject<{ jobId: string }>;
  /**
   * The SYNC `POST /analyze`, held open for the same reason - and, for the sync case, so that spec can
   * both prove the request was issued (`observed`) and END the run, which is what cancels
   * `withStartTimeout`'s real 180s timer instead of leaving it pending on the root service (final-r01).
   */
  let runSubject: Subject<AnalysisResultDto>;
  let registry: JobRegistryService;
  let hostFixture: ComponentFixture<LateDispatchHostComponent>;
  let host: LateDispatchHostComponent;

  function panel(): AnalysisPanelComponent {
    return hostFixture.debugElement.query(By.directive(AnalysisPanelComponent)).componentInstance;
  }

  /** Is the panel still in the DOM? The precondition every case here rests on. */
  function panelMounted(): boolean {
    return !!hostFixture.debugElement.query(By.directive(AnalysisPanelComponent));
  }

  /** Destroy the panel the way the editor does: by taking its structural `@if` away. */
  function unmountPanel(): void {
    host.mounted = false;
    hostFixture.detectChanges();
  }

  beforeEach(async () => {
    startAsyncSubject = new Subject<{ jobId: string }>();
    runSubject = new Subject<AnalysisResultDto>();
    await TestBed.configureTestingModule({
      imports: [LateDispatchHostComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getChunkThresholds: () => of({ proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 }),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => of({ explanation: 'because' }),
            run: () => runSubject.asObservable(),
            // The one call under test: it answers only when this spec says so.
            startAsync: () => startAsyncSubject.asObservable(),
            getByJob: () => NEVER,
            runStream: () => NEVER,
          },
        },
        { provide: DocumentVersionService, useValue: { list: () => of([]), create: () => of(), get: () => of() } },
        {
          provide: SuggestionAnchorService,
          useValue: jasmine.createSpyObj('SuggestionAnchorService', { relocateAll: [], relocateOne: null }),
        },
        {
          provide: StyleBaselineService,
          useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER },
        },
        {
          provide: AnalysisProgressService,
          useValue: { pollProgress: () => NEVER, pollStyleBaselineProgress: () => NEVER },
        },
        // The registry's other reattach sources. Never called here (nothing calls `reattach`), but they
        // are `inject()`ed as field initializers, so the real registry cannot be built without them.
        { provide: BookSummaryService, useValue: {} },
        { provide: BookReviewService, useValue: {} },
        {
          provide: AiTierService,
          useValue: {
            watch: () => NEVER, refresh: () => NEVER, get: () => NEVER,
            setTask: () => NEVER, setBookDefault: () => NEVER, clearTask: () => NEVER,
          },
        },
        // NOTE what is deliberately ABSENT: AnalysisRunOrchestrationService and JobRegistryService.
        // Both are the real root singletons here. That is the point of this describe.
      ],
    }).compileComponents();

    registry = TestBed.inject(JobRegistryService);
    hostFixture = TestBed.createComponent(LateDispatchHostComponent);
    host = hostFixture.componentInstance;
    hostFixture.detectChanges();
  });

  /** Start an always-async run (LinguisticAnalysis needs no document to take the job route). */
  function startAsyncRun(): void {
    const p = panel();
    p.selectedAnalysisType = 'LinguisticAnalysis';
    p.runAnalysis();
    hostFixture.detectChanges();
  }

  it('publishes the job even though the dispatch answers AFTER the panel was destroyed', async () => {
    startAsyncRun();

    // Preconditions, so a green result cannot come from the run never having started.
    expect(startAsyncSubject.observed)
      .withContext('the dispatch POST really is in flight')
      .toBeTrue();
    expect(await firstValueFrom(registry.jobs$))
      .withContext('nothing is published before the server answers')
      .toEqual([]);

    unmountPanel();
    expect(panelMounted())
      .withContext('the panel really is gone: this is the window the defect lived in')
      .toBeFalse();

    // The server answers a component that no longer exists.
    startAsyncSubject.next({ jobId: 'job-late' });

    const jobs = await firstValueFrom(registry.jobs$);
    expect(jobs.length)
      .withContext('the run outlives the panel, so its one registry write has to as well - before this '
        + 'fix the job was published NOWHERE and only a page reload could recover it')
      .toBe(1);
    expect(jobs[0]).toEqual(jasmine.objectContaining({
      id: 'job-late',
      kind: 'proofread',
      bookId: 'book-1',
      chapterId: 'chap-1',
      sceneId: 'scene-1',
      analysisType: 'LinguisticAnalysis',
      scopeLabel: 'סצנה',
      status: 'running',
    }));
  });

  it('the Activity Center and the per-chapter running mark both see the late-published job', async () => {
    startAsyncRun();
    unmountPanel();
    startAsyncSubject.next({ jobId: 'job-late' });

    // The Activity Center renders `registry.jobs$`; the dock's launcher count reads `activeJobs$`.
    expect((await firstValueFrom(registry.jobs$)).map(j => j.id))
      .withContext('the Activity Center row: this is the stream ActivityCenterComponent renders')
      .toEqual(['job-late']);
    expect((await firstValueFrom(registry.activeJobs$)).map(j => j.id))
      .withContext('the dock launcher count reads activeJobs$')
      .toEqual(['job-late']);

    // The spine's stage-4 running mark, derived exactly the way book-dashboard and editor-page derive it.
    const runningChapters = new Set(
      (await firstValueFrom(registry.activeJobs$))
        .filter(j => j.bookId === 'book-1' && CHAPTER_SCOPED_KINDS.has(j.kind) && j.chapterId)
        .map(j => j.chapterId as string),
    );
    expect(Array.from(runningChapters))
      .withContext('the dashboard/editor stage-4 running mark for this chapter')
      .toEqual(['chap-1']);

    // And the one stream that deliberately does NOT light up: `anyRunningForBook$` counts only
    // WHOLE_BOOK_BUILD_KINDS (summary + review). A chapter analysis is tracked for the Activity Center
    // and the per-chapter marks, and must not turn the editor's "review running" affordance on.
    expect(await firstValueFrom(registry.anyRunningForBook$('book-1')))
      .withContext('a chapter proofread is not a whole-book build; lighting this would be the bug '
        + 'WHOLE_BOOK_BUILD_KINDS exists to prevent')
      .toBeFalse();
  });

  it('publishes the scope the run STARTED with, not the context the user navigated to mid-run', async () => {
    // The captured-origin rule, end to end. The panel instance is reused across navigation and the
    // dispatch answer can land after a chapter/scene/type switch, so a publish keyed off live state
    // would label a scene run as a chapter run of the wrong chapter while the API ran the original
    // scope. That is the defect which makes the rule load-bearing.
    startAsyncRun();

    host.chapterId = 'chap-other';
    host.sceneId = null;
    hostFixture.detectChanges();
    panel().selectedAnalysisType = 'Proofread';
    hostFixture.detectChanges();

    unmountPanel();
    startAsyncSubject.next({ jobId: 'job-origin' });

    expect((await firstValueFrom(registry.jobs$))[0]).toEqual(jasmine.objectContaining({
      chapterId: 'chap-1',
      sceneId: 'scene-1',
      analysisType: 'LinguisticAnalysis',
      scopeLabel: 'סצנה',
    }));
  });

  it('a run that never dispatches (the sync route) publishes nothing at all', async () => {
    // The complement: the write is bound to a real server-issued job id, not to "a run started". A sync
    // run persists with a NULL JobId and cannot be reattached, so a row for it would promise a
    // durability it does not have.
    const p = panel();
    p.selectedAnalysisType = 'Proofread';
    p.documentText = 'short enough to stay inline';
    p.runAnalysis();
    hostFixture.detectChanges();

    // final-r01: the PAIRED POSITIVE, in this cell. `toEqual([])` alone cannot tell "the run happened and
    // published nothing" (the claim) from "the run never happened" (a defect) - a new guard in
    // `runAnalysis` on the thresholds, the document text or the pending-suggestion confirm would produce
    // the identical empty registry and green this spec.
    expect(runSubject.observed)
      .withContext('precondition: the SYNC request really was issued, so the empty registry below is a '
        + 'statement about publishing rather than about a run that never started')
      .toBeTrue();

    unmountPanel();

    expect(await firstValueFrom(registry.jobs$)).toEqual([]);

    // final-r01: END THE RUN. `unmountPanel()` detaches this caller (a1's whole point) and leaves the run
    // OWNED, holding `withStartTimeout`'s real `timer(180_000)` on the root service that no TestBed
    // teardown unsubscribes - and `provesServerAnswered` is false for the only event this run emits, so
    // nothing cancels it. Its expiry `console.warn` would land in whatever spec is running three minutes
    // later, which is exactly the zombie the c15/finding-59 fakeAsync wrapping was written for.
    runSubject.complete();
  });
});

/**
 * c01: the panel behind a structural `@if`, with every scope input settable, so a spec can navigate the
 * panel mid-run and then take the whole component away - the two halves of the defect.
 */
@Component({
  standalone: true,
  imports: [AnalysisPanelComponent],
  template: `
    @if (mounted) {
      <app-analysis-panel
        [bookId]="bookId"
        [chapterId]="chapterId"
        [sceneId]="sceneId">
      </app-analysis-panel>
    }
  `,
})
class LateDispatchHostComponent {
  mounted = true;
  bookId: string | null = 'book-1';
  chapterId: string | null = 'chap-1';
  sceneId: string | null = 'scene-1';
}

/**
 * c10: a stand-in for the editor's `.review-body` - a definite-height, scrolling column flex box - so the
 * panel's own `min-height: 100%` gets the same containing block it has in production.
 *
 * The two rules below are copied from `editor-page.component.scss` (`.review-body` and
 * `.review-body app-analysis-panel`), because that stylesheet is scoped to EditorPageComponent and can
 * never reach a panel this TestBed mounts. They are the SETUP, not the subject. The rule under test is
 * `.analysis-panel { min-height: 100% }` in the panel's own shipped stylesheet, which Angular compiles
 * and applies here for real - so a change to that declaration is what this spec sees.
 *
 * The stub is 1200px so the empty-state column is comfortably shorter than its host; the spec asserts
 * that premise rather than assuming it.
 */
@Component({
  standalone: true,
  imports: [AnalysisPanelComponent],
  template: `
    <div class="review-body-stub">
      <app-analysis-panel [bookId]="'book-1'" [chapterId]="'chap-1'"></app-analysis-panel>
    </div>
  `,
  styles: [`
    .review-body-stub {
      height: 1200px;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .review-body-stub app-analysis-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
  `],
})
class PanelHeightChainHostComponent {}
