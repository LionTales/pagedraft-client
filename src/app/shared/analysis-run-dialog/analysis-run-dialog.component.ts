import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { ANALYSIS_TYPE_LABELS } from '../../core/models/analysis';
import { AnalysisRunEvent, assertUnhandledRunEvent } from '../../core/services/analysis-run-orchestration.service';
import {
  JobRegistryService,
  TerminalStatus,
  TrackedJob,
  isTerminal,
} from '../../core/services/job-registry.service';

// ── i18n label maps (BOOK-scoped chrome: follows the book language, not the app language) ──────────
// Exported for label-parity unit tests (tests assert both maps have identical key sets and that no
// value contains an em-dash).
/** Closed union of every label key this dialog looks up. A typo'd key is now a compile error. */
export type RunDialogLabelKey =
  | 'dialogAria'
  | 'analysis'
  | 'starting'
  | 'minimize'
  | 'close'
  | 'keepsRunning'
  | 'running'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'canceled';

// DRAFT he - needs native review
export const RUN_DIALOG_LABELS_HE: Record<RunDialogLabelKey, string> = {
  dialogAria:  'התקדמות ניתוח',              // DRAFT he - needs native review (aria-label)
  analysis:    'ניתוח',                      // DRAFT he - needs native review (title fallback)
  starting:    'מתחיל...',                   // DRAFT he - needs native review
  minimize:    'מזעור',                      // DRAFT he - needs native review
  close:       'סגירה',                      // DRAFT he - needs native review
  keepsRunning: 'הפעולה תמשיך לרוץ ברקע',    // DRAFT he - needs native review
  // status pills (same vocabulary as the Activity Center)
  running:     'בריצה',                      // DRAFT he - needs native review
  pending:     'ממתין',                      // DRAFT he - needs native review
  succeeded:   'הסתיים',                     // DRAFT he - needs native review
  failed:      'נכשל',                       // DRAFT he - needs native review
  canceled:    'בוטל',                       // DRAFT he - needs native review
};

export const RUN_DIALOG_LABELS_EN: Record<RunDialogLabelKey, string> = {
  dialogAria:  'Analysis progress',
  analysis:    'Analysis',
  starting:    'Starting...',
  minimize:    'Minimize',
  close:       'Close',
  keepsRunning: 'This keeps running in the background',
  running:     'Running',
  pending:     'Pending',
  succeeded:   'Done',
  failed:      'Failed',
  canceled:    'Canceled',
};

/** The subset of {@link RunDialogLabelKey} that denotes a run status (vs. static chrome copy). */
export type RunDialogStatusKey = TerminalStatus | 'running' | 'pending';

/** Status pill colour class mapping (mirrors the Activity Center's row pills). */
const STATUS_CLASS: Record<RunDialogStatusKey, string> = {
  running:   'status-running',
  pending:   'status-pending',
  succeeded: 'status-done',
  failed:    'status-failed',
  canceled:  'status-canceled',
};

/**
 * The dialog's d1 state machine.
 *  - `hidden`    : not open.
 *  - `starting`  : (a) open, no trackable jobId yet. Indeterminate, NO minimize.
 *  - `tracked`   : (b) a registry-tracked, non-terminal job drives the view. Minimize available.
 *  - `terminal`  : (c) the run is over. No minimize; plain close.
 */
export type RunDialogState = 'hidden' | 'starting' | 'tracked' | 'terminal';

/**
 * Payload of the minimize gesture. `originRect` is the LIVE bounding rect of the dialog card at the
 * moment of the gesture, so the fly-to-bell transition can be computed from real geometry instead of a
 * hardcoded physical corner (the Activity Center bell sits at `inset-inline-start`, which FLIPS between
 * RTL and LTR). c2 owns the animation; this is the seam it wires to.
 */
export interface RunDialogMinimizeEvent {
  jobId: string;
  originRect: DOMRect | null;
}

