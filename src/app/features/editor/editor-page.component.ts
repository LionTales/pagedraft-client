import { CommonModule } from '@angular/common';
import { Component, DoCheck, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ImportHandoffCardComponent } from './import-handoff-card/import-handoff-card.component';
import { ReplaySubject, Subject, Subscription } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { DocumentEditorContainerComponent, DocumentEditorContainerModule, ToolbarService } from '@syncfusion/ej2-angular-documenteditor';
import { BookService } from '../../core/services/book.service';
import { ChapterService } from '../../core/services/chapter.service';
import { SceneService } from '../../core/services/scene.service';
import { SyncService } from '../../core/services/sync.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { ReviseContextService } from '../../core/services/revise-context.service';
import { BookDetailDto, ChapterSummaryDto, SceneSummaryDto } from '../../core/models/book';
import { ChapterAnchor } from '../../core/models/book-review';
import { ChapterTreeComponent } from '../chapter-tree/chapter-tree.component';
import { AnalysisPanelComponent } from '../analysis-panel/analysis-panel.component';
import { IssuePanelComponent, ApplyCorrectionEvent } from '../language-engine/issue-panel.component';
import { BookDashboardComponent } from '../book-dashboard/book-dashboard.component';
import { ChapterFindingsChecklistComponent } from './chapter-findings-checklist.component';
import { SegmentedControlComponent, SegmentedOption } from '../../shared/segmented-control/segmented-control.component';
import {
  AnalysisRunDialogComponent,
  RunDialogMinimizeEvent,
} from '../../shared/analysis-run-dialog/analysis-run-dialog.component';
import { flyToActivityCenter } from '../../shared/analysis-run-dialog/minimize-flight';
import { AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { LanguageIssue } from '../../core/models/language-engine';
import { normalizeTextForAnalysis } from '../../core/utils/normalize-text-for-analysis';
import { EditorTextService } from '../../core/services/editor-text.service';
import { SfdtManipulationService, suggestionBookmarkName, SCROLL_TARGET_BOOKMARK } from '../../core/services/sfdt-manipulation.service';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { Toolbar as EjToolbar } from '@syncfusion/ej2-navigations';
import { ComboBox } from '@syncfusion/ej2-dropdowns';
import { ColorPicker } from '@syncfusion/ej2-inputs';
import { DropDownButton, SplitButton } from '@syncfusion/ej2-splitbuttons';
import { HighlightColor } from '@syncfusion/ej2-documenteditor';
import { createElement, classList, EventHandler } from '@syncfusion/ej2-base';

@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [
    CommonModule,
    DocumentEditorContainerModule,
    ChapterTreeComponent,
    AnalysisPanelComponent,
    IssuePanelComponent,
    BookDashboardComponent,
    ChapterFindingsChecklistComponent,
    SegmentedControlComponent,
    ImportHandoffCardComponent,
    AnalysisRunDialogComponent,
  ],
  providers: [ToolbarService],
  templateUrl: './editor-page.component.html',
  styleUrl: './editor-page.component.scss'
})
export class EditorPageComponent implements OnInit, DoCheck, OnDestroy {
  @ViewChild('docEditor', { static: false })
  docEditor?: DocumentEditorContainerComponent;
  @ViewChild(AnalysisPanelComponent, { static: false })
  analysisPanel?: AnalysisPanelComponent;
  /**
   * c02: the run-progress dialog. Unlike the analysis panel it is mounted UNCONDITIONALLY, so this is
   * resolved from the first change-detection pass onward. READ-ONLY from here: the context reconcile in
   * {@link ngDoCheck} asks it for its public `state` and never writes any of its internals.
   */
  @ViewChild(AnalysisRunDialogComponent, { static: false })
  runDialog?: AnalysisRunDialogComponent;
  /** rf-f13: reference to the mounted dashboard so the checklist "View" action can select the Findings tab. */
  @ViewChild(BookDashboardComponent, { static: false })
  dashboardComp?: BookDashboardComponent;

  book: BookDetailDto | null = null;
  selectedChapterId: string | null = null;
  selectedSceneId: string | null = null;
  bookId: string | null = null;
  expandedChapterIds: string[] = [];
  scenesByChapter: Record<string, SceneSummaryDto[]> = {};
  private destroy$ = new Subject<void>();
  private contentChanged$ = new Subject<void>();
  /** Current document plain text for analysis panel (Proofread diff, Line Edit offset). */
  currentDocumentPlainText = '';
  /** Chapter/scene the current document content belongs to; set when document is loaded so panel can safely restore highlights. */
  documentOwnerChapterId: string | null = null;
  documentOwnerSceneId: string | null = null;
  isSaving = false;
  hasPendingChanges = false;
  /**
   * ds-c04 ReviewPanel mode: the consolidated right panel exposes TWO modes via a SegmentedControl -
   * 'edit' (per-chapter Edit help: the analysis panel + the optional Language sub-view) and 'review'
   * (whole-book developmental review: the book dashboard). This replaces the old top-level
   * Analysis-vs-Book tab split. The Language panel is preserved as a secondary sub-view of Edit help
   * (it is out of scope for the two-mode spec but is an existing feature we must not drop).
   */
  reviewMode: 'edit' | 'review' = 'edit';

  // ── rf-f03 Import handoff card ──────────────────────────────────────────────

  /**
   * rf-f03: true when the editor was reached by navigating FROM the import page (the `imported=1`
   * query param is present). Shows the guided handoff card in the Review panel. Cleared when the user
   * clicks "Start review" (keeps review mode) or "Just let me edit" (switches to edit mode).
   * Falls back gracefully on refresh: the query param is gone so this is false and the non-imported
   * path runs unchanged.
   */
  showHandoffCard = false;

  /** Chapter count from router state (set by import-page confirm); null after refresh (not in state). */
  importedChapters: number | null = null;
  /** Word total from router state; null after refresh. */
  importedWords: number | null = null;
  /** Part count from router state; null after refresh. */
  importedParts: number | null = null;
  /** Secondary view within Edit-help mode: 'analysis' (per-chapter analysis) or 'language' (language engine). */
  editHelpView: 'analysis' | 'language' = 'analysis';
  /** Whether the ReviewPanel is open; the header close button hides it so the canvas gets full width. */
  reviewPanelOpen = true;
  /**
   * ds-c05 Focus mode: a distraction-light writing mode that collapses BOTH side zones (the left
   * chapter tree and the right ReviewPanel) so the center writing canvas is centered and gets the
   * full width. Persisted in component state only (no backend); toggling back restores the panels to
   * the state they were in before focus was entered.
   */
  focusMode = false;
  /** ReviewPanel open-state remembered when entering focus mode, so exiting restores it exactly. */
  private reviewPanelOpenBeforeFocus = true;

  /**
   * rf-c02: true while a whole-book build (summary briefs OR developmental review) is running FOR THE CURRENT
   * BOOK. Now DERIVED from the single job registry ({@link JobRegistryService.anyRunningForBook$}) rather than
   * from the dashboard's buildRunningChange @Output + an editor-owned reconcile poll (both deleted). The
   * registry survives the dashboard being @if-destroyed (close panel / focus mode / Edit help) and re-discovers
   * in-flight jobs on book load via {@link JobRegistryService.reattach}, so the affordance stays correct while
   * the dashboard is unmounted WITHOUT a second poller. Book-scoped: the subscription is re-created per book so
   * a job for book A can never light book B (the wrong-book guard). The status rows PUBLISH their build to the
   * registry (track()) on start; the stepper/badge/reopen affordance READS the registry here.
   */
  reviewBuildRunning = false;
  /** Current subscription to the registry's per-book running flag; re-created on each book load, torn down on switch/destroy. */
  private reviewBuildRunningSub: Subscription | null = null;

  // ── ReviewPanel resize (draggable inline-start gutter) ─────────────────────
  /** Default right-panel width (px). Raised from the old fixed 320 so the scorecard fits out of the box. */
  static readonly REVIEW_PANEL_DEFAULT_WIDTH = 380;
  /** Min/max clamp for the resizable right panel (px). */
  static readonly REVIEW_PANEL_MIN_WIDTH = 300;
  static readonly REVIEW_PANEL_MAX_WIDTH = 640;
  private static readonly REVIEW_PANEL_WIDTH_KEY = 'pd.reviewPanelWidth';
  /** Current right-panel width in px; bound to the grid via the --review-panel-width custom property. */
  reviewPanelWidth = EditorPageComponent.REVIEW_PANEL_DEFAULT_WIDTH;
  /** Template-readable clamp bounds (statics are not accessible from the template). */
  get reviewPanelMinWidth(): number { return EditorPageComponent.REVIEW_PANEL_MIN_WIDTH; }
  get reviewPanelMaxWidth(): number { return EditorPageComponent.REVIEW_PANEL_MAX_WIDTH; }
  /** True while a resize drag is in progress; drives a class that suppresses text selection during drag. */
  isResizingReviewPanel = false;
  /** Drag state captured on pointerdown; null when not dragging. */
  private resizeDrag: { pointerId: number; startX: number; startWidth: number; handle: HTMLElement } | null = null;

  // ── Wave 1d: the analysis run-progress dialog ──────────────────────────────
  //
  // This REPLACES the old full-screen `.analysis-overlay`, which was a SECOND OWNER of a running job's
  // progress: it re-derived its own percent from the orchestration service's `'progress'` events
  // (clamping and force-monotonic-ing it locally) while JobRegistryService already owned the same number
  // for the Activity Center. The dialog, the in-panel indicator and the Activity Center now all read the
  // registry, so one job cannot show three different percentages.
  //
  // The dialog is also NOT a blocker: the chapter behind it stays readable and editable, so there is no
  // longer any need to dismiss it early when a run goes async (the old `(asyncJobStarted)` -> hide-overlay
  // wiring, now deleted).

  /**
   * Whether the run-progress dialog is showing. Two-way bound, so the dialog flips it false when the user
   * minimizes or closes it. This is NOT a "run is in flight" flag: per the d1 contract the dialog stays up
   * in its terminal state until the user dismisses it.
   */
  runDialogOpen = false;

  /** Replay buffer size for {@link runEvents$}. See the field doc for why replay is needed at all. */
  private static readonly RUN_EVENT_REPLAY = 32;

  /**
   * The CURRENT run's event stream, re-created per run.
   *
   * A ReplaySubject rather than a plain Subject because the streaming path pushes its initial status
   * SYNCHRONOUSLY, inside the same call stack as `analysisStarted`, i.e. before Angular's next change
   * detection pass has handed the new stream to the dialog. Without replay that first message would be
   * dropped and state (a) would render its generic fallback. The buffer only ever has to survive one tick.
   *
   * Re-creating it per run is ALSO the dialog's run boundary: its ngOnChanges resets the state machine
   * when `runEvents` changes while open, so starting a second run while a previous terminal card is still
   * on screen restarts cleanly instead of inheriting the finished run's latched state.
   */
  runEvents$: ReplaySubject<AnalysisRunEvent> | null = null;

  /** Analysis type of the current run; titles the dialog until a tracked job supplies its own title. */
  runDialogAnalysisType = '';

  /**
   * c02: the (bookId, chapterId, sceneId) triple as of the previous change-detection pass. `null` until
   * the first pass, which only records a baseline. See {@link ngDoCheck} for why this is the key.
   */
  private lastRunDialogContext: { bookId: string | null; chapterId: string | null; sceneId: string | null } | null = null;

  /** Used for editor-shell dir attribute (e.g. 'rtl' for Hebrew). */
  get editorDirection(): string {
    const lang = this.book?.language?.toLowerCase();
    return lang === 'he' || lang === 'ar' || !lang ? 'rtl' : 'ltr';
  }
  /** Syncfusion DocumentEditor locale/culture; must match book language for correct RTL punctuation and UI. */
  get editorCulture(): string {
    const lang = this.book?.language?.toLowerCase();
    return lang === 'he' || lang === 'ar' ? 'he' : 'en';
  }

  // ── ds-c04 ReviewPanel: localization + chrome ──────────────────────────────

  /** True when the panel chrome should localize to Hebrew (default) vs English (English book). */
  get reviewPanelIsHebrew(): boolean {
    return !(this.book?.language ?? '').toLowerCase().startsWith('en');
  }

