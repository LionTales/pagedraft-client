/**
 * Strip Unicode bidi (bidirectional) control characters from text so that:
 * - Plain text sent to analysis and used for diffing is consistent between client and server.
 * - Punctuation and word order are not affected by invisible marks that can cause
 *   spurious proofread suggestions (e.g. "original" and "suggested" looking identical).
 *
 * Covers: LRM, RLM, LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069).
 */
const BIDI_CONTROL_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Normalize plain text for analysis and proofread diff: remove bidi control characters
 * so the string matches what the API stores and sends to the model, avoiding punctuation
 * and "identical" suggestion issues with RTL/Hebrew.
 */
export function normalizeTextForAnalysis(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(BIDI_CONTROL_REGEX, '');
}

/** Return true if the character is a Unicode bidi control character. */
function isBidiControlChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/**
 * Map an offset in normalized (bidi-stripped) text to the corresponding offset in raw text.
 * Used when applying suggestions or selecting range in the document (SFDT is raw).
 */
export function normalizedOffsetToRawOffset(rawText: string, normalizedOffset: number): number {
  let ni = 0;
  for (let ri = 0; ri < rawText.length; ri++) {
    if (ni === normalizedOffset) return ri;
    if (!isBidiControlChar(rawText[ri])) ni++;
  }
  return rawText.length;
}
