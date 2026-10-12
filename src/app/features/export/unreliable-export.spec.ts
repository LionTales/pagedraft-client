/**
 * c8: the pure half of the "flagged unreliable" export question. Expected strings are written from the
 * rule (1-based chapter number, singular at exactly 1, names only when they match the server count),
 * not copied from a run.
 */
import { BookProofreadUnreliableChapter } from '../../core/models/book-proofread';
import {
  relevantUnreliableChapters, unreliableChapterLabel, unreliableSkippedNotice,
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
});
