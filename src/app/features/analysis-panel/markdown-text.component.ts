import { CommonModule } from '@angular/common';
import { Component, Input, ViewEncapsulation } from '@angular/core';

import { TextDirection, blockDirection } from '../../core/i18n/text-direction';

/**
 * Renders a SAFE subset of Markdown, in two VARIANTS.
 *
 * `compact` (the default, and the only behaviour before A.2/c1) is for free-text analysis results
 * (Custom / Summarize and any other non-structured result). Local-LLM output commonly contains
 * Markdown (bold, bullets, numbered lists, blank-line paragraphs) which, when interpolated as plain
 * text, shows the literal `**`/`*` markers and mangles structure. This component converts that subset
 * to a small set of known-safe HTML tags.
 *
 * `document` (chatbot phase A.2, c1) is for AUTHORED markdown files rendered as a page: the shipped
 * product guides at the `/help` reader. It is the same parser with three differences, each forced by
 * what authored markdown does that model output does not - see {@link MarkdownVariant}. Adding a
 * variant here rather than forking a second renderer is deliberate: two markdown paths would mean two
 * escaping stories, and only one of them would keep being reviewed.
 *
 * Security: the input is HTML-ESCAPED FIRST (`&` `<` `>` `"` `'`), so any model-produced or
 * file-authored HTML/script is inert before any transform runs; the transforms then emit ONLY a fixed
 * set of safe tags (<strong>, <em>, <code>, <ul>/<ol>/<li>, <p>, <br>, <h1>-<h3>, <h5>/<h6>). The
 * result is bound with [innerHTML], which Angular's DomSanitizer sanitizes by default. We never call
 * bypassSecurityTrust*. See the spec for the script/onerror escaping assertions.
 *
 * RTL: dir="auto" on the root so Hebrew content renders RTL and English LTR. The one spacing property
 * that is direction-sensitive, the list indent, is written logically (padding-inline-start); the rest
 * are block-direction margins, where physical and logical are the same edge in this writing mode.
 * Inline code additionally carries unicode-bidi: plaintext, which is not cosmetic - see the styles.
 *
 * Styling: this component is deliberately encapsulation: None. Everything it renders arrives through
 * [innerHTML], and Angular's emulated encapsulation works by stamping a content attribute on the nodes
 * IT creates, so an innerHTML-inserted <h1> or <code> carries no attribute and the compiled
 * `.markdown-text[_ngcontent-x] h1[_ngcontent-x]` can never match it. Under Emulated, only the host
 * rule applied and every descendant rule below was dead. The alternative, ::ng-deep on all sixteen
 * descendant rules, is deprecated and says the same thing sixteen times. Nothing leaks: every
 * selector in the block (eighteen, counting the two host rules) is
 * namespaced under .markdown-text, which only this component's template emits. The cost of the choice
 * is that a caller cannot restyle the rendered markdown by scoping a rule to its own view either, so
 * anything a surface needs from this content has to be added here, namespaced the same way.
 *
 * No i18n strings here: the component renders user/model/document content, not fixed labels.
 */

/**
 * Which kind of markdown is being rendered.
 *
 * - `compact`: local-model output inside a panel. Headings are small (<h5>/<h6>) because they are
 *   subordinate to the panel's own chrome; a single newline is a genuine `<br>` because model output
 *   uses line breaks meaningfully; an inline enumeration ("1. a 2. b") is recovered into a list
 *   because models write them that way.
 * - `document`: an authored `.md` file rendered as the page's main content. Headings are real page
 *   headings (<h1>-<h3>); source lines are HARD-WRAPPED at a column, so a single newline is a wrap and
 *   NOT a break - joining them is the difference between prose and text with a ragged edge mid-sentence
 *   at a narrow viewport - and an indented line continuing a list item belongs to that item; and an
 *   inline ordinal in authored prose is prose, never a list, so that recovery is off.
 */
export type MarkdownVariant = 'compact' | 'document';

