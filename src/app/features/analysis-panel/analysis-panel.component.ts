import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnInit, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, forkJoin } from 'rxjs';
import { ANALYSIS_TYPE_LABELS, ANALYSIS_TYPES, AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto, PromptTemplateDto, isConsistencySuggestion } from '../../core/models/analysis';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';
import { analysisTypeLabelFor, runChromeLang, runString } from '../../core/i18n/run-strings';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { JobRegistryService, normalizeLang } from '../../core/services/job-registry.service';
import { AnalysisRunOrchestrationService, AnalysisRunContext, AnalysisRunEvent, assertUnhandledRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { DocumentVersionService, DocumentVersionDto } from '../../core/services/document-version.service';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';
import { ApplyCorrectionEvent } from '../language-engine/issue-panel.component';
import { proofreadDiff } from '../../core/utils/proofread-diff';
import { normalizeTextForAnalysis } from '../../core/utils/normalize-text-for-analysis';
import { SuggestionCardComponent } from './suggestion-card.component';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { AnalysisHistoryTabComponent } from './analysis-history-tab.component';
import { AnalysisVersionsTabComponent } from './analysis-versions-tab.component';
import { JobProgressInlineComponent } from '../../shared/job-progress-inline/job-progress-inline.component';

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SuggestionCardComponent, AnalysisRunTabComponent, AnalysisHistoryTabComponent, AnalysisVersionsTabComponent, JobProgressInlineComponent],
  templateUrl: './analysis-panel.component.html',
  styleUrl: './analysis-panel.component.scss'
})
export class AnalysisPanelComponent implements OnChanges, OnInit, OnDestroy {
  @Input() bookId: string | null = null;
  @Input() chapterId: string | null = null;
  @Input() sceneId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Used for analysis and templates. Defaults to 'he' if not set. */
  @Input() bookLanguage: string | null = null;
  /** Current document plain text (from editor). Used for Proofread diff and Line Edit offset mapping. */
  @Input() documentText: string = '';
  /** Chapter/scene the current document belongs to; used to avoid restoring with stale documentText after chapter switch. */
  @Input() documentChapterId: string | null = null;
  @Input() documentSceneId: string | null = null;
  /** If provided, called before run/streaming so the editor can save; must return Promise that resolves when save is done. */
  @Input() saveBeforeRun?: () => Promise<void>;
  @Output() analysisStarted = new EventEmitter<void>();
  /**
   * Wave 1d (c2): the run's event stream, fanned out to the host so it can drive the run-progress
   * dialog. Every event the panel handles is forwarded EXCEPT `'streaming-token'`, which is high-volume
   * and which no host surface consumes.
   *
   * It is NOT a byte-for-byte copy of the orchestration stream, and must not be documented as one: c06
   * replaces a `'sync-result'` / `'job-result'` whose origin no longer matches the context on screen with
   * `{ kind: 'result-dropped' }`, so the host is never told "Done" about a result this panel discarded
   * (see {@link resultBelongsToRunOrigin}). Two members - `'run-finished'` and `'result-dropped'` - are
   * therefore emitted by this panel and by nothing else.
   *
   * This REPLACES the former `analysisStatus` / `analysisProgressPercent` outputs. Those were the second
   * owner of a job's progress: the editor re-derived, re-clamped and made-monotonic its own percent from
   * the orchestration service's `'progress'` events, in parallel with the registry that already owned the
   * same number. Progress now travels on exactly one channel (JobRegistryService); this output carries
   * only the run LIFECYCLE, which is what a dialog needs before a job id exists.
   *
   * c01: it also carries the run's TERMINAL, as the synthetic `'run-finished'` event (see
   * {@link emitRunFinished}). The former `analysisCompleted` / `asyncJobStarted` outputs were deleted with
   * it: they had no consumer left anywhere in the app, and `analysisCompleted` being the terminal on a
   * channel nobody bound is exactly what stranded the dialog.
   */
  @Output() runEvent = new EventEmitter<AnalysisRunEvent>();
  @Output() applyCorrection = new EventEmitter<ApplyCorrectionEvent>();
  @Output() showInDocument = new EventEmitter<{ suggestionId?: string; startOffset?: number; endOffset?: number; originalText?: string }>();
  @Output() suggestionRangesChange = new EventEmitter<{ suggestionId?: string; startOffset: number; endOffset: number }[]>();
  /** Emits a scroll target so the editor stays on this word after the next highlight update (e.g. after dismiss/accept). */
  @Output() scrollTargetChange = new EventEmitter<{ startOffset: number; endOffset: number; originalText?: string }>();
  @Output() revertToVersion = new EventEmitter<string>();

  readonly analysisTypes = ANALYSIS_TYPES;

  /**
   * Panel chrome language: book-scoped, Hebrew default, English only for an English book.
   *
   * c02: delegated to `runChromeLang`, the one implementation of that rule. The panel renders the
   * sentences the orchestration service composes in the run's language, so the two must not be able to
   * disagree about what a non-en, non-he book gets.
   */
  get panelLang(): 'he' | 'en' {
    return runChromeLang(this.bookLanguage);
  }

  /** Logical direction for the panel chrome; follows the book language so en books render ltr. */
  get panelDir(): 'rtl' | 'ltr' {
    return this.panelLang === 'en' ? 'ltr' : 'rtl';
  }

