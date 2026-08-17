/**
 * Wire types for the FEEDBACK infrastructure (Show C2, `/api/feedback`).
 *
 * These mirror the server's `Models/Dtos/FeedbackDtos.cs` exactly: camelCase, `Guid` as a plain string,
 * and NOTHING IS AN ENUM. The API registers no `JsonStringEnumConverter`, so an enum would arrive as an
 * integer and every consumer would have to special-case it; `verdict`, `status`, `area` and `targetType`
 * therefore travel as the exact stored tokens, in exactly this casing. The unions below are TypeScript
 * narrowing over what the wire calls a plain string.
 *
 * ── WHY THIS FILE IS POLYMORPHIC AND SAYS SO ──────────────────────────────────────────────────────
 * Mount #1 is Show's answers, and nothing in this file knows that. A vote names an {@link FeedbackArea}
 * and a {@link FeedbackTargetType}/`targetId`; mounting the same widget on a proofread suggestion card
 * later is one constant here, one on the server's allowlist, and one line in a template. That is the
 * whole point of the strings being open vocabularies rather than enums, and it is why the widget takes
 * these three values as INPUTS rather than reading anything about chat.
 *
 * ── THE ONE READING RULE A CALLER MUST NOT GET WRONG ──────────────────────────────────────────────
 * On {@link FeedbackVoteRequest}, `text` null/absent means LEAVE THE EXISTING NOTE ALONE. That is how a
 * verdict flip preserves what the reader wrote without a second endpoint. A non-null value REPLACES the
 * note, and a value that is empty after trimming CLEARS it. The same rule governs `context`. Sending
 * `text: ''` to "not send a note" would silently delete the reader's own commentary.
 */

import { ConversationGroundingDto } from './conversation';

// ── The vocabularies ────────────────────────────────────────────────────────────────────────────────

/** What part of the product a row is about. Open vocabulary; C2 writes exactly one value. */
export type FeedbackArea = 'chat-answer';

/** What `targetId` points at. Open vocabulary; C2 writes exactly one value. */
export type FeedbackTargetType = 'conversation-message';

/** A thumbs pair is the whole vocabulary. There is deliberately no neutral value. */
export type FeedbackVerdict = 'up' | 'down';

/** The triage lifecycle, and C3's plug. */
export type FeedbackStatus = 'New' | 'Triaged' | 'ConfirmedBug' | 'Dismissed' | 'Fixed';

/** Mount #1's area. Named rather than spelled inline so a rename cannot silently un-wire a mount. */
export const FEEDBACK_AREA_CHAT_ANSWER: FeedbackArea = 'chat-answer';

/** Mount #1's target type: a persisted `ConversationMessage.Id` (Show C1). */
export const FEEDBACK_TARGET_CONVERSATION_MESSAGE: FeedbackTargetType = 'conversation-message';

/**
 * The note's cap, mirroring the server's `FeedbackCaps.TextChars`.
 *
 * IT IS A `400 textTooLong` SERVER-SIDE, NOT A TRUNCATION, so the widget's counter is the only thing
 * standing between a reader and a rejected vote. It is duplicated here rather than fetched because it is
 * a frozen d1 decision, and a counter that had to wait for a round trip to know its own limit would show
 * nothing at all on the first keystroke.
 */
export const FEEDBACK_TEXT_MAX = 2000;

/** Every status, in lifecycle order, for a filter control that must not miss one. */
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = [
  'New',
  'Triaged',
  'ConfirmedBug',
  'Dismissed',
  'Fixed',
];

/** Both verdicts, for the same reason. */
export const FEEDBACK_VERDICTS: readonly FeedbackVerdict[] = ['up', 'down'];

/**
 * The transition graph, mirroring the server's `FeedbackStatuses.LegalTransitions`.
 *
 * THE CLIENT'S COPY DECIDES WHICH BUTTONS ARE OFFERED; the server's copy decides what is allowed. The
 * duplication is deliberate and one-directional: a triage view that offered every status would put four
 * buttons on screen of which three answer `400 statusTransitionNotAllowed`, and a reading tool that
 * mostly refuses its own controls is not a reading tool. The server stays the authority, and the triage
 * surface renders its refusal verbatim when the two ever disagree.
 *
 * Three properties are load-bearing and are pinned by the spec: NOTHING RETURNS TO `New` (it is C3's
 * inbox, not "untouched"), `Fixed` is reachable only from `ConfirmedBug` (nothing can claim a fix for a
 * defect nobody confirmed), and a transition to the status a row already holds is an idempotent no-op
 * rather than an error.
 */
export const FEEDBACK_LEGAL_TRANSITIONS: Readonly<Record<FeedbackStatus, readonly FeedbackStatus[]>> = {
  New: ['Triaged', 'ConfirmedBug', 'Dismissed'],
  Triaged: ['ConfirmedBug', 'Dismissed'],
  ConfirmedBug: ['Fixed', 'Dismissed'],
  Dismissed: ['Triaged', 'ConfirmedBug'],
  Fixed: ['ConfirmedBug'],
};

