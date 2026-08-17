/**
 * Hydration: stored rows back into transcript entries (Show C1, c2).
 *
 * This file asserts the SHAPE hydration produces. The property that shape exists to serve - that the
 * resend window after a resume is identical to the one an unbroken session sent - is asserted where it
 * is actually observable, on the wire, in `product-chat-history.component.spec.ts`. Both are needed: a
 * correct-looking entry list that the component then windows differently would pass here and fail
 * there, and a matching window built from wrong entries would pass there and be a coincidence.
 */
import { ConversationMessageDto } from '../../core/models/conversation';
import { AssistantEntry, FaultEntry, UserEntry } from './product-chat-entries';
import { RESTORED_FAULT_REASON, hydrateTranscript } from './conversation-hydration';

const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

function message(over: Partial<ConversationMessageDto> = {}): ConversationMessageDto {
  return {
    id: `m-${over.sequence ?? 0}`,
    sequence: over.sequence ?? 0,
    role: 'user',
    text: '',
    failed: false,
    createdAt: '2026-08-16T10:00:00Z',
    askBookId: null,
    askChapterId: null,
    askChapterOrder: null,
    grounding: null,
    ...over,
  };
}

/** One ordinary exchange, oldest-first, starting at `from`. */
function exchange(from: number, question: string, answer: string, bookId: string | null = null) {
  return [
    message({ sequence: from, role: 'user', text: question, askBookId: bookId }),
    message({
      sequence: from + 1,
      role: 'assistant',
      text: answer,
      askBookId: bookId,
      grounding: {
        guideIds: ['import'],
        artifactRefs: [],
        bookFaultReason: null,
        needsChapterClarification: false,
        selectionSummary: 'selected=import',
      },
    }),
  ];
}

function context(over: Partial<Parameters<typeof hydrateTranscript>[1]> = {}) {
  return {
    firstId: 1,
    currentBookId: null,
    currentBookTitle: null,
    fallbackLanguage: 'he' as const,
    ...over,
  };
}

