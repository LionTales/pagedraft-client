import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { GuideContentDto, GuideLanguage, GuideListResponseDto } from '../models/guide';

/**
 * The client half of the read-only guides endpoints (chatbot phase A.2, c1).
 *
 * Deliberately thin, like {@link ProductChatService}: the server owns the corpus, the title
 * derivation, the ordering and the language resolution, and this service must not re-derive any of
 * them. In particular it does NOT hold a hardcoded list of guide ids, does not translate anything, and
 * does not fall back from Hebrew to English on its own - asking for Hebrew asks for the `.he.md`
 * SIBLING, and if there is none the server says so and the surface decides what to offer.
 *
 * No client-side cache here on purpose. The responses carry a strong `ETag` and
 * `Cache-Control: public, max-age=300`, so the browser's HTTP cache already does this correctly,
 * including revalidating after a deploy. A second cache in application code would be a second answer
 * to "what does this guide say" and would go stale exactly when the first one did not.
 */
@Injectable({ providedIn: 'root' })
export class GuidesService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/guides';

  /**
   * The index: every guide's metadata, no bodies.
   *
   * `language` narrows to one side of the bilingual corpus. Errors are NOT swallowed: a 503 means the
   * server could not read the corpus at all, which is a different fact from "there are no guides" and
   * the page must be able to say so.
   */
  list(language?: GuideLanguage): Observable<GuideListResponseDto> {
    const options = language ? { params: new HttpParams().set('language', language) } : {};
    return this.http.get<GuideListResponseDto>(this.base, options);
  }

  /** One guide's markdown body, in the language asked for. 404 when that id has no sibling in it. */
  get(id: string, language: GuideLanguage): Observable<GuideContentDto> {
    return this.http.get<GuideContentDto>(
      `${this.base}/${encodeURIComponent(id)}`,
      { params: new HttpParams().set('language', language) },
    );
  }
}
