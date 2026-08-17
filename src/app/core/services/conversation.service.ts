import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { EMPTY, Observable, expand, reduce } from 'rxjs';

import {
  ConversationDto,
  ConversationListDto,
  ConversationMessageDto,
  ConversationMessagesDto,
  ConversationRenameRequest,
} from '../models/conversation';

/**
 * The client half of `/api/conversations` (Show C1): list, read, rename, delete.
 *
 * Thin for the same reason {@link ProductChatService} is, and for one additional reason that is
 * specific to this feature: THIS SERVICE MUST NOT COMPOSE ANYTHING. C1's one architectural rule is
 * that the composed prompt does not change by a byte, and the way that stays true is that stored
 * messages are replayed into the drawer's ORDINARY transcript entries and the ordinary, unchanged
 * `historyForServer()` then selects the window. A helper here that returned "the last N turns" would
 * be a second window rule sitting one refactor away from the real one.
 *
 * Nothing here is cached across calls. The list is small, the author opens it deliberately, and a
 * cache would have to be invalidated by a rename, a delete AND every answer that bumps `updatedAt` -
 * three invalidation sites for a saving nobody asked for.
 */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/conversations';

  /** The list page size this client asks for. The server clamps at its own maximum regardless. */
  static readonly ListPageSize = 20;

  /**
   * The message page size hydration asks for, and the ceiling on how many pages it will walk.
   *
   * The page size is the server's own documented maximum, so an ordinary conversation hydrates in ONE
   * request. The page ceiling exists so a server that reported a `totalCount` it never delivers cannot
   * spin this client forever; 40 pages of 500 is 20,000 turns, which is far past anything a drawer
   * conversation reaches.
   */
  static readonly MessagePageSize = 500;
  static readonly MaxMessagePages = 40;

  /**
   * `GET /api/conversations` - newest first by `updatedAt`, optionally filtered to one book.
   *
   * An OMITTED bookId means EVERY conversation, app-level ones included; it does not mean "the
   * app-level ones". The filter is passed through as the server documented it rather than reinterpreted
   * here, so a history list can never silently hide the book conversations.
   */
  list(bookId: string | null, page = 1, pageSize = ConversationService.ListPageSize):
    Observable<ConversationListDto> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (bookId) params = params.set('bookId', bookId);
    return this.http.get<ConversationListDto>(this.url, { params });
  }

  /** `GET /api/conversations/{id}` - metadata alone. */
  get(id: string): Observable<ConversationDto> {
    return this.http.get<ConversationDto>(`${this.url}/${id}`);
  }

  /** `GET /api/conversations/{id}/messages` - ONE page, oldest first, ordered by `sequence`. */
  messagesPage(id: string, page = 1, pageSize = ConversationService.MessagePageSize):
    Observable<ConversationMessagesDto> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<ConversationMessagesDto>(`${this.url}/${id}/messages`, { params });
  }

  /**
   * EVERY message of a conversation, oldest first - the shape hydration needs.
   *
   * IT WALKS THE PAGES RATHER THAN READING THE FIRST ONE, and that is not tidiness. The messages
   * endpoint is paged OLDEST FIRST, while the resend window is the LAST eight turns; a hydration that
   * read page 1 alone would, on any conversation longer than a page, rebuild a transcript missing
   * exactly the turns the next request is composed from. The window would then differ from the
   * unbroken session's, which is the one thing C1's byte-identity pin forbids.
   */
  allMessages(id: string): Observable<ConversationMessageDto[]> {
    const size = ConversationService.MessagePageSize;
    return this.messagesPage(id, 1, size).pipe(
      // `EMPTY` is what ENDS the walk: `expand` stops when the projection returns an observable that
      // emits nothing, so the "no next page" arm fires no request at all rather than asking for a page
      // past the end and discarding it.
      expand((res, i) => {
        const fetched = (res.page ?? 1) * (res.pageSize ?? size);
        const more = fetched < (res.totalCount ?? 0) && i + 2 <= ConversationService.MaxMessagePages;
        return more ? this.messagesPage(id, (res.page ?? 1) + 1, size) : EMPTY;
      }),
      reduce(
        (all: ConversationMessageDto[], res: ConversationMessagesDto) => all.concat(res.items ?? []),
        []
      )
    );
  }

  /**
   * `PATCH /api/conversations/{id}` - the author's own title.
   *
   * The title is sent TRIMMED, matching what the server stores, so the row the list shows back is the
   * row the author typed. A blank title is still sent rather than swallowed here: the server answers
   * 400 `titleRequired`, and a client that silently refused would leave the author pressing a button
   * that does nothing.
   */
  rename(id: string, title: string): Observable<ConversationDto> {
    const body: ConversationRenameRequest = { title: (title ?? '').trim() };
    return this.http.patch<ConversationDto>(`${this.url}/${id}`, body);
  }

  /** `DELETE /api/conversations/{id}` - HARD delete, messages included. 204 on success. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
