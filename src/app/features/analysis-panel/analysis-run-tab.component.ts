import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AnalysisResultDto, AnalysisSuggestion } from '../../core/models/analysis';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { BookReviewStatusDto } from '../../core/models/book-review';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { resolveCardLang } from './card-lang';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { analysisItems as splitAnalysisItems } from '../../core/utils/analysis-items';
import { SuggestionCardComponent } from './suggestion-card.component';
import { LinguisticResultComponent } from './linguistic-result.component';

@Component({
  selector: 'app-analysis-run-tab',
  standalone: true,
  imports: [CommonModule, SuggestionCardComponent, LinguisticResultComponent],
  templateUrl: './analysis-run-tab.component.html',
  styleUrl: './analysis-run-tab.component.scss'
})
export class AnalysisRunTabComponent implements OnChanges {
  @Input() selectedAnalysisType = 'Proofread';
  @Input() proofreadSuggestions: AnalysisSuggestion[] = [];
  @Input() lineEditRunSuggestions: AnalysisSuggestion[] = [];
  /** Navigate-only consistency suggestions (register/tense/POV) for the current LinguisticAnalysis run. */
  @Input() consistencyRunSuggestions: AnalysisSuggestion[] = [];
  @Input() latestResult: AnalysisResultDto | null = null;
  @Input() lastRunDurationLabel: string | null = null;
  @Input() streamingText = '';
  /**
   * True while a just-completed streaming Proofread is still being finalized: its synthetic row has no
   * suggestions and no reliability flag yet (both arrive via the async loadHistory adopt step). During this
   * window we must NOT claim "No changes needed" - the run may yet surface edits or an unreliable warning.
   */
  @Input() proofreadFinalizing = false;
  @Input() explainingSuggestionIds = new Set<string>();
  @Input() staleSuggestionIds = new Set<string>();
  /** Current book id. Used only to dismiss the baseline consent prompt when the book changes (see ngOnChanges). */
  @Input() bookId: string | null = null;
  @Input() bookLanguage: string | null = null;
  @Input() sceneId: string | null = null;

  // ── Style baseline (a3/a4) ────────────────────────────────────────────────
  /** Latest status read for the book's style baseline (null while loading / no book). */
  @Input() styleBaselineStatus: BookStyleBaselineStatusDto | null = null;
  /** True while a build job is in flight (client-tracked, drives the BUILDING state). */
  @Input() styleBaselineBuilding = false;
  /** Live build progress 0..100 (null = indeterminate / not started). */
  @Input() styleBaselineProgressPercent: number | null = null;
  /** Optional human-readable progress message from the build job. */
  @Input() styleBaselineProgressMessage = '';

  /** User confirmed the consent prompt -> parent should start the build and flip to BUILDING. */
  @Output() buildStyleBaseline = new EventEmitter<void>();

  // ── Book summary (wb1-f01) ────────────────────────────────────────────────
  /** Latest status read for the book summary (null while loading / no book). */
  @Input() bookSummaryStatus: BookSummaryStatusDto | null = null;
  /** True while a summary build job is in flight (client-tracked, drives the BUILDING state). */
  @Input() bookSummaryBuilding = false;
  /** Live summary build progress 0..100 (null = indeterminate / not started). */
  @Input() bookSummaryProgressPercent: number | null = null;
  /** Optional human-readable progress message from the summary build job. */
  @Input() bookSummaryProgressMessage = '';

  /** User confirmed the consent prompt -> parent should start the summary build. */
  @Output() buildBookSummary = new EventEmitter<void>();

  // ── Book review (wb2-f03) ─────────────────────────────────────────────────
  /** Latest status read for the book review (null while loading / no book). */
  @Input() bookReviewStatus: BookReviewStatusDto | null = null;
  /** True while a review build job is in flight (client-tracked, drives the BUILDING state). */
  @Input() bookReviewBuilding = false;
  /** Live review build progress 0..100 (null = indeterminate / not started). */
  @Input() bookReviewProgressPercent: number | null = null;
  /** Optional human-readable progress message from the review build job. */
  @Input() bookReviewProgressMessage = '';
  /**
   * Outcome of the LAST finished review build (wb2-c05). 'failed' = ALL dimensions failed (total failure:
   * the job surfaced status Failed and produced no findings) -> show a red error so the user does not read
   * the re-enabled Build as a silent success. 'degraded' = a PARTIAL failure (some dimensions failed but
   * findings persisted) -> show a softer warning. null = clean success / nothing to report. Cleared when a
   * new build starts. Distinct from progressMessage, which is transient in-flight text.
   */
  @Input() bookReviewBuildOutcome: 'failed' | 'degraded' | null = null;
  /** Human-readable message accompanying bookReviewBuildOutcome (the job's terminal message). */
  @Input() bookReviewBuildOutcomeMessage = '';
  /**
   * Finding count for the degraded banner, captured from the status refresh that ran AFTER the build finished
   * (the parent populates it post-build; null until then, and null if that refresh failed). The banner reads
   * THIS, not bookReviewStatus.findingCount, so it never shows the pre-build total or a wrong total.
   */
  @Input() bookReviewBuildOutcomeCount: number | null = null;