  /**
   * Localized panel chrome strings (he default, en when the book is English). Keeps he/en parity.
   *
   * NOTE for anyone adding or removing a key: `key` is a plain `string`, NOT a closed union like the
   * sibling `RunDialogLabelKey` / `DashboardLabelKey`, and the two maps are independent
   * `Record<string, string>` literals with `?? key` as the miss fallback. So nothing - not the compiler,
   * not a parity spec - catches a key added to one language and forgotten in the other, or a key left
   * behind after its only caller is deleted. Both maps must be edited together, by hand. `runStreaming`
   * and `streaming` were removed this way (f02 + the closing review): both belonged to `runStreaming()`,
   * which has no template caller.
   */
  panelLabel(key: string): string {
    const he: Record<string, string> = {
      title: 'ניתוח',
      customPrompt: 'בקשה מותאמת',
      customPlaceholder: 'תארו מה תרצו שה-AI ינתח (תמיכה בעברית)...',
      saveAsTemplate: 'שמור כתבנית',
      run: 'הרץ ניתוח',
      running: 'מריץ...',
      highlight: 'הדגש מילים מוצעות במסמך',
      tabRun: 'ריצה',
      tabHistory: 'היסטוריה',
      tabVersions: 'גרסאות',
      // DRAFT he - needs native review
      asyncBannerMsg: 'ניתוח רץ ברקע - עקוב אחר ההתקדמות בעמוד הפעילות',
      asyncBannerDismiss: 'סגור',
    };
    const en: Record<string, string> = {
      title: 'Analysis',
      customPrompt: 'Custom prompt',
      customPlaceholder: 'Describe what you want the AI to analyze (Hebrew supported)...',
      saveAsTemplate: 'Save as template',
      run: 'Run analysis',
      running: 'Running...',
      highlight: 'Highlight suggestion words in document',
      tabRun: 'Run',
      tabHistory: 'History',
      tabVersions: 'Versions',
      asyncBannerMsg: 'Analysis running in the background - track progress in the Activity Center',
      asyncBannerDismiss: 'Dismiss',
    };
    const map = this.panelLang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Localized label for an analysis-type picker button (he default, en fallback). */
  analysisTypeLabel(value: string): string {
    const map = ANALYSIS_TYPE_LABELS[this.panelLang];
    return map[value] ?? value;
  }

  selectedAnalysisType: string = 'Proofread';
  prompt = '';
  selectedTemplateId: string | null = null;
  isRunning = false;
  streamingText = '';
  /**
   * True while an async (long) chapter job is in flight after the overlay has been dismissed.
   * Set on `job-started`; cleared when the run finishes (success, error, or cancel).
   * Drives the compact in-panel progress banner so the user can dismiss it without losing
   * the editor. The Activity Center is the canonical progress home for the duration.
   */
  asyncJobInFlight = false;
  /**
   * Wave 1d (c2): the registry job id of the CURRENT run, captured from `'job-started'` and cleared at the
   * next run start. It is the ONLY input the in-panel progress bar needs: `app-job-progress-inline` reads
   * the percent straight off {@link JobRegistryService.jobById$}, the same owner the run dialog and the
   * Activity Center read, so the three surfaces cannot drift.
   *
   * Deliberately NOT captured from a `sync-result`'s embedded `result.jobId`: that id was minted inside a
   * blocking `/analyze` call and was never seeded into the server's progress tracker, so polling it 404s
   * (see the d1 decision in the Wave 1d plan). It is never tracked, so `jobById$` would render nothing
   * for it anyway; capturing only `job-started` keeps that non-accidental.
   */
  currentRunJobId: string | null = null;
  /**
   * Persistent companion to the transient {@link asyncJobInFlight}. True once the CURRENT in-flight run
   * has gone async (a `job-started` fired) and its banner has NOT been dismissed; cleared at run start,
   * on dismiss, and on every run terminal. Unlike `asyncJobInFlight` (which `ngOnChanges` zeroes on a
   * context switch so the banner does not linger on the wrong chapter), this survives navigation, so
   * `ngOnChanges` can RECONSTRUCT the banner (`asyncJobInFlight = asyncBannerActiveForRun &&
   * isRunningForCurrentContext`) when the user returns to the still-running origin context.
   */
  private asyncBannerActiveForRun = false;

  templates: PromptTemplateDto[] = [];
  history: AnalysisResultDto[] = [];
  /** All analyses from the API (Active + Archived); History tab shows only Archived. Exposed for child component bindings. */
  allAnalyses: AnalysisResultDto[] = [];
  historyFilterType: string | null = null;

  /** When true, emit suggestion ranges so the editor highlights them; when false, emit [] so no highlights are applied. */
  highlightSuggestionsInDocument = true;
  /** Sub-tab: 'run' shows only latest result; 'history' shows filter + list + selected; 'versions' shows saved snapshots. */
  activeSubTab: 'run' | 'history' | 'versions' = 'run';
  /** Error message from last run (e.g. "Proofread text is too long"); cleared on next run or success. */
  runError: string | null = null;
  /** Latest result shown on Run tab (set when run completes or streaming completes). */
  latestResult: AnalysisResultDto | null = null;
  /** Proofread suggestions populated from server-side AnalysisSuggestion rows; shown on Run tab with Accept/Dismiss. */
  proofreadSuggestions: AnalysisSuggestion[] = [];
  /** Keys of dismissed Line Edit suggestions (so we hide them in History). Key: `${resultId}-${original}-${suggested}` */
  dismissedLineEditKeys = new Set<string>();
  /** Keys of accepted Line Edit suggestions in History (read-only display). */
  acceptedLineEditKeys = new Set<string>();
  /** Keys of dismissed Proofread suggestions in History view. Key: `${resultId}-${original}-${suggested}` */
  dismissedProofreadHistoryKeys = new Set<string>();
  /** Keys of accepted Proofread suggestions in History (read-only display). */
  acceptedProofreadHistoryKeys = new Set<string>();
  /** Active run subscription; cancelled on destroy or when starting a new run. */
  private runSubscription: Subscription | null = null;
  /** Original document text at the time of each Proofread run (key = chapterId-sceneId-createdAt). Used so History diff shows all suggestions including accepted. */
  proofreadOriginalDocumentByRunKey = new Map<string, string>();
  /** True after we've restored proofread suggestions for the current chapter/scene (so we don't re-run diff on every documentText change while user edits). */
  private hasRestoredProofreadForCurrentContext = false;
  /**
   * One-shot: a freshly-completed streaming Proofread asks to auto-open its first suggestion once the
   * authoritative (reliability-checked) server row is surfaced via restoreProofreadStateFromLatestResult.
   * Streaming completion itself cannot auto-show: the synthetic result lacks proofreadResultUnreliable,
   * so surfacing is deferred to the loadHistory adopt path instead.
   */
  private autoShowFirstProofreadAfterRestore = false;
  /**
   * True between a streaming Proofread completing and loadHistory adopting the authoritative server row.
   * During this window the synthetic row carries neither suggestions nor the reliability flag, so the Run
   * tab must show a "finalizing" hint instead of a premature "No changes needed" (the run may still surface
   * edits or an unreliable warning). Cleared the moment loadHistory resolves for THIS context (success or
   * error), once the run's own persisted row is available (or retries to fetch it are exhausted).
   */
  proofreadFinalizing = false;
  /**
   * Remaining loadHistory retries while finalizing a streaming Proofread whose persisted row (carrying the
   * reliability flag) has not replicated into the history response yet. Surfacing the client diff before
   * that row arrives would expose an unreliable run's bogus deletion flood, so we wait/retry instead.
   */
  private proofreadFinalizeRetriesLeft = 0;
  private proofreadFinalizeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly proofreadFinalizeMaxRetries = 3;
  private readonly proofreadFinalizeRetryMs = 600;
  /** Versions list for the Versions tab (chapter/scene document snapshots). */
  versions: DocumentVersionDto[] = [];
  /** Timestamp when the current run started (for duration display). */
  private runStartedAt: number | null = null;
  /**
   * Chapter/scene the CURRENT run was started against (captured in prepareForRun). pf-f01 made long runs
   * non-blocking and the panel instance is reused across navigation, so an async terminal can arrive after
   * the user switched chapters. resultBelongsToRunOrigin compares this origin against the live
   * this.chapterId/this.sceneId (mirroring the loadHistory guard); a result whose origin no longer matches
   * is DROPPED, so a prior chapter's result never injects into - or is accepted into - the new chapter's
   * document, and the host is told `result-dropped` instead of a success (c06).
   */
  private runOriginChapterId: string | null = null;
  private runOriginSceneId: string | null = null;
  /**
   * Analysis type the CURRENT run was started against (captured in prepareForRun, same source as the
   * run context sent to the API). The panel instance is reused across navigation, so the `job-started`
   * publish must key the tracked job off THIS snapshot - not live panel state - or a mid-run
   * chapter/scene/type switch would mislabel the job relative to what the API actually ran.
   */
  private runOriginAnalysisType: string = 'Proofread';
  /**
   * Persisted analysis-result ids known BEFORE the current run started (captured in prepareForRun).
   * A streaming run's persisted row is the one whose id is NOT in this set, which is how we tell the
   * just-completed run apart from a pre-existing analysis when deciding whether to swap a synthetic
   * streaming result for its persisted row (see loadHistory).
   */
  private analysisResultIdsBeforeRun = new Set<string>();
  /** Human-readable duration label for the last completed run (e.g. "45s", "2m 10s"). */
  lastRunDurationLabel: string | null = null;
  /** Line Edit suggestions for the current Run tab (from server-side AnalysisSuggestion rows). */
  lineEditRunSuggestions: AnalysisSuggestion[] = [];
  /** True after we've restored Line Edit suggestions for the current chapter/scene (so we don't re-run mapping on every documentText change while user edits). */
  private hasRestoredLineEditForCurrentContext = false;
  /** Consistency suggestions (register/tense/POV) for the current Run tab; navigate-only AnalysisSuggestion rows on the linguistic result. */
  consistencyRunSuggestions: AnalysisSuggestion[] = [];
  /** True after we've restored consistency suggestions for the current chapter/scene. */
  private hasRestoredConsistencyForCurrentContext = false;
  /** Keys of dismissed consistency suggestions (so we hide them in History). Reuses the line-edit key shape. */
  dismissedConsistencyKeys = new Set<string>();
  /** Cached list of Active analyses (by status) for the current chapter/scene, used for re-analysis warnings. */
  private activeAnalyses: AnalysisResultDto[] = [];
  /** True when documentText has changed since the last relocation pass; cleared after relocateAll runs. */
  private offsetsDirty = false;
  /** Snapshot of documentText at the time analysis results were loaded or last relocated; used to detect edits. */
  private lastAnalysisDocumentText = '';
  /** IDs of suggestions currently being explained via the Why? button (empty = none loading). */
  explainingSuggestionIds = new Set<string>();
  /** IDs of suggestions whose originalText can no longer be found in the document (stale after user edit). */
  staleSuggestionIds = new Set<string>();
  /** Server chunk thresholds for analysis-jobs vs sync; set from API so client matches server. */
  chunkThresholds: { proofreadChunkTargetWords: number; lineEditChunkTargetWords: number } | null = null;

  // ── Style baseline (a3/a4) ────────────────────────────────────────────────
  /** Latest style-baseline status read for the current book/language (null while loading / no book). */
  styleBaselineStatus: BookStyleBaselineStatusDto | null = null;
  /** True while a baseline build job is in flight (drives the BUILDING state in the run tab). */
  styleBaselineBuilding = false;
  /** Live baseline build progress 0..100 (null = indeterminate). */
  styleBaselineProgressPercent: number | null = null;
  /** Stops the active baseline progress poll; nulled when no poll is running. */
  private styleBaselineProgressStop$: Subject<void> | null = null;
  /** Active baseline-related subscriptions (status fetch + build + progress); cleared on context change / destroy. */
  private styleBaselineSub: Subscription | null = null;
  /**
   * The latest in-flight GET status fetch. Held so a newer loadStyleBaselineStatus() call cancels the
   * previous one: without this, two overlapping fetches for the SAME (book, language) can resolve out of
   * order and a slower OLDER response would overwrite the newer snapshot (and could trigger a stale
   * reattach to activeBuildJobId). The book/language guard only drops responses after a context SWITCH,
   * not same-key overlaps. Kept separate from styleBaselineSub (the build POST) so reloading status does
   * not cancel an in-flight build, and vice versa.
   */
  private styleBaselineStatusSub: Subscription | null = null;
  /**
   * Loop guard: the last baseline jobId this component instance already drove to a terminal state. Once a
   * jobId is recorded here, loadStyleBaselineStatus will NOT reattach to it again even if the server keeps
   * advertising it as activeBuildJobId (lingering registry entry / race / backend bug). Reset when a NEW
   * build is started in this tab or the book switches, so a genuine future build can reattach normally.
   */
  private styleBaselineHandledTerminalJobId: string | null = null;
  /**
   * Map backend AnalysisSuggestionDto to the unified AnalysisSuggestion shape used in the UI.
   * Offset relocation is handled separately by SuggestionAnchorService in emitSuggestionRanges / onShowInDocument.
   *
   * There is deliberately NO length heuristic here. This used to drop any suggestion where
   * `originalText.length > 60 && suggestedText.length <= 5`, mirroring a server-side guard against
   * diff misalignment. That guard no longer exists in that form: SuggestionDiffService now applies it
   * only to spans produced by SPLITTING a merged range - the case where the mapping can actually be
   * misaligned - and verifies each of those splits against resultText before emitting it. Whole ranges
   * are exempt because their mapping is provably exact, so a big-original/tiny-suggestion shape there
   * is a real large deletion, not a misalignment. The server is the single source of truth for
   * suggestion validity. The client copy had become a silent data-loss bug - removing an
   * accidentally duplicated sentence produces exactly that shape (measured live: a 64-char original
   * collapsing to a 5-char remainder), so a correct, verified correction was discarded before it
   * ever reached the panel. If a malformed suggestion ever appears, fix it at the source.
   */
  private mapDtoSuggestions(
    result: AnalysisResultDto | null | undefined
  ): AnalysisSuggestion[] {
    const list: AnalysisSuggestionDto[] = (result?.suggestions ?? [])
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const mapped: AnalysisSuggestion[] = list.map(dto => ({
      id: dto.id,
      startOffset: dto.startOffset,
      endOffset: dto.endOffset,
      original: dto.originalText,
      suggested: dto.suggestedText,
      reason: dto.reason ?? undefined,
      category: dto.category ?? undefined,
      explanation: dto.explanation ?? undefined,
      outcome: dto.outcome ?? undefined,
      contextBefore: dto.contextBefore ?? undefined,
      contextAfter: dto.contextAfter ?? undefined
    }));

    return mapped;
  }

  ngOnInit(): void {
    this.loadChunkThresholds();
  }

  /**
   * Fetch the server chunk thresholds for the CURRENT book language and cache them for the async-vs-sync
   * decision. The server sizes chunks per language (a dense script like Hebrew/Arabic chunks at a lower word
   * count than the Latin ceiling), so this must send this.language and re-run on a language change — otherwise
   * the client would pick sync /analyze while the server chunks. On error the orchestration falls back to its
   * built-in defaults.
   */
  private loadChunkThresholds(): void {
    this.analysisService.getChunkThresholds(this.language).subscribe({
      next: (t) => { this.chunkThresholds = t; this.cdr.detectChanges(); },
      error: () => { /* use defaults in orchestration */ }
    });
  }

  ngOnDestroy(): void {
    // c01 remedy B. This panel is mounted under `@if (editHelpView === 'analysis')` inside
    // `@else if (reviewMode === 'edit')`, so switching the Edit-help sub-tab or the Review/Edit control
    // DESTROYS it - and the unsubscribe below CANCELS the in-flight run. The host's run dialog is not
    // destroyed with us (it lives outside that `@if`), so without this it keeps a live progress bar up for
    // a run that no longer exists. On the sync path there is no registry job to resolve off either.
    //
    // Emitting an @Output from ngOnDestroy DOES reach the host: Angular's destroyViewTree cleans child
    // views first, and cleanUpView runs executeOnDestroys BEFORE processCleanups, so the parent's output
    // subscription is still live here. Proven by the real-template DOM specs, not assumed.
    //
    // A registry-TRACKED run is deliberately not special-cased here: that job really does keep running
    // server-side, and the dialog's own `jobId === null` guard is what keeps its card waiting for the
    // registry. One guard, in the consumer that owns the state machine.
    if (this.isRunning) {
      this.isRunning = false;
      this.emitRunFinished();
    }
    this.runSubscription?.unsubscribe();
    this.orchestrationService.stopProgressPolling();
    this.clearProofreadFinalizeRetryTimer();
    this.stopStyleBaselineProgress();
    this.styleBaselineSub?.unsubscribe();
    this.styleBaselineStatusSub?.unsubscribe();
    this.styleBaselineHandledTerminalJobId = null;
  }

  // ── Style baseline (a3/a4) ────────────────────────────────────────────────

  /** Effective book language for baseline calls (defaults to 'he'). */
  private get baselineLanguage(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  /** Fetch the current style-baseline status for this book/language and update the run tab. */
  loadStyleBaselineStatus(): void {
    if (!this.bookId) {
      this.styleBaselineStatus = null;
      return;
    }
    const bookId = this.bookId;
    const lang = this.baselineLanguage;
    // Cancel any earlier in-flight status fetch so a slower OLDER response cannot overwrite this newer
    // snapshot (or trigger a stale reattach). The book/language guard below only drops responses after a
    // context SWITCH; it does not cover overlapping fetches for the SAME (book, language).
    this.styleBaselineStatusSub?.unsubscribe();
    this.styleBaselineStatusSub = this.styleBaselineService.getStyleBaselineStatus(bookId, lang).subscribe({
      next: (status) => {
        // Ignore a stale response after the user switched books OR languages (baseline is per (book, language)).
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.styleBaselineStatus = status;
        // If the server already reports it is fresh, we are no longer building.
        if (status.ready && this.styleBaselineBuilding && this.styleBaselineProgressPercent === 100) {
          this.styleBaselineBuilding = false;
        }
        // DEF-2: a build may already be running (this reload, or another tab/session). Reattach so the row
        // shows BUILDING + live progress instead of a stale/not-built snapshot. Guard against double-
        // subscribe: skip when we are already tracking a build in THIS tab (the user just started one) or a
        // progress poll is already live. Also skip if this exact jobId was already driven to terminal here,
        // so a lingering/stale activeBuildJobId can never re-trigger poll -> terminal -> reload -> reattach.
        if (status.activeBuildJobId && status.activeBuildJobId !== this.styleBaselineHandledTerminalJobId && !this.styleBaselineBuilding && !this.styleBaselineProgressStop$) {
          this.styleBaselineBuilding = true;
          this.styleBaselineProgressPercent = null;
          this.pollStyleBaselineBuild(bookId, status.activeBuildJobId, lang);
        }
        this.cdr.detectChanges();
      },
      error: () => {
        // Leave whatever we had; the row simply hides when status is null/unknown.
      },
    });
  }

  /**
   * The run tab's tier toggle committed a tier change (tier-ux-rework fixes c04). Changing the tier for
   * LinguisticAnalysis changes the ACTIVE MODEL, and `builtWithDifferentModel` on the style-baseline status
   * is computed against exactly that - so the cross-model warning rendered just under the toggle is stale
   * the moment the write lands, and used to stay stale until the user reloaded the page.
   *
   * Deliberately routed through `loadStyleBaselineStatus()` rather than issuing a fetch of its own: that
   * method already cancels the previous in-flight status GET and re-checks (book, language) on the answer,
   * so this re-read SUPERSEDES an overlapping one instead of racing it. A second raw fetch beside it would
   * reintroduce exactly the older-answer-wins race that guard exists for.
   */
  onTierChanged(): void {
    this.loadStyleBaselineStatus();
  }

  /** Stop any active baseline progress poll. */
  private stopStyleBaselineProgress(): void {
    if (this.styleBaselineProgressStop$) {
      this.styleBaselineProgressStop$.next();
      this.styleBaselineProgressStop$.complete();
      this.styleBaselineProgressStop$ = null;
    }
  }

  /**
   * Tear down any in-flight baseline build/poll and reset its UI + loop guard. The baseline is keyed by
   * (book, language), so this must run on BOTH a book change AND a language change: either invalidates the
   * current build/poll, which would otherwise keep mutating state for the OLD key.
   */
  private resetStyleBaselineBuildState(): void {
    this.stopStyleBaselineProgress();
    this.styleBaselineSub?.unsubscribe();
    this.styleBaselineStatusSub?.unsubscribe();
    this.styleBaselineBuilding = false;
    this.styleBaselineProgressPercent = null;
    this.styleBaselineStatus = null;
    // Forget any handled jobId so a build for the new book/language can reattach.
    this.styleBaselineHandledTerminalJobId = null;
  }
  /**
   * Consent confirmed in the run tab: start (or no-op) the build, flip to BUILDING, and poll progress.
   * Reuses AnalysisProgressService for live progress (single progress mechanism, no second SignalR sub).
   */
  onBuildStyleBaseline(): void {
    if (!this.bookId) return;
    // Guard: a build is already in flight for this book (started here, or reattached via DEF-2 after a
    // reload / from another tab). Starting another would stop the live progress poll (losing tracking of
    // the running job) and POST a duplicate build for the same (book, language). The consent prompt is
    // hidden while BUILDING, but a lingering/late Confirm could still reach here, so refuse it.
    if (this.styleBaselineBuilding) return;
    const bookId = this.bookId;
    const language = this.baselineLanguage;
    // Defensive: clear any stray progress poll before starting. The guard above already blocks the common
    // in-flight case (BUILDING); this covers a poll left running while the BUILDING flag is somehow false,
    // and ensures the no-op path below cannot leave a live poll updating the row after the UI settles.
    this.stopStyleBaselineProgress();
    this.styleBaselineBuilding = true;
    this.styleBaselineProgressPercent = null;
    // A new build is being started in this tab: clear the loop guard so its (new) jobId can reattach.
    this.styleBaselineHandledTerminalJobId = null;
    this.cdr.detectChanges();

    this.styleBaselineSub?.unsubscribe();
    this.styleBaselineSub = this.styleBaselineService.buildStyleBaseline(bookId, language).subscribe({
      next: (resp) => {
        // Drop a stale response after the user switched books OR languages (baseline is per (book, language)).
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        if (resp.noOp || !resp.jobId) {
          // Nothing to build (already fresh): clear BUILDING and re-read the fresh status.
          this.styleBaselineBuilding = false;
          this.loadStyleBaselineStatus();
          this.cdr.detectChanges();
          return;
        }
        this.pollStyleBaselineBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        this.styleBaselineBuilding = false;
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the baseline build job and refresh status when it reaches a terminal state. */
  private pollStyleBaselineBuild(bookId: string, jobId: string, lang: string): void {
    // rf-c02: publish this build to the job registry so the editor's "review running" affordance (and the
    // Activity Center) can read one truth (jobRegistry.anyRunningForBook$). The run tab keeps its OWN detailed
    // state + poll below; track() is an ADD, not a replacement. track() is idempotent per jobId, so routing
    // BOTH the fresh-build and DEF-2 reattach paths through this single choke-point cannot double-track.
    this.jobRegistry.track('style-baseline', bookId, jobId);
    this.stopStyleBaselineProgress();
    const stop$ = new Subject<void>();
    this.styleBaselineProgressStop$ = stop$;
    this.analysisProgressService.pollStyleBaselineProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        // Ignore a stale poll emit after the user switched books OR languages (baseline is per (book, language)).
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.styleBaselineProgressPercent =
          status === 'succeeded'
            ? 100
            : (Number.isFinite(p.estimatedCompletionPercent)
                ? Math.max(0, Math.min(100, p.estimatedCompletionPercent))
                : this.styleBaselineProgressPercent);
        if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
          this.styleBaselineBuilding = false;
          this.stopStyleBaselineProgress();
          // Mark this jobId handled BEFORE re-reading status so a lingering activeBuildJobId can't loop.
          this.styleBaselineHandledTerminalJobId = jobId;
          this.loadStyleBaselineStatus();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.styleBaselineBuilding = false;
        this.stopStyleBaselineProgress();
        // Treat a polling error as terminal for this jobId: mark handled so we don't reattach in a loop.
        this.styleBaselineHandledTerminalJobId = jobId;
        this.loadStyleBaselineStatus();
        this.cdr.detectChanges();
      },
    });
  }

  /** Cancel any pending "wait for the run's persisted row" retry and reset its budget. */
  private clearProofreadFinalizeRetryTimer(): void {
    if (this.proofreadFinalizeRetryTimer != null) {
      clearTimeout(this.proofreadFinalizeRetryTimer);
      this.proofreadFinalizeRetryTimer = null;
    }
  }

  constructor(
    private analysisService: AnalysisService,
    private documentVersionService: DocumentVersionService,
    private cdr: ChangeDetectorRef,
    private orchestrationService: AnalysisRunOrchestrationService,
    private lineEditParser: LineEditParserService,
    private suggestionKeyService: SuggestionKeyService,
    private suggestionAnchorService: SuggestionAnchorService,
    private styleBaselineService: StyleBaselineService,
    private analysisProgressService: AnalysisProgressService,
    private jobRegistry: JobRegistryService
  ) {}


  get canRun(): boolean {
    if (!this.bookId || !this.chapterId) return false;
    if (this.selectedAnalysisType === 'Custom') return !!this.prompt?.trim();
    return true;
  }

  /**
   * True only when this panel's own in-flight run belongs to the CURRENTLY displayed context. pf-f01
   * made long runs non-blocking and the panel instance is REUSED across navigation, so `isRunning`
   * alone is not context-scoped: after a mid-run switch it would keep the Run button disabled/"Running…"
   * on a DIFFERENT chapter that has no live run of its own. Gating the button label/disabled state and
   * the run guards on this getter instead lets a new context start its own run while the origin's
   * background job keeps running (tracked by the JobRegistry, recovered by loadHistory on return), and
   * restores the "Running…" state when the user navigates back to the origin. Scene-precise, mirroring
   * the {@link resultBelongsToRunOrigin} drop-guard.
   */
  get isRunningForCurrentContext(): boolean {
    return this.isRunning
      && this.runOriginChapterId === this.chapterId
      && this.runOriginSceneId === (this.sceneId ?? null);
  }

  onSelectAnalysisType(type: string): void {
    this.selectedAnalysisType = type;

    if (!this.allAnalyses || this.allAnalyses.length === 0) {
      this.activeSubTab = 'run';
      return;
    }

    const activeForType = this.activeAnalyses.filter(
      r => (r.analysisType || r.type) === type
    );
    const allForType = this.allAnalyses.filter(
      r => (r.analysisType || r.type) === type
    );
    const candidates = (activeForType.length ? activeForType : allForType)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const candidate = candidates[0];

    if (!candidate) {
      this.activeSubTab = 'run';
      return;
    }

    this.latestResult = candidate;

    if (this.documentMatchesCurrentContext && this.documentText) {
      if (type === 'Proofread') {
        this.restoreProofreadStateFromLatestResult();
      } else if (type === 'LineEdit') {
        this.restoreLineEditStateFromResult(candidate);
      } else if (type === 'LinguisticAnalysis') {
        this.restoreConsistencyStateFromResult(candidate);
      }
    }

    this.activeSubTab = 'run';
  }

  setHistoryFilter(type: string | null): void {
    this.historyFilterType = type;
    // When we already have a full history snapshot, just rebuild client-side
    // from allAnalyses to avoid an extra network round-trip on every filter click.
    if (this.allAnalyses && this.allAnalyses.length) {
      this.rebuildHistoryFromAllAnalyses();
      // Preserve any in-flight streaming run (no id) in the History list,
      // but only when its analysis type matches the current history filter (or when showing All).
      if (this.latestResult && !this.latestResult.id) {
        const latestType = this.latestResult.analysisType || this.latestResult.type;
        if (!this.historyFilterType || latestType === this.historyFilterType) {
          this.history = [this.latestResult, ...this.history];
        }
      }
    } else {
      this.loadHistory();
    }
  }

  /** Call after Revert (or other outcome change) so History tab shows updated suggestion statuses (e.g. Reverted). */
  refreshHistory(): void {
    this.loadHistory();
  }

  /** Reload versions list and outcomes so Versions tab updates (e.g. Revert → Redo button, or after Redo). */
  refreshVersions(): void {
    this.loadVersions();
  }

  loadVersions(): void {
    if (!this.bookId || !this.chapterId) return;
    this.documentVersionService.list(this.bookId, this.chapterId, this.sceneId ?? undefined).subscribe({
      next: (list) => {
        const raw = list ?? [];
        // Sort newest → oldest so we keep the latest snapshot per suggestion when de-duping.
        raw.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const seenSuggestionIds = new Set<string>();
        const seenSuggestionKeys = new Set<string>();
        const deduped: DocumentVersionDto[] = [];

        for (const v of raw) {
          const sid = (v.suggestionId ?? '').toLowerCase();
          if (sid) {
            if (seenSuggestionIds.has(sid)) {
              continue;
            }
            seenSuggestionIds.add(sid);
            deduped.push(v);
            continue;
          }

          if (v.originalText != null && v.suggestedText != null) {
            const key = `${normalizeTextForAnalysis(v.originalText)}\u241f${normalizeTextForAnalysis(v.suggestedText)}`;
            if (seenSuggestionKeys.has(key)) {
              continue;
            }
            seenSuggestionKeys.add(key);
            deduped.push(v);
          } else {
            deduped.push(v);
          }
        }

        this.versions = deduped;
        this.cdr.detectChanges();
      },
      error: () => {
        this.versions = [];
        this.cdr.detectChanges();
      }
    });
  }

  onRevert(versionId: string): void {
    this.revertToVersion.emit(versionId);
  }


  /** Re-apply the suggestion (replace original with suggested), set outcome to Accepted, refresh versions and history. */
  onRedoVersion(v: DocumentVersionDto): void {
    const analysisId = v.analysisResultId ?? v.analysisId;
    if (!analysisId || v.originalText == null || v.suggestedText == null || !this.bookId || !this.chapterId) return;

    let dto: AnalysisSuggestionDto | null = null;
    const suggestionId = (v.suggestionId ?? '').toLowerCase();
    if (suggestionId) {
      dto = this.findSuggestionDtoById(suggestionId);
    }

    if (!dto) {
      const aidLower = analysisId.toLowerCase();
      const orig = normalizeTextForAnalysis(v.originalText);
      const sugg = normalizeTextForAnalysis(v.suggestedText);
      const analysis = this.allAnalyses.find(r => (r.id || '').toLowerCase() === aidLower);
      dto = analysis?.suggestions?.find(s =>
        normalizeTextForAnalysis(s.originalText ?? '') === orig &&
        normalizeTextForAnalysis(s.suggestedText ?? '') === sugg
      ) ?? null;
    }

    if (!dto?.id) {
      // Legacy analyses without persisted suggestions: still re-apply in the editor and refresh
      // History/Versions so the UI no longer shows this version as "reverted".
      this.applyCorrection.emit({
        text: v.suggestedText,
        originalText: v.originalText,
        analysisId,
        skipCreatingVersion: true
      });
      this.refreshHistory();
      this.refreshVersions();
      return;
    }

    // Re-apply the suggestion in the editor without creating another version.
    this.applyCorrection.emit({
      text: v.suggestedText,
      originalText: v.originalText,
      analysisId,
      skipCreatingVersion: true
    });

    dto.outcome = 'Accepted';
    const key = this.proofreadSuggestionKeyForDto(dto);
    if (key) this.suggestionKeyService.trackRecentOutcomeKey(key);

    this.analysisService
      .updateSuggestionOutcome(this.bookId, this.chapterId, dto.id, 'Accepted')
      .subscribe({
        next: () => {
          // Refresh lists so Versions/History reflect new outcome and styling.
          this.loadHistory(true);
          this.loadVersions();
        },
        error: () => {
          // Even if PATCH fails, refresh so UI reflects whatever the server currently has.
          this.refreshHistory();
          this.refreshVersions();
        }
      });
  }



  markSuggestionReverted(analysisId: string, originalText: string, suggestedText: string, suggestionId?: string | null): void {
    const { updatedSuggestionIds } = suggestionId
      ? this.suggestionKeyService.markSuggestionRevertedById(this.latestResult, this.allAnalyses, suggestionId)
      : this.suggestionKeyService.markSuggestionReverted(this.latestResult, this.allAnalyses, analysisId, originalText, suggestedText);

    this.persistRevertedOutcomes(updatedSuggestionIds);
  }

  private persistRevertedOutcomes(updatedSuggestionIds: Set<string>): void {
    if (!this.bookId || !this.chapterId || updatedSuggestionIds.size === 0) {
      this.refreshHistory();
      this.refreshVersions();
      return;
    }

    const calls = Array.from(updatedSuggestionIds).map(id =>
      this.analysisService.updateSuggestionOutcome(this.bookId!, this.chapterId!, id, 'Reverted')
    );

    forkJoin(calls).subscribe({
      next: () => {
        this.refreshHistory();
        this.refreshVersions();
      },
      error: () => {
        this.refreshHistory();
        this.refreshVersions();
      }
    });
  }


  getLineEdit(current: AnalysisResultDto) {
    return this.lineEditParser.getLineEdit(current);
  }


  private recomputeLineEditOffsets(): void {
    const result = this.lineEditParser.recomputeLineEditOffsets(this.lineEditRunSuggestions, this.documentText);
    if (result.changed) {
      this.lineEditRunSuggestions = [...result.suggestions];
      this.emitSuggestionRanges();
    }
  }

  onLineEditAccept(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    if (suggestion.stale || (suggestion.id && this.staleSuggestionIds.has(suggestion.id))) return;
    const startOffset = suggestion.startOffset;
    const endOffset = suggestion.endOffset;
    if (startOffset != null && endOffset != null) {
      this.applyCorrection.emit({
        text: suggestion.suggested,
        startOffset,
        endOffset,
        originalText: suggestion.original,
        analysisId: current.id,
        suggestionId: suggestion.id
      });
    } else {
      this.applyCorrection.emit({
        text: suggestion.suggested,
        originalText: suggestion.original,
        analysisId: current.id,
        suggestionId: suggestion.id
      });
    }
    const key = this.suggestionKeyService.lineEditSuggestionKey(current, {
      original: suggestion.original,
      suggested: suggestion.suggested
    });
    this.acceptedLineEditKeys = new Set([...this.acceptedLineEditKeys, key]);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    if (this.bookId && this.chapterId && current.id && suggestion.id) {
      this.applyOutcomeToSuggestionDtos(suggestion.id, 'Accepted');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, suggestion.id, 'Accepted')
        .subscribe({ error: () => {} });
    }
    this.lineEditRunSuggestions = [];
    this.hasRestoredLineEditForCurrentContext = false;
    this.emitSuggestionRanges();
  }

  onLineEditDismiss(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    const key = this.suggestionKeyService.lineEditSuggestionKey(current, {
      original: suggestion.original,
      suggested: suggestion.suggested
    });
    this.dismissedLineEditKeys = new Set([...this.dismissedLineEditKeys, key]);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    // Remove from the current Run tab suggestions so dismissed items disappear immediately
    this.lineEditRunSuggestions = this.lineEditRunSuggestions.filter(x => x !== suggestion);
    if (this.bookId && this.chapterId && current.id && suggestion.id) {
      this.applyOutcomeToSuggestionDtos(suggestion.id, 'Dismissed');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, suggestion.id, 'Dismissed')
        .subscribe({ error: () => {} });
    }
    if (suggestion.startOffset != null && suggestion.endOffset != null) {
      this.scrollTargetChange.emit({ startOffset: suggestion.startOffset, endOffset: suggestion.endOffset, originalText: suggestion.original || undefined });
    }
    this.emitSuggestionRanges();
  }

  /** Dismiss a navigate-only consistency suggestion (no Accept in v1); persists the outcome like line-edit. */
  onConsistencyDismiss(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    const key = this.suggestionKeyService.lineEditSuggestionKey(current, {
      original: suggestion.original,
      suggested: suggestion.suggested
    });
    this.dismissedConsistencyKeys = new Set([...this.dismissedConsistencyKeys, key]);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    // Remove from the current Run tab list so the dismissed item disappears immediately.
    this.consistencyRunSuggestions = this.consistencyRunSuggestions.filter(x => x !== suggestion);
    if (this.bookId && this.chapterId && current.id && suggestion.id) {
      this.applyOutcomeToSuggestionDtos(suggestion.id, 'Dismissed');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, suggestion.id, 'Dismissed')
        .subscribe({ error: () => {} });
    }
    if (suggestion.startOffset != null && suggestion.endOffset != null) {
      this.scrollTargetChange.emit({ startOffset: suggestion.startOffset, endOffset: suggestion.endOffset, originalText: suggestion.original || undefined });
    }
    this.emitSuggestionRanges();
  }

