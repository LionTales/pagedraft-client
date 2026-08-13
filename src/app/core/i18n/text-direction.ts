/**
 * PER-BLOCK TEXT DIRECTION for mixed-language prose (chatbot phase B, c2).
 *
 * ── The problem, stated precisely ─────────────────────────────────────────────────────────────────
 * The assistant's chrome is app-level and Hebrew-default, and its ANSWER direction comes from the
 * server's `language` field. But a book-aware answer QUOTES the manuscript, and the manuscript is in
 * the book's language, which need not be the answer's: a Hebrew drawer quoting an English chapter
 * brief, and an English drawer quoting a Hebrew one, are both ordinary. The Unicode bidi algorithm
 * already handles a foreign RUN inside a sentence correctly; what it cannot fix is a whole PARAGRAPH
 * laid out at the surrounding paragraph direction, where the alignment goes to the wrong edge and any
 * leading or trailing punctuation lands on the wrong end of the line.
 *
 * ── Why not `dir="auto"` on every block ───────────────────────────────────────────────────────────
 * `dir="auto"` resolves from the FIRST STRONG CHARACTER, which is wrong often enough to matter here: a
 * Hebrew paragraph that opens with "PageDraft" would flip the whole paragraph to LTR, and product names
 * and chapter refs open sentences constantly on this surface. Resolving by which script the block is
 * mostly WRITTEN IN is immune to that, and it is what a reader would say the block's language is.
 *
 * ── Why not on the whole answer ───────────────────────────────────────────────────────────────────
 * Because the answer is genuinely in the answer's language; only the quoted blocks inside it are not.
 * Directions are decided per block for exactly that reason, which is also what the todo asks for.
 *
 * This module is PURE and has no Angular dependency, so it is testable on its own and reusable by any
 * surface that renders mixed-language prose.
 */

/** The two writing directions this app renders in. */
export type TextDirection = 'rtl' | 'ltr';

// Hebrew and Arabic, by Unicode SCRIPT property rather than by hand-written code-point ranges: a
// range of RTL characters spelled literally in an LTR source file is itself laid out by the bidi
// algorithm, so what a reviewer SEES is not the order the parser reads and a wrong range can look right.
const RTL_RE = /[\p{Script=Hebrew}\p{Script=Arabic}]/gu;

// Any letter, in any script. Subtracting the RTL count from this gives the LTR-strong count without
// enumerating every Latin/Cyrillic/Greek range by hand.
const LETTER_RE = /\p{L}/gu;

/**
 * The direction a block of text is mostly written in, or null when it has no letters at all.
 *
 * Null is a real answer and not a failure: a block of pure digits, punctuation or whitespace has no
 * direction of its own and MUST inherit its surroundings rather than be forced either way. A caller
 * that treated null as LTR would flip "2026-08-12" out of a Hebrew paragraph.
 */
export function dominantDirection(text: string | null | undefined): TextDirection | null {
  if (!text) return null;

  const letters = (text.match(LETTER_RE) ?? []).length;
  if (letters === 0) return null;

  const rtl = (text.match(RTL_RE) ?? []).length;
  // A strict majority, with the tie going to LTR only because a genuine 50/50 letter split does not
  // occur in the prose this renders; the branch exists so the function is total, not because the case
  // is meaningful.
  return rtl * 2 > letters ? 'rtl' : 'ltr';
}

/**
 * The `dir` a block needs GIVEN the direction it already sits in, or null when it needs none.
 *
 * Returning null for "same as the surroundings" is the point: a block that agrees with its context
 * gets NO attribute, so the rendered output only ever carries a `dir` where it actually changes
 * something. That keeps the markup honest about where a direction switch happens and makes the
 * mixed-direction case visible in a DOM assertion instead of being spread over every element.
 */
export function blockDirection(
  text: string | null | undefined,
  base: TextDirection
): TextDirection | null {
  const own = dominantDirection(text);
  return own && own !== base ? own : null;
}