  /** Logical direction for the ReviewPanel chrome; follows the book language so en books render ltr. */
  get reviewPanelDir(): 'rtl' | 'ltr' {
    return this.reviewPanelIsHebrew ? 'rtl' : 'ltr';
  }

  /** Localized "Assistant" header title. */
  get reviewPanelTitle(): string {
    return this.reviewPanelIsHebrew ? 'עוזר' : 'Assistant';
  }

  /** Localized "Chapters" sidebar header (book-scoped: Hebrew default, English for en books). */
  get chaptersHeaderLabel(): string {
    return this.reviewPanelIsHebrew ? 'פרקים' : 'Chapters';
  }

  /** Localized "Import DOCX" sidebar action (book-scoped). */
  get importDocxLabel(): string {
    return this.reviewPanelIsHebrew ? 'ייבוא DOCX' : 'Import DOCX';
  }

  /**
   * The two SegmentedControl options (Edit help / Book review), already localized. Count badges are
   * intentionally omitted: deriving live pending-edit / findings counts would require new outputs from
   * the analysis panel and dashboard, which couples into the proven orchestration. The shared
   * SegmentedControl renders a badge only when `count` is set, so leaving it unset is the no-risk default.
   *
   * NIT-7: cached as a field to avoid allocating a fresh array every change-detection cycle. Rebuilt
   * by {@link rebuildReviewModeOptions} at every site that assigns {@link book}, so a language flip
   * (he to en or vice-versa) always produces fresh, correctly-localized labels.
   */
  reviewModeOptions: SegmentedOption[] = this.buildReviewModeOptions();

  /** Build the localized segment option list from the current {@link reviewPanelIsHebrew} state. */
  private buildReviewModeOptions(): SegmentedOption[] {
    const he = this.reviewPanelIsHebrew;
    return [
      { value: 'edit', label: he ? 'עזרת עריכה' : 'Edit help' },
      { value: 'review', label: he ? 'סקירת ספר' : 'Book review' },
    ];
  }

  /** Refresh the cached option list after the book (and therefore its language) changes. */
  private rebuildReviewModeOptions(): void {
    this.reviewModeOptions = this.buildReviewModeOptions();
  }

  // ── rf-f03 Import handoff card handlers ────────────────────────────────────

  /**
   * rf-f03: "Start review" clicked on the handoff card. The card has already started the summary
   * build (consent is the click itself). Dismiss the card and stay in Book review mode so the
   * dashboard / Stage-1 panel is visible immediately.
   */
  onHandoffStartReview(): void {
    this.showHandoffCard = false;
    this.reviewMode = 'review';
  }

  /**
   * rf-f03: "Just let me edit" clicked on the handoff card. Non-blocking escape hatch: dismiss
   * the card and switch to Edit help mode. No build is triggered.
   */
  onHandoffEditMode(): void {
    this.showHandoffCard = false;
    this.reviewMode = 'edit';
  }

  /**
   * NIT-2: typed handler for the SegmentedControl valueChange output.
   * Validates the raw `string` emitted by the control before assigning it to the
   * narrowly-typed `reviewMode` field so `@if (reviewMode === 'review')` branches remain
   * type-safe, without touching SegmentedControlComponent's public `value: string` contract.
   */
  onReviewModeChange(value: string): void {
    if (value === 'edit' || value === 'review') {
      this.reviewMode = value;
      // rf-c02: no reconcile to re-evaluate. The "review running" affordance is derived from the job registry
      // ({@link reviewBuildRunningSub}), which is independent of whether the dashboard is mounted, so switching
      // modes cannot strand a stale flag.
    }
  }

  /**
   * rf-f13: the per-chapter findings checklist emitted switchToReview (user clicked "View" on a finding
   * or "Back to findings"). Switch to review mode (same as any switchToReview path) AND ensure the
   * dashboard lands on the Findings sub-tab rather than whichever tab was last active.
   * Consistent with how f04's onStepperReviseRequested() selects the Findings tab from within the
   * dashboard itself: here we do the same selection from the outside via the ViewChild reference.
   */
  onChecklistSwitchToReview(): void {
    this.onReviewModeChange('review');
    if (this.dashboardComp) {
      this.dashboardComp.reviewTab = 'findings';
    }
  }

  /** Scope pill text: this chapter (edit mode) vs whole book (review mode). */
  get reviewScopeLabel(): string {
    const he = this.reviewPanelIsHebrew;
    return this.reviewMode === 'review'
      ? (he ? 'כל הספר' : 'Whole book')
      : (he ? 'פרק נוכחי' : 'This chapter');
  }

  /**
   * Context label under the segmented control: in edit mode the current chapter/scene title, in review
   * mode the book title. Falls back to a localized hint when nothing is selected.
   */
  get reviewContextLabel(): string {
    const he = this.reviewPanelIsHebrew;
    if (this.reviewMode === 'review') {
      return this.book?.title || (he ? 'הספר כולו' : 'The whole book');
    }
    const chapter = this.book?.chapters?.find(c => c.id === this.selectedChapterId);
    if (!chapter) {
      return he ? 'בחר פרק' : 'Select a chapter';
    }
    if (this.selectedSceneId) {
      const scenes = this.scenesByChapter[chapter.id] ?? [];
      const scene = scenes.find(s => s.id === this.selectedSceneId);
      const sceneLabel = scene?.title || (he ? 'סצנה' : 'Scene');
      const chapterLabel = chapter.title || (he ? 'ללא כותרת' : 'Untitled'); // DRAFT he - needs native review
      return `${chapterLabel} · ${sceneLabel}`;
    }
    return chapter.title || (he ? 'ללא כותרת' : 'Untitled'); // DRAFT he - needs native review
  }

  /** Mono meta line for the context strip: scope of the open unit (e.g. "scene" or "chapter"/whole book). */
  get reviewContextMeta(): string {
    const he = this.reviewPanelIsHebrew;
    if (this.reviewMode === 'review') {
      return he ? 'ניתוח התפתחותי' : 'developmental';
    }
    return this.selectedSceneId
      ? (he ? 'סצנה' : 'scene')
      : (he ? 'פרק' : 'chapter');
  }

  /** Localized labels for the Edit-help secondary sub-view toggle (analysis vs language engine). */
  editHelpViewLabel(view: 'analysis' | 'language'): string {
    const he = this.reviewPanelIsHebrew;
    return view === 'analysis'
      ? (he ? 'ניתוח' : 'Analysis')
      : (he ? 'שפה' : 'Language');
  }

  /** Localized "close panel" aria/title. */
  get reviewPanelCloseLabel(): string {
    return this.reviewPanelIsHebrew ? 'סגור' : 'Close';
  }

  /** Localized accessible label for the "a whole-book build is running" affordance (he default). */
  get reviewRunningLabel(): string {
    return this.reviewPanelIsHebrew ? 'סקירה רצה' : 'Review running';
  }

  /**
   * rf-c02: (re)subscribe the "review running" affordance to the SINGLE job registry, scoped to the given
   * book. This is the one truth the stepper/badge/reopen affordance reads; it replaces the dashboard's
   * buildRunningChange @Output AND the deleted editor-owned reconcile poll. anyRunningForBook$ stays correct
   * while the dashboard is @if-destroyed (close panel / focus mode / Edit help) because the registry's own
   * reused poll keeps running and {@link JobRegistryService.reattach} (called on book load) re-discovers a
   * build already in flight for a freshly-loaded book. Re-created per book so a job for book A can never light
   * book B — the wrong-book guard. distinctUntilChanged already lives inside anyRunningForBook$.
   */
  private subscribeReviewBuildRunning(bookId: string): void {
    this.reviewBuildRunningSub?.unsubscribe();
    this.reviewBuildRunningSub = this.jobRegistry
      .anyRunningForBook$(bookId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(running => {
        // Guard against a late emit after the user switched books: only the current book drives the flag.
        if (this.bookId !== bookId) return;
        this.reviewBuildRunning = running;
      });
  }

  /** Close the ReviewPanel (header ✕). The registry-derived affordance is unaffected by mount state. */
  closeReviewPanel(): void {
    this.reviewPanelOpen = false;
  }

  /** Reopen the ReviewPanel (collapsed reopen button). The registry-derived affordance is unaffected by mount state. */
  openReviewPanel(): void {
    this.reviewPanelOpen = true;
  }

  // ── ds-c05 Focus mode ──────────────────────────────────────────────────────

  /** Localized label for the focus-mode toggle button (he default). */
  get focusModeLabel(): string {
    const he = this.reviewPanelIsHebrew;
    return this.focusMode
      ? (he ? 'יציאה ממיקוד' : 'Exit focus')
      : (he ? 'מיקוד' : 'Focus');
  }

  /**
   * Toggle distraction-light focus mode. Entering remembers the ReviewPanel open-state and collapses
   * both side zones; exiting restores the panel to exactly how it was.
   *
   * Width handling (see {@link applyFocusFit}): entering focus widens the writing frame, so we fit the
   * page to that width (no horizontal scroll); exiting restores the natural 100% zoom. This is deferred
   * one macro-task so Angular has applied the `.editor-layout--focus` class and the shell has its new
   * width before Syncfusion re-measures.
   */
  toggleFocusMode(): void {
    if (!this.focusMode) {
      this.reviewPanelOpenBeforeFocus = this.reviewPanelOpen;
      this.focusMode = true;
      this.reviewPanelOpen = false;
    } else {
      this.focusMode = false;
      this.reviewPanelOpen = this.reviewPanelOpenBeforeFocus;
    }
    // rf-c02: nothing to reconcile. The "review running" affordance on the focus toggle is derived from the
    // job registry, which keeps tracking the build independent of whether the dashboard is mounted, so it
    // clears on its own when the build finishes during focus mode.
    setTimeout(() => this.applyFocusFit(), 0);
  }

  /**
   * Keep the document page fitting the writing frame WITHOUT ever shrinking it to an unreadable size.
   *
   * - FOCUS mode: the shell is widened to ~a full page, so `fitPage('FitPageWidth')` zooms the page to
   *   fill that width and eliminates the horizontal scrollbar (the Syncfusion RTL viewer otherwise lays
   *   out a much wider content box than the page). We `resize()` FIRST so Syncfusion picks up the new
   *   container width before computing the fit.
   * - NORMAL mode: we deliberately DO NOT fit-to-width. With the side panels open the center column can
   *   be ~460px, and fitting a Letter/A4 page to that zooms it down to ~40% (unreadable). So we keep the
   *   natural 100% zoom (a narrow pane just scrolls, which is the pre-existing behaviour).
   *
   * Called (deferred) on focus toggle, on each document load (open() resets the zoom to 100%), and on
   * editor creation. No-ops safely when Syncfusion is not ready.
   */
  private applyFocusFit(): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    try {
      ed.resize();
      if (this.focusMode) {
        ed.fitPage('FitPageWidth');
      } else if (ed.zoomFactor !== 1) {
        ed.zoomFactor = 1;
      }
    } catch {
      // Syncfusion not ready (no document open / not created yet) - ignore.
    }
  }

  // ── ReviewPanel resize ──────────────────────────────────────────────────────

  /** Clamp a candidate panel width to the allowed [min, max] range. */
  private clampReviewPanelWidth(px: number): number {
    return Math.max(
      EditorPageComponent.REVIEW_PANEL_MIN_WIDTH,
      Math.min(EditorPageComponent.REVIEW_PANEL_MAX_WIDTH, Math.round(px))
    );
  }

