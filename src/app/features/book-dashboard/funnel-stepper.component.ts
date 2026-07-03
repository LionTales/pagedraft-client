import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * rf-f02: Funnel-progress STEPPER -- the visible spine that fixes "no unified entry point" +
 * "lost progress when panel closed". A slim 4-step indicator (Structure -> Assess -> Revise ->
 * Polish) pinned in the ReviewPanel / BookDashboard header section.
 *
 * DESIGN: fully PRESENTATIONAL. The parent (BookDashboardComponent) computes and passes in the
 * four boolean inputs (summaryReady, reviewReady, hasBriefs, summaryRunning, reviewRunning).
 * The stepper derives step states from those booleans so it stays free of service dependencies
 * and is trivially unit-testable without TestBed wiring. The parent already holds all these
 * values (it hosts the summary + review status rows and receives their @Output events).
 *
 * STEP-STATE MODEL (Phase 1 / non-blocking):
 *   Structure  -- done once the book is loaded (chapters exist; treated as always-done when this
 *                 component is mounted, because mounting requires bookId to be set).
 *   Assess     -- in-progress while summaryRunning || reviewRunning (registry live).
 *                 done when reviewReady === true.
 *                 current/lit-next-step otherwise.
 *   Revise     -- available once Assess is done (reviewReady).
 *                 CTA becomes lit once Assess is done.
 *                 Phase 1: no finding-outcome data surfaced (BookFinding.status exists but the
 *                 dashboard does not track per-finding outcomes; keep Revise at "available").
 *   Polish     -- always 'coming' / disabled in Phase 1 (Phase 2 feature).
 *
 * NON-BLOCKING: the stepper is advisory; it never gates the rest of the UI. The Polish step has
 * no dead click (aria-disabled, tabindex=-1, cursor:default, no (click) handler).
 *
 * RTL: the host passes [dir] on the wrapper; step numbering flows in reading order via logical
 * CSS (flex-direction: row). Physical layout is left-to-right so the gutter is always at the
 * start; RTL host flips the row automatically.
 *
 * he/en parity: labels resolve from the bookLanguage input via label maps below. Hebrew strings
 * are DRAFT -- needs native-speaker review before sign-off.
 */

/** The four funnel steps in order. */
export type FunnelStep = 'structure' | 'assess' | 'revise' | 'polish';

/**
 * Per-step derived state.
 *   done          - step is complete; green check.
 *   current       - this is the lit next-step with a CTA button.
 *   in-progress   - a job is running for this step; spinner/pulse.
 *   available     - step is unlocked but not the lit next-step.
 *   coming        - Phase 2 placeholder; always disabled, no CTA.
 */
export type StepState = 'done' | 'current' | 'in-progress' | 'available' | 'coming';

/** One resolved step for the template. */
export interface ResolvedStep {
  id: FunnelStep;
  state: StepState;
  /** Localized step name. */
  label: string;
  /** Localized state label (e.g. "Done", "In progress", "Coming soon"). Shown below the name. */
  stateLabel: string;
  /** True when this step has the CTA button (exactly one step at a time). */
  hasCta: boolean;
  /** CTA button text; empty when hasCta=false. */
  ctaLabel: string;
}

