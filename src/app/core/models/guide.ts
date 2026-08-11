/**
 * The wire shapes of the read-only guides endpoints (chatbot phase A.2, c1).
 *
 * These mirror `Pagedraft.Api/Models/Dtos/GuidesDtos.cs`. The corpus behind them is the SAME one the
 * product assistant is grounded in, which is the point: the chat cites a guide id, and these types are
 * how the app turns that id into a page an author can read.
 *
 * `title` is DERIVED SERVER-SIDE from the guide's first H1 - there is no `title` frontmatter field,
 * and one was deliberately never added because those headings are also the chatbot's retrieval index.
 * So the title here is the document's own heading, not a label invented for the list.
 */

/** The two languages the corpus ships in. An en/he pair shares one `id` and differs only in `language`. */
export type GuideLanguage = 'he' | 'en';

/** One guide as the index sees it: frontmatter plus the derived title, no body. */
export interface GuideSummaryDto {
  id: string;
  stage: string;
  audience: string;
  language: string;
  title: string;
  /** Frontmatter `updated`, a plain calendar date (`YYYY-MM-DD`) with no time and no timezone. */
  updated: string;
  /**
   * The guide's numeric filename prefix (00, 10, 20 ...), i.e. its place in the authored workflow
   * order. The index arrives already sorted by it; it is exposed so a client can group without
   * re-deriving an order of its own. An unnumbered document sorts last (a very large number).
   */
  order: number;
}

/**
 * `GET /api/guides`. `fault` is null on success; on a 503 it is the server's machine-readable reason
 * (`guides-unavailable` / `guides-empty`), which is deliberately NOT the same thing as an empty list.
 */
export interface GuideListResponseDto {
  guides: GuideSummaryDto[];
  count: number;
  fault: string | null;
}

/** `GET /api/guides/{id}`: the summary fields plus the markdown body (frontmatter already stripped). */
export interface GuideContentDto extends GuideSummaryDto {
  body: string;
}

/**
 * The 404 body. `guideLanguageUnavailable` means the id exists but not in the language asked for (the
 * corpus's index page ships English-only), and `availableLanguages` then says what it DOES ship in, so
 * the reader can offer to open it in the other language instead of showing a dead end.
 */
export interface GuideNotFoundDto {
  error: 'guideNotFound' | 'guideLanguageUnavailable' | string;
  availableLanguages: string[];
}
