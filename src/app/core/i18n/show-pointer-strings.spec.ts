import {
  SHOW_POINTER_STRINGS_EN,
  SHOW_POINTER_STRINGS_HE,
  ShowPointerStringKey,
  showPointerString,
} from './show-pointer-strings';

/**
 * Wave 3 / w7 (Q5): the strings of the "ask Show about your book" pointer.
 *
 * The pointer stands at two addresses (the book dashboard and the chapter analysis panel) and both read
 * from this one file, so a drift between the two slots is impossible by construction rather than by
 * assertion. What IS asserted here is the shape of the file itself: he/en parity, non-empty content, the
 * standing no-em-dash rule, and the one property the whole pointer exists for, that both languages name
 * the assistant so an author can find it again tomorrow.
 *
 * The key union is closed and both maps are `Record<ShowPointerStringKey, string>`, so a key present in
 * one language and missing from the other is a COMPILE error, not a test failure. The parity test below
 * is still worth having: it catches a key that was added to both maps with an empty or whitespace value,
 * which the type system accepts.
 */
describe('the Show pointer strings (w7)', () => {
  /** Derived from the Hebrew map rather than restated, so a new key cannot skip these checks. */
  const KEYS = Object.keys(SHOW_POINTER_STRINGS_HE) as ShowPointerStringKey[];

  it('sweeps a non-empty key set, so nothing below can pass vacuously', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(5);
  });

  it('holds the same keys in both languages, each with real content', () => {
    expect(Object.keys(SHOW_POINTER_STRINGS_HE).sort()).toEqual(Object.keys(SHOW_POINTER_STRINGS_EN).sort());

    for (const key of KEYS) {
      expect(SHOW_POINTER_STRINGS_HE[key].trim().length).withContext(`he ${key}`).toBeGreaterThan(0);
      expect(SHOW_POINTER_STRINGS_EN[key].trim().length).withContext(`en ${key}`).toBeGreaterThan(0);
    }
  });

  it('is really translated, not the same literal twice', () => {
    for (const key of KEYS) {
      expect(SHOW_POINTER_STRINGS_HE[key])
        .withContext(`${key} is identical in both maps, so one language was never written`)
        .not.toBe(SHOW_POINTER_STRINGS_EN[key]);
    }
  });

  it('carries no em-dash and no en-dash in any language', () => {
    for (const key of KEYS) {
      for (const map of [SHOW_POINTER_STRINGS_HE, SHOW_POINTER_STRINGS_EN]) {
        expect(map[key]).withContext(`${key} carries an em-dash`).not.toContain('—');
        expect(map[key]).withContext(`${key} carries an en-dash`).not.toContain('–');
      }
    }
  });

  it('names the assistant in both languages, which is the point of pointing at it', () => {
    // A pointer that says "ask the assistant" teaches nothing findable; the NAME is what the author
    // has to carry away, and it is the same name the dock's tab and Show's own greeting use.
    expect(SHOW_POINTER_STRINGS_HE.title).toContain('שואו');
    expect(SHOW_POINTER_STRINGS_EN.title).toContain('Show');
    expect(SHOW_POINTER_STRINGS_HE.open).toContain('שואו');
    expect(SHOW_POINTER_STRINGS_EN.open).toContain('Show');
  });

  it('resolves each key in the requested language', () => {
    for (const key of KEYS) {
      expect(showPointerString('he', key)).toBe(SHOW_POINTER_STRINGS_HE[key]);
      expect(showPointerString('en', key)).toBe(SHOW_POINTER_STRINGS_EN[key]);
    }
  });
});