@Component({
  selector: 'app-funnel-stepper',
  standalone: true,
  imports: [CommonModule],
  template: `
    <nav
      class="funnel-stepper"
      [attr.dir]="dir"
      [attr.aria-label]="isHebrew ? 'שלבי עריכה' : 'Editing stages'"
      role="navigation">
      <!-- Compact indicator row: the 4 steps fit the panel width without horizontal scroll. -->
      <div class="funnel-steps-row">
        @for (step of resolvedSteps; track step.id; let i = $index; let last = $last) {
          <div
            class="funnel-step"
            [class.funnel-step--done]="step.state === 'done'"
            [class.funnel-step--current]="step.state === 'current'"
            [class.funnel-step--in-progress]="step.state === 'in-progress'"
            [class.funnel-step--available]="step.state === 'available'"
            [class.funnel-step--coming]="step.state === 'coming'"
            [attr.data-step]="step.id"
            [attr.data-testid]="'funnel-step-' + step.id">
            <!-- Step indicator: number circle with state icon overlay -->
            <div class="funnel-step__indicator" aria-hidden="true">
              @if (step.state === 'done') {
                <span class="funnel-step__check">&#10003;</span>
              } @else if (step.state === 'in-progress') {
                <span class="funnel-step__spinner"></span>
              } @else {
                <span class="funnel-step__num">{{ i + 1 }}</span>
              }
            </div>
            <!-- Step body: name + state label (the CTA lives in the full-width action row below,
                 so its label is never clipped by the narrow step cell). -->
            <div class="funnel-step__body">
              <span class="funnel-step__label">{{ step.label }}</span>
              <span class="funnel-step__state-label">{{ step.stateLabel }}</span>
            </div>
            <!-- Connector line between steps (not after the last) -->
            @if (!last) {
              <div class="funnel-step__connector" aria-hidden="true"></div>
            }
          </div>
        }
      </div>

      <!-- Full-width action row: the single lit step's CTA, given room so its label never clips.
           Exactly one of Assess/Revise is lit at a time; Polish never has a CTA (no dead click). -->
      @if (litStep) {
        <button
          type="button"
          class="funnel-action-cta"
          [attr.data-testid]="'funnel-cta-' + litStep.id"
          (click)="onCtaClick(litStep.id)">
          {{ litStep.ctaLabel }}
        </button>
      }
    </nav>
  `,
  styles: [`
    :host { display: block; }

    .funnel-stepper {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
      padding: var(--pd-space-4) var(--pd-space-5);
      background: var(--pd-surface-sunken);
      border-bottom: 1px solid var(--pd-divider);
    }

    /* Compact 4-step indicator row. Steps shrink to share the width so they fit the (narrow) panel
       without a horizontal scrollbar; the CTA is not inside these cells anymore. */
    .funnel-steps-row {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 0;
    }

    .funnel-step {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: var(--pd-space-2);
      flex: 1 1 0;
      min-width: 0;
      position: relative;
    }

    /* ── Indicator circle ── */
    .funnel-step__indicator {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid var(--pd-border-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--pd-surface);
      transition: border-color var(--pd-dur-fast) var(--pd-ease),
                  background var(--pd-dur-fast) var(--pd-ease);
      z-index: 1;
    }

    .funnel-step--done .funnel-step__indicator {
      border-color: var(--pd-primary-600);
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
    }

    .funnel-step--current .funnel-step__indicator {
      border-color: var(--pd-primary-600);
      background: var(--pd-surface);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--pd-primary-600) 18%, transparent);
    }

    .funnel-step--in-progress .funnel-step__indicator {
      border-color: var(--pd-primary-600);
      background: var(--pd-surface);
    }

    .funnel-step--coming .funnel-step__indicator {
      border-color: var(--pd-neutral-300);
      background: var(--pd-neutral-100);
      opacity: 0.55;
    }

    .funnel-step__num {
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-secondary);
      line-height: 1;
    }

    .funnel-step--current .funnel-step__num,
    .funnel-step--available .funnel-step__num {
      color: var(--pd-primary-700);
    }

    .funnel-step--coming .funnel-step__num {
      color: var(--pd-neutral-400);
    }

    .funnel-step__check {
      font-size: 13px;
      color: var(--pd-on-primary);
      line-height: 1;
    }

    /* ── Spinner ── */
    .funnel-step__spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid color-mix(in srgb, var(--pd-primary-600) 30%, transparent);
      border-top-color: var(--pd-primary-600);
      border-radius: 50%;
      animation: funnel-spin 0.8s linear infinite;
    }

    @keyframes funnel-spin {
      to { transform: rotate(360deg); }
    }

    /* ── Step body ── */
    .funnel-step__body {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
      min-width: 0;
    }

    .funnel-step__label {
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      color: var(--pd-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: var(--pd-font-ui);
    }

    .funnel-step--coming .funnel-step__label {
      color: var(--pd-text-muted);
      opacity: 0.7;
    }

    .funnel-step__state-label {
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
      white-space: nowrap;
      font-family: var(--pd-font-ui);
    }

    .funnel-step--done .funnel-step__state-label {
      color: var(--pd-primary-600);
    }

    .funnel-step--current .funnel-step__state-label {
      color: var(--pd-primary-700);
    }

    .funnel-step--in-progress .funnel-step__state-label {
      color: var(--pd-primary-600);
    }

    /* ── Full-width action CTA (below the step strip) ── */
    .funnel-action-cta {
      display: block;
      width: 100%;
      padding: var(--pd-space-3) var(--pd-space-4);
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
      border: none;
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      font-size: var(--pd-text-body-sm);
      font-family: var(--pd-font-ui);
      font-weight: var(--pd-weight-medium);
      text-align: center;
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }

    .funnel-action-cta:hover {
      background: var(--pd-primary-hover);
    }

    .funnel-action-cta:focus-visible {
      outline: none;
      box-shadow: var(--pd-ring);
    }

    /* ── Connector line between steps ── */
    .funnel-step__connector {
      position: absolute;
      /* Physical left edge of the connector: sits after the indicator + body gap, aligned on the
         indicator centre-line. Using inset-inline-end / translate so RTL flips it automatically. */
      inset-inline-end: 0;
      top: 13px; /* half of 28px indicator */
      width: calc(100% - 28px - var(--pd-space-3) - 40px);
      height: 2px;
      background: var(--pd-divider);
      /* Push the line to after the step body by anchoring it at the right edge of this step
         and letting the next step's indicator sit at its left. A simpler approach: just let the
         flex gap handle spacing and use a pseudo-element on :not(:last-child) at 100% width minus
         the indicator. We use an absolutely-positioned child at the physical end of each step cell. */
      right: 0;
      left: auto;
    }

    .funnel-step--done + .funnel-step .funnel-step__connector,
    .funnel-step--done .funnel-step__connector {
      background: var(--pd-primary-600);
      opacity: 0.3;
    }
  `],
})
export class FunnelStepperComponent implements OnChanges {
  /**
   * Book language ('he' | 'en' | null). Drives dir + label maps.
   * Book-scoped: use bookLanguage, not the app default.
   */
  @Input() bookLanguage: string | null = null;

