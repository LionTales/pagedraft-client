import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnInit, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, forkJoin } from 'rxjs';
import { ANALYSIS_TYPES, AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto, PromptTemplateDto, isConsistencySuggestion } from '../../core/models/analysis';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { BookReviewStatusDto } from '../../core/models/book-review';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { AnalysisRunOrchestrationService, AnalysisRunContext, AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
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

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SuggestionCardComponent, AnalysisRunTabComponent, AnalysisHistoryTabComponent, AnalysisVersionsTabComponent],
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
  @Output() analysisCompleted = new EventEmitter<void>();
  /** Optional human-readable status for the global analysis spinner (e.g. estimated chunks). */
  @Output() analysisStatus = new EventEmitter<string>();
  /** Optional numeric progress (0–100) for the global analysis spinner. */
  @Output() analysisProgressPercent = new EventEmitter<number | null>();
  @Output() applyCorrection = new EventEmitter<ApplyCorrectionEvent>();
  @Output() showInDocument = new EventEmitter<{ suggestionId?: string; startOffset?: number; endOffset?: number; originalText?: string }>();
  @Output() suggestionRangesChange = new EventEmitter<{ suggestionId?: string; startOffset: number; endOffset: number }[]>();
  /** Emits a scroll target so the editor stays on this word after the next highlight update (e.g. after dismiss/accept). */
  @Output() scrollTargetChange = new EventEmitter<{ startOffset: number; endOffset: number; originalText?: string }>();
  @Output() revertToVersion = new EventEmitter<string>();

  readonly analysisTypes = ANALYSIS_TYPES;
  selectedAnalysisType: string = 'Proofread';
  prompt = '';
  selectedTemplateId: string | null = null;
  isRunning = false;
  streamingText = '';

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
   * Persisted analysis-result ids known BEFORE the current run started (captured in prepareForRun).
   * A streaming run's persisted row is the one whose id is NOT in this set, which is how we tell the
   * just-completed run apart from a pre-existing analysis when deciding whether to swap a synthetic
   * streaming result for its persisted row (see loadHistory).
   */
  private analysisResultIdsBeforeRun = new Set<string>();
  /** Human-readable duration label for the last completed run (e.g. "45s", "2m 10s"). */
  lastRunDurationLabel: string | null = null;
  /** Latest estimated completion percent for the current Proofread run (0–100). */
  currentProgressPercent: number | null = null;
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
  /** Human-readable progress message from the build job. */
  styleBaselineProgressMessage = '';
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

  // ── Book summary (wb1-f01) ────────────────────────────────────────────────
  /** Latest book-summary status read for the current book (null while loading / no book). */
  bookSummaryStatus: BookSummaryStatusDto | null = null;
  /** True while a summary build job is in flight (drives the BUILDING state in the run tab). */
  bookSummaryBuilding = false;
  /** Live summary build progress 0..100 (null = indeterminate). */
  bookSummaryProgressPercent: number | null = null;
  /** Human-readable progress message from the summary build job. */
  bookSummaryProgressMessage = '';
  /** Stops the active summary progress poll; nulled when no poll is running. */
  private bookSummaryProgressStop$: Subject<void> | null = null;
  /** Active summary-related subscriptions (status fetch + build); cleared on context change / destroy. */
  private bookSummarySub: Subscription | null = null;
  /** The latest in-flight GET summary status fetch (cancels previous on overlap). */
  private bookSummaryStatusSub: Subscription | null = null;
  /** Loop guard for summary build: mirrors styleBaselineHandledTerminalJobId. */
  private bookSummaryHandledTerminalJobId: string | null = null;

  // ── Book review (wb2-f03) ─────────────────────────────────────────────────
  /** Latest book-review status read for the current book (null while loading / no book). */
  bookReviewStatus: BookReviewStatusDto | null = null;
  /** True while a review build job is in flight (drives the BUILDING state in the run tab). */
  bookReviewBuilding = false;
  /** Live review build progress 0..100 (null = indeterminate). */
  bookReviewProgressPercent: number | null = null;
  /** Human-readable progress message from the review build job. */
  bookReviewProgressMessage = '';
  /**
   * Outcome of the LAST finished review build (wb2-c05): 'failed' when the job ended with status Failed
   * (all dimensions failed -> no findings), 'degraded' when it succeeded but the terminal message reports
   * some dimensions failed, else null. Surfaced in the run-tab so a total failure does not read as a silent
   * green finish. Reset when a new build starts.
   */
  bookReviewBuildOutcome: 'failed' | 'degraded' | null = null;
  /** The terminal build message text accompanying bookReviewBuildOutcome. May be in English; FE localizes the banner label separately. */
  bookReviewBuildOutcomeMessage = '';
  /** Stops the active review progress poll; nulled when no poll is running. */
  private bookReviewProgressStop$: Subject<void> | null = null;
  /** Active review-related subscriptions (status fetch + build); cleared on context change / destroy. */
  private bookReviewSub: Subscription | null = null;
  /** The latest in-flight GET review status fetch (cancels previous on overlap). */
  private bookReviewStatusSub: Subscription | null = null;
  /** Loop guard for review build: mirrors bookSummaryHandledTerminalJobId. */
  private bookReviewHandledTerminalJobId: string | null = null;

  /** Map backend AnalysisSuggestionDto to the unified AnalysisSuggestion shape used in the UI.
   *  Offset relocation is handled separately by SuggestionAnchorService in emitSuggestionRanges / onShowInDocument. */
  private mapDtoSuggestions(
    result: AnalysisResultDto | null | undefined,
    applyHeuristicFilter: boolean = true
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

    if (!applyHeuristicFilter) {
      return mapped;
    }

    return mapped.filter(s => {
      const origLen = (s.original ?? '').length;
      const sugLen = (s.suggested ?? '').length;
      if (origLen > 60 && sugLen <= 5) return false;
      return true;
    });
  }

  ngOnInit(): void {
    this.analysisService.getChunkThresholds().subscribe({
      next: (t) => { this.chunkThresholds = t; this.cdr.detectChanges(); },
      error: () => { /* use defaults in orchestration */ }
    });
  }

  ngOnDestroy(): void {
    this.runSubscription?.unsubscribe();
    this.orchestrationService.stopProgressPolling();
    this.clearProofreadFinalizeRetryTimer();
    this.stopStyleBaselineProgress();
    this.styleBaselineSub?.unsubscribe();
    this.styleBaselineStatusSub?.unsubscribe();
    this.styleBaselineHandledTerminalJobId = null;
    this.stopBookSummaryProgress();
    this.bookSummarySub?.unsubscribe();
    this.bookSummaryStatusSub?.unsubscribe();
    this.bookSummaryHandledTerminalJobId = null;
    this.stopBookReviewProgress();
    this.bookReviewSub?.unsubscribe();
    this.bookReviewStatusSub?.unsubscribe();
    this.bookReviewHandledTerminalJobId = null;
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
          this.styleBaselineProgressMessage = '';
          this.pollStyleBaselineBuild(bookId, status.activeBuildJobId, lang);
        }
        this.cdr.detectChanges();
      },
      error: () => {
        // Leave whatever we had; the row simply hides when status is null/unknown.
      },
    });
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
    this.styleBaselineProgressMessage = '';
    this.styleBaselineStatus = null;
    // Forget any handled jobId so a build for the new book/language can reattach.
    this.styleBaselineHandledTerminalJobId = null;
  }

  // ── Book summary (wb1-f01) ────────────────────────────────────────────────

  /** Fetch the current book-summary status for this book/language and update the run tab. */
  loadBookSummaryStatus(): void {
    if (!this.bookId) {
      this.bookSummaryStatus = null;
      return;
    }
    const bookId = this.bookId;
    const lang = this.baselineLanguage;
    this.bookSummaryStatusSub?.unsubscribe();
    this.bookSummaryStatusSub = this.bookSummaryService.getBookSummaryStatus(bookId, lang).subscribe({
      next: (status) => {
        // Drop a stale response after the user switched books OR languages (the summary is per (book, language),
        // same as the style baseline). Without the language check a slower OLD-language status could overwrite
        // the new language's snapshot or reattach to its build.
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.bookSummaryStatus = status;
        if (status.ready && this.bookSummaryBuilding && this.bookSummaryProgressPercent === 100) {
          this.bookSummaryBuilding = false;
        }
        // Reattach to an in-progress build (started in another tab/session).
        if (
          status.activeBuildJobId &&
          status.activeBuildJobId !== this.bookSummaryHandledTerminalJobId &&
          !this.bookSummaryBuilding &&
          !this.bookSummaryProgressStop$
        ) {
          this.bookSummaryBuilding = true;
          this.bookSummaryProgressPercent = null;
          this.bookSummaryProgressMessage = '';
          this.pollBookSummaryBuild(bookId, status.activeBuildJobId, lang);
        }
        this.cdr.detectChanges();
      },
      error: () => { /* leave current; row hides when status is null */ },
    });
  }

  /** Stop any active book-summary progress poll. */
  private stopBookSummaryProgress(): void {
    if (this.bookSummaryProgressStop$) {
      this.bookSummaryProgressStop$.next();
      this.bookSummaryProgressStop$.complete();
      this.bookSummaryProgressStop$ = null;
    }
  }

  /** Tear down any in-flight book-summary build/poll and reset its UI + loop guard. */
  private resetBookSummaryBuildState(): void {
    this.stopBookSummaryProgress();
    this.bookSummarySub?.unsubscribe();
    this.bookSummaryStatusSub?.unsubscribe();
    this.bookSummaryBuilding = false;
    this.bookSummaryProgressPercent = null;
    this.bookSummaryProgressMessage = '';
    this.bookSummaryStatus = null;
    this.bookSummaryHandledTerminalJobId = null;
  }

  // ── Book review (wb2-f03) ─────────────────────────────────────────────────

  /** Fetch the current book-review status for this book/language and update the run tab. */
  loadBookReviewStatus(): void {
    if (!this.bookId) {
      this.bookReviewStatus = null;
      return;
    }
    const bookId = this.bookId;
    const lang = this.baselineLanguage;
    this.bookReviewStatusSub?.unsubscribe();
    this.bookReviewStatusSub = this.bookReviewService.getReviewStatus(bookId, lang).subscribe({
      next: (status) => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.bookReviewStatus = status;
        if (status.ready && this.bookReviewBuilding && this.bookReviewProgressPercent === 100) {
          this.bookReviewBuilding = false;
        }
        // Reattach to an in-progress build (started in another tab/session).
        if (
          status.activeBuildJobId &&
          status.activeBuildJobId !== this.bookReviewHandledTerminalJobId &&
          !this.bookReviewBuilding &&
          !this.bookReviewProgressStop$
        ) {
          this.bookReviewBuilding = true;
          this.bookReviewProgressPercent = null;
          this.bookReviewProgressMessage = '';
          this.pollBookReviewBuild(bookId, status.activeBuildJobId, lang);
        }
        this.cdr.detectChanges();
      },
      error: () => { /* leave current; row hides when status is null */ },
    });
  }

  /** Stop any active book-review progress poll. */
  private stopBookReviewProgress(): void {
    if (this.bookReviewProgressStop$) {
      this.bookReviewProgressStop$.next();
      this.bookReviewProgressStop$.complete();
      this.bookReviewProgressStop$ = null;
    }
  }

  /** Tear down any in-flight book-review build/poll and reset its UI + loop guard. */
  private resetBookReviewBuildState(): void {
    this.stopBookReviewProgress();
    this.bookReviewSub?.unsubscribe();
    this.bookReviewStatusSub?.unsubscribe();
    this.bookReviewBuilding = false;
    this.bookReviewProgressPercent = null;
    this.bookReviewProgressMessage = '';
    this.bookReviewStatus = null;
    this.bookReviewHandledTerminalJobId = null;
    this.bookReviewBuildOutcome = null;
    this.bookReviewBuildOutcomeMessage = '';
  }

  /** Consent confirmed in the run tab: start (or no-op) the book review build. */
  onBuildBookReview(): void {
    if (!this.bookId) return;
    if (this.bookReviewBuilding) return;
    const bookId = this.bookId;
    const language = this.baselineLanguage;
    this.stopBookReviewProgress();
    this.bookReviewBuilding = true;
    this.bookReviewProgressPercent = null;
    this.bookReviewProgressMessage = '';
    // Clear any prior failed/degraded banner: a fresh build supersedes the last outcome.
    this.bookReviewBuildOutcome = null;
    this.bookReviewBuildOutcomeMessage = '';
    this.bookReviewHandledTerminalJobId = null;
    this.cdr.detectChanges();

    this.bookReviewSub?.unsubscribe();
    this.bookReviewSub = this.bookReviewService.buildReview(bookId, language).subscribe({
      next: (resp) => {
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        if (resp.noOp || !resp.jobId) {
          this.bookReviewBuilding = false;
          this.loadBookReviewStatus();
          this.cdr.detectChanges();
          return;
        }
        this.pollBookReviewBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        this.bookReviewBuilding = false;
        this.bookReviewProgressMessage = '';
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the book-review build job and refresh status when it reaches a terminal state. */
  private pollBookReviewBuild(bookId: string, jobId: string, lang: string): void {
    this.stopBookReviewProgress();
    const stop$ = new Subject<void>();
    this.bookReviewProgressStop$ = stop$;
    this.bookReviewService.getReviewProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.bookReviewProgressMessage = p.message ?? '';
        this.bookReviewProgressPercent =
          status === 'succeeded'
            ? 100
            : (Number.isFinite(p.estimatedCompletionPercent)
                ? Math.max(0, Math.min(100, p.estimatedCompletionPercent))
                : this.bookReviewProgressPercent);
        if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
          this.bookReviewBuilding = false;
          this.stopBookReviewProgress();
          this.bookReviewHandledTerminalJobId = jobId;
          // Surface the terminal outcome so a total failure is not a silent green finish (wb2-c05).
          // FAILED = all dimensions failed (no findings); a SUCCEEDED message that flags failed dimensions
          // ("built with warnings ... (N failed)") is a PARTIAL/degraded build. Canceled shows nothing.
          const msg = p.message ?? '';
          if (status === 'failed') {
            this.bookReviewBuildOutcome = 'failed';
            this.bookReviewBuildOutcomeMessage = msg;
          } else if (status === 'succeeded' && /with warnings|failed\)/i.test(msg)) {
            this.bookReviewBuildOutcome = 'degraded';
            this.bookReviewBuildOutcomeMessage = msg;
          } else {
            this.bookReviewBuildOutcome = null;
            this.bookReviewBuildOutcomeMessage = '';
          }
          this.loadBookReviewStatus();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.bookReviewBuilding = false;
        this.stopBookReviewProgress();
        this.bookReviewHandledTerminalJobId = jobId;
        // The progress poll itself errored (job lost / network): treat as a failed build so the user is not
        // left on a silent in-flight state. The localized generic copy renders when no server message exists.
        this.bookReviewBuildOutcome = 'failed';
        this.bookReviewBuildOutcomeMessage = '';
        this.loadBookReviewStatus();
        this.cdr.detectChanges();
      },
    });
  }

  /** Consent confirmed in the run tab: start (or no-op) the book summary build. */
  onBuildBookSummary(): void {
    if (!this.bookId) return;
    if (this.bookSummaryBuilding) return;
    const bookId = this.bookId;
    const language = this.baselineLanguage;
    this.stopBookSummaryProgress();
    this.bookSummaryBuilding = true;
    this.bookSummaryProgressPercent = null;
    this.bookSummaryProgressMessage = '';
    this.bookSummaryHandledTerminalJobId = null;
    this.cdr.detectChanges();

    this.bookSummarySub?.unsubscribe();
    this.bookSummarySub = this.bookSummaryService.buildBookSummary(bookId, language).subscribe({
      next: (resp) => {
        // Drop a stale response after the user switched books OR languages (summary is per (book, language)).
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        if (resp.noOp || !resp.jobId) {
          this.bookSummaryBuilding = false;
          this.loadBookSummaryStatus();
          // An already-fresh summary (no-op) still means briefs are present: re-read review status so the
          // book-review row clears its "build summary first" gate (and shows STALE if a review already exists).
          this.loadBookReviewStatus();
          this.cdr.detectChanges();
          return;
        }
        this.pollBookSummaryBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        this.bookSummaryBuilding = false;
        this.bookSummaryProgressMessage = '';
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the book-summary build job and refresh status when it reaches a terminal state. */
  private pollBookSummaryBuild(bookId: string, jobId: string, lang: string): void {
    this.stopBookSummaryProgress();
    const stop$ = new Subject<void>();
    this.bookSummaryProgressStop$ = stop$;
    this.analysisProgressService.pollBookSummaryProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        // Ignore a stale poll emit after the user switched books OR languages (summary is per (book, language)).
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.bookSummaryProgressMessage = p.message ?? '';
        this.bookSummaryProgressPercent =
          status === 'succeeded'
            ? 100
            : (Number.isFinite(p.estimatedCompletionPercent)
                ? Math.max(0, Math.min(100, p.estimatedCompletionPercent))
                : this.bookSummaryProgressPercent);
        if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
          this.bookSummaryBuilding = false;
          this.stopBookSummaryProgress();
          this.bookSummaryHandledTerminalJobId = jobId;
          this.loadBookSummaryStatus();
          // A finished summary build makes briefs present (clearing the review row's "build summary first"
          // gate) and any existing review staleVsBriefs: re-read review status so the row reflects both.
          this.loadBookReviewStatus();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.bookSummaryBuilding = false;
        this.stopBookSummaryProgress();
        this.bookSummaryHandledTerminalJobId = jobId;
        this.loadBookSummaryStatus();
        // The poll errored: still re-read review status (the summary may have completed before the poll
        // dropped) so a stuck "build summary first" gate is not left behind.
        this.loadBookReviewStatus();
        this.cdr.detectChanges();
      },
    });
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
    this.styleBaselineProgressMessage = '';
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
        this.styleBaselineProgressMessage = '';
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the baseline build job and refresh status when it reaches a terminal state. */
  private pollStyleBaselineBuild(bookId: string, jobId: string, lang: string): void {
    this.stopStyleBaselineProgress();
    const stop$ = new Subject<void>();
    this.styleBaselineProgressStop$ = stop$;
    this.analysisProgressService.pollStyleBaselineProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        // Ignore a stale poll emit after the user switched books OR languages (baseline is per (book, language)).
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.styleBaselineProgressMessage = p.message ?? '';
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
    private bookSummaryService: BookSummaryService,
    private bookReviewService: BookReviewService
  ) {}


  get canRun(): boolean {
    if (!this.bookId || !this.chapterId) return false;
    if (this.selectedAnalysisType === 'Custom') return !!this.prompt?.trim();
    return true;
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
        this.resetBookSummaryBuildState();
        this.resetBookReviewBuildState();
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
        this.loadBookSummaryStatus();
        this.loadBookReviewStatus();
      }
    }
    if (changes['bookLanguage'] && this.bookId && this.chapterId) {
      this.loadTemplates();
    }
    // Baseline, book-summary, and book-review status are all per-language; re-read all when the book
    // language changes (independent of chapter). Tear down the OLD-language build/poll/guard FIRST so
    // a late response for the superseded language can't bleed into the new language's status.
    // The bookId-change branch above already resets+reloads all; this covers a language-only change.
    if (changes['bookLanguage'] && !changes['bookId'] && this.bookId) {
      this.resetStyleBaselineBuildState();
      this.loadStyleBaselineStatus();
      this.resetBookSummaryBuildState();
      this.loadBookSummaryStatus();
      this.resetBookReviewBuildState();
      this.loadBookReviewStatus();
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

    // No heuristic length filter: a consistency span can be long but is still a real signal.
    const mapped = this.mapDtoSuggestions(result, false).filter(s => isConsistencySuggestion(s));

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

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
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
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunning) return;
    const pending = this.getPendingSuggestionCountForActive();
    const scopeLabel = this.sceneId ? 'scene' : 'chapter';
    if (!this.orchestrationService.confirmReanalysisIfPendingSuggestions(pending, scopeLabel)) return;

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

  runStreaming(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunning) return;
    const pending = this.getPendingSuggestionCountForActive();
    const scopeLabel = this.sceneId ? 'scene' : 'chapter';
    if (!this.orchestrationService.confirmReanalysisIfPendingSuggestions(pending, scopeLabel)) return;

    const ctx = this.buildRunContext();
    this.prepareForRun();
    this.analysisStatus.emit(
      this.orchestrationService.emitInitialStatusForRun(ctx, true)
    );

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
          this.isRunning = false;
          this.analysisCompleted.emit();
        });
    } else {
      startStreaming();
    }
  }

  private prepareForRun(): void {
    this.isRunning = true;
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
    this.currentProgressPercent = null;
    this.analysisProgressPercent.emit(null);
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
    switch (event.kind) {
      case 'status':
        this.analysisStatus.emit(event.message);
        break;
      case 'progress':
        this.analysisStatus.emit(event.message);
        if (event.percent != null) {
          this.currentProgressPercent = event.percent;
          this.analysisProgressPercent.emit(event.percent);
        }
        if (event.rawStatus === 'failed') {
          this.isRunning = false;
          this.runError = `${this.selectedAnalysisType || 'Analysis'} failed – see error message.`;
          this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
          this.analysisCompleted.emit();
        } else if (event.rawStatus === 'canceled') {
          this.isRunning = false;
          this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
          this.analysisCompleted.emit();
        }
        break;
      case 'sync-result':
      case 'job-result':
        this.onRunResultReceived(event.result);
        break;
      case 'job-started':
        break;
      case 'streaming-token':
        this.streamingText += event.token;
        break;
      case 'streaming-complete':
        this.onStreamingCompleted(event.latestResult);
        break;
      case 'error':
        this.isRunning = false;
        this.runError = event.message;
        this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
        this.analysisCompleted.emit();
        break;
    }
    this.cdr.detectChanges();
  }

  private onRunResultReceived(result: AnalysisResultDto): void {
    this.isRunning = false;
    this.runError = null;
    this.allAnalyses = [result, ...this.allAnalyses];
    this.rebuildHistoryFromAllAnalyses();
    this.latestResult = result;
    this.activeSubTab = 'run';
    this.applyProofreadOrLineEditResultToRunTab(result);
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
    this.analysisCompleted.emit();
  }

  private onStreamingCompleted(latestResult: AnalysisResultDto): void {
    this.isRunning = false;
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
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
    this.analysisCompleted.emit();
  }

  private onRunFinished(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
    this.analysisCompleted.emit();
    this.cdr.detectChanges();
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
      let mapped = this.mapDtoSuggestions(result);
      if (!mapped.length && (result.suggestions?.length ?? 0) > 0) {
        mapped = this.mapDtoSuggestions(result, false);
      }
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
      // For pending-count calculations, keep all suggestions (no heuristic length-based filtering).
      const suggestions = this.mapDtoSuggestions(analysis, false);
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

