import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

/**
 * Renders a SAFE subset of Markdown for free-text analysis results (Custom / Summarize and any other
 * non-structured result). Local-LLM output commonly contains Markdown (bold, bullets, numbered lists,
 * blank-line paragraphs) which, when interpolated as plain text, shows the literal `**`/`*` markers and
 * mangles structure. This component converts that subset to a small set of known-safe HTML tags.
 *
 * Security: the input is HTML-ESCAPED FIRST (`&` `<` `>` `"` `'`), so any model-produced HTML/script is
 * inert before any transform runs; the transforms then emit ONLY a fixed set of safe tags
 * (<strong>, <em>, <ul>/<ol>/<li>, <p>, <br>, <h5>/<h6>). The result is bound with [innerHTML], which
 * Angular's DomSanitizer sanitizes by default. We never call bypassSecurityTrust*. See the spec for the
 * script/onerror escaping assertions.
 *
 * RTL: dir="auto" on the root so Hebrew content renders RTL and English LTR. Any spacing uses logical
 * CSS properties so lists/headings read correctly in both directions.
 *
 * No i18n strings here: the component renders user/model content, not fixed labels.
 */
@Component({
  selector: 'app-markdown-text',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="markdown-text" dir="auto" [innerHTML]="html"></div>`,
  styles: [`
    .markdown-text {
      font-size: 0.9rem;
      line-height: 1.5;
      color: #333;
      white-space: normal;
      word-break: break-word;
    }
    .markdown-text p {
      margin: 0 0 0.6rem;
    }
    .markdown-text p:last-child {
      margin-bottom: 0;
    }
    .markdown-text ul,
    .markdown-text ol {
      margin: 0 0 0.6rem;
      padding-inline-start: 1.4rem;
    }
    .markdown-text li {
      margin: 0 0 0.2rem;
    }
    .markdown-text h5,
    .markdown-text h6 {
      margin: 0.4rem 0 0.3rem;
      font-weight: 600;
    }
    .markdown-text h5 { font-size: 0.95rem; }
    .markdown-text h6 { font-size: 0.9rem; }
    .markdown-text strong { font-weight: 600; }
  `]
})
export class MarkdownTextComponent {
  private _text = '';
  html = '';

  @Input()
  set text(value: string | null | undefined) {
    this._text = value ?? '';
    this.html = renderSafeMarkdown(this._text);
  }
  get text(): string {
    return this._text;
  }
}

/**
 * Local-LLM Summarize/Custom output often writes an enumerated list INLINE in one blob
 * ("1. first 2. second 3. third") rather than one item per line. Standard Markdown only treats an ordinal
 * at a LINE START as a list item, so without this the whole blob would render as a single paragraph - the
 * regression this restores from the old analysisItems() inline split. Insert a line break before each
 * INLINE ordinal so the per-line ordered-list matcher in renderSafeMarkdown picks them up as separate
 * items (with faithful <ol start> numbering).
 *
 * Conservative, to avoid mangling ordinary prose that merely mentions numbers:
 *   - only fires when the text holds at least TWO list-like ordinal markers, so a lone "...see point 3. and
 *     then..." in a sentence is left alone;
 *   - a marker is a 1-2 digit number followed by '.'/')' and whitespace, so years ("in 1990. "), decimals
 *     ("3.14") and versions ("1.2.3") never qualify (4-digit / no-trailing-space);
 *   - only an ordinal preceded ON THE SAME LINE by non-whitespace text is broken out; an ordinal already at
 *     a line start (a genuine multi-line list) is left untouched.
 */
function splitInlineOrdinals(raw: string): string {
  const markerRe = /\b\d{1,2}[.)]\s/g;
  if ((raw.match(markerRe) ?? []).length < 2) return raw;
  return raw.replace(/(\S)[^\S\n]+(\d{1,2}[.)]\s)/g, '$1\n$2');
}

/** HTML-escape ampersands, angle brackets and quotes so any raw HTML/script in the input is inert. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline transforms (bold/italic). Operates on ALREADY-ESCAPED text, emits only <strong>/<em>. */
function renderInline(escaped: string): string {
  let out = escaped;
  // Bold: **text** -> <strong>text</strong>. Non-greedy, must contain at least one non-* char.
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // Italic with underscores: _text_ -> <em>text</em>. Avoid mid-word underscores by requiring the
  // surrounding chars to not be word characters (snake_case_identifiers stay literal).
  out = out.replace(/(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  // Italic with single asterisks: *text* -> <em>text</em>. Runs AFTER bold so leftover single * pair
  // up; require the content to not start/end with whitespace so " * " (a stray bullet glyph) is left.
  out = out.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '<em>$1</em>');
  return out;
}

/** A block emitted during parsing: a paragraph, a list, or a heading. */
type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'h'; level: 5 | 6; text: string };

/**
 * Convert a SAFE Markdown subset to HTML. Escapes first, then transforms, so the output contains only
 * the documented safe tags. Recognized line forms (leading whitespace allowed):
 *   - `* ` / `- ` / `• `        -> unordered list item
 *   - `<n>. `                    -> ordered list item (faithful numbering via <ol start>)
 *   - `#` / `##` / `###` ...     -> small heading (<h5> for #/##, <h6> for deeper)
 *   - blank line                 -> block/paragraph break
 *   - single newline in a para   -> <br>
 *   - anything else              -> paragraph text
 */
export function renderSafeMarkdown(raw: string): string {
  if (!raw || !raw.trim()) return '';

  // Normalize newlines, recover inline-enumerated lists (see splitInlineOrdinals), then escape the WHOLE
  // input up front so every downstream branch is safe.
  const escaped = escapeHtml(splitInlineOrdinals(raw.replace(/\r\n?/g, '\n')));
  const lines = escaped.split('\n');

  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'p', lines: paragraph });
      paragraph = [];
    }
  };

  // After escaping, '*' '-' '#' are unchanged but a literal '>' became '&gt;', so blockquote-style
  // markers do not collide with our matchers. Bullet markers checked against the escaped line.
  const bulletRe = /^\s*([*\-•])\s+(.*)$/;
  const orderedRe = /^\s*(\d+)[.)]\s+(.*)$/;
  const headingRe = /^\s*(#{1,6})\s+(.*)$/;

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = headingRe.exec(line);
    if (heading) {
      flushParagraph();
      const level: 5 | 6 = heading[1].length <= 2 ? 5 : 6;
      blocks.push({ kind: 'h', level, text: heading[2].trim() });
      continue;
    }

    const bullet = bulletRe.exec(line);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ul') {
        last.items.push(bullet[2]);
      } else {
        blocks.push({ kind: 'ul', items: [bullet[2]] });
      }
      continue;
    }

    const ordered = orderedRe.exec(line);
    if (ordered) {
      flushParagraph();
      const num = parseInt(ordered[1], 10);
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ol') {
        last.items.push(ordered[2]);
      } else {
        blocks.push({ kind: 'ol', items: [ordered[2]], start: Number.isFinite(num) ? num : 1 });
      }
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();

  return blocks.map(renderBlock).join('');
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'p': {
      const inner = block.lines.map(l => renderInline(l)).join('<br>');
      return `<p>${inner}</p>`;
    }
    case 'ul': {
      const items = block.items.map(i => `<li>${renderInline(i)}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    case 'ol': {
      const items = block.items.map(i => `<li>${renderInline(i)}</li>`).join('');
      const startAttr = block.start !== 1 ? ` start="${block.start}"` : '';
      return `<ol${startAttr}>${items}</ol>`;
    }
    case 'h': {
      return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
    }
  }
}
