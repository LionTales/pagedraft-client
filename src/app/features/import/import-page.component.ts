import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  ChapterSummaryDto,
  ImportPreviewResponseDto,
  ImportPreviewChapterDto,
  ImportConfirmationRequest,
} from '../../core/models/book';
import { ImportService } from '../../core/services/import.service';
import { BookService } from '../../core/services/book.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import { StageSpineSignals, emptyStageSpineSignals } from '../../shared/stage-spine/stage-spine.model';

interface ImportChapterView extends ImportPreviewChapterDto {
  include: boolean;
}

// ── i18n label maps (book-scoped chrome: follows the book language, Hebrew-default). ──
// DRAFT he - needs native-speaker review before sign-off.
const LABELS_HE: Record<string, string> = {
  title:            'ייבוא DOCX',
  subtitle:         'העלו קובץ DOCX וסקרו את הפרקים שזוהו לפני הייבוא.',
  backToBook:       'חזרה לספר',
  dropHere:         'גררו לכאן את קובץ ה-DOCX',
  or:               'או',
  browse:           'עיון',
  selectedFile:     'קובץ נבחר:',
  bytes:            'בייטים',
  change:           'שינוי',
  uploading:        'מעלה ומנתח...',
  hint:             'נתמכים קבצי DOCX בלבד. קבצים גדולים עשויים לקחת מספר שניות לניתוח.',
  modeAppend:       'הוספה לפרקים הקיימים',
  modeOverwrite:    'החלפת כל הפרקים הקיימים',
  selectAll:        'בחירת הכול',
  clearAll:         'ניקוי הכול',
  overwriteWarning: 'פעולה זו תחליף את כל הפרקים הקיימים בספר. ודאו שיש לכם גיבוי לפני שתמשיכו.',
  thInclude:        'כלול',
  thNum:            '#',
  thTitle:          'כותרת',
  thPart:           'חלק',
  thWords:          'מילים',
  thSnippet:        'קטע',
  importChapters:   'ייבוא פרקים',
  importing:        'מייבא...',
  cancel:           'ביטול',
  errDocxOnly:      'נתמכים קבצי DOCX בלבד.',
  errMissingBook:   'מזהה ספר חסר.',
  errAnalyzeFailed: 'ניתוח המסמך נכשל.',
  errImportFailed:  'ייבוא הפרקים נכשל.',
};

const LABELS_EN: Record<string, string> = {
  title:            'Import DOCX',
  subtitle:         'Upload a DOCX file and review detected chapters before importing.',
  backToBook:       'Back to book',
  dropHere:         'Drop your DOCX here',
  or:               'or',
  browse:           'browse',
  selectedFile:     'Selected file:',
  bytes:            'bytes',
  change:           'change',
  uploading:        'Uploading and analyzing...',
  hint:             'Only .docx files are supported. Large files may take a few seconds to analyze.',
  modeAppend:       'Append to existing chapters',
  modeOverwrite:    'Overwrite all existing chapters',
  selectAll:        'Select all',
  clearAll:         'Clear all',
  overwriteWarning: 'This will replace all existing chapters of this book. Make sure you have a backup before proceeding.',
  thInclude:        'Include',
  thNum:            '#',
  thTitle:          'Title',
  thPart:           'Part',
  thWords:          'Words',
  thSnippet:        'Snippet',
  importChapters:   'Import chapters',
  importing:        'Importing...',
  cancel:           'Cancel',
  errDocxOnly:      'Only .docx files are supported.',
  errMissingBook:   'Missing book id.',
  errAnalyzeFailed: 'Failed to analyze document.',
  errImportFailed:  'Failed to import chapters.',
};

