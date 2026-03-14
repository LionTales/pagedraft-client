import { TestBed } from '@angular/core/testing';
import { EditorTextService } from './editor-text.service';

describe('EditorTextService', () => {
  let service: EditorTextService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EditorTextService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTextFromSfdt', () => {
    it('extracts text from standard-key SFDT', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'First ' }, { text: 'paragraph' }] },
            { inlines: [{ text: 'Second paragraph' }] }
          ]
        }]
      });
      expect(service.getTextFromSfdt(sfdt)).toBe('First paragraph\nSecond paragraph');
    });

    it('extracts text from optimized-key SFDT (v32)', () => {
      const sfdt = JSON.stringify({
        sec: [{
          b: [{ i: [{ tlp: 'שלום עולם' }] }]
        }]
      });
      expect(service.getTextFromSfdt(sfdt)).toBe('שלום עולם');
    });

    it('returns empty string on invalid JSON', () => {
      expect(service.getTextFromSfdt('{invalid')).toBe('');
    });

    it('skips non-text inlines (e.g. bookmarks)', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [{
            inlines: [
              { text: 'before' },
              { bookmarkType: 0, name: 'bk1' },
              { text: 'after' }
            ]
          }]
        }]
      });
      expect(service.getTextFromSfdt(sfdt)).toBe('beforeafter');
    });
  });

  describe('getPlainTextFromEditor', () => {
    it('returns empty string when editor is undefined', () => {
      expect(service.getPlainTextFromEditor(undefined)).toBe('');
    });
  });
});
