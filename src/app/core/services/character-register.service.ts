import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CharacterRegisterDto,
  CharacterRegisterEditDto,
  UpdateCharacterRegisterRequest,
} from '../models/character-register';

/**
 * The author's read/write access to a book's character register (character-register-editing plan, c1
 * endpoints, book-scoped under `api/books/{bookId}/character-register`).
 *
 * Deliberately thin. Every RULE lives on the server (the matching key with its alias fallback, the
 * provenance defaults, permanent suppression, the stamp) so the edit endpoint and the re-extraction
 * merge can never drift apart. This service must not re-derive any of them.
 *
 * Both methods return the server's FULL register, which is what the surface reconciles against. There
 * is deliberately no whole-register PUT: a stale client could silently drop characters (including
 * author-confirmed ones) it never knew about.
 */
@Injectable({ providedIn: 'root' })
export class CharacterRegisterService {
  private readonly base = '/api/books';

  constructor(private http: HttpClient) {}

  /**
   * GET the register with provenance.
   *
   * A book whose register has never been built answers 200 with `hasRegister: false` and no
   * characters (NOT a 404) - that is the empty state, and it is the server's answer, not something
   * the client infers from an empty list.
   */
  getRegister(bookId: string): Observable<CharacterRegisterDto> {
    return this.http.get<CharacterRegisterDto>(`${this.base}/${bookId}/character-register`);
  }

  /**
   * PATCH a batch of author edits and receive the SERVER's resulting register.
   *
   * All-or-nothing: a rejected batch (400) writes nothing, so a caller must never render a partial
   * success. The returned register is the only truth about what landed.
   */
  applyEdits(
    bookId: string,
    edits: CharacterRegisterEditDto[]
  ): Observable<CharacterRegisterDto> {
    const body: UpdateCharacterRegisterRequest = { edits };
    return this.http.patch<CharacterRegisterDto>(
      `${this.base}/${bookId}/character-register`,
      body
    );
  }
}
