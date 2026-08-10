import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { formatRelativeTime } from '../../core/utils/relative-time';

/**
 * Wave 3 / w5 - MOVE-1 + MOVE-2, executed. The book-wide writing-style build, its status, its rebuild
 * action, its consent prompt, its cost estimate and its paid-tier note, relocated OUT of the per-chapter
 * analysis Run tab and onto the book dashboard beside the other whole-book builds.
 *
 * WHY IT MOVED (the audit's clearest finding, AMB-1). The build is book-wide: it reads every chapter and
 * spends whole-book cost. It used to live under a panel whose own pill reads "This chapter", and it was
 * reachable only by opening a chapter, opening the assistant panel, switching to Edit help and selecting
 * one specific pass. Consent for a whole-book spend has to be asked where the whole-book action lives.
 *
 * SAME ROW ANATOMY AS ITS NEIGHBOURS. This is deliberately a near-mirror of
 * {@link BookSummaryStatusRowComponent}: same status / consent / estimate / activity-entry anatomy, same
 * (book, language) keying, same reattach-to-an-in-progress-job path, same registry `track()` so the build
 * gets an Activity Center entry. A book-level build that looked different from the book-level build above
 * it would just relocate the inconsistency instead of removing it.
 *
 * THE NAME. The shipped label was "Style baseline" / "קו בסיס סגנוני", which is engineering vocabulary: a
 * "baseline" is not a thing an author knows they have. The row is now named for what it IS to the author -
 * the book's own writing style, measured - and carries a one-line explanation of what it is for, because
 * this artifact appears in NO shipped guide (the guide section is w6 content work; see the report).
 *
 * NO MODEL IDENTITY anywhere in this component's copy, per the standing constraint. The paid-tier note
 * names a tier and a third-party provider in the abstract, never a vendor, a model or a version.
 */
