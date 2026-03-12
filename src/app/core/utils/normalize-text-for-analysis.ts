/**
 * Strip Unicode bidi (bidirectional) control characters and hard line breaks from text so that:
 * - Plain text sent to analysis and used for diffing is consistent between client and server.
 * - Punctuation and word order are not affected by invisible marks that can cause
 *   spurious proofread suggestions (e.g. "original" and "suggested" looking identical).
 *
 * Bidi controls: LRM, RLM, LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069).
 * Newlines: \r and \n are removed so offsets are computed against a flat string, matching the backend.
 */
const NORMALIZE_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\r\n]/g;

/**
 * Normalize plain text for analysis and proofread diff: remove bidi control characters
 * and hard line breaks so the string matches what the API stores and uses for diffing.
 */
export function normalizeTextForAnalysis(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(NORMALIZE_REGEX, '');
}

/** Return true if the character should be ignored for normalized offsets (bidi controls + hard line breaks). */
function isIgnoredForNormalization(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  // Bidi controls
  if (
    code === 0x200e || // LRM
    code === 0x200f || // RLM
    (code >= 0x202a && code <= 0x202e) || // embeddings/overrides
    (code >= 0x2066 && code <= 0x2069) // isolates
  ) {
    return true;
  }
  // Hard line breaks
  return ch === '\n' || ch === '\r';
}

/**
 * Map an offset in normalized (bidi-stripped) text to the corresponding offset in raw text.
 * Used when applying suggestions or selecting range in the document (SFDT is raw).
 */
export function normalizedOffsetToRawOffset(rawText: string, normalizedOffset: number): number {
  let ni = 0;
  for (let ri = 0; ri < rawText.length; ri++) {
    if (ni === normalizedOffset) return ri;
    if (!isIgnoredForNormalization(rawText[ri])) ni++;
  }
  return rawText.length;
}
