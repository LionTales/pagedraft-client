import { TestBed } from '@angular/core/testing';
import { SuggestionAnchorService } from './suggestion-anchor.service';
import { AnalysisSuggestion } from '../models/analysis';

describe('SuggestionAnchorService', () => {
  let service: SuggestionAnchorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SuggestionAnchorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  function makeSuggestion(overrides: Partial<AnalysisSuggestion> & { original: string; suggested: string }): AnalysisSuggestion {
    const { original, suggested, ...rest } = overrides;
    return {
      id: 's-1',
      original,
      suggested,
      startOffset: 0,
      endOffset: original.length,
      ...rest,
    };
  }

  describe('relocateOne', () => {
    it('fast path — offset still valid, returns same offsets, stale = false', () => {
      const text = 'The quick brown fox';
      const suggestion = makeSuggestion({
        original: 'quick',
        suggested: 'fast',
        startOffset: 4,
        endOffset: 9,
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(4);
      expect(result.relocatedEnd).toBe(9);
      expect(result.stale).toBeFalse();
    });

    it('text inserted before suggestion — original offset wrong, but originalText found at new position, stale = false', () => {
      const text = 'The very quick brown fox';
      const suggestion = makeSuggestion({
        original: 'quick',
        suggested: 'fast',
        startOffset: 4,
        endOffset: 9,
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(9);
      expect(result.relocatedEnd).toBe(14);
      expect(result.stale).toBeFalse();
    });

    it('text deleted before suggestion — shifted backward', () => {
      const text = 'quick brown fox';
      const suggestion = makeSuggestion({
        original: 'quick',
        suggested: 'fast',
        startOffset: 4,
        endOffset: 9,
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(0);
      expect(result.relocatedEnd).toBe(5);
      expect(result.stale).toBeFalse();
    });

    it('original text no longer in document — stale = true', () => {
      const text = 'The fast brown fox';
      const suggestion = makeSuggestion({
        original: 'quick',
        suggested: 'fast',
        startOffset: 4,
        endOffset: 9,
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.stale).toBeTrue();
      expect(result.relocatedStart).toBe(4);
      expect(result.relocatedEnd).toBe(9);
    });

    it('duplicate text with different context — picks the correct occurrence using contextBefore/contextAfter', () => {
      const text = 'Hello world. Hello moon.';
      const suggestion = makeSuggestion({
        original: 'Hello',
        suggested: 'Hi',
        startOffset: 0,
        endOffset: 5,
        contextBefore: '',
        contextAfter: ' world',
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(0);
      expect(result.relocatedEnd).toBe(5);
      expect(result.stale).toBeFalse();
    });

    it('duplicate text — picks second occurrence when contextAfter matches', () => {
      const text = 'Hello world. Hello moon.';
      const suggestion = makeSuggestion({
        original: 'Hello',
        suggested: 'Hi',
        startOffset: 13,
        endOffset: 18,
        contextBefore: '. ',
        contextAfter: ' moon',
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(13);
      expect(result.relocatedEnd).toBe(18);
      expect(result.stale).toBeFalse();
    });

    it('suggestion at start of document (no contextBefore) — still locatable', () => {
      const text = 'Start of the document';
      const suggestion = makeSuggestion({
        original: 'Start',
        suggested: 'Begin',
        startOffset: 0,
        endOffset: 5,
        contextBefore: undefined,
        contextAfter: ' of',
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(0);
      expect(result.relocatedEnd).toBe(5);
      expect(result.stale).toBeFalse();
    });

    it('suggestion at end of document (no contextAfter) — still locatable', () => {
      const text = 'End of the document';
      const suggestion = makeSuggestion({
        original: 'document',
        suggested: 'file',
        startOffset: 11,
        endOffset: 19,
        contextBefore: 'the ',
        contextAfter: undefined,
      });
      const result = service.relocateOne(suggestion, text);
      expect(result.relocatedStart).toBe(11);
      expect(result.relocatedEnd).toBe(19);
      expect(result.stale).toBeFalse();
    });

    it('empty document — stale = true', () => {
      const suggestion = makeSuggestion({
        original: 'word',
        suggested: 'term',
        startOffset: 0,
        endOffset: 4,
      });
      const result = service.relocateOne(suggestion, '');
      expect(result.stale).toBeTrue();
    });
  });

  describe('relocateAll', () => {
    it('relocates multiple suggestions and returns array of RelocatedSuggestion', () => {
      const text = 'One two three';
      const suggestions: AnalysisSuggestion[] = [
        makeSuggestion({ original: 'One', suggested: '1', startOffset: 0, endOffset: 3 }),
        makeSuggestion({ original: 'two', suggested: '2', startOffset: 4, endOffset: 7 }),
      ];
      const results = service.relocateAll(suggestions, text);
      expect(results.length).toBe(2);
      expect(results[0].relocatedStart).toBe(0);
      expect(results[0].relocatedEnd).toBe(3);
      expect(results[0].stale).toBeFalse();
      expect(results[1].relocatedStart).toBe(4);
      expect(results[1].relocatedEnd).toBe(7);
      expect(results[1].stale).toBeFalse();
    });

    it('marks missing suggestion as stale in batch', () => {
      const text = 'Only one word here';
      const suggestions: AnalysisSuggestion[] = [
        makeSuggestion({ original: 'Only', suggested: 'Just', startOffset: 0, endOffset: 4 }),
        makeSuggestion({ original: 'missing', suggested: 'gone', startOffset: 5, endOffset: 12 }),
      ];
      const results = service.relocateAll(suggestions, text);
      expect(results[0].stale).toBeFalse();
      expect(results[1].stale).toBeTrue();
    });
  });
});
