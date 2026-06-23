import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, takeUntil, switchMap, takeWhile } from 'rxjs';
import { AnalysisProgressDto } from '../models/analysis';

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
    // First poll immediately so we're more likely to see "Part 1 of N" / "analyzing first part…"; then every intervalMs.
    return timer(0, intervalMs).pipe(
      takeUntil(stop$),
      switchMap(() => this.http.get<AnalysisProgressDto>(url)),
      // Stop emitting once we hit a terminal state; caller can also stop via stop$
      takeWhile(p => !this.isTerminalStatus(p?.status), true)
    );
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
    return timer(0, intervalMs).pipe(
      takeUntil(stop$),
      switchMap(() => this.http.get<AnalysisProgressDto>(url)),
      takeWhile(p => !this.isTerminalStatus(p?.status), true)
    );
  }

  private isTerminalStatus(status: string | null | undefined): boolean {
    const s = (status ?? '').toLowerCase();
    return s === 'succeeded' || s === 'failed' || s === 'canceled';
  }
}