describe('hydrateTranscript (Show C1)', () => {
  it('rebuilds an ordinary exchange as a user turn and an assistant turn, in order', () => {
    const { entries } = hydrateTranscript(exchange(0, 'how do I import?', 'DOCX, split by Heading 1'), context());

    expect(entries.length).toBe(2);
    expect(entries[0].kind).toBe('user');
    expect(entries[1].kind).toBe('assistant');
    expect((entries[0] as UserEntry).text).toBe('how do I import?');
    expect((entries[1] as AssistantEntry).text).toBe('DOCX, split by Heading 1');
    expect((entries[1] as AssistantEntry).guideIds).toEqual(['import']);
  });

  it('replays the FULL stored text, never a truncated copy', () => {
    // The 1,000-character per-turn cap is a SERVER-side property of prompt composition, applied to
    // whatever the client sends. A second truncation site here would drift from that constant the
    // moment it is retuned, and the hydrated conversation would then compose a window the unbroken
    // session would not have composed - the one thing C1's byte-identity pin forbids.
    const long = 'x'.repeat(4000);
    const { entries } = hydrateTranscript(exchange(0, long, long), context());
    expect((entries[0] as UserEntry).text.length).toBe(4000);
    expect((entries[1] as AssistantEntry).text.length).toBe(4000);
  });

  it('orders by SEQUENCE and not by arrival or createdAt', () => {
    // Both turns of one exchange are stamped inside a single save and can carry the same instant, so
    // ordering on `createdAt` would make "question then answer" a coin flip.
    const rows = [
      message({ sequence: 1, role: 'assistant', text: 'the answer', createdAt: '2026-08-16T10:00:00Z' }),
      message({ sequence: 0, role: 'user', text: 'the question', createdAt: '2026-08-16T10:00:00Z' }),
    ];
    const { entries } = hydrateTranscript(rows, context());
    expect((entries[0] as UserEntry).text).toBe('the question');
    expect((entries[1] as AssistantEntry).text).toBe('the answer');
  });

  it('carries the ASK-TIME book onto every entry, not the book being looked at now', () => {
    // `historyForServer()` drops any turn whose captured book differs from the book open NOW, so an
    // entry that carried the current book would resend turns the unbroken session had scoped away.
    const { entries } = hydrateTranscript(
      exchange(0, 'q', 'a', BOOK_A),
      context({ currentBookId: BOOK_B })
    );
    expect((entries[0] as UserEntry).bookId).toBe(BOOK_A);
    expect((entries[1] as AssistantEntry).bookId).toBe(BOOK_A);
  });

  it('replays a trailing user turn whose answer never landed, as an ordinary user turn', () => {
    // A request that died in flight (the tab closed, the process went away) leaves a stored user row
    // with no assistant row after it and no `failed` flag, because nothing ever reached the code that
    // sets one. It is REPLAYED, and that is what byte-identity requires rather than a leak: `ask()`
    // appended that turn before the request went out, so the transcript the live session was holding
    // at the moment it died held it too. Dropping it here would make the resumed window a strict
    // subset of the window that session would have sent for its next question.
    //
    // The design doc claimed the opposite ("likewise not resent", PAGEDRAFT_DESIGN.md §2.8.2) until
    // sweep01; this case is what the corrected sentence now points at.
    const rows = [
      ...exchange(0, 'first', 'first answer'),
      message({ sequence: 2, role: 'user', text: 'the one that never came back' }),
    ];
    const { entries } = hydrateTranscript(rows, context());

    expect(entries.map(e => e.kind)).toEqual(['user', 'assistant', 'user']);
    // By CONTENT, so a hydration that dropped it fails on a message naming the lost question rather
    // than on a bare count.
    expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
      .toEqual(['first', 'the one that never came back']);
    // And it is a TURN, not a fault: an unflagged row is not a failure, and rendering it as one would
    // tell the author a refusal happened that never did.
    expect(entries.some(e => e.kind === 'fault')).toBeFalse();
  });

  // ── Failed exchanges ────────────────────────────────────────────────────────────────────────────

  describe('a failed exchange', () => {
    const failed = [
      message({ sequence: 0, role: 'user', text: 'a question that failed', failed: true }),
      message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
    ];

    it('becomes the QUESTION as a user turn and a fault under it, and never an assistant turn', () => {
      // This is the pin's narrowest case. `ask()` appends the author's turn before the request goes
      // out and only `retry()` ever removes it, so an unbroken session that suffered a failure the
      // author did not retry is STILL holding that question and still sending it; a hydration that
      // emitted the fault alone would send one turn less than that session. The REFUSAL is the half
      // that must never come back as a turn, which is why the server flags both rows.
      const { entries } = hydrateTranscript(failed, context());

      expect(entries.map(e => e.kind)).toEqual(['user', 'fault']);
      expect((entries[0] as UserEntry).text).toBe('a question that failed');
      expect(entries.some(e => e.kind === 'assistant')).toBeFalse();
    });

    it('keeps the QUESTION on the fault as well, so the author can retry it', () => {
      const { entries } = hydrateTranscript(failed, context());
      expect((entries[1] as FaultEntry).question).toBe('a question that failed');
    });

    it('does NOT render the server\'s fail-safe prose as the failure text', () => {
      // A live failure shows the client's per-reason copy, not the server's sentence; a restored one
      // must not read differently just because the sentence happens to be in storage.
      const { entries } = hydrateTranscript(failed, context());
      expect(JSON.stringify(entries)).not.toContain('I cannot reach the guides.');
    });

    it('falls back to the UNKNOWN fault sentence, because the code was never stored', () => {
      // `GroundingJson` is written on successful assistant turns only, so a restored failure cannot
      // name which fault it was. It takes the documented unknown-code path deliberately rather than
      // guessing one of the four.
      const { entries } = hydrateTranscript(failed, context());
      expect((entries[1] as FaultEntry).reason).toBe(RESTORED_FAULT_REASON);
    });

    it('carries the ask-time book onto BOTH halves, so a stale retry is still refused', () => {
      const rows = [
        message({ sequence: 0, role: 'user', text: 'q', failed: true, askBookId: BOOK_A }),
        message({ sequence: 1, role: 'assistant', text: 'nope', failed: true, askBookId: BOOK_A }),
      ];
      const { entries } = hydrateTranscript(rows, context({ currentBookId: BOOK_B }));
      // The turn's book is what `historyForServer()` reads to keep another book's question off the
      // wire, and the fault's is what `retry()` reads to refuse a stale re-ask. Both are the ask-time
      // book, never the book being looked at now.
      expect((entries[0] as UserEntry).bookId).toBe(BOOK_A);
      expect((entries[1] as FaultEntry).bookId).toBe(BOOK_A);
    });

    it('files a failed QUESTION whose answer row never landed, rather than losing it', () => {
      const rows = [
        message({ sequence: 0, role: 'user', text: 'orphaned', failed: true }),
        ...exchange(1, 'next question', 'next answer'),
      ];
      const { entries } = hydrateTranscript(rows, context());
      expect(entries.map(e => e.kind)).toEqual(['user', 'fault', 'user', 'assistant']);
      expect((entries[0] as UserEntry).text).toBe('orphaned');
      expect((entries[1] as FaultEntry).question).toBe('orphaned');
    });

    it('invents NO user turn for a flagged answer row that has no flagged question above it', () => {
      // Storage's own anomaly, not a shape any session holds. An empty `user` turn would go up on the
      // wire as an empty turn, which no live session ever sent, so the fault is filed alone.
      const rows = [
        message({ sequence: 0, role: 'assistant', text: 'refusal', failed: true }),
      ];
      const { entries } = hydrateTranscript(rows, context());
      expect(entries.map(e => e.kind)).toEqual(['fault']);
      expect((entries[0] as FaultEntry).question).toBe('');
    });

    it('WITHHOLDS the question when the author RETRIED it, because live it is held once, not twice', () => {
      // `retry()` cuts BOTH the user turn and the fault out of the transcript and re-asks through the
      // ordinary path, so a live session that retried holds ONE copy of that question. Storage holds
      // two - the flagged pair and the retry's fresh pair - so replaying the flagged one as a turn
      // would put a question on the wire twice that the live session sent once. That is a SUPERSET of
      // the live window, which inflates what the model reads, and the 8-turn slice only hides it once
      // a conversation is long enough to reach the cap.
      const rows = [
        message({ sequence: 0, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
        ...exchange(2, 'what happened to my run?', 'It finished at 10:04'),
      ];
      const { entries } = hydrateTranscript(rows, context());

      // By CONTENT first: a hydration that replays both copies fails here naming the duplicated
      // question, rather than on a bare count of entries.
      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
        .toEqual(['what happened to my run?']);
      expect(entries.map(e => e.kind)).toEqual(['fault', 'user', 'assistant']);
    });

    it('still files the FAULT for a retried failure: only the resent TURN was at issue', () => {
      // The author should still see, in the transcript they resumed, that the question failed once.
      // A fault is a display entry `historyForServer()` can never select, so keeping it costs the
      // window nothing.
      const rows = [
        message({ sequence: 0, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
        ...exchange(2, 'what happened to my run?', 'It finished at 10:04'),
      ];
      const { entries } = hydrateTranscript(rows, context());

      // THE FIXTURE MUST REALLY CONTAIN THE RETRY, or this is the un-retried case wearing the retried
      // case's name. A closing-review mutation that emptied `exchange()` left it green, because nothing
      // below reads the retry's half of the conversation.
      expect(entries.filter(e => e.kind === 'assistant').length)
        .withContext('the retry\'s answer is what makes this a RETRIED failure rather than a bare one')
        .toBe(1);
      expect(entries.filter(e => e.kind === 'user').length)
        .withContext('the retried question is carried once, by the retry\'s own row')
        .toBe(1);

      // Asserted as the LIST of fault questions rather than as "a fault exists", so a hydration that
      // dropped it fails on a message naming the question whose failure went missing.
      const faults = entries.filter(e => e.kind === 'fault') as FaultEntry[];
      expect(faults.map(f => f.question))
        .withContext('the fault still carries the question, which is what retry() re-asks from')
        .toEqual(['what happened to my run?']);
      expect(faults.map(f => f.reason)).toEqual([RESTORED_FAULT_REASON]);
    });

    it('carries a question that failed, was RETRIED, and failed AGAIN exactly once', () => {
      // The cell between the two the suppression was first written for. `retry()` cuts the pair out
      // before re-asking whatever the second attempt then does, so a live transcript holds ONE failed
      // pair no matter how many attempts failed - while storage holds one flagged pair per attempt.
      // Counting only UN-FAILED rows as the retry replayed every attempt, which is the SUPERSET
      // divergence this whole derivation exists to prevent, in the shape a bad afternoon actually has:
      // with the model unreachable, every retry fails too.
      const rows = [
        message({ sequence: 0, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
        message({ sequence: 2, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 3, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
      ];
      const { entries } = hydrateTranscript(rows, context());

      // By CONTENT first, so replaying both attempts fails on a message naming the duplicated question
      // rather than on a bare count of entries.
      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
        .withContext('a question that failed twice is held ONCE live, so it is replayed once')
        .toEqual(['what happened to my run?']);
      // The LAST attempt is the one that survives, which is the pair the live transcript is holding.
      expect(entries.map(e => e.kind)).toEqual(['fault', 'user', 'fault']);
    });

    it('reads only LATER rows as the retry, so an EARLIER identical question replays as normal', () => {
      // The suppression is a derivation from stored text, and its whole scope is "asked again AFTER
      // the failure". An identical question asked BEFORE it is a different turn that succeeded, and
      // reading it as the retry would drop a question the live transcript still holds.
      const rows = [
        ...exchange(0, 'what happened to my run?', 'It finished at 09:12'),
        message({ sequence: 2, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 3, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
      ];
      const { entries } = hydrateTranscript(rows, context());

      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
        .toEqual(['what happened to my run?', 'what happened to my run?']);
      expect(entries.map(e => e.kind)).toEqual(['user', 'assistant', 'user', 'fault']);
    });

    it('sits between the exchanges around it, in transcript order', () => {
      const rows = [
        ...exchange(0, 'first', 'first answer'),
        message({ sequence: 2, role: 'user', text: 'failed one', failed: true }),
        message({ sequence: 3, role: 'assistant', text: 'refusal', failed: true }),
        ...exchange(4, 'third', 'third answer'),
      ];
      const { entries } = hydrateTranscript(rows, context());
      expect(entries.map(e => e.kind)).toEqual([
        'user', 'assistant', 'user', 'fault', 'user', 'assistant',
      ]);
    });

    // ── THE REST OF THE RETRY MATRIX (final-r02) ──────────────────────────────────────────────────
    //
    // The three cells above were each written after a defect was found in the cell next to them. These
    // are the remaining cells, enumerated mechanically from the two facts a stored `user` row carries
    // (its text, and its `failed` flag) rather than from the next bug report, so the next reader
    // inherits the matrix instead of re-deriving it. The plan file holds the same matrix as a table
    // with a verdict per cell.
    //
    // THE PROPERTY THEY ADD UP TO, which is stronger than any one of them: hydration can only ever
    // emit FEWER copies of a repeated question than the live transcript holds, never more. Each ask
    // appends one copy live and each `retry()` removes one, so live holds (attempts - retries); each
    // attempt is one stored row, and hydration emits every un-failed row plus the last row if it
    // failed, i.e. (attempts - failures) + (last failed ? 1 : 0). A retry can only be pressed on a
    // failure and each one consumes a distinct fault, so retries <= failures, with equality only when
    // the last attempt succeeded (which is also when the "+1" is not taken). So the count hydration
    // emits is never above the count live holds. The SUPERSET direction is therefore closed by
    // arithmetic and not merely untested; the deviations below are all the safe direction.

    it('carries a question RETRIED TWICE exactly once, however many attempts storage holds', () => {
      // Two failures then a success. Live, each `retry()` cut the previous pair out before re-asking,
      // so the transcript holds one question and the answer that finally came.
      const rows = [
        message({ sequence: 0, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
        message({ sequence: 2, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 3, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
        ...exchange(4, 'what happened to my run?', 'It finished at 10:04'),
      ];
      const { entries } = hydrateTranscript(rows, context());

      // By CONTENT first, so a hydration that replays an earlier attempt fails on a message naming the
      // duplicated question rather than on a bare count.
      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
        .withContext('three stored attempts of one question are one question live')
        .toEqual(['what happened to my run?']);
      // Both historical failures are still shown, which is the deliberate half of the rule: only the
      // resent TURN was ever at issue.
      expect(entries.map(e => e.kind)).toEqual(['fault', 'fault', 'user', 'assistant']);
    });

    it('leaves a repeated question ALONE when neither copy failed, because nothing was retried', () => {
      // RESTRAINT, and the only cell that says the suppression is scoped to flagged rows at all. An
      // author who asks the same thing twice and gets two answers holds both turns live, and a
      // suppression keyed on text alone would quietly drop one of them.
      const rows = [
        ...exchange(0, 'what happened to my run?', 'It finished at 09:12'),
        ...exchange(2, 'what happened to my run?', 'Still 10:04, nothing changed'),
      ];
      const { entries } = hydrateTranscript(rows, context());

      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
        .withContext('two successful asks of one question are two turns live, and stay two here')
        .toEqual(['what happened to my run?', 'what happened to my run?']);
      expect(entries.some(e => e.kind === 'fault'))
        .withContext('nothing failed, so nothing may render as a failure')
        .toBeFalse();
    });

    it('emits NO user turn for a flagged question whose stored text is empty', () => {
      // `ProductChatController.Ask` 400s a blank question before any row is written, so this shape can
      // only arrive from storage rather than from the product - which is exactly why the guard is here
      // and not left to the endpoint. An empty `user` entry would go up as an empty turn on the wire,
      // and no live session ever sent one.
      const rows = [
        message({ sequence: 0, role: 'user', text: '', failed: true }),
        message({ sequence: 1, role: 'assistant', text: 'refusal', failed: true }),
      ];
      const { entries } = hydrateTranscript(rows, context());

      expect(entries.map(e => e.kind)).toEqual(['fault']);
      expect((entries[0] as FaultEntry).question).toBe('');
    });

    /**
     * KNOWN DEVIATION, PINNED RATHER THAN FIXED: a hand-retyped repeat is a retry as far as storage is
     * concerned.
     *
     * The two produce byte-identical rows - `retry()` re-asks `entry.question` verbatim through the
     * ordinary `ask()` path and the server trims both writes the same way - and nothing in the schema
     * or on the wire marks a turn as re-asking another. So this cell is wrong by construction, and it
     * stays wrong until a `retryOf` is RECORDED (see the plan's `## Recommendation for the owner`).
     *
     * The direction is the safe one: live, `ask()` only appends, so a hand-retype leaves BOTH copies in
     * the transcript and the live window carries the question twice; here it carries it once, a SUBSET.
     * It drops context rather than inflating what the model reads. The wire half of this cell is
     * asserted in `product-chat-history.component.spec.ts`, where the live and resumed windows are
     * compared side by side.
     */
    it('KNOWN DEVIATION: a hand-retyped repeat is indistinguishable from a retry, so it is carried once', () => {
      const rows = [
        message({ sequence: 0, role: 'user', text: 'what happened to my run?', failed: true }),
        message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true }),
        ...exchange(2, 'what happened to my run?', 'It finished at 10:04'),
      ];
      const { entries } = hydrateTranscript(rows, context());

      // THE FIXTURE MUST REALLY HOLD THE SECOND ASK, or this is the un-retried case wearing this one's
      // name and asserting the same list: with `exchange()` emptied, the flagged question is emitted
      // for the opposite reason and the assertion below still passes.
      expect(entries.filter(e => e.kind === 'assistant').length)
        .withContext('the answer to the retyped question is what makes this a REPEAT rather than a bare failure')
        .toBe(1);
      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).text))
        .withContext('live a hand-retype holds the question twice; storage cannot say which this was')
        .toEqual(['what happened to my run?']);
    });

    /**
     * KNOWN DEVIATION, PINNED: the text match is not scoped to the book, so an identical question asked
     * in ANOTHER book suppresses the failed one.
     *
     * `retry()` refuses a fault raised in a different book (`product-chat.component.ts`, the
     * `entry.bookId !== this.bookId` guard), so a genuine retry always carries the failure's own book
     * and a cross-book match is always a hand-retype - the deviation above, reached through the books.
     * The direction is the same SUBSET one: viewed from the book the failure was asked in, the resumed
     * window is short by that question, and viewed from the other book both windows agree.
     *
     * Scoping the match by book would close this cell, and it is deliberately NOT done here: it is a
     * fourth narrowing of a derivation that has taken three, and the honest fix for all of them is to
     * record the retry rather than to guess it better.
     */
    it('KNOWN DEVIATION: an identical question asked in ANOTHER book counts as the retry', () => {
      const rows = [
        message({ sequence: 0, role: 'user', text: 'what happened to my run?', failed: true, askBookId: BOOK_A }),
        message({ sequence: 1, role: 'assistant', text: 'I cannot reach the guides.', failed: true, askBookId: BOOK_A }),
        ...exchange(2, 'what happened to my run?', 'It finished at 10:04', BOOK_B),
      ];
      const { entries } = hydrateTranscript(rows, context({ currentBookId: BOOK_A }));

      // The BOOK_A question is gone and only the BOOK_B one survives, which is the deviation stated as
      // a fact rather than as a risk.
      expect(entries.filter(e => e.kind === 'user').map(e => (e as UserEntry).bookId))
        .withContext('the failed question was asked in BOOK_A and is suppressed by a BOOK_B row')
        .toEqual([BOOK_B]);
      // The fault still belongs to the book it was raised in, so a stale retry is still refused there.
      expect((entries[0] as FaultEntry).bookId).toBe(BOOK_A);
    });
  });

  // ── Context-change markers ──────────────────────────────────────────────────────────────────────

  describe('context-change markers', () => {
    it('are RE-DERIVED where the ask-time book changes, not stored as messages', () => {
      // A marker is a rule drawn in the transcript: nobody said it, and it is never sent. Persisting it
      // as a message type would have put a thing nobody said into the message table.
      const rows = [
        ...exchange(0, 'about book A', 'answer A', BOOK_A),
        ...exchange(2, 'about book B', 'answer B', BOOK_B),
      ];
      const { entries } = hydrateTranscript(rows, context({ currentBookId: BOOK_B }));

      expect(entries.map(e => e.kind)).toEqual([
        'user', 'assistant', 'book-marker', 'user', 'assistant',
      ]);
      expect(entries[2]).toEqual(jasmine.objectContaining({ kind: 'book-marker', bookId: BOOK_B }));
    });

    it('draw NO marker before the first turn, however the conversation began', () => {
      // Live, a marker is never written for the first book of an empty transcript: a conversation that
      // opens with "from here on I am looking at X" before a word has been said reads as noise.
      const inBook = hydrateTranscript(exchange(0, 'q', 'a', BOOK_A), context({ currentBookId: BOOK_A }));
      expect(inBook.entries.some(e => e.kind === 'book-marker')).toBeFalse();

      const appLevel = hydrateTranscript(exchange(0, 'q', 'a', null), context());
      expect(appLevel.entries.some(e => e.kind === 'book-marker')).toBeFalse();
    });

    it('mark LEAVING every book as well as entering one', () => {
      const rows = [
        ...exchange(0, 'about the book', 'answer', BOOK_A),
        ...exchange(2, 'a product question', 'answer', null),
      ];
      const { entries } = hydrateTranscript(rows, context());
      const marker = entries.find(e => e.kind === 'book-marker');
      expect(marker).toBeDefined();
      expect(marker).toEqual(jasmine.objectContaining({ bookId: null }));
    });

    it('title the marker only for the book actually open, and leave the rest to the fallback', () => {
      // The list endpoint carries book ids, not titles, so no other book's name is knowable here. A
      // null title renders the marker's own "this book" fallback, which is what a live marker written
      // before its title landed already renders.
      const rows = [
        ...exchange(0, 'q', 'a', BOOK_A),
        ...exchange(2, 'q', 'a', BOOK_B),
      ];
      const named = hydrateTranscript(rows, context({ currentBookId: BOOK_B, currentBookTitle: 'Book B' }));
      expect(named.entries[2]).toEqual(jasmine.objectContaining({ title: 'Book B' }));

      const unnamed = hydrateTranscript(rows, context({ currentBookId: BOOK_A, currentBookTitle: 'Book A' }));
      expect(unnamed.entries[2]).toEqual(jasmine.objectContaining({ title: null }));
    });

    it('draw ONE marker per switch, not one per turn in the new book', () => {
      const rows = [
        ...exchange(0, 'q1', 'a1', BOOK_A),
        ...exchange(2, 'q2', 'a2', BOOK_B),
        ...exchange(4, 'q3', 'a3', BOOK_B),
      ];
      const { entries } = hydrateTranscript(rows, context());
      expect(entries.filter(e => e.kind === 'book-marker').length).toBe(1);
    });

    it('files a failed question with no answer row ABOVE the marker for the book after it, never under it', () => {
      // The fault belongs to BOOK_A, the book it was asked in. If the marker for the switch to BOOK_B
      // were drawn before the held failure is flushed, the fault would render underneath a rule that
      // says "from here on I am looking at BOOK_B" - the one thing that marker exists to deny.
      const rows = [
        ...exchange(0, 'first', 'first answer', BOOK_A),
        message({ sequence: 2, role: 'user', text: 'failed one', failed: true, askBookId: BOOK_A }),
        ...exchange(3, 'q2', 'a2', BOOK_B),
      ];
      const { entries } = hydrateTranscript(rows, context());

      expect(entries.map(e => e.kind)).toEqual([
        'user', 'assistant', 'user', 'fault', 'book-marker', 'user', 'assistant',
      ]);
      const faultIndex = entries.findIndex(e => e.kind === 'fault');
      const markerIndex = entries.findIndex(e => e.kind === 'book-marker');
      expect(faultIndex).toBeLessThan(markerIndex);
      expect((entries[faultIndex] as FaultEntry).bookId).toBe(BOOK_A);
      expect(entries[markerIndex]).toEqual(jasmine.objectContaining({ bookId: BOOK_B }));
    });

    it('draws the marker for a book change on the far side of a LEADING unanswered failure, where it used to be suppressed', () => {
      // Before the failed question is flushed, `entries` is still empty, so the marker's own
      // `entries.length > 0` guard used to see nothing and skip drawing it entirely. Flushing the fault
      // first (this fix) gives that guard the same content a live session already has by the time its
      // book changes: `ask()` and `acceptFault()` push the failed pair synchronously, so
      // `product-chat.component.ts`'s book-change handler always sees `entries.length > 0` there too.
      const rows = [
        message({ sequence: 0, role: 'user', text: 'failed leader', failed: true, askBookId: BOOK_A }),
        ...exchange(1, 'q', 'a', BOOK_B),
      ];
      const { entries } = hydrateTranscript(rows, context());

      expect(entries.map(e => e.kind)).toEqual(['user', 'fault', 'book-marker', 'user', 'assistant']);
      expect(entries[2]).toEqual(jasmine.objectContaining({ kind: 'book-marker', bookId: BOOK_B }));
    });
  });

  // ── Ids ─────────────────────────────────────────────────────────────────────────────────────────

  it('continues the session\'s own id counter and hands back the next free one', () => {
    // Ids are monotonic across the session and never reused, so a restarted counter could collide with
    // the `track` identity of a turn the view is still tearing down.
    const rows = [
      ...exchange(0, 'q1', 'a1', BOOK_A),
      ...exchange(2, 'q2', 'a2', BOOK_B),
    ];
    const { entries, nextId } = hydrateTranscript(rows, context({ firstId: 42 }));

    expect(entries.map(e => e.id)).toEqual([42, 43, 44, 45, 46]);
    expect(nextId).toBe(47);
  });

  // ── The two facts storage does not carry ────────────────────────────────────────────────────────

  describe('the answer\'s direction, which storage has no column for', () => {
    it('reads Hebrew prose as Hebrew and English prose as English', () => {
      const he = hydrateTranscript(
        exchange(0, 'q', 'הפרק נפתח בשיחה בין שתי הדמויות ונמשך אל הסוף'),
        context({ fallbackLanguage: 'en' })
      );
      expect((he.entries[1] as AssistantEntry).language).toBe('he');

      const en = hydrateTranscript(
        exchange(0, 'q', 'The chapter opens on a conversation between two characters'),
        context({ fallbackLanguage: 'he' })
      );
      expect((en.entries[1] as AssistantEntry).language).toBe('en');
    });

    it('falls back to the chrome language when the answer holds no letters at all', () => {
      const { entries } = hydrateTranscript(
        exchange(0, 'q', '123 456 ...'),
        context({ fallbackLanguage: 'en' })
      );
      expect((entries[1] as AssistantEntry).language).toBe('en');
    });
  });

  it('never restores clarify chips: they re-ask against a chapter list that was not stored', () => {
    // Offering chips built from today's chapters would re-ask an old question against a book that has
    // moved on, which is the wrong-chapter fabrication the chips' own guards exist to prevent.
    const rows = exchange(0, 'which chapter?', 'I could not tell', BOOK_A);
    rows[1].grounding = {
      guideIds: [],
      artifactRefs: ['chapter-brief:2'],
      bookFaultReason: 'findings-unreadable',
      needsChapterClarification: true,
      selectionSummary: null,
    };
    const { entries } = hydrateTranscript(rows, context({ currentBookId: BOOK_A }));

    const answer = entries[1] as AssistantEntry;
    expect(answer.clarify).toBeNull();
    // ...but the grounding that IS stored is restored: the chips and the note travel separately.
    expect(answer.artifactRefs.map(r => r.raw)).toEqual(['chapter-brief:2']);
    expect(answer.bookFaultReason).toBe('findings-unreadable');
  });

  it('never restores the per-turn chapter tag, which is a different fact from "a chapter was open"', () => {
    const rows = exchange(0, 'q', 'a', BOOK_A);
    rows[0].askChapterId = 'ch-3';
    rows[0].askChapterOrder = 2;
    const { entries } = hydrateTranscript(rows, context({ currentBookId: BOOK_A }));
    expect((entries[0] as UserEntry).askedAboutChapter).toBeNull();
  });

  it('returns an empty transcript for an empty conversation without inventing anything', () => {
    const { entries, nextId } = hydrateTranscript([], context({ firstId: 7 }));
    expect(entries).toEqual([]);
    expect(nextId).toBe(7);
  });
});
