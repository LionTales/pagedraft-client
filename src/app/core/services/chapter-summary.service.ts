import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ChapterSummaryViewDto,
  RederiveChapterSummaryResponse,
} from '../models/chapter-summary';

/**
 * Reads, edits, and re-derives per-chapter summaries (wb3-c04 contract).
 * Routes live on BooksController under `api/books/{bookId}/chapters/{chapterId}/summary`.
 *
 * The flat `summaryText` is the user's OWN authoritative understanding of the chapter (editable). Saving an
 * edit sets the clobber-guard flag (`summaryUserEdited`) so a later automatic re-summary will not overwrite
 * it. The re-derive is a USER-TRIGGERED action that rebuilds the AI structured brief (read by the whole-book
 * review) SEEDED with the edited summary, so the review reflects the edit. The re-derive is synchronous (one
 * chapter, one model call) - it returns a terminal result, not a pollable job.
 */
@Injectable({ providedIn: 'root' })
export class ChapterSummaryService {
  private readonly base = '/api/books';

  constructor(private http: HttpClient) {}

  /** GET .../chapters/{chapterId}/summary?language= - the dual-surface view + freshness + flags. */
  getChapterSummary(
    bookId: string,
    chapterId: string,
    language: string
  ): Observable<ChapterSummaryViewDto> {
    const lang = encodeURIComponent(language || 'he');
    return this.http.get<ChapterSummaryViewDto>(
      `${this.base}/${bookId}/chapters/${chapterId}/summary?language=${lang}`
    );
  }

  /**
   * PUT .../chapters/{chapterId}/summary - save the user's edited flat summary. Sets summaryUserEdited and
   * stamps summaryUserEditedAt; does NOT touch the structured surface (dual-surface). Returns the updated view.
   */
  updateChapterSummary(
    bookId: string,
    chapterId: string,
    summaryText: string,
    language = 'he'
  ): Observable<ChapterSummaryViewDto> {
    return this.http.put<ChapterSummaryViewDto>(
      `${this.base}/${bookId}/chapters/${chapterId}/summary`,
      { summaryText, language }
    );
  }

  /**
   * POST .../chapters/{chapterId}/summary/rederive - the user-triggered re-derive of the structured brief,
   * seeded with the edited summary so the whole-book review reflects the edit. Synchronous: resolves with a
   * terminal RederiveChapterSummaryResponse (rederived true/false).
   */
  rederiveChapterSummary(
    bookId: string,
    chapterId: string,
    language = 'he'
  ): Observable<RederiveChapterSummaryResponse> {
    return this.http.post<RederiveChapterSummaryResponse>(
      `${this.base}/${bookId}/chapters/${chapterId}/summary/rederive`,
      { language }
    );
  }
}