@Component({
  selector: 'app-import-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StageSpineComponent],
  template: `
    <div class="import-page" [attr.dir]="dir">
      <header class="import-header">
        <div>
          <h2>{{ t('title') }}</h2>
          <p class="subtitle">{{ t('subtitle') }}</p>
        </div>
        <a class="pd-btn pd-btn-ghost" [routerLink]="['/books', bookId]">{{ t('backToBook') }}</a>
      </header>

      <!-- Wave 3 / w3: the COMPACT spine. This is one of the two screens where a stage actually HAPPENS
           and where the product previously showed no stage indicator at all. Its signals come from the
           book payload this page already loads for its own language, so it costs no request; the two
           book-level statuses are not on that payload and are not fetched for a widget. -->
      <app-stage-spine
        class="import-spine"
        density="compact"
        [bookLanguage]="bookLanguage"
        [signals]="spineSignals">
      </app-stage-spine>

      <section class="dropzone-section">
        <div
          class="dropzone"
          [class.drag-over]="dragOver"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)">
          <ng-container *ngIf="!isUploading; else uploadingTpl">
            <p *ngIf="!preview">
              <strong>{{ t('dropHere') }}</strong> {{ t('or') }}
              <button type="button" class="pd-btn pd-btn-link" (click)="fileInput.click()">{{ t('browse') }}</button>
            </p>
            <p *ngIf="preview">
              {{ t('selectedFile') }} <strong>{{ preview.fileName }}</strong> ({{ preview.fileSize | number }} {{ t('bytes') }})
              <button type="button" class="pd-btn pd-btn-link" (click)="fileInput.click()">{{ t('change') }}</button>
            </p>
            <input
              type="file"
              accept=".docx"
              #fileInput
              style="display: none"
              (change)="onFileSelected($event)" />
          </ng-container>
          <ng-template #uploadingTpl>
            <p class="pd-loading">{{ t('uploading') }}</p>
          </ng-template>
        </div>
        <p class="hint">{{ t('hint') }}</p>
        <p *ngIf="error" class="import-error">{{ error }}</p>
      </section>

      <section *ngIf="chapters.length" class="preview-section">
        <div class="preview-toolbar">
          <div class="mode-toggle">
            <label>
              <input type="radio" name="mode" value="append" [(ngModel)]="mode" />
              {{ t('modeAppend') }}
            </label>
            <label>
              <input type="radio" name="mode" value="overwrite" [(ngModel)]="mode" />
              {{ t('modeOverwrite') }}
            </label>
          </div>
          <div class="actions">
            <button type="button" class="pd-btn pd-btn-ghost" (click)="setAll(true)">{{ t('selectAll') }}</button>
            <button type="button" class="pd-btn pd-btn-ghost" (click)="setAll(false)">{{ t('clearAll') }}</button>
          </div>
        </div>

        <div *ngIf="mode === 'overwrite'" class="overwrite-warning">
          {{ t('overwriteWarning') }}
        </div>

        <table class="preview-table">
          <thead>
            <tr>
              <th>{{ t('thInclude') }}</th>
              <th>{{ t('thNum') }}</th>
              <th>{{ t('thTitle') }}</th>
              <th>{{ t('thPart') }}</th>
              <th>{{ t('thWords') }}</th>
              <th>{{ t('thSnippet') }}</th>
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
          {{ summaryText }}
        </div>

        <div class="footer-actions">
          <button type="button" class="pd-btn pd-btn-primary" [disabled]="isImporting || !hasSelection()" (click)="confirm()">
            {{ isImporting ? t('importing') : t('importChapters') }}
          </button>
          <button type="button" class="pd-btn pd-btn-ghost" (click)="cancel()">{{ t('cancel') }}</button>
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
      /* The compact spine sits under the header as its own band. It carries its own [dir] (it follows the
         book, which on this route is also this page's language), so it needs no direction rule here. */
      .import-spine {
        display: block;
        padding: var(--pd-space-3) var(--pd-space-4);
        margin-block-end: var(--pd-space-6);
        background: var(--pd-surface-sunken);
        border: 1px solid var(--pd-border);
        border-radius: var(--pd-radius-md);
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
export class ImportPageComponent implements OnInit, OnDestroy {
  bookId: string | null = null;
  preview: ImportPreviewResponseDto | null = null;
  chapters: ImportChapterView[] = [];
  mode: 'append' | 'overwrite' = 'append';

  dragOver = false;
  isUploading = false;
  isImporting = false;
  error: string | null = null;

  /** Book language ('he' | 'en' | ...). Book-scoped chrome follows it; Hebrew-default until loaded. */
  bookLanguage: string | null = null;

  // ── Wave 3 / w3: the compact stage spine ───────────────────────────────────────────────────────
  //
  // Everything it renders comes from the ONE book request this page already makes for its own language.
  // `BookDetailDto` carries the chapter list, so stages 1 and 4 are real here; the briefs and review
  // statuses are not on that payload, are not worth a request for a widget, and therefore render the
  // honest "not known here" rather than a guess. The job registry (no request) can raise a stage to
  // `running` but can never claim one is idle.

  /** The spine's signals. A FIELD, so the spine gets a stable object identity per real change. */
  spineSignals: StageSpineSignals = emptyStageSpineSignals();
  /** Chapter count / with-text count from the loaded book. Null until it lands. */
  private loadedChapters: ChapterSummaryDto[] | null = null;
  private briefsRunning = false;
  private reviewRunning = false;
  private jobsSub: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private importService: ImportService,
    private bookService: BookService,
    private jobRegistry: JobRegistryService
  ) {}

  ngOnInit(): void {
    this.bookId = this.route.snapshot.params['bookId'] ?? null;
    // Load the book language so this page follows it (Hebrew-default). Failure is non-fatal:
    // the labels stay at the Hebrew default and the import flow is unaffected.
    if (this.bookId) {
      this.bookService.getById(this.bookId).subscribe({
        next: (book) => {
          this.bookLanguage = book.language ?? 'he';
          this.loadedChapters = book.chapters ?? [];
          this.rebuildSpineSignals();
        },
        error: () => {
          this.bookLanguage = 'he';
          // The chapters are UNKNOWN, not empty: the spine renders loading rather than "no chapters".
          this.loadedChapters = null;
          this.rebuildSpineSignals();
        },
      });
    }
    this.jobsSub = this.jobRegistry.activeJobs$.subscribe((jobs) => {
      this.briefsRunning = jobs.some((j) => j.bookId === this.bookId && j.kind === 'summary');
      this.reviewRunning = jobs.some((j) => j.bookId === this.bookId && j.kind === 'review');
      this.rebuildSpineSignals();
    });
  }

  ngOnDestroy(): void {
    this.jobsSub?.unsubscribe();
    this.jobsSub = null;
  }

  private rebuildSpineSignals(): void {
    const chapters = this.loadedChapters;
    this.spineSignals = {
      chapters: chapters
        ? chapters
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((c) => ({ chapterId: c.id, title: c.title, order: c.order, running: false }))
        : null,
      chapterCount: chapters ? chapters.length : null,
      chaptersWithText: chapters ? chapters.filter((c) => c.wordCount > 0).length : null,
      summary: null,
      review: null,
      summaryRunning: this.briefsRunning,
      reviewRunning: this.reviewRunning,
      exportSurfaceAvailable: false,
    };
  }

  /** Whether to use Hebrew labels (RTL). Default Hebrew unless the book language is English. */
  get isHebrew(): boolean {
    return !(this.bookLanguage ?? '').toLowerCase().startsWith('en');
  }

  /** Content direction following the book language. */
  get dir(): 'rtl' | 'ltr' {
    return this.isHebrew ? 'rtl' : 'ltr';
  }

  /** Resolve a localized label from the book-language map. */
  t(key: string): string {
    const map = this.isHebrew ? LABELS_HE : LABELS_EN;
    return map[key] ?? key;
  }

  /** Localized summary line with the detected/selected counts interpolated. */
  get summaryText(): string {
    const ch = this.chapters.length;
    const w = this.totalWords;
    const sel = this.selectedCount;
    const chFormatted = ch.toLocaleString();
    const wFormatted = w.toLocaleString();
    const selFormatted = sel.toLocaleString();
    if (this.isHebrew) {
      // DRAFT he - needs native review
      const chNoun = ch === 1 ? 'פרק' : 'פרקים'; // DRAFT he
      const wNoun = w === 1 ? 'מילה' : 'מילים'; // DRAFT he
      return `זוהו ${chFormatted} ${chNoun}, ${wFormatted} ${wNoun} בסך הכול, ${selFormatted} נבחרו לייבוא.`;
    }
    const chNoun = ch === 1 ? 'chapter' : 'chapters';
    const wNoun = w === 1 ? 'word' : 'words';
    return `Detected ${chFormatted} ${chNoun}, ${wFormatted} ${wNoun} total, ${selFormatted} selected to import.`;
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
      this.error = this.t('errDocxOnly');
      return;
    }
    if (!this.bookId) {
      this.error = this.t('errMissingBook');
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
        this.error = this.extractErrorMessage(err) ?? this.t('errAnalyzeFailed');
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

    // Capture stats before the import so we can pass them as router state.
    const importedChapters = this.chapters.filter(c => c.include).length;
    const importedWords = this.chapters.filter(c => c.include).reduce((sum, c) => sum + c.wordCount, 0);
    const partNames = new Set(this.chapters.filter(c => c.include).map(c => c.partName ?? '').filter(p => p));
    const importedParts = partNames.size;

    this.isImporting = true;
    this.importService.confirmImport(this.bookId, request).subscribe({
      next: () => {
        this.isImporting = false;
        // After successful import, return to editor with an `imported` signal so the editor
        // can show the guided handoff card (hides summary-build latency behind the structural decision).
        // Router state carries the chapter/word/parts counts; if lost on refresh, the editor falls back
        // to book-loaded data gracefully.
        this.router.navigate(['/books', this.bookId], {
          queryParams: { imported: 1 },
          state: { importedChapters, importedWords, importedParts },
        });
      },
      error: (err) => {
        this.isImporting = false;
        this.error = this.extractErrorMessage(err) ?? this.t('errImportFailed');
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

