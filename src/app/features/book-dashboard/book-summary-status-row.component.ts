import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { formatRelativeTime } from '../../core/utils/relative-time';

/**
 * wb3-c01: book-summary (briefs) status row + build orchestration, relocated out of the per-chapter
 * analysis panel into the book-scoped dashboard. Self-contained: it reads its own status, drives the
 * BUILDING/READY/STALE/NOT-BUILT state machine, owns the consent gate, and runs the Subject-driven
 * progress poll. The book summary is keyed by (bookId, language); a change to either tears the build
 * down and re-reads status (reset-on-book/language-switch).
 *
 * Emits `summaryTerminal` whenever a build reaches a terminal/error state OR a no-op build confirms an
 * already-fresh summary, so the host can refresh the book-review row (a finished summary clears the
 * review's "build summary first" gate and can mark an existing review stale).
 */
@Component({
  selector: 'app-book-summary-status-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './book-summary-status-row.component.html',
  styleUrl: './book-status-row.scss',
})
export class BookSummaryStatusRowComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the status key. */
  @Input() bookLanguage: string | null = null;

  /** Fired when a summary build reaches a terminal/error state (or a no-op confirms a fresh summary). */
  @Output() summaryTerminal = new EventEmitter<void>();
  /**
   * Emits whether a summary build is currently in flight. Fired whenever `bookSummaryBuilding` changes
   * (build start, reattach to an in-progress job, terminal/error), so the dashboard host can aggregate a
   * "review running" affordance that stays visible even after the dashboard is unmounted (close panel /
   * focus mode). The host holds the last-emitted value; the row itself is destroyed on unmount.
   */
  @Output() buildingChange = new EventEmitter<boolean>();

  /** Latest book-summary status read for the current book (null while loading / no book). */
  bookSummaryStatus: BookSummaryStatusDto | null = null;
  /** Backing field for {@link bookSummaryBuilding}; mutated only via the setter so the change emits. */
  private _bookSummaryBuilding = false;
  /**
   * True while a summary build job is in flight (drives the BUILDING state). Backed by a setter so every
   * transition emits {@link buildingChange} to the host — including the reattach-to-an-in-progress-job
   * path — without having to remember to emit at each of the many assignment sites.
   */
  get bookSummaryBuilding(): boolean {
    return this._bookSummaryBuilding;
  }
  set bookSummaryBuilding(value: boolean) {
    if (this._bookSummaryBuilding === value) return;
    this._bookSummaryBuilding = value;
    this.buildingChange.emit(value);
  }
  /** Live summary build progress 0..100 (null = indeterminate). */
  bookSummaryProgressPercent: number | null = null;
  /** Human-readable progress message from the summary build job. */
  bookSummaryProgressMessage = '';
  /** True while the book-summary consent prompt is open. */
  showBookSummaryConsent = false;

  /** Stops the active summary progress poll; nulled when no poll is running. */
  private bookSummaryProgressStop$: Subject<void> | null = null;
  /** Active summary-related subscriptions (build POST); cleared on context change / destroy. */
  private bookSummarySub: Subscription | null = null;
  /** The latest in-flight GET summary status fetch (cancels previous on overlap). */
  private bookSummaryStatusSub: Subscription | null = null;
  /** Loop guard for summary build: a jobId already driven to terminal here will not reattach. */
  private bookSummaryHandledTerminalJobId: string | null = null;

  constructor(
    private bookSummaryService: BookSummaryService,
    private analysisProgressService: AnalysisProgressService,
    private cdr: ChangeDetectorRef
  ) {}

  /** Effective book language for summary calls (defaults to 'he'). */
  private get summaryLanguage(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The summary is keyed by (book, language); a change to EITHER invalidates the current build/poll.
    if (changes['bookId'] || changes['bookLanguage']) {
      // Dismiss any open consent for the PREVIOUS book/language so it cannot be confirmed into the new one.
      this.showBookSummaryConsent = false;
      if (this.bookId) {
        this.resetBookSummaryBuildState();
        this.loadBookSummaryStatus();
      } else {
        this.resetBookSummaryBuildState();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopBookSummaryProgress();
    this.bookSummarySub?.unsubscribe();
    this.bookSummaryStatusSub?.unsubscribe();
    this.bookSummaryHandledTerminalJobId = null;
  }

  // ── Status load + reset ─────────────────────────────────────────────────────

  /** Fetch the current book-summary status for this book/language and update the row. */
  loadBookSummaryStatus(): void {
    if (!this.bookId) {
      this.bookSummaryStatus = null;
      return;
    }
    const bookId = this.bookId;
    const lang = this.summaryLanguage;
    this.bookSummaryStatusSub?.unsubscribe();
    this.bookSummaryStatusSub = this.bookSummaryService.getBookSummaryStatus(bookId, lang).subscribe({
      next: (status) => {
        // Drop a stale response after the user switched books OR languages (summary is per (book, language)).
        if (this.bookId !== bookId || this.summaryLanguage !== lang) return;
        this.bookSummaryStatus = status;
        if (status.ready && this.bookSummaryBuilding && this.bookSummaryProgressPercent === 100) {
          this.bookSummaryBuilding = false;
        }
        // Reattach to an in-progress build (started in another tab/session).
        if (
          status.activeBuildJobId &&
          status.activeBuildJobId !== this.bookSummaryHandledTerminalJobId &&
          !this.bookSummaryBuilding &&
          !this.bookSummaryProgressStop$
        ) {
          this.bookSummaryBuilding = true;
          this.bookSummaryProgressPercent = null;
          this.bookSummaryProgressMessage = '';
          this.pollBookSummaryBuild(bookId, status.activeBuildJobId, lang);
        }
        this.cdr.detectChanges();
      },
      error: () => { /* leave current; row hides when status is null */ },
    });
  }

  /** Stop any active book-summary progress poll. */
  private stopBookSummaryProgress(): void {
    if (this.bookSummaryProgressStop$) {
      this.bookSummaryProgressStop$.next();
      this.bookSummaryProgressStop$.complete();
      this.bookSummaryProgressStop$ = null;
    }
  }

  /** Tear down any in-flight book-summary build/poll and reset its UI + loop guard. */
  private resetBookSummaryBuildState(): void {
    this.stopBookSummaryProgress();
    this.bookSummarySub?.unsubscribe();
    this.bookSummaryStatusSub?.unsubscribe();
    this.bookSummaryBuilding = false;
    this.bookSummaryProgressPercent = null;
    this.bookSummaryProgressMessage = '';
    this.bookSummaryStatus = null;
    this.bookSummaryHandledTerminalJobId = null;
  }

  // ── Build orchestration ─────────────────────────────────────────────────────

  /** Consent confirmed: start (or no-op) the book summary build. */
  onBuildBookSummary(): void {
    if (!this.bookId) return;
    if (this.bookSummaryBuilding) return;
    const bookId = this.bookId;
    const language = this.summaryLanguage;
    this.stopBookSummaryProgress();
    this.bookSummaryBuilding = true;
    this.bookSummaryProgressPercent = null;
    this.bookSummaryProgressMessage = '';
    this.bookSummaryHandledTerminalJobId = null;
    this.cdr.detectChanges();

    this.bookSummarySub?.unsubscribe();
    this.bookSummarySub = this.bookSummaryService.buildBookSummary(bookId, language).subscribe({
      next: (resp) => {
        // Drop a stale response after the user switched books OR languages (summary is per (book, language)).
        if (this.bookId !== bookId || this.summaryLanguage !== language) return;
        if (resp.noOp || !resp.jobId) {
          this.bookSummaryBuilding = false;
          this.loadBookSummaryStatus();
          // An already-fresh summary (no-op) still means briefs are present: tell the host so the
          // book-review row clears its "build summary first" gate (and shows STALE if a review exists).
          this.summaryTerminal.emit();
          this.cdr.detectChanges();
          return;
        }
        this.pollBookSummaryBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.summaryLanguage !== language) return;
        this.bookSummaryBuilding = false;
        this.bookSummaryProgressMessage = '';
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the book-summary build job and refresh status when it reaches a terminal state. */
  private pollBookSummaryBuild(bookId: string, jobId: string, lang: string): void {
    this.stopBookSummaryProgress();
    const stop$ = new Subject<void>();
    this.bookSummaryProgressStop$ = stop$;
    this.analysisProgressService.pollBookSummaryProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        // Ignore a stale poll emit after the user switched books OR languages (summary is per (book, language)).
        if (this.bookId !== bookId || this.summaryLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.bookSummaryProgressMessage = p.message ?? '';
        this.bookSummaryProgressPercent =
          status === 'succeeded'
            ? 100
            : (Number.isFinite(p.estimatedCompletionPercent)
                ? Math.max(0, Math.min(100, p.estimatedCompletionPercent))
                : this.bookSummaryProgressPercent);
        if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
          this.bookSummaryBuilding = false;
          this.stopBookSummaryProgress();
          this.bookSummaryHandledTerminalJobId = jobId;
          this.loadBookSummaryStatus();
          // A finished summary build makes briefs present (clearing the review row's "build summary first"
          // gate) and any existing review staleVsBriefs: tell the host so the review row reflects both.
          this.summaryTerminal.emit();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.summaryLanguage !== lang) return;
        this.bookSummaryBuilding = false;
        this.stopBookSummaryProgress();
        this.bookSummaryHandledTerminalJobId = jobId;
        this.loadBookSummaryStatus();
        // The poll errored: still tell the host to re-read review status (the summary may have completed
        // before the poll dropped) so a stuck "build summary first" gate is not left behind.
        this.summaryTerminal.emit();
        this.cdr.detectChanges();
      },
    });
  }

  // ── Derived view state ──────────────────────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the summary status row. */
  get bookSummaryDir(): 'rtl' | 'ltr' {
    return this.summaryLanguage.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /**
   * Derived state for the book-summary status row. BUILDING is client-tracked (bookSummaryBuilding)
   * so it wins over the snapshot read while a job is in flight.
   */
  get bookSummaryState(): 'building' | 'not-built' | 'ready' | 'stale' | 'unknown' {
    if (this.bookSummaryBuilding) return 'building';
    const s = this.bookSummaryStatus;
    if (!s) return 'unknown';
    if (s.hasSummary && (s.staleCount > 0 || s.builtWithDifferentModel)) return 'stale';
    if (s.ready) return 'ready';
    if (!s.hasSummary && s.builtChapters === 0) return 'not-built';
    return s.hasSummary ? 'ready' : 'not-built';
  }

  /** True when a summary exists but was built with a different model (drives the cross-model warning). */
  get bookSummaryBuiltWithDifferentModel(): boolean {
    return !!this.bookSummaryStatus?.builtWithDifferentModel;
  }

  /** Coverage string "N/N" from the status read. */
  get bookSummaryCoverage(): string {
    const s = this.bookSummaryStatus;
    if (!s) return '';
    return `${s.builtChapters}/${s.totalChapters}`;
  }

  /** Localized, timezone-aware "updated <relative time>" for the last build. Empty when never built. */
  get bookSummaryUpdatedRelative(): string {
    const s = this.bookSummaryStatus;
    if (!s?.lastUpdatedAt) return '';
    const lang = this.summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'he';
    return formatRelativeTime(s.lastUpdatedAt, lang);
  }

  /** Localized labels for the book-summary status row. he default, en when book language is English. */
  bookSummaryLabel(key: string): string {
    const lang = this.summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'he';
    const he: Record<string, string> = {
      title: 'תקצירי ספר',
      notBuilt: 'טרם נבנה',
      buildNow: 'בנה עכשיו',
      building: 'בונה תקצירים...',
      refresh: 'רענן',
      coverage: 'כיסוי',
      updated: 'עודכן',
      stalePrefix: 'פרקים שהשתנו:',
      consentTitle: 'בניית תקצירי ספר',
      consentBody: 'פעולה זו תנתח את פרקי הספר כדי לבנות תקצירים לכל פרק.',
      confirm: 'אישור',
      cancel: 'ביטול',
      crossModelWarning: 'התקצירים נבנו עם מודל אחר מהפעיל כעת. רעננו אותם לקבלת תוצאות מדויקות.',
    };
    const en: Record<string, string> = {
      title: 'Book briefs',
      notBuilt: 'Not built',
      buildNow: 'Build now',
      building: 'Building briefs...',
      refresh: 'Refresh',
      coverage: 'Coverage',
      updated: 'Updated',
      stalePrefix: 'Chapters changed:',
      consentTitle: 'Build book briefs',
      consentBody: 'This will analyze the book chapters to build a brief summary for each chapter.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      crossModelWarning: 'The briefs were built with a different model than the one now active. Refresh them for accurate results.',
    };
    const map = lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Build estimate sentence for the consent prompt, e.g. "~3 chapters, ~2 min". */
  get bookSummaryConsentEstimate(): string {
    const s = this.bookSummaryStatus;
    if (!s) return '';
    const lang = this.summaryLanguage.toLowerCase().startsWith('en') ? 'en' : 'he';
    const chapters = s.chaptersToBuild;
    const minutes = Math.max(1, Math.ceil((s.estimatedSeconds || 0) / 60));
    let phrase: string;
    if (lang === 'he') {
      phrase = `~${chapters} פרקים, ~${minutes} דקות`;
    } else {
      phrase = `~${chapters} chapters, ~${minutes} min`;
    }
    if (s.estimatedUsd != null) {
      phrase += `, ~$${this.formatUsd(s.estimatedUsd)}`;
    }
    return phrase;
  }

  private formatUsd(usd: number): string {
    if (!Number.isFinite(usd)) return '0';
    return usd < 1 ? usd.toFixed(2) : usd.toFixed(2).replace(/\.00$/, '');
  }

  // ── Consent gate ────────────────────────────────────────────────────────────

  openBookSummaryConsent(): void {
    this.showBookSummaryConsent = true;
  }

  cancelBookSummaryConsent(): void {
    this.showBookSummaryConsent = false;
  }

  /** Confirm book-summary consent -> close the prompt and start the build (no-op while building). */
  confirmBookSummaryBuild(): void {
    this.showBookSummaryConsent = false;
    if (this.bookSummaryBuilding) return;
    this.onBuildBookSummary();
  }
}