@Component({
  selector: 'app-book-style-baseline-status-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './book-style-baseline-status-row.component.html',
  styleUrl: './book-status-row.scss',
})
export class BookStyleBaselineStatusRowComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the status key. */
  @Input() bookLanguage: string | null = null;
  /**
   * Bumped by the host when a per-chapter surface asked to be sent here (the Linguistic result's
   * "deviations need the baseline" hint, which the audit keeps in place and only RETARGETS at this new
   * home). A change scrolls this row into view so the pointer lands on the thing it points at rather than
   * on the top of a long dashboard. Zero means "nobody asked".
   */
  @Input() focusToken = 0;
  /**
   * How many chapters the book has, from the host's already-loaded chapter list. The same number the stage
   * spine derives stage 1 (and every stage it gates) from: with zero chapters the spine renders `blocked`
   * by Import a couple of hundred pixels above this row, and a build button that stayed enabled here made
   * the two surfaces contradict each other on the same screen.
   *
   * `null` means NOT KNOWN YET, never empty. Only an explicit `0` refuses anything.
   */
  @Input() chapterCount: number | null = null;

  /** Latest status read for this (book, language); null while loading / no book. */
  styleBaselineStatus: BookStyleBaselineStatusDto | null = null;
  /** True while a build job is in flight (client-tracked; drives the BUILDING state). */
  styleBaselineBuilding = false;
  /** Live build progress 0..100 (null = indeterminate). */
  styleBaselineProgressPercent: number | null = null;
  /** True while the consent prompt is open. */
  showBaselineConsent = false;

  private baselineProgressStop$: Subject<void> | null = null;
  private baselineBuildSub: Subscription | null = null;
  private baselineStatusSub: Subscription | null = null;
  /** Loop guard: a jobId already driven to terminal here will not reattach. */
  private baselineHandledTerminalJobId: string | null = null;

  constructor(
    private styleBaselineService: StyleBaselineService,
    private analysisProgressService: AnalysisProgressService,
    private jobRegistry: JobRegistryService,
    private cdr: ChangeDetectorRef,
  ) {}

  /** Effective book language for baseline calls (defaults to 'he'). */
  private get baselineLanguage(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      // A consent opened for the PREVIOUS book/language must never be confirmable into the new one.
      this.showBaselineConsent = false;
      this.resetBuildState();
      if (this.bookId) this.loadStyleBaselineStatus();
    }
    if (changes['focusToken'] && !changes['focusToken'].firstChange && this.focusToken > 0) {
      this.scrollSelfIntoView();
    }
  }

  ngOnDestroy(): void {
    this.stopProgress();
    this.baselineBuildSub?.unsubscribe();
    this.baselineStatusSub?.unsubscribe();
    this.baselineHandledTerminalJobId = null;
  }

  // ── Status load + reset ─────────────────────────────────────────────────────

  /** Fetch the current baseline status for this (book, language) and update the row. */
  loadStyleBaselineStatus(): void {
    if (!this.bookId) {
      this.styleBaselineStatus = null;
      return;
    }
    const bookId = this.bookId;
    const lang = this.baselineLanguage;
    this.baselineStatusSub?.unsubscribe();
    this.baselineStatusSub = this.styleBaselineService.getStyleBaselineStatus(bookId, lang).subscribe({
      next: (status) => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.styleBaselineStatus = status;
        if (status.ready && this.styleBaselineBuilding && this.styleBaselineProgressPercent === 100) {
          this.styleBaselineBuilding = false;
        }
        // Reattach to an in-progress build (this reload, another tab, or the session before it).
        if (
          status.activeBuildJobId &&
          status.activeBuildJobId !== this.baselineHandledTerminalJobId &&
          !this.styleBaselineBuilding &&
          !this.baselineProgressStop$
        ) {
          this.styleBaselineBuilding = true;
          this.styleBaselineProgressPercent = null;
          this.pollBaselineBuild(bookId, status.activeBuildJobId, lang);
        }
        this.cdr.detectChanges();
      },
      error: () => { /* leave current; the row hides when the state is unknown */ },
    });
  }

  private stopProgress(): void {
    if (this.baselineProgressStop$) {
      this.baselineProgressStop$.next();
      this.baselineProgressStop$.complete();
      this.baselineProgressStop$ = null;
    }
  }

  private resetBuildState(): void {
    this.stopProgress();
    this.baselineBuildSub?.unsubscribe();
    this.baselineStatusSub?.unsubscribe();
    this.styleBaselineBuilding = false;
    this.styleBaselineProgressPercent = null;
    this.styleBaselineStatus = null;
    this.baselineHandledTerminalJobId = null;
  }

  // ── Build orchestration ─────────────────────────────────────────────────────

  /** Consent confirmed: start (or no-op) the build. */
  onBuildStyleBaseline(): void {
    if (!this.bookId || this.styleBaselineBuilding) return;
    const bookId = this.bookId;
    const language = this.baselineLanguage;
    this.stopProgress();
    this.styleBaselineBuilding = true;
    this.styleBaselineProgressPercent = null;
    this.baselineHandledTerminalJobId = null;
    this.cdr.detectChanges();

    this.baselineBuildSub?.unsubscribe();
    this.baselineBuildSub = this.styleBaselineService.buildStyleBaseline(bookId, language).subscribe({
      next: (resp) => {
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        if (resp.noOp || !resp.jobId) {
          this.styleBaselineBuilding = false;
          this.loadStyleBaselineStatus();
          this.cdr.detectChanges();
          return;
        }
        this.pollBaselineBuild(bookId, resp.jobId, language);
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== language) return;
        this.styleBaselineBuilding = false;
        this.cdr.detectChanges();
      },
    });
  }

  /** Poll the build job and refresh status when it reaches a terminal state. */
  private pollBaselineBuild(bookId: string, jobId: string, lang: string): void {
    // One activity entry for this build, exactly as the two neighbouring book builds get. track() is
    // idempotent per jobId, so routing both the fresh-build and the reattach path here cannot double-track.
    this.jobRegistry.track('style-baseline', bookId, jobId);
    this.stopProgress();
    const stop$ = new Subject<void>();
    this.baselineProgressStop$ = stop$;
    this.analysisProgressService.pollStyleBaselineProgress(bookId, jobId, stop$).subscribe({
      next: (p) => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        const status = (p.status ?? '').toLowerCase();
        this.styleBaselineProgressPercent =
          status === 'succeeded'
            ? 100
            : (Number.isFinite(p.estimatedCompletionPercent)
                ? Math.max(0, Math.min(100, p.estimatedCompletionPercent))
                : this.styleBaselineProgressPercent);
        if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
          this.styleBaselineBuilding = false;
          this.stopProgress();
          this.baselineHandledTerminalJobId = jobId;
          this.loadStyleBaselineStatus();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.baselineLanguage !== lang) return;
        this.styleBaselineBuilding = false;
        this.stopProgress();
        this.baselineHandledTerminalJobId = jobId;
        this.loadStyleBaselineStatus();
        this.cdr.detectChanges();
      },
    });
  }

  /**
   * A tier write landed somewhere on this page, so the ACTIVE MODEL may have moved and
   * `builtWithDifferentModel` on this status is computed against exactly that. Routed through the same
   * loader every other read uses, so the re-read supersedes an overlapping one instead of racing it.
   */
  onTierChanged(): void {
    this.loadStyleBaselineStatus();
  }

  // ── Derived view state ──────────────────────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Book-scoped chrome follows the book. */
  get baselineDir(): 'rtl' | 'ltr' {
    return this.baselineLanguage.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /** Derived state. BUILDING is client-tracked so it wins over the snapshot while a job is in flight. */
  get baselineState(): 'building' | 'not-built' | 'ready' | 'stale' | 'unknown' {
    if (this.styleBaselineBuilding) return 'building';
    const s = this.styleBaselineStatus;
    if (!s) return 'unknown';
    if (s.hasBaseline && (s.staleCount > 0 || s.builtWithDifferentModel)) return 'stale';
    if (s.ready) return 'ready';
    if (!s.hasBaseline && s.builtChapters === 0) return 'not-built';
    return s.hasBaseline ? 'ready' : 'not-built';
  }

  /**
   * The book has no chapters, so this whole-book measurement has nothing to read. Every action on the row
   * is DISABLED WITH THE REASON stated beside it, never hidden: the same idiom the review row's briefs gate
   * and the tier toggle's server-reason disable already use on this page.
   *
   * Keyed on `=== 0` so an unarrived chapter list (null) can never disable a build.
   */
  get blockedByImport(): boolean {
    return this.chapterCount === 0;
  }

  /** True when a baseline exists but was built with a different model (drives the cross-model warning). */
  get baselineBuiltWithDifferentModel(): boolean {
    return !!this.styleBaselineStatus?.builtWithDifferentModel;
  }

  /** Coverage string "N/N" from the status read. */
  get baselineCoverage(): string {
    const s = this.styleBaselineStatus;
    if (!s) return '';
    return `${s.builtChapters}/${s.totalChapters}`;
  }

  /** Localized, timezone-aware "updated <relative time>". Empty when never built. */
  get baselineUpdatedRelative(): string {
    const s = this.styleBaselineStatus;
    if (!s?.lastUpdatedAt) return '';
    return formatRelativeTime(s.lastUpdatedAt, this.baselineDir === 'ltr' ? 'en' : 'he');
  }

  /**
   * Build estimate for the consent prompt, e.g. "~3 chapters, ~2 min" (+ "~$0.12" when paid).
   *
   * NIT 70. Both counts get a singular form (`chapter`/`פרק`, `minute`/`דקה`), the same idiom
   * `behindSentence` / `behindMagnitudeLabel` / `importDetail` already use in `stage-spine.copy.ts`.
   *
   * The minutes floor (`Math.max(1, ...)`) only applies when there is real work to estimate - see the
   * matching comment on `BookSummaryStatusRowComponent.bookSummaryConsentEstimate`, which found the
   * genuine-no-op case live: `chaptersToBuild === 0` on an explicit rebuild is a real no-op
   * (`StyleBaselineService.ComputeEstimate` answers `(0, null)` for zero chapters and the build service
   * returns `NoOp: true` with no model call), so the estimate must not claim "~1 minute" for it.
   */
  get baselineConsentEstimate(): string {
    const s = this.styleBaselineStatus;
    if (!s) return '';
    const chapters = s.chaptersToBuild;
    const minutes = chapters > 0 ? Math.max(1, Math.ceil((s.estimatedSeconds || 0) / 60)) : 0;
    let phrase: string;
    if (this.baselineDir === 'ltr') {
      const chapterWord = chapters === 1 ? 'chapter' : 'chapters';
      phrase = `~${chapters} ${chapterWord}, ~${minutes} min`;
    } else {
      const chapterWord = chapters === 1 ? 'פרק' : 'פרקים';
      const minuteWord = minutes === 1 ? 'דקה' : 'דקות';
      phrase = `~${chapters} ${chapterWord}, ~${minutes} ${minuteWord}`;
    }
    if (s.estimatedUsd != null) phrase += `, ~$${this.formatUsd(s.estimatedUsd)}`;
    return phrase;
  }

  /**
   * True when the estimate carries a real price, i.e. the build would run on a paid provider. Keyed on the
   * same `estimatedUsd != null` predicate the estimate string uses, so the figure and its explanation can
   * never appear apart.
   */
  get baselineConsentIsPaid(): boolean {
    return this.styleBaselineStatus?.estimatedUsd != null;
  }

  private formatUsd(usd: number): string {
    if (!Number.isFinite(usd)) return '0';
    return usd < 1 ? usd.toFixed(2) : usd.toFixed(2).replace(/\.00$/, '');
  }

  /** Localized labels. he default, en when the book language is English. DRAFT Hebrew (w8 native sweep). */
  baselineLabel(key: string): string {
    const he: Record<string, string> = {
      title: 'סגנון הכתיבה של הספר',
      what: 'מדידה של האופן שבו הספר כתוב בדרך כלל, כדי שניתוח לשוני של פרק יוכל לסמן פרק שחורג ממנו.',
      notBuilt: 'טרם נבנה',
      buildNow: 'בנה עכשיו',
      building: 'בונה...',
      refresh: 'רענן',
      rebuild: 'בנה מחדש',
      coverage: 'כיסוי',
      updated: 'עודכן',
      stalePrefix: 'פרקים שהשתנו:',
      consentTitle: 'בניית סגנון הכתיבה של הספר',
      consentBody: 'פעולה זו תנתח את פרקי הספר כדי למדוד את סגנון הכתיבה שלו.',
      consentPaidNote: 'הסכום מוצג משום שהספר מוגדר לשכבת חשיבה, שרצה על מודל בענן. טקסט הפרקים יישלח לספק צד שלישי ויוצא מהמחשב הזה. אפשר לשנות זאת בקטע ההגדרות בהמשך הדף.',
      confirm: 'אישור',
      cancel: 'ביטול',
      crossModelWarning: 'המדידה נבנתה עם מודל אחר מהפעיל כעת. רעננו אותה לקבלת תוצאות מדויקות.',
      // The blocked-by-import reason, in the same words the briefs row and the spine's blocked row use.
      needsImport: 'אין עדיין פרקים בספר. צריך קודם לייבא כתב יד או להוסיף פרק.',
    };
    const en: Record<string, string> = {
      title: "Your book's writing style",
      what: 'A measurement of how this book usually reads, so a chapter that drifts from it can be flagged in the Linguistic pass.',
      notBuilt: 'Not built',
      buildNow: 'Build now',
      building: 'Building...',
      refresh: 'Refresh',
      rebuild: 'Rebuild',
      coverage: 'Coverage',
      updated: 'Updated',
      stalePrefix: 'Chapters changed:',
      consentTitle: "Build your book's writing style",
      consentBody: 'This will analyze the book chapters to measure how the book is written.',
      consentPaidNote: 'The amount is shown because this book is set to the thinking tier, which runs on a cloud model. The chapter text is sent to a third-party provider and leaves this machine. You can change this in the Settings section further down this page.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      crossModelWarning: 'The measurement was built with a different model than the one now active. Refresh it for accurate results.',
      needsImport: 'This book has no chapters yet. Import a manuscript or add a chapter first.',
    };
    const map = this.baselineDir === 'ltr' ? en : he;
    return map[key] ?? key;
  }

  // ── Consent gate ────────────────────────────────────────────────────────────

  openBaselineConsent(): void {
    // The disabled attribute is the user-facing guard; this is the same refusal where the build actually
    // starts, so no programmatic path can open a consent prompt for a book with nothing to measure.
    if (this.blockedByImport) return;
    this.showBaselineConsent = true;
  }

  cancelBaselineConsent(): void {
    this.showBaselineConsent = false;
  }

  /** Confirm consent -> close the prompt and start the build (no-op while a build is already running). */
  confirmBaselineBuild(): void {
    this.showBaselineConsent = false;
    if (this.styleBaselineBuilding) return;
    this.onBuildStyleBaseline();
  }

  /** The host element, so a retargeted pointer from a per-chapter surface can land on this row. */
  private scrollSelfIntoView(): void {
    // Deferred a tick: the host raises the token in the same change-detection pass that switches the
    // panel to Book review, so this row may not be laid out yet when the input arrives.
    setTimeout(() => {
      document
        .querySelector('[data-testid="book-style-baseline-row"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}
