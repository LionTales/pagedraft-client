import { TestBed } from '@angular/core/testing';
import { SfdtManipulationService, suggestionBookmarkName, SUGGESTION_BOOKMARK_PREFIX } from './sfdt-manipulation.service';

describe('SfdtManipulationService', () => {
  let service: SfdtManipulationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SfdtManipulationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTextFromSfdt', () => {
    it('extracts plain text from standard-key SFDT', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'Hello ' }, { text: 'world' }] },
            { inlines: [{ text: '!' }] }
          ]
        }]
      });
      expect(service.getTextFromSfdt(sfdt)).toBe('Hello world!');
    });

    it('extracts plain text from optimized-key (v32) SFDT', () => {
      const sfdt = JSON.stringify({
        sec: [{
          b: [
            { i: [{ tlp: 'שלום ' }, { tlp: 'עולם' }] }
          ]
        }]
      });
      expect(service.getTextFromSfdt(sfdt)).toBe('שלום עולם');
    });

    it('returns empty string for invalid JSON', () => {
      expect(service.getTextFromSfdt('not json')).toBe('');
    });
  });

  describe('buildMinimalSfdt', () => {
    it('round-trips through getTextFromSfdt', () => {
      const text = 'Hello world';
      const sfdt = service.buildMinimalSfdt(text);
      expect(service.getTextFromSfdt(sfdt)).toBe(text);
    });

    it('sets bidi: true on paragraph and character formats', () => {
      const doc = JSON.parse(service.buildMinimalSfdt('test'));
      const block = doc.sections[0].blocks[0];
      expect(block.paragraphFormat.bidi).toBeTrue();
      expect(block.inlines[0].characterFormat.bidi).toBeTrue();
    });
  });

  describe('ensureSfdtRtl', () => {
    it('does nothing when isRtl is false', () => {
      const sfdt = JSON.stringify({ sections: [{ blocks: [{ paragraphFormat: {}, inlines: [{ text: 'hi', characterFormat: {} }] }] }] });
      expect(service.ensureSfdtRtl(sfdt, false)).toBe(sfdt);
    });

    it('sets bidi: true on all paragraphs and inlines when isRtl is true', () => {
      const sfdt = JSON.stringify({ sections: [{ blocks: [{ paragraphFormat: {}, inlines: [{ text: 'hi', characterFormat: {} }] }] }] });
      const result = JSON.parse(service.ensureSfdtRtl(sfdt, true));
      expect(result.sections[0].blocks[0].paragraphFormat.bidi).toBeTrue();
      expect(result.sections[0].blocks[0].inlines[0].characterFormat.bidi).toBeTrue();
    });
  });

  describe('stripHighlightFromSfdt', () => {
    it('removes highlightColor from character formats and strips suggestion bookmarks', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [{
            inlines: [
              { bookmarkType: 0, name: 'sg_abc' },
              { text: 'hello', characterFormat: { highlightColor: 'Yellow', bold: true } },
              { bookmarkType: 1, name: 'sg_abc' },
            ]
          }]
        }]
      });
      const stripped = JSON.parse(service.stripHighlightFromSfdt(sfdt));
      const inlines = stripped.sections[0].blocks[0].inlines;
      expect(inlines.length).toBe(1);
      expect(inlines[0].text).toBe('hello');
      expect(inlines[0].characterFormat.highlightColor).toBeUndefined();
      expect(inlines[0].characterFormat.bold).toBeTrue();
    });
  });

  describe('plainOffsetToSfdtPosition', () => {
    it('maps a plain-text offset to a hierarchical SFDT position', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'Hello world' }] }
          ]
        }]
      });
      expect(service.plainOffsetToSfdtPosition(sfdt, 0)).toBe('0;0;0;0');
      expect(service.plainOffsetToSfdtPosition(sfdt, 5)).toBe('0;0;0;5');
    });
  });

  describe('suggestionBookmarkName', () => {
    it('converts UUID to bookmark-safe name', () => {
      expect(suggestionBookmarkName('abc-def-123')).toBe('sg_abc_def_123');
    });
  });

  describe('SUGGESTION_BOOKMARK_PREFIX', () => {
    it('matches prefix used by suggestionBookmarkName', () => {
      const name = suggestionBookmarkName('test');
      expect(name.startsWith(SUGGESTION_BOOKMARK_PREFIX)).toBeTrue();
    });
  });
});
