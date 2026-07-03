import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { BookSummaryService } from '../../../core/services/book-summary.service';
import { JobRegistryService } from '../../../core/services/job-registry.service';
import { BookSummaryStatusDto } from '../../../core/models/book-summary';

/**
 * rf-f03: Import handoff card.
 *
 * Shown in the Review panel immediately after a DOCX import (when the `imported` query param is
 * truthy). Hides summary-build latency behind the author's structural decision:
 *   - PRIMARY CTA  "Start review"  — consent action: starts the summary build if not yet ready,
 *     then emits `startReview` so the host can advance to Stage 1.
 *   - QUIET SECONDARY  "Just let me edit"  — escape hatch; emits `editMode` without touching the
 *     build. The card NEVER traps the user.
 *
 * Auto-start semantics (respects consent gate):
 *   NOT_BUILT / STALE  → Start-review is the consent click that triggers the build.
 *   BUILDING           → Skip the POST (job is already running); emit startReview immediately.
 *   READY              → Skip the POST (briefs already fresh); emit startReview immediately.
 *   Double-fire guard  → CTA is disabled after the first click (disabledStartReview flag).
 */
@Component({
  selector: 'app-import-handoff-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  templateUrl: './import-handoff-card.component.html',
})
export class ImportHandoffCardComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  @Input() bookLanguage: string | null = null;
  /** Chapter count from router state (may be null if page was refreshed). */
  @Input() importedChapters: number | null = null;
  /** Word total from router state (may be null if page was refreshed). */
  @Input() importedWords: number | null = null;
  /** Part count from router state (may be null if page was refreshed). */
  @Input() importedParts: number | null = null;

  /** Emitted when the user clicks "Start review" and the card should transition to Stage 1. */
  @Output() startReview = new EventEmitter<void>();
  /** Emitted when the user clicks "Just let me edit" (escape hatch). */
  @Output() editMode = new EventEmitter<void>();

  /** Latest fetched status; null while loading or when bookId is absent. */
  summaryStatus: BookSummaryStatusDto | null = null;
  /** True while loading initial status (first fetch, not yet resolved). */
  loadingStatus = false;
  /** True while a build POST is in flight (waiting for jobId). */
  buildStarting = false;
  /** Double-fire guard: disabled once the user has clicked "Start review". */
  disabledStartReview = false;

  private statusSub: Subscription | null = null;
  private buildSub: Subscription | null = null;

  constructor(
    private bookSummaryService: BookSummaryService,
    private jobRegistry: JobRegistryService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      this.resetState();
      if (this.bookId) {
        this.loadStatus();
      }
    }
  }

  ngOnDestroy(): void {
    this.statusSub?.unsubscribe();
    this.buildSub?.unsubscribe();
  }

  // ── Derived helpers ─────────────────────────────────────────────────────────

  private get lang(): string {
    return (this.bookLanguage?.trim() || 'he').toLowerCase();
  }

  get isHe(): boolean {
    return !this.lang.startsWith('en');
  }

  get dir(): 'rtl' | 'ltr' {
    return this.isHe ? 'rtl' : 'ltr';
  }

  /**
   * Client-derived state from the status + whether a build is currently in the job registry for this
   * book. NOT using the registry directly here to keep the card self-contained; it reads the status
   * endpoint and checks `activeBuildJobId` to determine "already building".
   */
  get summaryState(): 'unknown' | 'not-built' | 'building' | 'ready' | 'stale' {
    if (this.buildStarting) return 'building';
    const s = this.summaryStatus;
    if (!s) return 'unknown';
    if (s.activeBuildJobId) return 'building';
    if (s.ready) return 'ready';
    if (s.hasSummary && (s.staleCount > 0 || s.builtWithDifferentModel)) return 'stale';
    if (!s.hasSummary && s.builtChapters === 0) return 'not-built';
    return s.hasSummary ? 'ready' : 'not-built';
  }

  /** Localized card heading. */
  get headingLabel(): string {
    return this.isHe
      ? 'הספר יובא בהצלחה' // DRAFT he - needs native review
      : 'Book imported';
  }

  /** Localized chapter count line. */
  get chapterCountLabel(): string {
    const n = this.importedChapters ?? this.summaryStatus?.totalChapters ?? null;
    if (n == null) return '';
    const formatted = n.toLocaleString();
    // DRAFT he - needs native review
    const noun = this.isHe
      ? (n === 1 ? 'פרק' : 'פרקים') // DRAFT he
      : (n === 1 ? 'chapter' : 'chapters');
    return `${formatted} ${noun}`;
  }

  /** Localized word total line (null when unknown). */
  get wordTotalLabel(): string {
    const w = this.importedWords;
    if (w == null) return '';
    const formatted = w.toLocaleString();
    // DRAFT he - needs native review
    const noun = this.isHe
      ? (w === 1 ? 'מילה' : 'מילים') // DRAFT he
      : (w === 1 ? 'word' : 'words');
    return `${formatted} ${noun}`;
  }

  /** Localized parts line (null when zero or unknown). */
  get partsLabel(): string {
    const p = this.importedParts;
    if (p == null || p === 0) return '';
    const formatted = p.toLocaleString();
    // DRAFT he - needs native review
    const noun = this.isHe
      ? (p === 1 ? 'חלק' : 'חלקים') // DRAFT he
      : (p === 1 ? 'part' : 'parts');
    return `${formatted} ${noun}`;
  }

  /** "Re-split" link label. */
  get reSplitLabel(): string {
    // DRAFT he - needs native review
    return this.isHe ? 'הפרקים לא תקינים? פצל מחדש' : 'Chapters look wrong? Re-split';
  }

  /** Primary CTA label, depends on state. */
  get startReviewLabel(): string {
    if (this.isHe) {
      // DRAFT he - needs native review
      switch (this.summaryState) {
        case 'building': return 'התחל סקירה (תוך כדי בנייה...)';
        case 'ready':    return 'התחל סקירה';
        default:         return 'התחל סקירה';
      }
    }
    switch (this.summaryState) {
      case 'building': return 'Start review (build running...)';
      case 'ready':    return 'Start review';
      default:         return 'Start review';
    }
  }

  /** Secondary escape-hatch CTA label. */
  get editModeLabel(): string {
    // DRAFT he - needs native review
    return this.isHe ? 'פשוט תן לי לערוך' : 'Just let me edit';
  }

  /** Consent / estimate info near the CTA, only when a build is needed. */
  get estimateLabel(): string {
    const s = this.summaryStatus;
    if (!s) return '';
    const state = this.summaryState;
    if (state === 'ready' || state === 'building') return '';
    const chapters = s.chaptersToBuild;
    const minutes = Math.max(1, Math.ceil((s.estimatedSeconds || 0) / 60));
    if (this.isHe) {
      // DRAFT he - needs native review
      return `~${chapters} פרקים, ~${minutes} דקות`;
    }
    return `~${chapters} chapters, ~${minutes} min`;
  }

  /** Short informational line about what "Start review" does. */
  get consentInfoLabel(): string {
    const state = this.summaryState;
    if (state === 'ready') return '';
    // DRAFT he - needs native review
    return this.isHe
      ? 'לחיצה על "התחל סקירה" תבנה תקצירי פרקים להפעלת מנוע הסקירה ההתפתחותית.'
      : 'Clicking "Start review" builds chapter briefs to power the developmental review engine.';
  }

  /** True when the CTA should be disabled. */
  get startReviewDisabled(): boolean {
    return this.disabledStartReview || this.loadingStatus;
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Primary CTA handler — the consent action.
   * - READY / BUILDING: skip POST, emit startReview immediately.
   * - NOT_BUILT / STALE / UNKNOWN: POST buildBookSummary (registers job in registry),
   *   then emit startReview regardless of when the job finishes (background build).
   */
  onStartReview(): void {
    if (this.disabledStartReview) return;
    this.disabledStartReview = true; // double-fire guard

    const state = this.summaryState;

    if (state === 'ready' || state === 'building') {
      // Already done or in flight: no build needed. If building, register/reattach in the registry.
      if (state === 'building' && this.bookId && this.summaryStatus?.activeBuildJobId) {
        this.jobRegistry.track('summary', this.bookId, this.summaryStatus.activeBuildJobId);
      }
      this.startReview.emit();
      return;
    }

    // NOT_BUILT / STALE / UNKNOWN: this click IS the consent — fire the build.
    const bookId = this.bookId;
    if (!bookId) {
      this.startReview.emit();
      return;
    }

    const language = this.lang;
    this.buildStarting = true;
    this.cdr.detectChanges();

    this.buildSub?.unsubscribe();
    this.buildSub = this.bookSummaryService.buildBookSummary(bookId, language).subscribe({
      next: (resp) => {
        if (this.bookId !== bookId) return; // stale guard
        if (!resp.noOp && resp.jobId) {
          // Register in the job registry so the editor's "review running" affordance lights up
          // and so the book-summary-status-row can reattach when the dashboard mounts.
          this.jobRegistry.track('summary', bookId, resp.jobId);
        }
        this.buildStarting = false;
        this.cdr.detectChanges();
        // Emit regardless: the build is now running in the background (or was already fresh).
        this.startReview.emit();
      },
      error: () => {
        if (this.bookId !== bookId) return; // stale guard
        this.buildStarting = false;
        // Even on build start failure, emit startReview — the card must not trap the user.
        this.cdr.detectChanges();
        this.startReview.emit();
      },
    });
  }

  /** Escape hatch: dismiss card and switch to edit mode WITHOUT triggering a build. */
  onEditMode(): void {
    this.editMode.emit();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private loadStatus(): void {
    if (!this.bookId) return;
    const bookId = this.bookId;
    const language = this.lang;
    this.loadingStatus = true;
    this.statusSub?.unsubscribe();
    this.statusSub = this.bookSummaryService.getBookSummaryStatus(bookId, language).subscribe({
      next: (status) => {
        if (this.bookId !== bookId) return; // stale guard
        this.summaryStatus = status;
        this.loadingStatus = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId) return; // stale guard
        this.summaryStatus = null;
        this.loadingStatus = false;
        this.cdr.detectChanges();
      },
    });
  }

  private resetState(): void {
    this.statusSub?.unsubscribe();
    this.buildSub?.unsubscribe();
    this.summaryStatus = null;
    this.loadingStatus = false;
    this.buildStarting = false;
    this.disabledStartReview = false;
  }
}
