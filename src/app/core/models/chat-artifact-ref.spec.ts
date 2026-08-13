/**
 * Book-artifact citation refs: parsing the server's wire vocabulary (chatbot phase B, c2).
 *
 * The strings under test are a CROSS-REPO CONTRACT, produced by one place on the server
 * (`Pagedraft.Api/Services/Chat/BookChatArtifacts.cs`, `BookArtifactRefs`). Casing and separator drift
 * across a stack boundary is a recorded failure class in this codebase, so both are asserted rather
 * than assumed.
 */
import {
  chapterDisplayNumber,
  parseArtifactRef,
  parseArtifactRefs,
} from './chat-artifact-ref';
import { chatArtifactDestination } from './chat-artifact-routing';
import { artifactChipLabel } from '../i18n/chat-strings';
import { chapterDisplayNumber as canonicalChapterDisplayNumber } from '../utils/chapter-number';

describe('parseArtifactRef (chatbot phase B)', () => {
  it('parses every shape the server documents', () => {
    expect(parseArtifactRef('chapter-brief:6')).toEqual(jasmine.objectContaining({
      kind: 'chapter-brief', chapterOrder: 6,
    }));
    expect(parseArtifactRef('chapter-summary:0')).toEqual(jasmine.objectContaining({
      kind: 'chapter-summary', chapterOrder: 0,
    }));
    expect(parseArtifactRef('chapter-text:12')).toEqual(jasmine.objectContaining({
      kind: 'chapter-text', chapterOrder: 12,
    }));
    expect(parseArtifactRef('finding:2f1c8b30-0000-4000-8000-000000000001')).toEqual(
      jasmine.objectContaining({
        kind: 'finding', findingId: '2f1c8b30-0000-4000-8000-000000000001',
      })
    );
    expect(parseArtifactRef('register').kind).toBe('register');
    expect(parseArtifactRef('book-brief').kind).toBe('book-brief');
    expect(parseArtifactRef('history').kind).toBe('history');
    expect(parseArtifactRef('status:summary')).toEqual(jasmine.objectContaining({
      kind: 'status', statusKind: 'summary',
    }));
    expect(parseArtifactRef('status:review').statusKind).toBe('review');
    expect(parseArtifactRef('status:style-baseline').statusKind).toBe('style-baseline');
  });

  it('CHAPTER ORDER 0 is a real order, not a falsy blank', () => {
    // The first chapter is order 0 on the wire. A parser that tested the key for truthiness would drop
    // exactly one chapter's chips, the one an author is likeliest to ask about first.
    const ref = parseArtifactRef('chapter-brief:0');
    expect(ref.kind).toBe('chapter-brief');
    expect(ref.chapterOrder).toBe(0);
  });

  it('matches the TYPE case-insensitively, as the server compares it', () => {
    // `BookArtifactRefs.LooksLikeArtifactRef` compares with OrdinalIgnoreCase, so a build that emitted
    // a different case would still be a valid ref there. Costing one toLowerCase() to be immune is
    // cheaper than a cross-stack casing bug.
    expect(parseArtifactRef('Chapter-Brief:6').kind).toBe('chapter-brief');
    expect(parseArtifactRef('STATUS:REVIEW').statusKind).toBe('review');
  });

  it('leaves a FINDING id untouched, because the ledger is what knows it', () => {
    const id = 'AbC-123-DeF';
    expect(parseArtifactRef(`finding:${id}`).findingId).toBe(id);
  });

  describe('unknown and malformed refs', () => {
    it('come back as kind null, carrying the raw string, never dropped', () => {
      // The chip still renders, unlinked, showing this string. A citation that silently loses an entry
      // deletes the only provenance the author has for that part of the answer.
      for (const raw of ['sudoku:7', 'chapter-brief', 'chapter-brief:', 'register:1', ':7', '']) {
        const ref = parseArtifactRef(raw);
        expect(ref.kind).withContext(raw).toBeNull();
        expect(ref.raw).withContext(raw).toBe(raw);
      }
    });

    it('DEMOTES the whole ref when a chapter key is not a number', () => {
      // Keeping the type and losing the key would render "Chapter NaN" and, worse, could route.
      for (const raw of ['chapter-brief:seven', 'chapter-text:7abc', 'chapter-summary:-1']) {
        expect(parseArtifactRef(raw).kind).withContext(raw).toBeNull();
        expect(parseArtifactRef(raw).chapterOrder).withContext(raw).toBeNull();
      }
    });

    it('DEMOTES an unrecognized status key rather than defaulting to one of the three', () => {
      const ref = parseArtifactRef('status:everything');
      expect(ref.kind).toBeNull();
      expect(ref.statusKind).toBeNull();
    });
  });

  describe('parseArtifactRefs', () => {
    it('tolerates a null or absent field from a phase-A-shaped response', () => {
      expect(parseArtifactRefs(null)).toEqual([]);
      expect(parseArtifactRefs(undefined)).toEqual([]);
      expect(parseArtifactRefs([])).toEqual([]);
    });

    it('keeps order and keeps unknown entries in place', () => {
      const refs = parseArtifactRefs(['status:review', 'sudoku:1', 'register']);
      expect(refs.map(r => r.kind)).toEqual(['status', null, 'register']);
    });
  });
});

