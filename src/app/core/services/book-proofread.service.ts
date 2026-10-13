import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BookProofreadStatusDto, StartBookProofreadResponse } from '../models/book-proofread';
import { AnalysisProgressDto } from '../models/analysis';
import { AnalysisProgressService } from './analysis-progress.service';

/**
 * Starts, observes and cancels the whole-book proofread run (f2). Routes live on BookProofreadController under
 * `api/books/{bookId}/proofread`:
 *
 * | call     | route                                         | body / query                          |
 * |----------|-----------------------------------------------|---------------------------------------|
 * | start    | POST .../proofread?language=&force=           | no body                               |
 * | progress | GET  .../proofread/progress/{jobId}           | AnalysisProgressDto (review shape)    |
 * | status   | GET  .../proofread/status?language=           | BookProofreadStatusDto                |
 * | cancel   | POST .../proofread/cancel?jobId={jobId}       | NO body; the job id is a QUERY param  |
 *
 * The cancel contract is fixed here so the API todo can match it: `jobId` rides the query string, the
 * request body is empty, and the answer is 2xx on success (the client ignores the body).
 *
 * Progress polling is delegated to AnalysisProgressService (same `AnalysisProgressDto` shape and
 * terminal-status logic as the review build), mirroring how BookReviewService reuses
 * pollBookReviewProgress. Modeled on BookReviewService.
 */
@Injectable({ providedIn: 'root' })
export class BookProofreadService {
  private readonly base = '/api/books';

  constructor(
    private http: HttpClient,
    private progressSvc: AnalysisProgressService
  ) {}

  /**
   * POST .../proofread - start a whole-book proofread run. Chapters whose Active result is already fresh
   * are skipped unless `force` is true. Branch on `started` in the response, not on `jobId`.
   */
  start(bookId: string, language = 'he', force = false): Observable<StartBookProofreadResponse> {
    const params = new HttpParams()
      .set('language', language || 'he')
      .set('force', force ? 'true' : 'false');
    return this.http.post<StartBookProofreadResponse>(`${this.base}/${bookId}/proofread`, null, { params });
  }

  /**
   * c20: POST .../proofread?onlyFailed=true - re-run exactly the status's `failedChapters` (the server forces
   * them and leaves every other chapter alone). Same response shape as {@link start}; `started === false`
   * when nothing is recorded as failed any more.
   */
  startFailed(bookId: string, language = 'he'): Observable<StartBookProofreadResponse> {
    const params = new HttpParams()
      .set('language', language || 'he')
      .set('onlyFailed', 'true');
    return this.http.post<StartBookProofreadResponse>(`${this.base}/${bookId}/proofread`, null, { params });
  }

  /** GET .../proofread/status?language= - coverage, staleness and the in-flight run id. */
  getStatus(bookId: string, language: string): Observable<BookProofreadStatusDto> {
    const lang = encodeURIComponent(language || 'he');
    return this.http.get<BookProofreadStatusDto>(`${this.base}/${bookId}/proofread/status?language=${lang}`);
  }

  /** Poll a run's progress (same AnalysisProgressDto shape as the review build). */
  getProgress(
    bookId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    return this.progressSvc.pollBookProofreadProgress(bookId, jobId, stop$, intervalMs);
  }

  /**
   * POST .../proofread/cancel?jobId= - stop the run before its next chapter. Chapters already finished
   * keep their Active results (they are durable).
   */
  cancel(bookId: string, jobId: string): Observable<unknown> {
    const params = new HttpParams().set('jobId', jobId);
    return this.http.post<unknown>(`${this.base}/${bookId}/proofread/cancel`, null, { params });
  }
}
