import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { BookReviewStatusDto } from '../../core/models/book-review';
import { BookReviewService } from '../../core/services/book-review.service';
import { formatRelativeTime } from '../../core/utils/relative-time';

/** Derived review state for the whole-book developmental review. Single source of truth shared by the
 *  status row (@Output) and the dashboard host (field + handler types). */
export type BookReviewState = 'building' | 'not-built' | 'ready' | 'stale' | 'needs-summary' | 'unknown';

/**
 * wb3-c01: whole-book developmental review status row + build orchestration, relocated out of the
 * per-chapter analysis panel into the book-scoped dashboard. Self-contained: it reads its own status,
 * drives the BUILDING/READY/STALE/NOT-BUILT/NEEDS-SUMMARY state machine, owns the consent gate + the
 * build-outcome banner (failed/degraded), and runs the Subject-driven progress poll. The review is keyed
 * by (bookId, language); a change to either tears the build down and re-reads status.
 *
 * `loadBookReviewStatus()` is public so the host can refresh this row after a sibling book-summary build
 * finishes (a finished summary clears the review's "build summary first" gate and may mark it stale).
 */
@Component({
  selector: 'app-book-review-status-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './book-review-status-row.component.html',
  styleUrl: './book-status-row.scss',
})
export class BookReviewStatusRowComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the status key. */
  @Input() bookLanguage: string | null = null;

  /**
   * Emits the current derived review state on every successful status read (wb3-c02 seam): the host uses it
   * to decide whether to mount the scorecard/ledger (READY/STALE) and to re-read findings after a build
   * terminal. Emitting on each status response - not only on build terminals - keeps the host in sync with
   * an in-progress build started in another tab/session as well.
   */
  @Output() reviewStateChange = new EventEmitter<BookReviewState>();

  /** Latest book-review status read for the current book (null while loading / no book). */
  bookReviewStatus: BookReviewStatusDto | null = null;
  /** True while a review build job is in flight (drives the BUILDING state). */
  bookReviewBuilding = false;
  /** Live review build progress 0..100 (null = indeterminate). */
  bookReviewProgressPercent: number | null = null;
  /** Human-readable progress message from the review build job. */
  bookReviewProgressMessage = '';
  /**
   * Outcome of the LAST finished review build: 'failed' (all dimensions failed -> no findings),
   * 'degraded' (succeeded but some dimensions failed), else null. Surfaced in the banner so a total
   * failure does not read as a silent green finish. Reset when a new build starts.
   */
  bookReviewBuildOutcome: 'failed' | 'degraded' | null = null;
  /** The terminal build message text accompanying the outcome. May be English; the banner localizes separately. */
  bookReviewBuildOutcomeMessage = '';
  /**
   * Finding count for the degraded banner, sourced from the POST-build status refresh (NOT the pre-build
   * snapshot). Null until that refresh returns — and stays null if it fails — so the banner never shows a
   * stale/wrong total. Reset whenever the outcome is (re)set.
   */
  bookReviewBuildOutcomeCount: number | null = null;
  /** True while the book-review consent prompt is open. */
  showBookReviewConsent = false;

  // ── wb4-c06 build-shape captured from the LIVE build-completion (progress terminal) payload ──────────
  // The window/continuity/failed-window provenance is build-time-only: the persisted status probe reports it
  // as 0/false, and loadBookReviewStatus() (run at every build terminal) REPLACES bookReviewStatus with that
  // zeroed probe. So the window detail + partial-window warning are captured HERE, from the terminal progress
  // payload, into dedicated fields that survive the status refresh. Null = no live build this session for the
  // current book (the getters then fall back to bookReviewStatus, i.e. hidden). Reset on a new build / context
  // change so a stale shape never leaks onto a different book or a later rebuild.
  /** Window count from the last live build terminal; null until a build completes this session. */
  bookReviewBuildWindowCount: number | null = null;
  /** Whether the continuity reduce pass ran in the last live build; null until a build completes this session. */
  bookReviewBuildRanContinuityReduce: boolean | null = null;
  /** Failed-window count from the last live build terminal; null until a build completes this session. */
  bookReviewBuildFailedWindows: number | null = null;

  /**
   * True after a review build TERMINAL until the NEXT successful status response reconciles the banner.
   * Carried as state (not a per-call flag) so the intent survives an overlapping refresh canceling the
   * terminal's own fetch. Consumed by the reconciling response; cleared on a new build / context change.
   */
  private bookReviewPendingPostBuildReconcile = false;
  /** Stops the active review progress poll; nulled when no poll is running. */
  private bookReviewProgressStop$: Subject<void> | null = null;
  /** Active review-related subscriptions (build POST); cleared on context change / destroy. */
  private bookReviewSub: Subscription | null = null;
  /** The latest in-flight GET review status fetch (cancels previous on overlap). */
  private bookReviewStatusSub: Subscription | null = null;
  /** Loop guard for review build: a jobId already driven to terminal here will not reattach. */
  private bookReviewHandledTerminalJobId: string | null = null;

  constructor(
    private bookReviewService: BookReviewService,
    private cdr: ChangeDetectorRef
  ) {}

  /** Effective book language for review calls (defaults to 'he'). */
  private get reviewLanguage(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The review is keyed by (book, language); a change to EITHER invalidates the current build/poll.
    if (changes['bookId'] || changes['bookLanguage']) {
      // Dismiss any open consent for the PREVIOUS book/language so it cannot be confirmed into the new one.
      this.showBookReviewConsent = false;
      this.resetBookReviewBuildState();
      if (this.bookId) {
        this.loadBookReviewStatus();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopBookReviewProgress();
    this.bookReviewSub?.unsubscribe();
    this.bookReviewStatusSub?.unsubscribe();
    this.bookReviewHandledTerminalJobId = null;
  }

  // ── Status load + reset ─────────────────────────────────────────────────────

  /**
   * Fetch the current book-review status for this book/language and update the row.
   *
   * The build-outcome banner reconcile (clearing a stale 'failed', filling the degraded count) runs on
   * the FIRST successful response after a build terminal — gated on the persistent
   * bookReviewPendingPostBuildReconcile flag, NOT on which call issued the fetch — so whichever response
   * arrives first does the reconcile even if an overlapping ordinary refresh cancels the terminal's fetch.
   */
  loadBookReviewStatus(): void {
    if (!this.bookId) {
      this.bookReviewStatus = null;
      return;
    }
    const bookId = this.bookId;
    const lang = this.reviewLanguage;
    this.bookReviewStatusSub?.unsubscribe();
    this.bookReviewStatusSub = this.bookReviewService.getReviewStatus(bookId, lang).subscribe({
      next: (status) => {
        if (this.bookId !== bookId || this.reviewLanguage !== lang) return;
        this.bookReviewStatus = status;
        // Post-build reconcile: run ONCE on the first status response after a build terminal, then consume
        // the flag so later ordinary refreshes leave the banner untouched.
        if (this.bookReviewPendingPostBuildReconcile) {
          this.bookReviewPendingPostBuildReconcile = false;
          // Clear a STALE 'failed' banner when this post-build response shows a usable (ready) review: the
          // build actually succeeded server-side even though the progress poll errored. A failed-START
          // banner never sets the flag, so it is never cleared here.
          if (this.bookReviewBuildOutcome === 'failed' && status.ready) {
            this.bookReviewBuildOutcome = null;
            this.bookReviewBuildOutcomeMessage = '';
            this.bookReviewBuildOutcomeCount = null;
          }
          // Fill the degraded banner count from this post-build response (the just-built total).
          if (this.bookReviewBuildOutcome === 'degraded') {
            this.bookReviewBuildOutcomeCount = status.findingCount;
          }
        }
        if (status.ready && this.bookReviewBuilding && this.bookReviewProgressPercent === 100) {
          this.bookReviewBuilding = false;
        }
        // Reattach to an in-progress build (started in another tab/session).
        if (
          status.activeBuildJobId &&
          status.activeBuildJobId !== this.bookReviewHandledTerminalJobId &&
          !this.bookReviewBuilding &&
          !this.bookReviewProgressStop$
        ) {
          this.bookReviewBuilding = true;
          this.bookReviewProgressPercent = null;
          this.bookReviewProgressMessage = '';
          this.pollBookReviewBuild(bookId, status.activeBuildJobId, lang);
        }
        // Tell the host the current derived state so it can mount/refresh the scorecard+ledger (wb3-c02).
        this.reviewStateChange.emit(this.bookReviewState);
        this.cdr.detectChanges();
      },
      error: () => { /* leave current; row hides when status is null */ },
    });
  }

  /** Stop any active book-review progress poll. */
  private stopBookReviewProgress(): void {
    if (this.bookReviewProgressStop$) {
      this.bookReviewProgressStop$.next();
      this.bookReviewProgressStop$.complete();
      this.bookReviewProgressStop$ = null;
    }
  }

  /** Tear down any in-flight book-review build/poll and reset its UI + loop guard + banner. */
  private resetBookReviewBuildState(): void {
    this.stopBookReviewProgress();
    this.bookReviewSub?.unsubscribe();
    this.bookReviewStatusSub?.unsubscribe();
    this.bookReviewBuilding = false;
    this.bookReviewProgressPercent = null;
    this.bookReviewProgressMessage = '';
    this.bookReviewStatus = null;
    this.bookReviewHandledTerminalJobId = null;
    this.bookReviewBuildOutcome = null;
    this.bookReviewBuildOutcomeMessage = '';
    this.bookReviewBuildOutcomeCount = null;
    this.bookReviewPendingPostBuildReconcile = false;
    // Clear the captured build-shape so a previous book's / build's window detail never leaks after a context
    // switch (the getters then fall back to the current status, i.e. hidden until the next build terminal).
    this.bookReviewBuildWindowCount = null;
    this.bookReviewBuildRanContinuityReduce = null;
    this.bookReviewBuildFailedWindows = null;
  }

  // ── Build orchestration ─────────────────────────────────────────────────────

  /** Consent confirmed: start (or no-op) the book review build. */
  onBuildBookReview(): void {
    if (!this.bookId) return;
    if (this.bookReviewBuilding) return;
    const bookId = this.bookId;
    const language = this.reviewLanguage;
    this.stopBookReviewProgress();
    this.bookReviewBuilding = true;
    this.bookReviewProgressPercent = null;
    this.bookReviewProgressMessage = '';
    // Clear any prior failed/degraded banner: a fresh build supersedes the last outcome.
    this.bookReviewBuildOutcome = null;
    this.bookReviewBuildOutcomeMessage = '';
    this.bookReviewBuildOutcomeCount = null;
    this.bookReviewPendingPostBuildReconcile = false;
    this.bookReviewHandledTerminalJobId = null;
    // Clear the prior build-shape so the OLD window detail does not linger while the new build runs; the new
    // terminal repopulates it.
    this.bookReviewBuildWindowCount = null;
    this.bookReviewBuildRanContinuityReduce = null;
    this.bookReviewBuildFailedWindows = null;
    // c01: emit 'building' at the START of a user-initiated build so the host unmounts the findings/bible
    // panel (showFindings=false) for the duration. Without this the host stays on ready/stale and keeps the
    // PREVIOUS findings on screen, and the post-build ready/stale emit is a no-op token bump (already
    // showing) so the panel never re-reads. Same emit-then-detectChanges idiom as loadBookReviewStatus().
    this.reviewStateChange.emit(this.bookReviewState);
    this.cdr.detectChanges();

    this.bookReviewSub?.unsubscribe();
    this.bookReviewSub = this.bookReviewService.buildReview(bookId, language).subscribe({
      next: (resp) => {
        if (this.bookId !== bookId || this.reviewLanguage !== language) return;
        if (resp.noOp || !resp.jobId) {
          this.bookReviewBuilding = false;
          this.loadBookReviewStatus();
          this.cdr.detectChanges();
          return;
        }
        this.pollBookReviewBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.reviewLanguage !== language) return;
        this.bookReviewBuilding = false;
        this.bookReviewProgressMessage = '';
        // The build failed to even START (network / server error before a job id): surface a FAILED outcome,
        // mirroring the poll error handler, so the user sees the localized alert instead of a silent no-op
        // with Build still available. No job ran, so there is nothing new to refresh from status.
        this.bookReviewBuildOutcome = 'failed';
        this.bookReviewBuildOutcomeMessage = '';
        this.bookReviewBuildOutcomeCount = null;
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the book-review build job and refresh status when it reaches a terminal state. */
  private pollBookReviewBuild(bookId: string, jobId: string, lang: string): void {
    this.stopBookReviewProgress();
    const stop$ = new Subject<void>();
    this.bookReviewProgressStop$ = stop$;
    this.bookReviewService.getReviewProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        if (this.bookId !== bookId || this.reviewLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.bookReviewProgressMessage = p.message ?? '';
        this.bookReviewProgressPercent =
          status === 'succeeded'
            ? 100
            : (Number.isFinite(p.estimatedCompletionPercent)
                ? Math.max(0, Math.min(100, p.estimatedCompletionPercent))
                : this.bookReviewProgressPercent);
        if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
          this.bookReviewBuilding = false;
          this.stopBookReviewProgress();
          this.bookReviewHandledTerminalJobId = jobId;
          // wb4-c06: capture the TRANSIENT build-shape from THIS terminal payload BEFORE loadBookReviewStatus()
          // below replaces bookReviewStatus with the zeroed status probe. These feed the window detail + partial
          // warning getters so they render right after the build (the degraded/partial build is a 'succeeded'
          // terminal carrying failedWindows > 0). On a FAILED (total failure) or CANCELED (briefs-missing)
          // terminal the persist was SKIPPED, so the displayed review is the PRESERVED PRIOR one and this build's
          // shape does not describe it — CLEAR the captured shape so a stale window detail / partial warning
          // cannot linger (this also clears a shape left by a prior build on the reattach path, which does not
          // run onBuildBookReview's reset).
          if (status === 'succeeded') {
            this.bookReviewBuildWindowCount = p.bookReviewWindowCount ?? null;
            this.bookReviewBuildRanContinuityReduce = p.bookReviewRanContinuityReduce ?? null;
            this.bookReviewBuildFailedWindows = p.bookReviewFailedWindows ?? null;
          } else {
            this.bookReviewBuildWindowCount = null;
            this.bookReviewBuildRanContinuityReduce = null;
            this.bookReviewBuildFailedWindows = null;
          }
          // Surface the terminal outcome so a total failure is not a silent green finish.
          // FAILED = all dimensions failed (no findings); a SUCCEEDED message that flags failed dimensions
          // ("built with warnings ... (N failed)") is a PARTIAL/degraded build. Canceled shows nothing.
          const msg = p.message ?? '';
          if (status === 'failed') {
            this.bookReviewBuildOutcome = 'failed';
            this.bookReviewBuildOutcomeMessage = msg;
          } else if (status === 'succeeded' && /with warnings|failed\)/i.test(msg)) {
            this.bookReviewBuildOutcome = 'degraded';
            this.bookReviewBuildOutcomeMessage = msg;
          } else {
            this.bookReviewBuildOutcome = null;
            this.bookReviewBuildOutcomeMessage = '';
          }
          // The just-completed count is not in the progress payload; clear it and let the post-build
          // reconcile repopulate it (degraded case). Flag the reconcile so the FIRST status response after
          // this terminal applies it, even if an overlapping ordinary refresh cancels the fetch just below.
          this.bookReviewBuildOutcomeCount = null;
          this.bookReviewPendingPostBuildReconcile = true;
          this.loadBookReviewStatus();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.reviewLanguage !== lang) return;
        this.bookReviewBuilding = false;
        this.stopBookReviewProgress();
        this.bookReviewHandledTerminalJobId = jobId;
        // The progress poll itself errored (job lost / network): treat as a failed build so the user is not
        // left on a silent in-flight state. The localized generic copy renders when no server message exists.
        this.bookReviewBuildOutcome = 'failed';
        this.bookReviewBuildOutcomeMessage = '';
        this.bookReviewBuildOutcomeCount = null;
        // Flag the post-build reconcile so a later status showing a ready review clears this optimistic
        // 'failed' even if the refresh issued below is canceled by an overlapping ordinary fetch.
        this.bookReviewPendingPostBuildReconcile = true;
        this.loadBookReviewStatus();
        this.cdr.detectChanges();
      },
    });
  }

  // ── Derived view state ──────────────────────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the review status row. */
  get bookReviewDir(): 'rtl' | 'ltr' {
    return this.reviewLanguage.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /**
   * Derived state for the book-review status row. BUILDING is client-tracked (bookReviewBuilding) so it
   * wins over the snapshot read while a job is in flight.
   * GATE: when briefs are missing, the row shows a hint instead of a build action.
   * 'ready' comes ONLY from the backend readiness gate (s.ready) — never re-derived from hasReview — so the
   * row can't show the green ready/findings line when the review is not actually ready.
   */
  get bookReviewState(): BookReviewState {
    if (this.bookReviewBuilding) return 'building';
    const s = this.bookReviewStatus;
    if (!s) return 'unknown';
    if (!s.hasBriefs) return 'needs-summary';
    if (s.hasReview && (s.staleVsBriefs || s.builtWithDifferentModel)) return 'stale';
    if (s.ready) return 'ready';
    return s.hasReview ? 'stale' : 'not-built';
  }

  /** True when the review exists but was built with a different model (drives the cross-model warning). */
  get bookReviewBuiltWithDifferentModel(): boolean {
    return !!this.bookReviewStatus?.builtWithDifferentModel;
  }

  /** Localized, timezone-aware "updated <relative time>" for the last review build. */
  get bookReviewUpdatedRelative(): string {
    const s = this.bookReviewStatus;
    if (!s?.lastUpdatedAt) return '';
    const lang = this.reviewLanguage.toLowerCase().startsWith('en') ? 'en' : 'he';
    return formatRelativeTime(s.lastUpdatedAt, lang);
  }

  /** Localized labels for the book-review status row. he default, en when book language is English.
   *  DRAFT Hebrew strings - flag for native-speaker review before sign-off. */
  bookReviewLabel(key: string): string {
    const lang = this.reviewLanguage.toLowerCase().startsWith('en') ? 'en' : 'he';
    // DRAFT (Hebrew): all `he` strings below need native-speaker review.
    const he: Record<string, string> = {
      title: 'עריכה התפתחותית',
      notBuilt: 'טרם נבנה',
      buildNow: 'בנה עכשיו',
      building: 'בונה סקירה...',
      refresh: 'רענן',
      updated: 'עודכן',
      findings: 'ממצאים',
      consentTitle: 'בניית סקירה התפתחותית',
      consentBody: 'פעולה זו תנתח את הספר ותזהה ממצאים עריכתיים לפי ממד: עלילה, דמויות, קצב, טון, נושא ורציפות.',
      confirm: 'אישור',
      cancel: 'ביטול',
      crossModelWarning: 'הסקירה נבנתה עם מודל אחר מהפעיל כעת. רעננו אותה לקבלת תוצאות מדויקות.',
      needsSummary: 'הסקירה ההתפתחותית דורשת תקצירי ספר. בנו תחילה את תקצירי הספר.',
      buildFailed: 'בניית הסקירה נכשלה: אף ממד לא הניב ממצאים. נסו שוב; אם התקלה חוזרת ייתכן שהספר גדול מדי עבור המודל.',
      buildDegraded: 'הסקירה נבנתה חלקית: חלק מהממדים נכשלו. התוצאות עשויות להיות חסרות; רעננו כדי לנסות שוב.',
      buildDegradedWithCount: 'הסקירה נבנתה חלקית: {count} ממצאים נשמרו, אך חלק מהממדים נכשלו. התוצאות עשויות להיות חסרות; רעננו כדי לנסות שוב.',
      // wb4-c06 coverage strings — DRAFT: needs native-speaker review.
      /** "Reviewed N/N chapters" shown in READY state (chaptersReviewed/chaptersTotal substituted by the getter). */
      reviewedChapters: 'נסקרו {reviewed}/{total} פרקים',
      /** Subtle detail shown only when windowCount > 0 (not persisted; hidden on status-probe reload). */
      windowDetail: '{windows} חלונות',
      /** Added to window detail when ranContinuityReduce is true. */
      continuityPass: 'מעבר רציפות',
      /** PARTIAL warning shown only when failedWindows > 0. */
      partialWindowsFailed: '{failed} חלונות נכשלו',
    };
    const en: Record<string, string> = {
      title: 'Developmental review',
      notBuilt: 'Not built',
      buildNow: 'Build now',
      building: 'Building review...',
      refresh: 'Refresh',
      updated: 'Updated',
      findings: 'findings',
      consentTitle: 'Build developmental review',
      consentBody: 'This will analyze the book and identify editorial findings across plot, character, pacing, tone, theme, and continuity.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      crossModelWarning: 'The review was built with a different model than the one now active. Refresh it for accurate results.',
      needsSummary: 'The developmental review requires book briefs. Build the book summary first.',
      buildFailed: 'The review build failed: no dimension produced findings. Try again; if it persists the book may be too large for the model.',
      buildDegraded: 'The review built partially: some dimensions failed. Results may be incomplete; refresh to try again.',
      buildDegradedWithCount: 'The review built partially: {count} findings were saved, but some dimensions failed. Results may be incomplete; refresh to try again.',
      // wb4-c06 coverage strings
      /** "Reviewed N/N chapters" shown in READY state. */
      reviewedChapters: 'Reviewed {reviewed}/{total} chapters',
      /** Subtle detail shown only when windowCount > 0. */
      windowDetail: '{windows} windows',
      /** Added to window detail when ranContinuityReduce is true. */
      continuityPass: 'continuity pass',
      /** PARTIAL warning shown only when failedWindows > 0. */
      partialWindowsFailed: '{failed} windows failed',
    };
    const map = lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  // ── Coverage-provenance (wb4-c06) ───────────────────────────────────────────

  /**
   * "Reviewed N/N chapters" label for the READY state.
   * Populated from chaptersReviewed/chaptersTotal (persisted fields — reliable on status probe).
   * Returns empty string when chaptersTotal is 0 (no data yet).
   */
  get bookReviewCoverageText(): string {
    const s = this.bookReviewStatus;
    if (!s || !s.chaptersTotal) return '';
    const base = this.bookReviewLabel('reviewedChapters')
      .replace('{reviewed}', String(s.chaptersReviewed))
      .replace('{total}', String(s.chaptersTotal));
    const pct = (s.chaptersReviewed / s.chaptersTotal * 100);
    const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(1).replace(/\.0$/, '');
    return `${base} (${pctStr}%)`;
  }

  /**
   * Subtle window/continuity-pass detail for the READY state.
   * Rendered ONLY when the window count > 0. The window count / continuity flag are BUILD-SHAPE: the persisted
   * status probe reports them as 0/false, so they are read from the TRANSIENT shape captured at the last live
   * build terminal (bookReviewBuild*), which survives the post-build status refresh; the status DTO is a
   * fallback (used by the reattach-less test path and kept for back-compat). Nullish-coalesce (not ||) so a
   * genuine captured 0 (the legacy per-dimension build, which has no windows) correctly HIDES the detail rather
   * than falling through to the status value. Format: "W windows" or "W windows, continuity pass".
   */
  get bookReviewWindowDetail(): string {
    const s = this.bookReviewStatus;
    if (!s) return '';
    const windowCount = this.bookReviewBuildWindowCount ?? s.windowCount;
    if (!windowCount) return '';
    const ranContinuity = this.bookReviewBuildRanContinuityReduce ?? s.ranContinuityReduce;
    const windowPart = this.bookReviewLabel('windowDetail').replace('{windows}', String(windowCount));
    return ranContinuity
      ? `${windowPart}, ${this.bookReviewLabel('continuityPass')}`
      : windowPart;
  }

  /**
   * PARTIAL warning text for the READY state when a window failed. Failed-window count is BUILD-SHAPE (0 on the
   * status probe), so it is read from the TRANSIENT shape captured at the last live build terminal, with the
   * status DTO as a fallback. Nullish-coalesce so a captured 0 hides the warning. Empty when no window failed.
   */
  get bookReviewPartialWarningText(): string {
    const s = this.bookReviewStatus;
    if (!s) return '';
    const failedWindows = this.bookReviewBuildFailedWindows ?? s.failedWindows;
    if (!failedWindows) return '';
    return this.bookReviewLabel('partialWindowsFailed').replace('{failed}', String(failedWindows));
  }

  /**
   * The message to render in the build-outcome banner. ALWAYS localized he/en copy from bookReviewLabel —
   * the raw BE terminal message (bookReviewBuildOutcomeMessage) is hardcoded English, so it must NOT be
   * surfaced to Hebrew users. The degraded copy is enriched with bookReviewBuildOutcomeCount (the count
   * captured from the POST-BUILD status refresh) — NOT bookReviewStatus.findingCount, which is still the
   * pre-build snapshot when the terminal poll first renders this banner. When the count is not yet known,
   * the plain copy renders. Empty when there is no outcome to show.
   */
  get bookReviewBuildOutcomeText(): string {
    if (this.bookReviewBuildOutcome === 'failed') {
      return this.bookReviewLabel('buildFailed');
    }
    if (this.bookReviewBuildOutcome === 'degraded') {
      const count = this.bookReviewBuildOutcomeCount ?? 0;
      return count > 0
        ? this.bookReviewLabel('buildDegradedWithCount').replace('{count}', String(count))
        : this.bookReviewLabel('buildDegraded');
    }
    return '';
  }

  // ── Consent gate ────────────────────────────────────────────────────────────

  /** Open the book-review consent prompt. Guard: must not open if briefs are missing (build is gated). */
  openBookReviewConsent(): void {
    if (this.bookReviewStatus && !this.bookReviewStatus.hasBriefs) return;
    this.showBookReviewConsent = true;
  }

  cancelBookReviewConsent(): void {
    this.showBookReviewConsent = false;
  }

  /** Confirm book-review consent -> close the prompt and start the build (no-op while building / no briefs).
   *  Delegates to onBuildBookReview(), which sets bookReviewBuilding=true and emits the 'building' state to
   *  the host (c01) — so this consent path also unmounts the host findings panel for the rebuild. */
  confirmBookReviewBuild(): void {
    this.showBookReviewConsent = false;
    if (this.bookReviewBuilding) return;
    // Final safety guard: if briefs have disappeared since the consent was opened, do not build.
    if (this.bookReviewStatus && !this.bookReviewStatus.hasBriefs) return;
    this.onBuildBookReview();
  }
}
