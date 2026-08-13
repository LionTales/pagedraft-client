/**
 * Wire types for the grounded product assistant (chatbot phase A, `POST /api/product-chat`).
 *
 * These mirror the server's `ProductChatRequest` / `ProductChatResponseDto` exactly. Everything is
 * camelCase and nothing is an enum, because the API registers no `JsonStringEnumConverter` - an enum
 * would arrive as an integer and every consumer would have to special-case it. So the two
 * closed-string unions below (`ChatLanguage`, `ChatRole`) are TypeScript-side narrowing over what the
 * wire calls a plain string; see {@link ProductChatResponseDto.faultReason} for the one field that is
 * deliberately NOT narrowed.
 *
 * Phase A boundary, stated here because the types are where it would first leak: there is no
 * conversation id, no persisted transcript, no token or quota field, and no customization payload.
 * Those are phase C and the quota one additionally needs a usage-metering backend that does not
 * exist. Do not add a field here "for later".
 */

/** The two languages the assistant answers in. Server-decided, never re-detected on the client. */
export type ChatLanguage = 'he' | 'en';

/** Who said a turn. The server treats any unrecognized role as the user's; we only ever send these. */
export type ChatRole = 'user' | 'assistant';

/** One prior turn of the transcript, as sent back to the server for continuity. */
export interface ProductChatTurnDto {
  role: ChatRole;
  content: string;
}

/**
 * Request body.
 *
 * `history` is the CLIENT-held transcript: phase A keeps no server-side conversation state, so
 * continuity is per request. The server forwards only its own last-N window and truncates each turn,
 * so the client must not assume every turn it sends is read.
 *
 * `language` is a HINT only. The server detects the answer language from the question's own script
 * and consults this field solely when the question contains no letters at all (a bare "?" or a
 * number). A mislabelled locale therefore cannot get a Hebrew question answered in English.
 */
export interface ProductChatRequest {
  question: string;
  history: ProductChatTurnDto[];
  language: ChatLanguage;

  /**
   * The book the author is CURRENTLY inside, or omitted entirely when the drawer is open outside any
   * book (chatbot phase B).
   *
   * Present = the assistant may answer from THAT book's artifacts; absent = phase A's behaviour
   * byte-for-byte, including its "answering about a specific book is not available yet" refusal. The
   * privacy fence is the SHAPE: a single id from the client's current route, never a list and never a
   * "books I have access to" set. Cross-book answers are phase C, and this field is what keeps that a
   * decision rather than an accident.
   *
   * OPTIONAL rather than nullable on the wire: the server's `BookId` is a `Guid?` with a null default,
   * so omitting the property and sending `null` are the same request, and omitting it keeps a
   * book-less body byte-identical to the one phase A sent.
   */
  bookId?: string;

  /**
   * The chapter the author has OPEN on screen, or `null` when none is (phase B, d2 section (1)).
   *
   * THESE TWO TRAVEL WITH {@link bookId} AND ARE ALWAYS EMITTED WHENEVER IT IS, explicitly `null` when
   * no chapter is open. That is the contract's whole point: "the drawer is open on the book dashboard"
   * and "this client is too old to say" must not be the same request, and an ambient key that is
   * sometimes silently absent is worse than one that is explicitly null. So the null case is a written
   * `null`, never an omission, and `ProductChatService` sets both in one place so they cannot diverge.
   *
   * OUTSIDE A BOOK ALL THREE ARE ABSENT and the body stays byte-identical to phase A's. That is a
   * deliberate narrowing of d2's "never optional" wording, and the narrowing is safe on its own terms:
   * the distinction these fields exist to preserve only arises once there IS a book to be inside, and
   * phase A's gate verdict is a measurement of a body with none of these properties on it.
   *
   * `?:` here is therefore about the NO-BOOK shape, not about the in-book one; the in-book "always
   * present" rule is pinned by `product-chat.service.spec.ts` against the emitted keys rather than left
   * to the type.
   */
  ambientChapterId?: string | null;

  /**
   * The 0-based `Chapter.Order` of the same chapter. Sent alongside {@link ambientChapterId} under the
   * identical rule, and used by the server only as a FALLBACK: it looks the id up against freshly-read
   * chapter rows and uses that row's current order, because the client's order is a snapshot a reorder
   * can invalidate while the id is durable.
   */
  ambientChapterOrder?: number | null;
}

/**
 * The chapter an ask is scoped to: the open one, or the one an author picked from a clarify chip.
 *
 * A pair rather than a bare id, because the two answer different questions on the server (the id is
 * authoritative for IDENTITY, the order is the fallback for RESOLUTION), and keeping them together is
 * what stops a caller sending one without the other.
 */
export interface AmbientChapterKey {
  id: string;
  /** 0-BASED, exactly as `Chapter.Order` and the citation refs carry it. */
  order: number;
}

/**
 * Response body. Always 200 once the question is non-blank, INCLUDING every fail-safe.
 *
 * `isGrounded` is the branch the whole surface turns on: `true` is a normal assistant answer,
 * `false` is a refusal that must be rendered as an honest failure and NOT as something the assistant
 * said. That distinction is the reason this feature exists - a bot that presents an ungrounded guess
 * as an answer is worse than no bot, because the author acts on it.
 *
 * `guideIds` are frontmatter ids (`export`, `faq`, `workflow-overview` ...), language-neutral by
 * construction: an en/he pair shares one id, so a Hebrew answer grounded in an English guide cites
 * the same id an English answer would. Empty on a fail-safe.
 *
 * `faultReason` is null exactly when `isGrounded` is true. It is typed as a plain `string` rather
 * than the {@link ProductChatFaultReason} union ON PURPOSE: it arrives from the wire, and a server
 * that adds a fifth code must degrade to the generic message rather than fall off a `never` branch.
 * Narrow it with {@link isKnownFaultReason} at the point of rendering.
 */
