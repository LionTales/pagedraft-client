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

  /** GET .../summary?language= - current coverage/freshness + build estimate. */
  getBookSummaryStatus(bookId: string, language: string): Observable<BookSummaryStatusDto> {
    // Pass the language exactly like StyleBaselineService.getStyleBaselineStatus: the summary is keyed by
    // (book, language) and the build POST sends a language body, so status + estimates must be read for the
    // SAME language or they can describe a different language than the one a build will run on.
    const lang = encodeURIComponent(language || 'he');
    return this.http.get<BookSummaryStatusDto>(`${this.base}/${bookId}/summary?language=${lang}`);
  }

  /** POST .../summary/build - start a build (or no-op when already fresh). */
  buildBookSummary(bookId: string, language = 'he'): Observable<StartBookSummaryBuildResponse> {
    return this.http.post<StartBookSummaryBuildResponse>(
      `${this.base}/${bookId}/summary/build`,
      { language }
    );
  }
}
