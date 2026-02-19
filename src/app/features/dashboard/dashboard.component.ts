import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { BookService } from '../../core/services/book.service';
import { BookDto } from '../../core/models/book';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="dashboard">
      <header>
        <h1>Pagedraft</h1>
        <button (click)="createBook()">New book</button>
      </header>
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
    .empty { color: #666; }
  `]
})
export class DashboardComponent implements OnInit {
  books: BookDto[] = [];

  constructor(private bookService: BookService, private router: Router) {}

  ngOnInit(): void {
    this.bookService.getAll().subscribe(list => this.books = list);
  }

  createBook(): void {
    const title = prompt('Book title', 'Untitled');
    if (!title) return;
    this.bookService.create(title).subscribe(b => this.router.navigate(['/books', b.id]));
  }

  openBook(bookId: string): void {
    this.router.navigate(['/books', bookId]);
  }

  goToImport(bookId: string): void {
    this.router.navigate(['/books', bookId, 'import']);
  }
}
