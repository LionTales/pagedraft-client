import { Injectable } from '@angular/core';
import { AnalysisResultDto, AnalysisSuggestion } from '../models/analysis';
import { normalizeTextForAnalysis } from '../utils/normalize-text-for-analysis';

export interface ParsedLineEdit {
  suggestions: Array<{
    original: string;
    suggested: string;
    reason: string;
    category: string;
  }>;
  overallFeedback: string;
}

@Injectable({ providedIn: 'root' })
export class LineEditParserService {
  private readonly loggedLineEditDiagnostics = new Set<string>();

  getLineEdit(current: AnalysisResultDto): ParsedLineEdit | null {
    if ((current.analysisType || current.type) !== 'LineEdit') return null;
    const raw = current.structuredResult || current.resultText || '';
    if (!raw.trim()) return null;

    try {
      const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(cleaned) as Record<string, unknown>;
      } catch (primaryError) {
        const parseFailKey = this.lineEditDiagnosticKey(current.id, 'parse-fail');
        if (!this.loggedLineEditDiagnostics.has(parseFailKey)) {
          this.loggedLineEditDiagnostics.add(parseFailKey);
          console.warn(
            '[LineEdit] JSON.parse failed on cleaned payload before salvage',
            primaryError,
            {
              cleanedLength: cleaned.length,
              cleanedPreview: cleaned.substring(0, 300),
              rawPreview: raw.substring(0, 300)
            }
          );
        }

        const salvaged = this.trySalvageTruncatedLineEditJson(current.id, cleaned);
        if (!salvaged) {
          throw primaryError;
        }
        const salvageOkKey = this.lineEditDiagnosticKey(current.id, 'salvage-ok');
        if (!this.loggedLineEditDiagnostics.has(salvageOkKey)) {
          this.loggedLineEditDiagnostics.add(salvageOkKey);
          console.info('[LineEdit] Salvage attempt succeeded, retrying JSON.parse with repaired payload', {
            originalLength: cleaned.length,
            salvagedLength: salvaged.length
          });
        }
        data = JSON.parse(salvaged) as Record<string, unknown>;
      }

      const suggestions = data['suggestions'];
      if (!Array.isArray(suggestions)) return null;

      return {
        suggestions: suggestions.map((s: Record<string, unknown>) => ({
          original: String(s?.['original'] ?? ''),
          suggested: String(s?.['suggested'] ?? ''),
          reason: String(s?.['reason'] ?? ''),
          category: String(s?.['category'] ?? '')
        })),
        overallFeedback: String(data['overallFeedback'] ?? '')
      };
    } catch (e) {
      const parseErrorKey = this.lineEditDiagnosticKey(current.id, 'parse-error');
      if (!this.loggedLineEditDiagnostics.has(parseErrorKey)) {
        this.loggedLineEditDiagnostics.add(parseErrorKey);
        console.warn(
          '[LineEdit] Failed to parse structured result',
          e,
          {
            structuredResult: current.structuredResult ? current.structuredResult.substring(0, 200) : undefined,
            resultText: current.resultText ? current.resultText.substring(0, 200) : undefined
          }
        );
      }
      return null;
    }
  }

  toLineEditSuggestionsWithOffsets(
    suggestions: Array<{ original: string; suggested: string; reason: string; category: string }>,
    documentText: string | null
  ): AnalysisSuggestion[] {
    const normalizedDoc = documentText != null ? normalizeTextForAnalysis(documentText) : null;
    let searchFromIndex = 0;
    return suggestions.map(s => {
      const suggestion: AnalysisSuggestion = { ...s };
      if (normalizedDoc) {
        const normalizedOriginal = normalizeTextForAnalysis(s.original || '');
        if (normalizedOriginal) {
          const idx = normalizedDoc.indexOf(normalizedOriginal, searchFromIndex);
          if (idx >= 0) {
            suggestion.startOffset = idx;
            suggestion.endOffset = idx + normalizedOriginal.length;
            searchFromIndex = suggestion.endOffset;
          }
        }
      }
      return suggestion;
    });
  }

  recomputeLineEditOffsets(
    suggestions: AnalysisSuggestion[],
    documentText: string | null
  ): { suggestions: AnalysisSuggestion[]; changed: boolean } {
    const normalizedDoc = documentText != null ? normalizeTextForAnalysis(documentText) : null;
    if (!normalizedDoc) {
      return { suggestions, changed: false };
    }

    let changed = false;
    let searchFromIndex = 0;
    const updated = suggestions.map(s => {
      if (s.startOffset != null && s.endOffset != null) {
        searchFromIndex = s.endOffset;
        return s;
      }
      const normalizedOriginal = normalizeTextForAnalysis(s.original || '');
      if (!normalizedOriginal) {
        return s;
      }
      const idx = normalizedDoc.indexOf(normalizedOriginal, searchFromIndex);
      if (idx >= 0) {
        changed = true;
        const endOffset = idx + normalizedOriginal.length;
        searchFromIndex = endOffset;
        return {
          ...s,
          startOffset: idx,
          endOffset
        };
      }
      return s;
    });

    return { suggestions: changed ? updated : suggestions, changed };
  }

  private lineEditDiagnosticKey(resultId: string | null | undefined, type: string): string {
    const id = (resultId || '').toLowerCase() || 'unknown';
    return `${id}:${type}`;
  }

  /**
   * Finds the index of a JSON object key in raw JSON text, only when the key is not inside a string value.
   * Returns the index of the opening quote of the key, or -1.
   */
  private indexOfJsonKey(raw: string, keyName: string): number {
    const keyPattern = `"${keyName}"`;
    let i = 0;
    let inString = false;
    let escape = false;
    while (i <= raw.length - keyPattern.length) {
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (raw[i] === '\\' && inString) {
        escape = true;
        i++;
        continue;
      }
      if (raw[i] === '"') {
        if (!inString && raw.substring(i, i + keyPattern.length) === keyPattern) {
          let j = i + keyPattern.length;
          while (j < raw.length && /\s/.test(raw[j])) j++;
          if (j < raw.length && raw[j] === ':') return i;
        }
        inString = !inString;
        i++;
        continue;
      }
      if (inString) {
        i++;
        continue;
      }
      i++;
    }
    return -1;
  }

  /**
   * Finds the index of the '[' that starts the array value of the key whose opening quote is at keyIndex.
   */
  private indexOfArrayStartAfterKey(raw: string, keyIndex: number): number {
    const keyEnd = raw.indexOf('"', keyIndex + 1) + 1;
    let i = keyEnd;
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length || raw[i] !== ':') return -1;
    i++;
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (i >= raw.length || raw[i] !== '[') return -1;
    return i;
  }

  private trySalvageTruncatedLineEditJson(resultId: string | null | undefined, raw: string): string | null {
    const keyIndex = this.indexOfJsonKey(raw, 'suggestions');
    if (keyIndex === -1) {
      const key = this.lineEditDiagnosticKey(resultId, 'salvage-no-suggestions-key');
      if (!this.loggedLineEditDiagnostics.has(key)) {
        this.loggedLineEditDiagnostics.add(key);
        console.info('[LineEdit] Salvage: no "suggestions" key found in payload; skipping salvage.');
      }
      return null;
    }

    const arrayStart = this.indexOfArrayStartAfterKey(raw, keyIndex);
    if (arrayStart === -1) {
      const key = this.lineEditDiagnosticKey(resultId, 'salvage-no-array');
      if (!this.loggedLineEditDiagnostics.has(key)) {
        this.loggedLineEditDiagnostics.add(key);
        console.info('[LineEdit] Salvage: no suggestions array "[" found after key; skipping salvage.');
      }
      return null;
    }

    let inString = false;
    let escape = false;
    let depthCurly = 0;
    let depthSquare = 0;
    let lastObjectEnd = -1;

    for (let i = arrayStart; i < raw.length; i++) {
      const c = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\' && inString) {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === '[') {
        depthSquare++;
      } else if (c === ']') {
        depthSquare--;
      } else if (c === '{') {
        depthCurly++;
      } else if (c === '}') {
        depthCurly--;
        if (depthSquare === 1 && depthCurly === 0) {
          lastObjectEnd = i;
        }
      }
    }

    if (lastObjectEnd === -1) {
      const key = this.lineEditDiagnosticKey(resultId, 'salvage-no-closed-objects');
      if (!this.loggedLineEditDiagnostics.has(key)) {
        this.loggedLineEditDiagnostics.add(key);
        console.info('[LineEdit] Salvage: no fully closed suggestion objects found; skipping salvage.', {
          rawLength: raw.length
        });
      }
      return null;
    }

    const head = raw.slice(0, arrayStart + 1);
    const body = raw.slice(arrayStart + 1, lastObjectEnd + 1);

    // Assumes ParsedLineEdit schema: single top-level object with "suggestions" array and "overallFeedback".
    // Closing with ]} is valid only for this flat shape; nested objects/arrays would need more brackets.
    const repairKey = this.lineEditDiagnosticKey(resultId, 'salvage-repair');
    if (!this.loggedLineEditDiagnostics.has(repairKey)) {
      this.loggedLineEditDiagnostics.add(repairKey);
      console.info('[LineEdit] Salvage: repairing truncated LineEdit JSON', {
        rawLength: raw.length,
        arrayStart,
        lastObjectEnd,
        keptChars: body.length
      });
    }

    return `${head}${body}]} `;
  }
}

