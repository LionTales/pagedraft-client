import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ImportPreviewResponseDto,
  ImportPreviewChapterDto,
  ImportConfirmationRequest,
} from '../../core/models/book';
import { ImportService } from '../../core/services/import.service';

interface ImportChapterView extends ImportPreviewChapterDto {
  include: boolean;
}

@Component({
  selector: 'app-import-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="import-page">
      <header class="import-header">
        <div>
          <h2>Import DOCX</h2>
          <p class="subtitle">Upload a DOCX file and review detected chapters before importing.</p>
        </div>
        <a class="pd-btn pd-btn-ghost" [routerLink]="['/books', bookId]">Back to book</a>
      </header>

      <section class="dropzone-section">
        <div
          class="dropzone"
          [class.drag-over]="dragOver"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)">
          <ng-container *ngIf="!isUploading; else uploadingTpl">
            <p *ngIf="!preview">
              <strong>Drop your DOCX here</strong> or
              <button type="button" class="pd-btn pd-btn-link" (click)="fileInput.click()">browse</button>
            </p>
            <p *ngIf="preview">
              Selected file: <strong>{{ preview.fileName }}</strong> ({{ preview.fileSize | number }} bytes)
              <button type="button" class="pd-btn pd-btn-link" (click)="fileInput.click()">change</button>
            </p>
            <input
              type="file"
              accept=".docx"
              #fileInput
              style="display: none"
              (change)="onFileSelected($event)" />
          </ng-container>
          <ng-template #uploadingTpl>
            <p class="pd-loading">Uploading and analyzing...</p>
          </ng-template>
        </div>
        <p class="hint">Only .docx files are supported. Large files may take a few seconds to analyze.</p>
        <p *ngIf="error" class="import-error">{{ error }}</p>
      </section>

      <section *ngIf="chapters.length" class="preview-section">
        <div class="preview-toolbar">
          <div class="mode-toggle">
            <label>
              <input type="radio" name="mode" value="append" [(ngModel)]="mode" />
              Append to existing chapters
            </label>
            <label>
              <input type="radio" name="mode" value="overwrite" [(ngModel)]="mode" />
              Overwrite all existing chapters
            </label>
          </div>
          <div class="actions">
            <button type="button" class="pd-btn pd-btn-ghost" (click)="setAll(true)">Select all</button>
            <button type="button" class="pd-btn pd-btn-ghost" (click)="setAll(false)">Clear all</button>
          </div>
        </div>

        <div *ngIf="mode === 'overwrite'" class="overwrite-warning">
          This will replace all existing chapters of this book. Make sure you have a backup before proceeding.
        </div>

        <table class="preview-table">
          <thead>
            <tr>
              <th>Include</th>
              <th>#</th>
              <th>Title</th>
              <th>Part</th>
              <th>Words</th>
              <th>Snippet</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let ch of chapters; let i = index">
              <td>
                <input type="checkbox" [(ngModel)]="ch.include" />
              </td>
              <td>
                <input type="number" [(ngModel)]="ch.order" class="order-input" />
              </td>
              <td>
                <input type="text" [(ngModel)]="ch.title" class="text-input" />
              </td>
              <td>
                <input type="text" [(ngModel)]="ch.partName" class="text-input" />
              </td>
              <td>{{ ch.wordCount }}</td>
              <td class="snippet">{{ ch.snippet }}</td>
            </tr>
          </tbody>
        </table>

        <div class="summary">
          Detected {{ chapters.length }} chapters,
          {{ totalWords }} words total,
          {{ selectedCount }} selected to import.
        </div>

        <div class="footer-actions">
          <button type="button" class="pd-btn pd-btn-primary" [disabled]="isImporting || !hasSelection()" (click)="confirm()">
            {{ isImporting ? 'Importing...' : 'Import chapters' }}
          </button>
          <button type="button" class="pd-btn pd-btn-ghost" (click)="cancel()">Cancel</button>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .import-page {
        max-inline-size: 960px;
        margin-inline: auto;
        padding: var(--pd-space-7);
      }
      .import-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-block-end: var(--pd-space-7);
        gap: var(--pd-space-5);
      }
      .import-header h2 {
        margin: 0;
      }
      .subtitle {
        margin: var(--pd-space-2) 0 0;
        color: var(--pd-text-secondary);
        font-size: var(--pd-text-body-sm);
      }
      .dropzone-section {
        margin-block-end: var(--pd-space-7);
      }
      .dropzone {
        border: 2px dashed var(--pd-border-strong);
        border-radius: var(--pd-radius-lg);
        padding: var(--pd-space-8);
        text-align: center;
        cursor: pointer;
        transition: border-color var(--pd-dur-base) var(--pd-ease),
                    background-color var(--pd-dur-base) var(--pd-ease);
      }
      .dropzone.drag-over {
        border-color: var(--pd-primary-600);
        background-color: var(--pd-primary-50);
      }
      .hint {
        margin-block-start: var(--pd-space-3);
        font-size: var(--pd-text-body-sm);
        color: var(--pd-text-muted);
      }
      .import-error {
        margin-block-start: var(--pd-space-3);
        color: var(--pd-cut);
        font-size: var(--pd-text-body-sm);
      }
      .preview-section {
        margin-block-start: var(--pd-space-5);
      }
      .preview-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--pd-space-5);
        margin-block-end: var(--pd-space-4);
        flex-wrap: wrap;
      }
      .mode-toggle {
        display: flex;
        gap: var(--pd-space-5);
        flex-wrap: wrap;
      }
      .mode-toggle label {
        font-size: var(--pd-text-body-sm);
        color: var(--pd-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--pd-space-2);
      }
      .actions {
        display: flex;
        gap: var(--pd-space-3);
      }
      .overwrite-warning {
        background: var(--pd-improve-bg);
        border-inline-start: 4px solid var(--pd-improve);
        padding: var(--pd-space-3) var(--pd-space-4);
        margin-block-end: var(--pd-space-4);
        font-size: var(--pd-text-body-sm);
        color: var(--pd-text);
        border-radius: 0 var(--pd-radius-sm) var(--pd-radius-sm) 0;
      }
      .preview-table {
        width: 100%;
        border-collapse: collapse;
        margin-block-end: var(--pd-space-4);
      }
      .preview-table th,
      .preview-table td {
        border: 1px solid var(--pd-border);
        padding: var(--pd-space-2) var(--pd-space-3);
        vertical-align: top;
        font-size: var(--pd-text-body-sm);
      }
      .preview-table th {
        background: var(--pd-surface-sunken);
        text-align: start;
        font-weight: var(--pd-weight-medium);
        color: var(--pd-text-secondary);
      }
      .order-input {
        inline-size: 3rem;
        border: 1px solid var(--pd-border);
        border-radius: var(--pd-radius-sm);
        padding: var(--pd-space-1) var(--pd-space-2);
        font-family: var(--pd-font-ui);
        font-size: var(--pd-text-body-sm);
      }
      .text-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--pd-border);
        border-radius: var(--pd-radius-sm);
        padding: var(--pd-space-1) var(--pd-space-2);
        font-family: var(--pd-font-ui);
        font-size: var(--pd-text-body-sm);
      }
      .snippet {
        max-inline-size: 320px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--pd-text-secondary);
      }
      .summary {
        font-size: var(--pd-text-body-sm);
        color: var(--pd-text-secondary);
        margin-block-end: var(--pd-space-4);
      }
      .footer-actions {
        display: flex;
        gap: var(--pd-space-3);
      }
    `,
  ],
})
export class ImportPageComponent implements OnInit {
  bookId: string | null = null;
  preview: ImportPreviewResponseDto | null = null;
  chapters: ImportChapterView[] = [];
  mode: 'append' | 'overwrite' = 'append';

  dragOver = false;
  isUploading = false;
  isImporting = false;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private importService: ImportService
  ) {}

  ngOnInit(): void {
    this.bookId = this.route.snapshot.params['bookId'] ?? null;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    if (!event.dataTransfer || !event.dataTransfer.files?.length) {
      return;
    }
    const file = event.dataTransfer.files[0];
    this.startUpload(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) {
      return;
    }
    const file = input.files[0];
    input.value = '';
    this.startUpload(file);
  }

  private startUpload(file: File): void {
    this.error = null;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      this.error = 'Only .docx files are supported.';
      return;
    }
    if (!this.bookId) {
      this.error = 'Missing book id.';
      return;
    }

    this.isUploading = true;
    this.importService.uploadForPreview(this.bookId, file).subscribe({
      next: (preview) => {
        this.isUploading = false;
        this.preview = preview;
        this.chapters = preview.chapters.map((c) => ({
          ...c,
          include: true,
        }));
      },
      error: (err) => {
        this.isUploading = false;
        this.preview = null;
        this.chapters = [];
        this.error = this.extractErrorMessage(err) ?? 'Failed to analyze document.';
      },
    });
  }

  setAll(include: boolean): void {
    this.chapters.forEach((c) => (c.include = include));
  }

  hasSelection(): boolean {
    return this.chapters.some((c) => c.include);
  }

  get totalWords(): number {
    return this.chapters.reduce((sum, c) => sum + c.wordCount, 0);
  }

  get selectedCount(): number {
    return this.chapters.reduce((sum, c) => sum + (c.include ? 1 : 0), 0);
  }

  confirm(): void {
    if (!this.bookId || !this.preview || !this.hasSelection()) {
      return;
    }

    const request: ImportConfirmationRequest = {
      mode: this.mode,
      chapters: this.chapters.map((c) => ({
        tempId: c.tempId,
        title: c.title,
        partName: c.partName,
        order: Number(c.order ?? 0),
        include: c.include,
        sfdtJson: c.sfdtJson,
      })),
    };

    this.isImporting = true;
    this.importService.confirmImport(this.bookId, request).subscribe({
      next: () => {
        this.isImporting = false;
        // After successful import, return to editor for this book.
        this.router.navigate(['/books', this.bookId]);
      },
      error: (err) => {
        this.isImporting = false;
        this.error = this.extractErrorMessage(err) ?? 'Failed to import chapters.';
      },
    });
  }

  cancel(): void {
    if (this.bookId) {
      this.router.navigate(['/books', this.bookId]);
    } else {
      this.router.navigate(['/books']);
    }
  }

  private extractErrorMessage(err: any): string | null {
    if (!err) return null;
    if (err.error) {
      if (typeof err.error === 'string') return err.error;
      if (err.error.detail) return err.error.detail;
      if (err.error.title) return err.error.title;
    }
    if (err.message) return err.message;
    return null;
  }
}

