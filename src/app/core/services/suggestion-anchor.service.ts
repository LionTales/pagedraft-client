import { Injectable } from '@angular/core';
import { AnalysisSuggestion } from '../models/analysis';
import { normalizeTextForAnalysis } from '../utils/normalize-text-for-analysis';

export type RelocatedSuggestion = AnalysisSuggestion & {
  relocatedStart: number;
  relocatedEnd: number;
  stale: boolean;
};

const CONTEXT_WINDOW = 60;

@Injectable({ providedIn: 'root' })
export class SuggestionAnchorService {

  relocateAll(suggestions: AnalysisSuggestion[], currentText: string): RelocatedSuggestion[] {
    return suggestions.map(s => this.relocateOne(s, currentText));
  }

  relocateOne(suggestion: AnalysisSuggestion, currentText: string): RelocatedSuggestion {
    const needle = normalizeTextForAnalysis(suggestion.original);
    if (!needle) {
      return { ...suggestion, relocatedStart: suggestion.startOffset ?? 0, relocatedEnd: suggestion.endOffset ?? 0, stale: true };
    }

    const start = suggestion.startOffset ?? 0;
    const end = suggestion.endOffset ?? start + needle.length;

    if (currentText.slice(start, end) === needle) {
      return { ...suggestion, relocatedStart: start, relocatedEnd: end, stale: false };
    }

    const matches = this.findAllOccurrences(currentText, needle);

    if (matches.length === 1) {
      return { ...suggestion, relocatedStart: matches[0], relocatedEnd: matches[0] + needle.length, stale: false };
    }

    if (matches.length > 1 && (suggestion.contextBefore || suggestion.contextAfter)) {
      const best = this.pickBestMatch(matches, needle.length, currentText, suggestion);
      if (best != null) {
        return { ...suggestion, relocatedStart: best, relocatedEnd: best + needle.length, stale: false };
      }
      // Multiple occurrences exist but none match the provided context; treat as
      // stale instead of anchoring to an arbitrary occurrence.
      return { ...suggestion, relocatedStart: start, relocatedEnd: end, stale: true };
    }

    return { ...suggestion, relocatedStart: start, relocatedEnd: end, stale: true };
  }

  private findAllOccurrences(text: string, needle: string): number[] {
    const positions: number[] = [];
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      positions.push(idx);
      idx = text.indexOf(needle, idx + 1);
    }
    return positions;
  }

  private pickBestMatch(
    positions: number[],
    needleLen: number,
    currentText: string,
    suggestion: AnalysisSuggestion
  ): number | null {
    let bestPos = positions[0];
    let bestScore = -Infinity;

    for (const pos of positions) {
      let score = 0;

      if (suggestion.contextBefore) {
        const windowStart = Math.max(0, pos - CONTEXT_WINDOW);
        const before = currentText.slice(windowStart, pos);
        if (before.includes(suggestion.contextBefore)) {
          score += 2;
        }
      }

      if (suggestion.contextAfter) {
        const afterStart = pos + needleLen;
        const afterEnd = Math.min(currentText.length, afterStart + CONTEXT_WINDOW);
        const after = currentText.slice(afterStart, afterEnd);
        if (after.includes(suggestion.contextAfter)) {
          score += 2;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }

    // If none of the occurrences matched any context (score never rose above 0),
    // treat the suggestion as ambiguous instead of anchoring it to an arbitrary
    // position. This is consistent with the behavior when there is no context
    // at all (multiple matches without context → stale).
    if (bestScore <= 0) {
      return null;
    }

    return bestPos;
  }
}
