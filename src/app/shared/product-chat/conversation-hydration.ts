/**
 * HYDRATION: persisted conversation rows back into the drawer's own transcript entries (Show C1, c2).
 *
 * ── THE ONE PROPERTY THIS MODULE EXISTS TO HOLD ───────────────────────────────────────────────────
 * The composed prompt sent for the NEXT question in a conversation hydrated from storage must be
 * byte-identical to the composed prompt an unbroken client session would have sent for that same next
 * question. C1 changed no prompt and re-ran no gate, and this is the sentence that makes "no re-gate
 * needed" a proof rather than an assumption.
 *
 * The mechanism is deliberately indirect, and the indirection is the whole design: this module does
 * NOT build a history window. It rebuilds `ChatEntry[]` - the same four entry types a live session
 * holds - and the UNCHANGED `ProductChatComponent.historyForServer()` then selects the window from
 * them exactly as it selects it from a live transcript, after which the UNCHANGED
 * `ProductChatService` applies the same 8-turn slice. There is no second copy of the selection rules
 * anywhere, so there is nothing for a hydrated window to drift from.
 *
 * ── WHAT THAT DEMANDS OF EACH ENTRY ───────────────────────────────────────────────────────────────
 *  1. FULL TEXT. The stored turn is untruncated; the 1,000-character per-turn cap is a SERVER-side
 *     property of prompt composition applied to whatever the client sends. Truncating here would give
 *     a resumed conversation a different window from an unbroken one the moment that constant moves.
 *  2. THE ASK-TIME BOOK. `historyForServer()` drops any turn whose captured book differs from the book
 *     open NOW, so every entry has to carry the book it was asked in, not the book being looked at.
 *  3. A FAILED EXCHANGE BECOMES THE PAIR A LIVE SESSION HOLDS: the author's `user` turn, and a fault
 *     under it. `ProductChatComponent.ask()` appends that turn before the request goes out and only
 *     `retry()` ever removes it, so a failure the author did not retry is still in an unbroken
 *     session's transcript and still in the window `historyForServer()` sends. Emitting the fault
 *     alone made a resumed session send one turn LESS than the unbroken session it is supposed to be
 *     indistinguishable from, which is the pin above, broken. What is still never replayed is the
 *     REFUSAL: the server stores its fail-safe prose flagged on the assistant row, and sending that
 *     back as an `assistant` turn would condition the next answer on words the assistant never said.
 *     The server flags BOTH turns because a thumbs-down on a failure is signal and because the
 *     assistant half has to stay identifiable as the one that never goes back up.
 *     A RETRIED failure is the mirror case and the turn is withheld there: `retry()` removes the pair
 *     before re-asking, so the live transcript holds ONE copy of that question while storage holds two.
 *     See {@link hydrateTranscript}'s `resentLater` for how the two are told apart and what that costs.
 *  4. CONTEXT-CHANGE MARKERS ARE RE-DERIVED, not stored. A `BookMarkerEntry` is a rule drawn in the
 *     transcript, never a message and never sent, so persisting it as a message type would have put a
 *     thing nobody said into the message table. It is recomputed from the ask-time book changing
 *     between consecutive rows, which is the same event that draws one live. A held failed question is
 *     flushed BEFORE that recomputation runs, so a fault belonging to the book being left is filed
 *     above the marker that announces the new one, never under it - see the `bookChanged` handling in
 *     {@link hydrateTranscript}.
 *
 * ── THE TWO FACTS STORAGE DOES NOT CARRY, STATED RATHER THAN PAPERED OVER ─────────────────────────
 *  - THE FAULT CODE. `GroundingJson` is written on successful assistant turns only, so a restored
 *    failure cannot say WHICH fault it was. It renders through the fault path's documented
 *    unknown-code fallback, which is the honest sentence for "the refusal happened and its cause was
 *    not kept", rather than guessing a specific one. It costs nothing on the wire: a fault is never
 *    sent as history in either direction.
 *  - THE ANSWER'S LANGUAGE. There is no language column, so a restored answer's direction is taken
 *    from the script the stored answer is mostly WRITTEN IN. That is a read of the same fact the
 *    server's own detector reads (Hebrew and English use disjoint alphabets), and it decides `dir`
 *    only; nothing about the wire depends on it.
 *
 * Pure, with no Angular dependency, so the round-trip property can be asserted directly on entries
 * rather than through a rendered fixture.
 */

