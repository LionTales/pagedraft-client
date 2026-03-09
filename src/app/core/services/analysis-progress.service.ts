import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, takeUntil, switchMap, filter } from 'rxjs';
import { AnalysisProgressDto } from '../models/analysis';

@Injectable({ providedIn: 'root' })
export class AnalysisProgressService {
  constructor(private http: HttpClient) {}

  getOnce(bookId: string, chapterId: string, jobId: string): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analysis-progress/${jobId}`;
    return this.http.get<AnalysisProgressDto>(url);
  }

  pollProgress(
    bookId: string,
    chapterId: string,
    jobId: string,
    stop$: Observable<unknown>,
    intervalMs = 5000
  ): Observable<AnalysisProgressDto> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analysis-progress/${jobId}`;
    return interval(intervalMs).pipe(
      takeUntil(stop$),
      switchMap(() => this.http.get<AnalysisProgressDto>(url)),
      // Stop emitting once we hit a terminal state; caller can also stop via stop$
      filter(p => !!p && !!p.status)
    );
  }
}

