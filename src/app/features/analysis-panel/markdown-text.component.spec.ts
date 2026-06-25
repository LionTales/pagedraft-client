import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownTextComponent } from './markdown-text.component';

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
});
