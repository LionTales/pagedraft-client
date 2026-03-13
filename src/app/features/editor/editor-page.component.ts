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
import { SfdtManipulationService, suggestionBookmarkName } from '../../core/services/sfdt-manipulation.service';

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
    private editorTextService: EditorTextService
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
      this.analysisStatusPercent = null;
      return;
    }
    this.analysisStatusPercent = Math.max(0, Math.min(100, Math.round(percent)));
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
      // When offsets missing but originalText provided (e.g. Redo suggestion from Versions), find range in normalized document
      if ((startOffset == null || endOffset == null) && event.originalText != null && currentText) {
        const normOriginal = normalizeTextForAnalysis(event.originalText);
        const idx = currentText.indexOf(normOriginal);
        if (idx >= 0) {
          startOffset = idx;
          endOffset = idx + normOriginal.length;
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
      } else {
        newSfdt = this.sfdtService.buildMinimalSfdt(appliedText);
      }

      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (this.docEditor?.documentEditor && this.selectedChapterId) {
            this.docEditor.documentEditor.open(newSfdt);
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
                .create(
                  this.bookId,
                  this.selectedChapterId,
                  sfdt,
                  label,
                  this.selectedSceneId ?? undefined,
                  event.analysisId ?? undefined,
                  event.suggestionId ?? undefined,
                  event.originalText ?? undefined,
                  appliedText
                )
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
   * Modifies the SFDT directly (so we don't rely on selectByHierarchicalIndex, which
   * can yield empty selection when the runtime structure differs). Re-opens the document
   * with highlights applied. Highlights are stripped before save.
   */
  applySuggestionHighlights(ranges: { suggestionId?: string; startOffset: number; endOffset: number }[]): void {
    const editor = this.docEditor?.documentEditor;
    if (!editor || !this.selectedChapterId) return;

    this.lastSuggestionRanges = ranges.slice();

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

      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (this.docEditor?.documentEditor && this.selectedChapterId) {
            this.docEditor.documentEditor.open(sfdt);
          }
        } finally {
          this.isOpeningDocument = false;
        }
      }, 0);
    } catch {
      // ignore
    }
  }


  /** Update currentDocumentPlainText from the editor content (for analysis panel). Call before run so diff uses latest text. */
  refreshDocumentPlainText(): void {
    const text = this.editorTextService.refreshDocumentPlainText(this.docEditor, this.selectedChapterId);
    if (text) {
      this.currentDocumentPlainText = text;
    }
  }
}