@Component({
  selector: 'app-markdown-text',
  standalone: true,
  imports: [CommonModule],
  template: `<div
    class="markdown-text"
    [class.markdown-text--document]="variant === 'document'"
    dir="auto"
    [innerHTML]="html"></div>`,
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
    /* A block that SWITCHED direction (see the blockDirBase input) must align to its OWN start edge.
       The start keyword is resolved against the element's own direction, so this one rule serves both ways
       round, and it only ever matches a block the renderer decided to turn - a block that agrees with
       its surroundings carries no dir attribute at all. Reachable because this component's
       encapsulation is None; under Emulated it would match nothing, since these nodes arrive through
       [innerHTML] and carry no content attribute. */
    .markdown-text [dir="rtl"],
    .markdown-text [dir="ltr"] {
      text-align: start;
    }
    .markdown-text code {
      font-family: var(--pd-font-mono);
      font-size: 0.9em;
      background: var(--pd-neutral-100);
      border-radius: var(--pd-radius-sm);
      padding: 0.1em 0.35em;
      /* A code span is a LITERAL: it must read the way it would be typed, whatever direction the prose
         around it runs. Inside a Hebrew paragraph the span inherits direction: rtl, and a leading
         punctuation character is bidi-neutral, so a file extension resolved at the paragraph's RTL
         level and the leading dot landed on the far end - the import guide named the accepted format
         wrong in the sentence whose job is to name it. plaintext resolves the span's direction from
         its OWN first strong character, which is the dir="auto" rule applied per span. unicode-bidi:
         isolate does NOT fix this and was measured: it isolates the span but leaves it at the
         inherited rtl. */
      unicode-bidi: plaintext;
      /* Not word-break: break-all. break-all breaks at every line end regardless of word boundaries,
         which would split a Hebrew word mid-word at a narrow measure; anywhere only breaks a run that
         has no other break opportunity and would otherwise overflow. */
      overflow-wrap: anywhere;
    }

    /* ── document variant: a page of prose, not a panel note ─────────────────────────────────── */
    .markdown-text--document {
      font-size: var(--pd-text-body);
      line-height: 1.7;
      color: var(--pd-text);
    }
    .markdown-text--document p {
      margin: 0 0 var(--pd-space-5);
    }
    .markdown-text--document ul,
    .markdown-text--document ol {
      margin: 0 0 var(--pd-space-5);
      padding-inline-start: var(--pd-space-7);
    }
    .markdown-text--document li {
      margin: 0 0 var(--pd-space-3);
    }
    .markdown-text--document h1,
    .markdown-text--document h2,
    .markdown-text--document h3 {
      color: var(--pd-neutral-900);
      font-weight: var(--pd-weight-semibold);
      line-height: 1.3;
    }
    .markdown-text--document h1 {
      font-size: var(--pd-text-h3);
      margin: 0 0 var(--pd-space-5);
    }
    .markdown-text--document h2 {
      font-size: var(--pd-text-h4);
      margin: var(--pd-space-8) 0 var(--pd-space-4);
    }
    .markdown-text--document h3 {
      font-size: var(--pd-text-h5);
      margin: var(--pd-space-6) 0 var(--pd-space-3);
    }
  `],
  // See the class doc: [innerHTML] nodes never carry the emulated content attribute, so every
  // descendant rule above is dead under Emulated. The selectors are already namespaced under
  // .markdown-text, so turning encapsulation off scopes them exactly as tightly as before.
  encapsulation: ViewEncapsulation.None
})
export class MarkdownTextComponent {
  private _text = '';
  private _variant: MarkdownVariant = 'compact';
  private _blockDirBase: TextDirection | null = null;
  html = '';

  @Input()
  set text(value: string | null | undefined) {
    this._text = value ?? '';
    this.render();
  }
  get text(): string {
    return this._text;
  }

  /**
   * See {@link MarkdownVariant}. Defaults to `compact`, so a caller that does not set it keeps the
   * compact PARSE. That is not the same as "unchanged": inline code spans are parsed in both variants
   * and were added with the variant, and the encapsulation fix made the compact style rules apply for
   * the first time, so both of those reach every existing caller.
   */
  @Input()
  set variant(value: MarkdownVariant) {
    this._variant = value === 'document' ? 'document' : 'compact';
    this.render();
  }
  get variant(): MarkdownVariant {
    return this._variant;
  }

  /**
   * MIXED-DIRECTION rendering, opt-in (chatbot phase B, c2).
   *
   * Set it to the direction the surrounding prose runs in, and every rendered BLOCK whose own dominant
   * script disagrees gets its own `dir`. Leave it null (the default) and NOTHING changes: no block
   * carries a `dir`, which is byte-for-byte what every existing caller rendered before this input
   * existed. That default is deliberate rather than cautious - turning per-block direction on globally
   * would re-lay-out every analysis result and every guide page in the app at once, and only one
   * surface has the mixed-language problem it solves.
   *
   * See `core/i18n/text-direction.ts` for why this is script-majority and not `dir="auto"`.
   */
  @Input()
  set blockDirBase(value: TextDirection | null | undefined) {
    this._blockDirBase = value === 'rtl' || value === 'ltr' ? value : null;
    this.render();
  }
  get blockDirBase(): TextDirection | null {
    return this._blockDirBase;
  }

  private render(): void {
    this.html = renderSafeMarkdown(this._text, this._variant, this._blockDirBase);
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
 *
 * NOT applied in the `document` variant: an authored guide that writes an ordinal mid-sentence means a
 * sentence, and the file already writes its real lists one item per line.
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

/** Bold/italic. Operates on ALREADY-ESCAPED text with no code spans in it, emits only <strong>/<em>. */
function renderEmphasis(escaped: string): string {
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

/**
 * Inline transforms. Operates on ALREADY-ESCAPED text, emits only <code>/<strong>/<em>.
 *
 * Code spans are lifted out FIRST and emphasis is applied only to what is left, so `**` inside
 * `` `like_this` `` stays literal - which is the whole reason a reader would have written a code span
 * around it. The escape pass has already run, so a code span's contents are inert text no matter what
 * they contain.
 */
function renderInline(escaped: string): string {
  const codeRe = /`([^`\n]+)`/g;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = codeRe.exec(escaped)) !== null) {
    out += renderEmphasis(escaped.slice(last, match.index));
    out += `<code>${match[1]}</code>`;
    last = match.index + match[0].length;
  }
  out += renderEmphasis(escaped.slice(last));
  return out;
}

/** A block emitted during parsing: a paragraph, a list, or a heading. */
type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'h'; level: 1 | 2 | 3 | 5 | 6; text: string };

