import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BookService } from '../../core/services/book.service';
import { BookDto } from '../../core/models/book';
import { formatRelativeTime } from '../../core/utils/relative-time';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="dashboard" [attr.dir]="dir">
      <header class="dash-header">
        <h1>Pagedraft</h1>
        @if (!showCreateForm) {
          <button class="pd-btn pd-btn-primary" (click)="showCreateForm = true">{{ label('newBook') }}</button>
        }
      </header>
      @if (showCreateForm) {
        <div class="create-form">
          <h2>{{ label('newBook') }}</h2>
          <div class="field">
            <label for="new-book-title">{{ label('titleField') }}</label>
            <input id="new-book-title" type="text" [(ngModel)]="newBookTitle" [placeholder]="label('untitled')" />
          </div>
          <div class="field">
            <label for="new-book-language">{{ label('languageField') }}</label>
            <select id="new-book-language" [(ngModel)]="newBookLanguage">
              <option value="he">{{ label('optionHebrew') }}</option>
              <option value="en">{{ label('optionEnglish') }}</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="pd-btn pd-btn-ghost" (click)="cancelCreate()">{{ label('cancel') }}</button>
            <button type="button" class="pd-btn pd-btn-primary" (click)="submitCreate()" [disabled]="creating">{{ creating ? label('creating') : label('create') }}</button>
          </div>
        </div>
      }
      <ul class="book-list">
        @for (b of books; track b.id) {
          <li>
            <div class="book-main">
              <a [routerLink]="['/books', b.id]">{{ b.title }}</a>
              <span class="meta">{{ b.author || label('noAuthor') }} &middot; {{ relativeTime(b.updatedAt, b.language) }}</span>
            </div>
            <div class="book-actions">
              <button type="button" class="pd-btn pd-btn-ghost" (click)="openBook(b.id)">{{ label('open') }}</button>
              <button type="button" class="pd-btn pd-btn-ghost" (click)="goToImport(b.id)">{{ label('importDocx') }}</button>
              <button type="button" class="pd-btn pd-btn-ghost btn-delete" (click)="deleteBook(b)" [disabled]="deletingId === b.id">{{ label('delete') }}</button>
            </div>
          </li>
        } @empty {
          <li class="pd-empty">{{ label('empty') }}</li>
        }
      </ul>
    </div>
  `,
  styles: [`
    .dashboard {
      padding: var(--pd-space-7);
      max-inline-size: 800px;
      margin-inline: auto;
    }
    .dash-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-block-end: var(--pd-space-7);
    }
    .dash-header h1 {
      margin: 0;
      font-size: var(--pd-text-h3);
      color: var(--pd-neutral-900);
    }
    .book-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .book-list li {
      padding: var(--pd-space-4) var(--pd-space-3);
      border-block-end: 1px solid var(--pd-divider);
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-2);
    }
    .book-main a {
      font-weight: var(--pd-weight-medium);
      text-decoration: none;
      color: var(--pd-text);
    }
    .book-main a:hover { text-decoration: underline; }
    .meta {
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text-secondary);
      display: block;
      margin-block-start: var(--pd-space-1);
    }
    .book-actions {
      display: flex;
      gap: var(--pd-space-3);
      flex-wrap: wrap;
    }
    .btn-delete {
      color: var(--pd-cut);
      border-color: var(--pd-cut-border);
    }
    .btn-delete:hover:not(:disabled) {
      background: var(--pd-cut-bg);
    }
    .create-form {
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-lg);
      padding: var(--pd-space-6);
      margin-block-end: var(--pd-space-7);
      max-inline-size: 400px;
    }
    .create-form h2 {
      margin: 0 0 var(--pd-space-5) 0;
      font-size: var(--pd-text-h5);
    }
    .create-form .field {
      margin-block-end: var(--pd-space-4);
    }
    .create-form label {
      display: block;
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      margin-block-end: var(--pd-space-2);
      color: var(--pd-text);
    }
    .create-form input,
    .create-form select {
      width: 100%;
      padding: var(--pd-space-3) var(--pd-space-4);
      border: 1px solid var(--pd-border-strong);
      border-radius: var(--pd-radius-md);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body);
      color: var(--pd-text);
      background: var(--pd-surface);
    }
    .create-form select { cursor: pointer; }
    .create-form .form-actions {
      display: flex;
      gap: var(--pd-space-3);
      margin-block-start: var(--pd-space-5);
    }
  `]
})
export class DashboardComponent implements OnInit {
  books: BookDto[] = [];
  showCreateForm = false;
  newBookTitle = 'Untitled';
  newBookLanguage = 'he';
  creating = false;
  deletingId: string | null = null;

  // ── Localization (app-level surface: no book language; defaults to Hebrew-first) ──

  /** Dashboard chrome is always Hebrew-first; no per-book language applies here. */
  private get langKey(): 'he' | 'en' {
    return 'he';
  }

  get dir(): 'rtl' | 'ltr' {
    return this.langKey === 'he' ? 'rtl' : 'ltr';
  }

  /** Localized static chrome label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  label(key: string): string {
    const he: Record<string, string> = {
      newBook: 'ספר חדש',
      titleField: 'כותרת',
      untitled: 'ללא כותרת',
      languageField: 'שפה',
      optionHebrew: 'עברית',
      optionEnglish: 'אנגלית',
      cancel: 'ביטול',
      create: 'יצירה',
      creating: 'יוצר...',
      noAuthor: 'ללא מחבר',
      open: 'פתיחה',
      importDocx: 'ייבוא DOCX',
      delete: 'מחיקה',
      empty: 'אין ספרים. צרו ספר חדש כדי להתחיל.',
    };
    const en: Record<string, string> = {
      newBook: 'New book',
      titleField: 'Title',
      untitled: 'Untitled',
      languageField: 'Language',
      optionHebrew: 'Hebrew',
      optionEnglish: 'English',
      cancel: 'Cancel',
      create: 'Create',
      creating: 'Creating...',
      noAuthor: 'No author',
      open: 'Open',
      importDocx: 'Import DOCX',
      delete: 'Delete',
      empty: 'No books. Create one to get started.',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Localized delete confirm message (includes the book title). */
  private deleteConfirmMessage(title: string): string {
    if (this.langKey === 'he') {
      return `למחוק את "${title}"? פעולה זו אינה הפיכה.`;
    }
    return `Delete "${title}"? This cannot be undone.`;
  }

  relativeTime(iso: string | null | undefined, lang?: string): string {
    return formatRelativeTime(iso, lang === 'he' ? 'he' : 'en');
  }

  constructor(private bookService: BookService, private router: Router) {}

  ngOnInit(): void {
    this.bookService.getAll().subscribe(list => this.books = list);
  }

  cancelCreate(): void {
    this.showCreateForm = false;
    this.newBookTitle = 'Untitled';
    this.newBookLanguage = 'he';
  }

  submitCreate(): void {
    const title = (this.newBookTitle?.trim()) || 'Untitled';
    this.creating = true;
    this.bookService.create(title, null, this.newBookLanguage).subscribe({
      next: b => {
        this.creating = false;
        this.cancelCreate();
        this.router.navigate(['/books', b.id]);
      },
      error: () => { this.creating = false; }
    });
  }

  openBook(bookId: string): void {
    this.router.navigate(['/books', bookId]);
  }

  goToImport(bookId: string): void {
    this.router.navigate(['/books', bookId, 'import']);
  }

  deleteBook(book: BookDto): void {
    if (!confirm(this.deleteConfirmMessage(book.title))) return;
    this.deletingId = book.id;
    this.bookService.delete(book.id).subscribe({
      next: () => {
        this.books = this.books.filter(b => b.id !== book.id);
        this.deletingId = null;
      },
      error: () => { this.deletingId = null; }
    });
  }
}