describe('chapterDisplayNumber (the 0-based/1-based decision)', () => {
  it('turns the wire order into the number the AUTHOR counts by', () => {
    // Chapter.Order is 0-based server-side; authors count from 1. One conversion, in one place, so a
    // chip's label and its destination can never disagree about which chapter is meant.
    expect(chapterDisplayNumber(0)).toBe(1);
    expect(chapterDisplayNumber(6)).toBe(7);
  });

  it('is the app-wide helper, not a second copy declared beside it', () => {
    // be-c02 found TWO declarations of `order + 1` on the client: this module's own, and the canonical
    // one in `core/utils/chapter-number.ts` that four other surfaces already call. Two copies that agree
    // today are the shape a third convention grows out of, so this module now RE-EXPORTS the canonical
    // one. Identity, not equality: a re-declared twin would pass a value comparison and fail this.
    expect(chapterDisplayNumber)
      .withContext(
        'chat-artifact-ref.ts must RE-EXPORT core/utils/chapter-number, not declare its own ' +
        '`order + 1`. A second copy is how a third chapter-numbering convention gets born.'
      )
      .toBe(canonicalChapterDisplayNumber);
  });
});

/**
 * THE CLIENT HALF OF A CROSS-STACK PAIR (be-c02, review finding #1, the phase-B P0).
 *
 * The server half is `Pagedraft.Api.Tests/ProductChatChapterNumberingTests.cs`, the test
 * `TheWireRefAndTheAuthorsNumber_AgreeAcrossTheStack`.
 *
 * WHY IT IS A PAIR AND NOT ONE TEST. The server is 0-based in every label, ref and heading it shows the
 * model; this client is 1-based in every string it shows the author. Both conventions are deliberate and
 * both are correct, and until this pair existed NOTHING compared them: a live question on a chapter at
 * order 0 produced an answer saying "פרק 0" with a citation chip beneath it in the same card saying
 * "הטקסט של פרק 1". Two green suites and three GPU gates were blind to it.
 *
 * Neither repo can run the other's tests, so the agreement is pinned twice against the SAME literal:
 * `chapter-text:0` is the wire ref for the chapter the author calls chapter 1. THIS half fails if the
 * CLIENT drifts (a display number that stops adding one, a chip label that stops using it, a parser that
 * stops reading the key as the raw order); the SERVER half fails if the server drifts (a ref or label
 * that stops carrying the raw order, or a grounding string that stops telling the model about the
 * offset). Each half must be able to go red on its own, which is why neither restates the other's code.
 */
describe('cross-stack pin (server half: Pagedraft.Api.Tests/ProductChatChapterNumberingTests.cs)', () => {
  /** The one literal both halves are written against. Stated, not derived, on both sides. */
  const WIRE_REF_OF_THE_AUTHORS_FIRST_CHAPTER = 'chapter-text:0';
  const AUTHORS_NUMBER_FOR_WIRE_ORDER_ZERO = 1;

  it('reads the wire key as the RAW 0-based order, so navigation needs no arithmetic', () => {
    const ref = parseArtifactRef(WIRE_REF_OF_THE_AUTHORS_FIRST_CHAPTER);
    expect(ref.kind).toBe('chapter-text');
    expect(ref.chapterOrder).toBe(0);
  });

  it('renders that same chapter to the AUTHOR as chapter 1, in both languages', () => {
    const ref = parseArtifactRef(WIRE_REF_OF_THE_AUTHORS_FIRST_CHAPTER);

    expect(chapterDisplayNumber(ref.chapterOrder!)).toBe(AUTHORS_NUMBER_FOR_WIRE_ORDER_ZERO);
    expect(artifactChipLabel('he', ref)).toContain(String(AUTHORS_NUMBER_FOR_WIRE_ORDER_ZERO));
    expect(artifactChipLabel('en', ref)).toContain(String(AUTHORS_NUMBER_FOR_WIRE_ORDER_ZERO));

    // And the raw wire order is NOT what the author is shown. This is the assertion whose absence let
    // the P0 ship: "0" reaching a chip label is the client half of the two-numbers-in-one-card defect.
    expect(artifactChipLabel('he', ref)).not.toContain('0');
    expect(artifactChipLabel('en', ref)).not.toContain('0');
  });

  it('sends the author to the 0-based order it parsed, not to the number it displayed', () => {
    const ref = parseArtifactRef(WIRE_REF_OF_THE_AUTHORS_FIRST_CHAPTER);
    const destination = chatArtifactDestination(ref, 'a1111111-1111-1111-1111-111111111111');

    // The label and the destination are ALLOWED to differ, and here they must: the URL is machine-facing
    // and mirrors the wire, the label is the only thing a human reads. That split is the whole decision.
    expect(destination!.queryParams['chapter']).toBe(0);
  });
});
