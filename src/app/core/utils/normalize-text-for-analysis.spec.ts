import { normalizeTextForAnalysis, normalizedOffsetToRawOffset } from './normalize-text-for-analysis';

/**
 * Shared FE/BE parity vector. The SAME input -> expected pairs are asserted by the backend test
 * (TextNormalizationAndContextTests.NormalizeTextForAnalysis_SharedParityVector) so FE and BE
 * normalization are provably identical. Keep the two lists in lockstep when either changes.
 */
const SHARED_PARITY_VECTOR: ReadonlyArray<{ input: string; expected: string }> = [
  { input: 'רוני\nהתעוררתי', expected: 'רוני התעוררתי' }, // LF -> single space (the root-cause case)
  { input: 'a\r\nb', expected: 'a  b' }, // CRLF -> two spaces (1:1, no collapse)
  { input: 'a\rb\nc', expected: 'a b c' }, // lone CR and lone LF each -> one space
  { input: 'x‎y', expected: 'xy' }, // LRM dropped (no space)
  { input: 'שורה‏ שנייה', expected: 'שורה שנייה' }, // RLM dropped, existing space preserved
  { input: 'plain text', expected: 'plain text' }, // untouched passthrough
];

describe('normalizeTextForAnalysis', () => {
  it('replaces hard line breaks with a space and drops bidi controls', () => {
    const input = 'שורה א‎\r\nשורה ב‏‪';

    const normalized = normalizeTextForAnalysis(input);

    expect(normalized).toContain('שורה א');
    expect(normalized).toContain('שורה ב');
    // Line breaks are gone (replaced by spaces), not present as raw \r/\n.
    expect(normalized).not.toContain('\r');
    expect(normalized).not.toContain('\n');
    // Bidi controls dropped entirely.
    expect(normalized).not.toContain('‎');
    expect(normalized).not.toContain('‏');
    expect(normalized).not.toContain('‪');
  });

  it('does NOT glue the word after a line break (root-cause regression)', () => {
    // Chapter title "רוני" is duplicated as the first body line; dropping the \n produced the
    // non-word "רוניהתעוררתי", which the model "fixed" by deleting "רוני".
    expect(normalizeTextForAnalysis('רוני\nהתעוררתי')).toBe('רוני התעוררתי');
    expect(normalizeTextForAnalysis('רוני\nהתעוררתי')).not.toBe('רוניהתעוררתי');
  });

  it('is stable under repeated application (no space growth)', () => {
    const once = normalizeTextForAnalysis('רוני\r\nהתעוררתי');
    expect(normalizeTextForAnalysis(once)).toBe(once);
  });

  describe('shared FE/BE parity vector', () => {
    for (const { input, expected } of SHARED_PARITY_VECTOR) {
      it(`normalizes ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
        expect(normalizeTextForAnalysis(input)).toBe(expected);
      });
    }
  });
});

describe('normalizedOffsetToRawOffset', () => {
  it('maps normalized offsets back to raw positions (bidi dropped, line breaks 1:1)', () => {
    // Raw: א(0) LRM(1) ב(2) \r(3) \n(4) ג(5)
    // Normalized: א(0) ב(1) [space=\r](2) [space=\n](3) ג(4)  => 'אב  ג'
    const raw = 'א‎ב\r\nג';
    const normalized = normalizeTextForAnalysis(raw);

    expect(normalized).toBe('אב  ג');

    expect(normalizedOffsetToRawOffset(raw, 0)).toBe(0); // א
    expect(normalizedOffsetToRawOffset(raw, 1)).toBe(2); // ב (LRM at raw 1 skipped)
    expect(normalizedOffsetToRawOffset(raw, 2)).toBe(3); // the space that replaced \r -> raw 3
    expect(normalizedOffsetToRawOffset(raw, 3)).toBe(4); // the space that replaced \n -> raw 4
    expect(normalizedOffsetToRawOffset(raw, 4)).toBe(5); // ג
  });

  it('maps a word AFTER a line break to its correct raw index', () => {
    // Root-cause shape: title + line break + first body word.
    const raw = 'רוני\nהתעוררתי';
    const normalized = normalizeTextForAnalysis(raw);
    expect(normalized).toBe('רוני התעוררתי');

    // "התעוררתי" starts at normalized offset 5 (after "רוני" + 1 space).
    const normStart = normalized.indexOf('התעוררתי');
    expect(normStart).toBe(5);
    // In raw text it starts at index 5 too (רוני=4 chars + \n=1 char), so the mapping must return 5.
    const rawStart = normalizedOffsetToRawOffset(raw, normStart);
    expect(rawStart).toBe(5);
    expect(raw.slice(rawStart)).toBe('התעוררתי');
  });
});
