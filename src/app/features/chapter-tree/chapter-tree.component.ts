import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { ChapterSummaryDto, SceneSummaryDto } from '../../core/models/book';

@Component({
  selector: 'app-chapter-tree',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  template: `
    <div class="chapter-tree-root" *ngIf="flatChapters().length; else empty" [attr.dir]="dir">
      <button type="button" class="add-chapter" (click)="addChapterClicked()">{{ label('addChapter') }}</button>

      <div
        cdkDropList
        [cdkDropListData]="flatChapters()"
        (cdkDropListDropped)="onDrop($event)"
        class="chapter-drop-list">

        @for (ch of flatChapters(); track ch.id; let i = $index) {
          @if (isNewPartHeader(i, ch.partName)) {
            <div class="part-header">
              {{ ch.partName || label('general') }}
            </div>
          }

          <div class="chapter-block">
            <div
              class="chapter-row"
              cdkDrag
              [class.active]="selectedChapterId === ch.id && !selectedSceneId"
              (click)="selectChapterClicked(ch, $event)"
              (contextmenu)="openContextMenu($event, ch)">
              <button
                type="button"
                class="expand-btn"
                [class.expanded]="isExpanded(ch.id)"
                (click)="toggleExpand(ch.id, $event)"
                [attr.aria-label]="label('toggleScenes')">
                {{ isExpanded(ch.id) ? '▼' : '▶' }}
              </button>
              <span class="drag-handle" cdkDragHandle>::</span>
              <span class="chapter-title">{{ ch.title }}</span>
              <span class="badge">{{ ch.wordCount }}</span>
            </div>

            @if (isExpanded(ch.id) && scenesByChapter()[ch.id]) {
              <div class="scene-list">
                @for (scene of scenesByChapter()[ch.id]; track scene.id) {
                  <div
                    class="scene-row"
                    [class.active]="selectedSceneId === scene.id"
                    (click)="selectSceneClicked(scene, ch.id, $event)"
                    (contextmenu)="openSceneContextMenu($event, scene, ch.id)">
                    <span class="scene-title">{{ scene.title }}</span>
                  </div>
                }
                @if ((scenesByChapter()[ch.id] || []).length === 0) {
                  <p class="no-scenes">{{ label('noScenes') }}</p>
                }
              </div>
            }
          </div>
        }
      </div>

      @if (contextMenu.visible && contextMenu.chapter) {
        <div
          class="context-menu"
          [style.top.px]="contextMenu.y"
          [style.left.px]="contextMenu.x">
          <button type="button" (click)="onRename(contextMenu.chapter)">{{ label('rename') }}</button>
          <button type="button" (click)="onSplitScenes(contextMenu.chapter)">{{ label('splitScenes') }}</button>
          <button
            type="button"
            [disabled]="scenesKnownEmpty(contextMenu.chapter.id)"
            (click)="onClearScenes(contextMenu.chapter)">{{ label('removeAllScenes') }}</button>
          <button type="button" (click)="onDelete(contextMenu.chapter)">{{ label('delete') }}</button>
        </div>
      }

      @if (sceneContextMenu.visible && sceneContextMenu.scene) {
        <div
          class="context-menu"
          [style.top.px]="sceneContextMenu.y"
          [style.left.px]="sceneContextMenu.x">
          <button type="button" (click)="onDeleteScene(sceneContextMenu.scene, sceneContextMenu.chapterId)">{{ label('deleteScene') }}</button>
        </div>
      }
    </div>

    <ng-template #empty>
      <button type="button" class="add-chapter" (click)="addChapterClicked()" [attr.dir]="dir">{{ label('addFirstChapter') }}</button>
      <p class="empty" [attr.dir]="dir">{{ label('noChapters') }}</p>
    </ng-template>
  `,
  styles: [`
    .chapter-tree-root {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-4);
    }

    .chapter-drop-list {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
    }

    .part-header {
      margin-block-start: var(--pd-space-4);
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-bold);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--pd-text-muted);
    }

    .chapter-block {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
    }

    .chapter-row {
      display: flex;
      align-items: center;
      gap: var(--pd-space-3);
      padding: var(--pd-space-2) var(--pd-space-3);
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      transition: background-color var(--pd-dur-fast) var(--pd-ease);
    }

    .chapter-row:hover {
      background-color: var(--pd-neutral-100);
    }

    .chapter-row.active {
      background-color: var(--pd-primary-50);
      color: var(--pd-primary-700);
    }

    .expand-btn {
      inline-size: 1.25rem;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      font-size: var(--pd-text-caption);
      color: var(--pd-text-secondary);
      flex-shrink: 0;
    }

    .expand-btn.expanded {
      color: var(--pd-primary-600);
    }

    .scene-list {
      padding-inline-start: var(--pd-space-7);
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
    }

    .scene-row {
      display: flex;
      align-items: center;
      padding: var(--pd-space-2) var(--pd-space-3);
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text);
      transition: background-color var(--pd-dur-fast) var(--pd-ease);
    }

    .scene-row:hover {
      background-color: var(--pd-neutral-100);
    }

    .scene-row.active {
      background-color: var(--pd-primary-50);
      color: var(--pd-primary-700);
    }

    .scene-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .no-scenes {
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
      margin: var(--pd-space-2) 0 0 0;
      padding-inline-start: var(--pd-space-2);
    }

    .drag-handle {
      cursor: grab;
      font-size: var(--pd-text-caption);
      color: var(--pd-neutral-400);
      user-select: none;
    }

    .chapter-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badge {
      font-size: var(--pd-text-caption);
      color: var(--pd-text-secondary);
    }

    .add-chapter {
      width: 100%;
      margin-block-end: var(--pd-space-2);
      padding: var(--pd-space-3) var(--pd-space-5);
      border-radius: var(--pd-radius-md);
      border: 1px solid var(--pd-border-strong);
      background: transparent;
      color: var(--pd-text);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      cursor: pointer;
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }

    .add-chapter:hover {
      background: var(--pd-neutral-50);
    }

    .empty {
      color: var(--pd-text-secondary);
      font-size: var(--pd-text-body-sm);
      margin-block-start: var(--pd-space-4);
    }

    .context-menu {
      position: fixed;
      z-index: var(--pd-z-overlay);
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      box-shadow: var(--pd-shadow-2);
      padding: var(--pd-space-2) 0;
      min-inline-size: 140px;
    }

    .context-menu button {
      display: block;
      width: 100%;
      padding: var(--pd-space-2) var(--pd-space-5);
      border: none;
      background: transparent;
      text-align: start;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text);
      cursor: pointer;
    }

    .context-menu button:hover:not(:disabled) {
      background: var(--pd-neutral-50);
    }

    .context-menu button:disabled {
      color: var(--pd-neutral-400);
      cursor: default;
    }
  `]
})
export class ChapterTreeComponent {
  @Input({ required: true }) set chapters(value: ChapterSummaryDto[] | null) {
    this._chapters.set(value ?? []);
  }

