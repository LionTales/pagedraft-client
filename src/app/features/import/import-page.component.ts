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
        <button type="button" class="back-btn" [routerLink]="['/books', bookId]">Back to book</button>
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
              <button type="button" class="link-btn" (click)="fileInput.click()">browse</button>
            </p>
            <p *ngIf="preview">
              Selected file: <strong>{{ preview.fileName }}</strong> ({{ preview.fileSize | number }} bytes)
              <button type="button" class="link-btn" (click)="fileInput.click()">change</button>
            </p>
            <input
              type="file"
              accept=".docx"
              #fileInput
              style="display: none"
              (change)="onFileSelected($event)" />
          </ng-container>
          <ng-template #uploadingTpl>
            <p>Uploading and analyzing…</p>
          </ng-template>
        </div>
        <p class="hint">Only .docx files are supported. Large files may take a few seconds to analyze.</p>
        <p *ngIf="error" class="error">{{ error }}</p>
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
            <button type="button" (click)="setAll(true)">Select all</button>
            <button type="button" (click)="setAll(false)">Clear all</button>
          </div>
        </div>

        <div *ngIf="mode === 'overwrite'" class="warning">
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
          <button type="button" class="primary" [disabled]="isImporting || !hasSelection()" (click)="confirm()">
            {{ isImporting ? 'Importing…' : 'Import chapters' }}
          </button>
          <button type="button" (click)="cancel()">Cancel</button>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .import-page {
        max-width: 960px;
        margin: 0 auto;
        padding: 1.5rem;
      }
      .import-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
        gap: 1rem;
      }
      .subtitle {
        margin: 0.25rem 0 0;
        color: #666;
        font-size: 0.9rem;
      }
      .back-btn {
        padding: 0.35rem 0.75rem;
        border-radius: 4px;
        border: 1px solid #ccc;
        background: #fff;
        cursor: pointer;
      }
      .dropzone-section {
        margin-bottom: 1.5rem;
      }
      .dropzone {
        border: 2px dashed #ccc;
        border-radius: 8px;
        padding: 1.5rem;
        text-align: center;
        cursor: pointer;
        transition: border-color 0.2s, background-color 0.2s;
      }
      .dropzone.drag-over {
        border-color: #0078d4;
        background-color: #f0f8ff;
      }
      .link-btn {
        border: none;
        background: none;
        padding: 0;
        margin: 0;
        color: #0078d4;
        cursor: pointer;
        text-decoration: underline;
      }
      .hint {
        margin-top: 0.5rem;
        font-size: 0.85rem;
        color: #666;
      }
      .error {
        margin-top: 0.5rem;
        color: #b00020;
      }
      .preview-section {
        margin-top: 1rem;
      }
      .preview-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 0.75rem;
      }
      .mode-toggle label {
        margin-right: 1rem;
        font-size: 0.9rem;
      }
      .actions button {
        margin-left: 0.5rem;
      }
      .warning {
        background: #fff4e5;
        border-left: 4px solid #ffa000;
        padding: 0.5rem 0.75rem;
        margin-bottom: 0.75rem;
        font-size: 0.9rem;
      }
      .preview-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 0.75rem;
      }
      .preview-table th,
      .preview-table td {
        border: 1px solid #eee;
        padding: 0.4rem 0.5rem;
        vertical-align: top;
        font-size: 0.9rem;
      }
      .preview-table th {
        background: #fafafa;
        text-align: left;
      }
      .order-input {
        width: 3rem;
      }
      .text-input {
        width: 100%;
        box-sizing: border-box;
      }
      .snippet {
        max-width: 320px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .summary {
        font-size: 0.9rem;
        color: #555;
        margin-bottom: 0.75rem;
      }
      .footer-actions {
        display: flex;
        gap: 0.5rem;
      }
      .primary {
        padding: 0.45rem 0.9rem;
        border-radius: 4px;
        border: none;
        background: #0078d4;
        color: #fff;
        cursor: pointer;
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

