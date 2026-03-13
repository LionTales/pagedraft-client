import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BookService } from '../../core/services/book.service';
import { BookDto } from '../../core/models/book';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule],
  template: `
    <div class="dashboard">
      <header>
        <h1>Pagedraft</h1>
        @if (!showCreateForm) {
          <button (click)="showCreateForm = true">New book</button>
        }
      </header>
      @if (showCreateForm) {
        <div class="create-form">
          <h2>New book</h2>
          <div class="field">
            <label for="new-book-title">Title</label>
            <input id="new-book-title" type="text" [(ngModel)]="newBookTitle" placeholder="Untitled" />
          </div>
          <div class="field">
            <label for="new-book-language">Language</label>
            <select id="new-book-language" [(ngModel)]="newBookLanguage">
              <option value="he">Hebrew</option>
              <option value="en">English</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" (click)="cancelCreate()">Cancel</button>
            <button type="button" (click)="submitCreate()" [disabled]="creating">Create</button>
          </div>
        </div>
      }
      <ul class="book-list">
        @for (b of books; track b.id) {
          <li>
            <div class="book-main">
              <a [routerLink]="['/books', b.id]">{{ b.title }}</a>
              <span class="meta">{{ b.author || 'No author' }} · {{ b.updatedAt | date:'short' }}</span>
            </div>
            <div class="book-actions">
              <button type="button" (click)="openBook(b.id)">Open</button>
              <button type="button" (click)="goToImport(b.id)">Import DOCX</button>
              <button type="button" class="btn-delete" (click)="deleteBook(b)" [disabled]="deletingId === b.id">Delete</button>
            </div>
          </li>
        } @empty {
          <li class="empty">No books. Create one to get started.</li>
        }
      </ul>
    </div>
  `,
  styles: [`
    .dashboard { padding: 1.5rem; max-width: 800px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    h1 { margin: 0; font-size: 1.5rem; }
    .book-list { list-style: none; padding: 0; margin: 0; }
    .book-list li { padding: 0.75rem; border-bottom: 1px solid #eee; display: flex; flex-direction: column; gap: 0.35rem; }
    .book-main a { font-weight: 500; text-decoration: none; color: #333; }
    .book-main a:hover { text-decoration: underline; }
    .meta { font-size: 0.875rem; color: #666; display: block; margin-top: 0.15rem; }
    .book-actions { display: flex; gap: 0.5rem; }
    .book-actions button { padding: 0.35rem 0.75rem; cursor: pointer; }
    .book-actions .btn-delete { color: #b00; border-color: #d88; }
    .book-actions .btn-delete:hover:not(:disabled) { background: #fee; }
    .empty { color: #666; }
    .create-form { background: #f9f9f9; border: 1px solid #eee; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; max-width: 400px; }
    .create-form h2 { margin: 0 0 1rem 0; font-size: 1.125rem; }
    .create-form .field { margin-bottom: 0.75rem; }
    .create-form label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; color: #333; }
    .create-form input, .create-form select { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    .create-form select { cursor: pointer; }
    .create-form .form-actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
    .create-form .form-actions button { padding: 0.5rem 1rem; cursor: pointer; }
    .create-form .form-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
  `]
})
export class DashboardComponent implements OnInit {
  books: BookDto[] = [];
  showCreateForm = false;
  newBookTitle = 'Untitled';
  newBookLanguage = 'he';
  creating = false;
  deletingId: string | null = null;

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
    if (!confirm(`Delete "${book.title}"? This cannot be undone.`)) return;
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