/**
 * Wave 1d: the analysis run-progress dialog.
 *
 * A VIEW over {@link JobRegistryService}. It adds NO poller, NO second `track()` call site
 * (`analysis-panel.component.ts` remains the only one) and NO progress normalization of its own:
 * once a run is registry-tracked, percent AND message come from `jobById$(jobId)` and nowhere else.
 *
 * ── The d1 contract (authoritative), in one place ──────────────────────────────────────────────────
 * `jobId` is captured ONLY from the `'job-started'` AnalysisRunEvent. The sync response's
 * `result.jobId` is deliberately IGNORED: that id was minted inside a blocking `/analyze` call and was
 * never seeded into the server's AnalysisProgressTracker, so polling it 404s every time, and the
 * registry's `error: () => finalize(jobId, 'failed')` would report a SUCCESSFUL run as FAILED. The raw
 * stream's `'progress'` events are ignored for the same reason (they are that doomed poll's output).
 *
 *   state = !open                       -> hidden
 *         | terminal latched            -> (c) terminal
 *         | jobId != null && job != null-> (b) tracked
 *         | otherwise                   -> (a) starting
 *
 * `(a) -> (b)` fires purely off `job-started` followed by `jobById$` resolving non-null, at ANY elapsed
 * time (no timeout, no auto-fail). `(a) -> (c)` fires off `sync-result` / `job-result` /
 * `streaming-complete` / `error` / `run-finished` while no jobId has been captured. `(b) -> (c)` fires
 * purely off `jobById$` reporting a terminal status. Terminal latches EXACTLY ONCE per run.
 *
 * `run-finished` (c01) is the panel's own terminal rather than an orchestration event: it says the run is
 * over with nothing to report, which today means it was cancelled by the panel being destroyed mid-run or
 * never started because a pre-run save rejected. Without it the dialog outlives its emitter and keeps a
 * live indeterminate bar up for a run that no longer exists - the panel is `@if`-mounted in the editor and
 * this dialog is not, so the panel really can vanish while this card is on screen.
 *
 * `result-dropped` (c06) is the other panel-emitted member, and it is the ONE signal that resolves the
 * card to nothing rather than to a terminal: it says the run produced a result and the panel discarded it
 * as belonging to a chapter/scene the user has left. Latching any status there would be a lie in both
 * directions ("Done" for suggestions no surface ever showed, "Canceled" for a run that succeeded), so an
 * UNTRACKED card simply closes. Same `jobId === null` fence as `run-finished`.
 *
 * ── Close vs cancel ────────────────────────────────────────────────────────────────────────────────
 * There is NO cancel affordance: no cancel endpoint exists (neither AnalysisController nor any client
 * service exposes one; the only server-side cancellation is application shutdown). Closing therefore
 * never stops a run. In state (b) closing IS minimizing (the job stays tracked and stays visible in the
 * Activity Center), which is why the header dismiss button relabels itself "Minimize" there. In (a) and
 * (c) closing just dismisses the view: in (a) the run continues because the panel, not this dialog,
 * owns the HTTP subscription, but nothing is registry-tracked yet so there is nothing to minimize into.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────────────────────────────
 * A positioned card, NOT a full-screen blocker: no dimming backdrop, no focus trap, `aria-modal=false`,
 * and no click-blocking layer, so the chapter behind it stays readable AND interactive. The progress
 * markup (determinate row with aria-valuenow/valuemin/valuemax + numeric readout; indeterminate pulse
 * with no ambiguous aria-valuenow; and, for a run that is OVER with no percent ever learned, an inert
 * bar that is not a progressbar at all - c05) mirrors the Activity Center row and the in-page indicator
 * exactly, so a screen reader gets the same contract on all three surfaces.
 *
 * Because it is modeless, it also does NOT claim any global key: Escape is bound on the card element,
 * so it dismisses only when focus is genuinely inside the card and the editor behind it keeps its own
 * Escape gestures (c04).
 *
 * ── Mounting (c2 wires this) ───────────────────────────────────────────────────────────────────────
 * The host creates a hot `Subject<AnalysisRunEvent>` and `next()`s every event it already handles into
 * it (the dialog must NOT subscribe to the cold run observable directly - that would re-issue the
 * HTTP request). Then:
 *   <app-analysis-run-dialog
 *     [(open)]="runDialogOpen"
 *     [runEvents]="runEvents$"
 *     [analysisType]="selectedAnalysisType"
 *     [bookLanguage]="bookLanguage"
 *     (minimizeRequested)="onRunDialogMinimize($event)">
 *   </app-analysis-run-dialog>
 * Set `open = true` when a run starts; the false -> true transition is the run boundary that resets
 * the dialog's state.
 *
 * No em-dash in any user-facing string.
 */
