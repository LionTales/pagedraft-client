import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BookSummaryStatusDto,
  StartBookSummaryBuildResponse,
} from '../models/book-summary';
// wb1-f02: pull the brief DTOs into the build graph so TypeScript validates their field casing.
// These will be used for typed responses in Phase 2/3.
export type {
  StructuredChunkSummaryData,
  ChapterCharacterState,
  ChapterBrief,
  BookBrief,
} from '../models/analysis-context';

/**
 * Reads and triggers the book-level summary build (wb1-f01 contract).
 * Routes live on BooksController under `api/books/{bookId}/summary`. Live build progress is
 * polled via AnalysisProgressService.pollBookSummaryProgress (same AnalysisProgressDto shape).
 */
@Injectable({ providedIn: 'root' })
export class BookSummaryService {
  private readonly base = '/api/books';

  constructor(private http: HttpClient) {}

  /** GET .../summary - current coverage/freshness + build estimate. */
  getBookSummaryStatus(bookId: string): Observable<BookSummaryStatusDto> {
    return this.http.get<BookSummaryStatusDto>(`${this.base}/${bookId}/summary`);
  }

  /** POST .../summary/build - start a build (or no-op when already fresh). */
  buildBookSummary(bookId: string, language = 'he'): Observable<StartBookSummaryBuildResponse> {
    return this.http.post<StartBookSummaryBuildResponse>(
      `${this.base}/${bookId}/summary/build`,
      { language }
    );
  }
}
