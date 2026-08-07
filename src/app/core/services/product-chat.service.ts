import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
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
 * There is no GET here and no conversation id: phase A holds the transcript in the drawer component
 * for the life of the session and persists nothing. Cross-session history is phase C.
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
    language: ChatLanguage
  ): Observable<ProductChatResponseDto> {
    const body: ProductChatRequest = {
      question,
      history: history.slice(-ProductChatService.MaxSentTurns).map(t => ({ ...t })),
      language,
    };
    return this.http.post<ProductChatResponseDto>(this.url, body);
  }
}
