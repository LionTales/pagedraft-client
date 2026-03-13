import { getTextFromSfdt } from './sfdt-text';

describe('getTextFromSfdt', () => {
  it('extracts text from standard-key SFDT', () => {
    const sfdt = JSON.stringify({
      sections: [{
        blocks: [
          { inlines: [{ text: 'Hello ' }, { text: 'world' }] },
          { inlines: [{ text: '!' }] }
        ]
      }]
    });
    expect(getTextFromSfdt(sfdt)).toBe('Hello world!');
  });

  it('extracts text from optimized-key SFDT (v32)', () => {
    const sfdt = JSON.stringify({
      sec: [{ b: [{ i: [{ tlp: 'שלום ' }, { tlp: 'עולם' }] }] }]
    });
    expect(getTextFromSfdt(sfdt)).toBe('שלום עולם');
  });

  it('returns empty string for invalid JSON', () => {
    expect(getTextFromSfdt('not json')).toBe('');
  });
});
