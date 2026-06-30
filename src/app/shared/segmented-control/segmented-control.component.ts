import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

/** A single selectable segment in the {@link SegmentedControlComponent}. */
export interface SegmentedOption {
  /** Stable value emitted when this segment is selected. */
  value: string;
  /** Already-localized display label (the component is language-agnostic). */
  label: string;
  /** Optional leading glyph/emoji rendered before the label. */
  icon?: string;
  /** Optional count rendered as a pill badge after the label. */
  count?: number;
}

/**
 * SegmentedControl - a single-select pill row that replaces nested tabs.
 *
 * Styling follows the PageDraft design reference (SegmentedControl spec) using
 * `--pd-*` tokens only. The component is language-agnostic: labels are passed in
 * already localized. Two-way bindable via `[(value)]`.
 */
@Component({
  selector: 'app-segmented-control',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="seg-track"
      [class.seg-sm]="size === 'sm'"
      [class.seg-full]="full"
      role="radiogroup"
      [attr.aria-label]="ariaLabel || null"
      [attr.dir]="rtl ? 'rtl' : null">
      @for (opt of options; track opt.value; let i = $index) {
        <button
          type="button"
          class="seg"
          role="radio"
          [class.active]="opt.value === value"
          [attr.aria-checked]="opt.value === value"
          [attr.tabindex]="opt.value === value ? 0 : -1"
          (click)="select(opt.value)"
          (keydown)="onKeydown($event, i)">
          @if (opt.icon) {
            <span class="seg-icon" aria-hidden="true">{{ opt.icon }}</span>
          }
          <span class="seg-label">{{ opt.label }}</span>
          @if (opt.count != null) {
            <span class="seg-count">{{ opt.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: [`
    .seg-track {
      display: inline-flex;
      gap: var(--pd-space-1);
      padding: 3px;
      background: var(--pd-neutral-100);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
    }
    .seg-track.seg-full {
      display: flex;
      width: 100%;
    }

    .seg {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--pd-space-2);
      padding: var(--pd-space-3) var(--pd-space-5);
      border: 0;
      border-radius: var(--pd-radius-sm);
      background: transparent;
      color: var(--pd-text-secondary);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
      font-weight: var(--pd-weight-medium);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--pd-dur-fast) var(--pd-ease),
                  color var(--pd-dur-fast) var(--pd-ease),
                  box-shadow var(--pd-dur-fast) var(--pd-ease);
    }
    /* Inactive segments use weight 600 per spec (between medium and bold). */
    .seg { font-weight: var(--pd-weight-semibold); }

    .seg-track.seg-full .seg {
      flex: 1 1 0;
    }

    .seg:hover:not(.active) {
      color: var(--pd-text);
    }

    .seg:focus-visible {
      outline: none;
      box-shadow: var(--pd-ring);
    }

    .seg.active {
      background: var(--pd-surface);
      color: var(--pd-primary-700);
      box-shadow: var(--pd-shadow-1);
      font-weight: var(--pd-weight-bold);
    }

    .seg-icon {
      display: inline-flex;
      font-size: 1em;
      line-height: 1;
    }

    .seg-label {
      min-width: 0;
    }

    .seg-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      padding: 0 var(--pd-space-2);
      border-radius: var(--pd-radius-pill);
      background: var(--pd-neutral-200);
      color: var(--pd-text-secondary);
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
      font-weight: var(--pd-weight-bold);
      font-variant-numeric: tabular-nums;
    }
    .seg.active .seg-count {
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
    }

    /* --- size: sm (smaller pad/font) ------------------------------------- */
    .seg-track.seg-sm .seg {
      padding: var(--pd-space-2) var(--pd-space-3);
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
    }
    .seg-track.seg-sm .seg-count {
      min-width: 1.1rem;
      font-size: 11px;
    }
  `]
})
export class SegmentedControlComponent {
  /** Segments to render (already-localized labels). */
  @Input() options: SegmentedOption[] = [];
  /** Currently selected segment value (two-way bindable via `[(value)]`). */
  @Input() value = '';
  /** Visual density. */
  @Input() size: 'sm' | 'md' = 'md';
  /** When true the track stretches and each segment grows equally. */
  @Input() full = true;
  /** When true the track lays out right-to-left (logical props keep it correct). */
  @Input() rtl = false;
  /** Optional accessible name for the radiogroup (consumers should label single-purpose controls). */
  @Input() ariaLabel?: string;

  /** Emits the newly selected value (drives `[(value)]`). */
  @Output() valueChange = new EventEmitter<string>();

  /** Select a segment by value, emitting only on an actual change. */
  select(value: string): void {
    if (value === this.value) return;
    this.value = value;
    this.valueChange.emit(value);
  }

  /**
   * Arrow-key navigation between segments. Left/Right move focus and selection.
   * In RTL the visual direction is flipped so the arrows feel natural.
   */
  onKeydown(event: KeyboardEvent, index: number): void {
    const key = event.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault();

    const count = this.options.length;
    if (count === 0) return;

    // Map the physical arrow to a logical step (+1 = next, -1 = prev),
    // flipping for RTL so ArrowRight always moves toward the start in RTL.
    let step = key === 'ArrowRight' ? 1 : -1;
    if (this.rtl) step = -step;

    const nextIndex = (index + step + count) % count;
    const next = this.options[nextIndex];
    if (!next) return;

    this.select(next.value);
    this.focusSegment(event, nextIndex);
  }

  /** Move DOM focus to the segment button at the given index. */
  private focusSegment(event: Event, index: number): void {
    const track = (event.target as HTMLElement)?.closest('.seg-track');
    const buttons = track?.querySelectorAll<HTMLButtonElement>('.seg');
    buttons?.[index]?.focus();
  }
}
