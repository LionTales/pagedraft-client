/**
 * THE TRANSCRIPT'S ENTRY TYPES for the product assistant drawer (chatbot phase A, c2; split out a2).
 *
 * Lifted out of `product-chat.component.ts` when the ambient-chapter work pushed that file to ~1,000
 * lines, well past this repo's ~700-line soft ceiling that c2 had already waived once at 803. The split
 * is by SUBJECT and it is the only clean one available: what a transcript entry IS can be stated
 * without the component, while the transcript's STATE MACHINE cannot be divided at all - `entries`,
 * `pending` and the `reset$` unsubscribe are one invariant, and separating them would put the rule
 * "a discarded conversation's answer can never be appended" in two files.
 *
 * The four kinds are four TYPES rather than one type with a flag, and that is the shape the whole
 * feature turns on: a fail-safe is the assistant DECLINING to speak, so rendering it in an assistant
 * bubble would have undone the refusal. Different kinds cannot be rendered the same way by accident.
 */

import { ChatLanguage } from '../../core/models/product-chat';
import { ChatArtifactRef } from '../../core/models/chat-artifact-ref';
import { AmbientChapterChoice } from '../../core/services/ambient-chapter.service';


/**
 * Something the author typed.
 *
 * `bookId` is the book that was open WHEN IT WAS ASKED, not the book that is open now. It is what lets
 * the history sent to the server be scoped to the current book without throwing the transcript away -
 * see {@link ProductChatComponent.historyForServer}.
 */
export interface UserEntry {
  kind: 'user';
  id: number;
  text: string;
  bookId: string | null;

  /**
   * Phase B / a2. The chapter this turn was EXPLICITLY scoped to, set only when the author answered a
   * clarifying question by tapping a chapter chip.
   *
   * It exists because a chip re-asks the SAME sentence with a different ambient key, so without it the
   * transcript would show the identical question twice with no visible reason for the second answer to
   * differ. Null on every ordinary turn, where the context line above the transcript already states
   * which chapter Show is looking at and a per-turn repeat would be noise.
   */
  askedAboutChapter: string | null;
}

/**
 * Something the assistant actually said, grounded in guides. `guideIds` may be empty in principle,
 * but a grounded answer from this server always names at least one guide; the template renders the
 * citation block only when there is something to cite rather than an empty label.
 */
export interface AssistantEntry {
  kind: 'assistant';
  id: number;
  text: string;
  guideIds: string[];
  language: ChatLanguage;

  /**
   * Phase B. The book this answer was ABOUT, captured when the question was sent.
   *
   * Chips are routed against THIS id and not against whichever book is open when the chip is clicked.
   * An answer citing "chapter 7" of book A must keep pointing at book A's chapter 7 after the author
   * moves to book B, or the transcript would quietly rewrite its own provenance as the author walks
   * around the app.
   */
  bookId: string | null;

  /** Phase B. The cited book artifacts, already parsed. Empty for every book-less answer. */
  artifactRefs: ChatArtifactRef[];

  /**
   * Phase B. Set when the book half came back THIN on an otherwise good answer.
   *
   * This is a note ON an answer, never a failure state: the server sets it alongside
   * `isGrounded: true` when one source was unreadable and the turn went ahead on what survived. See
   * the template's `pc-book-thin` block.
   */
  bookFaultReason: string | null;

  /**
   * Phase B / a2. The CLARIFYING QUESTION's one-click chips, or null when the server did not ask.
   *
   * Present only when the server's `needsChapterClarification` was true AND this book has more than one
   * chapter to choose between. The server already refuses the flag on a one-chapter book; the second
   * check is here rather than trusted from there because it is the owner's own book's shape and "a
   * clarifying question there would be absurd" has to be impossible on both halves rather than hidden
   * on one.
   *
   * `question` is the sentence this answer replied to, kept so a chip can re-ask it verbatim instead of
   * making the author retype it. `choices` is captured AT ANSWER TIME, so the chips keep offering the
   * chapters the question was asked against even if the author navigates on while reading.
   */
  clarify: { question: string; choices: readonly AmbientChapterChoice[]; bookId: string | null } | null;
}

/**
 * A CONTEXT-CHANGE MARKER: the book the assistant is looking at changed mid-conversation (phase B).
 *
 * Not a turn. Nobody said it, it carries no role label and it is never sent to the server; it is a rule
 * in the transcript that says where one book's answers stop and the next book's begin. See
 * {@link ProductChatComponent} for why a switch inserts one of these instead of clearing the thread.
 */
export interface BookMarkerEntry {
  kind: 'book-marker';
  id: number;
  /** The book now in force, or null when the author left every book. */
  bookId: string | null;
  /** The title as known when the marker was written. Null renders the "this book" fallback. */
  title: string | null;
}

/**
 * The assistant DECLINING to speak. Not an assistant turn, and rendered nothing like one.
 *
 * This is the entry type the whole feature is built around. `isGrounded: false` means the server
 * refused to put an ungrounded answer in front of the author, and if the client rendered that refusal
 * in an assistant bubble it would have undone the refusal - the author would read a message from the
 * assistant and treat it as one. So a fault gets its own entry kind, its own block, its own copy, and
 * is never fed back into the history sent to the server.
 *
 * `question` is kept so the author can retry the exact thing they asked instead of retyping it.
 * `reason` is the raw wire code (or the client-side `network`), resolved to prose at render time.
 *
 * NO `bookId` HERE, unlike the two entry kinds above, and the asymmetry is deliberate (phase B). Theirs
 * exists to scope the wire history, and a fault is never sent as history; a retry re-asks through
 * {@link ProductChatComponent.ask}, which reads the CURRENT book, because the privacy fence is that a
 * request carries the book the author is in now and not one they used to be in.
 */
export interface FaultEntry {
  kind: 'fault';
  id: number;
  reason: string;
  question: string;
  /**
   * The book this question was ASKED in, or null outside one. Carried for the same reason the clarify
   * chips carry it: a fault outlives a book switch, and retrying it would re-ask against whatever book
   * is open now, quietly turning a question about one manuscript into a question about another.
   */
  bookId: string | null;
}

export type ChatEntry = UserEntry | AssistantEntry | FaultEntry | BookMarkerEntry;

