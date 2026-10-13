/**
 * c8: the pure half of the "flagged unreliable" export question. Expected strings are written from the
 * rule (1-based chapter number, singular at exactly 1, names only when they match the server count),
 * not copied from a run.
 */
import { BookProofreadUnreliableChapter } from '../../core/models/book-proofread';
import {
  relevantUnreliableChapters, unreliableChapterLabel, unreliableNothingToSkipNotice, unreliableSkippedNotice,
} from './unreliable-export';

const A: BookProofreadUnreliableChapter = { chapterId: 'a', title: 'אילון', order: 0 };
const C: BookProofreadUnreliableChapter = { chapterId: 'c', title: 'Third', order: 2 };

describe('unreliable-export (c8)', () => {
  it('book scope: every listed chapter, in server order', () => {
    expect(relevantUnreliableChapters({ unreliableChapters: [A, C] }, 'book', null)).toEqual([A, C]);
  });

  it('chapter scope: only the picked chapter, and only when it is listed', () => {
    expect(relevantUnreliableChapters({ unreliableChapters: [A, C] }, 'chapter', 'c')).toEqual([C]);
    expect(relevantUnreliableChapters({ unreliableChapters: [A, C] }, 'chapter', 'b')).toEqual([]);
    expect(relevantUnreliableChapters({ unreliableChapters: [A, C] }, 'chapter', null)).toEqual([]);
  });

  it('a missing list (older server) or a missing status is "nothing flagged"', () => {
    expect(relevantUnreliableChapters(null, 'book', null)).toEqual([]);
    expect(relevantUnreliableChapters({} as { unreliableChapters: BookProofreadUnreliableChapter[] }, 'book', null)).toEqual([]);
  });

  it('labels a chapter by its 1-based number, never the stored order', () => {
    expect(unreliableChapterLabel(A, 'he')).toBe('פרק 1: אילון');
    expect(unreliableChapterLabel(C, 'en')).toBe('Chapter 3: Third');
  });

  it('the skipped notice: singular at 1, plural otherwise, in both languages', () => {
    expect(unreliableSkippedNotice(1, [], 'he')).toBe('הצעות התיקון של פרק אחד דולגו.');
    expect(unreliableSkippedNotice(3, [], 'he')).toBe('הצעות התיקון של 3 פרקים דולגו.');
    expect(unreliableSkippedNotice(1, [], 'en')).toBe('Suggestions skipped for 1 chapter.');
    expect(unreliableSkippedNotice(3, [], 'en')).toBe('Suggestions skipped for 3 chapters.');
  });

  it('names the chapters only when the names agree with the server count', () => {
    expect(unreliableSkippedNotice(1, ['Chapter 1: אילון'], 'en')).toBe('Suggestions skipped for 1 chapter (Chapter 1: אילון).');
    expect(unreliableSkippedNotice(2, ['Chapter 1: אילון'], 'en')).toBe('Suggestions skipped for 2 chapters.');
  });

  it('carries no em-dash or en-dash', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const n of [1, 2]) expect(unreliableSkippedNotice(n, ['x'], lang)).not.toMatch(/[–—]/);
    }
  });

  // c02: Skip chosen, server skipped fewer than listed. Expected strings written from the rule: the gap is
  // listed - skipped, singular at 1, the chapters named only when NONE was skipped.
  describe('c02: the nothing-to-skip line', () => {
    it('skipped 0 of 1 listed: the singular, naming the chapter (both languages)', () => {
      expect(unreliableNothingToSkipNotice(0, ['Chapter 1: אילון'], 'en'))
        .toBe('1 chapter chosen for skipping had no flagged suggestions to skip (Chapter 1: אילון).');
      expect(unreliableNothingToSkipNotice(0, ['פרק 1: אילון'], 'he'))
        .toBe('בפרק אחד שנבחר לדילוג לא היו הצעות מסומנות לדלג עליהן (פרק 1: אילון).');
    });

    it('skipped 0 of 2 listed: the plural with the count, both named', () => {
      expect(unreliableNothingToSkipNotice(0, ['Chapter 1: A', 'Chapter 3: C'], 'en'))
        .toBe('2 chapters chosen for skipping had no flagged suggestions to skip (Chapter 1: A, Chapter 3: C).');
      expect(unreliableNothingToSkipNotice(0, ['פרק 1: A', 'פרק 3: C'], 'he'))
        .toBe('ב-2 פרקים שנבחרו לדילוג לא היו הצעות מסומנות לדלג עליהן (פרק 1: A, פרק 3: C).');
    });

    it('skipped 1 of 3 listed: the gap of 2 by count alone (which ones is not known)', () => {
      expect(unreliableNothingToSkipNotice(1, ['a', 'b', 'c'], 'en'))
        .toBe('2 chapters chosen for skipping had no flagged suggestions to skip.');
    });

    it('no line when the server skipped every listed chapter (or more), on include, or with no header', () => {
      expect(unreliableNothingToSkipNotice(1, ['a'], 'en')).toBeNull();
      expect(unreliableNothingToSkipNotice(2, ['a'], 'en')).toBeNull();
      expect(unreliableNothingToSkipNotice(0, [], 'en')).toBeNull();
      expect(unreliableNothingToSkipNotice(null, ['a'], 'he')).toBeNull();
    });

    it('carries no em-dash or en-dash', () => {
      for (const lang of ['he', 'en'] as const) {
        for (const listed of [['x'], ['x', 'y']]) {
          expect(unreliableNothingToSkipNotice(0, listed, lang)!).not.toMatch(/[\u2013\u2014]/);
        }
      }
    });
  });
});
