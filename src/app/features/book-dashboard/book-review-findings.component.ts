import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  BookFinding,
  BookReviewFindingsDto,
  ChapterAnchor,
  Dimension,
  DimensionScore,
  DimensionScoreLabel,
  FindingStatus,
  Verdict,
} from '../../core/models/book-review';
import { BookReviewService } from '../../core/services/book-review.service';
import { ReviseContextService } from '../../core/services/revise-context.service';
import { MarkdownTextComponent } from '../analysis-panel/markdown-text.component';

/** The PATCH verb the lifecycle control runs for a target status (mirrors the service signature). */
type PatchVerb = 'acknowledge' | 'dismiss' | 'done' | 'open';

/**
 * rf-f05: Truncate a finding rationale to a display one-liner for the revise-context chip.
 * Takes the first sentence (up to the first ". " / "." at end) or 120 chars, whichever is shorter.
 * Exported so it can be unit-tested and reused by ChapterFindingsChecklistComponent.
 */
export function truncateOneLiner(rationale: string, maxLen = 120): string {
  if (!rationale) return '';
  // Strip markdown bold markers for a clean plain-text chip label.
  const plain = rationale.replace(/\*\*([^*]+)\*\*/g, '$1').trim();
  // Try first sentence.
  const dotIdx = plain.search(/\.\s|\.$/m);
  const firstSentence = dotIdx > 0 ? plain.slice(0, dotIdx) : plain;
  const candidate = firstSentence.length <= maxLen ? firstSentence : plain.slice(0, maxLen);
  return candidate.trim();
}

/** A finding row enriched with the transient optimistic/error flags the ledger renders. */
interface LedgerFinding extends BookFinding {
  /** True while a status PATCH for this finding is in flight (drives the disabled control + spinner). */
  patching?: boolean;
  /** True for one render cycle after a PATCH error so the row can surface a retry hint. */
  patchError?: boolean;
}

/**
 * wb3-c02: the Dimension Scorecard (B) + keep/improve/cut Findings Ledger (A) for the whole-book
 * developmental review. Fed by BookReviewService.getReviewFindings. ADVISORY only - there is NO
 * Accept/apply; the only mutation is the per-finding lifecycle status (open/acknowledged/dismissed/done)
 * run optimistically via patchFindingStatus and reconciled to the server-returned finding (reverting to
 * the prior status on error), mirroring the per-chapter suggestion-outcome idiom in
 * analysis-panel.component (onLineEditAccept/onConsistencyDismiss: mutate local state, PATCH, restore on error).
 *
 * Rendering is GATED by the host: it mounts this only when the wb3-c01 review status row is READY/STALE,
 * so the not-built / briefs-missing / building states are owned by that row, not re-derived here. This
 * component still renders its own empty (review ready but zero findings) + error (findings fetch failed)
 * states.
 *
 * Chapter anchors are rendered as chips with a clean navigation seam (@Output() openChapter) for wb3-f01
 * to wire; no navigation path is invented here.
 */
