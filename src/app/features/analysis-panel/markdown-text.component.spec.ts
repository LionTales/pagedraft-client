import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownTextComponent, MarkdownVariant } from './markdown-text.component';

describe('MarkdownTextComponent', () => {
  let component: MarkdownTextComponent;
  let fixture: ComponentFixture<MarkdownTextComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownTextComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownTextComponent);
    component = fixture.componentInstance;
  });

  function render(text: string): HTMLElement {
    component.text = text;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.markdown-text') as HTMLElement;
  }

  // =========================================================================
  // Empty / whitespace
  // =========================================================================
  it('renders nothing for empty input', () => {
    const el = render('');
    expect(el.innerHTML).toBe('');
    expect(el.textContent?.trim()).toBe('');
  });

  it('renders nothing for whitespace-only input', () => {
    const el = render('   \n  \t ');
    expect(el.innerHTML).toBe('');
  });

  it('renders nothing for null/undefined input', () => {
    component.text = null;
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.markdown-text') as HTMLElement;
    expect(el.innerHTML).toBe('');
  });

  // =========================================================================
  // Bold / italic
  // =========================================================================
  it('renders **bold** as <strong>', () => {
    const el = render('This is **important** text.');
    const strong = el.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('important');
    // No literal asterisks left visible.
    expect(el.textContent).not.toContain('**');
  });

  it('renders *italic* as <em>', () => {
    const el = render('This is *slanted* text.');
    const em = el.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('slanted');
    expect(el.textContent).not.toContain('*slanted*');
  });

  it('renders _italic_ as <em>', () => {
    const el = render('This is _emphasised_ text.');
    const em = el.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('emphasised');
  });

  it('does NOT turn a snake_case identifier into italics', () => {
    const el = render('Use the some_long_name variable.');
    expect(el.querySelector('em')).toBeNull();
    expect(el.textContent).toContain('some_long_name');
  });

  // =========================================================================
  // Lists
  // =========================================================================
  it('renders dash / asterisk / bullet lines as an unordered list', () => {
    const el = render('- first\n* second\n• third');
    const ul = el.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = el.querySelectorAll('ul li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('first');
    expect(items[1].textContent).toBe('second');
    expect(items[2].textContent).toBe('third');
    // The bullet markers themselves are gone from the rendered text.
    expect(el.textContent).not.toContain('-');
    expect(el.textContent).not.toContain('•');
  });

  it('renders "N." lines as an ordered list with faithful numbering', () => {
    const el = render('3. third item\n4. fourth item');
    const ol = el.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.getAttribute('start')).toBe('3');
    const items = el.querySelectorAll('ol li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('third item');
  });

  it('omits the start attribute when the ordered list begins at 1', () => {
    const el = render('1. one\n2. two');
    const ol = el.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.hasAttribute('start')).toBeFalse();
  });

  it('splits an inline-enumerated blob ("1. a 2. b 3. c") into a faithful ordered list', () => {
    // Legacy Summarize/Custom output frequently puts the whole enumeration on one line. Markdown only
    // treats ordinals at a line start as list items, so this must be split back out (the analysisItems
    // regression). Faithful numbering: starts at 1, so no start attribute.
    const el = render('1. first item 2. second item 3. third item');
    const ol = el.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.hasAttribute('start')).toBeFalse();
    const items = el.querySelectorAll('ol li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('first item');
    expect(items[1].textContent).toBe('second item');
    expect(items[2].textContent).toBe('third item');
  });

  it('does NOT split a prose sentence that ends in a year ("... in 1990. The ...")', () => {
    // 4-digit numbers are not list ordinals; a single year-terminated sentence must stay one paragraph.
    const el = render('The war ended in 1990. The treaty was signed later.');
    expect(el.querySelector('ol')).toBeNull();
    const paras = el.querySelectorAll('p');
    expect(paras.length).toBe(1);
    expect(paras[0].textContent).toBe('The war ended in 1990. The treaty was signed later.');
  });

  it('does NOT split a lone inline ordinal in prose (needs at least two list markers)', () => {
    const el = render('Please see point 3. It explains the rest.');
    expect(el.querySelector('ol')).toBeNull();
    expect(el.querySelectorAll('p').length).toBe(1);
  });

  it('applies inline bold inside list items (the reported bug shape)', () => {
    // Real model output: a bold numbered heading followed by bullets.
    const el = render('**1. הדילמה:**\n* קושי ראשון\n* קושי שני');
    // The bold marker must not be visible as literal asterisks anywhere.
    expect(el.textContent).not.toContain('**');
    expect(el.querySelector('strong')).not.toBeNull();
    const items = el.querySelectorAll('ul li');
    expect(items.length).toBe(2);
  });

  // =========================================================================
  // Paragraphs / line breaks
  // =========================================================================
  it('splits blank-line-separated text into separate paragraphs', () => {
    const el = render('First paragraph.\n\nSecond paragraph.');
    const paras = el.querySelectorAll('p');
    expect(paras.length).toBe(2);
    expect(paras[0].textContent).toBe('First paragraph.');
    expect(paras[1].textContent).toBe('Second paragraph.');
  });

  it('converts a single newline inside a paragraph to <br>', () => {
    const el = render('line one\nline two');
    const p = el.querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.querySelector('br')).not.toBeNull();
    expect(p?.querySelectorAll('br').length).toBe(1);
  });

  // =========================================================================
  // Headings
  // =========================================================================
  it('renders a "#" heading line as a small heading element', () => {
    const el = render('# Overview\nbody text');
    const h = el.querySelector('h5, h6');
    expect(h).not.toBeNull();
    expect(h?.textContent).toBe('Overview');
    // Hash marker not shown.
    expect(el.textContent).not.toContain('#');
  });

  // =========================================================================
  // RTL
  // =========================================================================
  it('sets dir="auto" so Hebrew renders RTL and English LTR', () => {
    const el = render('שלום עולם');
    expect(el.getAttribute('dir')).toBe('auto');
  });

  // =========================================================================
  // SECURITY: escape-then-transform. Raw HTML/script must be inert.
  // =========================================================================
  it('escapes a <script> tag so it is not rendered as a live element', () => {
    const el = render('<script>alert(1)</script> hello');
    // No actual script element is created in the DOM.
    expect(el.querySelector('script')).toBeNull();
    // The literal text is preserved (escaped), not interpreted as a tag.
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('escapes an <img onerror=...> so no img element with a handler is created', () => {
    const el = render('![x](y) <img src=x onerror="alert(1)">');
    expect(el.querySelector('img')).toBeNull();
    // The raw markup survives as visible, inert text.
    expect(el.textContent).toContain('onerror');
    expect(el.innerHTML).not.toContain('<img');
  });

  it('escapes angle brackets and ampersands in plain content', () => {
    const el = render('a < b && c > d');
    expect(el.textContent).toContain('a < b && c > d');
    // No spurious child elements were created from the brackets.
    expect(el.children.length).toBe(1); // just the single <p>
    expect(el.querySelector('p')).not.toBeNull();
  });

  it('does not let bold markup smuggle in a tag (content is escaped before transform)', () => {
    const el = render('**<b>x</b>**');
    // Our own <strong> wraps the (escaped) inner text; the smuggled <b> is inert text.
    expect(el.querySelector('strong')).not.toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>x</b>');
  });

  // =========================================================================
  // Inline code (both variants)
  // =========================================================================
  it('renders `inline code` as <code>, with no backticks left visible', () => {
    const el = render('Only a `.docx` file is accepted.');
    expect(el.querySelector('code')?.textContent).toBe('.docx');
    expect(el.textContent).not.toContain('`');
  });

  it('leaves emphasis markers INSIDE a code span literal', () => {
    // The reason someone wrote a code span around it in the first place.
    const el = render('Use `a_b_c` and `**x**` verbatim.');
    expect(el.querySelectorAll('code').length).toBe(2);
    expect(el.querySelector('em')).toBeNull();
    expect(el.querySelector('strong')).toBeNull();
    expect(el.textContent).toContain('a_b_c');
    expect(el.textContent).toContain('**x**');
  });

  it('escapes markup inside a code span rather than emitting it', () => {
    const el = render('Type `<script>alert(1)</script>` here.');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('code')?.textContent).toBe('<script>alert(1)</script>');
  });

  // =========================================================================
  // The `document` variant (chatbot phase A.2, c1)
  //
  // Authored .md files rendered as a PAGE. Three differences from model output, each one a real
  // rendering defect if the compact rules were used: a source wrap is not a line break, a wrapped list
  // item is not a new paragraph, and a guide's headings are the page's headings.
  // =========================================================================
  describe('document variant', () => {
    function renderAs(text: string, variant: MarkdownVariant): HTMLElement {
      component.variant = variant;
      component.text = text;
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.markdown-text') as HTMLElement;
    }

    it('renders # / ## / ### as real page headings instead of the compact h5/h6', () => {
      const el = renderAs('# Title\n\n## Section\n\n### Deeper\n\nbody', 'document');
      expect(el.querySelector('h1')?.textContent).toBe('Title');
      expect(el.querySelector('h2')?.textContent).toBe('Section');
      expect(el.querySelector('h3')?.textContent).toBe('Deeper');
      expect(el.querySelector('h5')).toBeNull();
      expect(el.querySelector('h6')).toBeNull();
    });

    it('leaves the compact variant\'s small headings exactly as they were', () => {
      const el = renderAs('# Title\n\n## Section', 'compact');
      expect(el.querySelectorAll('h5').length).toBe(2);
      expect(el.querySelector('h1')).toBeNull();
    });

    it('joins a HARD-WRAPPED paragraph into one flowing paragraph, with no <br>', () => {
      const el = renderAs('The review reads the chapter briefs, so if no usable briefs\nexist it stops.', 'document');
      const p = el.querySelector('p');
      expect(p?.querySelectorAll('br').length).toBe(0);
      expect(p?.textContent).toBe('The review reads the chapter briefs, so if no usable briefs exist it stops.');
    });

    it('still treats a single newline as a BREAK in the compact variant', () => {
      // The two variants must not converge: model output uses newlines meaningfully.
      const el = renderAs('line one\nline two', 'compact');
      expect(el.querySelector('p')?.querySelectorAll('br').length).toBe(1);
    });

    it('keeps a wrapped list item in its item instead of spilling it into a paragraph', () => {
      const el = renderAs(
        '- The book briefs count as ready only when every brief is current,\n  and nothing has changed since.\n- A second item.',
        'document');
      const items = el.querySelectorAll('li');
      expect(items.length).toBe(2);
      expect(items[0].textContent)
        .toBe('The book briefs count as ready only when every brief is current, and nothing has changed since.');
      // No stray paragraph was produced by the continuation line.
      expect(el.querySelectorAll('p').length).toBe(0);
    });

    it('keeps a wrapped NUMBERED item in its item, preserving the numbering', () => {
      const el = renderAs(
        '1. **Import.** A DOCX manuscript becomes chapters.\n2. **Book briefs.** A short brief for every chapter, composed into one\n   brief for the whole book.',
        'document');
      const items = el.querySelectorAll('ol li');
      expect(items.length).toBe(2);
      expect(items[1].textContent).toContain('composed into one brief for the whole book');
    });

    it('does NOT end a list because ordinary prose follows it at column 0', () => {
      const el = renderAs('- one\n- two\n\nA following paragraph.', 'document');
      expect(el.querySelectorAll('li').length).toBe(2);
      expect(el.querySelector('p')?.textContent).toBe('A following paragraph.');
    });

    it('does NOT split an inline ordinal in authored prose into a list', () => {
      // The compact variant recovers "1. a 2. b" because models write enumerations that way; an
      // authored guide that writes ordinals mid-sentence means a sentence.
      const el = renderAs('See stage 1. and stage 2. of the workflow.', 'document');
      expect(el.querySelector('ol')).toBeNull();
      expect(el.querySelectorAll('p').length).toBe(1);
    });

    it('still escapes markup in the document variant', () => {
      const el = renderAs('# <script>alert(1)</script>\n\n<img src=x onerror="alert(1)">', 'document');
      expect(el.querySelector('script')).toBeNull();
      expect(el.querySelector('img')).toBeNull();
      expect(el.innerHTML).not.toContain('<img');
    });

    it('renders Hebrew document markdown with the same structure', () => {
      const el = renderAs('# ייבוא כתב היד\n\n## אילו קבצים מתקבלים\n\nקובץ `.docx` בלבד.', 'document');
      expect(el.querySelector('h1')?.textContent).toBe('ייבוא כתב היד');
      expect(el.querySelector('h2')?.textContent).toBe('אילו קבצים מתקבלים');
      expect(el.querySelector('code')?.textContent).toBe('.docx');
      expect(el.getAttribute('dir')).toBe('auto');
    });
  });

  // =========================================================================
  // RENDERED STYLE, not DOM shape.
  //
  // Every assertion above this point passed while the whole styles block was INERT: the component
  // renders through [innerHTML], so the nodes carry no emulated content attribute and the compiled
  // `.markdown-text[_ngcontent-x] h1[_ngcontent-x]` matched nothing. Structural assertions cannot see
  // that, so these read getComputedStyle instead. Each one is picked so the expected value DIFFERS
  // from what applies with the component's own rules removed - otherwise it would pass on a
  // coincidence and prove nothing. The competing value is named in each test, because the global
  // `_base.scss` (not the UA sheet) is what wins for headings here.
  //
  // These require the fixture to be in the document, which TestBed does, and the global stylesheet,
  // which angular.json's test target loads (`styles: ["src/styles.scss"]`) - that is where the --pd-*
  // tokens and the competing element rules both come from.
  // =========================================================================
  describe('rendered style', () => {
    function renderAs(text: string, variant: MarkdownVariant): HTMLElement {
      component.variant = variant;
      component.text = text;
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.markdown-text') as HTMLElement;
    }

    it('sizes a document h1 from --pd-text-h3, not from the global h1 rule', () => {
      // Global _base.scss gives a bare h1 --pd-text-h1 (40px). A guide's title is a page heading
      // inside app chrome, not a hero, so the document variant asks for --pd-text-h3 (24px).
      const el = renderAs('# Import your manuscript\n\nbody text', 'document');
      const h1 = el.querySelector('h1') as HTMLElement;
      expect(getComputedStyle(h1).fontSize).toBe('24px');
      // And the weight the variant asks for, against the global rule's bold 700.
      expect(getComputedStyle(h1).fontWeight).toBe('600');
    });

    it('spaces document list items from --pd-space-3, not the browser default of none', () => {
      const el = renderAs('- first item\n- second item', 'document');
      const li = el.querySelector('li') as HTMLElement;
      expect(getComputedStyle(li).marginBlockEnd).toBe('8px');
    });

    it('gives an inline code span the mono face and the fill, in the DEFAULT compact variant', () => {
      // The compact rules were inert too, so this is the blast-radius half: it fails if the fix is
      // reverted, on every existing caller and not only on the guides reader.
      const el = render('Only a `.docx` file is accepted.');
      const code = el.querySelector('code') as HTMLElement;
      const style = getComputedStyle(code);
      expect(style.fontFamily).toContain('Roboto Mono');
      expect(style.backgroundColor).toBe('rgb(238, 241, 245)'); // --pd-neutral-100
    });

    it('isolates a code span with unicode-bidi: plaintext so a leading "." cannot flip to the far end', () => {
      // In a Hebrew paragraph the span inherits direction: rtl and the leading '.' of `.docx` is a
      // bidi-neutral, so at the paragraph level it resolved to the RTL end and the extension rendered
      // as `docx.`. plaintext resolves the span from its own first strong character instead.
      const el = renderAs('קובץ `.docx` בלבד.', 'document');
      const code = el.querySelector('code') as HTMLElement;
      expect(getComputedStyle(code).unicodeBidi).toBe('plaintext');
    });

    it('breaks a long code span only as a last resort, so Hebrew is not split mid-word', () => {
      // overflow-wrap: anywhere replaced word-break: break-all, which broke at every line end and
      // would have split `פרולוג` across lines at a narrow measure.
      const el = render('Use `פרולוג` as a marker.');
      const code = el.querySelector('code') as HTMLElement;
      const style = getComputedStyle(code);
      expect(style.overflowWrap).toBe('anywhere');
      expect(style.wordBreak).not.toBe('break-all');
    });
  });

  // =========================================================================
  // blockDirBase: per-block direction for mixed-language prose (chatbot phase B)
  // =========================================================================
  describe('blockDirBase', () => {
    const HEBREW = 'הפרק נפתח בשיחה בין שתי הדמויות';
    const ENGLISH = 'The chapter opens on a conversation between two characters';

    function renderWithBase(text: string, base: 'rtl' | 'ltr' | null): HTMLElement {
      component.blockDirBase = base;
      component.text = text;
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.markdown-text') as HTMLElement;
    }

    it('is OFF by default: no existing caller renders a single dir attribute', () => {
      // The default is what keeps this from re-laying-out every analysis result and every guide page
      // in the app. Only one surface has the mixed-language problem it solves.
      const el = render(`${HEBREW}\n\n${ENGLISH}\n\n- ${ENGLISH}`);
      expect(el.querySelectorAll('[dir]').length).toBe(0);
    });

    it('turns a foreign block, BOTH ways round, and leaves agreeing blocks with no attribute', () => {
      const rtl = renderWithBase(`${HEBREW}\n\n${ENGLISH}`, 'rtl');
      expect(Array.from(rtl.querySelectorAll('p')).map(p => p.getAttribute('dir')))
        .toEqual([null, 'ltr']);

      const ltr = renderWithBase(`${ENGLISH}\n\n${HEBREW}`, 'ltr');
      expect(Array.from(ltr.querySelectorAll('p')).map(p => p.getAttribute('dir')))
        .toEqual([null, 'rtl']);
    });

    it('decides a LIST per item as well as per list', () => {
      // A list is a container of blocks: a Hebrew list quoting one English line should turn that line
      // around and nothing else.
      const el = renderWithBase(`- ${HEBREW}\n- ${ENGLISH}\n- ${HEBREW}`, 'rtl');
      expect(Array.from(el.querySelectorAll('li')).map(li => li.getAttribute('dir')))
        .toEqual([null, 'ltr', null]);
    });

    it('measures the SOURCE, not the rendered HTML, so markup does not tip the count', () => {
      // Tag names and attribute values are Latin; a Hebrew paragraph carrying one <strong> would
      // otherwise be measured as part-Latin and flip.
      const el = renderWithBase(`**${HEBREW}**`, 'rtl');
      expect(el.querySelector('p')?.getAttribute('dir')).toBeNull();
    });

    it('gives a turned block its OWN start edge', () => {
      // The style must REACH the node: these arrive through [innerHTML] and carry no emulated content
      // attribute, so this only works because the component's encapsulation is None.
      const el = renderWithBase(`${HEBREW}\n\n${ENGLISH}`, 'rtl');
      const turned = el.querySelector('p[dir="ltr"]') as HTMLElement;
      expect(getComputedStyle(turned).textAlign).toBe('start');
    });
  });
});
