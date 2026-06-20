import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { ChapterSummaryDto, SceneSummaryDto } from '../../core/models/book';

@Component({
  selector: 'app-chapter-tree',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  template: `
    <div class="chapter-tree-root" *ngIf="flatChapters().length; else empty">
      <button type="button" class="add-chapter" (click)="addChapterClicked()">Add chapter</button>

      <div
        cdkDropList
        [cdkDropListData]="flatChapters()"
        (cdkDropListDropped)="onDrop($event)"
        class="chapter-drop-list">

        @for (ch of flatChapters(); track ch.id; let i = $index) {
          @if (isNewPartHeader(i, ch.partName)) {
            <div class="part-header">
              {{ ch.partName || 'General' }}
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
                aria-label="Toggle scenes">
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
                  <p class="no-scenes">No scenes. Use "Split scenes" on the chapter.</p>
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
          <button type="button" (click)="onRename(contextMenu.chapter)">Rename</button>
          <button type="button" (click)="onSplitScenes(contextMenu.chapter)">Split scenes</button>
          <button
            type="button"
            [disabled]="scenesKnownEmpty(contextMenu.chapter.id)"
            (click)="onClearScenes(contextMenu.chapter)">Remove all scenes</button>
          <button type="button" (click)="onDelete(contextMenu.chapter)">Delete</button>
        </div>
      }

      @if (sceneContextMenu.visible && sceneContextMenu.scene) {
        <div
          class="context-menu"
          [style.top.px]="sceneContextMenu.y"
          [style.left.px]="sceneContextMenu.x">
          <button type="button" (click)="onDeleteScene(sceneContextMenu.scene, sceneContextMenu.chapterId)">Delete scene</button>
        </div>
      }
    </div>

    <ng-template #empty>
      <button type="button" class="add-chapter" (click)="addChapterClicked()">Add first chapter</button>
      <p class="empty">No chapters yet.</p>
    </ng-template>
  `,
  styles: [`
    .chapter-tree-root {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .chapter-drop-list {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .part-header {
      margin-top: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #777;
    }

    .chapter-block {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .chapter-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .chapter-row:hover {
      background-color: #f4f4f4;
    }

    .chapter-row.active {
      background-color: #e6f0ff;
    }

    .expand-btn {
      width: 1.25rem;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 0.6rem;
      color: #666;
      flex-shrink: 0;
    }

    .expand-btn.expanded {
      color: #0078d4;
    }

    .scene-list {
      padding-inline-start: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .scene-row {
      display: flex;
      align-items: center;
      padding: 0.25rem 0.4rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      color: #444;
      transition: background-color 0.15s ease;
    }

    .scene-row:hover {
      background-color: #f0f0f0;
    }

    .scene-row.active {
      background-color: #e6f0ff;
    }

    .scene-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .no-scenes {
      font-size: 0.75rem;
      color: #888;
      margin: 0.25rem 0 0 0;
      padding-inline-start: 0.25rem;
    }

    .drag-handle {
      cursor: grab;
      font-size: 0.75rem;
      color: #aaa;
      user-select: none;
    }

    .chapter-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badge {
      font-size: 0.75rem;
      color: #666;
    }

    .add-chapter {
      width: 100%;
      margin-bottom: 0.25rem;
      padding: 0.5rem;
      cursor: pointer;
    }

    .empty {
      color: #666;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }

    .context-menu {
      position: fixed;
      z-index: 1000;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
      padding: 0.25rem 0;
      min-width: 140px;
    }

    .context-menu button {
      display: block;
      width: 100%;
      padding: 0.3rem 0.75rem;
      border: none;
      background: transparent;
      text-align: left;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .context-menu button:hover:not(:disabled) {
      background: #f3f3f3;
    }

    .context-menu button:disabled {
      color: #aaa;
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
