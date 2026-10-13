import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subscription, take } from 'rxjs';
import { BookProofreadFailedChapter, BookProofreadStatusDto } from '../../core/models/book-proofread';
import { BookProofreadService } from '../../core/services/book-proofread.service';
import { JobRegistryService, TrackedJob, isTerminal } from '../../core/services/job-registry.service';
import {
  ProofreadCountKey, ProofreadStringKey, ProofreadStringParams, proofreadCountString, proofreadString,
} from '../../core/i18n/proofread-strings';
import { RunChromeLang, formatEtaLabel, runChromeLang } from '../../core/i18n/run-strings';
import { estimateRemainingMs } from '../../core/utils/chunk-eta';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { chapterDisplayNumber } from '../../core/utils/chapter-number';
import { BuildInputs, buildInputsFor, buildIsRefused } from '../../shared/stage-spine/stage-spine.model';
import { JobProgressInlineComponent } from '../../shared/job-progress-inline/job-progress-inline.component';
import { ExportKindId } from '../export/export-kinds';

/** How the LAST run this row watched ended. Derived from the parent job's terminal (see {@link outcomeOf}). */
export type BookProofreadOutcome =
  | { kind: 'done'; done: number; total: number }
  | { kind: 'partial'; done: number; total: number }
  | { kind: 'canceled'; done: number; total: number }
  | { kind: 'failed'; done: number; total: number };

/**
 * What the consent prompt is about to start. `force` is the "run again" path (every chapter fresh);
 * `onlyFailed` (c20) is the retry of the chapters that failed in the last run (the server forces those).
 */