  /** True when a summary job is actively running (from JobRegistry or summaryBuilding flag). */
  @Input() summaryRunning = false;

  /** True when a review job is actively running (from JobRegistry or reviewBuilding flag). */
  @Input() reviewRunning = false;

  /**
   * True when the book summary (briefs) is ready (BookSummaryStatusDto.ready || hasSummary).
   * Drives Assess step: summary step completed => review step becomes the gate.
   */
  @Input() summaryReady = false;

  /**
   * True when the whole-book review is ready (BookReviewStatusDto.ready).
   * Drives Assess step done => Revise step becomes available.
   */
  @Input() reviewReady = false;

  /**
   * True when the book has usable chapter briefs (BookReviewStatusDto.hasBriefs).
   * When false and not building, Assess shows "needs summary first" CTA.
   */
  @Input() hasBriefs = false;

  /**
   * Emitted when the user clicks the Assess CTA. The parent (BookDashboardComponent) switches
   * the ReviewPanel to Review mode and scrolls to the status rows. Reuses the existing
   * onReviewModeChange() + scrollToStatusRow() mechanism in the editor / dashboard.
   */
  @Output() assessRequested = new EventEmitter<void>();

  /**
   * Emitted when the user clicks the Revise CTA. The parent can scroll to the findings ledger or
   * switch to Review mode. Phase 1: same CTA as Assess (switch to review + scroll to findings).
   */
  @Output() reviseRequested = new EventEmitter<void>();

  /** Whether to use Hebrew labels (RTL default). */
  get isHebrew(): boolean {
    return !(this.bookLanguage ?? '').toLowerCase().startsWith('en');
  }

  /** Content direction following bookLanguage. */
  get dir(): 'rtl' | 'ltr' {
    return this.isHebrew ? 'rtl' : 'ltr';
  }

  /** Resolved steps, recomputed on each input change. */
  resolvedSteps: ResolvedStep[] = [];

  /**
   * The single lit step that owns the CTA, rendered in the full-width action row below the step
   * strip. Exactly one of Assess/Revise carries a CTA at a time (Polish never does), so this is
   * unambiguous; null only in the transient no-step state.
   */
  get litStep(): ResolvedStep | null {
    return this.resolvedSteps.find(s => s.hasCta) ?? null;
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.resolvedSteps = this.deriveSteps();
  }