import { ConversationMessageDto } from '../../core/models/conversation';
import { ChatLanguage } from '../../core/models/product-chat';
import { parseArtifactRefs } from '../../core/models/chat-artifact-ref';
import { dominantDirection } from '../../core/i18n/text-direction';
import { ChatEntry } from './product-chat-entries';

/**
 * The reason code a restored failure renders with.
 *
 * NOT one of the server's four documented codes and not this client's `network` either: it is
 * deliberately a value `faultMessage` does not recognize, so it falls through to the generic
 * "I could not ground an answer" sentence by the same documented rule that protects the surface from a
 * server that grows a fifth code. Naming it here (rather than passing a bare `'unknown'`) is what lets
 * a spec assert the fallback is reached ON PURPOSE.
 */
export const RESTORED_FAULT_REASON = 'restored-unknown';

export interface HydrationContext {
  /**
   * The first entry id to mint. Entry ids are monotonic across the session and never reused, so
   * hydration continues the component's own counter rather than restarting at 1 - a restarted counter
   * could collide with the `track` identity of a turn the view is still tearing down.
   */
  firstId: number;
  /** The book the drawer is looking at NOW. Used only to title a marker, never to filter rows. */
  currentBookId: string | null;
  /** That book's title, when known. Null renders the marker's own "this book" fallback. */
  currentBookTitle: string | null;
  /** The chrome language, used only when a stored answer's own script is undecidable. */
  fallbackLanguage: ChatLanguage;
}

export interface HydrationResult {
  entries: ChatEntry[];
  /** The next free entry id, for the component to continue from. */
  nextId: number;
}

/**
 * Rebuild a transcript from stored messages.
 *
 * `messages` must be the WHOLE conversation, oldest first. It is sorted by `sequence` here as well
 * rather than trusted: `sequence` is the order of record precisely because both turns of one exchange
 * can carry the same `createdAt`, and a page boundary or a future endpoint change must not be able to
 * reorder a question after its answer.
 */
