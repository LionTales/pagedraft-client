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
import { normalizeTextForAnalysis, normalizedOffsetToRawOffset } from '../../core/utils/normalize-text-for-analysis';

/** Convert a suggestion UUID to a Syncfusion-safe bookmark name (letters, digits, underscores only). */
function suggestionBookmarkName(suggestionId: string): string {
  return 'sg_' + suggestionId.replace(/-/g, '_');
}

/** Prefix used by suggestionBookmarkName -- kept in sync for cleanup matching. */
const SUGGESTION_BOOKMARK_PREFIX = 'sg_';

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
  template: `
    <div class="editor-page-wrapper">
      <div class="editor-layout">
      <aside class="sidebar">
        <div class="sidebar-header">
          <h3>Chapters</h3>
          @if (bookId) {
            <button type="button" class="import-btn" (click)="goToImport()">Import DOCX</button>
          }
        </div>
        @if (book) {
          <app-chapter-tree
            [chapters]="book.chapters"
            [selectedChapterId]="selectedChapterId"
            [selectedSceneId]="selectedSceneId"
            [expandedChapters]="expandedChapterIds"
            [scenesMap]="scenesByChapter"
            (chapterSelected)="selectChapter($event)"
            (sceneSelected)="selectScene($event)"
            (toggleExpandChapter)="onToggleExpandChapter($event)"
            (reorder)="onReorder($event)"
            (addChapter)="addChapter()"
            (renameChapter)="renameChapter($event)"
            (deleteChapter)="deleteChapter($event)"
            (splitScenes)="onSplitScenes($event)">
          </app-chapter-tree>
        }
      </aside>
      <main class="editor-area">
        @if (selectedChapterId) {
          <div class="editor-shell" [attr.dir]="editorDirection">
            <div class="editor-status">
              <span *ngIf="isSaving">שומר…</span>
              <span *ngIf="!isSaving && hasPendingChanges">שינויים ממתינים לשמירה</span>
              <span *ngIf="!isSaving && !hasPendingChanges">כל השינויים נשמרו</span>
              @if (selectedSceneId) {
                <span class="scope-badge">Scene</span>
              }
              <span class="direction-btns">
                <button type="button" class="dir-btn" title="Right-to-left (RTL)" (click)="setSelectionRtl()">RTL</button>
                <button type="button" class="dir-btn" title="Left-to-right (LTR)" (click)="setSelectionLtr()">LTR</button>
              </span>
              <button type="button" class="save-btn" [disabled]="!hasPendingChanges || isSaving" (click)="saveCurrentDocument()">שמור</button>
              <button type="button" class="back-btn" (click)="goBackToBooks()">חזרה לספרים</button>
            </div>
            <ejs-documenteditorcontainer
              #docEditor
              [enableToolbar]="true"
              [toolbarMode]="'Toolbar'"
              [showPropertiesPane]="false"
              [enableRtl]="editorDirection === 'rtl'"
              [locale]="editorCulture"
              [height]="'100%'"
              serviceUrl="/api/documenteditor/"
              (created)="onEditorCreated()"
              (contentChange)="onContentChange()">
            </ejs-documenteditorcontainer>
          </div>
        } @else {
          <p>Select a chapter or scene from the sidebar.</p>
        }
      </main>
      <aside class="panel">
        <nav class="panel-tabs">
          <button
            type="button"
            class="panel-tab"
            [class.active]="rightPanelTab === 'analysis'"
            (click)="rightPanelTab = 'analysis'">
            Analysis
          </button>
          <button
            type="button"
            class="panel-tab"
            [class.active]="rightPanelTab === 'language'"
            (click)="rightPanelTab = 'language'">
            Language
          </button>
          <button
            type="button"
            class="panel-tab"
            [class.active]="rightPanelTab === 'book'"
            (click)="rightPanelTab = 'book'">
            Book
          </button>
        </nav>
        @if (rightPanelTab === 'analysis') {
          <app-analysis-panel
            [bookId]="bookId"
            [chapterId]="selectedChapterId"
            [sceneId]="selectedSceneId"
            [bookLanguage]="book?.language ?? 'he'"
            [documentText]="currentDocumentPlainText"
            [documentChapterId]="documentOwnerChapterId"
            [documentSceneId]="documentOwnerSceneId"
            [saveBeforeRun]="saveBeforeRun"
            (analysisStarted)="onAnalysisStarted()"
            (analysisCompleted)="onAnalysisCompleted()"
            (analysisStatus)="onAnalysisStatus($event)"
            (analysisProgressPercent)="onAnalysisProgressPercent($event)"
            (applyCorrection)="onApplyCorrection($event)"
            (showInDocument)="selectRangeInEditor($event)"
            (suggestionRangesChange)="applySuggestionHighlights($event)"
            (revertToVersion)="onRevertToVersion($event)">
          </app-analysis-panel>
        }
        @if (rightPanelTab === 'language') {
          <app-issue-panel
            [bookId]="bookId ?? undefined"
            [chapterId]="selectedChapterId ?? undefined"
            (rewriteApplied)="onApplyCorrection($event)"
            (issueHighlighted)="onIssueHighlighted($event)">
          </app-issue-panel>
        }
        @if (rightPanelTab === 'book' && bookId && book) {
          <app-book-dashboard
            [bookId]="bookId"
            [bookTitle]="book.title">
          </app-book-dashboard>
        }
      </aside>
    </div>
    @if (analysisRunning) {
      <div class="analysis-overlay" role="status" aria-live="polite" aria-label="Analysis in progress">
        <div class="analysis-overlay-card">
          <h3 class="analysis-overlay-title">Run analysis</h3>
          <div class="analysis-spinner"></div>
          <p class="analysis-overlay-message">{{ analysisStatusText }}</p>
          <div class="analysis-progress-wrapper" *ngIf="analysisStatusPercent !== null">
            <div class="analysis-progress-bar">
              <div class="analysis-progress-fill" [style.width.%]="analysisStatusPercent"></div>
            </div>
            <span class="analysis-progress-label">{{ analysisStatusPercent }}%</span>
          </div>
        </div>
      </div>
    }
  </div>
  `,
  styles: [`
    .editor-page-wrapper { position: relative; }
    .editor-layout {
      display: grid;
      grid-template-columns: 240px minmax(0, 2fr) 300px;
      min-height: 100vh;
    }
    .sidebar { border-right: 1px solid #eee; padding: 1rem; overflow-y: auto; }
    .sidebar-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
    .panel {
      border-left: 1px solid #eee;
      padding: 0.5rem 1rem 1rem;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-height: 100vh;
      overflow-y: auto;
    }
    .panel-tabs {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 0.5rem;
    }
    .panel-tab {
      padding: 0.35rem 0.6rem;
      border: 1px solid #ddd;
      background: #fff;
      cursor: pointer;
      font-size: 0.85rem;
      border-radius: 4px;
    }
    .panel-tab:hover { background: #f5f5f5; }
    .panel-tab.active {
      background: #0078d4;
      color: #fff;
      border-color: #0078d4;
    }
    .editor-area {
      padding: 1rem;
      display: flex;
      align-items: stretch;
      height: calc(100vh - 2rem);
      box-sizing: border-box;
    }
    .editor-shell {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .editor-status {
      display: flex;
      justify-content: flex-end;
      font-size: 0.75rem;
      color: #555;
      margin-bottom: 0.25rem;
      gap: 0.5rem;
    }
    .editor-area ejs-documenteditorcontainer {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }
    .editor-area ejs-documenteditorcontainer > * {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .editor-area ejs-documenteditorcontainer .e-de-ctnr {
      flex: 1;
      min-height: 0;
      width: 100%;
    }
    .badge { font-size: 0.75rem; color: #666; }
    .scope-badge { font-size: 0.7rem; color: #0078d4; margin-inline-start: 0.5rem; }
    .save-btn, .back-btn {
      margin-inline-start: 0.5rem;
      padding: 0.25rem 0.5rem;
      font-size: 0.8rem;
      border: 1px solid #0078d4;
      border-radius: 4px;
      background: #fff;
      color: #0078d4;
      cursor: pointer;
    }
    .save-btn:hover:not(:disabled) { background: #e6f0ff; }
    .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .back-btn { border-color: #666; color: #333; }
    .back-btn:hover { background: #f5f5f5; }
    .direction-btns { display: inline-flex; gap: 0.2rem; margin-inline-start: 0.5rem; }
    .dir-btn {
      padding: 0.2rem 0.4rem;
      font-size: 0.75rem;
      border: 1px solid #888;
      border-radius: 4px;
      background: #fff;
      color: #333;
      cursor: pointer;
    }
    .dir-btn:hover { background: #eee; }
    .add-chapter { width: 100%; margin-bottom: 0.75rem; padding: 0.5rem; cursor: pointer; }
    .import-btn { padding: 0.35rem 0.5rem; font-size: 0.8rem; cursor: pointer; }
    .analysis-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(255, 255, 255, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    }
    .analysis-overlay-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem 2rem;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      border: 1px solid #eee;
      min-width: 260px;
      max-width: 360px;
    }
    .analysis-overlay-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: #222;
    }
    .analysis-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e0e0e0;
      border-top-color: #0078d4;
      border-radius: 50%;
      animation: analysis-spin 0.8s linear infinite;
    }
    @keyframes analysis-spin {
      to { transform: rotate(360deg); }
    }
    .analysis-overlay-message {
      margin: 0;
      font-size: 0.95rem;
      color: #333;
      text-align: center;
    }
    .analysis-progress-wrapper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      margin-top: 0.25rem;
    }
    .analysis-progress-bar {
      flex: 1;
      height: 6px;
      border-radius: 999px;
      background: #f0f0f0;
      overflow: hidden;
    }
    .analysis-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #0078d4, #4ba3ff);
      transition: width 0.25s ease-out;
    }
    .analysis-progress-label {
      font-size: 0.75rem;
      color: #555;
      min-width: 2.5rem;
      text-align: right;
    }
  `]
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
    private analysisService: AnalysisService
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

  /**
   * Ensure all paragraphs and inlines in SFDT have bidi: true so RTL punctuation and layout render correctly.
   * Call when loading content for a Hebrew (or other RTL) book so existing content is not treated as LTR.
   */
  private ensureSfdtRtl(sfdtString: string): string {
    if (this.editorDirection !== 'rtl') return sfdtString;
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const pf = block['paragraphFormat'] ?? block['pf'];
          if (pf && typeof pf === 'object') {
            (pf as Record<string, unknown>)['bidi'] = true;
          }
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          for (const inline of inlines) {
            const cf = inline['characterFormat'] ?? inline['cf'];
            if (cf && typeof cf === 'object') {
              (cf as Record<string, unknown>)['bidi'] = true;
            }
          }
        }
      }
      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

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
      sfdt = this.ensureSfdtRtl(sfdt);
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (!this.docEditor?.documentEditor || this.selectedChapterId !== chapterId || this.selectedSceneId) return;
          this.docEditor.documentEditor.open(sfdt);
          this.hasPendingChanges = false;
          this.currentDocumentPlainText = normalizeTextForAnalysis(this.getTextFromSfdt(sfdt));
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
      sfdt = this.ensureSfdtRtl(sfdt);
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (!this.docEditor?.documentEditor || this.selectedSceneId !== sceneId) return;
          this.docEditor.documentEditor.open(sfdt);
          this.hasPendingChanges = false;
          this.currentDocumentPlainText = normalizeTextForAnalysis(this.getTextFromSfdt(sfdt));
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
      sfdt = this.stripHighlightFromSfdt(sfdt);
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
      sfdt = this.stripHighlightFromSfdt(sfdt);
      // Offsets from proofread diff are in normalized document text; use currentDocumentPlainText for the slice
      const currentText =
        this.currentDocumentPlainText ||
        normalizeTextForAnalysis(this.getTextFromSfdt(sfdt) || this.getPlainTextFromEditor());
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
        newSfdt = this.replacePlainTextInSfdt(
          sfdt,
          newText,
          startOffset,
          endOffset,
          appliedText.length
        );
      } else {
        newSfdt = this.buildMinimalSfdt(appliedText);
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
              const timeLabel = now.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
              const maxLen = 35;
              const trunc = (t: string) => (t.length <= maxLen ? t : t.slice(0, maxLen) + '…');
              const label = event.originalText != null
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
        if (sfdt) sfdt = this.ensureSfdtRtl(sfdt);
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
              this.isOpeningDocument = false;
              this.saveCurrentDocument();
              // When this version was created from Accept suggestion, mark the linked suggestion
              // as Reverted; the analysis panel will refresh History/Versions after persisting.
              const analysisId = detail.analysisResultId ?? detail.analysisId;
              if (analysisId && detail.originalText && detail.suggestedText && this.analysisPanel) {
                this.analysisPanel.markSuggestionReverted(analysisId, detail.originalText, detail.suggestedText);
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
  selectRangeInEditor(payload: { suggestionId?: string; startOffset: number; endOffset: number; originalText?: string }): void {
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
            const startPos = this.plainOffsetToSfdtPosition(sfdt, startOffset);
            const endPos = this.plainOffsetToSfdtPosition(sfdt, endOffset);
            if (startPos && endPos && editor.selection?.select) {
              editor.selection.select(startPos, endPos);
              editor.focusIn();
              return;
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
      sfdt = this.stripHighlightFromSfdt(sfdt);

      if (ranges.length > 0) {
        const docLen =
          this.currentDocumentPlainText.length ||
          normalizeTextForAnalysis(this.getTextFromSfdt(sfdt)).length ||
          normalizeTextForAnalysis(this.getPlainTextFromEditor()).length;
        const validRanges = ranges.filter(({ startOffset, endOffset }) => {
          const spanLen = endOffset - startOffset;
          return docLen <= 0 || spanLen < docLen * 0.9;
        });
        sfdt = this.applyHighlightRangesToSfdt(sfdt, validRanges);
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

  /**
   * Apply Yellow highlight to the given plain-text character ranges in the SFDT.
   * Uses the same key convention as the serialized document (standard or Syncfusion v32 optimized).
   */
  private applyHighlightRangesToSfdt(
    sfdtString: string,
    ranges: { suggestionId?: string; startOffset: number; endOffset: number }[]
  ): string {
    if (ranges.length === 0) return sfdtString;
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      let running = 0; // normalized character count (ranges are in normalized document text)

      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          const newInlines: Record<string, unknown>[] = [];
          const inlinesKey = block['inlines'] != null ? 'inlines' : 'i';
          const textKey = this.detectTextKey(inlines);
          const cfKey = this.detectCharacterFormatKey(inlines);

          for (const inline of inlines) {
            const text = inline['text'] ?? inline['tlp'];
            if (typeof text !== 'string') {
              newInlines.push({ ...inline });
              continue;
            }
            const normLen = normalizeTextForAnalysis(text).length;
            const blockStart = running;
            const blockEnd = running + normLen;
            running = blockEnd;

            const spans = this.getHighlightSpansInRange(blockStart, blockEnd, ranges);
            if (spans.length === 0) {
              newInlines.push(this.inlineWithoutHighlight(inline, cfKey));
              continue;
            }

            let posRaw = 0;
            for (const span of spans) {
              const spanStart = span.start;
              const spanEnd = span.end;
              const bookmarkName = span.suggestionId ? suggestionBookmarkName(span.suggestionId) : undefined;
              const isFirstPart = spanStart === span.fullStart;
              const isLastPart = spanEnd === span.fullEnd;
              const startNormInInline = spanStart - blockStart;
              const endNormInInline = spanEnd - blockStart;
              const startRaw = normalizedOffsetToRawOffset(text, startNormInInline);
              const endRaw = normalizedOffsetToRawOffset(text, endNormInInline);
              if (startRaw > posRaw) {
                newInlines.push(this.createInlineForHighlight(text.slice(posRaw, startRaw), inline, false, textKey, cfKey));
              }
              if (endRaw > startRaw) {
                if (bookmarkName && isFirstPart) {
                  newInlines.push(this.createBookmarkInline(inline, bookmarkName, true, cfKey));
                }
                newInlines.push(this.createInlineForHighlight(text.slice(startRaw, endRaw), inline, true, textKey, cfKey));
                if (bookmarkName && isLastPart) {
                  newInlines.push(this.createBookmarkInline(inline, bookmarkName, false, cfKey));
                }
              }
              posRaw = endRaw;
            }
            if (posRaw < text.length) {
              newInlines.push(this.createInlineForHighlight(text.slice(posRaw), inline, false, textKey, cfKey));
            }
          }

          block[inlinesKey] = newInlines;
        }
      }

      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

  private getHighlightSpansInRange(
    blockStart: number,
    blockEnd: number,
    ranges: { suggestionId?: string; startOffset: number; endOffset: number }[]
  ): Array<{ start: number; end: number; suggestionId?: string; fullStart: number; fullEnd: number }> {
    const spans: Array<{ start: number; end: number; suggestionId?: string; fullStart: number; fullEnd: number }> = [];
    for (const { suggestionId, startOffset, endOffset } of ranges) {
      const start = Math.max(blockStart, startOffset);
      const end = Math.min(blockEnd, endOffset);
      if (start < end) spans.push({ start, end, suggestionId, fullStart: startOffset, fullEnd: endOffset });
    }
    return spans.sort((a, b) => a.start - b.start);
  }

  private detectTextKey(inlines: Array<Record<string, unknown>>): 'text' | 'tlp' {
    for (const inline of inlines) {
      if (inline['tlp'] !== undefined) return 'tlp';
      if (inline['text'] !== undefined) return 'text';
    }
    return 'text';
  }

  private detectCharacterFormatKey(inlines: Array<Record<string, unknown>>): 'characterFormat' | 'cf' {
    for (const inline of inlines) {
      if (inline['cf'] !== undefined) return 'cf';
      if (inline['characterFormat'] !== undefined) return 'characterFormat';
    }
    return 'characterFormat';
  }

  private inlineWithoutHighlight(inline: Record<string, unknown>, cfKey: string): Record<string, unknown> {
    const out = { ...inline };
    const cf = out[cfKey] as Record<string, unknown> | undefined;
    if (cf && typeof cf === 'object') {
      const fmt = { ...cf };
      delete fmt['highlightColor'];
      delete fmt['hc'];
      out[cfKey] = fmt;
    }
    return out;
  }

  private createBookmarkInline(
    template: Record<string, unknown>,
    name: string,
    isStart: boolean,
    cfKey: string
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    const cf = template[cfKey] as Record<string, unknown> | undefined;
    if (cf && typeof cf === 'object') {
      out[cfKey] = { ...cf };
    }

    const bookmarkType = isStart ? 0 : 1;
    // Heuristic: optimized SFDT uses compact character-format key 'cf' instead of 'characterFormat'.
    const useOptimizedKeys = cfKey === 'cf';
    if (useOptimizedKeys) {
      // Optimized SFDT keys (Syncfusion v21.1+ default): 'bkt' for bookmarkType, 'n' for name
      out['bkt'] = bookmarkType;
      out['n'] = name;
    } else {
      // Standard SFDT keys
      out['bookmarkType'] = bookmarkType;
      out['name'] = name;
    }

    return out;
  }

  private createInlineForHighlight(
    text: string,
    template: Record<string, unknown>,
    highlight: boolean,
    textKey: string,
    cfKey: string
  ): Record<string, unknown> {
    const out = { ...template };
    out[textKey] = text;

    const cf = template[cfKey] as Record<string, unknown> | undefined;
    const fmt = (cf && typeof cf === 'object') ? { ...cf } : {};
    if (highlight) {
      fmt['highlightColor'] = 'Yellow';
      fmt['hc'] = 'Yellow';
    } else {
      delete fmt['highlightColor'];
      delete fmt['hc'];
    }
    out[cfKey] = fmt;
    return out;
  }

  /**
   * Remove all highlight formatting from SFDT JSON so saved document does not persist suggestion highlights.
   * Handles both standard keys and Syncfusion v32 optimized keys.
   *
   * Also strips suggestion bookmarks (suggestion-*), removing dedicated bookmark-only
   * inlines so the saved document does not retain navigation markers.
   */
  private stripHighlightFromSfdt(sfdtString: string): string {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          const inlinesKey = block['inlines'] != null ? 'inlines' : 'i';
          const textKey = this.detectTextKey(inlines);
          const cfKey = this.detectCharacterFormatKey(inlines);
          const cleaned: Record<string, unknown>[] = [];
          for (const inline of inlines) {
            const cf = inline['characterFormat'] ?? inline['cf'];
            if (cf && typeof cf === 'object') {
              const fmt = cf as Record<string, unknown>;
              delete fmt['highlightColor'];
              delete fmt['hc'];
            }
            const name = inline['name'] ?? inline['n'];
            const bookmarkType = inline['bookmarkType'] ?? inline['bkt'];
            const isSuggestionBookmark =
              typeof name === 'string' &&
              (name.startsWith(SUGGESTION_BOOKMARK_PREFIX) || name.startsWith('suggestion-')) &&
              (bookmarkType === 0 || bookmarkType === 1);
            if (!isSuggestionBookmark) {
              cleaned.push(inline);
            }
          }
          // Merge adjacent text inlines with identical formatting to prevent SFDT
          // fragmentation from repeated highlight apply/strip cycles.
          block[inlinesKey] = this.mergeAdjacentTextInlines(cleaned, textKey, cfKey);
        }
      }
      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

  private mergeAdjacentTextInlines(
    inlines: Record<string, unknown>[],
    textKey: string,
    cfKey: string
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const inline of inlines) {
      const text = inline[textKey];
      if (typeof text !== 'string') {
        result.push(inline);
        continue;
      }
      if (result.length > 0) {
        const prev = result[result.length - 1];
        const prevText = prev[textKey];
        if (typeof prevText === 'string' && this.canMergeTextInlines(prev, inline, textKey)) {
          prev[textKey] = prevText + text;
          continue;
        }
      }
      result.push({ ...inline });
    }
    return result;
  }

  private canMergeTextInlines(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    textKey: string
  ): boolean {
    const aKeys = Object.keys(a).filter(k => k !== textKey);
    const bKeys = Object.keys(b).filter(k => k !== textKey);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
    }
    return true;
  }

  private getInlineTextLength(inline: Record<string, unknown>): number {
    const text = inline['text'] ?? inline['tlp'];
    return typeof text === 'string' ? normalizeTextForAnalysis(text).length : 0;
  }

  /**
   * Convert a plain-text character offset (matching getTextFromSfdt output) to a
   * Syncfusion hierarchical position string. Syncfusion expects four segments for body content:
   * "sectionIndex;bodyIndex;blockIndex;offset" so that getBodyWidget consumes two segments
   * and getParagraphInternal gets "blockIndex;offset". We use bodyIndex 0 for main content.
   *
   * Walks sections → blocks → inlines in the same order as getTextFromSfdt so the
   * running character count stays in sync with the normalized plain text the analysis panel uses.
   * Uses normalized lengths for the running counter and converts back to raw offsets via
   * normalizedOffsetToRawOffset so the returned position is valid for the actual SFDT.
   */
  private plainOffsetToSfdtPosition(sfdtString: string, plainOffset: number): string | null {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      let running = 0; // normalized character count
      let lastPos = '0;0;0;0';
      for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (let bi = 0; bi < blocks.length; bi++) {
          const block = blocks[bi];
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          let blockNormLen = 0;
          let blockRawLen = 0;
          for (const inline of inlines) {
            const text = inline['text'] ?? inline['tlp'];
            if (typeof text === 'string') {
              blockNormLen += normalizeTextForAnalysis(text).length;
              blockRawLen += text.length;
            }
          }
          if (plainOffset <= running + blockNormLen) {
            // Offset falls within this block; walk inlines again to map normalized offset
            // to a raw offset within the entire block (accumulating raw lengths).
            let blockRunningNorm = running;
            let blockRunningRaw = 0;
            for (const inline of inlines) {
              const text = inline['text'] ?? inline['tlp'];
              if (typeof text !== 'string') continue;
              const normLen = normalizeTextForAnalysis(text).length;
              const startNorm = blockRunningNorm;
              const endNorm = blockRunningNorm + normLen;
              if (plainOffset <= endNorm) {
                const offsetInInlineNorm = plainOffset - startNorm;
                const rawOffsetInInline = normalizedOffsetToRawOffset(text, offsetInInlineNorm);
                const rawOffsetInBlock = blockRunningRaw + rawOffsetInInline;
                return `${si};0;${bi};${rawOffsetInBlock}`;
              }
              blockRunningNorm = endNorm;
              blockRunningRaw += text.length;
            }
            // Fallback: if we couldn't map precisely, snap to end of block.
            return `${si};0;${bi};${blockRawLen}`;
          }
          running += blockNormLen;
          lastPos = `${si};0;${bi};${blockRawLen}`;
        }
      }
      return lastPos;
    } catch {
      return null;
    }
  }

  /** Update currentDocumentPlainText from the editor content (for analysis panel). Call before run so diff uses latest text. */
  refreshDocumentPlainText(): void {
    if (!this.docEditor?.documentEditor || !this.selectedChapterId) return;
    try {
      const sfdt = this.docEditor.documentEditor.serialize();
      const text = this.getTextFromSfdt(sfdt);
      if (text) {
        this.currentDocumentPlainText = normalizeTextForAnalysis(text);
        return;
      }
    } catch { /* fall through to selection fallback */ }
    const fallback = this.getPlainTextFromEditor();
    if (fallback) this.currentDocumentPlainText = normalizeTextForAnalysis(fallback);
  }

  /** Fallback: extract plain text via Syncfusion's selection API (works regardless of SFDT format). */
  private getPlainTextFromEditor(): string {
    const editor = this.docEditor?.documentEditor;
    if (!editor?.selection) return '';
    try {
      const startPos = editor.selection.startOffset;
      const endPos = editor.selection.endOffset;
      editor.selection.selectAll();
      const text = editor.selection.text || '';
      editor.selection.select(startPos, endPos);
      return text;
    } catch {
      return '';
    }
  }

  /**
   * Extract plain text from SFDT JSON by walking sections/blocks/inlines.
   * Handles both standard keys and Syncfusion v32 optimized keys (sec, b, i, tlp).
   */
  private getTextFromSfdt(sfdtString: string): string {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      const parts: string[] = [];
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          for (const inline of inlines) {
            const text = inline['text'] ?? inline['tlp'];
            if (typeof text === 'string') parts.push(text);
          }
        }
      }
      return parts.join('');
    } catch {
      return '';
    }
  }

  /** Build minimal SFDT with one paragraph containing the given text (RTL-friendly). */
  private buildMinimalSfdt(text: string): string {
    const escaped = JSON.stringify(text);
    return `{"sections":[{"blocks":[{"paragraphFormat":{"bidi":true},"inlines":[{"characterFormat":{"bidi":true},"text":${escaped}}]}],"headersFooters":{}}]}`;
  }

  /**
   * Replace the document's plain text with newPlainText inside the existing SFDT structure.
   * Preserves sections/blocks and key format (standard or optimized). Strips highlights.
   * When replaceStartOffset/replaceEndOffset/replaceTextLength are provided (range replace),
   * computes new block boundaries so segments stay aligned after length-changing edits.
   * Used by Accept suggestion so structure and formatting keys stay correct.
   */
  private replacePlainTextInSfdt(
    sfdtString: string,
    newPlainText: string,
    replaceStartOffset?: number,
    replaceEndOffset?: number,
    replaceTextLength?: number
  ): string {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;

      // Collect character length per block using normalized text (same order as getTextFromSfdt)
      const blockLengths: number[] = [];
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          let raw = '';
          for (const inline of inlines) {
            const t = inline['text'] ?? inline['tlp'];
            if (typeof t === 'string') raw += t;
          }
          blockLengths.push(normalizeTextForAnalysis(raw).length);
        }
      }

      let segments: string[];
      const hasReplaceRange =
        replaceStartOffset != null && replaceEndOffset != null && replaceTextLength != null;

      if (hasReplaceRange && blockLengths.length > 0) {
        // Compute new end position for each block after the replacement so segment slicing matches newPlainText length.
        const offsetDelta = replaceTextLength - (replaceEndOffset - replaceStartOffset);
        let running = 0;
        const newEnds: number[] = [];
        for (const len of blockLengths) {
          const blockStart = running;
          const blockEnd = running + len;
          running = blockEnd;
          if (blockEnd <= replaceStartOffset) {
            newEnds.push(blockEnd);
          } else if (blockStart >= replaceEndOffset) {
            newEnds.push(blockEnd + offsetDelta);
          } else if (blockEnd <= replaceEndOffset) {
            newEnds.push(replaceStartOffset + replaceTextLength);
          } else {
            newEnds.push(replaceStartOffset + replaceTextLength + (blockEnd - replaceEndOffset));
          }
        }
        segments = [];
        let prev = 0;
        for (const end of newEnds) {
          segments.push(newPlainText.slice(prev, end));
          prev = end;
        }
      } else {
        // No range replace or single block: split by original block lengths
        segments = [];
        let pos = 0;
        if (blockLengths.length === 0) {
          segments.push(newPlainText);
        } else {
          for (let i = 0; i < blockLengths.length; i++) {
            const len = blockLengths[i];
            if (i === blockLengths.length - 1) {
              segments.push(newPlainText.slice(pos));
            } else {
              segments.push(newPlainText.slice(pos, pos + len));
              pos += len;
            }
          }
        }
      }

      // Replace each block's inlines with a single inline containing the segment
      let segIdx = 0;
      const isRtl = this.editorDirection === 'rtl';
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          const inlinesKey = block['inlines'] != null ? 'inlines' : 'i';
          const textKey = this.detectTextKey(inlines);
          const cfKey = this.detectCharacterFormatKey(inlines);
          const segment = segments[segIdx++] ?? '';
          let template = inlines[0] ?? {};
          // Prefer the inline with the longest text content as the style template so we
          // inherit the dominant font/formatting for the paragraph instead of a tiny run.
          if (inlines.length > 1) {
            let best = template;
            let bestLen = this.getInlineTextLength(best);
            for (const cand of inlines) {
              const len = this.getInlineTextLength(cand);
              if (len > bestLen) {
                best = cand;
                bestLen = len;
              }
            }
            template = best;
          }
          // Preserve RTL so Accept doesn't strip bidi from the document
          if (isRtl) {
            const pf = block['paragraphFormat'] ?? block['pf'];
            if (pf && typeof pf === 'object') (pf as Record<string, unknown>)['bidi'] = true;
            const tCf = template[cfKey] as Record<string, unknown> | undefined;
            if (tCf && typeof tCf === 'object') tCf['bidi'] = true;
            else if (cfKey) template = { ...template, [cfKey]: { ...(template[cfKey] as object), bidi: true } };
          }
          const newInline = this.createInlineForHighlight(segment, template, false, textKey, cfKey);
          block[inlinesKey] = [newInline];
        }
      }

      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }
}
