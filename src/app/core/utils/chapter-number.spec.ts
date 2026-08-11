import { chapterDisplayNumber } from './chapter-number';

describe('chapterDisplayNumber', () => {
  it('converts the zero-based wire order to the one-based number an author sees', () => {
    expect(chapterDisplayNumber(0)).toBe(1);
    expect(chapterDisplayNumber(1)).toBe(2);
    expect(chapterDisplayNumber(2)).toBe(3);
  });

  it('has no special case: it is one function, not four re-spellings', () => {
    expect(chapterDisplayNumber(11)).toBe(12);
  });
});
