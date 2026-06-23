import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BookStyleBaselineStatusDto,
  StartStyleBaselineBuildResponse,
} from '../models/style-baseline';

/**
 * Reads and triggers the book-level style baseline used by LinguisticAnalysis (a3/a4 contract).
 * Routes live on BooksController under `api/books/{bookId}/style-baseline`. Live build progress is
 * polled via AnalysisProgressService.pollStyleBaselineProgress (same AnalysisProgressDto shape).
 */
@Injectable({ providedIn: 'root' })
export class StyleBaselineService {
  private readonly base = '/api/books';

  constructor(private http: HttpClient) {}

  /** GET .../style-baseline?language= - current coverage/freshness + build estimate. */
  getStyleBaselineStatus(bookId: string, language: string): Observable<BookStyleBaselineStatusDto> {
    const lang = encodeURIComponent(language || 'he');
    return this.http.get<BookStyleBaselineStatusDto>(
      `${this.base}/${bookId}/style-baseline?language=${lang}`
    );
  }

  /** POST .../style-baseline/build - start a build (or no-op when already fresh). */
  buildStyleBaseline(bookId: string, language: string): Observable<StartStyleBaselineBuildResponse> {
    return this.http.post<StartStyleBaselineBuildResponse>(
      `${this.base}/${bookId}/style-baseline/build`,
      { language: language || 'he' }
    );
  }
}