/** The moves a row in this status may make. Empty for a status this client does not recognize. */
export function legalTransitionsFrom(status: string | null | undefined): readonly FeedbackStatus[] {
  if (!status) return [];
  return FEEDBACK_LEGAL_TRANSITIONS[status as FeedbackStatus] ?? [];
}

// ── The wire shapes ─────────────────────────────────────────────────────────────────────────────────

/**
 * The vote-time context that NO JOIN CAN RECOVER LATER (d1 section (2)).
 *
 * The answer, the question and the grounding refs are deliberately ABSENT: they are joined at read time
 * from the target, and a copy would freeze at vote time and drift from the row it claims to describe.
 *
 * `appBuild` is RESERVED and this client never populates it: `package.json` pins a never-bumped `"0.0.0"`
 * and no CI build id reaches the browser, so it is sent absent rather than invented.
 */
export interface FeedbackContextDto {
  route?: string | null;
  bookId?: string | null;
  chapterId?: string | null;
  uiLanguage?: string | null;
  appBuild?: string | null;
}

/**
 * Body of `POST /api/feedback` - the one-vote create-or-update.
 *
 * There is deliberately NO `userId` field. A client-supplied user id would be unauthenticated and
 * therefore meaningless as a dedup key, so the server resolves that half from the request principal
 * (null on every deployment today) and the client sends only {@link installationId}.
 */
export interface FeedbackVoteRequest {
  area: string;
  targetType: string;
  targetId: string;
  verdict: FeedbackVerdict;
  /** Null/absent KEEPS the stored note; non-null replaces it; empty after trimming clears it. */
  text?: string | null;
  installationId?: string | null;
  context?: FeedbackContextDto | null;
}

/** One feedback row as the wire sees it. Carries no voter identity: that is keying material. */
export interface FeedbackDto {
  id: string;
  area: string;
  targetType: string;
  targetId: string;
  verdict: string;
  text: string | null;
  status: string;
  createdAt: string;
  statusChangedAt: string;
  targetDeletedAt: string | null;
  context: FeedbackContextDto | null;
}

/** One row of the triage list. `bookId` is COMPOSED BY THE JOIN, never read off the feedback row. */
export interface FeedbackListItemDto {
  id: string;
  area: string;
  targetType: string;
  targetId: string;
  verdict: string;
  text: string | null;
  status: string;
  createdAt: string;
  statusChangedAt: string;
  targetDeletedAt: string | null;
  bookId: string | null;
}

/** The paged list envelope. `totalCount` is AFTER the filters and BEFORE paging. */
export interface FeedbackListDto {
  items: FeedbackListItemDto[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** Why the evidence join could not compose. Null when {@link FeedbackEvidenceDto.available} is true. */
export type FeedbackEvidenceUnavailableReason =
  | 'targetDeleted'
  | 'targetMissing'
  | 'targetTypeNotComposable';

/**
 * THE EVIDENCE, composed by a live join every time.
 *
 * A MISS IS A STATE, NOT A FAILURE: a deleted target still returns `200` with `available: false` and a
 * machine-readable reason, because d1 chose to KEEP the feedback row when its conversation is deleted
 * and refusing to show it would defeat that decision.
 *
 * PRIVACY: this is the manuscript-bearing half of the feature. It is read in place by the triage view
 * and goes nowhere else.
 */
export interface FeedbackEvidenceDto {
  available: boolean;
  unavailableReason: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  question: string | null;
  answer: string | null;
  answerFailed: boolean | null;
  answeredAt: string | null;
  askBookId: string | null;
  askChapterId: string | null;
  askChapterOrder: number | null;
  grounding: ConversationGroundingDto | null;
}

/** `GET /api/feedback/{id}` - the row and its joined evidence in ONE response. */
export interface FeedbackDetailDto {
  feedback: FeedbackDto;
  evidence: FeedbackEvidenceDto;
}

/**
 * `GET /api/feedback/availability` - whether this deployment serves the triage surface.
 *
 * THIS IS HOW THE CLIENT LEARNS THE FLAG, and it is the only honest way to: every gated endpoint answers
 * a BODILESS `404` when the flag is off, which is indistinguishable from a transport failure, so a route
 * guard built on one would hide the triage view whenever the network hiccuped.
 */
export interface FeedbackAvailabilityDto {
  triageEnabled: boolean;
}

/** Body of `PATCH /api/feedback/{id}/status`. */
export interface FeedbackStatusRequest {
  status: FeedbackStatus;
}

/**
 * The server's machine-readable rejection codes, mirrored so the client's error copy cannot drift from
 * the contract. Every one travels as `400 { "error": "<code>" }`.
 */
export type FeedbackErrorCode =
  | 'areaRequired'
  | 'areaNotRecognized'
  | 'targetTypeRequired'
  | 'targetTypeNotRecognized'
  | 'targetIdRequired'
  | 'verdictRequired'
  | 'verdictNotRecognized'
  | 'voterIdentityRequired'
  | 'installationIdTooLong'
  | 'textTooLong'
  | 'contextFieldTooLong'
  | 'targetNotFound'
  | 'feedbackNotFound'
  | 'statusRequired'
  | 'statusNotRecognized'
  | 'statusTransitionNotAllowed';
