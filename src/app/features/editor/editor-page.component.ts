import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { DocumentEditorContainerComponent, DocumentEditorContainerModule } from '@syncfusion/ej2-angular-documenteditor';
import { BookService } from '../../core/services/book.service';
import { ChapterService } from '../../core/services/chapter.service';
import { SceneService } from '../../core/services/scene.service';
import { SyncService } from '../../core/services/sync.service';
import { BookDetailDto, ChapterSummaryDto, SceneSummaryDto } from '../../core/models/book';
import { ChapterTreeComponent } from '../chapter-tree/chapter-tree.component';
import { AnalysisPanelComponent } from '../analysis-panel/analysis-panel.component';
import { IssuePanelComponent, ApplyCorrectionEvent } from '../language-engine/issue-panel.component';
import { BookDashboardComponent } from '../book-dashboard/book-dashboard.component';
import { LanguageIssue } from '../../core/models/language-engine';

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
  template: `
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
          <div class="editor-shell">
            <div class="editor-status">
              <span *ngIf="isSaving">שומר…</span>
              <span *ngIf="!isSaving && hasPendingChanges">שינויים ממתינים לשמירה</span>
              <span *ngIf="!isSaving && !hasPendingChanges">כל השינויים נשמרו</span>
              @if (selectedSceneId) {
                <span class="scope-badge">Scene</span>
              }
            </div>
            <ejs-documenteditorcontainer
              #docEditor
              [enableToolbar]="true"
              [enableRtl]="true"
              [locale]="'he'"
              [height]="'100%'"
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
            [sceneId]="selectedSceneId">
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
  `,
  styles: [`
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
    .editor-area ejs-documenteditorcontainer,
    .editor-area ejs-documenteditorcontainer .e-de-ctnr {
      display: block;
      width: 100%;
      height: 100%;
    }
    .badge { font-size: 0.75rem; color: #666; }
    .scope-badge { font-size: 0.7rem; color: #0078d4; margin-inline-start: 0.5rem; }
    .add-chapter { width: 100%; margin-bottom: 0.75rem; padding: 0.5rem; cursor: pointer; }
    .import-btn { padding: 0.35rem 0.5rem; font-size: 0.8rem; cursor: pointer; }
  `]
})
export class EditorPageComponent implements OnInit, OnDestroy {
  @ViewChild('docEditor', { static: false })
  docEditor?: DocumentEditorContainerComponent;

  book: BookDetailDto | null = null;
  selectedChapterId: string | null = null;
  selectedSceneId: string | null = null;
  bookId: string | null = null;
  expandedChapterIds: string[] = [];
  scenesByChapter: Record<string, SceneSummaryDto[]> = {};
  private destroy$ = new Subject<void>();
  private contentChanged$ = new Subject<void>();
  isSaving = false;
  hasPendingChanges = false;
  rightPanelTab: 'analysis' | 'language' | 'book' = 'analysis';
  private pendingLoadTarget: { chapterId: string; sceneId?: string } | null = null;
  private isOpeningDocument = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookService: BookService,
    private chapterService: ChapterService,
    private sceneService: SceneService,
    private syncService: SyncService
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
      .pipe(debounceTime(3000), takeUntil(this.destroy$))
      .subscribe(() => this.saveCurrentDocument());
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
    if (this.bookId) this.syncService.leaveBook(this.bookId);
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Valid empty SFDT with one paragraph so selection/layout have a valid target (avoids Syncfusion length/currentWidget errors). */
  private static readonly EMPTY_SFDT = '{"sections":[{"blocks":[{"inlines":[{"characterFormat":{},"text":""}]}],"headersFooters":{}}]}';

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
      const sfdt = raw && raw !== '{"sections":[{"blocks":[]}]}' ? raw : EditorPageComponent.EMPTY_SFDT;
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (!this.docEditor?.documentEditor || this.selectedChapterId !== chapterId || this.selectedSceneId) return;
          this.docEditor.documentEditor.open(sfdt);
          this.hasPendingChanges = false;
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
      const sfdt = raw && raw !== '{"sections":[{"blocks":[]}]}' ? raw : EditorPageComponent.EMPTY_SFDT;
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (!this.docEditor?.documentEditor || this.selectedSceneId !== sceneId) return;
          this.docEditor.documentEditor.open(sfdt);
          this.hasPendingChanges = false;
        } finally {
          this.isOpeningDocument = false;
        }
      }, 0);
    });
  }

  private applyRtlToSelectionDeferred(): void {
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

  onContentChange(): void {
    if (!this.selectedChapterId) return;
    this.hasPendingChanges = true;
    this.contentChanged$.next();
  }

  private saveCurrentDocument(onCompleted?: () => void): void {
    if (!this.bookId || !this.selectedChapterId || !this.docEditor || !this.hasPendingChanges || this.isOpeningDocument) {
      if (onCompleted) onCompleted();
      return;
    }
    let sfdt: string;
    try {
      sfdt = this.docEditor.documentEditor.serialize();
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
          console.error('Failed to auto-save scene');
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
          console.error('Failed to auto-save chapter');
          if (onCompleted) onCompleted();
        }
      });
    }
  }

  goToImport(): void {
    if (!this.bookId) return;
    this.router.navigate(['/books', this.bookId, 'import']);
  }

  onEditorCreated(): void {
    if (!this.docEditor) return;
    this.docEditor.documentEditor.enableRtl = true;
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
      const sfdt = this.docEditor.documentEditor.serialize();
      const currentText = this.getTextFromSfdt(sfdt);
      const newText =
        event.startOffset != null && event.endOffset != null
          ? currentText.slice(0, event.startOffset) + event.text + currentText.slice(event.endOffset)
          : event.text;
      const newSfdt = this.buildMinimalSfdt(newText);
      this.isOpeningDocument = true;
      setTimeout(() => {
        try {
          if (this.docEditor?.documentEditor && this.selectedChapterId) {
            this.docEditor.documentEditor.open(newSfdt);
            this.hasPendingChanges = true;
            this.contentChanged$.next();
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
    // Optional: scroll editor to issue range or select it (Syncfusion selection by offset would go here).
  }

  /** Extract plain text from SFDT JSON by walking sections/blocks/inlines. */
  private getTextFromSfdt(sfdtString: string): string {
    try {
      const doc = JSON.parse(sfdtString) as { sections?: Array<{ blocks?: Array<{ inlines?: Array<{ text?: string }> }> }> };
      const parts: string[] = [];
      for (const section of doc.sections ?? []) {
        for (const block of section.blocks ?? []) {
          for (const inline of block.inlines ?? []) {
            if (typeof inline.text === 'string') parts.push(inline.text);
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
    return `{"sections":[{"blocks":[{"inlines":[{"characterFormat":{},"text":${escaped}}]}],"headersFooters":{}}]}`;
  }
}