  /** Restore the persisted panel width from localStorage (clamped); falls back to the default. */
  private restoreReviewPanelWidth(): void {
    try {
      const raw = localStorage.getItem(EditorPageComponent.REVIEW_PANEL_WIDTH_KEY);
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.reviewPanelWidth = this.clampReviewPanelWidth(parsed);
      }
    } catch {
      // localStorage unavailable (private mode / SSR): keep the default width.
    }
  }

  /** Persist the current panel width to localStorage. */
  private persistReviewPanelWidth(): void {
    try {
      localStorage.setItem(
        EditorPageComponent.REVIEW_PANEL_WIDTH_KEY,
        String(this.reviewPanelWidth)
      );
    } catch {
      // Ignore persistence failures; the in-memory width still applies for this session.
    }
  }

  /**
   * Begin a drag-to-resize on the ReviewPanel gutter. The handle sits on the panel's PHYSICAL LEFT
   * edge (the editor-facing boundary of the rightmost grid column), independent of the panel's
   * content direction. Dragging the pointer LEFT widens the panel; dragging RIGHT narrows it.
   */
  onReviewResizeStart(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement | null;
    if (!handle) return;
    event.preventDefault();
    this.resizeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.reviewPanelWidth,
      handle,
    };
    this.isResizingReviewPanel = true;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; pointermove/up still fire without it.
    }
  }

  /** Update the panel width as the pointer moves (no persistence yet). */
  onReviewResizeMove(event: PointerEvent): void {
    const drag = this.resizeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // The handle is on the panel's PHYSICAL LEFT edge, so the delta is purely physical and
    // independent of content direction: moving the pointer LEFT (clientX decreasing) widens the
    // panel, moving RIGHT narrows it. widen = startX - currentX.
    const widen = drag.startX - event.clientX;
    this.reviewPanelWidth = this.clampReviewPanelWidth(drag.startWidth + widen);
  }

  /** End the drag and persist the chosen width. */
  onReviewResizeEnd(event: PointerEvent): void {
    const drag = this.resizeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    try {
      drag.handle.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    this.resizeDrag = null;
    this.isResizingReviewPanel = false;
    this.persistReviewPanelWidth();
  }

  /**
   * Keyboard resize for the separator handle: arrow keys nudge the width by a step, Home/End jump to
   * the min/max. The handle is on the panel's PHYSICAL LEFT edge, so ArrowLeft widens (increase
   * width) and ArrowRight narrows - matching the drag direction, independent of content direction.
   */
  onReviewResizeKeydown(event: KeyboardEvent): void {
    const step = 16;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = this.reviewPanelWidth + step;
        break;
      case 'ArrowRight':
        next = this.reviewPanelWidth - step;
        break;
      case 'Home':
        next = EditorPageComponent.REVIEW_PANEL_MAX_WIDTH;
        break;
      case 'End':
        next = EditorPageComponent.REVIEW_PANEL_MIN_WIDTH;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.reviewPanelWidth = this.clampReviewPanelWidth(next);
    this.persistReviewPanelWidth();
  }

  private pendingLoadTarget: { chapterId: string; sceneId?: string } | null = null;
  private isOpeningDocument = false;
  /** Last suggestion ranges applied for highlights; used for re-application when needed. */
  private lastSuggestionRanges: { suggestionId?: string; startOffset: number; endOffset: number }[] = [];
  /** Scroll target set by accept/dismiss; consumed by scheduleScrollToTarget after the last editor.open() settles. */
  private _pendingScrollTarget: { startOffset: number; endOffset: number; originalText?: string } | null = null;
  private _scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private customToolbar: EjToolbar | null = null;
  private fontFamilyCombo: ComboBox | null = null;
  private fontSizeCombo: ComboBox | null = null;
  private fontColorPicker: ColorPicker | null = null;
  private highlightColorSplitBtn: SplitButton | null = null;
  private _highlightColorElement: HTMLElement | null = null;
  private _highlightColorInputElement: HTMLElement | null = null;
  private _appliedHighlightColor = 'rgb(255, 255, 0)';
  private _onHighlightColorClickHandler: ((e: Event) => void) | null = null;
  private _imagePicker: HTMLInputElement | null = null;
  private _onImagePickerChangeHandler: ((e: Event) => void) | null = null;
  private _imageDropdown: DropDownButton | null = null;
  private _bulletListDropdown: DropDownButton | null = null;
  private _numberedListDropdown: DropDownButton | null = null;
  private readonly _onEditorSelectionChange = () => {
    setTimeout(() => this.onToolbarSelectionChange(), 20);
  };
  private readonly _onEditorDocumentChange = () => {
    this.enableDisableUndoRedo();
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookService: BookService,
    private chapterService: ChapterService,
    private sceneService: SceneService,
    private syncService: SyncService,
    private documentVersionService: DocumentVersionService,
    private analysisService: AnalysisService,
    private jobRegistry: JobRegistryService,
    private sfdtService: SfdtManipulationService,
    private editorTextService: EditorTextService,
    private suggestionAnchorService: SuggestionAnchorService,
    private reviseContext: ReviseContextService
  ) {}

  ngOnInit(): void {
    this.restoreReviewPanelWidth();

    // rf-f04: read the `imported` signal once.
    //
    // Two DECOUPLED signals drive the imported-book experience:
    //   1. Query param `imported=1` — survives a browser refresh (present in the URL). Used ALONE to
    //      open the ReviewPanel in Review mode, giving imported books a Review-first default on every
    //      load/refresh.  Existing books (no `imported` param) keep their Edit-help default unchanged.
    //   2. Router nav state (extras.state) — present ONLY on the initial programmatic navigation FROM
    //      the import page (not after a refresh). Used to populate and SHOW the ephemeral handoff card
    //      so the author is greeted the first time they land, but the card does NOT reappear on refresh.
    //
    // This split means: refresh of `/books/{id}?imported=1` → Review mode (no card); fresh navigation
    // from the import page → Review mode + card. (rf-f03 previously required BOTH to open Review mode,
    // so a refresh dropped the user back to Edit mode — this corrects that.)
    const nav = this.router.getCurrentNavigation();
    const routerState = (nav?.extras?.state as Record<string, unknown> | undefined) ?? null;
    // queryParams snapshot is available synchronously from the snapshot before subscribing.
    const importedParam = this.route.snapshot.queryParams['imported'];
    if (importedParam) {
      // The query param alone is sufficient to default imported books to Review mode (survives refresh).
      this.reviewMode = 'review';
      this.reviewPanelOpen = true;
    }
    if (importedParam && routerState) {
      // ADDITIONALLY: this is a fresh navigation from the import page (nav state present). Show the
      // ephemeral handoff card with the chapter/word/part counts from the router state. The card
      // does NOT appear on refresh (no nav state after refresh), so it is truly ephemeral.
      this.showHandoffCard = true;
      this.importedChapters = (typeof routerState['importedChapters'] === 'number')
        ? routerState['importedChapters'] as number : null;
      this.importedWords = (typeof routerState['importedWords'] === 'number')
        ? routerState['importedWords'] as number : null;
      this.importedParts = (typeof routerState['importedParts'] === 'number')
        ? routerState['importedParts'] as number : null;
    }
    if (importedParam) {
      // c02: strip the sticky `imported=1` param NOW that it has been consumed (reviewMode already set to
      // 'review' above, so the Review-first default on this first load is preserved). Leaving it in the URL
      // would re-force Review mode on every refresh and, worse, override a later "Just let me edit" choice
      // (onHandoffEditMode sets reviewMode='edit', but a refresh with ?imported=1 would flip it back). A
      // replaceUrl merge keeps every other query param and does not add a history entry.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { imported: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const previousBookId = this.bookId;
      this.bookId = params['bookId'] ?? null;
      // Phase 4d-10c: the revise-context ("Addressing: <one-liner>" chip) is a root singleton owned by the
      // findings->checklist handoff, and the checklist that consumes it lives INSIDE this book's editor view.
      // A book switch must reset it, else a stale finding from the previous book could re-show its chip after
      // navigating into an anchored chapter of the new book. Key on the bookId VALUE change (not every params
      // re-emit) so a same-book re-emit never clears an active in-book context.
      if (this.bookId !== previousBookId) {
        this.reviseContext.clear();
        // c02: the imported/handoff one-shot (showHandoffCard + imported* counts) is read ONCE in ngOnInit
        // for the FIRST book, from the `imported=1` query param + router nav state. On a SUBSEQUENT in-place
        // book switch there is no fresh imported nav state, so a stale card + its counts must not carry over
        // from the previous book. Reset only when previousBookId is non-null: that guarantees this is not the
        // first load, so the ngOnInit-shown card for the first imported book is preserved. (The `imported=1`
        // param is also stripped from the URL in ngOnInit right after it is consumed, so a later refresh no
        // longer re-forces Review mode.) Mirrors the bookId-change guard c01 uses for reviseContext.
        if (previousBookId !== null) {
          this.showHandoffCard = false;
          this.importedChapters = null;
          this.importedWords = null;
          this.importedParts = null;
        }
      }
      // rf-c02: a book switch invalidates the previous book's whole-book-build affordance (it is per-book).
      // Clear the stale flag and tear down the previous book's registry subscription at once, so a job for the
      // OLD book can never light the new one before the new subscription re-establishes the true state.
      this.reviewBuildRunning = false;
      this.reviewBuildRunningSub?.unsubscribe();
      this.reviewBuildRunningSub = null;
      if (this.bookId) {
        // Derive the "review running" affordance from the single job registry, scoped to THIS book. Book-scoped
        // (not book+language) so it is set the instant the id is known — the registry survives the dashboard
        // being unmounted, so no editor-owned poll is needed.
        this.subscribeReviewBuildRunning(this.bookId);
        this.syncService.connect().then(() => this.syncService.joinBook(this.bookId!));
        this.bookService.getById(this.bookId).subscribe(b => {
          this.book = b;
          this.rebuildReviewModeOptions();
          // Re-discover any build already in flight for the freshly-loaded book (started in another tab/session,
          // or still running after a browser refresh) and re-track it in the registry. THIS is what covers the
          // unmounted-dashboard case the deleted reconcile poll existed for: reattach re-populates the registry,
          // and the subscription above lights the affordance. One reattach per book load; no second poller.
          if (this.bookId === b.id) {
            // language is a required arg now (reattach normalizes it to a base code); pass a concrete
            // fallback so an empty/missing book language still keys the app-default 'he' slot.
            this.jobRegistry.reattach(b.id, b.language?.trim() || 'he');
          }
          if (b.chapters.length && !this.selectedChapterId) this.selectChapter(b.chapters[0]);
        });
      }
    });
    this.contentChanged$
      .pipe(debounceTime(400), takeUntil(this.destroy$))
      .subscribe(() => this.refreshDocumentPlainText());
    this.syncService.chapterUpdated$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (this.book && ev.bookId === this.bookId) {
        const ch = this.book.chapters.find(c => c.id === ev.chapterId);
        if (ch) { ch.wordCount = ev.wordCount; ch.updatedAt = ev.updatedAt; }
      }
    });
    this.syncService.chapterCreated$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (this.book && ev.bookId === this.bookId) this.refreshBook();
    });
    this.syncService.chapterReordered$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (!this.book || ev.bookId !== this.bookId) return;
      const orderMap = new Map(ev.newOrder.map(o => [o.chapterId, o.order]));
      this.book.chapters.forEach(ch => {
        const newOrder = orderMap.get(ch.id);
        if (newOrder != null) ch.order = newOrder;
      });
      this.book.chapters.sort((a, b) => a.order - b.order);
    });
    this.syncService.sceneCreated$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.bookId !== this.bookId) return;
      this.loadScenesForChapter(ev.chapterId);
    });
    this.syncService.sceneUpdated$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.bookId !== this.bookId) return;
      this.loadScenesForChapter(ev.chapterId);
    });
    this.syncService.sceneDeleted$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.bookId !== this.bookId) return;
      this.scenesByChapter = { ...this.scenesByChapter, [ev.chapterId]: (this.scenesByChapter[ev.chapterId] ?? []).filter(s => s.id !== ev.sceneId) };
      if (this.selectedSceneId === ev.sceneId) {
        this.selectedSceneId = null;
        if (this.selectedChapterId) this.loadChapterContent(this.selectedChapterId);
      }
    });
    this.syncService.scenesCleared$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.bookId !== this.bookId) return;
      this.scenesByChapter = { ...this.scenesByChapter, [ev.chapterId]: [] };
      if (this.selectedChapterId === ev.chapterId && this.selectedSceneId) {
        this.selectedSceneId = null;
        this.loadChapterContent(ev.chapterId);
      }
    });
    this.syncService.scenesReordered$.pipe(takeUntil(this.destroy$)).subscribe(ev => {
      if (ev.bookId !== this.bookId) return;
      this.loadScenesForChapter(ev.chapterId);
    });

    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  private loadScenesForChapter(chapterId: string): void {
    if (!this.bookId) return;
    this.sceneService.getAll(this.bookId, chapterId).subscribe(list => {
      this.scenesByChapter = { ...this.scenesByChapter, [chapterId]: list };
    });
  }

  private refreshBook(): void {
    if (!this.bookId) return;
    this.bookService.getById(this.bookId).subscribe(b => {
      this.book = b;
      this.rebuildReviewModeOptions();
    });
  }

  onReorder(newOrder: { chapterId: string; order: number }[]): void {
    if (!this.bookId || !this.book) return;
    this.chapterService.reorder(this.bookId, newOrder).subscribe({
      next: (updated) => {
        // Replace local chapter list with server-confirmed order & metadata
        this.book!.chapters = [...updated].sort((a, b) => a.order - b.order);
      },
      error: () => {
        console.error('Failed to reorder chapters');
        // Reload from server to avoid inconsistent state
        this.refreshBook();
      }
    });
  }

  addChapter(): void {
    if (!this.bookId || !this.book) return;
    const he = this.reviewPanelIsHebrew;
    const defaultTitle = he ? 'פרק חדש' : 'New chapter';
    const title = prompt(he ? 'כותרת הפרק' : 'Chapter title', defaultTitle)?.trim() || defaultTitle;
    this.chapterService.create(this.bookId, title, null, this.book.chapters.length).subscribe({
      next: (created) => {
        this.bookService.getById(this.bookId!).subscribe(b => {
          this.book = b;
          this.rebuildReviewModeOptions();
          this.selectChapter(created);
        });
      },
      error: () => alert(he ? 'הוספת הפרק נכשלה.' : 'Failed to add chapter.')
    });
  }

  renameChapter(ch: ChapterSummaryDto): void {
    if (!this.bookId || !this.book) return;
    const current = ch.title;
    const he = this.reviewPanelIsHebrew;
    const next = prompt(he ? 'שינוי שם הפרק:' : 'Rename chapter:', current)?.trim();
    if (!next || next === current) {
      return;
    }

    this.chapterService.update(this.bookId, ch.id, { title: next }).subscribe({
      next: (updated) => {
        const target = this.book!.chapters.find(c => c.id === updated.id);
        if (target) {
          target.title = updated.title;
        }
      },
      error: () => {
        alert(he ? 'שינוי שם הפרק נכשל.' : 'Failed to rename chapter.');
      }
    });
  }

  deleteChapter(ch: ChapterSummaryDto): void {
    if (!this.bookId || !this.book) return;
    const confirmed = confirm(this.reviewPanelIsHebrew
      ? `למחוק את הפרק "${ch.title}"? לא ניתן לבטל פעולה זו.`
      : `Delete chapter "${ch.title}"? This cannot be undone.`);
    if (!confirmed) return;

    this.chapterService.delete(this.bookId, ch.id).subscribe({
      next: () => {
        this.book!.chapters = this.book!.chapters.filter(c => c.id !== ch.id);
        if (this.selectedChapterId === ch.id) {
          const first = this.book!.chapters[0];
          this.selectedChapterId = null;
          this.selectedSceneId = null;
          this.expandedChapterIds = this.expandedChapterIds.filter(id => id !== ch.id);
          const next = { ...this.scenesByChapter };
          delete next[ch.id];
          this.scenesByChapter = next;
          if (first) this.selectChapter(first);
        }
      },
      error: () => {
        alert(this.reviewPanelIsHebrew ? 'מחיקת הפרק נכשלה.' : 'Failed to delete chapter.');
      }
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    if (this.bookId) this.syncService.leaveBook(this.bookId);
    if (this._scrollSettleTimer) clearTimeout(this._scrollSettleTimer);
    this.destroyCustomToolbar();
    this.reviewBuildRunningSub?.unsubscribe();
    this.reviewBuildRunningSub = null;
    this.destroy$.next();
    this.destroy$.complete();
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.hasPendingChanges) {
      event.preventDefault();
      event.returnValue = '';
    }
  };

  /** Valid empty SFDT with one paragraph so selection/layout have a valid target (avoids Syncfusion length/currentWidget errors). RTL-friendly for Hebrew. */
  private static readonly EMPTY_SFDT = '{"sections":[{"blocks":[{"paragraphFormat":{"bidi":true},"inlines":[{"characterFormat":{"bidi":true},"text":""}]}],"headersFooters":{}}]}';

  selectChapter(ch: ChapterSummaryDto): void {
    const load = () => {
      this.resetScrollTarget();
      this.selectedChapterId = ch.id;
      this.selectedSceneId = null;
      if (!this.bookId) return;
      if (!this.docEditor) {
        this.pendingLoadTarget = { chapterId: ch.id };
        return;
      }
      this.pendingLoadTarget = null;
      this.loadChapterContent(ch.id);
    };
    if (this.hasPendingChanges) this.saveCurrentDocument(load);
    else load();
  }

  selectScene(event: { scene: SceneSummaryDto; chapterId: string }): void {
    const load = () => {
      this.resetScrollTarget();
      this.selectedChapterId = event.chapterId;
      this.selectedSceneId = event.scene.id;
      if (!this.bookId) return;
      if (!this.docEditor) {
        this.pendingLoadTarget = { chapterId: event.chapterId, sceneId: event.scene.id };
        return;
      }
      this.pendingLoadTarget = null;
      this.loadSceneContent(event.chapterId, event.scene.id);
    };
    if (this.hasPendingChanges) this.saveCurrentDocument(load);
    else load();
  }

  onToggleExpandChapter(chapterId: string): void {
    const idx = this.expandedChapterIds.indexOf(chapterId);
    if (idx >= 0) {
      this.expandedChapterIds = this.expandedChapterIds.filter(id => id !== chapterId);
    } else {
      this.expandedChapterIds = [...this.expandedChapterIds, chapterId];
      this.loadScenesForChapter(chapterId);
    }
  }

  onSplitScenes(ch: ChapterSummaryDto): void {
    if (!this.bookId) return;
    this.sceneService.splitScenes(this.bookId, ch.id).subscribe({
      next: (list) => {
        this.scenesByChapter = { ...this.scenesByChapter, [ch.id]: list };
        if (!this.expandedChapterIds.includes(ch.id)) {
          this.expandedChapterIds = [...this.expandedChapterIds, ch.id];
        }
      },
      error: () => alert(this.reviewPanelIsHebrew
        ? 'הפיצול לסצנות נכשל. שמרו תחילה את הפרק כדי שיהיה לו תוכן לפיצול.'
        : 'Split scenes failed. Save the chapter first so it has content to split.')
    });
  }

  onDeleteScene(event: { scene: SceneSummaryDto; chapterId: string }): void {
    if (!this.bookId) return;
    const { scene, chapterId } = event;
    const confirmed = confirm(this.reviewPanelIsHebrew
      ? `למחוק את הסצנה "${scene.title}"? לא ניתן לבטל פעולה זו.`
      : `Delete scene "${scene.title}"? This cannot be undone.`);
    if (!confirmed) return;
    // Optimistically remove the scene from the tree (cheap and reversible). Do NOT
    // switch the editor away from the scene yet: loading chapter content here would
    // open over the scene document and reset hasPendingChanges before the delete is
    // confirmed, so a failed delete would discard unsaved scene edits even though the
    // scene still exists. Switch the editor only once the server confirms the delete.
    this.scenesByChapter = {
      ...this.scenesByChapter,
      [chapterId]: (this.scenesByChapter[chapterId] ?? []).filter(s => s.id !== scene.id)
    };
    this.sceneService.delete(this.bookId, chapterId, scene.id).subscribe({
      next: () => {
        // Deletion confirmed: if this scene is still the open one, leave it and show
        // the chapter instead. (If the user navigated elsewhere meanwhile, do nothing.)
        if (this.selectedSceneId === scene.id) {
          this.selectedSceneId = null;
          this.loadChapterContent(chapterId);
        }
      },
      error: () => {
        // The scene was not deleted. Reconcile the tree from the server; the editor
        // was never touched, so the still-selected scene and its unsaved edits remain.
        alert(this.reviewPanelIsHebrew ? 'מחיקת הסצנה נכשלה.' : 'Failed to delete scene.');
        this.loadScenesForChapter(chapterId);
      }
    });
    // sceneDeleted$ from SignalR also removes the scene and switches the editor on the
    // originating client once the server broadcasts; with the list already filtered and
    // (on success) the selection cleared, it is a no-op.
  }

  onClearScenes(ch: ChapterSummaryDto): void {
    const bookId = this.bookId;
    if (!bookId) return;
    const confirmed = confirm(this.reviewPanelIsHebrew
      ? `להסיר את כל הסצנות מ"${ch.title}"? תוכן הפרק נשמר; רק חלוקת הסצנות מוסרת.`
      : `Remove all scenes from "${ch.title}"? The chapter content is kept; only the scene split is removed.`);
    if (!confirmed) return;
    this.sceneService.clear(bookId, ch.id).subscribe({
      next: () => {
        this.scenesByChapter = { ...this.scenesByChapter, [ch.id]: [] };
        if (this.selectedChapterId === ch.id && this.selectedSceneId) {
          this.selectedSceneId = null;
          this.loadChapterContent(ch.id);
        }
      },
      error: () => {
        alert(this.reviewPanelIsHebrew ? 'הסרת הסצנות נכשלה. נסו שוב.' : 'Failed to remove scenes. Please try again.');
        // The clear may have applied server-side despite the HTTP error (or a hub
        // event already mutated local state). Reload the scene list AND reconcile
        // the selection against the server: if the selected scene in this chapter is
        // gone from the server, drop it and switch to chapter content so the user is
        // not left editing or saving against a scene that no longer exists. If the
        // clear truly failed, the scene survives the reload and selection is kept.
        this.sceneService.getAll(bookId, ch.id).subscribe({
          next: list => {
            this.scenesByChapter = { ...this.scenesByChapter, [ch.id]: list };
            if (
              this.selectedChapterId === ch.id &&
              this.selectedSceneId &&
              !list.some(s => s.id === this.selectedSceneId)
            ) {
              this.selectedSceneId = null;
              this.loadChapterContent(ch.id);
            }
          },
          error: () => {
            // The reconcile reload also failed, so we cannot confirm whether the
            // selected scene survived. The clear may well have applied (server or
            // SignalR), so to avoid leaving the user editing/saving against a scene
            // that may no longer exist, drop the selection and show chapter content -
            // but only when there are no unsaved edits, which must not be silently
            // discarded on an unverified state (mirrors the delete/save guards).
            if (this.selectedChapterId === ch.id && this.selectedSceneId && !this.hasPendingChanges) {
              this.selectedSceneId = null;
              this.loadChapterContent(ch.id);
            }
          }
        });
      }
    });
    // scenesCleared$ from SignalR handles multi-client sync; setting the list to []
    // again when the event arrives is idempotent.
  }

  private loadChapterContent(chapterId: string): void {
    if (!this.bookId || !this.docEditor) return;
    this.chapterService.getById(this.bookId, chapterId).subscribe(dto => {
      const raw = dto.contentSfdt?.trim();
      let sfdt = raw && raw !== '{"sections":[{"blocks":[]}]}' ? raw : EditorPageComponent.EMPTY_SFDT;
      sfdt = this.sfdtService.ensureSfdtRtl(sfdt, this.editorDirection === 'rtl');
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (!this.docEditor?.documentEditor || this.selectedChapterId !== chapterId || this.selectedSceneId) return;
          this.docEditor.documentEditor.open(sfdt);
          this.hasPendingChanges = false;
          this.currentDocumentPlainText = this.editorTextService.refreshDocumentPlainText(this.docEditor, this.selectedChapterId);
          this.documentOwnerChapterId = chapterId;
          this.documentOwnerSceneId = null;
          // open() resets the zoom to 100%; re-fit the page to the frame (focus mode only).
          this.applyFocusFit();
        } finally {
          this.isOpeningDocument = false;
        }
      }, 0);
    });
  }

  private loadSceneContent(chapterId: string, sceneId: string): void {
    if (!this.bookId || !this.docEditor) return;
    this.sceneService.getById(this.bookId, chapterId, sceneId).subscribe(dto => {
      const raw = dto.contentSfdt?.trim();
      let sfdt = raw && raw !== '{"sections":[{"blocks":[]}]}' ? raw : EditorPageComponent.EMPTY_SFDT;
      sfdt = this.sfdtService.ensureSfdtRtl(sfdt, this.editorDirection === 'rtl');
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (!this.docEditor?.documentEditor || this.selectedSceneId !== sceneId) return;
          this.docEditor.documentEditor.open(sfdt);
          this.hasPendingChanges = false;
          this.currentDocumentPlainText = this.editorTextService.refreshDocumentPlainText(this.docEditor, this.selectedChapterId);
          this.documentOwnerChapterId = chapterId;
          this.documentOwnerSceneId = sceneId;
          // open() resets the zoom to 100%; re-fit the page to the frame (focus mode only).
          this.applyFocusFit();
        } finally {
          this.isOpeningDocument = false;
        }
      }, 0);
    });
  }

  private applyRtlToSelectionDeferred(): void {
    if (this.editorDirection !== 'rtl') return;
    setTimeout(() => {
      if (!this.docEditor?.documentEditor) return;
      try {
        const sel = this.docEditor.documentEditor.selection;
        if (sel?.paragraphFormat) sel.paragraphFormat.bidi = true;
        if (sel?.characterFormat) sel.characterFormat.bidi = true;
      } catch {
        // Selection not ready; enableRtl on editor is enough
      }
    }, 100);
  }

  /** Set current selection (or paragraph) to RTL. */
  setSelectionRtl(): void {
    if (!this.docEditor?.documentEditor) return;
    try {
      const sel = this.docEditor.documentEditor.selection;
      if (sel?.paragraphFormat) sel.paragraphFormat.bidi = true;
      if (sel?.characterFormat) sel.characterFormat.bidi = true;
    } catch { /* ignore */ }
  }

  /** Set current selection (or paragraph) to LTR. */
  setSelectionLtr(): void {
    if (!this.docEditor?.documentEditor) return;
    try {
      const sel = this.docEditor.documentEditor.selection;
      if (sel?.paragraphFormat) sel.paragraphFormat.bidi = false;
      if (sel?.characterFormat) sel.characterFormat.bidi = false;
    } catch { /* ignore */ }
  }

  onContentChange(): void {
    if (!this.selectedChapterId) return;
    this.hasPendingChanges = true;
    this.contentChanged$.next();
    this.enableDisableUndoRedo();
  }

  /** Public save for the Save button. Only saves when there are pending changes. */
  saveCurrentDocument(onCompleted?: () => void): void {
    if (!this.bookId || !this.selectedChapterId || !this.docEditor || !this.hasPendingChanges || this.isOpeningDocument) {
      if (onCompleted) onCompleted();
      return;
    }
    // The editor keeps the previously-loaded document until a new load completes, so
    // during a transition the selected target can already point elsewhere while the
    // editor still holds the prior document. Most dangerously, deleting/clearing the
    // selected scene nulls selectedSceneId before loadChapterContent finishes, so a
    // save here would route to the chapter (else branch below) and write the scene's
    // SFDT into the chapter record. Only persist when the current target matches the
    // loaded document's owner; otherwise skip until the new document is opened.
    if (this.documentOwnerChapterId !== this.selectedChapterId || this.documentOwnerSceneId !== this.selectedSceneId) {
      if (onCompleted) onCompleted();
      return;
    }
    let sfdt: string;
    try {
      sfdt = this.docEditor.documentEditor.serialize();
      sfdt = this.sfdtService.stripHighlightFromSfdt(sfdt);
    } catch {
      if (onCompleted) onCompleted();
      return;
    }
    this.isSaving = true;
    if (this.selectedSceneId) {
      this.sceneService.update(this.bookId, this.selectedChapterId, this.selectedSceneId, { contentSfdt: sfdt }).subscribe({
        next: () => {
          this.isSaving = false;
          this.hasPendingChanges = false;
          if (onCompleted) onCompleted();
        },
        error: () => {
          this.isSaving = false;
          console.error('Failed to save scene');
          if (onCompleted) onCompleted();
        }
      });
    } else {
      this.chapterService.update(this.bookId, this.selectedChapterId, { contentSfdt: sfdt }).subscribe({
        next: () => {
          this.isSaving = false;
          this.hasPendingChanges = false;
          if (onCompleted) onCompleted();
        },
        error: () => {
          this.isSaving = false;
          console.error('Failed to save chapter');
          if (onCompleted) onCompleted();
        }
      });
    }
  }

  /** Returns a Promise that resolves when save completes (or immediately if nothing to save). Used by analysis panel and canDeactivate guard. */
  saveCurrentDocumentPromise(): Promise<void> {
    return new Promise(resolve => {
      if (!this.hasPendingChanges || !this.bookId || !this.selectedChapterId || !this.docEditor || this.isOpeningDocument) {
        resolve();
        return;
      }
      this.saveCurrentDocument(() => resolve());
    });
  }

  /** Callback for analysis panel: save before run so analysis uses latest content. */
  readonly saveBeforeRun = () => this.saveCurrentDocumentPromise();

  /**
   * The analysis panel started a run or a stream: open the run-progress dialog on a FRESH event stream.
   *
   * Both bindings change in the same change-detection pass, which the dialog collapses into a single
   * state-machine reset (see its ngOnChanges).
   */
  onAnalysisStarted(): void {
    this.runDialogAnalysisType = this.analysisPanel?.selectedAnalysisType ?? '';
    this.runEvents$ = new ReplaySubject<AnalysisRunEvent>(EditorPageComponent.RUN_EVENT_REPLAY);
    this.runDialogOpen = true;
    this.refreshDocumentPlainText();
  }

  /**
   * Forward one raw run event into the current run's dialog stream.
   *
   * Pure transport: the editor no longer interprets these events. In particular it does NOT read the
   * `'progress'` percent any more, because that was the second owner this wave converged away. The dialog
   * takes only the run LIFECYCLE from here; every number it shows comes from JobRegistryService.
   */
  onAnalysisRunEvent(event: AnalysisRunEvent): void {
    this.runEvents$?.next(event);
  }

  /**
   * Minimize: fly a ghost of the dialog card toward the Activity Center bell, which is where the job
   * stays visible once the dialog is gone. The job itself is untouched (it stays tracked and keeps
   * polling); this handler is purely the visual hand-off.
   *
   * The bell is pinned with `inset-inline-start`, so its physical corner FLIPS between Hebrew (RTL, the
   * default) and English. `flyToActivityCenter` therefore measures the bell's live rect instead of aiming
   * at a hardcoded corner, and honours `prefers-reduced-motion` with a cross-fade.
   */
  onRunDialogMinimize(event: RunDialogMinimizeEvent): void {
    flyToActivityCenter(event.originRect);
  }

  /**
   * c02: reconcile the run-progress card to the unit the user is actually looking at.
   *
   * CONTRACT (B, book-scoped - the full argument is in the plan's `## c02 decision`). The card is scoped
   * to the BOOK, like the Activity Center it minimizes into, NOT to the chapter. A chapter or scene
   * switch does not take a live run's card away: the panel does not end its run on a context switch
   * (`AnalysisPanelComponent.ngOnChanges` never touches `runSubscription`), so the card is still
   * describing something that is genuinely happening, and a background run outliving the surface that
   * started it is the entire premise of the minimize gesture. Two things DO clear it:
   *
   *   - a BOOK switch, always, live run or not. This card is book-scoped chrome (it renders in this
   *     book's language and titles itself from this book's analysis-type vocabulary), so the previous
   *     book's card must never survive onto the next one. The JOB is untouched and stays visible in the
   *     app-level Activity Center, which is legitimately cross-book.
   *   - a TERMINAL card, on any context change. A finished run for a unit the user has left has nothing
   *     left to tell them: it cannot progress, it cannot be minimized, and its result already went to the
   *     panel for the unit it belongs to. This is the review's "Done card for chapter A lingering over
   *     chapter B".
   *
   * WHY ngDoCheck. There is no single existing per-context reset site to hang this on. `resetScrollTarget`
   * is called from `selectChapter` and `selectScene` only, while the SignalR handlers (scene deleted,
   * scenes cleared, a scene list that no longer contains the selection) and chapter delete write
   * `selectedSceneId` / `selectedChapterId` directly, and `bookId` is written only by the `route.params`
   * subscription. Keying on the VALUE of the same triple the analysis panel reconciles on is the only
   * single site that covers every writer - it is the editor-side equivalent of the panel's own
   * `ngOnChanges` reconcile (`analysis-panel.component.ts`), which is a DoCheck-time hook for exactly the
   * same reason. It cannot fire on a re-render or an unrelated field change (nothing happens unless one of
   * the three values differs), nor on the initial load (the first pass records a baseline and returns).
   *
   * OWNERSHIP. The dialog remains the single owner of its RUN state machine: this reads its public
   * `state` and never writes `jobId` / `trackedJob` / `terminal`. What it writes is `open`, the host's own
   * input (the editor is already its writer, at `onAnalysisStarted`), answering a question the dialog
   * cannot answer for itself because it does not know what chapter is on screen. Terminal-ness is READ
   * rather than re-derived on purpose: `(b) -> (c)` is the registry's call alone (d1 item 6), so it never
   * reaches the editor on the run-event channel, and any editor-local reconstruction of it would be a
   * second, permanently-stale copy of the state machine.
   */
  ngDoCheck(): void {
    const bookId = this.bookId;
    const chapterId = this.selectedChapterId;
    const sceneId = this.selectedSceneId;
    const previous = this.lastRunDialogContext;
    if (previous
      && previous.bookId === bookId
      && previous.chapterId === chapterId
      && previous.sceneId === sceneId) {
      return;
    }
    this.lastRunDialogContext = { bookId, chapterId, sceneId };
    // Nothing to reconcile on the very first pass (no context was navigated away from) or while no card
    // is on screen.
    if (!previous || !this.runDialogOpen) return;
    if (previous.bookId !== bookId || this.runDialog?.state === 'terminal') {
      // Drop the card AND its stream, mirroring onAnalysisStarted's three writes in reverse. The run
      // itself is not cancelled: the panel owns that subscription, and a tracked job stays in the
      // registry (and so in the Activity Center) either way.
      this.runDialogOpen = false;
      this.runEvents$ = null;
      this.runDialogAnalysisType = '';
    }
  }

  /** Save if needed, then navigate to books list. Used by Back to books button and canDeactivate (browser back). */
  goBackToBooks(): void {
    const navigate = () => this.router.navigate(['/books']);
    if (this.hasPendingChanges) this.saveCurrentDocument(navigate);
    else navigate();
  }

  goToImport(): void {
    if (!this.bookId) return;
    this.router.navigate(['/books', this.bookId, 'import']);
  }

  onEditorCreated(): void {
    if (!this.docEditor) return;
    const ed = this.docEditor.documentEditor;
    const isRtl = this.editorDirection === 'rtl';
    ed.enableRtl = isRtl;
    if (isRtl) {
      ed.setDefaultParagraphFormat({ bidi: true });
      ed.setDefaultCharacterFormat({ bidi: true });
    }
    this.applyRtlToSelectionDeferred();
    this.initCustomToolbar();
    const target = this.pendingLoadTarget;
    if (target && this.selectedChapterId === target.chapterId) {
      this.pendingLoadTarget = null;
      if (target.sceneId) this.loadSceneContent(target.chapterId, target.sceneId);
      else this.loadChapterContent(target.chapterId);
    }
    // If the editor is (re)created while already in focus mode, fit the page to the frame.
    setTimeout(() => this.applyFocusFit(), 0);
  }

  onApplyCorrection(event: ApplyCorrectionEvent): void {
    if (!this.docEditor?.documentEditor || !this.selectedChapterId) return;
    try {
      // Text that will actually be applied to the document (normalized to stay
      // consistent with analysis offsets and plain-text views).
      const appliedText = normalizeTextForAnalysis(event.text);
      let sfdt = this.docEditor.documentEditor.serialize();
      // Always strip suggestion highlights/bookmarks before applying a correction so
      // the newly opened document does not retain stale highlight formatting.
      sfdt = this.sfdtService.stripHighlightFromSfdt(sfdt);
      // Offsets from proofread diff are in normalized document text; use currentDocumentPlainText for the slice
      const textFromSfdt = this.editorTextService.getTextFromSfdt(sfdt);
      const fallbackPlain = textFromSfdt || this.editorTextService.getPlainTextFromEditor(this.docEditor);
      const currentText =
        this.currentDocumentPlainText ||
        (fallbackPlain ? normalizeTextForAnalysis(fallbackPlain) : '');
      let startOffset = event.startOffset;
      let endOffset = event.endOffset;
      if (event.originalText != null && currentText) {
        const relocated = this.suggestionAnchorService.relocateOne(
          {
            original: event.originalText,
            suggested: event.text,
            startOffset: event.startOffset,
            endOffset: event.endOffset,
          },
          currentText
        );
        if (relocated.stale) {
          // Fallback for ad-hoc corrections (e.g. Redo) that only provide text
          // but no durable offsets/context: when relocateOne cannot uniquely
          // anchor the text (e.g. multiple identical occurrences without
          // context), fall back to a simple indexOf search so the correction
          // still applies instead of silently failing.
          const normalizedOriginal = normalizeTextForAnalysis(event.originalText);
          const idx = normalizedOriginal && currentText
            ? currentText.indexOf(normalizedOriginal)
            : -1;
          if (idx === -1) {
            console.warn(
              'Suggestion skipped: original text no longer found in current document.',
              'Original:', event.originalText
            );
            return;
          }
          startOffset = idx;
          endOffset = idx + normalizedOriginal.length;
        } else {
          startOffset = relocated.relocatedStart;
          endOffset = relocated.relocatedEnd;
        }
      }

      let newSfdt: string;
      if (startOffset != null && endOffset != null && currentText) {
        const newText =
          currentText.slice(0, startOffset) + appliedText + currentText.slice(endOffset);
        newSfdt = this.sfdtService.replacePlainTextInSfdt(
          sfdt,
          newText,
          this.editorDirection === 'rtl',
          startOffset,
          endOffset,
          appliedText.length
        );
        this._pendingScrollTarget = { startOffset, endOffset: startOffset + appliedText.length, originalText: appliedText };
        newSfdt = this.sfdtService.addBookmarkAtRange(newSfdt, startOffset, startOffset + appliedText.length, SCROLL_TARGET_BOOKMARK);
      } else {
        newSfdt = this.sfdtService.buildMinimalSfdt(appliedText);
      }

      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (this.docEditor?.documentEditor && this.selectedChapterId) {
            this.docEditor.documentEditor.open(newSfdt);
            this.scheduleScrollToTarget();
            this.hasPendingChanges = true;
            this.contentChanged$.next();
            this.refreshDocumentPlainText();
            // After a correction, suggestion offsets may be stale; let the analysis panel
            // recompute and emit fresh ranges based on the updated document instead of
            // re-applying the previous highlight ranges directly.
            this.lastSuggestionRanges = [];
            if (this.bookId && !event.skipCreatingVersion) {
              const now = new Date();
              const timeLabel = now.toLocaleTimeString('en-US', {
                hour12: true,
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit'
              });
              const maxLen = 35;
              const trunc = (t: string) => (t.length <= maxLen ? t : t.slice(0, maxLen) + '…');
              const label =
                event.originalText != null
                  ? `Original: ${trunc(event.originalText)} → Suggested: ${trunc(appliedText)}`
                  : `After accept (${timeLabel})`;
              // Store the document state *before* the replacement so Revert restores original text.
              this.documentVersionService
                .create(this.bookId, this.selectedChapterId, sfdt, {
                  label,
                  sceneId: this.selectedSceneId ?? undefined,
                  analysisId: event.analysisId ?? undefined,
                  suggestionId: event.suggestionId ?? undefined,
                  originalText: event.originalText ?? undefined,
                  suggestedText: appliedText
                })
                .subscribe({ error: () => {} });
            }
          }
        } finally {
          this.isOpeningDocument = false;
        }
      }, 0);
    } catch (err) {
      console.error('Failed to apply correction', err);
    }
  }

  onIssueHighlighted(_issue: LanguageIssue): void {
    // Future: map LanguageIssue offset/context to editor selection
  }

  /**
   * wb3-f01: a chapter-anchor chip in the Book Dashboard (Findings ledger or Story Bible) was clicked.
   * Resolves the ChapterAnchor to a ChapterSummaryDto from the known chapter list and opens it via the
   * existing selectChapter path (which handles save-before-switch and document load). Resolves strictly
   * by chapterId — the order fallback was removed because deleted/reordered chapters can cause the
   * wrong chapter to be opened.
   * No character-offset navigation: whole-book findings are chapter-level only.
   */
  onOpenChapterFromDashboard(anchor: ChapterAnchor): void {
    if (!this.book) return;
    const ch = this.book.chapters.find(c => c.id === anchor.chapterId) ?? null;
    if (!ch) {
      const isHe = this.editorDirection === 'rtl';
      alert(isHe
        ? 'הפרק לא נמצא - ייתכן שנמחק.'
        : 'Chapter not found - it may have been deleted.');
      return;
    }
    this.selectChapter(ch);
  }

  onRevertToVersion(versionId: string): void {
    if (!this.bookId || !this.selectedChapterId) return;
    this.documentVersionService.get(this.bookId, this.selectedChapterId, versionId).subscribe({
      next: (detail) => {
        let sfdt = detail.contentSfdt;
        if (sfdt) sfdt = this.sfdtService.ensureSfdtRtl(sfdt, this.editorDirection === 'rtl');
        if (!this.docEditor?.documentEditor || !sfdt) return;
        this.isOpeningDocument = true;
        setTimeout(() => {
          try {
            if (this.docEditor?.documentEditor) {
              this.docEditor.documentEditor.open(sfdt!);
              this.hasPendingChanges = true;
              this.contentChanged$.next();
              this.refreshDocumentPlainText();
              this.applySuggestionHighlights([]);
              this.saveCurrentDocument();
              // When this version was created from Accept suggestion, mark the linked suggestion
              // as Reverted; prefer SuggestionId when present, and fall back to text-based matching
              // for legacy versions that predate SuggestionId.
              const analysisId = detail.analysisResultId ?? detail.analysisId;
              if (this.analysisPanel && analysisId) {
                if (detail.suggestionId) {
                  this.analysisPanel.markSuggestionReverted(analysisId, detail.originalText ?? '', detail.suggestedText ?? '', detail.suggestionId);
                } else if (detail.originalText && detail.suggestedText) {
                  this.analysisPanel.markSuggestionReverted(analysisId, detail.originalText, detail.suggestedText);
                }
              }
            }
          } finally {
            this.isOpeningDocument = false;
          }
        }, 0);
      },
      error: () => {}
    });
  }

  /**
   * Scroll the editor into view and select the text range for the suggestion.
   *
   * Navigation priority:
   *  1. selectBookmark() -- first-class Syncfusion anchor, survives edits.
   *  2. Offset-based selection via plainOffsetToSfdtPosition (fallback for suggestions without IDs).
   *  3. searchModule.find() (last resort).
   */
  selectRangeInEditor(payload: { suggestionId?: string; startOffset?: number; endOffset?: number; originalText?: string }): void {
    const editor = this.docEditor?.documentEditor;
    if (!editor) return;

    const originalText = payload.originalText?.trim();

    const doSelect = (): void => {
      try {
        // Primary: bookmark-based navigation (precise, survives user edits).
        if (payload.suggestionId && editor.selection?.selectBookmark) {
          const bmName = suggestionBookmarkName(payload.suggestionId);
          try {
            editor.selection.selectBookmark(bmName);
            if (editor.selection.text?.length) {
              editor.focusIn();
              return;
            }
          } catch {
            // Bookmark not found or API error -- fall through to offset-based path.
          }
        }

        // Fallback 1: offset-based selection mapped to SFDT hierarchical positions.
        const { startOffset, endOffset } = payload;
        if (startOffset != null && endOffset != null && endOffset > startOffset) {
          try {
            const sfdt = editor.serialize();
            const startPos = this.sfdtService.plainOffsetToSfdtPosition(sfdt, startOffset);
            const endPos = this.sfdtService.plainOffsetToSfdtPosition(sfdt, endOffset);
            if (startPos && endPos && editor.selection?.select) {
              editor.selection.select(startPos, endPos);
              const selected = editor.selection.text || '';
              if (selected.length > 0) {
                editor.focusIn();
                return;
              }
            }
          } catch {
            // Ignore offset selection failures and continue to search-based fallback.
          }
        }

        // Fallback 2: search API (last resort -- may land on wrong occurrence).
        const searchModule = (editor as unknown as { searchModule?: { find: (text: string) => { startOffset: string; endOffset: string } | null; navigate: (r: { startOffset: string; endOffset: string }) => void } }).searchModule;
        if (originalText && searchModule?.find && searchModule?.navigate) {
          const result = searchModule.find(originalText);
          if (result?.startOffset != null && result?.endOffset != null) {
            searchModule.navigate(result);
            editor.focusIn();
            return;
          }
        }
      } catch {
        // ignore
      }
    };

    const el = this.docEditor?.element;
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    requestAnimationFrame(() => {
      setTimeout(doSelect, 150);
    });
  }

  /**
   * Apply or clear visible highlights in the document for proofread suggestion ranges.
   * Skips when isOpeningDocument is true (another open is already pending, e.g. from
   * onApplyCorrection) to avoid overwriting corrected content with stale SFDT.
   */
  applySuggestionHighlights(ranges: { suggestionId?: string; startOffset: number; endOffset: number }[]): void {
    const editor = this.docEditor?.documentEditor;
    if (!editor || !this.selectedChapterId) return;

    this.lastSuggestionRanges = ranges.slice();

    if (this.isOpeningDocument) return;

    try {
      let sfdt = editor.serialize();
      sfdt = this.sfdtService.stripHighlightFromSfdt(sfdt);

      if (ranges.length > 0) {
        let docLen = this.currentDocumentPlainText.length;
        if (!docLen) {
          const fromSfdt = this.editorTextService.getTextFromSfdt(sfdt);
          const fallback = fromSfdt || this.editorTextService.getPlainTextFromEditor(this.docEditor);
          if (fallback) {
            docLen = normalizeTextForAnalysis(fallback).length;
          }
        }
        const validRanges = docLen
          ? ranges.filter(({ startOffset, endOffset }) => {
              const spanLen = endOffset - startOffset;
              return spanLen < docLen * 0.9;
            })
          : ranges;
        sfdt = this.sfdtService.applyHighlightRangesToSfdt(sfdt, validRanges);
      }

      if (this._pendingScrollTarget) {
        sfdt = this.sfdtService.addBookmarkAtRange(
          sfdt,
          this._pendingScrollTarget.startOffset,
          this._pendingScrollTarget.endOffset,
          SCROLL_TARGET_BOOKMARK
        );
      }

      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (this.docEditor?.documentEditor && this.selectedChapterId) {
            this.docEditor.documentEditor.open(sfdt);
            this.scheduleScrollToTarget();
          }
        } finally {
          this.isOpeningDocument = false;
        }
      }, 0);
    } catch {
      // ignore
    }
  }

  /** Receive scroll target from analysis panel (e.g. after dismiss) so next open stays on that word. */
  onScrollTargetChange(target: { startOffset: number; endOffset: number; originalText?: string }): void {
    this._pendingScrollTarget = target;
  }

  /**
   * Debounced scroll: each editor.open() call resets a 300ms timer. When the timer
   * fires (no more opens for 300ms), select the temporary _scroll_target bookmark
   * that was injected into the SFDT before the last editor.open(). This is more
   * reliable than offset-based or search-based selection because the bookmark
   * survives SFDT restructuring (inline splitting, highlight nodes).
   */
  private scheduleScrollToTarget(): void {
    if (!this._pendingScrollTarget) return;
    if (this._scrollSettleTimer) clearTimeout(this._scrollSettleTimer);
    this._scrollSettleTimer = setTimeout(() => {
      this._scrollSettleTimer = null;
      this._pendingScrollTarget = null;
      const editor = this.docEditor?.documentEditor;
      if (!editor) return;
      try {
        editor.selection.selectBookmark(SCROLL_TARGET_BOOKMARK);
        editor.focusIn();
      } catch {
        // Bookmark not found — nothing to scroll to.
      }
    }, 300);
  }

  private resetScrollTarget(): void {
    this._pendingScrollTarget = null;
    if (this._scrollSettleTimer) {
      clearTimeout(this._scrollSettleTimer);
      this._scrollSettleTimer = null;
    }
  }


  /** Update currentDocumentPlainText from the editor content (for analysis panel). Call before run so diff uses latest text. */
  refreshDocumentPlainText(): void {
    const text = this.editorTextService.refreshDocumentPlainText(this.docEditor, this.selectedChapterId);
    if (text) {
      this.currentDocumentPlainText = text;
    }
  }

  // ==================== Custom Toolbar ====================

  private initCustomToolbar(): void {
    this.destroyCustomToolbar();
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;

    const fontFamilies = [
      'Algerian', 'Arial', 'Calibri', 'Cambria', 'Cambria Math', 'Candara',
      'Courier New', 'Georgia', 'Impact', 'Segoe Print', 'Segoe Script',
      'Segoe UI', 'Symbol', 'Times New Roman', 'Verdana', 'Wingdings'
    ];
    const fontSizes = [
      '8', '9', '10', '11', '12', '14', '16', '18', '20',
      '22', '24', '26', '28', '36', '48', '72', '96'
    ];

    this.initializeHighlightColorElement();

    const highlightMainDiv = createElement('div', {
      id: 'DocumentEditor_font_properties_color',
      className: 'e-de-font-clr-picker e-de-ctnr-group-btn',
      styles: 'display:inline-flex;'
    });
    this.highlightColorSplitBtn = this.createHighlightColorSplitButton(
      'DocumentEditor_highlightColor', 34.5, highlightMainDiv
    );
    classList(
      this.highlightColorSplitBtn.element.nextElementSibling!.firstElementChild!,
      ['e-de-ctnr-highlight', 'e-icons'], ['e-caret']
    );
    this._highlightColorInputElement = this.highlightColorSplitBtn.element.firstChild as HTMLElement;

    this._imagePicker = createElement('input', {
      attrs: { type: 'file', accept: '.jpg,.jpeg,.png,.bmp,.svg' },
      className: 'e-de-ctnr-file-picker'
    }) as HTMLInputElement;
    this._onImagePickerChangeHandler = () => this.onImagePickerChange();
    EventHandler.add(this._imagePicker, 'change', this._onImagePickerChangeHandler, this);

    this.fontFamilyCombo = new ComboBox({
      dataSource: fontFamilies,
      width: 120,
      index: 2,
      allowCustom: true,
      change: (args: any) => this.onFontFamilyChange(args),
      showClearButton: false,
    });

    this.fontSizeCombo = new ComboBox({
      dataSource: fontSizes,
      width: 80,
      allowCustom: true,
      index: 2,
      change: (args: any) => this.onFontSizeChange(args),
      showClearButton: false,
    });

    this.customToolbar = new EjToolbar({
      clicked: (arg: any) => this.onToolbarButtonClick(arg),
      items: [
        { prefixIcon: 'e-de-ctnr-bold e-icons', tooltipText: 'Bold', id: 'bold' },
        { prefixIcon: 'e-de-ctnr-italic e-icons', tooltipText: 'Italic', id: 'italic' },
        { prefixIcon: 'e-de-ctnr-underline e-icons', tooltipText: 'Underline', id: 'underline' },
        { type: 'Separator' },
        {
          type: 'Input',
          template: (this.fontColorPicker = new ColorPicker({
            value: '#000000',
            showButtons: true,
            change: (args: any) => this.onFontColorChange(args),
          })),
        },
        { type: 'Input', template: this.fontFamilyCombo },
        { type: 'Input', template: this.fontSizeCombo },
        { type: 'Separator' },
        { prefixIcon: 'e-de-ctnr-alignleft e-icons', tooltipText: 'Align Left', id: 'AlignLeft' },
        { prefixIcon: 'e-de-ctnr-aligncenter e-icons', tooltipText: 'Align Center', id: 'AlignCenter' },
        { prefixIcon: 'e-de-ctnr-alignright e-icons', tooltipText: 'Align Right', id: 'AlignRight' },
        { type: 'Separator' },
        { prefixIcon: 'e-de-ctnr-undo', tooltipText: 'Undo', id: 'Undo' },
        { prefixIcon: 'e-de-ctnr-redo', tooltipText: 'Redo', id: 'Redo' },
        { type: 'Separator' },
        { tooltipText: 'Text Highlight color', id: 'HighlightColor' },
        { prefixIcon: 'e-de-ctnr-increaseindent e-icons', tooltipText: 'Increase Indent', id: 'IncreaseIndent' },
        { prefixIcon: 'e-de-ctnr-decreaseindent e-icons', tooltipText: 'Decrease Indent', id: 'DecreaseIndent' },
        { type: 'Separator' },
        { prefixIcon: 'e-de-ctnr-bullets e-icons', tooltipText: 'Bullets', id: 'BulletList' },
        { prefixIcon: 'e-de-ctnr-numbering e-icons', tooltipText: 'Numbering', id: 'NumberedList' },
        { type: 'Separator' },
        { prefixIcon: 'e-btn-icon e-icons e-de-ctnr-image e-icon-left', tooltipText: 'Insert inline picture from a file', id: 'InsertImage' },
        { prefixIcon: 'e-de-ctnr-table', tooltipText: 'Insert a table into the document', id: 'InsertTable' },
        { prefixIcon: 'e-de-cnt-cmt-add', tooltipText: 'Add comment', id: 'Comments' },
        { prefixIcon: 'e-de-cnt-track', tooltipText: 'Track Changes', id: 'TrackChanges' },
        { prefixIcon: 'e-de-ctnr-find', tooltipText: 'Find Text', id: 'Find' },
      ]
    });
    this.customToolbar.appendTo('#custom-toolbar');

    this._imageDropdown = new DropDownButton({
      items: [{ text: 'Upload from computer', id: 'imageLocal', iconCss: 'e-icons e-de-ctnr-upload' }],
      cssClass: 'e-de-toolbar-btn-first e-caret-hide',
      select: (args: any) => this.imageSelect(args)
    });
    this._imageDropdown.appendTo('#InsertImage');

    this._bulletListDropdown = new DropDownButton({
      items: [
        { text: 'None' }, { text: 'Dot' }, { text: 'Circle' },
        { text: 'Square' }, { text: 'Flower' }, { text: 'Arrow' }, { text: 'Tick' }
      ],
      select: (args: any) => this.bulletListAction(args)
    });
    this._bulletListDropdown.appendTo('#BulletList');

    this._numberedListDropdown = new DropDownButton({
      items: [
        { text: 'None' }, { text: 'NumberDot' }, { text: 'UpRoman' },
        { text: 'UpLetter' }, { text: 'LowLetter' }, { text: 'LowRoman' }
      ],
      select: (args: any) => this.numberListAction(args)
    });
    this._numberedListDropdown.appendTo('#NumberedList');

    const hcEl = document.getElementById('HighlightColor');
    if (hcEl) hcEl.appendChild(highlightMainDiv);

    ed.addEventListener('selectionChange', this._onEditorSelectionChange);
    ed.addEventListener('documentChange', this._onEditorDocumentChange);
  }

  private destroyCustomToolbar(): void {
    const ed = this.docEditor?.documentEditor;
    if (ed) {
      try { ed.removeEventListener('selectionChange', this._onEditorSelectionChange); } catch { /* ignore */ }
      try { ed.removeEventListener('documentChange', this._onEditorDocumentChange); } catch { /* ignore */ }
    }
    try {
      if (this._highlightColorElement && this._onHighlightColorClickHandler) {
        const clickable = this._highlightColorElement.querySelectorAll('.e-de-ctnr-hglt-btn, #noColorDiv');
        clickable.forEach(el => {
          EventHandler.remove(el as HTMLElement, 'click', this._onHighlightColorClickHandler as any);
        });
      }
    } catch { /* ignore */ }
    try {
      this._highlightColorElement?.remove();
    } catch { /* ignore */ }
    try { this.highlightColorSplitBtn?.destroy(); } catch { /* ignore */ }
    try { this.fontFamilyCombo?.destroy(); } catch { /* ignore */ }
    try { this.fontSizeCombo?.destroy(); } catch { /* ignore */ }
    try { this.fontColorPicker?.destroy(); } catch { /* ignore */ }
    try {
      if (this._imagePicker && this._onImagePickerChangeHandler) {
        EventHandler.remove(this._imagePicker, 'change', this._onImagePickerChangeHandler);
      }
    } catch { /* ignore */ }
    try { this._imageDropdown?.destroy(); } catch { /* ignore */ }
    try { this._bulletListDropdown?.destroy(); } catch { /* ignore */ }
    try { this._numberedListDropdown?.destroy(); } catch { /* ignore */ }
    try { this.customToolbar?.destroy(); } catch { /* ignore */ }
    this.customToolbar = null;
    this.fontFamilyCombo = null;
    this.fontSizeCombo = null;
    this.fontColorPicker = null;
    this.highlightColorSplitBtn = null;
    this._highlightColorElement = null;
    this._onHighlightColorClickHandler = null;
    this._highlightColorInputElement = null;
    this._imagePicker = null;
    this._onImagePickerChangeHandler = null;
    this._imageDropdown = null;
    this._bulletListDropdown = null;
    this._numberedListDropdown = null;
  }

  private onToolbarButtonClick(arg: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    switch (arg.item.id) {
      case 'bold':
        ed.editor.toggleBold();
        break;
      case 'italic':
        ed.editor.toggleItalic();
        break;
      case 'underline':
        ed.editor.toggleUnderline('Single');
        break;
      case 'AlignLeft':
        ed.editor.toggleTextAlignment('Left');
        break;
      case 'AlignRight':
        ed.editor.toggleTextAlignment('Right');
        break;
      case 'AlignCenter':
        ed.editor.toggleTextAlignment('Center');
        break;
      case 'Undo':
        ed.editorHistory.undo();
        break;
      case 'Redo':
        ed.editorHistory.redo();
        break;
      case 'IncreaseIndent':
        ed.editor.increaseIndent();
        break;
      case 'DecreaseIndent':
        ed.editor.decreaseIndent();
        break;
      case 'InsertTable':
        ed.showDialog('Table');
        break;
      case 'Comments':
        (ed.editor as any).isUserInsert = true;
        ed.editor.insertComment('');
        (ed.editor as any).isUserInsert = false;
        break;
      case 'TrackChanges':
        ed.enableTrackChanges = !ed.enableTrackChanges;
        this.toggleTrackChangesButton();
        break;
      case 'Find':
        ed.showOptionsPane();
        break;
    }
  }

  private onFontFamilyChange(args: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed || !args?.isInteracted) return;
    ed.selection.characterFormat.fontFamily = args.value;
    ed.focusIn();
  }

  private onFontSizeChange(args: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed || !args?.isInteracted) return;
    const raw = args?.value;
    const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isFinite(parsed)) return;
    ed.selection.characterFormat.fontSize = parsed;
    ed.focusIn();
  }

  private onFontColorChange(args: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    ed.selection.characterFormat.fontColor = args.currentValue.hex;
    ed.focusIn();
  }

  private onToolbarSelectionChange(): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed?.selection) return;

    this.enableDisableFontOptions();

    const pf = ed.selection.paragraphFormat;
    for (const id of ['AlignLeft', 'AlignCenter', 'AlignRight']) {
      document.getElementById(id)?.classList.remove('e-btn-toggle');
    }
    if (pf.textAlignment === 'Left') {
      document.getElementById('AlignLeft')?.classList.add('e-btn-toggle');
    } else if (pf.textAlignment === 'Right') {
      document.getElementById('AlignRight')?.classList.add('e-btn-toggle');
    } else if (pf.textAlignment === 'Center') {
      document.getElementById('AlignCenter')?.classList.add('e-btn-toggle');
    }

    const selHighlight = ed.selection.characterFormat
      .highlightColor as HighlightColor | null | undefined;
    if (this._highlightColorInputElement) {
      const cssColor = this.getCssColorForHighlight(selHighlight);
      this._appliedHighlightColor = cssColor;
      this._highlightColorInputElement.style.backgroundColor = cssColor;
    }
    this.applyHighlightColorAsBackground(selHighlight ?? 'NoColor');

    if (this.fontFamilyCombo && ed.selection.characterFormat.fontFamily) {
      this.fontFamilyCombo.value = ed.selection.characterFormat.fontFamily;
    }
    if (this.fontSizeCombo && ed.selection.characterFormat.fontSize) {
      this.fontSizeCombo.value = ed.selection.characterFormat.fontSize.toString();
    }
    if (this.fontColorPicker && ed.selection.characterFormat.fontColor) {
      this.fontColorPicker.value = ed.selection.characterFormat.fontColor;
    }
  }

  private enableDisableFontOptions(): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed?.selection) return;
    const cf = ed.selection.characterFormat;
    const properties = [cf.bold, cf.italic, cf.underline];
    const ids = ['bold', 'italic', 'underline'];
    for (let i = 0; i < properties.length; i++) {
      this.changeActiveState(properties[i], ids[i]);
    }
  }

  private changeActiveState(property: any, btnId: string): void {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (
      (typeof property === 'boolean' && property) ||
      (typeof property === 'string' && property !== 'None')
    ) {
      btn.classList.add('e-btn-toggle');
    } else {
      btn.classList.remove('e-btn-toggle');
    }
  }

  private enableDisableUndoRedo(): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    const undoBtn = document.getElementById('Undo');
    if (undoBtn) {
      if (ed.editorHistory.canUndo()) undoBtn.classList.remove('e-overlay');
      else undoBtn.classList.add('e-overlay');
    }
    const redoBtn = document.getElementById('Redo');
    if (redoBtn) {
      if (ed.editorHistory.canRedo()) redoBtn.classList.remove('e-overlay');
      else redoBtn.classList.add('e-overlay');
    }
  }

  private toggleTrackChangesButton(): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    const el = document.getElementById('TrackChanges');
    if (!el) return;
    if (ed.enableTrackChanges) {
      classList(el, ['e-btn-toggle'], []);
    } else {
      classList(el, [], ['e-btn-toggle']);
    }
  }

  // ==================== Highlight Color ====================

  private initializeHighlightColorElement(): void {
    if (!this._onHighlightColorClickHandler) {
      this._onHighlightColorClickHandler = (e: Event) => this.onHighlightColor(e);
    }
    this._highlightColorElement = createElement('div', {
      styles: 'display:none;width:157px',
      className: 'e-de-cntr-highlight-pane'
    });
    const colors: { bg: string; id: string }[] = [
      { bg: '#ffff00', id: 'yellowDiv' },
      { bg: '#00ff00', id: 'brightGreenDiv' },
      { bg: '#00ffff', id: 'turquoiseDiv' },
      { bg: '#ff00ff', id: 'hotPinkDiv' },
      { bg: '#0000ff', id: 'blueDiv' },
      { bg: '#ff0000', id: 'redDiv' },
      { bg: '#000080', id: 'darkBlueDiv' },
      { bg: '#008080', id: 'tealDiv' },
      { bg: '#008000', id: 'greenDiv' },
      { bg: '#800080', id: 'violetDiv' },
      { bg: '#800000', id: 'darkRedDiv' },
      { bg: '#808000', id: 'darkYellowDiv' },
      { bg: '#808080', id: 'gray50Div' },
      { bg: '#c0c0c0', id: 'gray25Div' },
      { bg: '#000000', id: 'blackDiv' },
    ];
    for (const c of colors) {
      const div = createElement('div', {
        className: 'e-de-ctnr-hglt-btn', id: c.id
      }) as HTMLDivElement;
      div.style.backgroundColor = c.bg;
      this._highlightColorElement.appendChild(div);
      EventHandler.add(div, 'click', this._onHighlightColorClickHandler as any);
    }
    const nocolor = createElement('div', { className: 'e-hglt-no-color' });
    this._highlightColorElement.appendChild(nocolor);
    const nocolorDiv = createElement('div', {
      styles: 'width:24px;height:24px;background-color:#ffffff;margin:3px;',
      id: 'noColorDiv'
    });
    nocolor.appendChild(nocolorDiv);
    const nocolorLabel = createElement('div', {
      innerHTML: 'No color',
      className: 'e-de-ctnr-hglt-no-color'
    });
    nocolor.appendChild(nocolorLabel);
    EventHandler.add(nocolorDiv as HTMLElement, 'click', this._onHighlightColorClickHandler as any);
  }

  private createHighlightColorSplitButton(
    id: string, _width: number, divElement: HTMLElement
  ): SplitButton {
    const buttonEl = createElement('button', {
      id, attrs: { type: 'button' }
    }) as HTMLButtonElement;
    divElement.appendChild(buttonEl);
    const splitBtn = new SplitButton({
      cssClass: 'e-de-btn-hghlclr',
      iconCss: 'e-de-ctnr-hglt-color',
      target: this._highlightColorElement!,
      close: () => {
        if (this._highlightColorElement) this._highlightColorElement.style.display = 'none';
      },
      beforeOpen: () => {
        if (this._highlightColorElement) this._highlightColorElement.style.display = 'block';
      }
    });
    splitBtn.appendTo(buttonEl);
    splitBtn.click = () => {
      if (this._highlightColorInputElement) {
        this.applyHighlightColor(this._highlightColorInputElement.style.backgroundColor);
      }
    };
    (splitBtn.element.firstChild as HTMLElement).style.backgroundColor = 'rgb(255, 255, 0)';
    return splitBtn;
  }

  private onHighlightColor(event: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed?.selection) return;
    this.applyHighlightColor(event.currentTarget.style.backgroundColor);
    this.highlightColorSplitBtn?.toggle();
  }

  private applyHighlightColor(color: string): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    this._appliedHighlightColor = color;
    const hlColor = this.getHighlightColor(color);
    if (hlColor === 'NoColor') {
      ed.selection.characterFormat.highlightColor = null as any;
    } else {
      ed.selection.characterFormat.highlightColor = hlColor as HighlightColor;
    }
    if (this._highlightColorInputElement) {
      this._highlightColorInputElement.style.backgroundColor = this._appliedHighlightColor;
    }
    ed.focusIn();
  }

  private getHighlightColor(color: string): HighlightColor {
    switch (color) {
      case 'rgb(255, 255, 0)': return 'Yellow';
      case 'rgb(0, 255, 0)': return 'BrightGreen';
      case 'rgb(0, 255, 255)': return 'Turquoise';
      case 'rgb(255, 0, 255)': return 'Pink';
      case 'rgb(0, 0, 255)': return 'Blue';
      case 'rgb(255, 0, 0)': return 'Red';
      case 'rgb(0, 0, 128)': return 'DarkBlue';
      case 'rgb(0, 128, 128)': return 'Teal';
      case 'rgb(0, 128, 0)': return 'Green';
      case 'rgb(128, 0, 128)': return 'Violet';
      case 'rgb(128, 0, 0)': return 'DarkRed';
      case 'rgb(128, 128, 0)': return 'DarkYellow';
      case 'rgb(128, 128, 128)': return 'Gray50';
      case 'rgb(192, 192, 192)': return 'Gray25';
      case 'rgb(0, 0, 0)': return 'Black';
      default: return 'NoColor';
    }
  }

  private getCssColorForHighlight(color: HighlightColor | null | undefined): string {
    switch (color) {
      case 'Yellow': return 'rgb(255, 255, 0)';
      case 'BrightGreen': return 'rgb(0, 255, 0)';
      case 'Turquoise': return 'rgb(0, 255, 255)';
      case 'Pink': return 'rgb(255, 0, 255)';
      case 'Blue': return 'rgb(0, 0, 255)';
      case 'Red': return 'rgb(255, 0, 0)';
      case 'DarkBlue': return 'rgb(0, 0, 128)';
      case 'Teal': return 'rgb(0, 128, 128)';
      case 'Green': return 'rgb(0, 128, 0)';
      case 'Violet': return 'rgb(128, 0, 128)';
      case 'DarkRed': return 'rgb(128, 0, 0)';
      case 'DarkYellow': return 'rgb(128, 128, 0)';
      case 'Gray50': return 'rgb(128, 128, 128)';
      case 'Gray25': return 'rgb(192, 192, 192)';
      case 'Black': return 'rgb(0, 0, 0)';
      case 'NoColor':
        return 'rgb(255, 255, 255)';
      default:
        return this._appliedHighlightColor || 'rgb(255, 255, 0)';
    }
  }

  private applyHighlightColorAsBackground(color: HighlightColor): void {
    if (!this._highlightColorElement) return;
    this.removeSelectedColorDiv();
    const colorMap: Record<string, string> = {
      'NoColor': 'noColorDiv', 'Yellow': 'yellowDiv', 'BrightGreen': 'brightGreenDiv',
      'Turquoise': 'turquoiseDiv', 'Pink': 'hotPinkDiv', 'Blue': 'blueDiv',
      'Red': 'redDiv', 'DarkBlue': 'darkBlueDiv', 'Teal': 'tealDiv',
      'Green': 'greenDiv', 'Violet': 'violetDiv', 'DarkRed': 'darkRedDiv',
      'DarkYellow': 'darkYellowDiv', 'Gray50': 'gray50Div', 'Gray25': 'gray25Div',
      'Black': 'blackDiv'
    };
    const divId = colorMap[color as string];
    if (divId) {
      this._highlightColorElement.querySelector('#' + divId)?.classList.add('e-color-selected');
    }
  }

  private removeSelectedColorDiv(): void {
    if (!this._highlightColorElement) return;
    const allIds = [
      'noColorDiv', 'yellowDiv', 'brightGreenDiv', 'turquoiseDiv', 'hotPinkDiv',
      'blueDiv', 'redDiv', 'darkBlueDiv', 'tealDiv', 'greenDiv', 'violetDiv',
      'darkRedDiv', 'darkYellowDiv', 'gray50Div', 'gray25Div', 'blackDiv'
    ];
    for (const id of allIds) {
      this._highlightColorElement.querySelector('#' + id)?.classList.remove('e-color-selected');
    }
  }

  // ==================== Lists & Image ====================

  private bulletListAction(args: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    switch (args.item.text) {
      case 'None': ed.editor.clearList(); break;
      case 'Dot': ed.editor.applyBullet(String.fromCharCode(61623), 'Symbol'); break;
      case 'Circle': ed.editor.applyBullet(String.fromCharCode(61551) + String.fromCharCode(32), 'Symbol'); break;
      case 'Square': ed.editor.applyBullet(String.fromCharCode(61607), 'Wingdings'); break;
      case 'Flower': ed.editor.applyBullet(String.fromCharCode(61558), 'Wingdings'); break;
      case 'Arrow': ed.editor.applyBullet(String.fromCharCode(61656), 'Wingdings'); break;
      case 'Tick': ed.editor.applyBullet(String.fromCharCode(61692), 'Wingdings'); break;
    }
    setTimeout(() => ed.focusIn(), 30);
  }

  private numberListAction(args: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
    const fmt = this.getLevelFormatNumber();
    switch (args.item.text) {
      case 'None': ed.editor.clearList(); break;
      case 'NumberDot': ed.editor.applyNumbering(fmt, 'Arabic'); break;
      case 'UpRoman': ed.editor.applyNumbering(fmt, 'UpRoman'); break;
      case 'UpLetter': ed.editor.applyNumbering(fmt, 'UpLetter'); break;
      case 'LowLetter': ed.editor.applyNumbering(fmt, 'LowLetter'); break;
      case 'LowRoman': ed.editor.applyNumbering(fmt, 'LowRoman'); break;
    }
    setTimeout(() => ed.focusIn(), 30);
  }

  private getLevelFormatNumber(): string {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return '%1.';
    const rawLevel = ed.selection.paragraphFormat.listLevelNumber;
    const level =
      typeof rawLevel === 'number' && Number.isFinite(rawLevel) && rawLevel > 0
        ? rawLevel
        : 0;
    return '%' + (level + 1) + '.';
  }

  private imageSelect(args: any): void {
    if (args.item.id === 'imageLocal' && this._imagePicker) {
      this._imagePicker.value = '';
      this._imagePicker.click();
    }
    setTimeout(() => this.docEditor?.documentEditor?.focusIn(), 30);
  }

  private onImagePickerChange(): void {
    if (!this._imagePicker?.files?.length) return;
    const file = this._imagePicker.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.docEditor?.documentEditor?.editor.insertImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  }
}
