import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';
import { BookProofreadStatusDto } from '../../core/models/book-proofread';
import { BookProofreadService } from '../../core/services/book-proofread.service';
import { JobRegistryService, TrackedJob, isTerminal } from '../../core/services/job-registry.service';
import { ProofreadStringKey, ProofreadStringParams, proofreadString } from '../../core/i18n/proofread-strings';
import { RunChromeLang, formatEtaLabel, runChromeLang } from '../../core/i18n/run-strings';
import { estimateRemainingMs } from '../../core/utils/chunk-eta';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { BuildInputs, buildInputsFor, buildIsRefused } from '../../shared/stage-spine/stage-spine.model';
import { JobProgressInlineComponent } from '../../shared/job-progress-inline/job-progress-inline.component';
import { ExportKindId } from '../export/export-kinds';

/** How the LAST run this row watched ended. Derived from the parent job's terminal (see {@link outcomeOf}). */
export type BookProofreadOutcome =
  | { kind: 'done'; done: number; total: number }
  | { kind: 'partial'; done: number; total: number }
  | { kind: 'canceled'; done: number; total: number }
  | { kind: 'failed'; done: number; total: number };

/** What the consent prompt is about to start. `force` is the "run again" path (every chapter fresh). */
export interface BookProofreadConsent {
  force: boolean;
  chapters: number;
  skipped: number;
}

/** The empty-run job id the API answers when `started === false`. */
const EMPTY_JOB_ID = '00000000-0000-0000-0000-000000000000';

/**
 * c6 (whole-book proofread): the author-facing surface of the book-level proofread run, on the book
 * dashboard beside the review and writing-style rows.
 *
 * ── One owner for the run's progress ────────────────────────────────────────────────────────────
 * Unlike the review row (which predates the registry and still runs its own poll), this row adds NO
 * poller. Every run it starts or finds is published with `jobRegistry.track('book-proofread', ...)`
 * and observed through `jobById$`, so the row, the Activity Center, the dock and the inline progress
 * bar read one number. The registry is also what discovers the run's per-chapter CHILD jobs while it
 * polls the parent, which is what lights stage 4's per-chapter marks and refreshes the analysis panel
 * on the open chapter (see `discoverChildJobs` in job-registry.service.ts).
 *
 * ── The consent reads status FIRST ──────────────────────────────────────────────────────────────
 * Opening the consent re-reads the run status, and a run already in flight (another tab, another
 * session) is ATTACHED instead of being offered a second consent. The planned/skipped counts come from
 * that same fresh read. The API has no dry-run, so the consent carries the chapter count but no ETA:
 * the server's estimate arrives on the start response and renders as soon as the run starts.
 *
 * ── Outcomes ────────────────────────────────────────────────────────────────────────────────────
 * The parent's `completedChunks` is chapters PROOFREAD (a failed chapter advances the run but not that
 * count), so Succeeded with completed < total is a PARTIAL run, never a clean one. The registry keeps
 * that count unforced for this kind for exactly this reason.
 */
