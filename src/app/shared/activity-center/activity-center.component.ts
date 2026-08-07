import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  inject,
  OnDestroy,
} from '@angular/core';
import { AsyncPipe, NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subject, combineLatest, timer } from 'rxjs';
import { map, startWith, takeUntil } from 'rxjs/operators';

import {
  JobKind,
  JobRegistryService,
  JobStatus,
  TrackedJob,
  isTerminal,
  showsChunkCounts,
} from '../../core/services/job-registry.service';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { formatRelativeTime } from '../../core/utils/relative-time';

// ── i18n label map (app-level chrome: Hebrew-default) ────────────────────────
// DRAFT he - needs native review
// Exported for label-parity unit tests (tests assert LABELS_HE and LABELS_EN have identical key sets).
export const LABELS_HE: Record<string, string> = {
  panelTitle:          'מרכז פעילות',       // DRAFT he - needs native review
  emptyState:          'אין פעילות כרגע',   // DRAFT he - needs native review
  view:                'צפייה',              // DRAFT he - needs native review
  // status pills
  running:        'בריצה',             // DRAFT he - needs native review
  pending:        'ממתין',             // DRAFT he - needs native review
  succeeded:      'הסתיים',            // DRAFT he - needs native review
  failed:         'נכשל',              // DRAFT he - needs native review
  canceled:       'בוטל',             // DRAFT he - needs native review
  // kind labels
  summary:           'סיכום',          // DRAFT he - needs native review
  review:            'סקירה',          // DRAFT he - needs native review
  proofread:         'הגהה',           // DRAFT he - needs native review
  'style-baseline':  'קו סגנון',       // DRAFT he - needs native review
  'whole-book-analysis': 'ניתוח כולל', // DRAFT he - needs native review
};

export const LABELS_EN: Record<string, string> = {
  panelTitle:          'Activity Center',
  emptyState:          'No activity yet',
  view:                'View',
  // status pills
  running:        'Running',
  pending:        'Pending',
  succeeded:      'Done',
  failed:         'Failed',
  canceled:       'Canceled',
  // kind labels
  summary:           'Summary',
  review:            'Review',
  proofread:         'Proofread',
  'style-baseline':  'Style baseline',
  'whole-book-analysis': 'Whole-book analysis',
};

/** Per-kind icon glyph (no icon library - pure Unicode/emoji). */
const KIND_ICONS: Record<JobKind, string> = {
  summary:             '📋',
  review:              '🔍',
  proofread:           '✏️',
  'style-baseline':    '📐',
  'whole-book-analysis': '📖',
};

/** Status pill color class mapping. */
const STATUS_CLASS: Record<JobStatus, string> = {
  running:   'status-running',
  pending:   'status-pending',
  succeeded: 'status-done',
  failed:    'status-failed',
  canceled:  'status-canceled',
};

/**
 * rf-f01: the Activity Center, now the ACTIVITY TAB of the app dock (merged in chatbot phase A.1, w1).
 *
 * Reads job state from JobRegistryService. App-level chrome is Hebrew-default (RTL).
 *
 * ── What the merge took away, and what it deliberately kept ────────────────────────────────────────
 * GONE: the fixed bell in the top inline-start corner, its backdrop, and the fixed slide-over shell.
 * The bell is gone rather than restyled because that corner is where the assistant's own header sits
 * in Hebrew, and a bell there overlapped the word "עוזר"; a moved-but-still-present second affordance
 * would have left the overlap one layout change away. The single dock launcher at the bottom carries
 * the bell's live job badge, which was the bell's reason to exist.
 *
 * KEPT, unchanged on purpose: `panelOpen` still routes through {@link AppOverlayService}, exactly the
 * seam c2 introduced. It now means "the activity TAB is the one showing" rather than "this overlay
 * won the exclusion", which is the same question from the panel's point of view, so every caller and
 * every spec that drives `panelOpen` still reads correctly. Gating the content on it is what keeps
 * this tab's rows out of the assistant tab, and the component stays MOUNTED across tab switches so
 * neither tab's state is thrown away by the other.
 *
 * RTL approach: the host [dir] attribute is set from the app language (Hebrew -> rtl). The dock owns
 * the drawer's edge and its slide; this component contributes no fixed positioning of its own.
 *
 * Per-row title language: since the Activity Center is app-level chrome (not book-scoped), we do not
 * have a reliable per-row book language at render time. We use the app language (Hebrew by default)
 * and show `titleHe` for Hebrew app language, `titleEn` for English. This is documented in the
 * component for future per-row language enrichment if TrackedJob gains a bookLanguage field.
 *
 * No em-dash in any user-facing string.
 */
