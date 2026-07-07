import { visibleModelName } from './visible-model-name';

describe('visibleModelName', () => {
  it('returns a normal model name as-is', () => {
    expect(visibleModelName('gemma4:12b')).toBe('gemma4:12b');
  });

  it('returns null for null', () => {
    expect(visibleModelName(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(visibleModelName(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(visibleModelName('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(visibleModelName('   ')).toBeNull();
  });

  it('returns null for the internal chunked sentinel', () => {
    expect(visibleModelName('chunked')).toBeNull();
  });

  it('does not throw for a non-string input and returns a sensible value', () => {
    // Guards against a malformed server value reaching this helper at runtime.
    expect(() => visibleModelName(123 as any)).not.toThrow();
    expect(visibleModelName(123 as any)).toBe('123');
  });
});
