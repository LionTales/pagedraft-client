import { getTextFromSfdt } from './sfdt-text';

describe('getTextFromSfdt', () => {
  it('extracts text from standard-key SFDT with block separator between paragraphs', () => {
    const sfdt = JSON.stringify({
      sections: [{
        blocks: [
          { inlines: [{ text: 'Hello ' }, { text: 'world' }] },
          { inlines: [{ text: '!' }] }
        ]
      }]
    });
    expect(getTextFromSfdt(sfdt)).toBe('Hello world\n!');
  });

  it('extracts text from optimized-key SFDT (v32)', () => {
    const sfdt = JSON.stringify({
      sec: [{ b: [{ i: [{ tlp: 'שלום ' }, { tlp: 'עולם' }] }] }]
    });
    expect(getTextFromSfdt(sfdt)).toBe('שלום עולם');
  });

  it('joins adjacent blocks with newline so offsets align with backend', () => {
    const sfdt = JSON.stringify({
      sections: [{
        blocks: [
          { inlines: [{ text: 'Hello' }] },
          { inlines: [{ text: 'world' }] }
        ]
      }]
    });
    expect(getTextFromSfdt(sfdt)).toBe('Hello\nworld');
  });

  it('returns empty string for invalid JSON', () => {
    expect(getTextFromSfdt('not json')).toBe('');
  });
});
