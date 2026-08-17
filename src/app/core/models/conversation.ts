/**
 * Wire types for the PERSISTED Show conversations (Show C1, `/api/conversations`).
 *
 * These mirror the server's `ConversationDtos.cs` exactly: camelCase, no enums (the API registers no
 * `JsonStringEnumConverter`, so an enum would arrive as an integer), `Guid` as a plain string.
 *
 * ── WHAT THIS SURFACE IS AND IS NOT ───────────────────────────────────────────────────────────────
 * It is STORAGE. Nothing here composes a prompt and nothing here is read by the model. C1's one
 * architectural rule is that the composed prompt does not change by a byte, and the mechanism that
 * guarantees it is that the CLIENT remains the sender of the resend window: these rows are replayed
 * into the drawer's own transcript entries (see `conversation-hydration.ts`) and the UNCHANGED
 * `historyForServer()` then selects the window from them exactly as it does from a live session's.
 *
 * ── THE TWO FIELDS HYDRATION TURNS ON ─────────────────────────────────────────────────────────────
 * `sequence` is the order of record, not `createdAt`: both turns of one exchange are stamped inside a
 * single save and can carry the same instant, which would make "question then answer" a coin flip.
 * `failed` is true on BOTH TURNS of a failed exchange, and each half is used for a DIFFERENT purpose.
 * The live client does NOT cut a failed exchange out of its transcript: `ask()` appends the author's
 * turn before the request goes out and only `retry()` ever removes it, so a failure the author did not
 * retry is still in an unbroken session's transcript and still in the window `historyForServer()`
 * sends. Hydration therefore REPLAYS the flagged question as a `user` turn, and the flag on the
 * ASSISTANT half is what keeps the refusal from coming back as an assistant turn.
 *
 * The one exception is a question the author RETRIED, which storage cannot distinguish from a failure
 * that was left alone: `retry()` removes the pair before re-asking, so live holds the question once
 * while storage holds it twice. Hydration derives the retry from the stored text - a later `user` row
 * carrying the identical string, FAILED OR NOT, since `retry()` removes the pair whatever the second
 * attempt then does - and withholds every copy but the last. That derivation gets ONE input wrong, in
 * two shapes: an author who retypes a failed question BY HAND, in the same book (live keeps both
 * copies, the resumed window carries one) or in another book (the match is not book-scoped, so the
 * failure asked in book A is suppressed by a retype in book B). Both are the safe direction, and it
 * can never go the other way: hydration's copy count is provably never above the live transcript's.
 * See `conversation-hydration.ts`'s `resentLater` for the arithmetic and the full cell matrix.
 */

/** One row of `GET /api/conversations`. No message bodies: `messageCount` is the cheap projection. */
export interface ConversationListItemDto {
  id: string;
  title: string;
  /** Null for an app-level product Q&A conversation; a book id when it was held inside a book. */
  bookId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * The paged list envelope.
 *
 * `totalCount` is the count BEFORE paging and AFTER the book filter. `nearCapWarning` is informational
 * and enforced nowhere: the server auto-deletes nothing, because authors keep notebooks.
 */
export interface ConversationListDto {
  items: ConversationListItemDto[];
  page: number;
  pageSize: number;
  totalCount: number;
  nearCapWarning: boolean;
}

/** Conversation metadata alone, for `GET /api/conversations/{id}` and the rename response. */
export interface ConversationDto {
  id: string;
  title: string;
  bookId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * The per-answer grounding snapshot, stored at answer time.
 *
 * Present on SUCCESSFUL ASSISTANT TURNS ONLY: null on every user turn and on every failed one. That is
 * why a hydrated failure cannot name its own fault code (see `conversation-hydration.ts`).
 */
export interface ConversationGroundingDto {
  guideIds: string[];
  artifactRefs: string[];
  bookFaultReason: string | null;
  needsChapterClarification: boolean;
  selectionSummary: string | null;
}

/**
 * One persisted turn.
 *
 * `text` is the FULL stored turn. The per-turn character cap is a SERVER-side property of prompt
 * composition applied on the way IN to a prompt, never on the way out of storage, so hydration replays
 * full text and a second truncation site here would drift from that constant the moment it is retuned.
 */
export interface ConversationMessageDto {
  id: string;
  /** The 0-based ordinal within the conversation. THE ORDER OF RECORD; do not sort on `createdAt`. */
  sequence: number;
  /** `"user"` or `"assistant"`. A plain string, matching the wire's own leniency. */
  role: string;
  text: string;
  /** True on BOTH turns of a failed exchange. See the file doc. */
  failed: boolean;
  createdAt: string;
  /** The book open when THIS turn was asked. What lets hydration rebuild the wire history's filter. */
  askBookId: string | null;
  askChapterId: string | null;
  askChapterOrder: number | null;
  grounding: ConversationGroundingDto | null;
}

/** The paged message envelope, oldest first (transcript render order). */
export interface ConversationMessagesDto {
  items: ConversationMessageDto[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** Body for `PATCH /api/conversations/{id}`. A blank title after trimming is a 400. */
export interface ConversationRenameRequest {
  title: string;
}
