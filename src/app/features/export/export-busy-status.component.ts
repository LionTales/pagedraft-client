import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { Subject, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { EXPORT_COPY, ExportLang } from './export-kinds';

/** After this long in flight, a proofread export says that it can take minutes. */
export const EXPORT_LONG_NOTE_AFTER_MS = 10_000;

/** The long-wait line, shown only for the proofread kinds. DRAFT he - needs native review. */
export const EXPORT_BUSY_COPY = {
  longNote: {
    // DRAFT he - needs native review
    he: 'ייצוא עם הגהה עשוי לקחת כמה דקות',
    en: 'A proofread export can take a few minutes',
  },
} satisfies Record<string, Record<ExportLang, string>>;

/** mm:ss from milliseconds, minutes unbounded (a 75 minute wait reads 75:00), seconds always two digits. */
export function formatExportElapsed(elapsedMs: number): string {
  const total = Math.floor(Math.max(0, elapsedMs) / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * f7: the in-progress line on an export kind's row. The page mounts it with `@if (busyKindId === kind.id)`,
 * so its lifetime IS the request's: the timer starts at construction and is torn down at destroy, which
 * covers success, error and navigating away with one mechanism and no state to reset.
 *
 * Elapsed time is `Date.now() - start`, not a tick count, so a throttled background tab still shows the
 * true wait. The 1 s interval is a plain rxjs `timer` (the app's idiom, see `activity-center`); it only
 * repaints a number, so none of the `onStable` geometry concerns apply.
 *
 * Live region: only the status words and the long note are announced (`aria-live="polite"`). The ticking
 * clock is `aria-hidden`, otherwise a screen reader would read out every second.
 *
 * RTL: `[dir]` follows the book language through the inherited page `dir`. The clock is
 * `unicode-bidi: isolate` + `direction: ltr` so digits and the colon never reorder inside a Hebrew line;
 * the spinner is physically fixed (a rotation has no reading direction).
 */
@Component({
  selector: 'app-export-busy-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="busy-line" role="status" aria-live="polite" [attr.aria-label]="t(COPY.preparingAria)" data-testid="export-busy-line">
      <span class="busy-spinner" aria-hidden="true"></span>
      <span>{{ t(COPY.preparing) }}</span>
      <span class="busy-clock" aria-hidden="true" data-testid="export-busy-elapsed">{{ clock }}</span>
    </p>
    @if (longRunNote && elapsedMs >= LONG_AFTER) {
      <p class="busy-note" role="status" aria-live="polite" data-testid="export-busy-long-note">
        {{ t(BUSY_COPY.longNote) }}
      </p>
    }
  `,
  styles: [`
    :host { display: block; }
    .busy-line, .busy-note {
      margin: 0;
      font-size: var(--pd-text-body-sm);
      color: var(--pd-info);
    }
    .busy-line { display: flex; flex-direction: row; align-items: center; gap: var(--pd-space-2); }
    .busy-note { margin-block-start: var(--pd-space-1); color: var(--pd-text-secondary); }
    .busy-clock { unicode-bidi: isolate; direction: ltr; font-variant-numeric: tabular-nums; }
    .busy-spinner {
      inline-size: 12px;
      block-size: 12px;
      border: 2px solid color-mix(in srgb, var(--pd-info) 30%, transparent);
      border-top-color: var(--pd-info);
      border-radius: 50%;
      animation: export-busy-spin 0.8s linear infinite;
    }
    @keyframes export-busy-spin { to { transform: rotate(360deg); } }
  `],
})
export class ExportBusyStatusComponent implements OnInit, OnDestroy {
  /** The book language; the page passes its own `lang`. */
  @Input() lang: ExportLang = 'he';
  /** True for the proofread kinds: they get the "can take a few minutes" line after 10 s. */
  @Input() longRunNote = false;

  readonly COPY = EXPORT_COPY;
  readonly BUSY_COPY = EXPORT_BUSY_COPY;
  readonly LONG_AFTER = EXPORT_LONG_NOTE_AFTER_MS;

  elapsedMs = 0;
  private readonly started = Date.now();
  private readonly destroy$ = new Subject<void>();
  private readonly cdr = inject(ChangeDetectorRef);

  get clock(): string {
    return formatExportElapsed(this.elapsedMs);
  }

  t(bi: Record<ExportLang, string>): string {
    return bi[this.lang];
  }

  ngOnInit(): void {
    timer(1000, 1000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.elapsedMs = Date.now() - this.started;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
