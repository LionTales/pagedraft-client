import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BookFinding,
  BookReviewFindingsDto,
  BookReviewStatusDto,
  StartBookReviewBuildResponse,
} from '../models/book-review';
import { AnalysisProgressDto } from '../models/analysis';
import { AnalysisProgressService } from './analysis-progress.service';

/**
 * Reads and triggers the whole-book developmental review build (wb2-f02 contract).
 * Routes live on BooksController under `api/books/{bookId}/review`. Live build progress is
 * polled via AnalysisProgressService.pollBookReviewProgress (same AnalysisProgressDto shape,
 * mirroring how BookSummaryService reuses pollBookSummaryProgress).
 */
@Injectable({ providedIn: 'root' })
export class BookReviewService {
  private readonly base = '/api/books';

  constructor(
    private http: HttpClient,
    private progress: AnalysisProgressService
  ) {}

  /**
   * POST .../review - start a whole-book review build (or no-op when already fresh).
   * Returns the jobId + flags; jobId is null when noOp or briefsMissing.
   * Mirrors BookSummaryService.buildBookSummary.
   */
  buildReview(bookId: string, language = 'he'): Observable<StartBookReviewBuildResponse> {
    return this.http.post<StartBookReviewBuildResponse>(
      `${this.base}/${bookId}/review`,
      { language }
    );
  }

  /**
   * Poll progress of a whole-book review build job.
   * Delegates to AnalysisProgressService.pollBookReviewProgress (same AnalysisProgressDto shape
   * as the summary and style-baseline polls — the FE reuses a single progress UI).
   */
  getReviewProgress(
    bookId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    return this.progress.pollBookReviewProgress(bookId, jobId, stop$, intervalMs);
  }

  /**
   * GET .../review/status?language= - current coverage/freshness of the cached review.
   * Mirrors BookSummaryService.getBookSummaryStatus.
   */
  getReviewStatus(bookId: string, language: string): Observable<BookReviewStatusDto> {
    const lang = encodeURIComponent(language || 'he');
    return this.http.get<BookReviewStatusDto>(`${this.base}/${bookId}/review/status?language=${lang}`);
  }

  /**
   * GET .../review/findings?language= - persisted findings + per-dimension rollup scores.
   */
  getReviewFindings(bookId: string, language: string): Observable<BookReviewFindingsDto> {
    const lang = encodeURIComponent(language || 'he');
    return this.http.get<BookReviewFindingsDto>(`${this.base}/${bookId}/review/findings?language=${lang}`);
  }

  /**
   * PATCH .../review/findings/{id}/status - update the workflow status of a single finding.
   * status: 'acknowledge' | 'dismiss' | 'done' | 'open' (imperative verbs; backend maps
   * acknowledge -> acknowledged, dismiss -> dismissed).
   */
  patchFindingStatus(
    bookId: string,
    findingId: string,
    status: 'acknowledge' | 'dismiss' | 'done' | 'open'
  ): Observable<BookFinding> {
    return this.http.patch<BookFinding>(
      `${this.base}/${bookId}/review/findings/${findingId}/status`,
      { status }
    );
  }
}