@Component({
  selector: 'app-analysis-run-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state !== 'hidden') {
      <div
        #card
        class="rd-card"
        role="dialog"
        aria-modal="false"
        (keydown.escape)="dismiss()"
        [attr.aria-label]="title + ' · ' + label('dialogAria')">

        <div class="rd-header">
          @if (scopeLabel; as scope) {
            <span class="rd-scope">{{ scope }}</span>
          }
          <span class="rd-title">{{ title }}</span>
          <span class="rd-status-pill" [class]="'rd-status-pill ' + statusClass">{{ statusLabel }}</span>
          <button
            class="rd-dismiss"
            type="button"
            [attr.aria-label]="dismissLabel"
            (click)="dismiss()">&#x2715;</button>
        </div>

        <!-- Progress. THREE cases, because a null percent means two different things (c05):
             1. a KNOWN percent -> determinate: aria-valuenow/valuemin/valuemax plus a numeric readout.
                Identical markup on all three surfaces; three-surface-parity.spec.ts pins it.
             2. no percent and the run is OVER (state (c)) -> an INERT bar. See the comment below.
             3. no percent and the run is still GOING (states (a)/(b)) -> the indeterminate pulse, with
                the aria value attrs omitted so no ambiguous aria-valuenow="null" is emitted.
             Cases 2 and 3 used to be one branch, so a terminal card whose percent was never learned
             (an 'error' terminal, or c01's 'run-finished' -> canceled, or a registry 'failed' with no
             percent) pulsed an infinite CSS keyframe animation next to its own "Failed"/"Canceled"
             pill. The animation is keyed on the STATE MACHINE now, not on percent nullity; the percent
             getter itself is unchanged (d1 item 6 depends on it exactly as it is). -->
        @if (percent !== null) {
          <div class="rd-progress-row">
            <div class="rd-progress-track" role="progressbar"
              [attr.aria-valuenow]="percent"
              aria-valuemin="0"
              aria-valuemax="100">
              <div class="rd-progress-fill rd-progress-fill--det" [style.width.%]="percent"></div>
            </div>
            <span class="rd-progress-percent" aria-hidden="true">{{ percent }}%</span>
          </div>
        } @else if (state === 'terminal') {
          <!-- ARIA DECISION (c05): a finished run with no known percent is NOT a progressbar, so this
               branch drops role="progressbar" entirely rather than merely dropping the animation.
               ARIA defines a progressbar with no aria-valuenow as an INDETERMINATE one, i.e. "a task is
               in progress, amount unknown" - a screen reader would announce a live task on a card whose
               own status pill says the run is over, and it would announce it BEFORE the pill. Nothing is
               lost by removing it: the outcome is already carried by the localized status pill and by
               the .rd-message paragraph, which is role="status" aria-live="polite". The empty track is
               kept purely so the card does not jump when a run latches terminal while the user is
               looking at it, and it is aria-hidden because it now carries no information at all.
               NOTE the asymmetry with case 1: a terminal run that DOES know its percent (succeeded at
               100%, or a failed run holding its last known 60%) keeps the full progressbar contract,
               because that number is real and the three-surface aria parity is pinned on it. -->
          <div class="rd-progress-track rd-progress-track--ended" aria-hidden="true"></div>
        } @else {
          <div class="rd-progress-track" role="progressbar">
            <div class="rd-progress-fill rd-progress-fill--indet"></div>
          </div>
        }

        <p class="rd-message" role="status" aria-live="polite">{{ message }}</p>

        @if (canMinimize) {
          <div class="rd-actions">
            <button class="rd-minimize" type="button" (click)="minimize()">
              {{ label('minimize') }}
            </button>
            <span class="rd-hint">{{ label('keepsRunning') }}</span>
          </div>
        }
      </div>
    }
  `,
  styleUrl: './analysis-run-dialog.component.scss',
})
export class AnalysisRunDialogComponent implements OnChanges, OnDestroy {
  private readonly registry = inject(JobRegistryService);
  private readonly cdr = inject(ChangeDetectorRef);

  /**
   * Whether the dialog is showing. Intended to be bound two-way (`[(open)]`): the dialog sets it false
   * when dismissed/minimized. A false -> true transition is the RUN BOUNDARY and resets all state.
   */
  @Input() open = false;

  /**
   * HOT stream of the run's events, pushed by the host. Must not be the cold orchestration observable
   * (subscribing to that would start a second HTTP run).
   */
  @Input() runEvents: Observable<AnalysisRunEvent> | null = null;

  /** The analysis type being run; titles state (a), before a tracked job supplies its own title. */
  @Input() analysisType = '';

  /** Book language. This dialog is BOOK-scoped chrome, unlike the app-level Activity Center. */
  @Input() bookLanguage: string | null = null;

  @Output() openChange = new EventEmitter<boolean>();

  /**
   * The minimize gesture. Fires ONLY from state (b), so a listener can assume a live tracked job.
   * c2 hooks the fly-to-bell transition here.
   */
  @Output() minimizeRequested = new EventEmitter<RunDialogMinimizeEvent>();

  @ViewChild('card') private cardRef?: ElementRef<HTMLElement>;

  /** OUTER teardown: everything this run subscribed to. Fired at every run boundary; also on destroy. */
  private runStop$ = new Subject<void>();

  /**
   * INNER teardown (c03), nested inside {@link runStop$}: the CURRENT tracked job's subscription alone.
   * Fired before attaching to a different job, so exactly one `jobById$` subscription is ever live and a
   * late emission for a SUPERSEDED job can no longer overwrite the current one's progress. The run
   * boundary keeps tearing everything down through `runStop$`; this only adds supersession within a run.
   */
  private jobStop$ = new Subject<void>();

  /** The ONLY trackable job id, captured from `'job-started'`. Never from `sync-result.jobId`. */
  private jobId: string | null = null;
  private trackedJob: TrackedJob | null = null;
  /** Latched EXACTLY ONCE per run. Its presence is state (c). */
  private terminal: { status: TerminalStatus; message: string; percent: number | null } | null = null;
  /** State-(a) message, from the raw `'status'` events only. */
  private statusMessage = '';

  // ── Language / direction ─────────────────────────────────────────────────────────────────────────

  /** Book-scoped chrome language ('he' default, 'en' for an English book). */
  get chromeLang(): 'he' | 'en' {
    const lang = (this.bookLanguage ?? '').trim().toLowerCase();
    return lang.startsWith('en') ? 'en' : 'he';
  }

  @HostBinding('attr.dir')
  get dir(): 'rtl' | 'ltr' {
    return this.chromeLang === 'he' ? 'rtl' : 'ltr';
  }

  label(key: RunDialogLabelKey): string {
    const map = this.chromeLang === 'he' ? RUN_DIALOG_LABELS_HE : RUN_DIALOG_LABELS_EN;
    return map[key];
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    const openedNow = !!changes['open'] && this.open === true && changes['open'].previousValue !== true;
    const eventsChanged = !!changes['runEvents'];
    if (openedNow || (eventsChanged && this.open)) {
      // One reset even when both land in the same tick (the first binding pass does exactly that).
      this.resetRun();
      return;
    }
    if (changes['open'] && this.open === false) {
      this.runStop$.next();
    }
  }

  ngOnDestroy(): void {
    this.jobStop$.next();
    this.jobStop$.complete();
    this.runStop$.next();
    this.runStop$.complete();
  }

  // ── Derived view state ───────────────────────────────────────────────────────────────────────────

  get state(): RunDialogState {
    if (!this.open) return 'hidden';
    if (this.terminal) return 'terminal';
    if (this.jobId !== null && this.trackedJob !== null) return 'tracked';
    return 'starting';
  }

  /** Minimize is a property of state (b) itself: tracked implies minimizable, percent or not. */
  get canMinimize(): boolean {
    return this.state === 'tracked' && this.jobId !== null;
  }

  /** 0-100 or null (indeterminate). Never derived here: it is the registry's clamped value. */
  get percent(): number | null {
    if (this.terminal) return this.terminal.percent;
    if (this.state === 'tracked') return this.trackedJob?.percent ?? null;
    return null;
  }

  /**
   * The tracked job's scope label (e.g. 'פרק' / 'סצנה'), already localized by its producer
   * (`JobRegistryService` / `AnalysisPanelComponent`) - no new i18n strings needed here. `null` in
   * state (a), where there is no tracked job yet; renders in (b) AND (c), since `trackedJob` stays
   * populated once a job was latched terminal (only the "never tracked a job" (a)->(c) path has no
   * job, and there is deliberately nothing to name there).
   */
  get scopeLabel(): string | null {
    return this.trackedJob?.scopeLabel ?? null;
  }

  /** Title: the tracked job's own book-language title once tracked, else the run's analysis type. */
  get title(): string {
    const job = this.trackedJob;
    if (job) {
      return this.chromeLang === 'he' ? (job.titleHe || job.titleEn) : (job.titleEn || job.titleHe);
    }
    const type = (this.analysisType ?? '').trim();
    return (type && ANALYSIS_TYPE_LABELS[this.chromeLang][type]) || this.label('analysis');
  }

  /**
   * Message. In (a) the raw `'status'` text is the only source there is; from (b) on, the registry's
   * `job.message` is the single source of truth (d1). The backend detail text itself is not localized
   * today, exactly as on the Activity Center; the localized status pill next to it carries the meaning
   * in both languages, and the fallbacks below are localized.
   */
  get message(): string {
    if (this.terminal) return this.terminal.message || this.label(this.terminal.status);
    if (this.state === 'tracked') return this.trackedJob?.message || this.label('running');
    return this.statusMessage || this.label('starting');
  }

  get statusLabel(): string {
    return this.label(this.statusKey);
  }

  get statusClass(): string {
    return STATUS_CLASS[this.statusKey];
  }

  /** The dismiss control never lies about what it does: it is a minimize while a job is tracked. */
  get dismissLabel(): string {
    return this.canMinimize ? this.label('minimize') : this.label('close');
  }

  private get statusKey(): RunDialogStatusKey {
    if (this.terminal) return this.terminal.status;
    if (this.state === 'tracked') return this.trackedJob?.status ?? 'running';
    return 'pending';
  }

  // ── Interactions ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Minimize: the job keeps running and stays visible in the Activity Center. Emits the geometry seam
   * BEFORE hiding, so the animation owner still has a live card to measure.
   */
  minimize(): void {
    if (!this.canMinimize || this.jobId === null) return;
    this.minimizeRequested.emit({
      jobId: this.jobId,
      originRect: this.cardRef?.nativeElement.getBoundingClientRect() ?? null,
    });
    this.setOpen(false);
  }

  /** Close. For a tracked job this IS minimize; otherwise a plain dismiss. Never cancels the run. */
  dismiss(): void {
    if (this.canMinimize) {
      this.minimize();
      return;
    }
    this.setOpen(false);
  }

  // Escape is bound on the CARD (`(keydown.escape)` on `.rd-card` in the template), not on the document
  // (c04). A modeless card must not claim a global key: this dialog is `aria-modal="false"` with no
  // focus trap and no backdrop precisely so the user keeps working in the Syncfusion document editor
  // behind it, and Syncfusion uses Escape for its own dismiss gestures. A `document:keydown.escape`
  // host listener therefore minimized (fly-to-bell animation and all) a card that never had focus.
  //
  // The template binding is the scope, and it is a structural one rather than a runtime check: keydown
  // bubbles from the focused element, so the handler runs ONLY when focus is inside the card, and no
  // document-level listener exists at all - the editor's own Escape handling cannot be affected by this
  // component. It also dies with the card's `@if`, which subsumes the old `if (this.open)` guard.
  //
  // It is reachable: `.rd-dismiss` is always rendered and focusable (and `.rd-minimize` in state (b)),
  // so a keyboard user who tabs to the card's controls can dismiss with Escape. The handler goes through
  // `dismiss()`, so state (b) still MINIMIZES with the live origin rect and states (a)/(c) still close
  // without emitting `minimizeRequested`.
  //
  // Contrast the Activity Center, which keeps its `document:keydown.escape`: that panel renders a
  // click-to-close `.ac-backdrop` over the page, so while it is open it OWNS the interaction (there is
  // nothing behind it the user is expected to be typing into) and the global key is correct there. Note
  // its card is `aria-modal="false"` too - the distinction that matters here is the backdrop, not the
  // aria attribute.

  // ── Internals ────────────────────────────────────────────────────────────────────────────────────

  private setOpen(value: boolean): void {
    if (this.open === value) return;
    this.open = value;
    this.openChange.emit(value);
    if (!value) this.runStop$.next();
    this.cdr.markForCheck();
  }

  /** Drop the previous run's subscriptions and state, then attach to the current event stream. */
  private resetRun(): void {
    this.jobStop$.next();
    this.runStop$.next();
    this.jobId = null;
    this.trackedJob = null;
    this.terminal = null;
    this.statusMessage = '';
    this.runEvents?.pipe(takeUntil(this.runStop$)).subscribe(event => this.onRunEvent(event));
    this.cdr.markForCheck();
  }

  private onRunEvent(event: AnalysisRunEvent): void {
    // Single-resolve: once (c) is latched, nothing on the raw stream can move the dialog again.
    if (this.terminal) return;

    switch (event.kind) {
      case 'job-started':
        this.attachToJob(event.jobId);
        break;

      case 'status':
        // State (a) only. From (b) on, `job.message` is the single source (d1).
        if (this.jobId === null) this.statusMessage = event.message;
        break;

      case 'progress':
        // Deliberately ignored: on the sync route these come from the 404-doomed poll of the
        // sync-embedded jobId, and on the async route the registry already owns the same numbers.
        break;

      case 'sync-result':
      case 'job-result':
      case 'streaming-complete':
        // (a) -> (c). NOTE `sync-result` may carry a `result.jobId`; it is NOT read here, by design.
        if (this.jobId === null) this.latchTerminal('succeeded', '', 100);
        break;

      case 'error':
        // (a) -> (c). While tracked, (b) -> (c) is the registry's call alone (d1 item 6).
        if (this.jobId === null) this.latchTerminal('failed', event.message, null);
        break;

      case 'run-finished':
        // c01: (a) -> (c) on the panel's own run terminal. Reaching this line means the run ended without
        // ANY of the terminal events above - the panel was destroyed mid-run (which cancels the run), or
        // the save that had to precede it rejected. So the status is 'canceled', not 'succeeded': there is
        // no result behind this card. Percent stays null; nothing about progress is read off this event.
        //
        // The `jobId === null` guard is load-bearing, not defensive: a registry-tracked run (state (b))
        // genuinely keeps running server-side after the panel goes away, which is the entire point of the
        // minimize gesture, so (b) -> (c) must stay the registry's call alone (d1 item 6).
        if (this.jobId === null) this.latchTerminal('canceled', '', null);
        break;

      case 'result-dropped':
        // c06: the run produced a result and the panel DISCARDED it, because the chapter/scene it was
        // started on is no longer the one on screen. There is no terminal to latch here: "Done" would
        // claim a success that reached no surface at all (an untracked sync run has no Activity Center
        // row and no in-page banner either), and "Canceled" would be just as false - the run succeeded
        // and its result is persisted, it simply belongs to a unit the user has left. So the card is
        // ABANDONED rather than resolved.
        //
        // Closing is what makes the late case agree with the early one: had the result landed BEFORE the
        // switch, this card would have latched terminal and the editor's c02 reconcile would have closed
        // it at the switch. This is that same end state, reached through the one path that skipped it.
        //
        // The `jobId === null` guard is the same fence as `run-finished` (d1 item 6): a registry-tracked
        // run keeps running server-side and keeps its card, so `(b) -> (c)` stays the registry's call
        // alone. In state (b) this event is a no-op, exactly as the result events themselves already are.
        if (this.jobId === null) this.setOpen(false);
        break;

      case 'streaming-token':
        break;

      default:
        // Exhaustiveness fence (final-r02). Every member of AnalysisRunEvent must be answered above,
        // even if the answer is "ignore it": this switch returns void, so without this arm a member
        // added to the union compiles here as a silent no-op. That is precisely the shape c01 was
        // fixing - a lifecycle signal with no answering handler.
        assertUnhandledRunEvent(event);
    }
    this.cdr.markForCheck();
  }

  /**
   * Subscribe to the ONE job this run started.
   *
   * A repeated, IDENTICAL `job-started` is a no-op (the early return): it must NOT re-subscribe.
   * A DIFFERENT id supersedes: `jobStop$` tears the previous job's subscription down BEFORE the new one
   * is opened, so exactly one is ever live and a late emission for the old job cannot overwrite
   * `trackedJob` behind the new one's back. `runStop$` stays the OUTER teardown (the run boundary drops
   * everything regardless), so the two are composed rather than swapped.
   */
  private attachToJob(jobId: string): void {
    if (!jobId || this.jobId === jobId) return;
    this.jobStop$.next();
    this.jobId = jobId;
    this.registry.jobById$(jobId)
      .pipe(takeUntil(this.jobStop$), takeUntil(this.runStop$))
      .subscribe(job => {
        if (this.terminal) return;
        this.trackedJob = job;
        if (job && isTerminal(job.status)) {
          this.latchTerminal(job.status, job.message, job.status === 'succeeded' ? 100 : job.percent);
        }
        this.cdr.markForCheck();
      });
  }

  private latchTerminal(status: TerminalStatus, message: string, percent: number | null): void {
    if (this.terminal) return;
    this.terminal = { status, message, percent };
  }
}