  /**
   * Core step-state derivation. Exactly ONE step is 'current' (the lit next-step).
   * Order: Structure -> Assess -> Revise -> Polish.
   *
   * Structure: always 'done' when the component is mounted (book is loaded = chapters exist).
   * Assess:    'in-progress' while summaryRunning || reviewRunning.
   *            'done' when reviewReady.
   *            'current' otherwise (lit next-step with CTA).
   * Revise:    'available' once reviewReady (Assess done) but not the first lit step.
   *            'current' when Assess is done (reviewReady) -- Revise becomes the lit next-step.
   *            Phase 1: no per-finding outcome data tracked; Revise stays 'available' when ready.
   *            (BookFinding.status exists as 'open'|'acknowledged'|'dismissed'|'done' but the
   *             dashboard does not emit per-finding outcome counts; keep as 'available' for now.)
   *            Blocked (available-locked) when Assess is not done.
   * Polish:    always 'coming'.
   */
  deriveSteps(): ResolvedStep[] {
    const he = this.isHebrew;

    // ── Step labels ── (DRAFT he - needs native review)
    const stepLabels: Record<FunnelStep, { he: string; en: string }> = {
      structure: { he: 'מבנה',   en: 'Structure' },
      assess:    { he: 'הערכה',  en: 'Assess'    },
      revise:    { he: 'עריכה',  en: 'Revise'    },
      polish:    { he: 'ליטוש',  en: 'Polish'    },
    };

    // ── State labels ── (DRAFT he - needs native review)
    const stateLabels: Record<StepState, { he: string; en: string }> = {
      done:        { he: 'הושלם',     en: 'Done'        },
      current:     { he: 'הבא',       en: 'Next'        },
      'in-progress': { he: 'בתהליך', en: 'In progress' },
      available:   { he: 'זמין',      en: 'Available'   },
      coming:      { he: 'בקרוב',     en: 'Coming soon' },
    };

    // ── CTA labels ── (DRAFT he - needs native review)
    const ctaLabels: Record<string, { he: string; en: string }> = {
      assess_build:       { he: 'בנה סקירה',   en: 'Build review'   },
      assess_review:      { he: 'הצג סקירה',   en: 'View review'    },
      assess_in_progress: { he: 'צפה בהתקדמות', en: 'View progress' },
      revise:             { he: 'עבור לממצאים', en: 'Go to findings' },
    };

    const label = (step: FunnelStep): string =>
      (he ? stepLabels[step].he : stepLabels[step].en);
    const stateLabel = (state: StepState): string =>
      (he ? stateLabels[state].he : stateLabels[state].en);

    // ── Derive step states ──

    // Structure: always done (book is loaded when this component is mounted).
    const structureState: StepState = 'done';

    // Assess: in-progress > done > current.
    let assessState: StepState;
    if (this.summaryRunning || this.reviewRunning) {
      assessState = 'in-progress';
    } else if (this.reviewReady) {
      assessState = 'done';
    } else {
      assessState = 'current';
    }

    // Revise: available once Assess is done, else locked (treated as 'available' but not lit).
    // Phase 1: no per-finding outcome surfaced, so Revise is either 'current' (lit next-step
    // after Assess done) or 'available' (blocked while Assess not done).
    let reviseState: StepState;
    if (assessState === 'done') {
      // Assess done -> Revise is the lit next-step.
      reviseState = 'current';
    } else {
      // Assess not done -> Revise is not yet available (show as available-locked).
      reviseState = 'available';
    }

    // Polish: always coming (Phase 2).
    const polishState: StepState = 'coming';

    // ── Build CTA for the lit step ──
    const assessCta = (): string => {
      if (assessState === 'in-progress') {
        return he ? ctaLabels['assess_in_progress'].he : ctaLabels['assess_in_progress'].en;
      }
      // Not built / needs build.
      if (!this.hasBriefs || !this.summaryReady) {
        return he ? ctaLabels['assess_build'].he : ctaLabels['assess_build'].en;
      }
      return he ? ctaLabels['assess_review'].he : ctaLabels['assess_review'].en;
    };

    const reviseCta = (): string =>
      he ? ctaLabels['revise'].he : ctaLabels['revise'].en;

    const steps: ResolvedStep[] = [
      {
        id: 'structure',
        state: structureState,
        label: label('structure'),
        stateLabel: stateLabel(structureState),
        hasCta: false,
        ctaLabel: '',
      },
      {
        id: 'assess',
        state: assessState,
        label: label('assess'),
        stateLabel: stateLabel(assessState),
        // CTA appears when Assess is 'current' OR 'in-progress' (shows "View progress").
        hasCta: assessState === 'current' || assessState === 'in-progress',
        ctaLabel: assessState === 'current' || assessState === 'in-progress' ? assessCta() : '',
      },
      {
        id: 'revise',
        state: reviseState,
        label: label('revise'),
        stateLabel: stateLabel(reviseState),
        // CTA appears only when Revise is the lit next-step ('current').
        hasCta: reviseState === 'current',
        ctaLabel: reviseState === 'current' ? reviseCta() : '',
      },
      {
        id: 'polish',
        state: polishState,
        label: label('polish'),
        stateLabel: stateLabel(polishState),
        hasCta: false,  // Polish: NO dead click in Phase 1.
        ctaLabel: '',
      },
    ];

    return steps;
  }

  /** Handle CTA click: route to the appropriate output. */
  onCtaClick(stepId: FunnelStep): void {
    if (stepId === 'assess') {
      this.assessRequested.emit();
    } else if (stepId === 'revise') {
      this.reviseRequested.emit();
    }
    // Structure and Polish: no CTA (hasCta=false, so this won't be called for them).
  }
}
