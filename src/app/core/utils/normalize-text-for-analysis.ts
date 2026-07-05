/**
 * Normalize plain text for analysis and proofread diff so that offsets/diffs are consistent
 * between client and server:
 * - Bidi (bidirectional) control characters are DROPPED (they are truly invisible and can cause
 *   spurious proofread suggestions where "original" and "suggested" look identical).
 * - Hard line breaks (\r, \n) are replaced 1:1 with a single SPACE — a line break is a word
 *   boundary, so dropping it glued the chapter title into the first body word
 *   ("רוני\nהתעוררתי" -> "רוניהתעוררתי"), which the model then "fixed" by deleting a word.
 *   Replacing each break with a space (a CRLF becomes two spaces) keeps character-length parity
 *   so offset mapping stays a simple 1:1 walk, and matches the backend NormalizeTextForAnalysis.
 *
 * Bidi controls: LRM, RLM, LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069).
 */
const BIDI_CONTROL_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const LINE_BREAK_REGEX = /[\r\n]/g;

/**
 * Normalize plain text for analysis and proofread diff: drop bidi control characters and
 * replace hard line breaks with a single space so the string matches what the API stores
 * and uses for diffing.
 */
export function normalizeTextForAnalysis(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(BIDI_CONTROL_REGEX, '').replace(LINE_BREAK_REGEX, ' ');
}

/**
 * Return true if the character is DROPPED during normalization (so its raw position has no
 * normalized counterpart). Only bidi controls are dropped. Hard line breaks are NOT ignored:
 * they now map 1:1 to a space, so they occupy a normalized position like any other character.
 */
function isIgnoredForNormalization(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return (
    code === 0x200e || // LRM
    code === 0x200f || // RLM
    (code >= 0x202a && code <= 0x202e) || // embeddings/overrides
    (code >= 0x2066 && code <= 0x2069) // isolates
  );
}

/**
 * Map an offset in normalized text to the corresponding offset in raw text.
 * Used when applying suggestions or selecting a range in the document (SFDT is raw).
 *
 * Because line breaks now map 1:1 to a space (they are no longer dropped), only bidi controls
 * are skipped: a normalized offset counts every raw character except dropped bidi controls, so
 * a word AFTER a line break resolves to its correct raw index.
 */
export function normalizedOffsetToRawOffset(rawText: string, normalizedOffset: number): number {
  let ni = 0;
  for (let ri = 0; ri < rawText.length; ri++) {
    const ch = rawText[ri];
    if (isIgnoredForNormalization(ch)) {
      continue;
    }
    if (ni === normalizedOffset) {
      return ri;
    }
    ni++;
  }
  return rawText.length;
}
