import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AiTierValue, BookAiTierDto } from '../models/book';

/**
 * The book's model tier (model-tier-fast-thinking plan, p3-4).
 *
 * WHY THIS IS ITS OWN ENDPOINT AND NOT A FIELD ON THE BOOK PUT. Two reasons, both about not lying to the
 * user. First, the answer is more than the stored token: the surface also needs to know whether the tier can
 * route on this server at all, and WHICH model each allowlisted task will actually use for THIS book's
 * language. That is resolved server-side by the same function the AI router resolves through, so the client
 * cannot compute it and must not guess it. Second, PUT /api/books/{id} replaces title/author/language, so
 * flipping a tier through it would risk clobbering fields this control has no business touching.
 *
 * The server also REJECTS setting 'thinking' when the tier cannot route (409), which is what stops a book
 * from advertising a tier it is not on.
 */
@Injectable({ providedIn: 'root' })
export class AiTierService {
  constructor(private http: HttpClient) {}

  /** The book's stored tier plus the readiness/route detail the control renders. */
  get(bookId: string): Observable<BookAiTierDto> {
    return this.http.get<BookAiTierDto>(`/api/books/${bookId}/ai-tier`);
  }

  /**
   * Sets the tier. Opting IN to 'thinking' means this book's chapter text is sent to a third-party provider
   * for the allowlisted tasks, so callers must have obtained explicit consent first. Returns the same shape
   * as {@link get}, so the caller re-renders from the server's answer rather than from what it asked for.
   */
  set(bookId: string, tier: AiTierValue): Observable<BookAiTierDto> {
    return this.http.put<BookAiTierDto>(`/api/books/${bookId}/ai-tier`, { tier });
  }
}