@Component({
  selector: 'app-activity-center',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, NgClass, RouterLink],
  template: `
    <!-- The ACTIVITY TAB BODY of the app dock. No bell, no backdrop, no panel chrome of its own: the
         dock owns the launcher, the drawer shell, the tab strip (which carries this panel's title) and
         the close control. What is left here is the content, rendered only while this tab is the one
         showing, which is what keeps it out of the assistant tab. -->
    @if (panelOpen) {
      <div id="ac-panel" class="ac-panel">
        <div class="ac-panel-body">
          @let jobs = (jobs$ | async) ?? [];
          @if (jobs.length === 0) {
            <div class="ac-empty">{{ label('emptyState') }}</div>
          } @else {
            @for (job of jobs; track job.id) {
              <div class="ac-row" [class]="'ac-row--' + job.status">
                <!-- Kind icon + scope + title -->
                <div class="ac-row-top">
                  <span class="ac-kind-icon" aria-hidden="true">{{ kindIcon(job.kind) }}</span>
                  <span class="ac-scope">{{ job.scopeLabel }}</span>
                  <span class="ac-title">{{ rowTitle(job) }}</span>
                </div>

                <!-- Progress bar: determinate rows carry aria value attrs AND a numeric percent
                     readout (so progress is legible, not just a bar); indeterminate rows omit both
                     (no reliable number yet) so no ambiguous aria-valuenow="null" is emitted.
                     THIRD case (c05): a row whose job is already TERMINAL but never learned a percent
                     (a failed job whose poll errored before any chunk count arrived, a canceled one)
                     is neither. It used to fall into the indeterminate branch and pulse an infinite
                     animation next to its own "Failed" / "Canceled" pill, and announce itself to a
                     screen reader as a live task of unknown size. Such a row is now an inert bar that
                     is not a progressbar at all. Kept identical to the run dialog's
                     .rd-progress-track--ended branch and the in-page indicator's .jpi-track--ended:
                     the three surfaces must agree, which is the whole point of Wave 1d. -->
                @if (job.percent !== null) {
                  <div class="ac-progress-row">
                    <div class="ac-progress-track" role="progressbar"
                      [attr.aria-valuenow]="job.percent"
                      aria-valuemin="0"
                      aria-valuemax="100">
                      <!-- Determinate -->
                      <div class="ac-progress-fill ac-progress-fill--det"
                        [style.width.%]="job.percent"></div>
                    </div>
                    <!-- c04: the compact chunk counts. Same two registry fields the run dialog spells
                         out as a localized sentence and the in-page indicator shows the same way here;
                         "3/10" is language-neutral, which suits this app-level (Hebrew-default) chrome
                         because it needs no per-row book language to render.
                         c02: the decision of WHICH rows get them is the registry's, not this template's.
                         showsChunkCounts is the one predicate all three surfaces ask, and it is false
                         for a row with no chunk shape (a single-shot analysis, a poll before chunking)
                         AND for a review row, whose denominator counts map-reduce windows plus a
                         variable number of reduce passes rather than anything a reader could name. A
                         summary / style-baseline row DOES show counts: its denominator is the book's
                         chapters. See CHUNK_COUNT_KINDS for the per-kind units. -->
                    @if (showsCounts(job)) {
                      <span class="ac-progress-counts" aria-hidden="true">{{ job.completedChunks ?? 0 }}/{{ job.totalChunks }}</span>
                    }
                    <span class="ac-progress-percent" aria-hidden="true">{{ job.percent }}%</span>
                  </div>
                } @else if (isEnded(job.status)) {
                  <!-- Over, and no percent was ever known: inert, and NOT a progressbar. -->
                  <div class="ac-progress-track ac-progress-track--ended" aria-hidden="true"></div>
                } @else {
                  <div class="ac-progress-track" role="progressbar">
                    <!-- Indeterminate animation -->
                    <div class="ac-progress-fill ac-progress-fill--indet"></div>
                  </div>
                }

                <!-- Meta row: time + status pill + view link -->
                <div class="ac-row-meta">
                  <span class="ac-time">{{ relativeTime(job.updatedAt) }}</span>
                  <span class="ac-status-pill" [ngClass]="statusClass(job.status)">
                    {{ label(job.status) }}
                  </span>
                  @if (job.resultRoute) {
                    <a class="ac-view-link" [routerLink]="job.resultRoute" (click)="closePanel()">
                      {{ label('view') }}
                    </a>
                  }
                </div>
              </div>
            }
          }
        </div>
      </div>
    }
  `,
  styleUrl: './activity-center.component.scss',
})
export class ActivityCenterComponent implements OnDestroy {
  private readonly registry = inject(JobRegistryService);
  private readonly overlays = inject(AppOverlayService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Emits once on destroy to tear down all internal subscriptions. */
  private readonly destroy$ = new Subject<void>();

  /** Mirror of the shared overlay state, so the OnPush template has a plain field to read. */
  private panelOpenState = false;

  constructor() {
    // The open/closed state of this panel is OWNED by AppOverlayService, not by this component
    // (chatbot phase A, c2; re-pointed at the dock's tab selection in phase A.1, w1). The dock is a
    // single drawer with two tabs, so "showing" means the activity tab is the selected one. The state
    // therefore arrives by subscription (the dock, or a sibling tab, can change it) and marks for check.
    this.overlays
      .isTabShowing$('activity')
      .pipe(takeUntil(this.destroy$))
      .subscribe(showing => {
        this.panelOpenState = showing;
        this.cdr.markForCheck();
      });
  }

  /**
   * Whether this panel's content is on screen. Reads the mirrored field; ASSIGNING routes through the
   * shared service, so `panelOpen = true` still works from a template, a spec, or a handler and still
   * cannot put two tabs' content on screen at once.
   */
  get panelOpen(): boolean {
    return this.panelOpenState;
  }

  set panelOpen(open: boolean) {
    if (open) this.overlays.openTab('activity');
    else this.overlays.closeTab('activity');
  }

  /**
   * App-level chrome language. Hebrew-default per app-level i18n convention.
   * Hardcoded to 'he' for now (no global i18n service exists); change here when one is added.
   */
  private readonly appLang: 'he' | 'en' = 'he';

  /** Dir bound to the host element so the panel follows the app language direction. */
  @HostBinding('attr.dir')
  get dir(): 'rtl' | 'ltr' {
    return this.appLang === 'he' ? 'rtl' : 'ltr';
  }

  /**
   * All tracked jobs, newest-first. The registry stores jobs in insertion order (oldest first per
   * the BehaviorSubject upsert), so we sort by updatedAt descending here for newest-first display.
   *
   * A low-frequency timer (60s cadence) is merged in via combineLatest so that the async pipe
   * re-renders once a minute even after terminal jobs stop emitting from the registry. This keeps
   * "לפני X דקות" / "X minutes ago" from freezing at finalize time.
   */
  readonly jobs$ = combineLatest([
    this.registry.jobs$,
    timer(60_000, 60_000).pipe(startWith(0), takeUntil(this.destroy$)),
  ]).pipe(
    map(([jobs]) => [...jobs].sort((a, b) => {
      const timeDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      // Secondary tiebreak by id for stable order when timestamps are equal.
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    })),
  );

  // The live job COUNT is not read here any more: it belongs to the dock's single launcher (and to
  // the activity tab itself while the drawer is open), because that is the affordance the author sees
  // when this panel is closed. See `AppDockComponent.activeCount$`.

  /**
   * Dismiss this tab's panel (a row's "view" link navigates, so it closes the dock behind itself).
   *
   * Guarded by the service against a stale close: if the author has already switched to the assistant
   * tab, this does nothing rather than closing the drawer out from under them.
   */
  closePanel(): void {
    this.overlays.closeTab('activity');
  }

  // Escape is handled ONCE, by the dock that owns the drawer. A second document-level handler here
  // would race the dock's for the same gesture and close the same surface twice.

  /** Resolve localized label from the app-language map. */
  label(key: string): string {
    const map = this.appLang === 'he' ? LABELS_HE : LABELS_EN;
    return map[key] ?? key;
  }

  /**
   * Per-row title: uses the app language to pick titleHe vs titleEn.
   * Rationale: the Activity Center is app-level chrome (Hebrew-default); we do not have a reliable
   * per-row book language at this level. A future enhancement could add bookLanguage to TrackedJob.
   * Fallback: if the chosen title is empty, fall back to the other language.
   */
  rowTitle(job: TrackedJob): string {
    if (this.appLang === 'he') {
      return job.titleHe || job.titleEn;
    }
    return job.titleEn || job.titleHe;
  }

  kindIcon(kind: JobKind): string {
    return KIND_ICONS[kind] ?? '⚙️';
  }

  statusClass(status: JobStatus): string {
    return STATUS_CLASS[status] ?? '';
  }

  /**
   * Whether a row's job is over (c05). The registry's own `isTerminal` predicate is reused rather than
   * hand-rolled, so "over" means exactly what it means everywhere else. Only the progress bar reads
   * this: a terminal row with a null percent must not render the pulsing indeterminate treatment.
   */
  isEnded(status: JobStatus): boolean {
    return isTerminal(status);
  }

  /**
   * Whether this row may render the bare `completed/total` pair (c02). Delegates to the registry's
   * {@link showsChunkCounts} rather than re-testing `totalChunks !== null` here, so the Activity Center,
   * the in-page indicator and the run dialog cannot end up disagreeing about which KINDS show counts.
   * This surface is the one that sees every kind, so it is the one the widening actually bit.
   */
  showsCounts(job: TrackedJob): boolean {
    return showsChunkCounts(job);
  }

  relativeTime(isoUtc: string | null | undefined): string {
    return formatRelativeTime(isoUtc, this.appLang);
  }

  ngOnDestroy(): void {
    // Unsubscribe FIRST, so releasing the tab below cannot call markForCheck on a view that is on its
    // way out.
    this.destroy$.next();
    this.destroy$.complete();
    // A destroyed tab body must not leave the app believing this tab is still showing. Scoped to THIS
    // tab, so tearing it down while the author is reading the assistant tab closes nothing.
    this.overlays.closeTab('activity');
  }
}
