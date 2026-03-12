import { normalizeTextForAnalysis, normalizedOffsetToRawOffset } from './normalize-text-for-analysis';

describe('normalizeTextForAnalysis', () => {
  it('should strip bidi control characters and CRLF', () => {
    const input = 'שורה א\u200E\r\nשורה ב\u200F\u202A';

    const normalized = normalizeTextForAnalysis(input);

    expect(normalized).toContain('שורה א');
    expect(normalized).toContain('שורה ב');
    expect(normalized).not.toContain('\r');
    expect(normalized).not.toContain('\n');
    expect(normalized).not.toContain('\u200E');
    expect(normalized).not.toContain('\u200F');
    expect(normalized).not.toContain('\u202A');
  });
});

describe('normalizedOffsetToRawOffset', () => {
  it('maps normalized offsets back to raw positions with bidi and newlines', () => {
    const raw = 'א\u200Eב\r\nג';
    const normalized = normalizeTextForAnalysis(raw);

    expect(normalized).toBe('אבג');

    const idxA = normalizedOffsetToRawOffset(raw, 0);
    const idxB = normalizedOffsetToRawOffset(raw, 1);
    const idxG = normalizedOffsetToRawOffset(raw, 2);

    expect(idxA).toBe(0);
    expect(idxB).toBe(2);
    expect(idxG).toBe(5);
  });
});