/**
 * Convert a SAFE Markdown subset to HTML. Escapes first, then transforms, so the output contains only
 * the documented safe tags. Recognized line forms (leading whitespace allowed):
 *   - `* ` / `- ` / `• `        -> unordered list item
 *   - `<n>. `                    -> ordered list item (faithful numbering via <ol start>)
 *   - `#` / `##` / `###` ...     -> heading (small <h5>/<h6> in compact, real <h1>-<h3> in document)
 *   - `` `code` ``               -> inline code
 *   - blank line                 -> block/paragraph break
 *   - single newline in a para   -> <br> in compact, a joining space in document (hard-wrapped source)
 *   - an INDENTED line right after a list item, in document -> a continuation of that item
 *   - anything else              -> paragraph text
 */
export function renderSafeMarkdown(
  raw: string,
  variant: MarkdownVariant = 'compact',
  blockDirBase: TextDirection | null = null
): string {
  if (!raw || !raw.trim()) return '';

  const isDocument = variant === 'document';

  // Normalize newlines, recover inline-enumerated lists where that applies (see splitInlineOrdinals),
  // then escape the WHOLE input up front so every downstream branch is safe.
  const normalized = raw.replace(/\r\n?/g, '\n');
  const escaped = escapeHtml(isDocument ? normalized : splitInlineOrdinals(normalized));
  const lines = escaped.split('\n');

  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let previousWasBlank = true;

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
  const indentedRe = /^\s+\S/;

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      previousWasBlank = true;
      continue;
    }

    const heading = headingRe.exec(line);
    if (heading) {
      flushParagraph();
      const depth = heading[1].length;
      const level: 1 | 2 | 3 | 5 | 6 = isDocument
        ? (depth === 1 ? 1 : depth === 2 ? 2 : 3)
        : (depth <= 2 ? 5 : 6);
      blocks.push({ kind: 'h', level, text: heading[2].trim() });
      previousWasBlank = false;
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
      previousWasBlank = false;
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
      previousWasBlank = false;
      continue;
    }

    // A hard-wrapped list item's continuation. Authored guides wrap at a column, so an item longer
    // than the column arrives as an INDENTED line with no marker; without this it would end the list
    // and become a stray paragraph mid-list. Deliberately narrow: it must be indented, it must
    // immediately follow the item (no blank line), no paragraph may be open, and the previous block
    // must be a list. A prose paragraph after a list starts at column 0 and is unaffected.
    if (isDocument && !previousWasBlank && paragraph.length === 0 && indentedRe.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last && (last.kind === 'ul' || last.kind === 'ol') && last.items.length > 0) {
        last.items[last.items.length - 1] += ' ' + line.trim();
        continue;
      }
    }

    paragraph.push(line);
    previousWasBlank = false;
  }
  flushParagraph();

  return blocks.map(block => renderBlock(block, isDocument, blockDirBase)).join('');
}

