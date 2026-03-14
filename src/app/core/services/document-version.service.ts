import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DocumentVersionDto {
  id: string;
  bookId: string;
  chapterId: string;
  sceneId?: string | null;
  createdAt: string;
  label?: string | null;
  /** Set when version was created from Accept suggestion (API returns analysisResultId). */
  analysisId?: string | null;
  /** Same as analysisId; API returns this name (camelCase of AnalysisResultId). */
  analysisResultId?: string | null;
   /** Stable id of the AnalysisSuggestion that produced this version, when known. */
   suggestionId?: string | null;
  originalText?: string | null;
  suggestedText?: string | null;
  /** Status of the linked analysis result, when present (e.g. 'Active' or 'Archived'). */
  analysisStatus?: string | null;
}

export interface DocumentVersionDetailDto extends DocumentVersionDto {
  contentSfdt: string;
  analysisId?: string | null;
  analysisResultId?: string | null;
  suggestionId?: string | null;
  originalText?: string | null;
  suggestedText?: string | null;
  analysisStatus?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DocumentVersionService {
  constructor(private http: HttpClient) {}

  list(bookId: string, chapterId: string, sceneId?: string | null): Observable<DocumentVersionDto[]> {
    let url = `/api/books/${bookId}/chapters/${chapterId}/versions`;
    if (sceneId) url += `?sceneId=${encodeURIComponent(sceneId)}`;
    return this.http.get<DocumentVersionDto[]>(url);
  }

  /** Options for version metadata; avoids fragile positional params when adding fields (e.g. suggestionId). */
  create(
    bookId: string,
    chapterId: string,
    contentSfdt: string,
    options?: {
      label?: string | null;
      sceneId?: string | null;
      analysisId?: string | null;
      suggestionId?: string | null;
      originalText?: string | null;
      suggestedText?: string | null;
    }
  ): Observable<DocumentVersionDto> {
    const opts = options ?? {};
    let url = `/api/books/${bookId}/chapters/${chapterId}/versions`;
    if (opts.sceneId) url += `?sceneId=${encodeURIComponent(opts.sceneId)}`;
    const body: {
      contentSfdt: string;
      label: string | null;
      analysisId?: string;
      suggestionId?: string;
      originalText?: string;
      suggestedText?: string;
    } = { contentSfdt, label: opts.label ?? null };
    if (opts.analysisId) body.analysisId = opts.analysisId;
    if (opts.suggestionId) body.suggestionId = opts.suggestionId;
    if (opts.originalText != null) body.originalText = opts.originalText;
    if (opts.suggestedText != null) body.suggestedText = opts.suggestedText;
    return this.http.post<DocumentVersionDto>(url, body);
  }

  get(bookId: string, chapterId: string, id: string): Observable<DocumentVersionDetailDto> {
    return this.http.get<DocumentVersionDetailDto>(
      `/api/books/${bookId}/chapters/${chapterId}/versions/${id}`
    );
  }
}
