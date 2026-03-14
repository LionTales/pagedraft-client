import { TestBed } from '@angular/core/testing';
import { LineEditParserService, ParsedLineEdit } from './line-edit-parser.service';
import { AnalysisResultDto } from '../models/analysis';

describe('LineEditParserService', () => {
  let service: LineEditParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LineEditParserService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  function makeLineEditResult(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
    return {
      id: 'r-le',
      chapterId: 'chap-1',
      jobId: null,
      type: 'LineEdit',
      resultText: '',
      modelName: 'test-model',
      createdAt: new Date().toISOString(),
      scope: 'Chapter',
      analysisType: 'LineEdit',
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

  const VALID_STRUCTURED = JSON.stringify({
    suggestions: [
      { original: 'old text', suggested: 'new text', reason: 'clarity', category: 'clarity' }
    ],
    overallFeedback: 'Good writing.'
  });

  describe('getLineEdit', () => {
    it('parses valid structuredResult', () => {
      const result = makeLineEditResult({ structuredResult: VALID_STRUCTURED });
      const parsed = service.getLineEdit(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.suggestions.length).toBe(1);
      expect(parsed!.suggestions[0].original).toBe('old text');
      expect(parsed!.overallFeedback).toBe('Good writing.');
    });

    it('falls back to resultText when structuredResult is null', () => {
      const result = makeLineEditResult({ structuredResult: null, resultText: VALID_STRUCTURED });
      const parsed = service.getLineEdit(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.suggestions.length).toBe(1);
    });

    it('returns null for non-LineEdit type', () => {
      const result = makeLineEditResult({ analysisType: 'Proofread', type: 'Proofread' });
      expect(service.getLineEdit(result)).toBeNull();
    });

    it('returns null when both fields are empty', () => {
      const result = makeLineEditResult({ structuredResult: null, resultText: '' });
      expect(service.getLineEdit(result)).toBeNull();
    });

    it('returns null when JSON is malformed', () => {
      const result = makeLineEditResult({ structuredResult: '{not valid', resultText: '{bad' });
      expect(service.getLineEdit(result)).toBeNull();
    });

    it('strips control characters before parsing', () => {
      const payload = JSON.stringify({
        suggestions: [{ original: 'a', suggested: 'b', reason: 'r', category: 'c' }],
        overallFeedback: 'ok' + String.fromCharCode(0x0b) + ' fine'
      });
      const result = makeLineEditResult({ structuredResult: payload });
      const parsed = service.getLineEdit(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.suggestions.length).toBe(1);
    });

    it('salvage uses real "suggestions" key and ignores same text inside string values', () => {
      // Truncated payload where a string value contains the literal "suggestions"; salvage must
      // latch onto the object key, not the substring inside the reason string. Second suggestion
      // is incomplete so only the first is salvaged.
      const truncated =
        '{"overallFeedback":"ok","suggestions":[{"original":"x","suggested":"y","reason":"ignore \\"suggestions\\" here","category":"c"},{"original":"a","suggested":"b","reason":"r","category":"c"';
      const result = makeLineEditResult({ structuredResult: truncated });
      const parsed = service.getLineEdit(result);
      expect(parsed).not.toBeNull();
      expect(parsed!.suggestions.length).toBe(1);
      expect(parsed!.suggestions[0].reason).toBe('ignore "suggestions" here');
      expect(parsed!.suggestions[0].original).toBe('x');
    });
  });

  describe('recomputeLineEditOffsets', () => {
    it('fills in null offsets from documentText', () => {
      const suggestions = [
        { original: 'target', suggested: 'TARGET', reason: 'r', category: 'c' } as any,
      ];
      const result = service.recomputeLineEditOffsets(suggestions, 'some target text');
      expect(result.changed).toBeTrue();
      expect(result.suggestions[0].startOffset).toBe(5);
      expect(result.suggestions[0].endOffset).toBe(11);
    });

    it('does not overwrite existing offsets', () => {
      const suggestions = [
        { original: 'word', suggested: 'WORD', startOffset: 100, endOffset: 104 } as any,
      ];
      const result = service.recomputeLineEditOffsets(suggestions, 'word appears at start');
      expect(result.changed).toBeFalse();
      expect(result.suggestions[0].startOffset).toBe(100);
    });

    it('returns unchanged when documentText is null', () => {
      const suggestions = [{ original: 'x', suggested: 'y' } as any];
      const result = service.recomputeLineEditOffsets(suggestions, null);
      expect(result.changed).toBeFalse();
    });
  });

  describe('toLineEditSuggestionsWithOffsets', () => {
    it('maps raw suggestions to AnalysisSuggestion with offsets', () => {
      const raw = [{ original: 'hello', suggested: 'Hello', reason: 'cap', category: 'style' }];
      const mapped = service.toLineEditSuggestionsWithOffsets(raw, 'say hello world');
      expect(mapped.length).toBe(1);
      expect(mapped[0].startOffset).toBe(4);
      expect(mapped[0].endOffset).toBe(9);
    });

    it('returns suggestions without offsets when documentText is null', () => {
      const raw = [{ original: 'x', suggested: 'y', reason: 'r', category: 'c' }];
      const mapped = service.toLineEditSuggestionsWithOffsets(raw, null);
      expect(mapped.length).toBe(1);
      expect(mapped[0].startOffset).toBeUndefined();
    });
  });
});