/**
 * The `dir` attribute a block needs, as markup, or `''` when it needs none.
 *
 * The SOURCE text is measured, not the rendered HTML: tag names and attribute values are Latin, so a
 * Hebrew paragraph carrying one `<strong>` would otherwise be measured as part-Latin. `blockDirection`
 * returns null both when the direction agrees with its surroundings and when there is nothing to
 * measure, and both of those mean "inherit", so one null check covers them.
 */
function dirAttr(source: string, base: TextDirection | null): string {
  if (!base) return '';
  const dir = blockDirection(source, base);
  return dir ? ` dir="${dir}"` : '';
}

function renderBlock(block: Block, isDocument: boolean, base: TextDirection | null): string {
  switch (block.kind) {
    case 'p': {
      // In a document, consecutive lines are one hard-wrapped paragraph: join them BEFORE the inline
      // pass, so emphasis that spans a wrap ("**a\nb**") still resolves. In compact, a newline is a
      // real break and each line is transformed on its own.
      const inner = isDocument
        ? renderInline(block.lines.join(' '))
        : block.lines.map(l => renderInline(l)).join('<br>');
      return `<p${dirAttr(block.lines.join(' '), base)}>${inner}</p>`;
    }
    case 'ul': {
      // The direction is decided PER ITEM as well as for the list, because a list is a container of
      // blocks: a Hebrew list quoting one English line should turn that line around and nothing else.
      // The list-level attribute is what puts the markers on the right edge.
      const items = block.items.map(i => `<li${dirAttr(i, base)}>${renderInline(i)}</li>`).join('');
      return `<ul${dirAttr(block.items.join(' '), base)}>${items}</ul>`;
    }
    case 'ol': {
      const items = block.items.map(i => `<li${dirAttr(i, base)}>${renderInline(i)}</li>`).join('');
      const startAttr = block.start !== 1 ? ` start="${block.start}"` : '';
      return `<ol${startAttr}${dirAttr(block.items.join(' '), base)}>${items}</ol>`;
    }
    case 'h': {
      return `<h${block.level}${dirAttr(block.text, base)}>${renderInline(block.text)}</h${block.level}>`;
    }
  }
}
