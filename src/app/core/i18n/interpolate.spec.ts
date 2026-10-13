import { interpolate } from './interpolate';

describe('interpolate', () => {
  it('substitutes named placeholders, numbers included', () => {
    expect(interpolate('{done} of {total}', { done: 3, total: '7' })).toBe('3 of 7');
  });

  it('leaves an UNKNOWN placeholder verbatim rather than blanking it', () => {
    expect(interpolate('{done} of {total}', { done: 3 })).toBe('3 of {total}');
  });

  it('does not read inherited properties as params', () => {
    expect(interpolate('{toString}', {})).toBe('{toString}');
  });

  it('returns the template unchanged without params', () => {
    expect(interpolate('{eta} left')).toBe('{eta} left');
  });
});