export interface ProductChatResponseDto {
  answer: string;
  guideIds: string[];
  language: ChatLanguage;
  isGrounded: boolean;
  faultReason: string | null;

  /**
   * Phase B. The BOOK-artifact references the answer cited, the sibling of {@link guideIds} and
   * subject to the same safety property: the server puts a ref here only when the prompt actually
   * carried that artifact AFTER the budget trim, so a chip can never point at grounding the model
   * never saw.
   *
   * Shapes are flat slugs, `<type>` or `<type>:<key>` (see {@link parseArtifactRef}). ALWAYS empty or
   * absent when the request carried no `bookId`. Optional here because a server that predates B, or a
   * phase-A-shaped response, simply omits it - `res.artifactRefs ?? []` is the reading rule.
   */
  artifactRefs?: string[] | null;

  /**
   * Phase B. Non-null when the BOOK half of a book-scoped turn could not be fully retrieved, one of
   * the {@link BookChatFaultReason} codes.
   *
   * DELIBERATELY SEPARATE from {@link faultReason}, whose phase-A contract (null exactly when
   * {@link isGrounded} is true) is unchanged. The two halves fail independently, so this field can be
   * set on a PERFECTLY GOOD answer: `isGrounded: true` with a `bookFaultReason` means the answer stands
   * but the book half came back thinner than usual, and the surface says so rather than either hiding
   * it or dressing a real answer up as a failure. When the book half failed COMPLETELY the server
   * refuses instead, and then `isGrounded` is false and `faultReason` carries the same code.
   */
  bookFaultReason?: string | null;

  /**
   * Phase B, d2 section (5). True when the question was about a chapter and NO chapter resolved -
   * neither from an explicit reference nor from the ambient open chapter - so the surface should offer
   * the book's chapters as one-click chips instead of making the author retype the question.
   *
   * COMPUTED SERVER-SIDE FROM THE SELECTION, NEVER FROM THE ANSWER'S PROSE. The owner's rule is that
   * Show must never ask "which chapter?" while the chapter is open on screen, so the flag's condition
   * opens with "no chapter resolved" and a resolved ambient chapter makes it false BY CONSTRUCTION. The
   * server additionally refuses it on a book with at most one chapter, where there is nothing to
   * disambiguate; the client enforces the same rule again at render time rather than trusting one half
   * of a two-sided contract.
   *
   * Optional here for the same reason {@link artifactRefs} is: a server that predates this, or a
   * phase-A-shaped response, simply omits it, and `res.needsChapterClarification === true` is the
   * reading rule.
   */
  needsChapterClarification?: boolean;
}

/**
 * The fault codes the server documents today. Each one gets its OWN user-facing sentence: collapsing
 * them into a single "something went wrong" would hide the difference between "the guides are
 * unreachable" (retry later, nothing is wrong with the question) and "the model returned nothing"
 * (the guides were found, so the corpus is fine), which is exactly the information the author needs
 * to know whether to try again.
 */
export type ProductChatFaultReason =
  | 'guides-unavailable'
  | 'guides-empty'
  | 'model-unavailable'
  | 'empty-answer';

const KNOWN_FAULT_REASONS: readonly string[] = [
  'guides-unavailable',
  'guides-empty',
  'model-unavailable',
  'empty-answer',
];

/** Whether a wire `faultReason` is one this client has a specific sentence for. */
export function isKnownFaultReason(reason: string | null | undefined): reason is ProductChatFaultReason {
  return !!reason && KNOWN_FAULT_REASONS.includes(reason);
}

/**
 * The BOOK-half fault codes the server documents (phase B, `BookChatFaults`).
 *
 * These live in their own union rather than being folded into {@link ProductChatFaultReason} because
 * they answer a different question. A phase-A code says the assistant could not answer AT ALL; most of
 * these say one SOURCE of the book half was unreadable while the turn went ahead on what survived.
 * Only `book-unavailable` normally reaches {@link ProductChatResponseDto.faultReason}, and it does so
 * on the path where nothing about the book could be read - but any of them can arrive there, since the
 * server reports the FIRST fault it recorded, so all seven are given a sentence rather than four.
 */
export type BookChatFaultReason =
  | 'book-unavailable'
  | 'register-unreadable'
  | 'briefs-unreadable'
  | 'status-unavailable'
  | 'findings-unreadable'
  | 'escalation-unreadable'
  | 'history-unreadable';

const KNOWN_BOOK_FAULT_REASONS: readonly string[] = [
  'book-unavailable',
  'register-unreadable',
  'briefs-unreadable',
  'status-unavailable',
  'findings-unreadable',
  'escalation-unreadable',
  'history-unreadable',
];

/** Whether a wire `bookFaultReason` is one this client has a specific sentence for. */
export function isKnownBookFaultReason(
  reason: string | null | undefined
): reason is BookChatFaultReason {
  return !!reason && KNOWN_BOOK_FAULT_REASONS.includes(reason);
}