  /** User confirmed the consent prompt -> parent should start the review build. */
  @Output() buildBookReview = new EventEmitter<void>();

  @Output() proofreadAccept = new EventEmitter<AnalysisSuggestion>();
  @Output() proofreadDismiss = new EventEmitter<AnalysisSuggestion>();
  @Output() lineEditAccept = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() lineEditDismiss = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() consistencyDismiss = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() showInDocumentEvent = new EventEmitter<AnalysisSuggestion>();
  @Output() explainSuggestion = new EventEmitter<AnalysisSuggestion>();

  showRawLineEdit = false;
  lineEditCategoryFilter = 'all';

  /** True while the style-baseline consent prompt (showing the build estimate) is open. */
  showBaselineConsent = false;

  /** True while the book-summary consent prompt is open. */
  showBookSummaryConsent = false;

  /** True while the book-review consent prompt is open. */
  showBookReviewConsent = false;

  readonly lineEditCategoryOptions: string[] = [
    'all',
    'consistency',
    'continuity',
    'clarity',
    'flow',
    'word-choice',
    'structure',
    'redundancy',
    'style'
  ];

  constructor(private lineEditParser: LineEditParserService) {}

  ngOnChanges(changes: SimpleChanges): void {
    // The baseline is keyed by (book, language) and the panel tears its baseline state down on either
    // change. Dismiss the consent prompt too: one opened for the PREVIOUS book/language must not linger
    // and then (now showing the NEW book's estimate) be confirmed into building the wrong book.
    if (changes['bookId'] || changes['bookLanguage']) {
      this.showBaselineConsent = false;
      this.showBookSummaryConsent = false;
      this.showBookReviewConsent = false;
    }
    // Once a build is in flight (a fresh start OR a DEF-2 reattach surfaced on a status reload), the
    // consent prompt must not stay open/confirmable - confirming would ask the parent to interrupt the
    // tracked job and start a duplicate build.
    if (changes['styleBaselineBuilding']?.currentValue === true) {
      this.showBaselineConsent = false;
    }
    if (changes['bookSummaryBuilding']?.currentValue === true) {
      this.showBookSummaryConsent = false;
    }
    if (changes['bookReviewBuilding']?.currentValue === true) {
      this.showBookReviewConsent = false;
    }
  }

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  // ── Style baseline status row (a3/a4) ──────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the status row. */
  get baselineDir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /**
   * Derived state for the status row. BUILDING is client-tracked (styleBaselineBuilding) so it wins
   * over the snapshot read while a job is in flight. Otherwise NOT BUILT / READY / STALE come from
   * the a3 status fields per the documented state machine.
   */
  get baselineState(): 'building' | 'not-built' | 'ready' | 'stale' | 'unknown' {
    if (this.styleBaselineBuilding) return 'building';
    const s = this.styleBaselineStatus;
    if (!s) return 'unknown';
    // A cross-model baseline must offer the Refresh affordance even if staleCount somehow reads 0:
    // treat builtWithDifferentModel as a stale-ish state so the refresh action stays reachable.
    if (s.hasBaseline && (s.staleCount > 0 || s.builtWithDifferentModel)) return 'stale';
    if (s.ready) return 'ready';
    if (!s.hasBaseline && s.builtChapters === 0) return 'not-built';
    // hasBaseline but partial coverage with no stale chapters: treat as ready coverage display.
    return s.hasBaseline ? 'ready' : 'not-built';
  }

  /**
   * True when a baseline exists but was built with a different model than the active one (DEF-1).
   * Drives a small cross-model warning line near the existing stale/Refresh affordance.
   */
  get baselineBuiltWithDifferentModel(): boolean {
    return !!this.styleBaselineStatus?.builtWithDifferentModel;
  }

