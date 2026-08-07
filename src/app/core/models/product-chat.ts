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
