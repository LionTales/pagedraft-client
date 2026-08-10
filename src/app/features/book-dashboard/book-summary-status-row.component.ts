import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { BookSummaryService } from '../../core/services/book-summary.service';
import {
  BookProfileContinuationService,
  ProfileContinuationOutcome,
  ProfileContinuationReason,
  ProfileContinuationState,
} from '../../core/services/book-profile-continuation.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
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
 *
 * ── Wave 3 / w5, Q4-A: THE BARE ARROW IS FOLDED INTO THIS ROW ────────────────────────────────────────
 *
 * The dashboard used to carry a bare circular-arrow icon three lines above this row. It triggered an
 * expensive whole-book model run with NO status, NO consent, NO cost estimate and NO activity entry, and
 * it wrote over the same chapter-summary rows this row's build depends on. Q4-A folds it in here: one
 * action, one status, one consent, one estimate, one activity entry.
 *
 * WHAT THE ARROW UNIQUELY DID, and why the fold has to be a TWO-PHASE build rather than a deletion. The
 * arrow called `refreshProfile`, which is `SummarizeChaptersAsync` followed by `BuildBookProfileAsync`.
 * This row's build is `BuildBookSummaryAsync`, which fills the STRUCTURED chapter briefs and rolls them
 * into the book-level brief. Those are different artifacts on the server: `BookProfile` (genre, sub-genre,
 * audience, literature level, register, synopsis, characters, plot structure - i.e. every card below this
 * row on the dashboard) has exactly ONE writer in the API, and it is the profile build the arrow ran.
 * Deleting the arrow without carrying its work would have left the dashboard's own profile cards with no
 * way to be built at all. So the folded action runs the briefs build FIRST (it reports real progress, and
 * it produces the freshest input for the profile) and then the profile refresh, under one building latch,
 * so the row's status stays true for the whole run rather than claiming ready halfway.
 *
 * c04: THIS ROW IS NOT THE OWNER OF PHASE 2. It was, and that was the defect - the continuation ran only
 * when a live row happened to be watching the briefs terminal, so every path without one (panel closed,
 * focus mode, Edit help, a reload mid-build, the dashboard unmounted, and the import handoff card, which
 * never chained it at all) left the profile unbuilt with nothing recording that it was owed. Phase 2 now
 * belongs to {@link BookProfileContinuationService}, which every arrival path reaches and which holds the
 * one gate. This row arrives at it like any other caller and watches its state for the current book.
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
  /**
   * How many chapters the book has, from the host's already-loaded chapter list. THE SAME NUMBER THE
   * STAGE SPINE DERIVES FROM, deliberately: the spine renders stage 2 `blocked` by Import on a book with
   * zero chapters, and this row sits roughly 200px below it. When the row's build button stayed enabled
   * there, one surface said "you cannot do this yet" while the surface beside it offered to do it, and
   * pressing it opened a consent prompt offering to analyse the chapters of a book with no chapters.
   *
   * `null` means NOT KNOWN YET, never empty - the same contract the spine signals carry. Only an explicit
   * `0` disables anything; an unarrived chapter list leaves the row exactly as it was.
   */
  @Input() chapterCount: number | null = null;

  /** Fired when a summary build reaches a terminal/error state (or a no-op confirms a fresh summary). */
  @Output() summaryTerminal = new EventEmitter<void>();
  /**
   * Emits whether a summary build is currently in flight. Fired whenever `bookSummaryBuilding` changes
   * (build start, reattach to an in-progress job, terminal/error), so the dashboard host can aggregate a
   * "review running" affordance that stays visible even after the dashboard is unmounted (close panel /
   * focus mode). The host holds the last-emitted value; the row itself is destroyed on unmount.
   *
   * Asymmetry note: the review row does NOT have an equivalent `buildingChange` output — the dashboard
   * derives "review building" from the `reviewStateChange` value ('building' state). The summary row
   * uses a dedicated boolean output because the dashboard fan-out on summary completion
   * (`onSummaryBuildingChange` → `summaryDerivedRefresh`) needs a clean boolean edge, independent of
   * the richer summary-status enum the row does not expose directly.
   */
  @Output() buildingChange = new EventEmitter<boolean>();
  /**
   * Wave 3 / w2. The raw status DTO, every time it changes (including to null on a context reset).
   *
   * The stage spine derives stage 2 from the WHOLE payload - `behind` with its magnitude (`staleCount`)
   * and its reason (`summaryCoversBuiltChapters` / `builtWithDifferentModel`) - so it cannot be fed from
   * the coarse `bookSummaryState` enum or from `buildingChange`, both of which throw that away. This row
   * is already the single fetcher of the payload, so the spine reads it here rather than issuing a
   * second poll of the same endpoint.
   */
  @Output() statusChange = new EventEmitter<BookSummaryStatusDto | null>();

  /** Backing field for {@link bookSummaryStatus}; mutated only via the setter so the change emits. */
  private _bookSummaryStatus: BookSummaryStatusDto | null = null;

  /** Latest book-summary status read for the current book (null while loading / no book). */
  get bookSummaryStatus(): BookSummaryStatusDto | null {
    return this._bookSummaryStatus;
  }
  set bookSummaryStatus(value: BookSummaryStatusDto | null) {
    if (this._bookSummaryStatus === value) return;
    this._bookSummaryStatus = value;
    this.publishStatus();
  }
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
    this.publishBuilding();
  }
  /** Live summary build progress 0..100 (null = indeterminate). */
  bookSummaryProgressPercent: number | null = null;
  /** Human-readable progress message from the summary build job. */
  bookSummaryProgressMessage = '';
  /** True while the book-summary consent prompt is open. */
  showBookSummaryConsent = false;

  /**
   * Q4-A phase 2. True while the folded profile refresh (what the removed bare arrow used to do on its
   * own) is in flight. The building latch stays raised across it, so the row never reads ready while the
   * profile cards below it are still being rebuilt; this flag only changes the progress WORDING.
   */
  profilePhase = false;
  /**
   * The profile half of the folded build failed. Surfaced as its own line rather than swallowed: the
   * briefs may well have succeeded, so a single generic failure message would misreport which half died.
   */
  profilePhaseFailed = false;

  /**
   * c04 / finding 23. The status GET failed, so this row knows nothing about the briefs.
   *
   * It used to be swallowed - the handler left the status null and the row's `*ngIf` (which keys on the
   * derived state being anything but 'unknown') then rendered NOTHING. Since Q4-A folded the bare arrow
   * into this row, this row is the only path to the whole build ceremony, briefs AND book profile: a row
   * that silently does not exist is a book that cannot be built at all until the page is reloaded. So the
   * failure now renders in place of the status, with a retry that re-issues the same read.
   */
  bookSummaryStatusError = false;

  /** Stops the active summary progress poll; nulled when no poll is running. */
  private bookSummaryProgressStop$: Subject<void> | null = null;
  /** Active summary-related subscriptions (build POST); cleared on context change / destroy. */
  private bookSummarySub: Subscription | null = null;
  /** The latest in-flight GET summary status fetch (cancels previous on overlap). */
  private bookSummaryStatusSub: Subscription | null = null;
  /** Loop guard for summary build: a jobId already driven to terminal here will not reattach. */
  private bookSummaryHandledTerminalJobId: string | null = null;
  /** This row's OWN pending arrival at the profile continuation; cleared on context change / destroy. */
  private profileRefreshSub: Subscription | null = null;
  /** Watch on the shared continuation's state for THIS book (covers refreshes this row did not start). */
  private profileStateSub: Subscription | null = null;

  constructor(
    private bookSummaryService: BookSummaryService,
    private profileContinuation: BookProfileContinuationService,
    private analysisProgressService: AnalysisProgressService,
    private jobRegistry: JobRegistryService,
    private cdr: ChangeDetectorRef
  ) {}

  /** Effective book language for summary calls (defaults to 'he'). */
  private get summaryLanguage(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    // c03: everything inside this hook runs INSIDE the host's change-detection pass (see the publishing
    // block below). The reset is synchronous - this row must be honestly empty the instant its context
    // changes - but the two @Outputs it moves are published only once the pass is over.
    this.inHostChangeDetection = true;
    try {
      // The summary is keyed by (book, language); a change to EITHER invalidates the current build/poll.
      if (changes['bookId'] || changes['bookLanguage']) {
        // Dismiss any open consent for the PREVIOUS book/language so it cannot be confirmed into the new one.
        this.showBookSummaryConsent = false;
        if (this.bookId) {
          this.resetBookSummaryBuildState();
          this.watchProfileContinuation();
          this.loadBookSummaryStatus();
        } else {
          this.resetBookSummaryBuildState();
        }
      }
    } finally {
      this.inHostChangeDetection = false;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopBookSummaryProgress();
    this.bookSummarySub?.unsubscribe();
    this.bookSummaryStatusSub?.unsubscribe();
    this.profileRefreshSub?.unsubscribe();
    this.profileStateSub?.unsubscribe();
    this.bookSummaryHandledTerminalJobId = null;
  }

  // ── c03: publishing to the host without writing its bindings mid-pass ────────────────────────────────
  //
  // `ngOnChanges` is called INSIDE the host's change-detection pass, so anything this row emits from there
  // lands on host state while that pass is half finished. The dashboard binds both of these outputs into
  // `spineSignals`, and `<app-stage-spine [signals]>` is declared ABOVE this row in its template - already
  // checked against the previous object by the time our hook runs. So a synchronous emit from the context
  // reset is a write to an already-checked binding: it leaves the spine rendering an object the host has
  // already superseded (corrected for only on some LATER pass), and it is the shape Angular raises
  // NG0100 for. It does not raise it here today only because the one binding involved is an OBJECT, and
  // the dev-mode verification pass (`devModeEqual`) treats any two objects as equal; the first primitive
  // the host derives from a row status - a count, a state chip, a badge above the rows - makes it throw.
  //
  // The fix is not to suppress the emission but to move it out of the pass: a deferred publish drains on
  // the microtask queue, which runs after the pass completes and before the browser paints, and the write
  // it then makes is picked up by a fresh pass rather than mid-way through the current one. It therefore
  // cannot merely relocate the error - there is no checked binding to invalidate outside a pass.
  //
  // A deferred publish is COALESCED and re-reads the CURRENT field rather than replaying the value it was
  // scheduled with, so a status that answers before it drains supersedes it instead of being clobbered by
  // a stale null. The `published*` fields are what was last EMITTED (not merely assigned), which is what
  // makes that de-duplication exact.

  /** True only while {@link ngOnChanges} is running, i.e. while we are inside the host's CD pass. */
  private inHostChangeDetection = false;
  /** The status value last EMITTED on {@link statusChange}. */
  private publishedStatus: BookSummaryStatusDto | null = null;
  /** True while one deferred status publish is queued. */
  private statusPublishQueued = false;
  /** The value last EMITTED on {@link buildingChange}. */
  private publishedBuilding = false;
  /** True while one deferred building publish is queued. */
  private buildingPublishQueued = false;
  /** Set on destroy so a queued publish cannot emit out of a dead row. */
  private destroyed = false;

  /** Publish the current status to the host - now, or after the host's pass when called from within one. */
  private publishStatus(): void {
    if (this.inHostChangeDetection) {
      if (this.statusPublishQueued) return;
      this.statusPublishQueued = true;
      Promise.resolve().then(() => {
        this.statusPublishQueued = false;
        if (!this.destroyed) this.publishStatus();
      });
      return;
    }
    if (this.publishedStatus === this._bookSummaryStatus) return;
    this.publishedStatus = this._bookSummaryStatus;
    this.statusChange.emit(this._bookSummaryStatus);
  }

  /** Publish the current building flag to the host, under the same rule as {@link publishStatus}. */
  private publishBuilding(): void {
    if (this.inHostChangeDetection) {
      if (this.buildingPublishQueued) return;
      this.buildingPublishQueued = true;
      Promise.resolve().then(() => {
        this.buildingPublishQueued = false;
        if (!this.destroyed) this.publishBuilding();
      });
      return;
    }
    if (this.publishedBuilding === this._bookSummaryBuilding) return;
    this.publishedBuilding = this._bookSummaryBuilding;
    this.buildingChange.emit(this._bookSummaryBuilding);
  }

  // ── Status load + reset ─────────────────────────────────────────────────────

  /**
   * Fetch the current book-summary status for this book/language and update the row.
   *
   * Also the retry action behind {@link bookSummaryStatusError}: it clears the error latch on the way in,
   * so a retry that fails again re-raises it rather than leaving a stale one.
   */
  loadBookSummaryStatus(): void {
    this.bookSummaryStatusError = false;
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
        // `!profilePhase` is load-bearing since Q4-A: a status read that lands while the folded profile
        // refresh is still running must NOT lower the latch, or the row would claim ready while the
        // profile cards below it are mid-rebuild - exactly the half-truth the fold exists to remove.
        if (status.ready && this.bookSummaryBuilding && !this.profilePhase && this.bookSummaryProgressPercent === 100) {
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
      error: () => {
        // Drop a stale failure after the user switched books OR languages, exactly as the next handler does.
        if (this.bookId !== bookId || this.summaryLanguage !== lang) return;
        // Say so instead of vanishing. The status stays null (this row must not describe briefs it could
        // not read), but the error + retry render in its place - see bookSummaryStatusError.
        this.bookSummaryStatusError = true;
        this.cdr.detectChanges();
      },
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
    this.profileRefreshSub?.unsubscribe();
    this.bookSummaryBuilding = false;
    this.profilePhase = false;
    this.profilePhaseFailed = false;
    this.bookSummaryProgressPercent = null;
    this.bookSummaryProgressMessage = '';
    this.bookSummaryStatus = null;
    this.bookSummaryStatusError = false;
    this.bookSummaryHandledTerminalJobId = null;
  }

  // ── c04: the shared profile continuation ────────────────────────────────────
  //
  // Phase 2 of the folded build is owned by BookProfileContinuationService, not by this row. This row is
  // ONE of eight arrival paths (the service's docstring enumerates them), and the decision of whether a
  // refresh is owed lives there, once. Two wires connect the row to it:
  //
  //   - it ARRIVES (`startProfilePhase`), reporting what happened rather than deciding what to do;
  //   - it WATCHES (`watchProfileContinuation`), so a refresh started by any OTHER arrival - the import
  //     handoff card, a reattached build, another surface entirely - still keeps this row from reading
  //     READY while the profile cards below it are being rewritten.

  /** Follow the shared continuation for the CURRENT book; supersedes any previous book's watch. */
  private watchProfileContinuation(): void {
    this.profileStateSub?.unsubscribe();
    const bookId = this.bookId;
    if (!bookId) return;
    this.profileStateSub = this.profileContinuation.stateFor$(bookId).subscribe(state => {
      if (this.bookId !== bookId) return;
      this.applyProfileContinuationState(state);
    });
  }

  /**
   * Reflect the shared continuation's state on this row.
   *
   * Raising the build latch here is deliberate: the profile build IS part of the build this row names, so
   * a refresh running for this book must read as BUILDING wherever the ceremony is shown, whoever started
   * it. It also lets the dashboard's existing completion fan-out (the `buildingChange` false edge reloads
   * the profile card) fire for a continuation this row did not start.
   *
   * The latch cannot stick: every write is driven by the state stream, which always leaves `running`.
   */
  private applyProfileContinuationState(state: ProfileContinuationState): void {
    if (state === 'running') {
      this.profilePhase = true;
      this.profilePhaseFailed = false;
      this.bookSummaryBuilding = true;
    } else if (this.profilePhase) {
      this.profilePhase = false;
      this.profilePhaseFailed = state === 'failed';
      this.bookSummaryBuilding = false;
    }
    this.cdr.detectChanges();
  }

  // ── Build orchestration ─────────────────────────────────────────────────────

  /** Consent confirmed: start (or no-op) the book summary build, then the folded profile refresh. */
  onBuildBookSummary(): void {
    if (!this.bookId) return;
    if (this.bookSummaryBuilding) return;
    const bookId = this.bookId;
    const language = this.summaryLanguage;
    this.stopBookSummaryProgress();
    this.bookSummaryBuilding = true;
    this.profilePhase = false;
    this.profilePhaseFailed = false;
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
          this.loadBookSummaryStatus();
          // An already-fresh summary (no-op) still means briefs are present: tell the host so the
          // book-review row clears its "build summary first" gate (and shows STALE if a review exists).
          this.summaryTerminal.emit();
          // Q4-A: a no-op says the BRIEFS are fresh; it says nothing about the profile, which is a
          // separate artifact with its own writer. The author asked for a build, so phase 2 still runs -
          // this is the case that used to require pressing the bare arrow separately. `user-requested`
          // rather than `briefs-already-fresh`: they pressed the action and confirmed a consent prompt
          // that names the profile cards, and this is the only way to rebuild a profile whose inputs did
          // not change.
          this.startProfilePhase(bookId, language, 'user-requested', null);
          return;
        }
        this.pollBookSummaryBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.summaryLanguage !== language) return;
        this.bookSummaryBuilding = false;
        this.profilePhase = false;
        this.bookSummaryProgressMessage = '';
        this.cdr.detectChanges();
      },
    });
  }

  /**
   * Q4-A phase 2: the work the removed bare arrow used to do - rebuilding the `BookProfile` that every
   * card below this row renders from.
   *
   * c04: this row no longer OWNS that work; it reports an arrival to the shared continuation and settles
   * its own UI on the answer. It does not decide whether the refresh is owed - the gate lives in one
   * place, because seven other arrivals reach the same continuation and a gate copied per call site is
   * the same defect wearing a hat. `skipped` is a legitimate answer here (the same completion already
   * ran the refresh), and it settles the row exactly like a success: the profile is current either way.
   *
   * Called ONLY after the briefs half reached a usable state (succeeded, or a no-op that confirmed fresh
   * briefs). A failed or canceled briefs build does not fall through into a second expensive run.
   *
   * The building latch is released HERE, at the end of the whole folded action, which is what makes the
   * host's completion fan-out (`buildingChange` false edge -> reload the profile card + the
   * summary-derived surfaces) fire once, after both halves, instead of halfway through.
   */
  private startProfilePhase(
    bookId: string,
    language: string,
    reason: ProfileContinuationReason,
    briefsJobId: string | null,
  ): void {
    this.profilePhase = true;
    this.profilePhaseFailed = false;
    this.bookSummaryProgressPercent = null;
    this.cdr.detectChanges();
    this.profileRefreshSub?.unsubscribe();
    this.profileRefreshSub = this.profileContinuation
      .ensureAfterBriefs({ bookId, language, reason, briefsJobId })
      .subscribe((outcome: ProfileContinuationOutcome) => {
        if (this.bookId !== bookId || this.summaryLanguage !== language) return;
        this.profilePhase = false;
        this.profilePhaseFailed = outcome === 'failed';
        this.bookSummaryBuilding = false;
        this.cdr.detectChanges();
      });
  }

  /** Poll the book-summary build job and refresh status when it reaches a terminal state. */
  private pollBookSummaryBuild(bookId: string, jobId: string, lang: string): void {
    // rf-c02: publish this build to the job registry so the editor's "review running" affordance (and the
    // Activity Center) can read one truth (jobRegistry.anyRunningForBook$). This row keeps its OWN detailed
    // NOT-BUILT/BUILDING/READY/STALE state + poll below; track() is an ADD, not a replacement. track() is
    // idempotent per jobId (it runs one reused poll and single-finalizes), so routing BOTH the fresh-build
    // and reattach paths through this single choke-point cannot double-track.
    this.jobRegistry.track('summary', bookId, jobId);
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
          this.stopBookSummaryProgress();
          this.bookSummaryHandledTerminalJobId = jobId;
          this.loadBookSummaryStatus();
          // A finished summary build makes briefs present (clearing the review row's "build summary first"
          // gate) and any existing review staleVsBriefs: tell the host so the review row reflects both.
          this.summaryTerminal.emit();
          if (status === 'succeeded') {
            // Q4-A phase 2 keeps the latch raised; it lowers it when the profile refresh settles. The
            // jobId goes with the arrival so this report and the registry's own observation of the SAME
            // terminal (which reaches the continuation independently, and is what covers every path where
            // this row is not mounted to see it) collapse to one refresh rather than two.
            this.startProfilePhase(bookId, lang, 'briefs-succeeded', jobId);
          } else {
            this.bookSummaryBuilding = false;
            this.profilePhase = false;
          }
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.summaryLanguage !== lang) return;
        this.bookSummaryBuilding = false;
        this.profilePhase = false;
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

  /**
   * The book has no chapters, so this build has nothing to read and every action on this row is refused
   * with its reason stated beside it. DISABLED WITH THE REASON, NOT HIDDEN: a build that vanishes teaches
   * the author nothing, and the wave's idiom (see the review row's briefs gate and the tier toggle's
   * server-reason disable) is to leave the control where it is and say why it cannot run.
   *
   * Keyed on `=== 0` so an unarrived chapter list (null) can never disable a build.
   */
  get blockedByImport(): boolean {
    return this.chapterCount === 0;
  }

  /**
   * Render the status-read failure IN PLACE OF the status, and only there.
   *
   * Found live: with the read failed AND a profile continuation running (one started by another arrival
   * path), the row showed "we could not read the status" and "Building the book profile..." side by side.
   * Both were true, but the failure line is the stand-in for a status this row does not have, so it
   * belongs only in the state where there is nothing else to say. Every other state has its own line.
   */
  get showStatusReadError(): boolean {
    return this.bookSummaryStatusError && this.bookSummaryState === 'unknown';
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
      rebuild: 'בנה מחדש',
      coverage: 'כיסוי',
      updated: 'עודכן',
      stalePrefix: 'פרקים שהשתנו:',
      consentTitle: 'בניית תקצירי ספר',
      consentBody: 'פעולה זו תנתח את פרקי הספר כדי לבנות תקציר לכל פרק, תקציר ברמת הספר, ואת כרטיסי הפרופיל שבהמשך הדף (סקירה, תקציר, דמויות ומבנה עלילה).',
      confirm: 'אישור',
      cancel: 'ביטול',
      crossModelWarning: 'התקצירים נבנו עם מודל אחר מהפעיל כעת. רעננו אותם לקבלת תוצאות מדויקות.',
      // Q4-A: the folded whole-book build. DRAFT Hebrew - w8 native sweep.
      builds: 'הבנייה הזו מייצרת תקציר לכל פרק, תקציר ברמת הספר, ואת כרטיסי הפרופיל שבהמשך הדף.',
      buildingProfile: 'בונה את פרופיל הספר...',
      profileFailed: 'התקצירים נבנו, אך בניית פרופיל הספר נכשלה. אפשר לנסות שוב.',
      // The blocked-by-import reason, said in the same words the spine's blocked row uses. DRAFT Hebrew.
      needsImport: 'אין עדיין פרקים בספר. צריך קודם לייבא כתב יד או להוסיף פרק.',
      // c04: the status read failed. DRAFT Hebrew - w8 native sweep.
      statusError: 'לא הצלחנו לקרוא את מצב תקצירי הספר.',
      retry: 'נסו שוב',
    };
    const en: Record<string, string> = {
      title: 'Book briefs',
      notBuilt: 'Not built',
      buildNow: 'Build now',
      building: 'Building briefs...',
      refresh: 'Refresh',
      rebuild: 'Rebuild',
      coverage: 'Coverage',
      updated: 'Updated',
      stalePrefix: 'Chapters changed:',
      consentTitle: 'Build book briefs',
      consentBody: 'This will analyze the book chapters to build a brief for each chapter, one book-level brief, and the profile cards further down this page (overview, synopsis, characters and plot structure).',
      confirm: 'Confirm',
      cancel: 'Cancel',
      crossModelWarning: 'The briefs were built with a different model than the one now active. Refresh them for accurate results.',
      builds: 'This build produces a brief for each chapter, one book-level brief, and the profile cards further down this page.',
      buildingProfile: 'Building the book profile...',
      profileFailed: 'The briefs were built, but the book profile build failed. You can run it again.',
      needsImport: 'This book has no chapters yet. Import a manuscript or add a chapter first.',
      statusError: 'We could not read the book briefs status.',
      retry: 'Try again',
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
    // The disabled attribute is the user-facing guard; this is the same refusal stated once more where the
    // build actually starts, so a keyboard/programmatic path cannot open a consent prompt that offers to
    // analyse the chapters of a book that has none.
    if (this.blockedByImport) return;
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