  /** True when the baseline is missing or incomplete (drives the deviations empty-state hint). */
  get baselineMissingOrInsufficient(): boolean {
    const st = this.baselineState;
    return st === 'not-built' || st === 'stale';
  }

  /** Localized "Style baseline" label + per-state copy. he default, en when book language is English. */
  baselineLabel(key: string): string {
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
    const he: Record<string, string> = {
      title: 'קו בסיס סגנוני',
      notBuilt: 'טרם נבנה',
      buildNow: 'בנה עכשיו',
      building: 'בונה קו בסיס...',
      refresh: 'רענן',
      coverage: 'כיסוי',
      updated: 'עודכן',
      stalePrefix: 'פרקים שהשתנו:',
      consentTitle: 'בניית קו בסיס סגנוני',
      consentBody: 'פעולה זו תנתח את פרקי הספר כדי לבנות קו בסיס סגנוני לזיהוי חריגות.',
      confirm: 'אישור',
      cancel: 'ביטול',
      hintBuild: 'כדי לזהות חריגות סגנון, בנו תחילה קו בסיס סגנוני לספר.',
      hintRefresh: 'קו הבסיס הסגנוני אינו עדכני. רעננו אותו לקבלת תוצאות מדויקות יותר.',
      // DRAFT (Hebrew): verify wording/word-order with the user before sign-off.
      crossModelWarning: 'קו הבסיס נבנה עם מודל אחר מהפעיל כעת. רעננו אותו לקבלת תוצאות מדויקות.',
      noRunYetScene: 'עדיין לא בוצע ניתוח עבור סצנה זו.',
      noRunYetChapter: 'עדיין לא בוצע ניתוח עבור פרק זה.',
      linguisticNoRunNote: 'הניתוח רץ לכל פרק בנפרד. הריצו ניתוח לפרק זה כדי לראות דוח. קו הבסיס הסגנוני (כיסוי הספר) משמש רק להשוואה ואינו מייצר דוח לפרק.',
    };
    const en: Record<string, string> = {
      title: 'Style baseline',
      notBuilt: 'Not built',
      buildNow: 'Build now',
      building: 'Building baseline...',
      refresh: 'Refresh',
      coverage: 'Coverage',
      updated: 'Updated',
      stalePrefix: 'Chapters changed:',
      consentTitle: 'Build style baseline',
      consentBody: 'This will analyze the book chapters to build a style baseline for deviation detection.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      hintBuild: 'To detect style deviations, build a style baseline for the book first.',
      hintRefresh: 'The style baseline is out of date. Refresh it for more accurate results.',
      crossModelWarning: 'The baseline was built with a different model than the one now active. Refresh it for accurate results.',
      noRunYetScene: 'No analysis run yet for this scene.',
      noRunYetChapter: 'No analysis run yet for this chapter.',
      linguisticNoRunNote: 'Analysis runs per chapter. Run analysis on this chapter to see a report. The style baseline (book coverage) is only the comparison reference and does not create a per-chapter report.',
    };
    const map = lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Coverage string "N/N" from the status read. */
  get baselineCoverage(): string {
    const s = this.styleBaselineStatus;
    if (!s) return '';
    return `${s.builtChapters}/${s.totalChapters}`;
  }

  /** Localized, timezone-aware "updated <relative time>" for the last build. Empty when never built. */
  get baselineUpdatedRelative(): string {
    const s = this.styleBaselineStatus;
    if (!s?.lastUpdatedAt) return '';
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
    return formatRelativeTime(s.lastUpdatedAt, lang);
  }

  /** Build estimate sentence for the consent prompt, e.g. "~3 chapters, ~2 min" (+ "~$0.12" when paid). */
  get baselineConsentEstimate(): string {
    const s = this.styleBaselineStatus;
    if (!s) return '';
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
    const chapters = s.chaptersToBuild;
    const minutes = Math.max(1, Math.ceil((s.estimatedSeconds || 0) / 60));
    let phrase: string;
    if (lang === 'he') {
      phrase = `~${chapters} פרקים, ~${minutes} דקות`;
    } else {
      phrase = `~${chapters} chapters, ~${minutes} min`;
    }
    // Cost only for paid providers (estimatedUsd != null).
    if (s.estimatedUsd != null) {
      phrase += `, ~$${this.formatUsd(s.estimatedUsd)}`;
    }
    return phrase;
  }

  private formatUsd(usd: number): string {
    if (!Number.isFinite(usd)) return '0';
    // Trim trailing zeros but keep at least 2 dp for small amounts.
    return usd < 1 ? usd.toFixed(2) : usd.toFixed(2).replace(/\.00$/, '');
  }

  /** Open the consent prompt (the "Build now" / "Refresh" action). */
  openBaselineConsent(): void {
    this.showBaselineConsent = true;
  }

  cancelBaselineConsent(): void {
    this.showBaselineConsent = false;
  }

  /** Confirm consent -> close the prompt and ask the parent to start the build. */
  confirmBaselineBuild(): void {
    this.showBaselineConsent = false;
    // Never trigger a build while one is already in flight (e.g. a reattach flipped BUILDING true while
    // this prompt was open): that would interrupt the tracked job and start a duplicate. Just close.
    if (this.styleBaselineBuilding) return;
    this.buildStyleBaseline.emit();
  }

  // ── Book summary status row (wb1-f01) ──────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the summary status row. */
  get bookSummaryDir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
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
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
    return formatRelativeTime(s.lastUpdatedAt, lang);
  }

