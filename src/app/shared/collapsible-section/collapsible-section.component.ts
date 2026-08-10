import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { readCollapseMap, writeCollapseState } from './collapse-store';

/**
 * Wave 3 / w5 - THE COLLAPSIBLE SECTION, the owner's addition to Q6.
 *
 * "Dashboard sections become collapsible at two levels (major parts, and elements inside them) WHERE IT
 * SIMPLIFIES." The qualifier is load-bearing and this component is built so that the qualifier is enforced
 * by WHERE it is mounted rather than by a flag inside it:
 *
 *  • It is a WRAPPER, so a thing that must never hide is simply not wrapped. The stage spine (either
 *    density), a status row's `blocked` warning and an open consent prompt are not children of any
 *    instance of this component, which is a stronger guarantee than a "do not collapse me" input would be.
 *  • It renders its own header as a real <button> with aria-expanded / aria-controls, so keyboard and
 *    screen-reader users get the same affordance, and the collapsed body is REMOVED from the DOM (not
 *    visually hidden) so a collapsed section cannot be tab-focused or read out.
 *
 * DEFAULT STATE = THE CURRENT LAYOUT. `defaultCollapsed` is false unless the section is a long content
 * list, because the wave's brief is explicit that this reorganization must not hide anything the author
 * sees today; the two long lists (the chapter-brief inputs and the character register) opt in.
 *
 * PERSISTENCE is per book, in localStorage, and lives in {@link collapse-store}. A stored value always
 * outranks `defaultCollapsed` - once the author has folded a section, it stays folded for that book.
 *
 * RTL: the header is a flex row that MIRRORS with the bound [dir]; the chevron is a caret glyph rotated by
 * state only (▾ / ▸ would point the wrong way in Hebrew, so the collapsed glyph is the same triangle
 * rotated toward the block axis rather than a left/right arrow). Nothing here is physically pinned.
 */
@Component({
  selector: 'app-collapsible-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="cs" [attr.dir]="dir" [attr.data-section]="sectionId" [class.cs-collapsed]="collapsed">
      <button
        type="button"
        class="cs-header"
        [attr.aria-expanded]="!collapsed"
        [attr.aria-controls]="bodyId"
        [attr.data-testid]="'collapse-toggle-' + sectionId"
        (click)="toggle()">
        <span class="cs-caret" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
        <span class="cs-title">{{ heading }}</span>
        <span class="cs-meta" *ngIf="meta">{{ meta }}</span>
      </button>
      <div class="cs-body" [id]="bodyId" *ngIf="!collapsed" [attr.data-testid]="'collapse-body-' + sectionId">
        <ng-content></ng-content>
      </div>
    </section>
  `,
  styles: [`
    .cs {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
    }
    /* A flex row with no physical left/right anywhere: it mirrors with the bound [dir]. */
    .cs-header {
      display: flex;
      align-items: center;
      gap: var(--pd-space-3);
      width: 100%;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      text-align: inherit;
      font-family: var(--pd-font-ui);
      color: var(--pd-text-secondary);
    }
    .cs-header:focus-visible {
      outline: none;
      box-shadow: var(--pd-ring);
      border-radius: var(--pd-radius-sm);
    }
    .cs-caret {
      flex: 0 0 auto;
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
    }
    .cs-title {
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-bold);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cs-meta {
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-regular);
      color: var(--pd-text-muted);
      text-transform: none;
      letter-spacing: normal;
    }
    .cs-body {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-4);
    }
  `],
})
export class CollapsibleSectionComponent implements OnChanges {
  /** Stable id for this section; the persistence key inside the book's map. Required. */
  @Input() sectionId = '';
  /** The book whose collapse map this section reads and writes. Null disables persistence. */
  @Input() bookId: string | null = null;
  /** Localized heading. The host owns the language rule; this component never translates. */
  @Input() heading = '';
  /** Optional localized sub-label rendered beside the heading (e.g. a count). */
  @Input() meta = '';
  /** Direction, bound by the host from the book language on book surfaces. */
  @Input() dir: 'rtl' | 'ltr' = 'rtl';
  /** Whether this section starts folded when the author has never touched it. Long lists opt in. */
  @Input() defaultCollapsed = false;

  /** Current fold state. Seeded from storage (or `defaultCollapsed`) and written back on every toggle. */
  collapsed = false;

  ngOnChanges(changes: SimpleChanges): void {
    // Re-seed on a book switch (a different book has a different stored map) and on a defaults change.
    if (changes['bookId'] || changes['sectionId'] || changes['defaultCollapsed']) {
      const stored = readCollapseMap(this.bookId)[this.sectionId];
      this.collapsed = typeof stored === 'boolean' ? stored : this.defaultCollapsed;
    }
  }

  /** DOM id for aria-controls; derived so two sections on one page cannot collide. */
  get bodyId(): string {
    return `cs-body-${this.sectionId}`;
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    writeCollapseState(this.bookId, this.sectionId, this.collapsed);
  }
}
