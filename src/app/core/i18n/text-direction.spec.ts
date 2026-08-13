/**
 * Per-block direction for mixed-language prose (chatbot phase B, c2).
 *
 * The case this exists for is the todo's: a Hebrew drawer quoting an English chapter brief, and an
 * English drawer quoting a Hebrew one. Both directions are asserted, because a helper that only ever
 * gets one of them right is exactly as broken as one that gets neither, and it is much easier to ship.
 */
import { blockDirection, dominantDirection } from './text-direction';

const HEBREW = 'הפרק נפתח בשיחה בין שתי הדמויות';
const ENGLISH = 'The chapter opens on a conversation between two characters';

describe('dominantDirection', () => {
  it('reads Hebrew prose as rtl and English prose as ltr', () => {
    expect(dominantDirection(HEBREW)).toBe('rtl');
    expect(dominantDirection(ENGLISH)).toBe('ltr');
  });

  it('is NOT first-strong-character: a Hebrew sentence opening with a Latin name stays rtl', () => {
    // This is the whole reason the helper is script-MAJORITY and not dir="auto". Product names and
    // refs open sentences constantly on this surface, and `dir="auto"` would flip every one of those
    // paragraphs whole.
    expect(dominantDirection(`PageDraft ${HEBREW}`)).toBe('rtl');
  });

  it('is not fooled the other way either: an English sentence quoting one Hebrew word stays ltr', () => {
    expect(dominantDirection('The chapter is titled פרק and runs long')).toBe('ltr');
  });

  it('returns NULL when there is nothing to measure, so the block inherits', () => {
    // A caller that read null as "ltr" would turn "2026-08-12" out of a Hebrew paragraph.
    expect(dominantDirection('')).toBeNull();
    expect(dominantDirection(null)).toBeNull();
    expect(dominantDirection(undefined)).toBeNull();
    expect(dominantDirection('2026-08-12 (14:05) ... 42%')).toBeNull();
  });
});

describe('blockDirection', () => {
  it('BOTH WAYS ROUND: a foreign block gets its own direction', () => {
    // Hebrew drawer quoting an English brief.
    expect(blockDirection(ENGLISH, 'rtl')).toBe('ltr');
    // English drawer quoting a Hebrew brief.
    expect(blockDirection(HEBREW, 'ltr')).toBe('rtl');
  });

  it('returns null for a block that AGREES with its surroundings', () => {
    // Null means "no dir attribute", which is what keeps the rendered markup honest: an attribute
    // appears only where a direction actually switches.
    expect(blockDirection(HEBREW, 'rtl')).toBeNull();
    expect(blockDirection(ENGLISH, 'ltr')).toBeNull();
  });

  it('returns null for a directionless block, in either surrounding direction', () => {
    expect(blockDirection('42', 'rtl')).toBeNull();
    expect(blockDirection('42', 'ltr')).toBeNull();
  });
});
