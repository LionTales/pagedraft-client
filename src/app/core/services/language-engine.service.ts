import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  LanguageEngineRequest,
  LanguageEngineResult,
  LanguageIssue,
  IssuesResponse
} from '../models/language-engine';

@Injectable({ providedIn: 'root' })
export class LanguageEngineService {
  constructor(private http: HttpClient) {}

  /**
   * Run full language engine pipeline (Normalize → Detect → Rewrite → Analyze).
   */
  runFullPipeline(
    bookId: string,
    chapterId: string,
    request?: LanguageEngineRequest
  ): Observable<LanguageEngineResult> {
    return this.http.post<LanguageEngineResult>(
      `/api/books/${bookId}/chapters/${chapterId}/language-engine/full`,
      request || {}
    );
  }

  /**
   * Detect issues only (Normalize → Detect).
   */
  detectIssues(
    bookId: string,
    chapterId: string,
    request?: LanguageEngineRequest
  ): Observable<LanguageEngineResult> {
    return this.http.post<LanguageEngineResult>(
      `/api/books/${bookId}/chapters/${chapterId}/language-engine/detect`,
      request || {}
    );
  }

  /**
   * Rewrite text only (Normalize → Detect → Rewrite).
   */
  rewriteText(
    bookId: string,
    chapterId: string,
    request?: LanguageEngineRequest
  ): Observable<LanguageEngineResult> {
    return this.http.post<LanguageEngineResult>(
      `/api/books/${bookId}/chapters/${chapterId}/language-engine/rewrite`,
      request || {}
    );
  }

  /**
   * Get detected issues for a chapter.
   */
  getIssues(bookId: string, chapterId: string): Observable<IssuesResponse> {
    return this.http.get<IssuesResponse>(
      `/api/books/${bookId}/chapters/${chapterId}/language-engine/issues`
    );
  }
}