  onShowInDocument(s: AnalysisSuggestion): void {
    if (this.documentText && s.original) {
      const relocated = this.suggestionAnchorService.relocateOne(s, this.documentText);
      s.startOffset = relocated.relocatedStart;
      s.endOffset = relocated.relocatedEnd;
      s.stale = relocated.stale;
      if (s.id) {
        if (relocated.stale) {
          this.staleSuggestionIds = new Set([...this.staleSuggestionIds, s.id]);
        } else {
          const updated = new Set(this.staleSuggestionIds);
          updated.delete(s.id);
          this.staleSuggestionIds = updated;
        }
      }
    }
    if (s.startOffset != null && s.endOffset != null && !s.stale) {
      this.showInDocument.emit({
        suggestionId: s.id,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original || undefined
      });
    } else if (s.original) {
      this.showInDocument.emit({
        suggestionId: s.id,
        originalText: s.original
      });
    }
  }

  /** Auto-select the first suggestion's range in the editor so the user immediately sees what changed. */
  private autoShowFirstSuggestion(): void {
    if (!this.proofreadSuggestions.length) return;
    const first = this.proofreadSuggestions[0];
    if (first.startOffset != null && first.endOffset != null) {
      this.showInDocument.emit({
        suggestionId: first.id,
        startOffset: first.startOffset,
        endOffset: first.endOffset,
        originalText: first.original || undefined
      });
    }
  }

