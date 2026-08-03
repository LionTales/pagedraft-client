import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Observable, of } from 'rxjs';

import {
  JobRegistryService,
  JobStatus,
  TrackedJob,
  isTerminal,
  showsChunkCounts,
} from '../../core/services/job-registry.service';

/**
 * Wave 1d (c2): the IN-PAGE progress indicator for one tracked background job.
 *
 * This is surface (ii) of the three that must agree about a single run:
 *   (i) the run dialog, (ii) this in-page indicator, (iii) the Activity Center panel.
 *
 * It exists so that all three read ONE owner. Before this component, the in-page indicator was the
 * editor's full-screen `.analysis-overlay`, whose percent came from the orchestration service's own
 * `'progress'` events and was re-clamped and made monotonic locally: a SECOND owner of the same number,
 * which could and did drift from the registry (different clamp, different terminal handling, different
 * lifetime). This component adds NO poller and NO normalization; it is a pure view over
 * {@link JobRegistryService.jobById$}, exactly like the dialog and the Activity Center row.
 *
 * The markup mirrors the Activity Center row's progress markup so a screen reader gets the SAME contract
 * on every surface: a determinate bar carries `aria-valuenow/valuemin/valuemax` plus a numeric readout;
 * an indeterminate (still running, percent unknown) bar omits the value attrs entirely rather than
 * emitting an ambiguous `aria-valuenow="null"`; and a job that is OVER with no percent ever learned is
 * an inert bar that is not a `progressbar` at all (c05), never the pulsing indeterminate one.
 *
 * Renders nothing at all when there is no job id or the id is not (yet) tracked.
 */
@Component({
  selector: 'app-job-progress-inline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe],
  template: `
    @let job = job$ | async;
    @if (job) {
      @if (job.percent !== null) {
        <div class="jpi-row">
          <div
            class="jpi-track"
            role="progressbar"
            [attr.aria-valuenow]="job.percent"
            aria-valuemin="0"
            aria-valuemax="100">
            <div class="jpi-fill jpi-fill--det" [style.width.%]="job.percent"></div>
          </div>
          <!-- c04: the same completed/total the run dialog spells out as a sentence, in the compact
               treatment this surface has room for. Language-neutral on purpose ("3/10" is digits and a
               separator, which the bidi algorithm keeps together in RTL), so this surface needs no
               language source of its own. The NUMBERS are the registry's, so they cannot differ from
               the dialog's or the Activity Center's; three-surface-parity.spec.ts pins that.
               c02: WHICH kinds may show them is the registry's decision too (showsChunkCounts), not a
               condition copied into this template. This component takes any job id, so although the
               analysis panel only ever points it at a chapter analysis run today, it must not render a
               review build's window-plus-reduce-pass denominator as a bare pair if it is ever pointed
               at one. -->
          @if (showsCounts(job)) {
            <span class="jpi-counts" aria-hidden="true">{{ job.completedChunks ?? 0 }}/{{ job.totalChunks }}</span>
          }
          <span class="jpi-percent" aria-hidden="true">{{ job.percent }}%</span>
        </div>
      } @else if (isEnded(job.status)) {
        <!-- Over, and no percent was ever known (c05): inert, and NOT a progressbar. A terminal job
             used to fall into the indeterminate branch below and pulse an infinite animation, and
             announce itself to a screen reader as a live task of unknown size. Kept identical to
             .rd-progress-track--ended (run dialog) and .ac-progress-track--ended (Activity Center). -->
        <div class="jpi-track jpi-track--ended" aria-hidden="true"></div>
      } @else {
        <div class="jpi-track" role="progressbar">
          <div class="jpi-fill jpi-fill--indet"></div>
        </div>
      }
    }
  `,
  styleUrl: './job-progress-inline.component.scss',
})
export class JobProgressInlineComponent implements OnChanges {
  private readonly registry = inject(JobRegistryService);

  /** The job to mirror. Null (or an untracked id) renders nothing. */
  @Input() jobId: string | null = null;

  /** The tracked job, straight off the registry. Re-resolved whenever `jobId` changes. */
  job$: Observable<TrackedJob | null> = of(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['jobId']) return;
    this.job$ = this.jobId ? this.registry.jobById$(this.jobId) : of(null);
  }

  /**
   * Whether the job is over (c05). Reuses the registry's own terminal predicate rather than
   * hand-rolling one, so "over" means the same thing here as on the other two surfaces. Only the
   * progress bar reads it: a terminal job with a null percent must not show the pulsing bar.
   */
  isEnded(status: JobStatus): boolean {
    return isTerminal(status);
  }

  /**
   * Whether this job may render the bare `completed/total` pair (c02). One registry predicate, three
   * surfaces: see {@link showsChunkCounts} for the per-kind units and why `review` is excluded.
   */
  showsCounts(job: TrackedJob): boolean {
    return showsChunkCounts(job);
  }
}