@Component({
  selector: 'app-book-review-findings',
  standalone: true,
  imports: [CommonModule, MarkdownTextComponent],
  templateUrl: './book-review-findings.component.html',
  styleUrl: './book-review-findings.component.scss',
})
export class BookReviewFindingsComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the findings key. */
  @Input() bookLanguage: string | null = null;
  /**
   * A monotonic refresh token from the host: bumping it (e.g. after a review build terminal) re-reads the
   * findings without changing book/language. Lets the host keep the ledger fresh when the status row's
   * build completes.
   */
  @Input() refreshToken = 0;

  /**
   * Navigation seam for wb3-f01: emitted when the user clicks a chapter-anchor chip. The host (later)
   * wires this to focus the chapter in the editor. No navigation path is invented in this component.
   */
  @Output() openChapter = new EventEmitter<ChapterAnchor>();

  /** All findings for the current (book, language); the ledger derives its groups from this list. */
  findings: LedgerFinding[] = [];
  /** Per-dimension rollup scores driving the scorecard (B). */
  scores: DimensionScore[] = [];
  /** True while the findings fetch is in flight (first load / refresh). */
  loading = false;
  /** True when the findings fetch failed (drives the error state; distinct from the empty state). */
  loadError = false;

  /** Active dimension filter from the scorecard; null = all dimensions. Toggles off on re-click. */
  dimensionFilter: Dimension | null = null;
  /** Active verdict filter from the ledger chips; null = all verdicts. Toggles off on re-click. */
  verdictFilter: Verdict | null = null;
  /** Ids of findings whose evidence/suggested-action detail is expanded. */
  expandedIds = new Set<string>();

  /** The dimensions rendered in the scorecard + as ledger group order. */
  readonly dimensions: Dimension[] = ['plot', 'character', 'pacing', 'tone', 'theme', 'continuity'];

  /**
   * Memoized scorecard rows + derived overall score/verdict. Rebuilt only when `this.scores` changes
   * (the rows + score read ONLY `this.scores` and the static `this.dimensions` order — NOT language).
   * The scorecardRows getter is read several times per change-detection pass (template + overallScore +
   * overallVerdict), each of which previously rebuilt the Map; caching collapses that to one rebuild
   * per scores change. Invalidated by setting _scorecardCacheKey to a non-matching ref.
   */
  private _scorecardCacheKey: DimensionScore[] | null = null;
  private _scorecardRows: DimensionScore[] = [];
  private _overallScore = 0;
  private _overallVerdict: 'keep' | 'improve' | 'cut' = 'cut';
  /** Active verdicts the ledger groups by (the muted/secondary group is keyed off status, not verdict). */
  readonly verdicts: Verdict[] = ['keep', 'improve', 'cut'];

  /** The latest in-flight GET findings fetch (cancels previous on overlap / context change). */
  private findingsSub: Subscription | null = null;
  /** In-flight status PATCH subscriptions keyed by finding id, so a context change can tear them down. */
  private patchSubs = new Map<string, Subscription>();

  constructor(
    private bookReviewService: BookReviewService,
    private cdr: ChangeDetectorRef,
    private reviseContext: ReviseContextService,
  ) {}

  /** Effective book language for findings calls (defaults to 'he'). */
  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Findings are keyed by (book, language); a change to either re-reads. A refreshToken bump re-reads
    // the SAME context (e.g. a build just finished). Reset filters/expansion on a context change only.
    if (changes['bookId'] || changes['bookLanguage']) {
      this.resetView();
      this.loadFindings();
    } else if (changes['refreshToken'] && !changes['refreshToken'].firstChange) {
      this.loadFindings();
    }
  }

  ngOnDestroy(): void {
    this.findingsSub?.unsubscribe();
    for (const sub of this.patchSubs.values()) sub.unsubscribe();
    this.patchSubs.clear();
  }

  // ── Load ─────────────────────────────────────────────────────────────────────

  /** Fetch findings + scores for the current (book, language). Drops a response after a context switch. */
  loadFindings(): void {
    if (!this.bookId) {
      this.findings = [];
      this.scores = [];
      return;
    }
    const bookId = this.bookId;
    const lang = this.language;
    this.loading = true;
    this.loadError = false;
    this.findingsSub?.unsubscribe();
    this.findingsSub = this.bookReviewService.getReviewFindings(bookId, lang).subscribe({
      next: (dto: BookReviewFindingsDto) => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.findings = (dto.findings ?? []).map((f) => ({ ...f }));
        this.scores = dto.scores ?? [];
        this.loading = false;
        this.loadError = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.loading = false;
        this.loadError = true;
        this.cdr.detectChanges();
      },
    });
  }

  private resetView(): void {
    this.dimensionFilter = null;
    this.verdictFilter = null;
    this.expandedIds.clear();
    this.findings = [];
    this.scores = [];
    this.loadError = false;
    this.findingsSub?.unsubscribe();
    for (const sub of this.patchSubs.values()) sub.unsubscribe();
    this.patchSubs.clear();
  }

  // ── Scorecard (B) ────────────────────────────────────────────────────────────
  //
  // DESIGN DECISION (recorded): the keep/improve/cut counts on each DimensionScore row are
  // server-computed build-time rollups captured in `this.scores` at load time. They intentionally
  // do NOT decrement (or otherwise change) when the user dismisses or marks a finding as done in
  // the ledger. The optimistic status mutations in onStatusAction() only write to `finding.status`;
  // they never touch `this.scores`. A future reader: if these counts appear "stale" after dismissal,
  // that is correct behavior by design — the counts represent the holistic editorial rollup from the
  // review build, not a live ledger-filter tally.

  /** The scorecard rows in the canonical dimension order, skipping dimensions with no score row.
   *  Reads from `this.scores` (server build-time rollup) — NOT from `this.findings`.
   *  Memoized: rebuilt only when the `this.scores` reference changes (reassigned wholesale in
   *  loadFindings/resetView), so the per-CD reads (template + overallScore + overallVerdict) share
   *  one Map rebuild. */
  get scorecardRows(): DimensionScore[] {
    this.refreshScorecardCache();
    return this._scorecardRows;
  }

  /**
   * Recompute the memoized scorecard rows + overall score/verdict when the `this.scores` reference
   * changes. `scores` is assigned wholesale (loadFindings, resetView), never mutated in place, so a
   * reference compare is a complete invalidation trigger for everything these values read (`this.scores`
   * + the static `this.dimensions` order). Language is intentionally NOT part of the key: rows/score
   * depend only on scores; localization happens in separate label getters.
   */
  private refreshScorecardCache(): void {
    if (this._scorecardCacheKey === this.scores) return;
    this._scorecardCacheKey = this.scores;

    const byDim = new Map<Dimension, DimensionScore>();
    for (const s of this.scores) byDim.set(s.dimension, s);
    this._scorecardRows = this.dimensions
      .map((d) => byDim.get(d))
      .filter((s): s is DimensionScore => !!s);

    this._overallScore = this.computeOverallScore(this._scorecardRows);
    this._overallVerdict = this.computeOverallVerdict(this._overallScore);
  }

  /** Toggle the dimension filter from a scorecard row click (clears on re-click of the active row). */
  onDimensionClick(dimension: Dimension): void {
    this.dimensionFilter = this.dimensionFilter === dimension ? null : dimension;
  }

  /** Toggle the verdict filter from a ledger verdict chip (clears on re-click of the active chip). */
  onVerdictClick(verdict: Verdict): void {
    this.verdictFilter = this.verdictFilter === verdict ? null : verdict;
  }

  /** Clear both filters (the "all" reset affordance). */
  clearFilters(): void {
    this.dimensionFilter = null;
    this.verdictFilter = null;
  }

  // ── Ledger (A) ───────────────────────────────────────────────────────────────

  /** A finding is "active" (top ledger) when open or acknowledged; dismissed/done collapse to the muted group. */
  private isActiveStatus(status: FindingStatus): boolean {
    return status === 'open' || status === 'acknowledged';
  }

  /** Findings passing the current dimension + verdict filters (filters are independent / AND-combined). */
  private get filteredFindings(): LedgerFinding[] {
    return this.findings.filter(
      (f) =>
        (this.dimensionFilter == null || f.dimension === this.dimensionFilter) &&
        (this.verdictFilter == null || f.verdict === this.verdictFilter)
    );
  }

  /** Active (open/acknowledged) findings after filtering - the primary ledger list. */
  get activeFindings(): LedgerFinding[] {
    return this.filteredFindings.filter((f) => this.isActiveStatus(f.status));
  }

  /** Resolved (dismissed/done) findings after filtering - the muted/secondary group (NOT deleted). */
  get resolvedFindings(): LedgerFinding[] {
    return this.filteredFindings.filter((f) => !this.isActiveStatus(f.status));
  }

  /** True when the review is loaded with zero findings at all (the empty state, distinct from filtered-empty). */
  get isEmpty(): boolean {
    return !this.loading && !this.loadError && this.findings.length === 0;
  }

  /** True when filters hide every finding even though some exist (the "no matches" hint, not the empty state). */
  get isFilteredEmpty(): boolean {
    return (
      !this.isEmpty &&
      this.activeFindings.length === 0 &&
      this.resolvedFindings.length === 0 &&
      (this.dimensionFilter != null || this.verdictFilter != null)
    );
  }

  toggleExpand(findingId: string): void {
    if (this.expandedIds.has(findingId)) this.expandedIds.delete(findingId);
    else this.expandedIds.add(findingId);
  }

  isExpanded(findingId: string): boolean {
    return this.expandedIds.has(findingId);
  }

  /**
   * Emit the navigation seam for wb3-f01 (no navigation invented here).
   * rf-f05: also sets the revise context so the Edit-mode panel can show a "Addressing: <one-liner>"
   * chip for the current chapter. The rationale (truncated) is the one-liner; the findingId links
   * the checklist row. Clear occurs in the chip's "back to findings" action.
   */
  onAnchorClick(anchor: ChapterAnchor, finding: BookFinding): void {
    // Truncate the rationale to a one-liner (first sentence or 120 chars, whichever is shorter).
    const oneLiner = truncateOneLiner(finding.rationale);
    this.reviseContext.set({ findingId: finding.id, oneLiner, chapterId: anchor.chapterId });
    this.openChapter.emit(anchor);
  }

  // ── Status lifecycle (optimistic + reconcile; mirrors the suggestion-outcome idiom) ─────────────

  /**
   * Run the finding lifecycle: optimistically set the local status, PATCH it, reconcile to the
   * server-returned finding on success, and REVERT to the prior status on error. Mirrors
   * analysis-panel.component's onLineEditAccept/onConsistencyDismiss (apply local outcome -> PATCH ->
   * leave local state on success, but here we also restore the exact prior status on failure since the
   * status is multi-valued, not a one-way accept/dismiss).
   */
  onStatusAction(finding: LedgerFinding, verb: PatchVerb): void {
    if (!this.bookId || finding.patching) return;
    const bookId = this.bookId;
    const lang = this.language;
    const targetStatus = this.statusForVerb(verb);
    // No-op if it is already in the target status (e.g. re-clicking "done" on a done finding).
    if (finding.status === targetStatus) return;

    // Optimistic: capture the prior status, apply the target locally, mark the row in-flight.
    const priorStatus = finding.status;
    finding.status = targetStatus;
    finding.patching = true;
    finding.patchError = false;
    this.cdr.detectChanges();

    // No prior-sub teardown needed: the `finding.patching` early-return above + the template's
    // [disabled]="f.patching" make a second concurrent PATCH for the same finding unreachable, and both
    // terminal handlers delete(finding.id) from the map — so patchSubs never holds an in-flight sub here.
    const sub = this.bookReviewService.patchFindingStatus(bookId, finding.id, verb).subscribe({
      next: (updated: BookFinding) => {
        this.patchSubs.delete(finding.id);
        // Drop a stale response after the user switched books/languages.
        if (this.bookId !== bookId || this.language !== lang) return;
        // Reconcile to the server-returned finding (status is authoritative; carry any server-side field updates).
        finding.status = updated.status;
        if (updated.updatedAt) finding.updatedAt = updated.updatedAt;
        finding.patching = false;
        finding.patchError = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.patchSubs.delete(finding.id);
        if (this.bookId !== bookId || this.language !== lang) return;
        // Revert to the prior status so the ledger never shows a status the server did not accept.
        finding.status = priorStatus;
        finding.patching = false;
        finding.patchError = true;
        this.cdr.detectChanges();
      },
    });
    this.patchSubs.set(finding.id, sub);
  }

  /** Map the imperative PATCH verb to the resulting FindingStatus (for the optimistic local update). */
  private statusForVerb(verb: PatchVerb): FindingStatus {
    switch (verb) {
      case 'acknowledge':
        return 'acknowledged';
      case 'dismiss':
        return 'dismissed';
      case 'done':
        return 'done';
      case 'open':
        return 'open';
    }
  }

  // ── Localization ─────────────────────────────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the panel. */
  get findingsDir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  private get langKey(): 'he' | 'en' {
    return this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  /** Localized dimension label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  dimensionLabel(dimension: Dimension): string {
    const he: Record<Dimension, string> = {
      plot: 'עלילה',
      character: 'דמויות',
      pacing: 'קצב',
      tone: 'טון',
      theme: 'נושא',
      continuity: 'רציפות',
    };
    const en: Record<Dimension, string> = {
      plot: 'Plot',
      character: 'Character',
      pacing: 'Pacing',
      tone: 'Tone',
      theme: 'Theme',
      continuity: 'Continuity',
    };
    return (this.langKey === 'he' ? he : en)[dimension] ?? dimension;
  }

  /** Localized verdict label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  verdictLabel(verdict: Verdict): string {
    const he: Record<Verdict, string> = {
      keep: 'לשמר',
      improve: 'לשפר',
      cut: 'להסיר',
    };
    const en: Record<Verdict, string> = {
      keep: 'Keep',
      improve: 'Improve',
      cut: 'Cut',
    };
    return (this.langKey === 'he' ? he : en)[verdict] ?? verdict;
  }

  /** Verdict glyph used as the row icon (decorative; the label carries the meaning for a11y). */
  verdictIcon(verdict: Verdict): string {
    switch (verdict) {
      case 'keep':
        return '✓';
      case 'improve':
        return '◑';
      case 'cut':
        return '✕';
    }
  }

  /** Localized severity label (1 minor / 2 moderate / 3 major). DRAFT Hebrew - flag for native review. */
  severityLabel(severity: number): string {
    const he: Record<number, string> = {
      1: 'חומרה נמוכה',
      2: 'חומרה בינונית',
      3: 'חומרה גבוהה',
    };
    const en: Record<number, string> = {
      1: 'Minor',
      2: 'Moderate',
      3: 'Major',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[severity] ?? '';
  }

  /** Localized holistic score label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  scoreLabel(score: DimensionScoreLabel): string {
    const he: Record<DimensionScoreLabel, string> = {
      weak: 'חלש',
      mixed: 'מעורב',
      strong: 'חזק',
    };
    const en: Record<DimensionScoreLabel, string> = {
      weak: 'Weak',
      mixed: 'Mixed',
      strong: 'Strong',
    };
    return (this.langKey === 'he' ? he : en)[score] ?? score;
  }

  /** Localized lifecycle status label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  statusLabel(status: FindingStatus): string {
    const he: Record<FindingStatus, string> = {
      open: 'פתוח',
      acknowledged: 'נצפה',
      dismissed: 'נדחה',
      done: 'טופל',
    };
    const en: Record<FindingStatus, string> = {
      open: 'Open',
      acknowledged: 'Acknowledged',
      dismissed: 'Dismissed',
      done: 'Done',
    };
    return (this.langKey === 'he' ? he : en)[status] ?? status;
  }

  /** Localized static chrome label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  label(key: string): string {
    const he: Record<string, string> = {
      scorecardTitle2: 'מצב התפתחותי',
      ledgerTitle: 'ממצאים',
      allDimensions: 'כל הממדים',
      allVerdicts: 'הכל',
      clearFilters: 'נקה סינון',
      resolvedGroup: 'טופלו ונדחו',
      empty: 'אין ממצאים לסקירה זו.',
      filteredEmpty: 'אין ממצאים התואמים לסינון.',
      loadError: 'שגיאה בטעינת הממצאים. נסו שוב.',
      loading: 'טוען ממצאים...',
      evidence: 'ראיות',
      suggestedAction: 'פעולה מומלצת',
      chapters: 'פרקים',
      acknowledge: 'סמן כנצפה',
      dismiss: 'דחה',
      done: 'סמן כטופל',
      reopen: 'פתח מחדש',
      patchError: 'עדכון הסטטוס נכשל. נסו שוב.',
      more: 'עוד',
      less: 'פחות',
    };
    const en: Record<string, string> = {
      scorecardTitle2: 'Developmental health',
      ledgerTitle: 'Findings',
      allDimensions: 'All dimensions',
      allVerdicts: 'All',
      clearFilters: 'Clear filters',
      resolvedGroup: 'Resolved and dismissed',
      empty: 'No findings for this review.',
      filteredEmpty: 'No findings match the current filter.',
      loadError: 'Failed to load findings. Try again.',
      loading: 'Loading findings...',
      evidence: 'Evidence',
      suggestedAction: 'Suggested action',
      chapters: 'Chapters',
      acknowledge: 'Acknowledge',
      dismiss: 'Dismiss',
      done: 'Mark done',
      reopen: 'Reopen',
      patchError: 'Status update failed. Try again.',
      more: 'More',
      less: 'Less',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }

  // ── DimensionScorecard helpers (ds-f02) ───────────────────────────────────────

  /**
   * Map a DimensionScoreLabel to the verdict band name used for coloring.
   * strong -> keep, mixed -> improve, weak -> cut.
   */
  scoreLabelToVerdict(score: DimensionScoreLabel): 'keep' | 'improve' | 'cut' {
    switch (score) {
      case 'strong': return 'keep';
      case 'mixed':  return 'improve';
      case 'weak':   return 'cut';
    }
  }

  /**
   * Map a DimensionScoreLabel to a 0-100 meter fill %.
   * Fixed band per label: strong=80, mixed=50, weak=25.
   */
  scoreLabelToFill(score: DimensionScoreLabel): number {
    switch (score) {
      case 'strong': return 80;
      case 'mixed':  return 50;
      case 'weak':   return 25;
      default:       return 25; // unknown score string treated as weakest band
    }
  }

  /** Total findings count for a scorecard row (keep + improve + cut). */
  scorecardFindingsCount(s: DimensionScore): number {
    return (s.keepCount ?? 0) + (s.improveCount ?? 0) + (s.cutCount ?? 0);
  }

  /**
   * Localized "N findings" / "N ממצאים" label for a scorecard cell.
   */
  findingsCountLabel(n: number): string {
    return this.langKey === 'he' ? `${n} ממצאים` : `${n} findings`;
  }

  /**
   * Localized "N dimensions assessed" / "N ממדים נבדקו" sub-header label.
   */
  dimensionsAssessedLabel(n: number): string {
    return this.langKey === 'he' ? `${n} ממדים נבדקו` : `${n} dimensions assessed`;
  }

  /**
   * Overall health score (0-100) derived from all scorecard rows.
   * Average of the per-dimension fill values (strong=80, mixed=50, weak=25).
   * Memoized: recomputed only when `this.scores` changes (see refreshScorecardCache / computeOverallScore).
   */
  get overallScore(): number {
    this.refreshScorecardCache();
    return this._overallScore;
  }

  /**
   * f02 NaN guard preserved verbatim: a Number.isFinite coercion on each per-row fill (unknown score
   * label -> 25) plus a final Number.isFinite(avg) ? avg : 0 fallback so the rendered figure is never "NaN".
   */
  private computeOverallScore(rows: DimensionScore[]): number {
    if (rows.length === 0) return 0;
    const sum = rows.reduce(
      (acc, s) => acc + (Number.isFinite(this.scoreLabelToFill(s.score)) ? this.scoreLabelToFill(s.score) : 25),
      0,
    );
    const avg = Math.round(sum / rows.length);
    return Number.isFinite(avg) ? avg : 0;
  }

  /**
   * Overall verdict band for the overall score figure: >=70 keep, >=45 improve, else cut.
   * Memoized: recomputed only when `this.scores` changes (see refreshScorecardCache / computeOverallVerdict).
   */
  get overallVerdict(): 'keep' | 'improve' | 'cut' {
    this.refreshScorecardCache();
    return this._overallVerdict;
  }

  private computeOverallVerdict(s: number): 'keep' | 'improve' | 'cut' {
    if (s >= 70) return 'keep';
    if (s >= 45) return 'improve';
    return 'cut';
  }
}
