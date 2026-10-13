import { isWhitespaceOnlySuggestion, proofreadDiff } from './proofread-diff';

describe('isWhitespaceOnlySuggestion', () => {
  it('is true for identical texts', () => {
    expect(isWhitespaceOnlySuggestion('שלום', 'שלום')).toBeTrue();
  });

  it('is true for a deleted edge space, NBSP or run of spaces', () => {
    expect(isWhitespaceOnlySuggestion(' ', '')).toBeTrue();
    expect(isWhitespaceOnlySuggestion('\u00A0', '')).toBeTrue();
    expect(isWhitespaceOnlySuggestion('   ', '')).toBeTrue();
    expect(isWhitespaceOnlySuggestion(' הוא', 'הוא')).toBeTrue();
    expect(isWhitespaceOnlySuggestion('הוא\u00A0', 'הוא ')).toBeTrue();
  });

  it('is false for a real edit that merely has surrounding spaces', () => {
    expect(isWhitespaceOnlySuggestion(' כול ', ' כל ')).toBeFalse();
    expect(isWhitespaceOnlySuggestion(' כול', 'כל')).toBeFalse();
  });

  it('is false when the only change is an inner space', () => {
    expect(isWhitespaceOnlySuggestion('בית ספר', 'בית  ספר')).toBeFalse();
    expect(isWhitespaceOnlySuggestion('ביתספר', 'בית ספר')).toBeFalse();
  });

  it('treats null and undefined as empty', () => {
    expect(isWhitespaceOnlySuggestion(null, ' ')).toBeTrue();
    expect(isWhitespaceOnlySuggestion(undefined, 'x')).toBeFalse();
  });

  it('agrees with proofreadDiff: a whitespace-only change yields no suggestion', () => {
    expect(proofreadDiff('הוא הלך', 'הוא הלך ').length).toBe(0);
    expect(proofreadDiff('הוא הלך', 'הוא רץ').length).toBe(1);
  });
});