export interface BookProofreadConsent {
  force: boolean;
  onlyFailed?: boolean;
  chapters: number;
  skipped: number;
  /** c8: the server's whole-run estimate for THIS plan (forced or not), off the same status read. 0 = none. */
  estimatedSeconds: number;
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
 * that same fresh read, and so does the ETA (c8): the status carries the server's plan for both a normal
 * start and a forced one (c7), computed by the same planning method the start uses, so the consent and
 * the run it starts cannot disagree. An estimate of 0 renders no ETA line at all.
 *
 * ── Failed chapters (c20) ───────────────────────────────────────────────────────────────────────
 * A chapter whose attempt THREW keeps its previous result, which the server still counts as fresh when
 * it is reliable and newer than the last edit, so a normal start would skip it. A chapter that came back
 * unreliable archived its previous result (pending suggestions superseded) and is never fresh, so a
 * normal start re-plans it, but it is listed here too. The status lists those chapters (`failedChapters`, 0-based orders shown through
 * `chapterDisplayNumber`) with the estimate of re-running exactly them, and the row offers that retry
 * through the same consent. The record is the server's in-memory one: after an API restart it is empty.
 *
 * ── Outcomes ────────────────────────────────────────────────────────────────────────────────────
 * The parent's `completedChunks` is chapters PROOFREAD (a failed chapter advances the run but not that
 * count), so Succeeded with completed < total is a PARTIAL run, never a clean one. The registry keeps
 * that count unforced for this kind for exactly this reason.
 *
 * ── One word per chapter state (c02, on the be-c05 split) ──────────────────────────────────────────
 * The server reports each chapter as exactly one of covered, edited since, unreliable or not proofread.
 * The row says "N of M proofread" for covered (never all of them beside a partial outcome or the failed
 * list), "edited since the last proofread" for edited ONLY, and "needs proofreading again" for unreliable,
 * except a chapter the failed block already names, which that block owns. An older API without the split
 * keeps the old mixed stale count under the old wording.
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
  /**
   * c01: the handled parent ended because this CLIENT lost its poll (`endedBy: 'poll-error'`), not by a
   * server terminal. A status that still lists it as active then re-attaches it (the registry resumes the
   * poll) instead of being ignored as a lingering entry.
   */
  private handledJobLost = false;
  /**
   * c01: a parent whose poll was lost and whose fate the row is asking the status about. While set the row
   * keeps showing the run (no premature "failed"); the status answer either re-attaches it (still active)
   * or settles it as failed (not active, or the read itself failed: the window always resolves).
   */
  private lostRun: TrackedJob | null = null;

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
    this.handledJobLost = false;
    this.lostRun = null;
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
        if (!this.isCurrent(bookId, lang)) return;
        // c01: a lost run waiting on this read cannot wait forever; with no answer it is reported failed.
        const lost = this.lostRun;
        if (lost) {
          this.settleTerminal(lost);
          this.cdr.detectChanges();
        }
      },
    });
  }

  private applyStatus(s: BookProofreadStatusDto): void {
    this.status = s;
    const lost = this.lostRun;
    if (lost) {
      // c01: the status decides a lost run's fate. Still active: follow it again (the registry resumes its
      // poll). Gone: the run really ended without this client hearing how, so it is reported failed.
      if (s.activeJobId === lost.id) {
        this.lostRun = null;
        this.attach(lost.id, true);
        return;
      }
      this.settleTerminal(lost);
    }
    const handled = s.activeJobId === this.handledJobId && !this.handledJobLost;
    if (s.activeJobId && !handled && s.activeJobId !== this.runJobId) {
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
    this.lostRun = null;
    this.runJobId = jobId;
    this.runJob = null;
    // c01: for a parent this client LOST (`endedBy: 'poll-error'`), this track resumes its poll.
    // c03: `language` lets the registry word the run's scope label, and its discovered children's, in the
    // book's language ('Whole book' / 'Chapter' on an English book, as the live chapter path does).
    this.jobRegistry.track('book-proofread', bookId, jobId, reattached ? { language: lang, reattached: true } : { language: lang });
    this.jobSub?.unsubscribe();
    this.jobSub = this.jobRegistry.jobById$(jobId).subscribe(job => {
      if (!this.isCurrent(bookId, lang) || this.runJobId !== jobId) return;
      this.runJob = job;
      // A lost run already being confirmed is not a second terminal.
      if (job && isTerminal(job.status) && this.lostRun?.id !== job.id) this.onTerminal(job);
      this.cdr.detectChanges();
    });
  }

  private onTerminal(job: TrackedJob): void {
    if (job.endedBy === 'poll-error') {
      // c01: the CLIENT stopped hearing from the server; the run may well be going on. Ask the status before
      // saying "failed": the row keeps showing the run meanwhile (`running` stays true while `lostRun` is
      // set), and `applyStatus` / the read's error path settle it.
      this.lostRun = job;
      this.loadStatus();
      return;
    }
    this.settleTerminal(job);
    // Coverage and staleness moved: re-read them.
    this.loadStatus();
  }

  /** Record how the followed parent ended and stop following it. */
  private settleTerminal(job: TrackedJob): void {
    this.lostRun = null;
    this.handledJobId = job.id;
    this.handledJobLost = job.endedBy === 'poll-error';
    this.outcome = outcomeOf(job);
    this.runJobId = null;
    this.runJob = null;
    this.cancelling = false;
    this.estimatedSeconds = null;
    // The job subscription is left to the next attach / reset / destroy: it can be delivering THIS call
    // synchronously from inside `attach` (a job already terminal in the registry), before `jobSub` is even
    // assigned. With `runJobId` cleared its handler is inert.
  }

  /** True while a run is in flight (from this row's start, or found by status/registry). */
  get running(): boolean {
    if (!this.runJobId) return false;
    // c01: a lost run awaiting its status verdict still reads as running, never as a premature failure.
    if (this.lostRun?.id === this.runJobId) return true;
    return !this.runJob || !isTerminal(this.runJob.status);
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
    // f6: the server's word-weighted figure outranks both client estimates (the chapter clock
    // multiplies one giant chapter by the chapters left). 0 = nothing to say, so no line.
    const server = job.serverEtaSeconds;
    if (typeof server === 'number') return server > 0 ? formatEtaLabel(this.lang, server * 1000) : '';
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

  /**
   * c8: the consent's ETA line, the server's estimate for the plan on the prompt through the same
   * `formatEtaLabel` the running line uses. Empty (no line) when the estimate is 0 or missing.
   */
  get consentEtaText(): string {
    const seconds = this.consent?.estimatedSeconds ?? 0;
    return seconds > 0 ? formatEtaLabel(this.lang, seconds * 1000, 'total') : '';
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

  /**
   * Chapters covered and not edited since. be-c05: covered no longer includes an unreliable chapter, so only
   * the edited ones come off it; an older API (no split) counted unreliable as covered AND stale, so its
   * mixed stale count comes off instead.
   */
  get freshChapters(): number {
    const s = this.status;
    if (!s) return 0;
    const edited = typeof s.chaptersEdited === 'number' ? s.chaptersEdited : s.chaptersStale;
    return Math.max(0, s.chaptersWithActiveProofread - edited);
  }

  /**
   * Chapters a non-forced run would proofread now: the SERVER's plan (c7), which also counts a chapter
   * whose result was flagged unreliable as due. The derivation is only the fallback for a server that
   * does not send it yet.
   */
  get plannedChapters(): number {
    const s = this.status;
    if (!s) return 0;
    if (typeof s.plannedChapters === 'number') return Math.max(0, s.plannedChapters);
    return Math.max(0, s.chaptersWithText - this.freshChapters);
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

  /** The book holds at least one covered chapter (so the idle "what this does" hint is not for it). */
  get hasCoverage(): boolean {
    return (this.status?.chaptersWithActiveProofread ?? 0) > 0;
  }

  /**
   * "N of M chapters proofread" (covered of chapters with text). c02: the row never claims EVERY chapter
   * while it also says a chapter did not make it, i.e. beside a partial outcome or the failed-chapters list.
   * A chapter whose attempt threw keeps its previous reliable result, which the server counts as covered, so the full
   * count can be literally true and still contradict the line under it (the c20 gate showed "2 of 2
   * proofread" beside "partial 1 of 2"). A count short of every chapter agrees with both and stays.
   */
  get coverageText(): string {
    const s = this.status;
    if (!s || s.chaptersWithActiveProofread === 0) return '';
    const claimsAll = s.chaptersWithActiveProofread >= s.chaptersWithText;
    if (claimsAll && (this.outcome?.kind === 'partial' || this.failedChapters.length > 0)) return '';
    return this.tCount('coverage', s.chaptersWithText, { done: s.chaptersWithActiveProofread, total: s.chaptersWithText });
  }

  /** Timezone-aware relative time of the newest result (never a raw date pipe). */
  get lastRunText(): string {
    const when = formatRelativeTime(this.status?.lastRunAt ?? null, this.lang);
    return when ? this.t('lastRun', { when }) : '';
  }

  /**
   * "N chapters were edited since the last proofread". c02: from the be-c05 split this is `chaptersEdited`
   * ONLY, so an unreliable chapter is never worded as edited. An older API sends no split, and its mixed
   * `chaptersStale` keeps the old wording (the only count it has).
   */
  get staleText(): string {
    const s = this.status;
    if (!s) return '';
    const edited = typeof s.chaptersEdited === 'number' ? s.chaptersEdited : s.chaptersStale;
    return edited > 0 ? this.tCount('staleNote', edited, { count: edited }) : '';
  }

  /**
   * c02: "N chapters need proofreading again", for chapters whose current result is flagged unreliable.
   *
   * ONE owner per chapter: since be-c01 an unreliable result in a whole-book run also lands the chapter in
   * `failedChapters`, and the failed block NAMES it and offers the retry, so it owns that chapter. This note
   * counts only the unreliable chapters the failed block does not list (an unreliable result from a
   * single-chapter run, or one the in-memory failed record lost to an API restart); the normal start plans
   * those (the server counts an unreliable chapter as due). Older API without the split: no note (its
   * `chaptersStale` already carries them, under the old wording).
   */
  get unreliableText(): string {
    const s = this.status;
    if (!s || typeof s.chaptersUnreliable !== 'number') return '';
    const failedIds = new Set(this.failedChapters.map(c => c.chapterId));
    const ownedByFailed = (s.unreliableChapters ?? []).filter(c => failedIds.has(c.chapterId)).length;
    const count = Math.max(0, s.chaptersUnreliable - ownedByFailed);
    return count > 0 ? this.tCount('unreliableNote', count, { count }) : '';
  }

  /** c20: chapters whose latest whole-book attempt failed (server order = reading order). */
  get failedChapters(): BookProofreadFailedChapter[] {
    return this.status?.failedChapters ?? [];
  }

  /** "פרק 3: title" / "Chapter 3: title": the 1-based number the author sees, never the stored order. */
  failedChapterLabel(chapter: BookProofreadFailedChapter): string {
    const number = chapterDisplayNumber(chapter.order);
    const title = (chapter.title ?? '').trim();
    return title
      ? this.t('failedChapterItem', { number, title })
      : this.t('failedChapterItemUntitled', { number });
  }

  get outcomeText(): string {
    const o = this.outcome;
    if (!o) return '';
    switch (o.kind) {
      case 'done': return this.tCount('doneSummary', o.done, { count: o.done });
      case 'partial': return this.t('partial', { done: o.done, total: o.total });
      case 'canceled': return this.tCount('canceled', o.done, { done: o.done });
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

  /** A chapter-count string: the singular at exactly 1, the plural otherwise. */
  tCount(key: ProofreadCountKey, count: number, params?: ProofreadStringParams): string {
    return proofreadCountString(this.lang, key, count, params);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Open the consent. Re-reads status first so a run already in flight is ATTACHED rather than offered a
   * second consent (c), and so the counts on the prompt are the ones the server will plan from.
   */
  openConsent(force: boolean): void {
    this.prepareConsent(s => {
      if (force) {
        const chapters = typeof s.forcePlannedChapters === 'number' ? s.forcePlannedChapters : s.chaptersWithText;
        return { force: true, chapters, skipped: 0, estimatedSeconds: s.forceEstimatedSeconds ?? 0 };
      }
      if (this.plannedChapters > 0) {
        const chapters = this.plannedChapters;
        return {
          force: false,
          chapters,
          skipped: Math.max(0, s.chaptersWithText - chapters),
          estimatedSeconds: s.estimatedSeconds ?? 0,
        };
      }
      this.nothingToDo = true;
      return null;
    });
  }

  /**
   * c20: open the consent for re-running exactly the chapters that failed in the last run, off a FRESH
   * status read (count and ETA are the server's `onlyFailed` plan). When the fresh read lists none any
   * more (another tab retried them, or a per-chapter run covered them), the refreshed status simply drops
   * the failed block: there is nothing to confirm and nothing to explain.
   */
  openRetryConsent(): void {
    this.prepareConsent(s => {
      const chapters = s.failedChapters?.length ?? 0;
      if (chapters === 0) return null;
      return { force: false, onlyFailed: true, chapters, skipped: 0, estimatedSeconds: s.failedEstimatedSeconds ?? 0 };
    });
  }

  /** The shared half of both consents: re-read status, attach to a run in flight, else build the prompt. */
  private prepareConsent(build: (s: BookProofreadStatusDto) => BookProofreadConsent | null): void {
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
        if (!this.running) this.consent = build(s);
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
    const start$ = consent.onlyFailed
      ? this.proofreadService.startFailed(bookId, lang)
      : this.proofreadService.start(bookId, lang, consent.force);
    this.startSub = start$.subscribe({
      next: resp => {
        if (!this.isCurrent(bookId, lang)) return;
        this.starting = false;
        if (!resp.started || !resp.jobId || resp.jobId === EMPTY_JOB_ID) {
          // A retry that finds nothing recorded any more says nothing: the refreshed status drops the block.
          this.nothingToDo = !consent.onlyFailed;
          this.loadStatus();
        } else {
          // A run that was already in flight comes back started=true with ITS id; following it is the
          // whole of (c). c04: the response's estimate is for the plan THIS click would have run, not for
          // the run it hands back, so a run this client already knew (a lost run, one the registry tracks)
          // is followed as a reattach: no start-time clock, no estimate. A brand-new id is known nowhere.
          const created = !this.isKnownRun(resp.jobId);
          this.estimatedSeconds = created && resp.estimatedSeconds > 0 ? resp.estimatedSeconds : null;
          this.attach(resp.jobId, !created);
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

  /**
   * c04: true when `jobId` names a run this client already knew before the start answered: the run this
   * row last settled, the run its status read reported, or any job the registry holds (a run found on book
   * load, or one this row lost its poll on). A run the start CREATED has a fresh id none of them can hold.
   * Residual: a run another tab started after this tab's last read is unknown here too, and still reads as
   * created; the start response carries no field that tells the two apart.
   */
  private isKnownRun(jobId: string): boolean {
    if (jobId === this.handledJobId || jobId === this.status?.activeJobId) return true;
    let known = false;
    // The registry's job list is a BehaviorSubject, so this answers synchronously.
    this.jobRegistry.jobById$(jobId).pipe(take(1)).subscribe(job => { known = job !== null; });
    return known;
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
