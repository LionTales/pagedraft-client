import { Injectable } from '@angular/core';
import { normalizeTextForAnalysis, normalizedOffsetToRawOffset } from '../utils/normalize-text-for-analysis';
import { BLOCK_SEPARATOR } from '../utils/sfdt-text';

/** Convert a suggestion UUID to a Syncfusion-safe bookmark name (letters, digits, underscores only). */
export function suggestionBookmarkName(suggestionId: string): string {
  return 'sg_' + suggestionId.replace(/-/g, '_');
}

/** Prefix used by suggestionBookmarkName — kept in sync for cleanup matching. */
export const SUGGESTION_BOOKMARK_PREFIX = 'sg_';

/**
 * Stateless service for all SFDT (Syncfusion Document Text) JSON parsing and
 * manipulation: highlight application/stripping, plain-text extraction, offset
 * mapping, RTL enforcement, and bookmark management.
 *
 * Every method is a pure function of its arguments — no Angular component state.
 */
@Injectable({ providedIn: 'root' })
export class SfdtManipulationService {

  /**
   * Ensure all paragraphs and inlines in SFDT have bidi: true so RTL punctuation
   * and layout render correctly.
   */
  ensureSfdtRtl(sfdtString: string, isRtl: boolean): string {
    if (!isRtl) return sfdtString;
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const pf = block['paragraphFormat'] ?? block['pf'];
          if (pf && typeof pf === 'object') {
            (pf as Record<string, unknown>)['bidi'] = true;
          }
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          for (const inline of inlines) {
            const cf = inline['characterFormat'] ?? inline['cf'];
            if (cf && typeof cf === 'object') {
              (cf as Record<string, unknown>)['bidi'] = true;
            }
          }
        }
      }
      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

  /**
   * Apply Yellow highlight to the given plain-text character ranges in the SFDT.
   * Uses the same key convention as the serialized document (standard or Syncfusion v32 optimized).
   */
  applyHighlightRangesToSfdt(
    sfdtString: string,
    ranges: { suggestionId?: string; startOffset: number; endOffset: number }[]
  ): string {
    if (ranges.length === 0) return sfdtString;
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      let running = 0;

      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          const newInlines: Record<string, unknown>[] = [];
          const inlinesKey = block['inlines'] != null ? 'inlines' : 'i';
          const textKey = this.detectTextKey(inlines);
          const cfKey = this.detectCharacterFormatKey(inlines);

          for (const inline of inlines) {
            const text = inline['text'] ?? inline['tlp'];
            if (typeof text !== 'string') {
              newInlines.push({ ...inline });
              continue;
            }
            const normLen = normalizeTextForAnalysis(text).length;
            const blockStart = running;
            const blockEnd = running + normLen;
            running = blockEnd;

            const spans = this.getHighlightSpansInRange(blockStart, blockEnd, ranges);
            if (spans.length === 0) {
              newInlines.push(this.inlineWithoutHighlight(inline, cfKey));
              continue;
            }

            let posRaw = 0;
            for (const span of spans) {
              const spanStart = span.start;
              const spanEnd = span.end;
              const bookmarkName = span.suggestionId ? suggestionBookmarkName(span.suggestionId) : undefined;
              const isFirstPart = spanStart === span.fullStart;
              const isLastPart = spanEnd === span.fullEnd;
              const startNormInInline = spanStart - blockStart;
              const endNormInInline = spanEnd - blockStart;
              const startRaw = normalizedOffsetToRawOffset(text, startNormInInline);
              const endRaw = normalizedOffsetToRawOffset(text, endNormInInline);
              if (startRaw > posRaw) {
                newInlines.push(this.createInlineForHighlight(text.slice(posRaw, startRaw), inline, false, textKey, cfKey));
              }
              // Clamp to posRaw so overlapping spans (e.g. from offset adjustment) don't duplicate text
              const startOutput = Math.max(startRaw, posRaw);
              if (startOutput < endRaw) {
                if (bookmarkName && isFirstPart) {
                  newInlines.push(this.createBookmarkInline(inline, bookmarkName, true, cfKey));
                }
                newInlines.push(this.createInlineForHighlight(text.slice(startOutput, endRaw), inline, true, textKey, cfKey));
                if (bookmarkName && isLastPart) {
                  newInlines.push(this.createBookmarkInline(inline, bookmarkName, false, cfKey));
                }
              }
              posRaw = Math.max(posRaw, endRaw);
            }
            if (posRaw < text.length) {
              newInlines.push(this.createInlineForHighlight(text.slice(posRaw), inline, false, textKey, cfKey));
            }
          }
          running += BLOCK_SEPARATOR.length;
          block[inlinesKey] = newInlines;
        }
      }

      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

  /**
   * Remove all highlight formatting from SFDT JSON so saved document does not
   * persist suggestion highlights. Handles both standard keys and Syncfusion v32
   * optimized keys.
   *
   * Also strips suggestion bookmarks (sg_*), removing dedicated bookmark-only
   * inlines so the saved document does not retain navigation markers.
   */
  stripHighlightFromSfdt(sfdtString: string): string {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          const inlinesKey = block['inlines'] != null ? 'inlines' : 'i';
          const textKey = this.detectTextKey(inlines);
          const cfKey = this.detectCharacterFormatKey(inlines);
          const cleaned: Record<string, unknown>[] = [];
          for (const inline of inlines) {
            const cf = inline['characterFormat'] ?? inline['cf'];
            if (cf && typeof cf === 'object') {
              const fmt = cf as Record<string, unknown>;
              delete fmt['highlightColor'];
              delete fmt['hc'];
            }
            const name = inline['name'] ?? inline['n'];
            const bookmarkType = inline['bookmarkType'] ?? inline['bkt'];
            const isSuggestionBookmark =
              typeof name === 'string' &&
              (name.startsWith(SUGGESTION_BOOKMARK_PREFIX) || name.startsWith('suggestion-')) &&
              (bookmarkType === 0 || bookmarkType === 1);
            if (!isSuggestionBookmark) {
              cleaned.push(inline);
            }
          }
          block[inlinesKey] = this.mergeAdjacentTextInlines(cleaned, textKey, cfKey);
        }
      }
      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

  /**
   * Replace the document's plain text with newPlainText inside the existing SFDT
   * structure. Preserves sections/blocks and key format (standard or optimized).
   * Strips highlights. When replaceStartOffset/replaceEndOffset/replaceTextLength
   * are provided (range replace), computes new block boundaries so segments stay
   * aligned after length-changing edits.
   */
  replacePlainTextInSfdt(
    sfdtString: string,
    newPlainText: string,
    isRtl: boolean,
    replaceStartOffset?: number,
    replaceEndOffset?: number,
    replaceTextLength?: number
  ): string {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;

      const blockLengths: number[] = [];
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          let raw = '';
          for (const inline of inlines) {
            const t = inline['text'] ?? inline['tlp'];
            if (typeof t === 'string') raw += t;
          }
          blockLengths.push(normalizeTextForAnalysis(raw).length);
        }
      }

      let segments: string[];
      const hasReplaceRange =
        replaceStartOffset != null && replaceEndOffset != null && replaceTextLength != null;

      if (hasReplaceRange && blockLengths.length > 0) {
        const offsetDelta = replaceTextLength - (replaceEndOffset - replaceStartOffset);
        let running = 0;
        const newEnds: number[] = [];
        let lastEnd = 0;
        for (const len of blockLengths) {
          const blockStart = running;
          const blockEnd = running + len;
          running = blockEnd + BLOCK_SEPARATOR.length;

          let candidateEnd: number;
          if (blockEnd <= replaceStartOffset) {
            candidateEnd = blockEnd;
          } else if (blockStart >= replaceEndOffset) {
            candidateEnd = blockEnd + offsetDelta;
          } else if (blockEnd <= replaceEndOffset) {
            candidateEnd = replaceStartOffset + replaceTextLength;
          } else {
            candidateEnd = replaceStartOffset + replaceTextLength + (blockEnd - replaceEndOffset);
          }

          // Ensure segment boundaries are monotonically increasing so slice(prev, end) is well-formed.
          const end = Math.max(candidateEnd, lastEnd);
          newEnds.push(end);
          lastEnd = end;
        }
        segments = [];
        let prev = 0;
        for (let i = 0; i < newEnds.length; i++) {
          const end = newEnds[i];
          if (i === newEnds.length - 1) {
            segments.push(newPlainText.slice(prev));
          } else {
            segments.push(newPlainText.slice(prev, end));
            prev = end + BLOCK_SEPARATOR.length;
          }
        }
      } else {
        segments = [];
        let pos = 0;
        if (blockLengths.length === 0) {
          segments.push(newPlainText);
        } else {
          for (let i = 0; i < blockLengths.length; i++) {
            const len = blockLengths[i];
            if (i === blockLengths.length - 1) {
              segments.push(newPlainText.slice(pos));
            } else {
              segments.push(newPlainText.slice(pos, pos + len));
              pos += len + BLOCK_SEPARATOR.length;
            }
          }
        }
      }

      let segIdx = 0;
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          const inlinesKey = block['inlines'] != null ? 'inlines' : 'i';
          const textKey = this.detectTextKey(inlines);
          const cfKey = this.detectCharacterFormatKey(inlines);
          const segment = segments[segIdx++] ?? '';
          let template = inlines[0] ?? {};
          if (inlines.length > 1) {
            let best = template;
            let bestLen = this.getInlineTextLength(best);
            for (const cand of inlines) {
              const len = this.getInlineTextLength(cand);
              if (len > bestLen) {
                best = cand;
                bestLen = len;
              }
            }
            template = best;
          }
          if (isRtl) {
            const pf = block['paragraphFormat'] ?? block['pf'];
            if (pf && typeof pf === 'object') (pf as Record<string, unknown>)['bidi'] = true;
            const tCf = template[cfKey] as Record<string, unknown> | undefined;
            if (tCf && typeof tCf === 'object') tCf['bidi'] = true;
            else if (cfKey) template = { ...template, [cfKey]: { ...(template[cfKey] as object), bidi: true } };
          }
          const newInline = this.createInlineForHighlight(segment, template, false, textKey, cfKey);
          block[inlinesKey] = [newInline];
        }
      }

      return JSON.stringify(doc);
    } catch {
      return sfdtString;
    }
  }

  /**
   * Convert a plain-text character offset (matching sfdt-text.getTextFromSfdt output) to a
   * Syncfusion hierarchical position string ("sectionIndex;bodyIndex;blockIndex;offset").
   */
  plainOffsetToSfdtPosition(sfdtString: string, plainOffset: number): string | null {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      let running = 0;
      let lastPos = '0;0;0;0';
      for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (let bi = 0; bi < blocks.length; bi++) {
          const block = blocks[bi];
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          let blockNormLen = 0;
          let blockRawLen = 0;
          for (const inline of inlines) {
            const text = inline['text'] ?? inline['tlp'];
            if (typeof text === 'string') {
              blockNormLen += normalizeTextForAnalysis(text).length;
              blockRawLen += text.length;
            }
          }
          if (plainOffset <= running + blockNormLen) {
            let blockRunningNorm = running;
            let blockRunningRaw = 0;
            for (const inline of inlines) {
              const text = inline['text'] ?? inline['tlp'];
              if (typeof text !== 'string') continue;
              const normLen = normalizeTextForAnalysis(text).length;
              const startNorm = blockRunningNorm;
              const endNorm = blockRunningNorm + normLen;
              if (plainOffset <= endNorm) {
                const offsetInInlineNorm = plainOffset - startNorm;
                const rawOffsetInInline = normalizedOffsetToRawOffset(text, offsetInInlineNorm);
                const rawOffsetInBlock = blockRunningRaw + rawOffsetInInline;
                return `${si};0;${bi};${rawOffsetInBlock}`;
              }
              blockRunningNorm = endNorm;
              blockRunningRaw += text.length;
            }
            return `${si};0;${bi};${blockRawLen}`;
          }
          running += blockNormLen + BLOCK_SEPARATOR.length;
          lastPos = `${si};0;${bi};${blockRawLen}`;
        }
      }
      return lastPos;
    } catch {
      return null;
    }
  }

  /** Build minimal SFDT with one paragraph containing the given text (RTL-friendly). */
  buildMinimalSfdt(text: string): string {
    const escaped = JSON.stringify(text);
    return `{"sections":[{"blocks":[{"paragraphFormat":{"bidi":true},"inlines":[{"characterFormat":{"bidi":true},"text":${escaped}}]}],"headersFooters":{}}]}`;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private getHighlightSpansInRange(
    blockStart: number,
    blockEnd: number,
    ranges: { suggestionId?: string; startOffset: number; endOffset: number }[]
  ): Array<{ start: number; end: number; suggestionId?: string; fullStart: number; fullEnd: number }> {
    const spans: Array<{ start: number; end: number; suggestionId?: string; fullStart: number; fullEnd: number }> = [];
    for (const { suggestionId, startOffset, endOffset } of ranges) {
      const start = Math.max(blockStart, startOffset);
      const end = Math.min(blockEnd, endOffset);
      if (start < end) spans.push({ start, end, suggestionId, fullStart: startOffset, fullEnd: endOffset });
    }
    return spans.sort((a, b) => a.start - b.start);
  }

  private detectTextKey(inlines: Array<Record<string, unknown>>): 'text' | 'tlp' {
    for (const inline of inlines) {
      if (inline['tlp'] !== undefined) return 'tlp';
      if (inline['text'] !== undefined) return 'text';
    }
    return 'text';
  }

  private detectCharacterFormatKey(inlines: Array<Record<string, unknown>>): 'characterFormat' | 'cf' {
    for (const inline of inlines) {
      if (inline['cf'] !== undefined) return 'cf';
      if (inline['characterFormat'] !== undefined) return 'characterFormat';
    }
    return 'characterFormat';
  }

  private inlineWithoutHighlight(inline: Record<string, unknown>, cfKey: string): Record<string, unknown> {
    const out = { ...inline };
    const cf = out[cfKey] as Record<string, unknown> | undefined;
    if (cf && typeof cf === 'object') {
      const fmt = { ...cf };
      delete fmt['highlightColor'];
      delete fmt['hc'];
      out[cfKey] = fmt;
    }
    return out;
  }

  private createBookmarkInline(
    template: Record<string, unknown>,
    name: string,
    isStart: boolean,
    cfKey: string
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    const cf = template[cfKey] as Record<string, unknown> | undefined;
    if (cf && typeof cf === 'object') {
      out[cfKey] = { ...cf };
    }

    const bookmarkType = isStart ? 0 : 1;
    const useOptimizedKeys = cfKey === 'cf';
    if (useOptimizedKeys) {
      out['bkt'] = bookmarkType;
      out['n'] = name;
    } else {
      out['bookmarkType'] = bookmarkType;
      out['name'] = name;
    }

    return out;
  }

  private createInlineForHighlight(
    text: string,
    template: Record<string, unknown>,
    highlight: boolean,
    textKey: string,
    cfKey: string
  ): Record<string, unknown> {
    const out = { ...template };
    out[textKey] = text;

    const cf = template[cfKey] as Record<string, unknown> | undefined;
    const fmt = (cf && typeof cf === 'object') ? { ...cf } : {};
    if (highlight) {
      fmt['highlightColor'] = 'Yellow';
      fmt['hc'] = 'Yellow';
    } else {
      delete fmt['highlightColor'];
      delete fmt['hc'];
    }
    out[cfKey] = fmt;
    return out;
  }

  private mergeAdjacentTextInlines(
    inlines: Record<string, unknown>[],
    textKey: string,
    cfKey: string
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const inline of inlines) {
      const text = inline[textKey];
      if (typeof text !== 'string') {
        result.push(inline);
        continue;
      }
      if (result.length > 0) {
        const prev = result[result.length - 1];
        const prevText = prev[textKey];
        if (typeof prevText === 'string' && this.canMergeTextInlines(prev, inline, textKey)) {
          prev[textKey] = prevText + text;
          continue;
        }
      }
      result.push({ ...inline });
    }
    return result;
  }

  private canMergeTextInlines(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    textKey: string
  ): boolean {
    const aKeys = Object.keys(a).filter(k => k !== textKey);
    const bKeys = Object.keys(b).filter(k => k !== textKey);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
    }
    return true;
  }

  private getInlineTextLength(inline: Record<string, unknown>): number {
    const text = inline['text'] ?? inline['tlp'];
    return typeof text === 'string' ? normalizeTextForAnalysis(text).length : 0;
  }
}
