import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AmbientChapterKey,
  ChatLanguage,
  ProductChatRequest,
  ProductChatResponseDto,
  ProductChatTurnDto,
} from '../models/product-chat';

/**
 * The client half of `POST /api/product-chat` (chatbot phase A, c2).
 *
 * Deliberately thin, for the same reason {@link CharacterRegisterService} is: every RULE lives on the
 * server. Retrieval, the grounding instruction, the answer language, the citation, the history window
 * and every fail-safe are decided there, and this service must not re-derive any of them. In
 * particular it does NOT inspect the question's script to pick a language, does NOT decide whether an
 * answer is grounded, and does NOT map a fault code to prose - it hands the DTO through untouched and
 * lets the surface render the server's verdict.
 *
 * SHOW C1 ADDED ONE FIELD AND NOT ONE RULE: {@link ask} now carries an optional conversation id, and
 * that id is a threading key for the server's WRITE, never an instruction to read. The server does not
 * compose from stored history; this client still sends the window, still bounded by
 * {@link MaxSentTurns}, and every selection rule that decides WHICH turns reach that window lives where
 * it always did, in `ProductChatComponent.historyForServer`. Reading the stored transcript back is a
 * different service (`ConversationService`) against different endpoints, so there is no path from
 * storage into a prompt on this seam at all.
 */
@Injectable({ providedIn: 'root' })
export class ProductChatService {
  private readonly url = '/api/product-chat';

  /**
   * Upper bound on how many prior turns this client puts on the wire.
   *
   * This is NOT the server's rule restated as truth. The server applies its own window and its own
   * per-turn truncation regardless of what arrives, and remains the only authority on what the model
   * actually reads. This cap exists so a long session cannot grow the request body without bound; if
   * the server's window ever widens, nothing here breaks, the client simply sends less than it could.
   */
  static readonly MaxSentTurns = 8;

  constructor(private http: HttpClient) {}

  /**
   * Ask a product question.
   *
   * `history` should be the transcript as displayed, oldest first; the LAST {@link MaxSentTurns}
   * turns are sent. Callers must pass only turns that really were said: a fail-safe is not something
   * the assistant said, so it must never be fed back as an `assistant` turn or the next answer will
   * be conditioned on a refusal it is supposed to have recovered from.
   *
   * Errors are not swallowed. A transport failure surfaces as an `HttpErrorResponse` and the caller
   * renders its own honest failure state, because a network fault and a server-declared fail-safe are
   * different facts and the author can act on only one of them.
   */
  ask(
    question: string,
    history: readonly ProductChatTurnDto[],
    language: ChatLanguage,
    bookId?: string | null,
    ambientChapter?: AmbientChapterKey | null,
    conversationId?: string | null
  ): Observable<ProductChatResponseDto> {
    const body: ProductChatRequest = {
      question,
      history: history.slice(-ProductChatService.MaxSentTurns).map(t => ({ ...t })),
      language,
    };
    // OMITTED, not sent as null, when there is no book (phase B). The server treats an absent and a
    // null `bookId` identically, but a body that carries no such property at all is BYTE-IDENTICAL to
    // the one phase A sent, and phase A's gate verdict is a measurement of that request. Keeping the
    // no-book path unchanged on the wire is the cheapest way to keep it unchanged in fact.
    if (bookId) {
      body.bookId = bookId;
      // THE AMBIENT PAIR IS WRITTEN HERE AND ONLY HERE, both keys, unconditionally, explicitly null
      // when no chapter is open (phase B, a2). The server has to be able to tell "the drawer is open on
      // the dashboard" from "this client is too old to say", and it can do that only if the key's
      // absence means one thing and one thing alone. Writing them together is also what keeps the pair
      // consistent: a caller cannot supply an id without its order or the reverse, because the caller
      // supplies neither - it supplies a chapter, or nothing.
      //
      // `??` and not `||`, and it is load-bearing rather than style: `Chapter.Order` is 0-based, the
      // owner's real book is a single chapter AT ORDER 0, and `0 || null` is null. A `||` here would
      // send "no chapter is open" for the exact book this plan was written about.
      body.ambientChapterId = ambientChapter?.id ?? null;
      body.ambientChapterOrder = ambientChapter?.order ?? null;
    }
    // SHOW C1, and written LAST and OMITTED WHEN ABSENT for the same reason `bookId` is: a first
    // question in a fresh conversation has no id to send, and a body that carries no such property is
    // byte-identical to the one phase B measured. The server mints the conversation on that request
    // and returns its id, so threading starts from the answer rather than from a client-side guess.
    if (conversationId) body.conversationId = conversationId;
    return this.http.post<ProductChatResponseDto>(this.url, body);
  }
}
