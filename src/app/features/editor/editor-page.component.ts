import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { DocumentEditorContainerComponent, DocumentEditorContainerModule, ToolbarService } from '@syncfusion/ej2-angular-documenteditor';
import { BookService } from '../../core/services/book.service';
import { ChapterService } from '../../core/services/chapter.service';
import { SceneService } from '../../core/services/scene.service';
import { SyncService } from '../../core/services/sync.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { BookDetailDto, ChapterSummaryDto, SceneSummaryDto } from '../../core/models/book';
import { ChapterTreeComponent } from '../chapter-tree/chapter-tree.component';
import { AnalysisPanelComponent } from '../analysis-panel/analysis-panel.component';
import { IssuePanelComponent, ApplyCorrectionEvent } from '../language-engine/issue-panel.component';
import { BookDashboardComponent } from '../book-dashboard/book-dashboard.component';
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
    BookDashboardComponent
  ],
  providers: [ToolbarService],
  templateUrl: './editor-page.component.html',
  styleUrl: './editor-page.component.scss'
})
export class EditorPageComponent implements OnInit, OnDestroy {
  @ViewChild('docEditor', { static: false })
  docEditor?: DocumentEditorContainerComponent;
  @ViewChild(AnalysisPanelComponent, { static: false })
  analysisPanel?: AnalysisPanelComponent;

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
  rightPanelTab: 'analysis' | 'language' | 'book' = 'analysis';
  /** True while an analysis run or stream is in progress; shows full-screen overlay and blocks interaction. */
  analysisRunning = false;
  /** Human-readable status text shown in the analysis overlay spinner. */
  analysisStatusText = 'Running analysis…';
  /** Numeric percent (0–100) for analysis overlay progress bar; null when unknown. */
  analysisStatusPercent: number | null = null;
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
    private sfdtService: SfdtManipulationService,
    private editorTextService: EditorTextService,
    private suggestionAnchorService: SuggestionAnchorService
  ) {}

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.bookId = params['bookId'] ?? null;
      if (this.bookId) {
        this.syncService.connect().then(() => this.syncService.joinBook(this.bookId!));
        this.bookService.getById(this.bookId).subscribe(b => {
          this.book = b;
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
    this.bookService.getById(this.bookId).subscribe(b => { this.book = b; });
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
    const title = prompt('Chapter title', 'New chapter')?.trim() || 'New chapter';
    this.chapterService.create(this.bookId, title, null, this.book.chapters.length).subscribe({
      next: (created) => {
        this.bookService.getById(this.bookId!).subscribe(b => {
          this.book = b;
          this.selectChapter(created);
        });
      },
      error: () => alert('Failed to add chapter.')
    });
  }

  renameChapter(ch: ChapterSummaryDto): void {
    if (!this.bookId || !this.book) return;
    const current = ch.title;
    const next = prompt('Rename chapter:', current)?.trim();
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
        alert('Failed to rename chapter.');
      }
    });
  }

  deleteChapter(ch: ChapterSummaryDto): void {
    if (!this.bookId || !this.book) return;
    const confirmed = confirm(`Delete chapter "${ch.title}"? This cannot be undone.`);
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
        alert('Failed to delete chapter.');
      }
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    if (this.bookId) this.syncService.leaveBook(this.bookId);
    if (this._scrollSettleTimer) clearTimeout(this._scrollSettleTimer);
    this.destroyCustomToolbar();
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
      error: () => alert('Split scenes failed. Save the chapter first so it has content to split.')
    });
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

  /** Called when analysis panel starts a run or stream; shows overlay and freezes UI. */
  onAnalysisStarted(): void {
    this.analysisRunning = true;
    this.analysisStatusText = 'Running analysis…';
    this.analysisStatusPercent = null;
    this.refreshDocumentPlainText();
  }

  /** Called when analysis panel finishes (success or error); hides overlay. */
  onAnalysisCompleted(): void {
    this.analysisRunning = false;
  }

  /** Receive human-readable status messages from the analysis panel while a run is in progress. */
  onAnalysisStatus(message: string): void {
    if (message && this.analysisRunning) {
      this.analysisStatusText = message;
    }
  }

  /** Receive numeric progress (0–100) from analysis panel to show a progress bar in the overlay. */
  onAnalysisProgressPercent(percent: number | null): void {
    if (!this.analysisRunning) {
      this.analysisStatusPercent = null;
      return;
    }
    if (percent == null || Number.isNaN(percent)) {
      return;
    }
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    // Keep progress bar non-decreasing so out-of-order backend updates don't show the bar going backwards.
    this.analysisStatusPercent = this.analysisStatusPercent != null
      ? Math.max(this.analysisStatusPercent, next)
      : next;
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
    try { this.customToolbar?.destroy(); } catch { /* ignore */ }
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
    this.customToolbar = null;
    this.fontFamilyCombo = null;
    this.fontSizeCombo = null;
    this.fontColorPicker = null;
    this.highlightColorSplitBtn = null;
    this._highlightColorElement = null;
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
    if (!ed) return;
    ed.selection.characterFormat.fontFamily = args.value;
    ed.focusIn();
  }

  private onFontSizeChange(args: any): void {
    const ed = this.docEditor?.documentEditor;
    if (!ed) return;
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
      div.addEventListener('click', (e: any) => this.onHighlightColor(e));
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
    nocolorDiv.addEventListener('click', (e: any) => this.onHighlightColor(e));
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