  onProofreadAccept(s: AnalysisSuggestion): void {
    if (s.stale || (s.id && this.staleSuggestionIds.has(s.id))) return;
    if (s.startOffset != null && s.endOffset != null) {
      this.applyCorrection.emit({
        text: s.suggested,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original,
        analysisId: this.latestResult?.id ?? undefined,
        suggestionId: s.id
      });
    } else {
      this.applyCorrection.emit({
        text: s.suggested,
        originalText: s.original,
        analysisId: this.latestResult?.id ?? undefined,
        suggestionId: s.id
      });
    }
    if (this.latestResult) {
      const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult, s);
      this.acceptedProofreadHistoryKeys = new Set([...this.acceptedProofreadHistoryKeys, key]);
      this.suggestionKeyService.trackRecentOutcomeKey(key);
      if (this.bookId && this.chapterId && this.latestResult.id && s.id) {
        this.applyOutcomeToSuggestionDtos(s.id, 'Accepted');
        this.analysisService
          .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Accepted')
          .subscribe({ error: () => {} });
      }
    }
    this.proofreadSuggestions = [];
    this.hasRestoredProofreadForCurrentContext = false;
    this.emitSuggestionRanges();
    this.cdr.detectChanges();
  }

  onProofreadDismiss(s: AnalysisSuggestion): void {
    this.proofreadSuggestions = this.proofreadSuggestions.filter(x => x !== s);
    if (this.latestResult) {
      const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult, s);
      this.dismissedProofreadHistoryKeys = new Set([...this.dismissedProofreadHistoryKeys, key]);
      this.suggestionKeyService.trackRecentOutcomeKey(key);
      if (this.bookId && this.chapterId && this.latestResult.id && s.id) {
        this.applyOutcomeToSuggestionDtos(s.id, 'Dismissed');
        this.analysisService
          .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Dismissed')
          .subscribe({ error: () => {} });
      }
    }
    if (s.startOffset != null && s.endOffset != null) {
      this.scrollTargetChange.emit({ startOffset: s.startOffset, endOffset: s.endOffset, originalText: s.original || undefined });
    }
    this.emitSuggestionRanges();
    this.cdr.detectChanges();
  }

  private applyExplanationToSuggestionDtos(suggestionId: string, explanation: string): void {
    const apply = (result: AnalysisResultDto | null | undefined) => {
      const dto = result?.suggestions?.find(x => x.id === suggestionId);
      if (dto) dto.explanation = explanation;
    };
    apply(this.latestResult);
    this.allAnalyses?.forEach(r => { if (r !== this.latestResult) apply(r); });
  }

  private applyOutcomeToSuggestionDtos(
    suggestionId: string,
    outcome: 'Accepted' | 'Dismissed' | 'Reverted' | 'Superseded'
  ): void {
    this.suggestionKeyService.applyOutcomeToSuggestionDtos(
      this.latestResult, this.allAnalyses, suggestionId, outcome
    );
  }

  private findSuggestionDtoById(suggestionId: string): AnalysisSuggestionDto | null {
    return this.suggestionKeyService.findSuggestionDtoById(
      this.latestResult, this.allAnalyses, suggestionId
    );
  }

  private proofreadSuggestionKeyForDto(dto: AnalysisSuggestionDto): string | null {
    return this.suggestionKeyService.proofreadSuggestionKeyForDto(this.allAnalyses, dto);
  }

  onExplainSuggestion(s: AnalysisSuggestion): void {
    if (!s.id || !this.bookId || !this.chapterId) return;
    if (this.explainingSuggestionIds.has(s.id)) return;
    this.explainingSuggestionIds.add(s.id);
    this.cdr.detectChanges();
    this.analysisService.explainSuggestion(this.bookId, this.chapterId, s.id).subscribe({
      next: (res) => {
        s.explanation = res.explanation;
        this.applyExplanationToSuggestionDtos(s.id!, res.explanation);
        this.explainingSuggestionIds.delete(s.id!);
        this.cdr.detectChanges();
      },
      error: () => {
        this.explainingSuggestionIds.delete(s.id!);
        this.cdr.detectChanges();
      }
    });
  }

  onProofreadHistoryAccept(event: { suggestion: AnalysisSuggestion; result: AnalysisResultDto }): void {
    const { suggestion: s, result: current } = event;
    if (s.startOffset != null && s.endOffset != null) {
      this.applyCorrection.emit({
        text: s.suggested,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original,
        analysisId: current.id
      });
    } else {
      this.applyCorrection.emit({ text: s.suggested, originalText: s.original, analysisId: current.id });
    }
    const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
    this.acceptedProofreadHistoryKeys = new Set([...this.acceptedProofreadHistoryKeys, key]);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    if (this.bookId && this.chapterId && current.id && s.id) {
      this.applyOutcomeToSuggestionDtos(s.id, 'Accepted');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Accepted')
        .subscribe({ error: () => {} });
    }
    this.proofreadSuggestions = [];
    this.hasRestoredProofreadForCurrentContext = false;
    this.emitSuggestionRanges();
  }

  onProofreadHistoryDismiss(event: { suggestion: AnalysisSuggestion; result: AnalysisResultDto }): void {
    const { suggestion: s, result: current } = event;
    const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
    this.dismissedProofreadHistoryKeys = new Set([...this.dismissedProofreadHistoryKeys, key]);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    if (this.bookId && this.chapterId && current.id && s.id) {
      this.applyOutcomeToSuggestionDtos(s.id, 'Dismissed');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Dismissed')
        .subscribe({ error: () => {} });
    }
  }

  /**
   * Emit current suggestion ranges so the editor can show highlights.
   * For Proofread, uses proofreadSuggestions; for Line Edit, uses lineEditRunSuggestions.
   * When highlightSuggestionsInDocument is false, emits [].
   */
  private emitSuggestionRanges(): void {
    if (!this.highlightSuggestionsInDocument) {
      this.suggestionRangesChange.emit([]);
      return;
    }
    const type = this.latestResult?.analysisType || this.latestResult?.type;
    let source: AnalysisSuggestion[] = [];
    if (type === 'Proofread') {
      // An unreliable proofread's suggestions are not trustworthy (empty / unrelated / dropped-span -
      // often a flood of bogus deletions). Never surface them as document highlights regardless of what
      // the array currently holds: a streaming run can briefly carry a client-diff before loadHistory
      // adopts the flagged server row, and any later re-emit (document edit, context restore) must also
      // stay clear. emitSuggestionRanges is the single chokepoint for highlights, so gate it here.
      source = this.latestResult?.proofreadResultUnreliable ? [] : this.proofreadSuggestions;
    } else if (type === 'LineEdit') {
      source = this.lineEditRunSuggestions;
    } else if (type === 'LinguisticAnalysis') {
      source = this.consistencyRunSuggestions;
    } else {
      this.suggestionRangesChange.emit([]);
      return;
    }

    if (this.offsetsDirty && this.documentText) {
      const relocated = this.suggestionAnchorService.relocateAll(source, this.documentText);
      const newStale = new Set<string>();
      for (let i = 0; i < source.length; i++) {
        // Null-offset consistency fallback items (be-c01: located nowhere) stay non-navigable and
        // are never treated as stale: there is no anchor to move, only a descriptive cue to preserve.
        if (isConsistencySuggestion(source[i]) && source[i].startOffset == null && source[i].endOffset == null) {
          continue;
        }
        source[i].startOffset = relocated[i].relocatedStart;
        source[i].endOffset = relocated[i].relocatedEnd;
        source[i].stale = relocated[i].stale;
        if (relocated[i].stale && source[i].id) {
          newStale.add(source[i].id!);
        }
      }

      const stalePending = source.filter(s => {
        if (!s.stale || !s.id) return false;
        // Consistency issues are navigate-only awareness items: a moved span is shown stale (dimmed,
        // Show disabled) but NOT auto-dismissed - dropping it would erase a scarce, high-value signal
        // (be-c01 fallback decision). Only the user dismisses a consistency issue.
        if (isConsistencySuggestion(s)) return false;
        const outcome = (s.outcome || '').toLowerCase();
        return !outcome || outcome === 'pending';
      });
      if (stalePending.length > 0) {
        const dismissedIds = new Set<string>();
        for (const s of stalePending) {
          dismissedIds.add(s.id!);
          this.applyOutcomeToSuggestionDtos(s.id!, 'Dismissed');
          if (this.bookId && this.chapterId) {
            this.analysisService
              .updateSuggestionOutcome(this.bookId, this.chapterId, s.id!, 'Dismissed')
              .subscribe({ error: () => {} });
          }
          if (this.latestResult && type === 'Proofread') {
            const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult, s);
            this.dismissedProofreadHistoryKeys = new Set([...this.dismissedProofreadHistoryKeys, key]);
            this.suggestionKeyService.trackRecentOutcomeKey(key);
          } else if (this.latestResult && type === 'LineEdit') {
            const key = this.suggestionKeyService.lineEditSuggestionKey(this.latestResult, {
              original: s.original,
              suggested: s.suggested
            });
            this.dismissedLineEditKeys = new Set([...this.dismissedLineEditKeys, key]);
            this.suggestionKeyService.trackRecentOutcomeKey(key);
          }
          newStale.delete(s.id!);
        }
        if (type === 'Proofread') {
          this.proofreadSuggestions = this.proofreadSuggestions.filter(s => !s.id || !dismissedIds.has(s.id));
          source = this.proofreadSuggestions;
        } else if (type === 'LineEdit') {
          this.lineEditRunSuggestions = this.lineEditRunSuggestions.filter(s => !s.id || !dismissedIds.has(s.id));
          source = this.lineEditRunSuggestions;
        }
      }

      this.staleSuggestionIds = newStale;
      this.offsetsDirty = false;
      this.lastAnalysisDocumentText = this.documentText;
    }

    const ranges = source
      .filter(s => !s.stale && s.startOffset != null && s.endOffset != null)
      .map(s => ({
        suggestionId: s.id,
        startOffset: s.startOffset!,
        endOffset: s.endOffset!
      }));
    this.suggestionRangesChange.emit(ranges);
  }

  /** Called when the user toggles "Highlight suggestion words in document"; re-emit so editor updates. */
  onHighlightOptionChange(): void {
    this.emitSuggestionRanges();
  }


  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['chapterId'] || changes['sceneId']) {
      // Clear run state so we don't show another chapter's suggestions; history load will restore if available
      this.latestResult = null;
      // pf-f01 made long runs non-blocking: the panel instance is REUSED across navigation, so a switch
      // mid-run must not leave the PRIOR chapter's "running in background" banner lingering on the NEW
      // chapter. The background job keeps running (it is tracked by the JobRegistry / Activity Center and
      // its result persists server-side); we only reconcile this panel's transient banner flag here.
      // Reconcile the banner to the CURRENT context: switching AWAY from the running origin hides it
      // (isRunningForCurrentContext is false there), while returning to the still-running origin restores
      // it (asyncBannerActiveForRun persists across the switch, unless the run terminated or the user
      // dismissed it). When the user returns to the original chapter, the guarded loadHistory below also
      // re-surfaces the persisted row.
      this.asyncJobInFlight = this.asyncBannerActiveForRun && this.isRunningForCurrentContext;
      this.proofreadSuggestions = [];
      this.lineEditRunSuggestions = [];
      this.consistencyRunSuggestions = [];
      this.history = [];
      this.allAnalyses = [];
      this.activeAnalyses = [];
      this.dismissedProofreadHistoryKeys = new Set();
      this.acceptedProofreadHistoryKeys = new Set();
      this.dismissedLineEditKeys = new Set();
      this.acceptedLineEditKeys = new Set();
      this.dismissedConsistencyKeys = new Set();
      this.streamingText = '';
      // Drop streaming-Proofread finalize state from the PREVIOUS context: a stale auto-show one-shot would
      // otherwise open a suggestion from an unrelated run, and a stale finalizing flag / retry timer would
      // bleed into the new chapter/scene.
      this.autoShowFirstProofreadAfterRestore = false;
      this.proofreadFinalizing = false;
      this.proofreadFinalizeRetriesLeft = 0;
      this.clearProofreadFinalizeRetryTimer();
      this.hasRestoredProofreadForCurrentContext = false;
      this.hasRestoredLineEditForCurrentContext = false;
      this.hasRestoredConsistencyForCurrentContext = false;
      this.offsetsDirty = false;
      this.lastAnalysisDocumentText = '';
      this.explainingSuggestionIds.clear();
      this.staleSuggestionIds = new Set();
      // Clear versions so we don't show versions from another chapter/scene.
      this.versions = [];
      // Reset history filter so we load all types for the new chapter and can restore Proofread state
      this.historyFilterType = null;
      // Switching book invalidates the baseline status + any in-flight build poll.
      if (changes['bookId']) {
        this.resetStyleBaselineBuildState();
      }
      if (this.bookId && this.chapterId) {
        this.loadTemplates();
        this.loadHistory();
        // Eagerly load versions for the new context so Versions tab and
        // version-related helpers (isVersionReverted / isVersionLocked)
        // have up-to-date data regardless of the currently active sub-tab.
        this.loadVersions();
      }
      if (this.bookId) {
        this.loadStyleBaselineStatus();
      }
    }
    if (changes['bookLanguage'] && this.bookId && this.chapterId) {
      this.loadTemplates();
    }
    // Chunk thresholds are language-dependent (dense scripts chunk at a lower word count than the Latin
    // ceiling), so re-fetch them when the language switches so the async-vs-sync decision keeps matching the
    // server. ngOnInit does the initial load, so skip the first change to avoid a duplicate request.
    if (changes['bookLanguage'] && !changes['bookLanguage'].isFirstChange()) {
      this.loadChunkThresholds();
    }
    // The style baseline status is per-language; re-read it when the book language changes (independent of
    // chapter). Tear down the OLD-language build/poll/guard FIRST so a late response for the superseded
    // language can't bleed into the new language's status. The bookId-change branch above already
    // resets+reloads it; this covers a language-only change.
    if (changes['bookLanguage'] && !changes['bookId'] && this.bookId) {
      this.resetStyleBaselineBuildState();
      this.loadStyleBaselineStatus();
    }
    if (changes['documentText']) {
      if (this.lastAnalysisDocumentText && this.documentText !== this.lastAnalysisDocumentText) {
        this.offsetsDirty = true;
      }
      // Only restore when we have no suggestions yet and document text is for the current chapter/scene,
      // and we haven't already restored for this context (avoids re-diffing on every edit). Skip while a
      // streaming Proofread is finalizing: the synthetic row carries client-diff resultText but not yet the
      // server reliability flag, so diffing it now would emit highlights, consume the auto-show one-shot, and
      // flash bogus cards for an unreliable run before the deferred loadHistory path can suppress them.
      if (
        !this.hasRestoredProofreadForCurrentContext &&
        !this.proofreadFinalizing &&
        this.proofreadSuggestions.length === 0 &&
        this.documentMatchesCurrentContext &&
        this.documentText
      ) {
        this.restoreProofreadStateFromLatestResult();
      }

      // For Line Edit, when we have a latestResult and the document now matches the current context,
      // restore run-tab suggestions once (so offsets are computed against the correct document).
      if (
        this.latestResult &&
        (this.latestResult.analysisType || this.latestResult.type) === 'LineEdit' &&
        !this.hasRestoredLineEditForCurrentContext &&
        this.lineEditRunSuggestions.length === 0 &&
        this.documentMatchesCurrentContext &&
        this.documentText
      ) {
        this.restoreLineEditStateFromResult(this.latestResult);
        this.hasRestoredLineEditForCurrentContext = true;
      }

      // For LinguisticAnalysis consistency issues, restore run-tab suggestions once the document
      // matches the current context (so navigate offsets are validated against the right document).
      if (
        this.latestResult &&
        (this.latestResult.analysisType || this.latestResult.type) === 'LinguisticAnalysis' &&
        !this.hasRestoredConsistencyForCurrentContext &&
        this.consistencyRunSuggestions.length === 0 &&
        this.documentMatchesCurrentContext &&
        this.documentText
      ) {
        this.restoreConsistencyStateFromResult(this.latestResult);
        this.hasRestoredConsistencyForCurrentContext = true;
      }

      // Offset-recompute: when documentText becomes available and existing Line Edit
      // suggestions have null offsets (e.g. from salvaged JSON parsed before the editor
      // loaded), re-run offset mapping so "Show" can use precise navigation.
      if (
        this.documentText &&
        this.lineEditRunSuggestions.length > 0 &&
        this.lineEditRunSuggestions.some(s => s.startOffset == null || s.endOffset == null)
      ) {
        this.recomputeLineEditOffsets();
      }
    }
  }

  /**
   * When we have a Proofread latestResult and document text for the current chapter,
   * restore proofread suggestions and emit ranges so highlights show.
   * Prefers server-side suggestions (which carry id, explanation, outcome) and falls back
   * to client-side proofreadDiff for legacy/streaming runs that lack persisted suggestions.
   * Filters out suggestions that are already accepted or dismissed so they don't reappear on Run tab.
   */
  private restoreProofreadStateFromLatestResult(): void {
    if (!this.latestResult) return;
    const type = this.latestResult.analysisType || this.latestResult.type;
    if (type !== 'Proofread') return;

    // Read-and-clear the streaming auto-show request: a freshly-completed streaming proofread deferred
    // surfacing to this method, so this is where we honor its "open the first suggestion" intent. Clear
    // it unconditionally (even on the unreliable early-return) so an unrelated later restore - a context
    // switch, a History click - never inherits a stale request, and an unreliable run never auto-shows.
    const autoShowFirst = this.autoShowFirstProofreadAfterRestore;
    this.autoShowFirstProofreadAfterRestore = false;

    // Unreliable proofread (empty / unrelated / dropped-span): do not surface the (bogus) suggestions or
    // their document highlights when restoring from History/context - matches the live Run-tab behavior.
    if (this.latestResult.proofreadResultUnreliable) {
      this.proofreadSuggestions = [];
      this.hasRestoredProofreadForCurrentContext = true;
      this.offsetsDirty = true;
      this.emitSuggestionRanges(); // re-emit empty => clears any highlights
      return;
    }

    let all: AnalysisSuggestion[];
    if (this.latestResult.suggestions && this.latestResult.suggestions.length) {
      all = this.mapDtoSuggestions(this.latestResult);
    } else if (this.documentText && this.latestResult.resultText) {
      all = proofreadDiff(this.documentText, this.latestResult.resultText);
    } else {
      return;
    }

    this.proofreadSuggestions = all.filter(s => {
      const outcome = (s.outcome || '').toLowerCase();
      // Treat Reverted as actionable again on the Run tab:
      // only hide Accepted, Dismissed, and Superseded.
      if (outcome === 'accepted' || outcome === 'dismissed' || outcome === 'superseded') return false;
      const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult!, s);
      return !this.acceptedProofreadHistoryKeys.has(key) && !this.dismissedProofreadHistoryKeys.has(key);
    });
    this.hasRestoredProofreadForCurrentContext = true;
    this.offsetsDirty = true;
    this.emitSuggestionRanges();
    if (autoShowFirst) this.autoShowFirstSuggestion();
  }

  /**
   * Restore Line Edit suggestions for the Run tab from the given result.
   * Prefers server-side suggestions (including outcome), and falls back to structuredResult
   * when no suggestions DTOs exist. Filters out suggestions that are already accepted,
   * dismissed, reverted, or superseded so they don't reappear on the Run tab.
   */
  private restoreLineEditStateFromResult(result: AnalysisResultDto): void {
    if ((result.analysisType || result.type) !== 'LineEdit') return;

    const mapped = this.mapDtoSuggestions(result).filter(s => !isConsistencySuggestion(s));
    const base: AnalysisSuggestion[] = mapped.length
      ? mapped
      : (() => {
          const lineEdit = this.getLineEdit(result);
          return lineEdit ? this.lineEditParser.toLineEditSuggestionsWithOffsets(lineEdit.suggestions, this.documentText) : [];
        })();

    this.lineEditRunSuggestions = base.filter(s => {
      const outcome = (s.outcome || '').toLowerCase();
      if (outcome === 'accepted' || outcome === 'dismissed' || outcome === 'superseded') {
        return false;
      }
      const key = this.suggestionKeyService.lineEditSuggestionKey(result, {
        original: s.original,
        suggested: s.suggested
      });
      return !this.acceptedLineEditKeys.has(key) && !this.dismissedLineEditKeys.has(key);
    });
    this.hasRestoredLineEditForCurrentContext = true;
    this.offsetsDirty = true;
    this.emitSuggestionRanges();
  }

  /**
   * Restore consistency (register/tense/POV) suggestions for the Run tab from a LinguisticAnalysis result.
   * These are navigate-only AnalysisSuggestion rows (empty suggested, category consistency-*). Sourced ONLY
   * from result.suggestions so there is a single source of truth (NOT from the structuredResult chips).
   * Filters out already accepted/dismissed/superseded items so they don't reappear on the Run tab.
   * Keeps null-offset fallback items (descriptive, non-navigable) so the user still sees them.
   */
  private restoreConsistencyStateFromResult(result: AnalysisResultDto): void {
    if ((result.analysisType || result.type) !== 'LinguisticAnalysis') return;

    // mapDtoSuggestions never filters by length, so a long consistency span still comes through as a real signal.
    const mapped = this.mapDtoSuggestions(result).filter(s => isConsistencySuggestion(s));

    this.consistencyRunSuggestions = mapped.filter(s => {
      const outcome = (s.outcome || '').toLowerCase();
      if (outcome === 'accepted' || outcome === 'dismissed' || outcome === 'superseded') {
        return false;
      }
      const key = this.suggestionKeyService.lineEditSuggestionKey(result, {
        original: s.original,
        suggested: s.suggested
      });
      return !this.dismissedConsistencyKeys.has(key);
    });
    this.hasRestoredConsistencyForCurrentContext = true;
    this.offsetsDirty = true;
    this.emitSuggestionRanges();
  }

  /** True when documentText is known to be for the current chapter/scene (so safe to restore from latestResult). */
  private get documentMatchesCurrentContext(): boolean {
    if (this.documentChapterId !== this.chapterId) return false;
    return (this.documentSceneId ?? null) === (this.sceneId ?? null);
  }

  /**
   * Canonical language code (lowercase base code, e.g. `en-US` -> `en`) sent to every server call that
   * is language-keyed (chunk thresholds, run context, template lookups/creation) - reuses the same
   * base-split rule as the reattach seam (job-registry's normalizeLang) so a locale-tagged bookLanguage
   * (e.g. `He`/`en-US`) can't diverge the chunk-threshold fetch from the run context language.
   */
  private get language(): string {
    return normalizeLang(this.bookLanguage);
  }

  private loadTemplates(): void {
    this.analysisService.getTemplates().subscribe({
      next: (items) => {
        this.templates = (items ?? []).filter(t => !t.language || t.language === this.language);
      },
      error: () => {
        this.templates = [];
      }
    });
  }

  private loadHistory(mergeWithExisting = false): void {
    if (!this.bookId || !this.chapterId) return;
    const loadingChapterId = this.chapterId;
    const loadingSceneId = this.sceneId ?? undefined;
    this.analysisService
      // Always load the full unfiltered history for this chapter/scene; historyFilterType
      // is applied client-side so allAnalyses remains a complete dataset for other logic.
      .getHistory(this.bookId, this.chapterId, undefined, this.sceneId ?? undefined)
      .subscribe({
      next: (items) => {
        // Ignore if user switched chapter/scene before this response. This MUST run before we touch
        // proofreadFinalizing: a late response from a prior navigation must not end the new context's
        // finalizing window (Bug 1).
        if (this.chapterId !== loadingChapterId || (this.sceneId ?? undefined) !== loadingSceneId) return;
        const fromApi = items ?? [];
        // allAnalyses should always reflect the latest full server state for this chapter/scene
        // (all types, Active + Archived). Replace it on each load to avoid stale or type-filtered data.
        const shouldMerge = mergeWithExisting;
        this.allAnalyses = fromApi;
        // Use the current historyFilterType at response time so we don't override
        // a user filter change that happened while this request was in flight.
        this.rebuildHistoryFromAllAnalyses();
        // Full reload: clear outcome key sets so displayed state is exactly what the API returned (avoids stale Reverted/Accepted and duplicate display).
        // When we're merely changing the history filter or merging async results, keep in-memory
        // Accepted/Dismissed/Reverted sets so the current session's state is preserved.
        if (!shouldMerge) {
          this.acceptedProofreadHistoryKeys = new Set();
          this.dismissedProofreadHistoryKeys = new Set();
          this.acceptedLineEditKeys = new Set();
          this.dismissedLineEditKeys = new Set();
          // Consistency items are dismiss-only (navigate-only cards, no Accept). A full reload is
          // meant to reset session outcome state to exactly what the server returned, so the
          // in-memory dismissed-consistency set must be cleared too; otherwise reloaded history can
          // still hide consistency items via stale keys from a previous run.
          this.dismissedConsistencyKeys = new Set();
        }
        // The newest persisted (has-id) analysis row for the selected type. Active rows win over
        // archived; ties broken by createdAt desc.
        const persistedForType: AnalysisResultDto | null = (() => {
          const activeForType = this.activeAnalyses.filter(
            r => (r.analysisType || r.type) === this.selectedAnalysisType
          );
          const allForType = this.allAnalyses.filter(
            r => (r.analysisType || r.type) === this.selectedAnalysisType
          );
          const candidates = (activeForType.length ? activeForType : allForType).slice();
          candidates.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          return candidates[0] ?? null;
        })();

        // A synthetic streaming result has no id and carries only resultText/structuredResult - never
        // the AnalysisSuggestion DTOs. Consistency cards are sourced ONLY from result.suggestions, so a
        // LinguisticAnalysis run must adopt the persisted API row (which carries those suggestions) once
        // it is available; otherwise Run + History show no consistency issues. Proofread/LineEdit keep
        // the synthetic result because their Run tab is driven by resultText, not server suggestions.
        const syntheticStreaming =
          this.latestResult && !this.latestResult.id &&
          (this.latestResult.analysisType || this.latestResult.type) === this.selectedAnalysisType
            ? this.latestResult
            : null;
        const syntheticType = syntheticStreaming
          ? (syntheticStreaming.analysisType || syntheticStreaming.type)
          : null;

        // This run's own persisted row has replicated into the response when the newest row of the selected
        // type carries a brand-new id (one not seen before the run started).
        const runRowArrived =
          !!persistedForType && !!persistedForType.id
          && !this.analysisResultIdsBeforeRun.has(persistedForType.id);

        // Bug 2: while finalizing a streaming Proofread, the reliability flag lives ONLY on this run's
        // persisted row. If that row has not replicated yet, surfacing the synthetic's client diff would
        // expose an unreliable run's bogus deletion flood. So keep finalizing and retry a few times to wait
        // the row out; only once retries are exhausted do we give up and surface optimistically (a reliable
        // run shows its edits; an unreliable run that never replicates is the rare worst case, matching the
        // history-error fallback).
        if (this.proofreadFinalizing && syntheticType === 'Proofread' && !runRowArrived) {
          if (this.proofreadFinalizeRetriesLeft > 0) {
            this.proofreadFinalizeRetriesLeft--;
            this.clearProofreadFinalizeRetryTimer();
            this.proofreadFinalizeRetryTimer = setTimeout(() => this.loadHistory(true), this.proofreadFinalizeRetryMs);
            this.cdr.detectChanges();
            return;
          }
          // fall through: retries exhausted, resolve optimistically below.
        }

        // The async step this context's finalizing window was waiting on has now resolved for THIS request
        // (Bug 1: only after the stale guard). Clear it before the restore below surfaces the real state.
        this.proofreadFinalizing = false;
        this.clearProofreadFinalizeRetryTimer();

        // Only adopt the persisted row when it is THIS run's row, i.e. an id that did not exist before
        // the run started. Without this guard, a response that does not yet contain the just-completed
        // run (replica lag, a stale/cached GET) would replace the fresh synthetic result with the
        // PREVIOUS persisted analysis, so the Run tab would show an older structured view + consistency
        // cards instead of the output the user just received. When the run's row has not arrived yet we
        // keep the synthetic result; a later loadHistory adopts the persisted row once it appears.
        const replaceSyntheticWithPersisted =
          !!syntheticStreaming
          && !!persistedForType
          && !!persistedForType.id
          && !this.analysisResultIdsBeforeRun.has(persistedForType.id)
          && (syntheticType === 'LinguisticAnalysis'
              || (syntheticType === 'Proofread' && !!persistedForType.proofreadResultUnreliable));

        // Prepend the synthetic streaming run so it appears in History and its Accepted/Dismissed keys
        // match - but NOT when we are about to replace it with the persisted row, or the same run would
        // show twice (the synthetic copy without consistency cards).
        if (this.latestResult && !this.latestResult.id && !replaceSyntheticWithPersisted) {
          const latestType = this.latestResult.analysisType || this.latestResult.type;
          if (!this.historyFilterType || latestType === this.historyFilterType) {
            this.history = [this.latestResult, ...this.history];
          }
        }

        // Decide which result is "latest" for the Run tab: keep a synthetic streaming result for this
        // pass (unless it is being replaced by the persisted row), else prefer the newest persisted row
        // of the selected type so the Run tab never shows a different type than the picker.
        const latestCandidate: AnalysisResultDto | null =
          (syntheticStreaming && !replaceSyntheticWithPersisted) ? syntheticStreaming : persistedForType;
        if (latestCandidate) {
          let shouldUpdateLatest = false;
          // Swapping a synthetic streaming result for its persisted row is intentional even though the
          // persisted row's server createdAt predates the synthetic client timestamp, so force it.
          if (!this.latestResult || replaceSyntheticWithPersisted) {
            shouldUpdateLatest = true;
          } else {
            const existingTime = new Date(this.latestResult.createdAt).getTime();
            const candidateTime = new Date(latestCandidate.createdAt).getTime();
            if (candidateTime >= existingTime) {
              shouldUpdateLatest = true;
            }
          }
          if (shouldUpdateLatest) {
            this.latestResult = latestCandidate;
            const latestType = this.latestResult.analysisType || this.latestResult.type;
            if (this.documentMatchesCurrentContext && this.documentText) {
              // Avoid clobbering in-progress Run tab work: when the user is on the Run tab,
              // only auto-restore if we don't already have suggestions for that type.
              if (
                latestType === 'Proofread' &&
                (this.activeSubTab !== 'run' || this.proofreadSuggestions.length === 0 || !!this.latestResult.proofreadResultUnreliable)
              ) {
                this.restoreProofreadStateFromLatestResult();
              } else if (
                latestType === 'LineEdit' &&
                (this.activeSubTab !== 'run' || this.lineEditRunSuggestions.length === 0)
              ) {
                this.restoreLineEditStateFromResult(this.latestResult);
              } else if (
                latestType === 'LinguisticAnalysis' &&
                (this.activeSubTab !== 'run' || this.consistencyRunSuggestions.length === 0)
              ) {
                this.restoreConsistencyStateFromResult(this.latestResult);
              }
            }
          }
        }
        this.cdr.detectChanges();
      },
      error: () => {
        // Ignore a late failure from a prior navigation: it must not touch the new context's finalizing
        // state or restore into it (Bug 1).
        if (this.chapterId !== loadingChapterId || (this.sceneId ?? undefined) !== loadingSceneId) return;
        // History load failed, so we can no longer adopt the authoritative server row. Resolve the
        // finalizing state and fall back to surfacing the client diff from the synthetic result, so the Run
        // tab never gets stuck on a premature "No changes needed" when the run actually produced edits.
        // Reliability is unknown without history, so we optimistically show the model's edits (the
        // pre-deferral behavior) rather than leave the user with no result.
        const wasFinalizing = this.proofreadFinalizing;
        this.proofreadFinalizing = false;
        this.proofreadFinalizeRetriesLeft = 0;
        this.clearProofreadFinalizeRetryTimer();
        if (
          wasFinalizing
          && this.latestResult
          && (this.latestResult.analysisType || this.latestResult.type) === 'Proofread'
          && this.documentMatchesCurrentContext
          && this.documentText
          && this.proofreadSuggestions.length === 0
        ) {
          this.restoreProofreadStateFromLatestResult();
        }
        this.cdr.detectChanges();
      }
    });
  }

  /** Recompute activeAnalyses and history from the current allAnalyses, honoring the given history filter. */
  private rebuildHistoryFromAllAnalyses(filterType: string | null = this.historyFilterType): void {
    // Always work from a createdAt-descending view so History ordering stays stable
    // even if the API response order changes or we prepend results locally.
    const sorted = [...this.allAnalyses].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    // Cache Active analyses (by status) for re-analysis lifecycle checks.
    this.activeAnalyses = sorted.filter(r => (r.status || '').toLowerCase() === 'active');
    // History should reflect all runs (Active + non-Active) in newest-first order.
    const base = sorted;
    this.history = filterType
      ? base.filter(r => (r.analysisType || r.type) === filterType)
      : base.slice();
  }


  runAnalysis(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunningForCurrentContext) return;
    const pending = this.getPendingSuggestionCountForActive();
    const scope = this.sceneId ? 'scene' : 'chapter';
    if (!this.orchestrationService.confirmReanalysisIfPendingSuggestions(pending, scope, this.language)) return;

    this.prepareForRun();
    const ctx = this.buildRunContext();
    this.runSubscription?.unsubscribe();
    this.runSubscription = this.orchestrationService
      .runAnalysisAfterSave(ctx, this.saveBeforeRun)
      .subscribe({
        next: (event) => this.handleRunEvent(event),
        error: () => this.onRunFinished(),
        complete: () => this.onRunFinished()
      });
  }

  /**
   * Deliberately outside the c01 start budget (`withStartTimeout` in `analysis-run-orchestration.service.ts`):
   * `doRunStreaming` is unbounded because this method has no template caller today. Before wiring this to any
   * control, it needs its own start-budget decision - it is not covered by inheriting c01's.
   */
  runStreaming(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunningForCurrentContext) return;
    const pending = this.getPendingSuggestionCountForActive();
    const scope = this.sceneId ? 'scene' : 'chapter';
    if (!this.orchestrationService.confirmReanalysisIfPendingSuggestions(pending, scope, this.language)) return;

    const ctx = this.buildRunContext();
    this.prepareForRun();
    // The streaming path has no orchestration-level "status" event of its own (unlike
    // runAnalysisAfterSave, which prepends one), so synthesize the SAME event shape here rather than a
    // second output channel. The dialog's state (a) message reads it off the one stream.
    this.runEvent.emit({
      kind: 'status',
      message: this.orchestrationService.emitInitialStatusForRun(ctx, true),
    });

    const startStreaming = () => {
      this.runSubscription?.unsubscribe();
      this.runSubscription = this.orchestrationService.doRunStreaming(ctx).subscribe({
        next: (event) => this.handleRunEvent(event),
        error: () => this.onRunFinished(),
        complete: () => this.onRunFinished()
      });
    };

    if (this.saveBeforeRun) {
      this.saveBeforeRun()
        .then(startStreaming)
        .catch(() => {
          // The save rejected, so the run never starts and no subscription is ever created: this is the
          // ONE terminal route that cannot reach the subscription's error/complete handlers. Route it
          // through the same terminal as every other ending rather than half-clearing the flags here.
          this.onRunFinished();
        });
    } else {
      startStreaming();
    }
  }

  private prepareForRun(): void {
    this.isRunning = true;
    this.asyncJobInFlight = false;
    this.asyncBannerActiveForRun = false;
    // Capture the origin chapter/scene of THIS run so a late async terminal that arrives after a context
    // switch can be recognized and dropped (see onRunResultReceived). Snapshotting at run start mirrors the
    // loadHistory pattern of capturing loadingChapterId/loadingSceneId from the request.
    this.runOriginChapterId = this.chapterId;
    this.runOriginSceneId = this.sceneId ?? null;
    this.runOriginAnalysisType = this.selectedAnalysisType;
    this.runError = null;
    this.streamingText = '';
    this.proofreadSuggestions = [];
    this.lineEditRunSuggestions = [];
    this.consistencyRunSuggestions = [];
    this.staleSuggestionIds = new Set();
    this.hasRestoredLineEditForCurrentContext = false;
    this.hasRestoredConsistencyForCurrentContext = false;
    this.autoShowFirstProofreadAfterRestore = false;
    this.proofreadFinalizing = false;
    this.proofreadFinalizeRetriesLeft = 0;
    this.clearProofreadFinalizeRetryTimer();
    this.emitSuggestionRanges();
    this.analysisStarted.emit();
    // Snapshot the persisted result ids that exist BEFORE this run. After a streaming run, this lets
    // loadHistory recognize the run's own persisted row (a brand-new id) and avoid swapping the fresh
    // synthetic result for an OLDER analysis that merely happens to be the newest one in the response.
    this.analysisResultIdsBeforeRun = new Set(
      this.allAnalyses.map(r => r.id).filter((id): id is string => !!id)
    );
    this.runStartedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.lastRunDurationLabel = null;
    // Drop the previous run's job id so the in-panel bar can never mirror a stale job.
    this.currentRunJobId = null;
  }

  private buildRunContext(): AnalysisRunContext {
    const base: AnalysisRunContext = {
      bookId: this.bookId!,
      chapterId: this.chapterId!,
      sceneId: this.sceneId,
      selectedAnalysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || null) : null,
      language: this.language,
      documentText: this.documentText
    };
    if (this.chunkThresholds) {
      base.proofreadChunkTargetWords = this.chunkThresholds.proofreadChunkTargetWords;
      base.lineEditChunkTargetWords = this.chunkThresholds.lineEditChunkTargetWords;
    }
    return base;
  }

  private handleRunEvent(event: AnalysisRunEvent): void {
    // Wave 1d (c2): fan the raw event out to the host FIRST, so the run dialog sees the run lifecycle in
    // the order it happened. `streaming-token` is excluded (high-volume, and no host surface reads it).
    // Note this carries LIFECYCLE only: the `progress` event's percent is deliberately NOT consumed by
    // any host surface - the registry owns that number on all three surfaces.
    //
    // c06: the two RESULT events are excluded here and fanned out from their own case below instead.
    // That is not a reordering - they are still emitted from this same synchronous call, after every
    // earlier event, before every later one, and before onRunResultReceived mutates a single field - it
    // only lets the PAYLOAD depend on whether this panel is about to keep the result or drop it. See
    // `resultBelongsToRunOrigin`.
    if (event.kind !== 'streaming-token' && event.kind !== 'sync-result' && event.kind !== 'job-result') {
      this.runEvent.emit(event);
    }

    switch (event.kind) {
      case 'status':
        break;
      case 'progress':
        if (event.rawStatus === 'failed') {
          this.isRunning = false;
          this.asyncJobInFlight = false;
          this.asyncBannerActiveForRun = false;
          // c02: the panel's `.run-error` banner is book-scoped chrome, so it composes from the SAME
          // run-string map the orchestration service and the run dialog use. This used to be an English
          // template literal (with an em-dash) shown verbatim inside Hebrew RTL chrome.
          this.runError = runString(this.panelLang, 'runFailed', {
            type: analysisTypeLabelFor(this.panelLang, this.selectedAnalysisType),
          });
          this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt, this.language);
        } else if (event.rawStatus === 'canceled') {
          this.isRunning = false;
          this.asyncJobInFlight = false;
          this.asyncBannerActiveForRun = false;
          this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt, this.language);
        }
        break;
      case 'sync-result':
      case 'job-result':
        // c06: decide the drop BEFORE telling the host. A result we are about to discard must not reach
        // the host as a success: on the sync path nothing was ever registry-tracked, so the run dialog
        // would latch "Done" at 100% for suggestions that were never surfaced anywhere, and (per c02's
        // book-scoped contract) that card then survives the very chapter switch that caused the drop.
        this.runEvent.emit(
          this.resultBelongsToRunOrigin(event.result) ? event : { kind: 'result-dropped' }
        );
        this.onRunResultReceived(event.result);
        break;
      case 'job-started':
        // rf-c01: publish this freshly-started chapter analysis job to the registry so the Activity
        // Center and anyRunningForBook$ pick it up for THIS run - not only after a reload reattaches to
        // it. The async-job path now covers every single-shot whole-chapter analysis type (Proofread,
        // LineEdit, Linguistic, Literary, Summarization, Custom), all of which share the one `proofread`
        // JobKind; analysisType carries the distinction so the row titles correctly (via
        // ANALYSIS_TYPE_LABELS). track() is idempotent per jobId, so a later reattach that re-discovers
        // this job cannot double-track it.
        // scopeLabel 'פרק' matches defaultScopeLabel('proofread') in the registry so live-tracked and
        // reattached jobs render identically. DRAFT he - needs native review.
        // Key the tracked job off the run's CAPTURED origin (prepareForRun), NOT live panel state: this
        // panel instance is reused across navigation, and the async start response can land after the
        // user switched chapter/scene/type. Using live state here would mislabel the job (e.g. a
        // scene-scoped run shown as a chapter) even though the API ran against the original scope.
        if (this.bookId) {
          this.jobRegistry.track('proofread', this.bookId, event.jobId, {
            analysisType: this.runOriginAnalysisType,
            chapterId: this.runOriginChapterId ?? undefined,
            scopeLabel: this.runOriginSceneId ? 'סצנה' : 'פרק', // DRAFT he - needs native review
          });
          // The one id the in-panel progress bar mirrors, read back out of the registry (never polled here).
          this.currentRunJobId = event.jobId;
          // The compact in-panel banner takes over as the in-page indicator for this run.
          this.asyncJobInFlight = true;
          // Persist that this run is an async job with an active banner so returning to the origin
          // context after a mid-run navigation reconstructs the banner (see ngOnChanges reconcile).
          this.asyncBannerActiveForRun = true;
        } else {
          // c03 OBSERVABILITY. This is the ONE branch on which the server has started a real job and NO
          // client surface picks it up: no registry row, so no Activity Center entry, no in-page banner,
          // and (before c03's fence change in the run dialog) a card the run's own stream could no longer
          // resolve. The run itself is unaffected and the async start already succeeded, so nothing here
          // throws and no HTTP error exists to correlate against - which is exactly why a decline must
          // not be silent. Bracketed-tag console.warn is the convention the c01 budget expiry and the c02
          // dismissal seam already use; no ids and no document text.
          //
          // It is not reachable today: `bookId` is an @Input fed only by `EditorPageComponent.bookId`,
          // which is written only from the `books/:bookId` route params, and `runAnalysis()` refuses to
          // start without it. It is logged rather than asserted because the guard's whole purpose is to
          // survive a future call site that CAN decline.
          console.warn('[AnalysisRun] job-started with no bookId: the job was not published to the registry', {
            analysisType: this.runOriginAnalysisType,
          });
        }
        break;
      case 'streaming-token':
        this.streamingText += event.token;
        break;
      case 'streaming-complete':
        this.onStreamingCompleted(event.latestResult);
        break;
      case 'error':
        this.isRunning = false;
        this.asyncJobInFlight = false;
        this.asyncBannerActiveForRun = false;
        this.runError = event.message;
        this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt, this.language);
        break;
      case 'run-finished':
      case 'result-dropped':
        // The two PANEL-emitted members (c01 / c06). They exist only on the `runEvent` OUTPUT, put
        // there by emitRunFinished() and by the result case above; no orchestration observable produces
        // either, and this method only ever sees an orchestration observable. So there is genuinely
        // nothing to do - but the answer is written down rather than left to the default arm, because
        // "no case at all" is indistinguishable from "we forgot".
        break;

      default:
        // Exhaustiveness fence (final-r02): see assertUnhandledRunEvent. A new member of
        // AnalysisRunEvent must fail the build here until someone decides what this panel does with it.
        assertUnhandledRunEvent(event);
    }
    this.cdr.detectChanges();
  }

  /**
   * Does this terminal result still belong to the context on screen?
   *
   * pf-f01 made long runs non-blocking, and this panel instance is REUSED across navigation, so a
   * terminal result can arrive after the user switched chapters/scenes. Injecting the PRIOR chapter's
   * result into the NEW chapter would show a wrong-context result AND map the prior chapter's offsets
   * into the new document (a corruption risk on accept). So a result whose origin does not match the
   * current context is DROPPED, mirroring the loadHistory guard. Prefer the origin captured at run start;
   * fall back to the result DTO's own chapterId/sceneId when no origin was captured (e.g. a reattached
   * job). The result stays safe: when the user returns to the original chapter the guarded loadHistory
   * (and the JobRegistry reattach) re-surface the persisted row.
   *
   * The comparison is against the CURRENT context at ARRIVAL time, not against wherever the user went in
   * between: a run whose user navigated away and back before it landed is kept, exactly as if they had
   * never left.
   *
   * c06 extracted this from {@link onRunResultReceived} so `handleRunEvent` can ask the SAME question
   * before it fans the result out to the host. Two callers, one copy of the rule: a second, drifting copy
   * of it is precisely how the host came to be told "Done" about a result this panel discarded.
   */
  private resultBelongsToRunOrigin(result: AnalysisResultDto): boolean {
    const originChapterId = this.runOriginChapterId ?? result.chapterId ?? null;
    const originSceneId = this.runOriginChapterId != null
      ? this.runOriginSceneId
      : (result.sceneId ?? null);
    return originChapterId === this.chapterId && originSceneId === (this.sceneId ?? null);
  }

  private onRunResultReceived(result: AnalysisResultDto): void {
    // Always clear the transient run flags so nothing sticks on the current chapter, even for a result we
    // are about to drop. The background job itself keeps its persisted result server-side.
    this.isRunning = false;
    this.asyncJobInFlight = false;
    this.asyncBannerActiveForRun = false;

    if (!this.resultBelongsToRunOrigin(result)) {
      // The host was already told, and told the TRUTH: handleRunEvent asked this same predicate and sent
      // `{ kind: 'result-dropped' }` instead of the result event, so the run dialog abandons its card
      // rather than reporting a success that never reached any surface (c06).
      return;
    }

    this.runError = null;
    this.allAnalyses = [result, ...this.allAnalyses];
    this.rebuildHistoryFromAllAnalyses();
    this.latestResult = result;
    this.activeSubTab = 'run';
    this.applyProofreadOrLineEditResultToRunTab(result);
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt, this.language);
  }

  private onStreamingCompleted(latestResult: AnalysisResultDto): void {
    this.isRunning = false;
    // Defensive symmetry: streaming and async-job paths are mutually exclusive today, so this is unreachable for async jobs.
    this.asyncJobInFlight = false;
    this.asyncBannerActiveForRun = false;
    // LinguisticAnalysis streams its structured JSON object, but the synthetic streaming result carries
    // it only as raw resultText. Surface it as structuredResult so the dedicated linguistic view renders
    // deviations/consistency instead of falling back to the "could not parse" raw view.
    if (
      (latestResult.analysisType || latestResult.type) === 'LinguisticAnalysis'
      && !latestResult.structuredResult
      && latestResult.resultText
    ) {
      latestResult.structuredResult = latestResult.resultText;
    }
    this.latestResult = latestResult;
    this.activeSubTab = 'run';
    if (this.selectedAnalysisType === 'Proofread' && this.documentText != null) {
      // The synthetic streaming result carries only resultText, never the server-set
      // proofreadResultUnreliable flag - reliability is decided server-side and only reaches the client on
      // the persisted row. So we cannot tell here whether a CHANGED result is trustworthy. But the client
      // diff still tells us one thing for free: a NON-empty output whose diff is EMPTY means the model echoed
      // the document, i.e. a genuinely clean run (every unreliable failure - empty / unrelated / dropped-span
      // - produces either no usable output or a NON-empty diff). So split the two cases:
      this.proofreadOriginalDocumentByRunKey.set(
        this.suggestionKeyService.proofreadRunKeyForResult(latestResult),
        this.documentText
      );
      const provablyClean = !!this.streamingText && proofreadDiff(this.documentText, this.streamingText).length === 0;
      if (provablyClean) {
        // Genuinely clean: surface the "No changes needed" state immediately - it is correct and needs no
        // server round-trip, so there is no reason to make the user wait on loadHistory.
        this.proofreadSuggestions = [];
        this.hasRestoredProofreadForCurrentContext = true;
        this.offsetsDirty = true;
        this.emitSuggestionRanges();
      } else {
        // Indeterminate (real edits, a bogus dropped-span flood, or empty/absent output): do NOT surface the
        // client-diff cards or highlights now - an unreliable run would flash a flood until loadHistory
        // swapped in the flagged row, and an empty run must not read as clean. Defer surfacing to
        // loadHistory(true) below (which routes through restoreProofreadStateFromLatestResult: reliable ->
        // cards; unreliable -> suppressed), and mark the run as finalizing so the Run tab shows a neutral
        // hint instead of a premature "looks clean".
        this.autoShowFirstProofreadAfterRestore = true;
        this.proofreadFinalizing = true;
        // Budget for loadHistory to wait out replica lag on this run's persisted row before we give up and
        // surface the client diff optimistically (see the loadHistory success handler).
        this.proofreadFinalizeRetriesLeft = this.proofreadFinalizeMaxRetries;
      }
    }
    // Clear the live-stream buffer now the run is complete: the dedicated linguistic/line-edit blocks
    // require !streamingText to render, and runDisplayText falls back to the persisted resultText.
    // restoreProofreadStateFromLatestResult re-derives the diff from latestResult.resultText, so the
    // deferred proofread surfacing does not depend on streamingText surviving this clear.
    this.streamingText = '';
    this.loadHistory(true);
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt, this.language);
  }

  /** Dismiss the compact async-job banner without cancelling the job (it keeps running in the background). */
  dismissAsyncBanner(): void {
    this.asyncJobInFlight = false;
    // A dismiss is sticky for the rest of this run: clearing the persistent flag stops ngOnChanges from
    // reconstructing the banner if the user navigates away and back while the job is still running.
    this.asyncBannerActiveForRun = false;
  }

  /**
   * The run's AUTHORITATIVE terminal: the run subscription completed or errored, or the save that had to
   * precede a streaming run rejected so no subscription was ever created.
   *
   * c01: this now signals the host on the `runEvent` channel it actually binds. It used to emit
   * `analysisCompleted`, which the editor stopped binding when the blocking overlay was deleted, so the
   * run dialog had no route out of its "Starting..." state for any run that ended without one of the
   * orchestration service's own terminal EVENTS (sync-result / job-result / streaming-complete / error).
   */
  private onRunFinished(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.asyncJobInFlight = false;
    this.asyncBannerActiveForRun = false;
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt, this.language);
    this.emitRunFinished();
    this.cdr.detectChanges();
  }

  /**
   * Put the run's terminal on the ONE channel the host listens to.
   *
   * Emitted directly rather than routed through {@link handleRunEvent}: `'run-finished'` is never produced
   * by an orchestration observable, so it is not a stream event, and handleRunEvent's top-of-method
   * fan-out (every kind except `'streaming-token'` and the two result kinds, which c06 fans out from
   * their own case) would make routing it there a second emit of the same signal.
   *
   * On a normal run this fires AFTER a real terminal event, so the consumer must be single-resolve. The
   * dialog is: its `terminal` latch is written exactly once per run.
   */
  private emitRunFinished(): void {
    this.runEvent.emit({ kind: 'run-finished' });
  }

  private applyProofreadOrLineEditResultToRunTab(result: AnalysisResultDto): void {
    const type = result.analysisType || result.type;
    if (type === 'Proofread') {
      if (this.documentText != null) {
        this.proofreadOriginalDocumentByRunKey.set(
          this.suggestionKeyService.proofreadRunKeyForResult(result),
          this.documentText
        );
      }
      // An unreliable proofread (empty / unrelated / dropped-span) returns suggestions that are not
      // trustworthy (e.g. a flood of bogus deletions from a dropped span). Do NOT surface them as cards
      // or as document highlights - the Run tab shows the "could not produce a reliable proofread" warning.
      // Clearing the list and re-emitting empty ranges also removes any prior highlights from the editor.
      if (result.proofreadResultUnreliable) {
        this.proofreadSuggestions = [];
        this.hasRestoredProofreadForCurrentContext = true;
        this.offsetsDirty = true;
        this.emitSuggestionRanges();
        return;
      }
      let all: AnalysisSuggestion[] = [];
      const mapped = this.mapDtoSuggestions(result);
      if (mapped.length) {
        all = mapped;
      } else if (this.documentText && result.resultText) {
        all = proofreadDiff(this.documentText, result.resultText);
      }
      this.proofreadSuggestions = all;
      this.hasRestoredProofreadForCurrentContext = true;
      this.offsetsDirty = true;
      this.emitSuggestionRanges();
      this.autoShowFirstSuggestion();
    } else if (type === 'LineEdit') {
      this.restoreLineEditStateFromResult(result);
    } else if (type === 'LinguisticAnalysis') {
      this.restoreConsistencyStateFromResult(result);
    }
  }

  /** Count pending suggestions (no outcome) on Active analyses matching the current selected type.
   * Uses mapDtoSuggestions so the pending count matches what the user actually sees in the UI. */
  private getPendingSuggestionCountForActive(): number {
    if (!this.activeAnalyses?.length) return 0;
    const type = this.selectedAnalysisType;
    let total = 0;

    for (const analysis of this.activeAnalyses) {
      const analysisType = analysis.analysisType || analysis.type;
      if (analysisType !== type) continue;
      // mapDtoSuggestions never filters, so every suggestion here is a candidate for the pending count.
      const suggestions = this.mapDtoSuggestions(analysis);
      total += suggestions.filter(s => {
        const outcome = (s.outcome || '').toLowerCase();
        return !outcome || outcome === 'pending';
      }).length;
    }

    return total;
  }

  saveAsTemplate(): void {
    const trimmed = (this.prompt || '').trim();
    if (!trimmed) return;

    const name = prompt('Template name (for re-use later):', '')?.trim();
    if (!name) return;

    const templateText = `${trimmed}\n\n---\nטקסט הפרק:\n{chapter_text}`;

    this.analysisService.createTemplate({
      name,
      type: this.selectedAnalysisType === 'Custom' ? 'Custom' : this.selectedAnalysisType,
      templateText,
      language: this.language
    }).subscribe({
      next: (created) => {
        this.templates = [created, ...this.templates];
      },
      error: () => {}
    });
  }
}

