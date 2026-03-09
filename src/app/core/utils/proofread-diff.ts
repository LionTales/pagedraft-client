import DiffMatchPatch from 'diff-match-patch';
import { AnalysisSuggestion } from '../models/analysis';
import { normalizeTextForAnalysis } from './normalize-text-for-analysis';

const DIFF_DELETE = -1;
const DIFF_INSERT = 1;
const DIFF_EQUAL = 0;

/** Matches any Unicode letter or digit (works for Hebrew, English, etc.). */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Fragment for inline diff display: equal (neutral), delete (red in original), insert (green in suggested). */
export interface DiffFragment {
  text: string;
  type: 'equal' | 'delete' | 'insert';
}

/**
 * Returns fragments to render original and suggested text with only the changed parts colored.
 * Use in suggestion card so the whole suggested block isn't painted green.
 */
export function getSuggestionDiffFragments(original: string, suggested: string): {
  originalFragments: DiffFragment[];
  suggestedFragments: DiffFragment[];
} {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(original, suggested);
  dmp.diff_cleanupSemantic(diffs);

  const originalFragments: DiffFragment[] = [];
  const suggestedFragments: DiffFragment[] = [];
  for (const [op, text] of diffs) {
    if (op === DIFF_EQUAL) {
      if (text.length) {
        originalFragments.push({ text, type: 'equal' });
        suggestedFragments.push({ text, type: 'equal' });
      }
    } else if (op === DIFF_DELETE) {
      if (text.length) originalFragments.push({ text, type: 'delete' });
    } else if (op === DIFF_INSERT) {
      if (text.length) suggestedFragments.push({ text, type: 'insert' });
    }
  }
  return { originalFragments, suggestedFragments };
}

/**
 * Expand a suggestion's boundaries to the nearest word boundaries in the
 * original text. Gives context (e.g. "sunbeam" → "sunbeams." instead of
 * "" → "s.") and makes the "Show in document" selection span the whole word.
 */
function expandToWordBoundaries(
  originalText: string,
  suggestion: AnalysisSuggestion
): AnalysisSuggestion {
  let startOffset = suggestion.startOffset;
  let endOffset = suggestion.endOffset;
  if (startOffset == null || endOffset == null) return suggestion;

  const origStart = startOffset;
  const origEnd = endOffset;

  while (startOffset > 0 && WORD_CHAR.test(originalText[startOffset - 1])) {
    startOffset--;
  }
  while (endOffset < originalText.length && WORD_CHAR.test(originalText[endOffset])) {
    endOffset++;
  }

  if (startOffset === origStart && endOffset === origEnd) return suggestion;

  const expandedOriginal = originalText.slice(startOffset, endOffset);
  const prefix = originalText.slice(startOffset, origStart);
  const suffix = originalText.slice(origEnd, endOffset);
  const expandedSuggested = prefix + suggestion.suggested + suffix;

  if (expandedOriginal === expandedSuggested) return suggestion;

  return {
    ...suggestion,
    startOffset,
    endOffset,
    original: expandedOriginal,
    suggested: expandedSuggested,
  };
}

/**
 * Compute replacements (suggestions) by diffing original document text with Proofread resultText.
 * Uses diff-match-patch. Offsets are in the original document text so Accept can apply correctly.
 * Suggestions are expanded to word boundaries for readable context.
 * Normalizes both strings (strip bidi control chars) so RTL/Hebrew punctuation doesn't produce spurious diffs.
 * Filters out no-op suggestions where original === suggested.
 */
export function proofreadDiff(originalText: string, resultText: string): AnalysisSuggestion[] {
  const normalizedOriginal = normalizeTextForAnalysis(originalText);
  const normalizedResult = normalizeTextForAnalysis(resultText);

  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(normalizedOriginal, normalizedResult);
  dmp.diff_cleanupSemantic(diffs);

  const raw: AnalysisSuggestion[] = [];
  let offset = 0;

  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i];
    if (op === DIFF_EQUAL) {
      offset += text.length;
      continue;
    }
    if (op === DIFF_DELETE) {
      const startOffset = offset;
      const original = text;
      offset += text.length;
      let suggested = '';
      if (i + 1 < diffs.length && diffs[i + 1][0] === DIFF_INSERT) {
        suggested = diffs[i + 1][1];
        i++; // consume INSERT
      }
      raw.push({
        startOffset,
        endOffset: startOffset + original.length,
        original,
        suggested,
        reason: 'Proofread'
      });
    } else if (op === DIFF_INSERT) {
      raw.push({
        startOffset: offset,
        endOffset: offset,
        original: '',
        suggested: text,
        reason: 'Proofread'
      });
    }
  }

  const expanded = raw.map(s => expandToWordBoundaries(normalizedOriginal, s));
  // Hide no-op and whitespace-only suggestions so the list doesn't show "add/remove space" that can break RTL
  return expanded.filter(s => {
    if (s.original === s.suggested) return false;
    const o = s.original.trim();
    const g = s.suggested.trim();
    if (o === g) return false; // only whitespace changed (e.g. "הוא" vs " הוא")
    return true;
  });
}