  /** Localized labels for the book-summary status row. he default, en when book language is English. */
  bookSummaryLabel(key: string): string {
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
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
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
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

  /** Open the book-summary consent prompt. */
  openBookSummaryConsent(): void {
    this.showBookSummaryConsent = true;
  }

  cancelBookSummaryConsent(): void {
    this.showBookSummaryConsent = false;
  }

  /** Confirm book-summary consent -> close the prompt and ask the parent to start the build. */
  confirmBookSummaryBuild(): void {
    this.showBookSummaryConsent = false;
    if (this.bookSummaryBuilding) return;
    this.buildBookSummary.emit();
  }

  // ── Book review status row (wb2-f03) ───────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the review status row. */
  get bookReviewDir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /**
   * Derived state for the book-review status row. BUILDING is client-tracked (bookReviewBuilding)
   * so it wins over the snapshot read while a job is in flight.
   * GATE: when briefs are missing, the row shows a hint instead of a build action.
   */
  get bookReviewState(): 'building' | 'not-built' | 'ready' | 'stale' | 'needs-summary' | 'unknown' {
    if (this.bookReviewBuilding) return 'building';
    const s = this.bookReviewStatus;
    if (!s) return 'unknown';
    // Gate: the review requires briefs; surface a distinct "needs-summary" state before all else.
    if (!s.hasBriefs) return 'needs-summary';
    if (s.hasReview && (s.staleVsBriefs || s.builtWithDifferentModel)) return 'stale';
    if (s.ready) return 'ready';
    return s.hasReview ? 'ready' : 'not-built';
  }

  /** True when the review exists but was built with a different model (drives the cross-model warning). */
  get bookReviewBuiltWithDifferentModel(): boolean {
    return !!this.bookReviewStatus?.builtWithDifferentModel;
  }

  /** Localized, timezone-aware "updated <relative time>" for the last review build. */
  get bookReviewUpdatedRelative(): string {
    const s = this.bookReviewStatus;
    if (!s?.lastUpdatedAt) return '';
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
    return formatRelativeTime(s.lastUpdatedAt, lang);
  }

  /** Localized labels for the book-review status row. he default, en when book language is English.
   *  DRAFT Hebrew strings - flag for native-speaker review before sign-off. */
  bookReviewLabel(key: string): string {
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
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
    };
    const map = lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /**
   * The message to render in the build-outcome banner (wb2-c05). ALWAYS localized he/en copy from
   * bookReviewLabel — the raw BE terminal message (bookReviewBuildOutcomeMessage) is hardcoded English
   * (BookReviewService.cs), so it must NOT be surfaced to Hebrew users (wb2-c01). The raw message stays
   * on the @Input for logging/telemetry only. The degraded copy is enriched with bookReviewBuildOutcomeCount
   * — the count captured from the POST-BUILD status refresh — NOT bookReviewStatus.findingCount, which is
   * still the pre-build snapshot when the terminal poll first renders this banner (and would show the previous
   * total, or a wrong total if the refresh failed). When the count is not yet known, the plain copy renders.
   * Empty when there is no outcome to show.
   */
  get bookReviewBuildOutcomeText(): string {
    if (this.bookReviewBuildOutcome === 'failed') {
      return this.bookReviewLabel('buildFailed');
    }
    if (this.bookReviewBuildOutcome === 'degraded') {
      const count = this.bookReviewBuildOutcomeCount ?? 0;
      // Enrich with the just-completed partial-finding count when known; plain copy otherwise.
      return count > 0
        ? this.bookReviewLabel('buildDegradedWithCount').replace('{count}', String(count))
        : this.bookReviewLabel('buildDegraded');
    }
    return '';
  }

  /** Open the book-review consent prompt. Guard: must not open if briefs are missing (build is gated). */
  openBookReviewConsent(): void {
    // Safety guard: do not allow opening consent when the prerequisite (briefs) is missing.
    if (this.bookReviewStatus && !this.bookReviewStatus.hasBriefs) return;
    this.showBookReviewConsent = true;
  }

  cancelBookReviewConsent(): void {
    this.showBookReviewConsent = false;
  }

  /** Confirm book-review consent -> close the prompt and ask the parent to start the build. */
  confirmBookReviewBuild(): void {
    this.showBookReviewConsent = false;
    if (this.bookReviewBuilding) return;
    // Final safety guard: if briefs have disappeared since the consent was opened, do not emit.
    if (this.bookReviewStatus && !this.bookReviewStatus.hasBriefs) return;
    this.buildBookReview.emit();
  }

  get runDisplayText(): string {
    if (this.streamingText) return this.streamingText;
    if (this.latestResult?.resultText) return this.latestResult.resultText;
    return '';
  }

  /**
   * True when the latest completed result is a Proofread that the server flagged as
   * untrustworthy (empty / unrelated / dropped-span flood of bogus deletions). When true, the Run
   * tab shows a single warning and suppresses the suggestion cards and the "looks clean" message.
   */
  get isProofreadResultUnreliable(): boolean {
    const r = this.latestResult;
    if (!r || (r.analysisType || r.type) !== 'Proofread') return false;
    return !!r.proofreadResultUnreliable;
  }

  get isProofreadWithNoSuggestions(): boolean {
    const r = this.latestResult;
    return !!r && (r.analysisType || r.type) === 'Proofread' && this.proofreadSuggestions.length === 0;
  }

  get filteredLineEditRunSuggestions(): AnalysisSuggestion[] {
    if (!this.lineEditRunSuggestions?.length) return [];
    if (this.lineEditCategoryFilter === 'all') return this.lineEditRunSuggestions;
    const filterKey = this.lineEditCategoryFilter.toLowerCase();
    return this.lineEditRunSuggestions.filter(s => (s.category || '').toLowerCase() === filterKey);
  }

  getLineEdit(current: AnalysisResultDto) {
    return this.lineEditParser.getLineEdit(current);
  }

  getCategoryLabel(category: string, language: string | null | undefined = this.language): string {
    const key = (category || '').toLowerCase();
    const lang = (language || this.language || 'he').toLowerCase();

    const enLabels: Record<string, string> = {
      consistency: 'Consistency',
      continuity: 'Continuity',
      clarity: 'Clarity',
      flow: 'Flow',
      'word-choice': 'Word choice',
      structure: 'Structure',
      redundancy: 'Redundancy',
      style: 'Style'
    };

    const heLabels: Record<string, string> = {
      consistency: 'עקביות',
      continuity: 'רציפות',
      clarity: 'בהירות',
      flow: 'זרימה',
      'word-choice': 'בחירת מילים',
      structure: 'מבנה',
      redundancy: 'חזרתיות',
      style: 'סגנון'
    };

    const map = lang === 'he' ? heLabels : enLabels;
    return map[key] ?? category;
  }

  analysisItems(text: string): string[] {
    return splitAnalysisItems(text);
  }

  onLineEditAcceptClick(s: AnalysisSuggestion): void {
    if (this.latestResult) {
      this.lineEditAccept.emit({ suggestion: s, result: this.latestResult });
    }
  }

  onLineEditDismissClick(s: AnalysisSuggestion): void {
    if (this.latestResult) {
      this.lineEditDismiss.emit({ suggestion: s, result: this.latestResult });
    }
  }

  /** Language for the consistency suggestion-card labels; resolved from the result / book language. */
  get consistencyCardLang(): 'he' | 'en' {
    return resolveCardLang(this.latestResult, this.bookLanguage);
  }

  onConsistencyDismissClick(s: AnalysisSuggestion): void {
    if (this.latestResult) {
      this.consistencyDismiss.emit({ suggestion: s, result: this.latestResult });
    }
  }
}