  @Input() selectedChapterId: string | null = null;
  @Input() selectedSceneId: string | null = null;
  /** Book language (e.g. 'he', 'en'). The chapter tree is book-scoped: Hebrew default, English for en books. */
  @Input() bookLanguage: string | null = null;
  @Input() set expandedChapters(ids: string[]) {
    this._expandedChapters.set(ids ?? []);
  }
  @Input() set scenesMap(value: Record<string, SceneSummaryDto[]>) {
    this._scenesByChapter.set(value ?? {});
  }

  @Output() chapterSelected = new EventEmitter<ChapterSummaryDto>();
  @Output() sceneSelected = new EventEmitter<{ scene: SceneSummaryDto; chapterId: string }>();
  @Output() toggleExpandChapter = new EventEmitter<string>();
  @Output() reorder = new EventEmitter<{ chapterId: string; order: number }[]>();
  @Output() addChapter = new EventEmitter<void>();
  @Output() renameChapter = new EventEmitter<ChapterSummaryDto>();
  @Output() deleteChapter = new EventEmitter<ChapterSummaryDto>();
  @Output() splitScenes = new EventEmitter<ChapterSummaryDto>();
  @Output() deleteScene = new EventEmitter<{ scene: SceneSummaryDto; chapterId: string }>();
  @Output() clearScenes = new EventEmitter<ChapterSummaryDto>();

  private _chapters = signal<ChapterSummaryDto[]>([]);
  private _expandedChapters = signal<string[]>([]);
  private _scenesByChapter = signal<Record<string, SceneSummaryDto[]>>({});

  flatChapters = computed(() =>
    [...this._chapters()].sort((a, b) => a.order - b.order)
  );

  scenesByChapter = computed(() => this._scenesByChapter());

  /** Book-scoped chrome language ('he' default, 'en' for an English book). */
  get lang(): 'he' | 'en' {
    return (this.bookLanguage?.trim().toLowerCase() || 'he').startsWith('en') ? 'en' : 'he';
  }

