import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, catchError, defer, switchMap, takeUntil, takeWhile, tap, throwError, timer } from 'rxjs';
import { AnalysisProgressDto } from '../models/analysis';

/**
 * c01 (whole-book proofread fixes): how many CONSECUTIVE failed progress reads a poll absorbs before it
 * gives up. 6 reads at the default 5 s interval is ~30 s of an unreachable or erroring API.
 *
 * Why a budget at all: before c01 the FIRST failed read ended the poll, and every consumer treats that
 * error as the job's terminal. One 5xx, proxy timeout or network blip in an hour of 5 s polls therefore
 * finalized an hour-long whole-book proofread as "failed" in the client while the server ran on. 30 s
 * outlasts a blip, a Wi-Fi hand-over and a dev-proxy hiccup; a longer outage still ends the poll (the API
 * is really gone, and the registry records that the CLIENT lost the job rather than the server failing
 * it, so a later re-track resumes it: see `JobRegistryService.track`).
 *
 * The budget is per poll subscription and RESETS on any successful read, so it bounds a continuous
 * outage, never the run's total error count.
 */
export const POLL_TRANSIENT_ERROR_BUDGET = 6;

/**
 * c01: the ONE predicate for "the server does not know this job" (404). Every progress route answers 404
 * for an unknown, pruned or mis-scoped job id, which is a server ANSWER rather than a lost read: retrying
 * it cannot help, so the poll ends at once. Shared with the registry, which records a 404 terminal as
 * server-ended (not resumable) and every other poll error as a lost poll (resumable).
 */
export function isJobUnknownError(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 404;
}

@Injectable({ providedIn: 'root' })
export class AnalysisProgressService {
  constructor(private http: HttpClient) {}

  pollProgress(
    bookId: string,
    chapterId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analysis-progress/${jobId}`;
    return this.pollJob(url, stop$, intervalMs);
  }

  /**
   * Poll book-summary build progress (wb1-f01). Same AnalysisProgressDto shape and terminal-status
   * logic as pollStyleBaselineProgress, but hits `summary/progress/{jobId}`.
   */
  pollBookSummaryProgress(
    bookId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/summary/progress/${jobId}`;
    return this.pollJob(url, stop$, intervalMs);
  }

  /**
   * Poll whole-book review build progress (wb2-f02). Same AnalysisProgressDto shape and
   * terminal-status logic as pollBookSummaryProgress, but hits `review/progress/{jobId}`.
   */
  pollBookReviewProgress(
    bookId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/review/progress/${jobId}`;
    return this.pollJob(url, stop$, intervalMs);
  }

  /**
   * Poll whole-book proofread run progress (f2). Same AnalysisProgressDto shape and terminal-status
   * logic as pollBookReviewProgress, but hits `proofread/progress/{jobId}`.
   */
  pollBookProofreadProgress(
    bookId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/proofread/progress/${jobId}`;
    return this.pollJob(url, stop$, intervalMs);
  }

  /**
   * Poll style-baseline build progress (a3/a4). Same AnalysisProgressDto shape and terminal-status
   * logic as pollProgress, but hits the book-level route `style-baseline/progress/{jobId}` (no
   * chapter id). Reuses this service so the app keeps a single progress-polling mechanism.
   */
  pollStyleBaselineProgress(
    bookId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/style-baseline/progress/${jobId}`;
    return this.pollJob(url, stop$, intervalMs);
  }

  /**
   * The ONE poll every progress route shares. First read immediately (so a chunked run is more likely to
   * show "Part 1 of N" early), then one every `intervalMs`, until a terminal status (emitted, then the
   * stream completes) or `stop$`.
   *
   * c01: a failed read is NOT the end of the poll. It is dropped and the next tick reads again at the
   * normal interval, until {@link POLL_TRANSIENT_ERROR_BUDGET} reads in a row have failed; any successful
   * read resets that count. A 404 ({@link isJobUnknownError}) ends the poll at once. Either way the
   * stream ERRORS with the last HttpErrorResponse, so every consumer's existing error path still fires,
   * only no longer on the first blip. A read still in flight when the next tick fires is cancelled by
   * `switchMap` and counts as neither a success nor a failure (unchanged).
   */
  private pollJob(url: string, stop$: Observable<unknown>, intervalMs: number): Observable<AnalysisProgressDto> {
    return defer(() => {
      // Per subscription: two subscribers to one returned observable must not share a failure count.
      let consecutiveFailures = 0;
      return timer(0, intervalMs).pipe(
        takeUntil(stop$),
        switchMap(() => this.http.get<AnalysisProgressDto>(url).pipe(
          tap(() => { consecutiveFailures = 0; }),
          catchError((err: unknown) => {
            consecutiveFailures++;
            if (isJobUnknownError(err) || consecutiveFailures >= POLL_TRANSIENT_ERROR_BUDGET) {
              return throwError(() => err);
            }
            return EMPTY;
          }),
        )),
        // Stop emitting once we hit a terminal state; caller can also stop via stop$
        takeWhile(p => !this.isTerminalStatus(p?.status), true),
      );
    });
  }

  private isTerminalStatus(status: string | null | undefined): boolean {
    const s = (status ?? '').toLowerCase();
    return s === 'succeeded' || s === 'failed' || s === 'canceled';
  }
}