export function hydrateTranscript(
  messages: readonly ConversationMessageDto[],
  context: HydrationContext
): HydrationResult {
  const ordered = [...(messages ?? [])].sort((a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0));

  const entries: ChatEntry[] = [];
  let id = context.firstId;

  // `undefined` means "no row seen yet", which is NOT the same as a row asked outside any book
  // (`null`). Without the distinction the first row of an app-level conversation would look like a
  // change from something and draw a marker with nothing above it to separate from.
  let previousBook: string | null | undefined = undefined;

  // The question half of a failed exchange, held until its answer row arrives so the pair can be filed
  // in the shape a live failure has: the author's turn, and the fault under it. `at` is the row's own
  // position in `ordered`, which is what makes "resent LATER" answerable.
  let failedQuestion: { text: string; bookId: string | null; at: number } | null = null;

  // The LAST position at which ANY `user` row carries each exact text - FAILED ROWS INCLUDED. A failed
  // question that reappears further down the conversation was asked again, which is the only trace
  // `retry()` leaves, and a retry that ALSO failed is still a retry: `retry()` cuts the pair out before
  // re-asking whatever the second attempt then does, so the live transcript holds the LAST copy and only
  // the last copy. Counting only un-failed rows here would replay every attempt of a question that failed
  // twice, which is the duplicate this derivation exists to prevent - and with the model unreachable,
  // every retry fails, so that is the ordinary shape of a bad afternoon rather than an exotic one.
  const lastAskedAt = new Map<string, number>();
  ordered.forEach((row, index) => {
    if (!row) return;
    if ((row.role ?? '').toLowerCase() === 'assistant') return;
    const text = row.text ?? '';
    if (text) lastAskedAt.set(text, index);
  });

  /**
   * Was this failed question asked again, later in the same conversation?
   *
   * THIS IS A DERIVATION FROM STORED TEXT, NOT A RECORDED FACT, and saying so is the point of this
   * comment. `retry()` re-asks `entry.question` verbatim through the ordinary `ask()` path and the
   * server trims both writes identically (`ChatConversationStore.BeginExchangeAsync`), so the failed
   * row's text and the retry's text are byte-equal - but nothing anywhere says the second row IS the
   * retry. `ProductChatRequest` carries no retry marker and `ConversationMessage` has no column
   * pointing at the turn a turn re-asks, so recording the fact properly is a schema change plus a wire
   * change, which this fix deliberately does not make.
   *
   * IT COUNTS A LATER FAILED ATTEMPT TOO, so a question that failed, was retried, and failed again is
   * carried once. Only the LAST copy survives the comparison - its own position is the one recorded, so
   * `> at` is false for it and true for every earlier attempt - which is exactly the single pair
   * `retry()` leaves in a live transcript.
   *
   * THE INPUT IT GETS WRONG is an author who retypes a failed question BY HAND instead of pressing
   * retry, and it is wrong in exactly two shapes of that one input. (i) SAME BOOK: live leaves both
   * copies in the transcript (only `retry()` removes entries, `ask()` only appends), so the live
   * window carries the question twice and the resumed one carries it once. (ii) ANOTHER BOOK: this
   * match is not scoped by book, so a retype in book B suppresses the failure asked in book A, and a
   * resumed session reading book A is short by that question while one reading book B agrees with
   * live. A genuine `retry()` can never be the cross-book case, because it refuses a fault raised in
   * another book. Both shapes make the resumed window a SUBSET of the live one, which is the safe
   * direction and the same direction this feature already tolerated before the failed question was
   * replayed at all: it drops context rather than inflating the window the model reads.
   *
   * IT CAN NEVER GO THE OTHER WAY, and that is arithmetic rather than an untested hope. Live holds
   * (attempts - retries) copies of a repeated question, since each ask appends one and each `retry()`
   * removes one; hydration emits (attempts - failures) + 1 if the last attempt failed, since it emits
   * every un-failed row plus the last row when that row is flagged. A retry can only be pressed on a
   * failure and each consumes a distinct fault, so retries <= failures, with equality only when the
   * last attempt succeeded - which is also when the "+ 1" is not taken. So hydration's count is never
   * above live's. The full cell matrix, and the specs that pin each cell, are in
   * `conversation-hydration.spec.ts` and `product-chat-history.component.spec.ts`.
   */
  const resentLater = (text: string, at: number): boolean => (lastAskedAt.get(text) ?? -1) > at;

  /**
   * File a held failed question as that pair.
   *
   * THE `user` TURN IS WHAT MAKES THE RESEND WINDOW MATCH. `ask()` appends the author's turn before the
   * request goes out and `acceptFault` does not remove it - only `retry()` cuts the pair - so a live
   * session that suffered a failure the author did not retry is still holding that question, and
   * `historyForServer()` still sends it. Closing that difference from HERE rather than from the live
   * selection is the whole point: no gated prompt path moves.
   *
   * THE FAULT IS FILED EITHER WAY. A retried failure is still a failure the author should see in the
   * transcript they resumed; what `retry()` took away is the resent TURN, not the record of the
   * failure. Only the `user` half is at issue here.
   *
   * The fault keeps carrying the question as well, because `retry()` re-asks from exactly that field.
   */
  const flushFailed = (fallbackBook: string | null): void => {
    if (!failedQuestion) return;
    const bookId = failedQuestion.bookId ?? fallbackBook;
    // An EMPTY question is not a turn anybody took: it is the synthesized stand-in below for a flagged
    // assistant row that arrived with no flagged question above it. A live session cannot hold an empty
    // user turn, so emitting one would put on the wire a turn no session ever sent.
    if (failedQuestion.text && !resentLater(failedQuestion.text, failedQuestion.at)) {
      entries.push({
        kind: 'user',
        id: id++,
        text: failedQuestion.text,
        bookId,
        // Same reason as an ordinary user turn: the tag says the author answered a clarifying question
        // by tapping a chapter, which storage cannot tell apart from "a chapter was open".
        askedAboutChapter: null,
      });
    }
    entries.push({
      kind: 'fault',
      id: id++,
      reason: RESTORED_FAULT_REASON,
      question: failedQuestion.text,
      bookId,
    });
    failedQuestion = null;
  };

  for (let index = 0; index < ordered.length; index++) {
    const message = ordered[index];
    if (!message) continue;
    const askBook = message.askBookId ?? null;
    const bookChanged = previousBook !== undefined && askBook !== previousBook;

    // A held failed question belongs to the book being LEFT, so file it before the marker that
    // announces the change is drawn. Flushing it here first, rather than letting the branches below
    // reach it later in the loop, is the fix: otherwise the fault renders UNDER a rule that says "from
    // here on I am looking at <newBook>", which is the one thing that rule exists to deny.
    if (bookChanged) flushFailed(previousBook ?? null);

    // THE MARKER, re-derived. Drawn only when the ask-time book actually changed AND something is
    // already above it, mirroring the live rule exactly: a conversation that opens with "from here on
    // I am looking at X" before a word has been said reads as noise rather than as a boundary.
    //
    // Flushing the held failure above means `entries.length` can go from zero to non-zero right on this
    // line: a book change on the far side of a leading, still-unanswered failure now draws the marker
    // that used to be silently suppressed. THAT IS INTENDED, not a side effect of the reorder: a fault
    // IS content above the rule. It also matches the live rule it mirrors -
    // `product-chat.component.ts`'s book-change handler pushes a marker under the identical
    // `if (this.entries.length > 0)` guard, and live, `ask()` and `acceptFault()` push the failed pair
    // into `entries` synchronously, so by the time the book changes there is already content for that
    // guard to see. Filing the fault first here reproduces the same ordering rather than diverging from
    // it.
    if (bookChanged && entries.length > 0) {
      entries.push({
        kind: 'book-marker',
        id: id++,
        bookId: askBook,
        // Only the CURRENT book's title is knowable here - the list endpoint carries ids, not titles.
        // A marker for any other book renders its own "this book" fallback, which is what it already
        // renders live for a marker written before a title landed.
        title: askBook && askBook === context.currentBookId ? context.currentBookTitle : null,
      });
    }
    previousBook = askBook;

    const isAssistant = (message.role ?? '').toLowerCase() === 'assistant';

    if (message.failed) {
      // Both turns of a failed exchange are flagged, so the question arrives first and is HELD.
      if (!isAssistant) {
        // A second failed question with no answer between them means the first exchange has no answer
        // row at all; file the first before taking the second, so neither is lost.
        flushFailed(askBook);
        failedQuestion = { text: message.text ?? '', bookId: askBook, at: index };
        continue;
      }
      // The answer row closes the pair. Its own prose is deliberately NOT rendered: the server has two
      // fail-safe sentences for several codes, and the client's per-reason copy is what the surface
      // shows, exactly as it does for a live failure.
      if (!failedQuestion) failedQuestion = { text: '', bookId: askBook, at: index };
      flushFailed(askBook);
      continue;
    }

    // A non-failed row ends any dangling failed question (an exchange whose answer never landed).
    flushFailed(askBook);

    if (isAssistant) {
      entries.push({
        kind: 'assistant',
        id: id++,
        text: message.text ?? '',
        guideIds: message.grounding?.guideIds ?? [],
        language: restoredLanguage(message.text, context.fallbackLanguage),
        bookId: askBook,
        artifactRefs: parseArtifactRefs(message.grounding?.artifactRefs),
        bookFaultReason: message.grounding?.bookFaultReason ?? null,
        // NEVER RESTORED. Clarify chips re-ask a question against a chapter list captured at answer
        // time, and that list is not stored; offering chips built from today's chapters would re-ask an
        // old question against a book that has moved on, which is the wrong-chapter fabrication the
        // chips' own guards exist to prevent. A restored answer is read, not re-asked from.
        clarify: null,
      });
      continue;
    }

    entries.push({
      kind: 'user',
      id: id++,
      text: message.text ?? '',
      bookId: askBook,
      // Not stored as a label, and deliberately not re-derived from `askChapterId`: the tag says the
      // author ANSWERED a clarifying question by tapping a chapter, which is a different fact from
      // "a chapter was open", and only the live session can tell the two apart.
      askedAboutChapter: null,
    });
  }

  flushFailed(previousBook ?? null);

  return { entries, nextId: id };
}

/**
 * The direction a restored answer reads in, from the script it is mostly written in.
 *
 * A live answer takes this from the server's `language` field and never re-detects it; a STORED answer
 * has no such field, so the majority script is the closest true reading available. It is
 * majority-based rather than first-strong for the reason `text-direction.ts` gives: a Hebrew answer
 * opening with "PageDraft" must not flip whole.
 */
function restoredLanguage(text: string | null | undefined, fallback: ChatLanguage): ChatLanguage {
  const direction = dominantDirection(text);
  if (!direction) return fallback;
  return direction === 'rtl' ? 'he' : 'en';
}
