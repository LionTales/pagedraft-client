import { TestBed } from '@angular/core/testing';
import { SuggestionKeyService } from './suggestion-key.service';
import { AnalysisResultDto, AnalysisSuggestionDto } from '../models/analysis';

describe('SuggestionKeyService', () => {
  let service: SuggestionKeyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SuggestionKeyService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  function makeResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
    return {
      id: 'r-1',
      chapterId: 'chap-1',
      jobId: null,
      type: 'Proofread',
      resultText: '',
      createdAt: '2026-01-01T00:00:00Z',
      scope: 'Chapter',
      analysisType: 'Proofread',
      structuredResult: null,
      sceneId: null,
      bookId: 'book-1',
      language: 'he',
      status: 'Active',
      proofreadNoChangesHint: false,
      suggestions: [],
      ...overrides,
    };
  }

  describe('proofreadSuggestionKey', () => {
    it('uses result id when available', () => {
      const result = makeResult({ id: 'RES-1' });
      const key = service.proofreadSuggestionKey(result, { original: 'a', suggested: 'b' });
      expect(key).toContain('res-1');
      expect(key).toContain('a');
      expect(key).toContain('b');
    });

    it('falls back to run key when id is empty', () => {
      const result = makeResult({ id: '' });
      const key = service.proofreadSuggestionKey(result, { original: 'a', suggested: 'b' });
      expect(key).toContain('chap-1');
      expect(key).toContain('2026-01-01');
    });
  });

  describe('lineEditSuggestionKey', () => {
    it('includes result id when available', () => {
      const result = makeResult({ id: 'RES-2' });
      const key = service.lineEditSuggestionKey(result, { original: 'old', suggested: 'new' });
      expect(key).toContain('res-2');
      expect(key).toContain('old');
      expect(key).toContain('new');
    });
  });

  describe('suggestionStatusOrder', () => {
    it('orders pending < accepted < reverted < dismissed', () => {
      expect(service.suggestionStatusOrder('pending')).toBeLessThan(service.suggestionStatusOrder('accepted'));
      expect(service.suggestionStatusOrder('accepted')).toBeLessThan(service.suggestionStatusOrder('reverted'));
      expect(service.suggestionStatusOrder('reverted')).toBeLessThan(service.suggestionStatusOrder('dismissed'));
    });
  });

  describe('trackRecentOutcomeKey / getRecentOutcomeKeys', () => {
    it('tracks keys in most-recent-first order', () => {
      service.trackRecentOutcomeKey('key-a');
      service.trackRecentOutcomeKey('key-b');
      service.trackRecentOutcomeKey('key-a');
      const keys = service.getRecentOutcomeKeys();
      expect(keys[0]).toBe('key-a');
      expect(keys[1]).toBe('key-b');
      expect(keys.length).toBe(2);
    });

    it('ignores empty keys', () => {
      service.trackRecentOutcomeKey('');
      expect(service.getRecentOutcomeKeys().length).toBe(0);
    });
  });

  describe('applyOutcomeToSuggestionDtos', () => {
    it('mutates suggestion DTOs across latestResult and allAnalyses', () => {
      const sug: AnalysisSuggestionDto = {
        id: 's-1',
        analysisResultId: 'r-1',
        originalText: 'a',
        suggestedText: 'b',
        startOffset: 0,
        endOffset: 1,
        reason: 'r',
        category: null,
        explanation: null,
        outcome: null,
        orderIndex: 0,
      };
      const latest = makeResult({ suggestions: [{ ...sug }] });
      const history = makeResult({ id: 'r-2', suggestions: [{ ...sug, analysisResultId: 'r-2' }] });

      const updated = service.applyOutcomeToSuggestionDtos(latest, [history], 's-1', 'Accepted');

      expect(latest.suggestions![0].outcome).toBe('Accepted');
      expect(history.suggestions![0].outcome).toBe('Accepted');
      expect(updated.size).toBeGreaterThan(0);
    });
  });

  describe('markSuggestionRevertedById', () => {
    it('sets outcome to Reverted and tracks recent key', () => {
      const sug: AnalysisSuggestionDto = {
        id: 's-1',
        analysisResultId: 'r-1',
        originalText: 'a',
        suggestedText: 'b',
        startOffset: 0,
        endOffset: 1,
        reason: 'r',
        category: null,
        explanation: null,
        outcome: 'Accepted',
        orderIndex: 0,
      };
      const latest = makeResult({ suggestions: [sug] });

      const { updatedSuggestionIds, recentKeys } = service.markSuggestionRevertedById(latest, [], 's-1');

      expect(latest.suggestions![0].outcome).toBe('Reverted');
      expect(updatedSuggestionIds.has('s-1')).toBeTrue();
      expect(recentKeys.length).toBeGreaterThan(0);
    });
  });

  describe('findSuggestionDtoById', () => {
    it('finds a DTO by id across result sets', () => {
      const sug: AnalysisSuggestionDto = {
        id: 's-99',
        analysisResultId: 'r-1',
        originalText: 'x',
        suggestedText: 'y',
        startOffset: 0,
        endOffset: 1,
        reason: 'r',
        category: null,
        explanation: null,
        outcome: null,
        orderIndex: 0,
      };
      const result = makeResult({ suggestions: [sug] });
      const found = service.findSuggestionDtoById(null, [result], 's-99');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('s-99');
    });

    it('returns null for non-existent id', () => {
      const result = makeResult({ suggestions: [] });
      expect(service.findSuggestionDtoById(result, [], 'nope')).toBeNull();
    });
  });
});