@Component({
  selector: 'app-book-proofread-status-row',
  standalone: true,
  imports: [JobProgressInlineComponent],
  templateUrl: './book-proofread-status-row.component.html',
  styleUrl: './book-status-row.scss',
})
export class BookProofreadStatusRowComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language; drives the run's language key, the chrome language and `[dir]`. Defaults to 'he'. */
  @Input() bookLanguage: string | null = null;
  /** Chapters in the book from the host's list. `null` = not known yet, never zero. */
  @Input() chapterCount: number | null = null;
  /** Chapters with text from the same host getter. `null` = not known yet, never zero. */
  @Input() chaptersWithText: number | null = null;

  /** The author asked for the annotated download. The host owns the Router, as for every export entry. */
  @Output() openExport = new EventEmitter<ExportKindId>();

  /** Latest status read for (book, language); null while loading, on no book, or after a failed read. */
  status: BookProofreadStatusDto | null = null;
  /** The parent job this row is following, or null. */
  runJobId: string | null = null;
  /** The registry's view of {@link runJobId}. */
  runJob: TrackedJob | null = null;
  /** The open consent prompt, or null. */
  consent: BookProofreadConsent | null = null;
  /** The status read behind a consent is in flight (the start button is disabled meanwhile). */
  preparingConsent = false;
  /** The start POST is in flight. */
  starting = false;
  /** The cancel was accepted; the run stops after its current chapter. Cleared on the terminal. */
  cancelling = false;
  /** The last start/cancel failure, as a string key; cleared by the next attempt. */
  errorKey: 'startFailed' | 'cancelFailed' | null = null;
  /** How the last watched run ended; cleared when a new one starts and on a context switch. */
  outcome: BookProofreadOutcome | null = null;
  /** A start answered "nothing to do" (every chapter turned fresh between the consent and the POST). */
  nothingToDo = false;
  /** The server's whole-run estimate from THIS session's start; null for a run found by reattach. */
  estimatedSeconds: number | null = null;

  private statusSub: Subscription | null = null;
  private consentSub: Subscription | null = null;
  private startSub: Subscription | null = null;
  private cancelSub: Subscription | null = null;
  private jobSub: Subscription | null = null;
  /** The parent whose terminal this row already handled, so a lingering status cannot re-attach it. */
  private handledJobId: string | null = null;

  constructor(
    private proofreadService: BookProofreadService,
    private jobRegistry: JobRegistryService,
    private cdr: ChangeDetectorRef,
  ) {}

  /** The language the run is keyed on (book language, default 'he'). */
  private get runLanguage(): string {
    return (this.bookLanguage ?? '').trim() || 'he';
  }

  get lang(): RunChromeLang {
    return runChromeLang(this.bookLanguage);
  }

  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'en' ? 'ltr' : 'rtl';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      // A run is keyed by (book, language): a change to either drops everything about the previous one,
      // including an open consent, which must never be confirmable into the new book.
      this.reset();
      if (this.bookId) this.loadStatus();
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeAll();
  }

  private unsubscribeAll(): void {
    this.statusSub?.unsubscribe();
    this.consentSub?.unsubscribe();
    this.startSub?.unsubscribe();
    this.cancelSub?.unsubscribe();
    this.jobSub?.unsubscribe();
    this.statusSub = this.consentSub = this.startSub = this.cancelSub = this.jobSub = null;
  }

  private reset(): void {
    this.unsubscribeAll();
    this.status = null;
    this.runJobId = null;
    this.runJob = null;
    this.consent = null;
    this.preparingConsent = false;
    this.starting = false;
    this.cancelling = false;
    this.errorKey = null;
    this.outcome = null;
    this.nothingToDo = false;
    this.estimatedSeconds = null;
    this.handledJobId = null;
  }

  // ── Status ──────────────────────────────────────────────────────────────────────────────────────

  /** Read the run status and attach to an in-flight run the server reports. Public for the host. */
  loadStatus(): void {
    if (!this.bookId) return;
    const bookId = this.bookId;
    const lang = this.runLanguage;
    this.statusSub?.unsubscribe();
    this.statusSub = this.proofreadService.getStatus(bookId, lang).subscribe({
      next: s => {
        if (!this.isCurrent(bookId, lang)) return;
        this.applyStatus(s);
        this.cdr.detectChanges();
      },
      error: () => {
        // Leave the last good status alone: a failed refresh must not blank a row that was describing
        // the book a moment ago. A row that never got one stays hidden, like the review row.
      },
    });
  }

  private applyStatus(s: BookProofreadStatusDto): void {
    this.status = s;
    if (s.activeJobId && s.activeJobId !== this.handledJobId && s.activeJobId !== this.runJobId) {
      this.attach(s.activeJobId, true);
    }
  }

  private isCurrent(bookId: string, lang: string): boolean {
    return this.bookId === bookId && this.runLanguage === lang;
  }

  // ── Following a run ─────────────────────────────────────────────────────────────────────────────

  /**
   * Follow a parent job through the registry. `reattached` = this client did not start it, so the
   * registry gives it no start time (no client-side ETA until it has been observed for a while).
   */
  private attach(jobId: string, reattached: boolean): void {
    if (!this.bookId) return;
    const bookId = this.bookId;
    const lang = this.runLanguage;
    this.consent = null;
    this.outcome = null;
    this.nothingToDo = false;
    this.cancelling = false;
    this.runJobId = jobId;
    this.runJob = null;
    this.jobRegistry.track('book-proofread', bookId, jobId, reattached ? { reattached: true } : {});
    this.jobSub?.unsubscribe();
    this.jobSub = this.jobRegistry.jobById$(jobId).subscribe(job => {
      if (!this.isCurrent(bookId, lang) || this.runJobId !== jobId) return;
      this.runJob = job;
      if (job && isTerminal(job.status)) this.onTerminal(job);
      this.cdr.detectChanges();
    });
  }

  private onTerminal(job: TrackedJob): void {
    this.handledJobId = job.id;
    this.outcome = outcomeOf(job);
    this.runJobId = null;
    this.runJob = null;
    this.cancelling = false;
    this.estimatedSeconds = null;
    // The job subscription is left to the next attach / reset / destroy: it can be delivering THIS call
    // synchronously from inside `attach` (a job already terminal in the registry), before `jobSub` is even
    // assigned. With `runJobId` cleared its handler is inert.
    // Coverage and staleness moved: re-read them.
    this.loadStatus();
  }

  /** True while a run is in flight (from this row's start, or found by status/registry). */
  get running(): boolean {
    return !!this.runJobId && (!this.runJob || !isTerminal(this.runJob.status));
  }

  /** Chapters proofread so far and planned, off the registry's parent job. */
  get runCounts(): { done: number; total: number } | null {
    const job = this.runJob;
    if (!job || job.totalChunks == null) return null;
    return { done: job.completedChunks ?? 0, total: job.totalChunks };
  }

  /**
   * The time-remaining line. The registry's OBSERVED throughput wins once a chapter has finished under
   * observation; before that, this session's server estimate scaled by the chapters still to go. A run
   * found by reattach has neither until it has been watched for one chapter, and shows no line.
   */
  get etaText(): string {
    const job = this.runJob;
    if (!job) return '';
    const observed = estimateRemainingMs({
      totalChunks: job.totalChunks,
      completedChunks: job.completedChunks,
      clock: job.chunkClock,
    });
    if (observed !== null) return formatEtaLabel(this.lang, observed);
    if (this.estimatedSeconds === null || this.estimatedSeconds <= 0) return '';
    const counts = this.runCounts;
    const fraction = counts && counts.total > 0 ? Math.max(0, counts.total - counts.done) / counts.total : 1;
    return formatEtaLabel(this.lang, this.estimatedSeconds * 1000 * fraction);
  }

  // ── Derived idle view ───────────────────────────────────────────────────────────────────────────

  get buildInputs(): BuildInputs {
    return buildInputsFor(this.chapterCount, this.chaptersWithText);
  }

  /** No chapters, or no chapter with text: the action is disabled with its reason, never hidden. */
  get blocked(): boolean {
    return buildIsRefused(this.buildInputs);
  }

  get blockedReason(): string {
    return this.t(this.buildInputs === 'no-text' ? 'needsText' : 'needsImport');
  }

  /** Chapters whose Active proofread result is newer than their last edit. */
  get freshChapters(): number {
    const s = this.status;
    return s ? Math.max(0, s.chaptersWithActiveProofread - s.chaptersStale) : 0;
  }

  /** Chapters a non-forced run would proofread now. */
  get plannedChapters(): number {
    const s = this.status;
    return s ? Math.max(0, s.chaptersWithText - this.freshChapters) : 0;
  }

  /** Every chapter with text is already fresh: the only run left is a forced one. */
  get allFresh(): boolean {
    const s = this.status;
    return !!s && s.chaptersWithText > 0 && this.plannedChapters === 0;
  }

  /** Show the row at all: once a status is known, or while a run is being followed. */
  get visible(): boolean {
    return !!this.status || this.running;
  }

  get coverageText(): string {
    const s = this.status;
    if (!s || s.chaptersWithActiveProofread === 0) return '';
    return this.t('coverage', { done: s.chaptersWithActiveProofread, total: s.chaptersWithText });
  }

  /** Timezone-aware relative time of the newest result (never a raw date pipe). */
  get lastRunText(): string {
    const when = formatRelativeTime(this.status?.lastRunAt ?? null, this.lang);
    return when ? this.t('lastRun', { when }) : '';
  }

  get staleText(): string {
    const stale = this.status?.chaptersStale ?? 0;
    return stale > 0 ? this.t('staleNote', { count: stale }) : '';
  }

  get outcomeText(): string {
    const o = this.outcome;
    if (!o) return '';
    switch (o.kind) {
      case 'done': return this.t('doneSummary', { count: o.done });
      case 'partial': return this.t('partial', { done: o.done, total: o.total });
      case 'canceled': return this.t('canceled', { done: o.done });
      case 'failed': return this.t('failed');
    }
  }

  /** The annotated download is worth offering whenever the last run left at least one chapter proofread. */
  get offerDownload(): boolean {
    const o = this.outcome;
    return !!o && o.kind !== 'failed' && o.done > 0;
  }

  t(key: ProofreadStringKey, params?: ProofreadStringParams): string {
    return proofreadString(this.lang, key, params);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Open the consent. Re-reads status first so a run already in flight is ATTACHED rather than offered a
   * second consent (c), and so the counts on the prompt are the ones the server will plan from.
   */
  openConsent(force: boolean): void {
    if (!this.bookId || this.blocked || this.running || this.preparingConsent || this.starting) return;
    const bookId = this.bookId;
    const lang = this.runLanguage;
    this.errorKey = null;
    this.nothingToDo = false;
    this.preparingConsent = true;
    this.consentSub?.unsubscribe();
    this.consentSub = this.proofreadService.getStatus(bookId, lang).subscribe({
      next: s => {
        if (!this.isCurrent(bookId, lang)) return;
        this.preparingConsent = false;
        this.applyStatus(s);
        if (this.running) {
          this.cdr.detectChanges();
          return;
        }
        if (force) {
          this.consent = { force: true, chapters: s.chaptersWithText, skipped: 0 };
        } else if (this.plannedChapters > 0) {
          this.consent = { force: false, chapters: this.plannedChapters, skipped: this.freshChapters };
        } else {
          this.nothingToDo = true;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.isCurrent(bookId, lang)) return;
        this.preparingConsent = false;
        this.errorKey = 'startFailed';
        this.cdr.detectChanges();
      },
    });
  }

  dismissConsent(): void {
    this.consent = null;
  }

  /** Consent confirmed: start the run (the API hands back an in-flight run's id instead of a second one). */
  confirmConsent(): void {
    const consent = this.consent;
    if (!consent || !this.bookId || this.starting || this.running) return;
    const bookId = this.bookId;
    const lang = this.runLanguage;
    this.consent = null;
    this.starting = true;
    this.errorKey = null;
    this.outcome = null;
    this.nothingToDo = false;
    this.startSub?.unsubscribe();
    this.startSub = this.proofreadService.start(bookId, lang, consent.force).subscribe({
      next: resp => {
        if (!this.isCurrent(bookId, lang)) return;
        this.starting = false;
        if (!resp.started || !resp.jobId || resp.jobId === EMPTY_JOB_ID) {
          this.nothingToDo = true;
          this.loadStatus();
        } else {
          // A run that was already in flight comes back started=true with ITS id; following it is the
          // whole of (c). The estimate is only meaningful for a run this start actually created, but the
          // API gives the same plan either way, so it is kept.
          this.estimatedSeconds = resp.estimatedSeconds > 0 ? resp.estimatedSeconds : null;
          this.attach(resp.jobId, false);
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.isCurrent(bookId, lang)) return;
        this.starting = false;
        this.errorKey = 'startFailed';
        this.cdr.detectChanges();
      },
    });
  }

  /** Stop the run before its next chapter. Finished chapters keep their results. */
  cancelRun(): void {
    const jobId = this.runJobId;
    if (!jobId || !this.bookId || this.cancelling || !this.running) return;
    const bookId = this.bookId;
    const lang = this.runLanguage;
    this.cancelling = true;
    this.errorKey = null;
    this.cancelSub?.unsubscribe();
    this.cancelSub = this.proofreadService.cancel(bookId, jobId).subscribe({
      // Nothing to do on success: the parent's own terminal (Canceled, or whatever it reached first)
      // arrives through the registry and settles the row.
      next: () => {},
      error: () => {
        if (!this.isCurrent(bookId, lang) || this.runJobId !== jobId) return;
        this.cancelling = false;
        this.errorKey = 'cancelFailed';
        this.cdr.detectChanges();
      },
    });
  }

  downloadAnnotated(): void {
    this.openExport.emit('book-docx-proofread');
  }
}

/**
 * Map a TERMINAL parent job to the row's outcome. `completedChunks` is chapters proofread and
 * `totalChunks` chapters planned (c5): Succeeded with everything done is `done`, Succeeded short of it is
 * `partial`, and Failed / Canceled keep their own counts.
 */
export function outcomeOf(job: TrackedJob): BookProofreadOutcome {
  const done = job.completedChunks ?? 0;
  const total = job.totalChunks ?? done;
  switch (job.status) {
    case 'succeeded':
      return done >= total ? { kind: 'done', done, total } : { kind: 'partial', done, total };
    case 'canceled':
      return { kind: 'canceled', done, total };
    default:
      return { kind: 'failed', done, total };
  }
}
