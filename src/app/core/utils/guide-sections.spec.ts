import { guideIntro, guideSectionAt, guideSections } from './guide-sections';

/**
 * Wave 3 / w6 - the guide splitter the first-run orientation panel reads its prose through.
 *
 * The panel renders authored guide content and never copy of its own, so the ONE failure this file has to
 * make impossible is a silent empty render: a body the splitter cannot cut must come back as `null` / `[]`
 * so the caller can say so, never as an empty string that renders as a blank card.
 */
describe('guide-sections (w6)', () => {
  const BODY = [
    '# How the work flows',
    '',
    'PageDraft has five stages. They are not a rigid pipeline.',
    '',
    '## The five stages',
    '',
    '1. **Import.** A DOCX manuscript becomes chapters in your book.',
    '2. **Book briefs.** A short structured brief for every chapter.',
    '',
    '### A deeper heading is body, not a section',
    '',
    'Still inside the first section.',
    '',
    '## What actually depends on what',
    '',
    'Everything starts with import.',
    '',
  ].join('\n');

  it('cuts the body at its H2 headings, in authored order', () => {
    const sections = guideSections(BODY);

    expect(sections.length).toBe(2);
    expect(sections[0].heading).toBe('The five stages');
    expect(sections[1].heading).toBe('What actually depends on what');
  });

  it('keeps a deeper heading INSIDE its section rather than starting a new one', () => {
    const first = guideSections(BODY)[0];

    expect(first.body).toContain('### A deeper heading is body, not a section');
    expect(first.body).toContain('Still inside the first section.');
  });

  it('strips the heading line from the section body, so the surface can render its own title', () => {
    const first = guideSections(BODY)[0];

    expect(first.body.startsWith('##')).toBeFalse();
    expect(first.body).toContain('1. **Import.**');
  });

  it('reads the intro as everything above the first H2, without the H1 title line', () => {
    const intro = guideIntro(BODY);

    expect(intro).toBe('PageDraft has five stages. They are not a rigid pipeline.');
    expect(intro).not.toContain('# How the work flows');
  });

  /**
   * THE HONEST-ABSENCE CONTRACT. Every one of these is a real served-corpus possibility (a guide that is
   * all prose, an empty body, a 404 body the caller passed through), and each one must be distinguishable
   * from "here is a section" rather than collapsing into an empty string.
   */
  it('answers null for a section that is not there, rather than an empty one', () => {
    expect(guideSectionAt(BODY, 0)).not.toBeNull();
    expect(guideSectionAt(BODY, 1)).not.toBeNull();
    expect(guideSectionAt(BODY, 2)).toBeNull();
    expect(guideSectionAt(BODY, -1)).toBeNull();
    expect(guideSectionAt('', 0)).toBeNull();
    expect(guideSectionAt(null, 0)).toBeNull();
    expect(guideSectionAt(undefined, 0)).toBeNull();
  });

  it('reports no sections at all for a document that has only an H1 and prose', () => {
    const flat = '# Title\n\nJust prose, no sections.\n';

    expect(guideSections(flat)).toEqual([]);
    expect(guideIntro(flat)).toBe('Just prose, no sections.');
  });

  it('is not fooled by a hash that is not a heading', () => {
    const tricky = '# Title\n\nA sentence with ## in the middle of it.\n\n##NotAHeading\n';

    expect(guideSections(tricky)).toEqual([]);
    expect(guideIntro(tricky)).toContain('##NotAHeading');
  });

  /** Hebrew is the primary language, and the splitter must not be script-dependent in any way. */
  it('splits the Hebrew sibling exactly the same way', () => {
    const he = [
      '# איך העבודה מתקדמת',
      '',
      'ב-PageDraft חמישה שלבים.',
      '',
      '## חמשת השלבים',
      '',
      '1. **ייבוא.** קובץ DOCX הופך לפרקים בספר.',
      '',
      '## מה תלוי במה',
      '',
      'הכול מתחיל בייבוא.',
    ].join('\n');

    const sections = guideSections(he);

    expect(sections.length).toBe(2);
    expect(sections[0].heading).toBe('חמשת השלבים');
    expect(sections[0].body).toContain('**ייבוא.**');
    expect(guideIntro(he)).toBe('ב-PageDraft חמישה שלבים.');
  });
});
