import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BookDto, BookDetailDto, BookProfileDto } from '../models/book';

@Injectable({ providedIn: 'root' })
export class BookService {
  private readonly base = '/api/books';

  constructor(private http: HttpClient) {}

  getAll(): Observable<BookDto[]> {
    return this.http.get<BookDto[]>(this.base);
  }

  getById(bookId: string): Observable<BookDetailDto> {
    return this.http.get<BookDetailDto>(`${this.base}/${bookId}`);
  }

  /** GET /api/books/{bookId}/profile — returns 404 if no profile yet. */
  getProfile(bookId: string): Observable<BookProfileDto> {
    return this.http.get<BookProfileDto>(`${this.base}/${bookId}/profile`);
  }

  /** POST /api/books/{bookId}/profile/refresh — re-summarize stale chapters and rebuild profile. */
  refreshProfile(bookId: string, language: string = 'he'): Observable<BookProfileDto> {
    return this.http.post<BookProfileDto>(`${this.base}/${bookId}/profile/refresh`, { language });
  }

  /** POST /api/books/{bookId}/summarize — summarize (stale) chapters only. */
  summarize(bookId: string, language: string = 'he'): Observable<void> {
    return this.http.post<void>(`${this.base}/${bookId}/summarize`, { language });
  }

  // Wave 3 / w7 (Q5): `ask()` LIVED HERE. It was the one caller of `POST /api/books/{bookId}/ask`, and
  // its one caller in turn was the book dashboard's "ask about the book" card, which this wave removed
  // in favour of the Show assistant. The ENDPOINT IS UNTOUCHED and still runs `AnalysisType.QA` -
  // this removal is a UI removal, so nothing server-side was withdrawn; the client just no longer has a
  // surface that posts to it.

  create(title: string, author?: string | null, language?: string): Observable<BookDto> {
    return this.http.post<BookDto>(this.base, { title, author: author ?? null, language: language ?? 'he' });
  }

  update(bookId: string, title: string, author?: string | null, language?: string): Observable<BookDto> {
    return this.http.put<BookDto>(`${this.base}/${bookId}`, { title, author: author ?? null, language: language ?? 'he' });
  }

  delete(bookId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${bookId}`);
  }
}
