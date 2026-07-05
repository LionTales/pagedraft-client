import { TestBed } from '@angular/core/testing';
import { getTextFromSfdt } from '../utils/sfdt-text';
import { SfdtManipulationService, suggestionBookmarkName, SUGGESTION_BOOKMARK_PREFIX, SCROLL_TARGET_BOOKMARK, BLOCK_SEPARATOR_NORM_LEN } from './sfdt-manipulation.service';
import { normalizeTextForAnalysis } from '../utils/normalize-text-for-analysis';

describe('SfdtManipulationService', () => {
  let service: SfdtManipulationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SfdtManipulationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('buildMinimalSfdt', () => {
    it('round-trips through getTextFromSfdt (sfdt-text)', () => {
      const text = 'Hello world';
      const sfdt = service.buildMinimalSfdt(text);
      expect(getTextFromSfdt(sfdt)).toBe(text);
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

    it('strips _scroll_target bookmark inlines alongside suggestion bookmarks', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [{
            inlines: [
              { bookmarkType: 0, name: SCROLL_TARGET_BOOKMARK },
              { text: 'world', characterFormat: { bold: true } },
              { bookmarkType: 1, name: SCROLL_TARGET_BOOKMARK },
            ]
          }]
        }]
      });
      const stripped = JSON.parse(service.stripHighlightFromSfdt(sfdt));
      const inlines = stripped.sections[0].blocks[0].inlines;
      expect(inlines.length).toBe(1);
      expect(inlines[0].text).toBe('world');
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

    it('accounts for block separator between paragraphs', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'Hello' }] },
            { inlines: [{ text: 'world' }] }
          ]
        }]
      });
      expect(getTextFromSfdt(sfdt)).toBe('Hello\nworld');
      // plainOffset is in normalized space, where the inter-block \n normalizes to ONE space:
      // "Hello world" (length 11). Offset 5 is the separator space; offsets 6..10 are "world".
      expect(service.plainOffsetToSfdtPosition(sfdt, 0)).toBe('0;0;0;0');
      expect(service.plainOffsetToSfdtPosition(sfdt, 4)).toBe('0;0;0;4'); // last char of first para
      expect(service.plainOffsetToSfdtPosition(sfdt, 5)).toBe('0;0;1;0'); // separator -> start of second para
      expect(service.plainOffsetToSfdtPosition(sfdt, 6)).toBe('0;0;1;0'); // 'w' = first char of second para
      expect(service.plainOffsetToSfdtPosition(sfdt, 7)).toBe('0;0;1;1'); // 'o'
      expect(service.plainOffsetToSfdtPosition(sfdt, 11)).toBe('0;0;1;5'); // one past last = end of block 1
    });
  });

  describe('block-separator offset invariant (be-c01 cross-stack parity)', () => {
    // The backend computes suggestion offsets against NormalizeTextForAnalysis of the chapter/scene
    // plain text, where each inter-paragraph boundary is a SINGLE '\n' (Syncfusion emits CRLF between
    // paragraphs, but SyncfusionWatermarkStripper collapses [\r\n]+ -> '\n' before normalization), so
    // every boundary contributes EXACTLY ONE normalized space. The FE offset walk must assume the same
    // one-char-per-boundary width or offsets past the first paragraph break drift and accumulate.
    // Backend guard: TextNormalizationAndContextTests.ParagraphSeparator_OffsetString_*.

    it('BLOCK_SEPARATOR_NORM_LEN is exactly 1 (matches the backend one-space-per-boundary contract)', () => {
      expect(BLOCK_SEPARATOR_NORM_LEN).toBe(1);
      // And the join char itself normalizes to a single space, not two (the CRLF-drift failure mode).
      expect(normalizeTextForAnalysis('\n')).toBe(' ');
    });

    it('a two-paragraph SFDT offset walk matches the hand-computed backend offset string', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'para1' }] },
            { inlines: [{ text: 'para2' }] }
          ]
        }]
      });
      // FE flatten + normalize == what the backend indexes offsets against for the same two paragraphs.
      const feOffsetString = normalizeTextForAnalysis(getTextFromSfdt(sfdt));
      expect(feOffsetString).toBe('para1 para2');
      expect(feOffsetString.length).toBe(11);

      // The second paragraph's first char ('p' of para2) sits at hand-computed offset
      // 5 (para1) + BLOCK_SEPARATOR_NORM_LEN (1) = 6, and the walk must resolve that offset to
      // block 1, offset 0. A +1 drift would push it to block 0's tail instead.
      const secondParaStart = 'para1'.length + BLOCK_SEPARATOR_NORM_LEN;
      expect(secondParaStart).toBe(6);
      expect(service.plainOffsetToSfdtPosition(sfdt, secondParaStart)).toBe('0;0;1;0');
      // One past the whole document == end of block 1 (offset 5 within block 1).
      expect(service.plainOffsetToSfdtPosition(sfdt, feOffsetString.length)).toBe('0;0;1;5');
    });
  });

  describe('applyHighlightRangesToSfdt (block-separator offset space)', () => {
    it('highlights a word in the SECOND paragraph using offsets that include the block separator', () => {
      // Two paragraphs -> getTextFromSfdt joins with '\n' -> normalized "Hello world" (space at 5).
      // "world" occupies normalized offsets [6, 11). A naive (no-separator) offset space would have
      // put "world" at [5, 10) and highlighted the wrong characters; this proves the separator is counted.
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'Hello', characterFormat: {} }] },
            { inlines: [{ text: 'world', characterFormat: {} }] }
          ]
        }]
      });
      const out = JSON.parse(service.applyHighlightRangesToSfdt(sfdt, [{ startOffset: 6, endOffset: 11 }]));
      const block0 = out.sections[0].blocks[0].inlines;
      const block1 = out.sections[0].blocks[1].inlines;
      // First paragraph is untouched (no highlight).
      expect(block0.every((i: Record<string, unknown>) => {
        const cf = i['characterFormat'] as Record<string, unknown> | undefined;
        return !cf || cf['highlightColor'] !== 'Yellow';
      })).toBeTrue();
      // The entire "world" run in the second paragraph is highlighted.
      const worldInline = block1.find((i: Record<string, unknown>) => i['text'] === 'world');
      expect(worldInline).toBeDefined();
      expect((worldInline!['characterFormat'] as Record<string, unknown>)['highlightColor']).toBe('Yellow');
    });
  });

  describe('replacePlainTextInSfdt (block-separator offset space)', () => {
    it('splits normalized text with an inter-block separator space back into the right blocks', () => {
      const sfdt = JSON.stringify({
        sections: [{
          blocks: [
            { inlines: [{ text: 'Hello', characterFormat: {} }] },
            { inlines: [{ text: 'world', characterFormat: {} }] }
          ]
        }]
      });
      // Normalized doc is "Hello world"; apply a no-range full replace with the same normalized text.
      const out = JSON.parse(service.replacePlainTextInSfdt(sfdt, 'Hello world', false));
      const block0Text = out.sections[0].blocks[0].inlines.map((i: Record<string, unknown>) => i['text']).join('');
      const block1Text = out.sections[0].blocks[1].inlines.map((i: Record<string, unknown>) => i['text']).join('');
      // The separator space must be consumed as glue, not written into either block.
      expect(block0Text).toBe('Hello');
      expect(block1Text).toBe('world');
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