  /** Logical direction for the chrome; follows the book language so en books render ltr. */
  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'en' ? 'ltr' : 'rtl';
  }

  /** Localized chapter-tree chrome strings (he default, en fallback). Keeps he/en parity. */
  label(key: string): string {
    const he: Record<string, string> = {
      addChapter: 'הוספת פרק',
      addFirstChapter: 'הוספת פרק ראשון',
      general: 'כללי',
      toggleScenes: 'הצג/הסתר סצנות',
      noScenes: 'אין סצנות. השתמשו ב"פיצול לסצנות" על הפרק.',
      rename: 'שינוי שם',
      splitScenes: 'פיצול לסצנות',
      removeAllScenes: 'הסרת כל הסצנות',
      delete: 'מחיקת פרק',
      deleteScene: 'מחיקת סצנה',
      noChapters: 'אין עדיין פרקים.',
    };
    const en: Record<string, string> = {
      addChapter: 'Add chapter',
      addFirstChapter: 'Add first chapter',
      general: 'General',
      toggleScenes: 'Toggle scenes',
      noScenes: 'No scenes. Use "Split scenes" on the chapter.',
      rename: 'Rename',
      splitScenes: 'Split scenes',
      removeAllScenes: 'Remove all scenes',
      delete: 'Delete',
      deleteScene: 'Delete scene',
      noChapters: 'No chapters yet.',
    };
    const map = this.lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  contextMenu = {
    visible: false,
    x: 0,
    y: 0,
    chapter: null as ChapterSummaryDto | null
  };

  sceneContextMenu = {
    visible: false,
    x: 0,
    y: 0,
    scene: null as SceneSummaryDto | null,
    chapterId: null as string | null
  };

  hasScenes(chapterId: string): boolean {
    return (this._scenesByChapter()[chapterId] ?? []).length > 0;
  }

  /**
   * True ONLY when the chapter's scenes are KNOWN to be empty: the map has the
   * key AND its array is length 0. Returns false when the key is absent (scene
   * state not yet loaded this session) so the "Remove all scenes" action stays
   * ENABLED for chapters whose scenes were never expanded. The backend clear
   * endpoint is idempotent (204 even with zero scenes), so enabling-when-unknown
   * is safe — at worst it issues a no-op clear.
   */
  scenesKnownEmpty(chapterId: string): boolean {
    const map = this._scenesByChapter();
    if (!Object.prototype.hasOwnProperty.call(map, chapterId)) return false;
    return (map[chapterId] ?? []).length === 0;
  }

  isExpanded(chapterId: string): boolean {
    return this._expandedChapters().includes(chapterId);
  }

  isNewPartHeader(index: number, currentPartName: string | null): boolean {
    const list = this.flatChapters();
    if (index === 0) return true;
    const prev = list[index - 1];
    return (prev.partName ?? '') !== (currentPartName ?? '');
  }

  selectChapterClicked(ch: ChapterSummaryDto, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeContextMenu();
    this.closeSceneContextMenu();
    this.chapterSelected.emit(ch);
  }

  selectSceneClicked(scene: SceneSummaryDto, chapterId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeContextMenu();
    this.closeSceneContextMenu();
    this.sceneSelected.emit({ scene, chapterId });
  }

  toggleExpand(chapterId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleExpandChapter.emit(chapterId);
  }

  onSplitScenes(ch: ChapterSummaryDto): void {
    this.splitScenes.emit(ch);
    this.closeContextMenu();
  }

  onClearScenes(ch: ChapterSummaryDto): void {
    this.clearScenes.emit(ch);
    this.closeContextMenu();
  }

  addChapterClicked(): void {
    this.addChapter.emit();
  }

  onDrop(event: CdkDragDrop<ChapterSummaryDto[]>): void {
    const list = [...this.flatChapters()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    const withNewOrder = list.map((ch, index) => ({ ...ch, order: index }));
    this._chapters.set(withNewOrder);
    const payload = withNewOrder.map(ch => ({ chapterId: ch.id, order: ch.order }));
    this.reorder.emit(payload);
  }

  openContextMenu(event: MouseEvent, ch: ChapterSummaryDto): void {
    event.preventDefault();
    this.closeSceneContextMenu();
    this.contextMenu = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      chapter: ch
    };
  }

  openSceneContextMenu(event: MouseEvent, scene: SceneSummaryDto, chapterId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeContextMenu();
    this.sceneContextMenu = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      scene,
      chapterId
    };
  }

  onRename(ch: ChapterSummaryDto): void {
    this.renameChapter.emit(ch);
    this.closeContextMenu();
  }

  onDelete(ch: ChapterSummaryDto): void {
    this.deleteChapter.emit(ch);
    this.closeContextMenu();
  }

  onDeleteScene(scene: SceneSummaryDto | null, chapterId: string | null): void {
    if (!scene || !chapterId) return;
    this.deleteScene.emit({ scene, chapterId });
    this.closeSceneContextMenu();
  }

  closeContextMenu(): void {
    this.contextMenu = { visible: false, x: 0, y: 0, chapter: null };
  }

  closeSceneContextMenu(): void {
    this.sceneContextMenu = { visible: false, x: 0, y: 0, scene: null, chapterId: null };
  }
}
