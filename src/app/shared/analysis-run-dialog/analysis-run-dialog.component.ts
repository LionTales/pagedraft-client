import { DOCUMENT } from '@angular/common';
import {
  AfterViewChecked,
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

import { applyBackgroundInert, containFocusWithin, focusablesWithin } from './modal-a11y';
import { ANALYSIS_TYPE_LABELS } from '../../core/models/analysis';
import { formatEtaLabel, runChromeLang, runString } from '../../core/i18n/run-strings';
import { estimateRemainingMs } from '../../core/utils/chunk-eta';
import { AnalysisRunEvent, assertUnhandledRunEvent } from '../../core/services/analysis-run-orchestration.service';
import {
  JobRegistryService,
  JobStatus,
  TerminalStatus,
  TrackedJob,
  isTerminal,
  showsChunkCounts,
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
 * ── Shape: MODAL WHILE THE RUN IS LIVE (c03) ───────────────────────────────────────────────────────
 * Two sibling fixed layers, mirroring Pagewise's `pw-modal`: a `.rd-backdrop` scrim (blurred, with a
 * heavier flat scrim where `backdrop-filter` is unsupported) and, above it, a `.rd-overlay` centering
 * container (`display: grid; place-items: center`) holding the `.rd-card`. Centering is the container's
 * job, so the card itself needs no width/height math and no corner pinning, and it is direction-
 * agnostic. The a11y attributes live on the CONTAINER, not on the card: `role="dialog"`, `aria-modal`,
 * the `aria-label`, and `tabindex="-1"` so it can hold focus and receive Escape.
 *
 * MODALITY IS A PROPERTY OF THE RUN, not of the dialog's lifetime (user decision, 2026-08-03):
 *   (a)/(b), the run is LIVE -> MODAL. Backdrop + blur, the background made `inert`, focus moved into
 *                               the card and TRAPPED there, `aria-modal="true"`.
 *   (c), the run is OVER     -> the modality DROPS. The backdrop element is REMOVED (removed, not faded
 *                               out: an invisible scrim would go on eating pointer events), every
 *                               `inert` attribute is removed, the trap is released, focus is RESTORED
 *                               to whatever held it before the dialog opened, and `aria-modal` flips to
 *                               `false`. The card stays on screen as a dismissible notice.
 * The dialog still does NOT auto-close: state (c) persists until dismissed, exactly as under d1. It
 * simply stops blocking, so a finished (or failed) run can never leave the app unusable.
 *
 * The release therefore has TWO triggers, and both are tested: the `(b) -> (c)` transition and the
 * dismiss/minimize. Releasing only on dismiss would leave a live focus trap inside a card that no
 * longer claims to be modal - the specific defect this state machine could introduce.
 *
 * This REVERSES the Wave 1d d1 decision, which made the card deliberately modeless ("the user must be
 * able to read the chapter behind it"). The user overrode it after the first live run. Nothing in this
 * file, the SCSS, or the notes still argues the old shape.
 *
 * The progress markup (determinate row with aria-valuenow/valuemin/valuemax + numeric readout;
 * indeterminate pulse with no ambiguous aria-valuenow; and, for a run that is OVER with no percent ever
 * learned, an inert bar that is not a progressbar at all - c05) mirrors the Activity Center row and the
 * in-page indicator exactly, so a screen reader gets the same contract on all three surfaces.
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
      <!-- The scrim is a SIBLING of the centering container (the pw-modal structure), and it exists
           ONLY while the run is live: this block REMOVES the element at the (b) -> (c) transition
           rather than fading it out, so nothing invisible is left eating pointer events. -->
      @if (isModal) {
        <div class="rd-backdrop" aria-hidden="true" (click)="onBackdropClick()"></div>
      }

      <div
        #overlay
        class="rd-overlay"
        role="dialog"
        [attr.aria-modal]="isModal ? 'true' : 'false'"
        tabindex="-1"
        (keydown.escape)="dismiss()"
        (keydown.tab)="onTab($event, false)"
        (keydown.shift.tab)="onTab($event, true)"
        [attr.aria-label]="title + ' · ' + label('dialogAria')">
        <div
          #card
          class="rd-card">

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

          <!-- c04: the approximate time remaining. Rendered ONLY when the estimator has a basis for one
               (see estimateRemainingMs in core/utils/chunk-eta.ts), so it appears mid-run rather than at
               "0 of 10" and is gone again at the terminal. Deliberately NOT a live region: .rd-message
               above already is one, and a second polite region revising itself on every chunk would
               talk over it. -->
          @if (etaLabel; as eta) {
            <p class="rd-eta">{{ eta }}</p>
          }

          @if (canMinimize) {
            <div class="rd-actions">
              <button class="rd-minimize" type="button" (click)="minimize()">
                {{ label('minimize') }}
              </button>
              <span class="rd-hint">{{ label('keepsRunning') }}</span>
            </div>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './analysis-run-dialog.component.scss',
})
export class AnalysisRunDialogComponent implements OnChanges, AfterViewChecked, OnDestroy {
  private readonly registry = inject(JobRegistryService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly doc = inject(DOCUMENT);
  /** The component host. It is the boundary of "the dialog" for the background-inert walk. */
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

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

  /** The centering/overlay container: it carries the dialog role, the aria attrs and the key bindings. */
  @ViewChild('overlay') private overlayRef?: ElementRef<HTMLElement>;

  /**
   * Whether the modal side effects are CURRENTLY engaged (c03). Deliberately a separate field from the
   * derived {@link isModal}: `isModal` says what the state machine WANTS, this says what has actually
   * been done to the DOM, and reconciling the two in one place ({@link syncModality}) is what makes the
   * release fire at the `(b) -> (c)` transition and not only on dismiss.
   */
  private modalActive = false;

  /** What held focus when the modal engaged. Restored when it drops, whichever way it drops. */
  private previouslyFocused: HTMLElement | null = null;

  /** Undo for {@link applyBackgroundInert}. Non-null exactly while {@link modalActive} is true. */
  private releaseInert: (() => void) | null = null;

  /**
   * Undo for {@link containFocusWithin} (c01). Non-null exactly while {@link modalActive} is true, and
   * released FIRST inside {@link releaseModality} so it cannot fight the focus restore that follows it.
   */
  private releaseFocusContainment: (() => void) | null = null;

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

  /**
   * Book-scoped chrome language ('he' default, 'en' for an English book).
   *
   * c02: delegated to `runChromeLang` rather than re-implemented. This getter and the panel's
   * `panelLang` had the rule written out twice already, and the orchestration service composing the
   * sentences this component RENDERS would have made it three - a book in some third language getting
   * one answer from the composer and another from the renderer is exactly the divergence that costs.
   */
  get chromeLang(): 'he' | 'en' {
    return runChromeLang(this.bookLanguage);
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
      // The HOST closed us (the editor's per-context reconcile does exactly this on a book change).
      // Release synchronously rather than waiting for the next view check: `syncModality` is the
      // backstop for the transition no gesture drives ((b) -> (c)), not the primary path for a close.
      this.releaseModality();
      this.runStop$.next();
    }
  }

  /**
   * The ONE place the DOM-level modal side effects are reconciled with the state machine (c03).
   *
   * It runs here rather than in the handlers that change the state because the overlay element has to
   * EXIST before focus can move into it, and because the transition that matters most - `(b) -> (c)`,
   * where the modality drops - is driven by a registry emission, not by a user gesture. Anchoring the
   * reconcile to the view keeps both the engage and the release on one path, so neither can be
   * forgotten at a new call site.
   *
   * It never writes a bound field, so it cannot raise `ExpressionChangedAfterItHasBeenChecked`.
   */
  ngAfterViewChecked(): void {
    this.syncModality();
  }

  ngOnDestroy(): void {
    // A component torn down while modal must not leave the app inert. Nothing else runs after this.
    this.releaseModality();
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

  /**
   * Whether the dialog is BLOCKING (c03): true in states (a) and (b), false in (c) and while hidden.
   *
   * Derived from {@link state}, which is itself derived from the `terminal` latch that `isTerminal`
   * (the registry's one terminal predicate) sets. There is deliberately no second notion of "the run is
   * over" here: modality is a projection of the existing state machine, not a parallel one.
   */
  get isModal(): boolean {
    const state = this.state;
    return state === 'starting' || state === 'tracked';
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
   * Message. In (a) the raw `'status'` text is the only source there is (and it is now composed by
   * `AnalysisRunOrchestrationService` in this book's language). From (b) on, the message is COMPOSED
   * HERE from the tracked job's STATUS, by {@link runDetail}.
   *
   * c02: this getter used to render `job.message` - the backend's raw English prose, e.g.
   * `Running chunk 2/10`, inside RTL Hebrew chrome, next to a correctly-localized `בריצה` pill. This
   * dialog is the ONLY surface that ever rendered that field (the Activity Center and the in-page
   * indicator never have), so there was no precedent to follow and nothing else to keep in step. The
   * server keeps sending prose and `TrackedJob.message` keeps carrying it; it is simply not chrome.
   *
   * `terminal.message`, when set, still wins: that path carries a CLIENT-composed localized sentence,
   * or a `{ error }` body the API deliberately sent to explain a rejection. A registry terminal
   * ((b) -> (c)) latches an EMPTY message on purpose (see `attachToJob`) so this composes instead.
   */
  get message(): string {
    if (this.terminal) return this.terminal.message || this.runDetail(this.terminal.status);
    if (this.state === 'tracked') return this.runDetail(this.trackedJob?.status ?? 'running');
    return this.statusMessage || this.label('starting');
  }

  /**
   * The localized detail sentence for a job in a given status, composed from STRUCTURED state rather
   * than from any server prose (the c02 STEP 2 decision; see `core/i18n/run-strings.ts`).
   *
   * c04 fills the seam c02 left here: a RUNNING job whose chunk counts are known says "{type}: 3 of 10
   * completed" instead of the count-free "{type}: running...". It reuses c02's existing
   * `progressCompleted` key rather than minting a near-synonym - that key was already written for
   * exactly this sentence, it is already covered by the he/en parity and placeholder specs, and having
   * one wording for one fact is the point of the closed union.
   *
   * The counts come off {@link chunkCounts}, i.e. off `TrackedJob`, i.e. off the registry - the same
   * single owner the percent comes from. Nothing here derives, remembers or adjusts a number.
   */
  private runDetail(status: JobStatus): string {
    const lang = this.chromeLang;
    const type = this.title;
    switch (status) {
      case 'succeeded': return runString(lang, 'runSucceeded', { type });
      case 'failed':    return runString(lang, 'runFailed', { type });
      case 'canceled':  return runString(lang, 'runCanceled', { type });
      case 'pending':   return runString(lang, 'progressPreparing', { type });
      case 'running': {
        const counts = this.chunkCounts;
        return counts
          ? runString(lang, 'progressCompleted', { type, completed: counts.completed, total: counts.total })
          : runString(lang, 'progressRunning', { type });
      }
    }
  }

  /**
   * The tracked job's REAL chunk counts, or null when this run has no counts to show. Straight off
   * `TrackedJob`; the in-page indicator and the Activity Center row read the SAME two fields, which is
   * what `three-surface-parity.spec.ts` now pins.
   *
   * c02: the "may this run show counts at all?" test is the registry's {@link showsChunkCounts}, not a
   * local `totalChunks !== null`. It covers both halves at once - no chunk shape (a single-shot
   * analysis, or a run not chunked yet), and a KIND whose denominator is not a legible unit (`review`,
   * which counts map windows plus a variable number of reduce passes). This dialog only ever follows a
   * chapter analysis run today, so the kind half changes nothing here in practice; it is wired anyway so
   * that all three surfaces ask ONE predicate and a future re-use of the dialog cannot become a fourth
   * answer.
   */
  get chunkCounts(): { completed: number; total: number } | null {
    const job = this.trackedJob;
    if (!showsChunkCounts(job)) return null;
    return { completed: job!.completedChunks ?? 0, total: job!.totalChunks! };
  }

  /**
   * c04: the approximate time remaining, or null when there is no basis for one.
   *
   * State (b) ONLY. In (a) nothing is tracked, and in (c) the run is over so "remaining" is meaningless
   * (the estimator would return null there anyway - remaining chunks is 0 for a succeeded run - but a
   * FAILED run can latch terminal with chunks still outstanding, and a card reading "Failed" above
   * "about 4 minutes remaining" would be absurd; the state gate is what rules that out, not luck).
   *
   * Everything the estimate is computed from is registry state, including the clock: this getter
   * measures no time of its own, so re-opening the dialog mid-run cannot restart the estimate.
   */
  get etaLabel(): string | null {
    if (this.state !== 'tracked') return null;
    const job = this.trackedJob;
    if (!job) return null;
    const remainingMs = estimateRemainingMs({
      completedChunks: job.completedChunks,
      totalChunks: job.totalChunks,
      clock: job.chunkClock,
    });
    return remainingMs === null ? null : formatEtaLabel(this.chromeLang, remainingMs);
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
    // Measure BEFORE anything moves: this is the card's LIVE rect, wherever the card happens to be.
    // c03 centred it (it used to be pinned to a corner) and this line needed no change for that -
    // `minimize-flight.ts` computes a physical delta between two MEASURED points and hardcodes neither.
    const originRect = this.cardRef?.nativeElement.getBoundingClientRect() ?? null;
    // Drop the modality BEFORE the flight, not with the card: the ghost animates over a page that is
    // already usable, and the background is never inert for a card that is on its way out.
    this.releaseModality();
    this.minimizeRequested.emit({ jobId: this.jobId, originRect });
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

  /**
   * Backdrop click. It exists only while the dialog is modal, and it DISMISSES (c03).
   *
   * A deliberate divergence from the Pagewise reference, whose `closeOnBackdrop` defaults to false:
   * there a dismiss can mean cancelling the operation the modal was confirming, so a stray click must
   * not do it. Here dismissal is non-destructive in every state - in (b) it is a MINIMIZE and the job
   * keeps running (there is no cancel endpoint at all), and in (a) the panel owns the HTTP subscription
   * regardless - so the click costs the user nothing and the alternative is a scrim that looks
   * interactive and silently ignores them.
   */
  onBackdropClick(): void {
    this.dismiss();
  }

  /**
   * The focus TRAP, bound on the overlay container as `(keydown.tab)` / `(keydown.shift.tab)`.
   *
   * Active only while {@link modalActive}: in state (c) the modality is gone, so Tab must be allowed to
   * leave the card and reach the page again - a trap that outlives the modality is exactly the bug this
   * state machine could introduce.
   *
   * `inert` on the background already stops focus from landing there in browsers that implement it;
   * this cycle is what contains the keyboard everywhere else, and it is also what makes Tab WRAP rather
   * than escaping into the browser chrome.
   */
  onTab(event: Event, backwards: boolean): void {
    if (!this.modalActive) return;
    const card = this.cardRef?.nativeElement;
    const overlay = this.overlayRef?.nativeElement;
    if (!card || !overlay) return;

    const focusables = focusablesWithin(card);
    if (focusables.length === 0) {
      // Nothing to cycle through; keep focus on the container rather than letting it leave.
      event.preventDefault();
      overlay.focus();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.doc.activeElement;
    const inside = active instanceof HTMLElement && card.contains(active);

    if (backwards ? (!inside || active === first) : (!inside || active === last)) {
      event.preventDefault();
      (backwards ? last : first).focus();
    }
  }

  // ── Escape (c03 re-scopes the fixes plan's c04, it does not revert it) ─────────────────────────────
  //
  // Escape is bound on the overlay CONTAINER (`(keydown.escape)` on `.rd-overlay`, which is
  // `tabindex="-1"` so it can hold focus), which is the Pagewise `pw-modal` shape. It is neither the
  // original `@HostListener('document:keydown.escape')` nor the `.rd-card` binding the fixes plan's c04
  // moved it to, and both of those are now wrong for a specific, checkable reason:
  //
  //  - A `document:` listener is what c04 removed, and its argument still holds where it applied: the
  //    editor behind a NON-blocking card is a place the user is genuinely typing, Syncfusion uses Escape
  //    for its own dismiss gestures, and a global listener minimized - fly-to-bell animation and all - a
  //    card that never had focus. Under c03 that argument no longer describes states (a)/(b), where the
  //    background is inert and there is nothing behind the card to type into, but it describes state (c)
  //    EXACTLY, and (c) is now a state the user can sit in indefinitely. So the global listener stays
  //    deleted, and c04's finding survives on the one state where its premise is still true.
  //  - The `.rd-card` binding would silently lose the FIRST Escape of every modal run: focus-on-open
  //    lands on the overlay container, which is NOT inside `.rd-card`, so a user who opens the modal and
  //    immediately presses Escape would get nothing. That is a concrete regression, not a preference.
  //
  // On the container the binding is correct in every state, for the same structural reason c04 wanted:
  // keydown BUBBLES, so the handler runs only when focus is somewhere inside this dialog.
  //  - (a)/(b): focus is trapped inside the overlay, so "focus is in the container" and "the modal is
  //    up" are the same statement. The binding covers every Escape the user can generate.
  //  - (c): the trap is released and focus may well be back in the editor. The binding then behaves
  //    exactly as the `.rd-card` one did - Escape from inside the card dismisses, Escape from the editor
  //    does nothing - which is the c04 contract, preserved unchanged for the state it was written for.
  //
  // The handler is `dismiss()`, so state (b) still MINIMIZES with the live origin rect and (a)/(c) still
  // close without emitting `minimizeRequested`.

  // ── Internals ────────────────────────────────────────────────────────────────────────────────────

  private setOpen(value: boolean): void {
    if (this.open === value) return;
    this.open = value;
    this.openChange.emit(value);
    if (!value) {
      // Synchronous, not left to the next `ngAfterViewChecked`: the app must be usable the moment the
      // card goes, and `minimize()` has already released by the time it gets here (idempotent).
      this.releaseModality();
      this.runStop$.next();
    }
    this.cdr.markForCheck();
  }

  // ── Modality (c03) ────────────────────────────────────────────────────────────────────────────────

  /** Reconcile the DOM-level modal effects with {@link isModal}. Idempotent; called on every check. */
  private syncModality(): void {
    const wanted = this.isModal;
    if (wanted === this.modalActive) return;
    if (wanted) this.engageModality();
    else this.releaseModality();
  }

  /**
   * Engage: remember what had focus, make everything outside this dialog inert, move focus onto the
   * overlay container, and KEEP it there. The container rather than the first button, so a screen reader
   * announces the dialog itself (its `role`/`aria-modal`/`aria-label`) before any control, and so the
   * very first Escape or Tab is already ours.
   *
   * ── The single `focus()` call was not enough, and this was measured (c01) ────────────────────────
   * In the real editor the line below runs, focus lands on the overlay, and about 55ms later Syncfusion
   * takes it back to its hidden text-target iframe - which is INSIDE the inert subtree, because `inert`
   * does not reach into a nested browsing context. From there NEITHER key binding on this overlay can
   * fire: both Escape and the Tab cycle are bound on `.rd-overlay` and keydown bubbles from wherever
   * focus actually is. Four real Tab presses moved focus nowhere and a real Escape did not dismiss.
   *
   * So focus is now CONTAINED for as long as the modality lasts rather than merely initialised, which
   * is the CDK `FocusTrap` + focus-monitor strategy. {@link containFocusWithin} owns the listeners and
   * the recursion guard; this method owns nothing but the lifetime, so teardown stays one idempotent
   * {@link releaseModality} with no new teardown site.
   */
  private engageModality(): void {
    const overlay = this.overlayRef?.nativeElement;
    if (!overlay) return; // not rendered yet; the next check will engage it

    const active = this.doc.activeElement;
    this.previouslyFocused = active instanceof HTMLElement ? active : null;
    // The walk is anchored on the HOST, not on the overlay: the backdrop is the overlay's SIBLING
    // inside the host, so anchoring on the overlay would mark the dialog's own scrim inert and its
    // click-to-dismiss would silently stop working. The host is the boundary of "the dialog".
    this.releaseInert = applyBackgroundInert(this.hostRef.nativeElement, this.doc);
    // Same anchor as the inert walk, so the two layers agree about what counts as "inside the dialog".
    // The target is resolved lazily: Angular re-creates the overlay element across renders, so a
    // captured reference would go stale and re-assert focus onto a detached node.
    this.releaseFocusContainment = containFocusWithin(
      this.hostRef.nativeElement,
      () => this.overlayRef?.nativeElement ?? null,
      this.doc,
    );
    this.modalActive = true;
    overlay.focus({ preventScroll: true });
  }

  /**
   * Release: remove every `inert` attribute we added, stop trapping, and give focus back.
   *
   * Idempotent, because it has several callers and that is the point: the `(b) -> (c)` transition (via
   * {@link syncModality}, since no user gesture drives that one), {@link minimize}, {@link setOpen},
   * `ngOnChanges` when the HOST writes `open = false`, and `ngOnDestroy`. Releasing only on dismiss
   * would leave a live focus trap and an inert page behind a card that claims `aria-modal="false"`.
   *
   * Focus is restored only when it is still inside this dialog (or nowhere): after the modality drops in
   * state (c) the user may have clicked into the document, and yanking focus back then would be worse
   * than not restoring it at all.
   *
   * ── ORDER IS LOAD-BEARING (c01) ──────────────────────────────────────────────────────────────────
   * The focus containment is released FIRST, before the restore below. It is a document-level listener
   * that pulls focus back into the host, so a restore performed while it is still installed would be
   * undone by our own listener: focus would be yanked back into a dialog that is on its way out. This
   * is not a hypothetical - the live probe that established the mechanism did exactly that, because it
   * used a DOM proxy for "still modal" instead of being torn down imperatively.
   *
   * ── What c01 changed about the `focusIsOurs` predicate ───────────────────────────────────────────
   * Nothing in the predicate; everything about WHICH BRANCH RUNS in the real app. Before c01, focus at
   * release time was typically Syncfusion's iframe - not `body`, not inside the overlay - so
   * `focusIsOurs` was FALSE and the restore was silently skipped on every real run. It was dead code
   * that the fixture's clean focus state made look alive. Now containment holds focus on the overlay
   * for the whole modal window, so at release `overlay.contains(active)` is TRUE and the restore
   * genuinely runs. The predicate is still correct and is deliberately unchanged: its OTHER job -
   * declining to restore in state (c) after the user has clicked into the document - is reached
   * through the (b) -> (c) transition, where the modality drops and containment stops before the user
   * clicks anywhere. Widening it to "restore unconditionally" would break exactly that case.
   */
  private releaseModality(): void {
    if (!this.modalActive) return;
    this.modalActive = false;
    // FIRST: stop containing focus, so the restore below is not fought by our own listener.
    this.releaseFocusContainment?.();
    this.releaseFocusContainment = null;
    this.releaseInert?.();
    this.releaseInert = null;

    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (!target || !target.isConnected) return;

    const active = this.doc.activeElement;
    const overlay = this.overlayRef?.nativeElement;
    const focusIsOurs = !active || active === this.doc.body || (!!overlay && overlay.contains(active));
    if (focusIsOurs) target.focus({ preventScroll: true });
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
        // State (a) only. From (b) on, the detail line is COMPOSED by `runDetail` from the tracked job's
        // structured status/counts (c02 + c04) - d1's original "job.message is the single source" rule no
        // longer holds, because that field is the backend's raw English prose and no surface renders it.
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
          // c02: latch an EMPTY message, NOT `job.message`. That field carries the backend's raw English
          // prose ("Proofread finished", or a .NET exception string on a failure), and this is the one
          // surface that renders it. An empty message routes the `message` getter through `runDetail`,
          // which composes the localized sentence from the terminal STATUS instead.
          this.latchTerminal(job.status, '', job.status === 'succeeded' ? 100 : job.percent);
        }
        this.cdr.markForCheck();
      });
  }

  private latchTerminal(status: TerminalStatus, message: string, percent: number | null): void {
    if (this.terminal) return;
    this.terminal = { status, message, percent };
  }
}
