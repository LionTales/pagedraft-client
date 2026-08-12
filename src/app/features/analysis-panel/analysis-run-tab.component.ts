import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import {
  ANALYSIS_TYPE_LABELS,
  AnalysisResultDto,
  AnalysisSuggestion,
  CHAPTER_RECAP_RELATIONSHIP,
} from '../../core/models/analysis';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';
import { resolveCardLang } from './card-lang';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { SuggestionCardComponent } from './suggestion-card.component';
import { LinguisticResultComponent } from './linguistic-result.component';
import { LiteraryResultComponent } from './literary-result.component';
import { MarkdownTextComponent } from './markdown-text.component';
import { TierToggleComponent } from '../../shared/tier-toggle/tier-toggle.component';

@Component({
  selector: 'app-analysis-run-tab',
  standalone: true,
  imports: [CommonModule, SuggestionCardComponent, LinguisticResultComponent, LiteraryResultComponent, MarkdownTextComponent, TierToggleComponent],
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

  // ── Style baseline (a3/a4; the BUILD moved to the book dashboard in w5) ────
  /**
   * Latest status read for the book's writing-style baseline (null while loading / no book).
   *
   * READ-ONLY here since w5. The build, its consent, its estimate and its paid-tier note moved to the book
   * dashboard (MOVE-1 + MOVE-2). This surface still needs the STATUS because the Linguistic result has to
   * be able to say "these deviations were measured against something that is missing or out of date" -
   * that is the cross-scope pointer the audit keeps (D13). Nothing on this surface may start the build.
   */
  @Input() styleBaselineStatus: BookStyleBaselineStatusDto | null = null;

  /**
   * D13 retarget (w5): the reader asked to go to the writing-style build's new home. The panel forwards
   * this to the editor, which switches the assistant to Book review and scrolls the row into view. This
   * component names the intent only; it owns no routing and no longer owns the build.
   */
  @Output() openStyleBaselineHome = new EventEmitter<void>();

  /**
   * The hosted tier toggle committed a tier change, so the ACTIVE MODEL may have moved (tier-ux-rework fixes
   * c04). Pure pass-through: this tab RENDERS the style-baseline status but the panel above OWNS the fetch
   * (and its supersession guard), so the re-read has to happen there. `builtWithDifferentModel` on that
   * status is computed against the active model and drives the cross-model warning rendered a few lines
   * below the toggle, which is why the two must not drift until the next page load.
   */
  @Output() tierChanged = new EventEmitter<void>();

  @Output() proofreadAccept = new EventEmitter<AnalysisSuggestion>();
  @Output() proofreadDismiss = new EventEmitter<AnalysisSuggestion>();
  @Output() lineEditAccept = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() lineEditDismiss = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() consistencyDismiss = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() showInDocumentEvent = new EventEmitter<AnalysisSuggestion>();
  @Output() explainSuggestion = new EventEmitter<AnalysisSuggestion>();

  showRawLineEdit = false;
  lineEditCategoryFilter = 'all';

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

  ngOnChanges(_changes: SimpleChanges): void {
    // w5: the consent-prompt reset that used to live here went with the consent prompt itself. The
    // relocated row on the book dashboard owns that reset now, keyed on the same (book, language) pair.
  }

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  /** Book-scoped chrome language ('he' default, 'en' for an English book). */
  get chromeLang(): 'he' | 'en' {
    return this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  /** Localized Run-tab chrome strings (he default, en fallback). Keeps he/en parity. */
  runLabel(key: string): string {
    const he: Record<string, string> = {
      suggestions: 'הצעות',
      runTime: 'זמן ריצה:',
      noChangesNeeded: 'אין צורך בשינויים. הטקסט שלך נראה תקין.',
      finalizing: 'מסיים תוצאות...',
      liveResult: 'תוצאה חיה',
      unreliableProofread: 'לא הצלחנו להפיק הגהה אמינה עבור קטע זה. נסו קטע קצר יותר (למשל סצנה אחת) והריצו שוב.',
      all: 'הכל',
      couldNotParseLineEdit: 'לא ניתן לפענח תוצאות עריכת שורה מובנות.',
      showRaw: 'הצג תגובה גולמית',
      hideRaw: 'הסתר תגובה גולמית',
      consistencyIssues: 'בעיות עקביות',
    };
    const en: Record<string, string> = {
      suggestions: 'Suggestions',
      runTime: 'Run time:',
      noChangesNeeded: 'No changes needed. Your text looks clean.',
      finalizing: 'Finalizing results...',
      liveResult: 'Live result',
      unreliableProofread: 'We could not produce a reliable proofread for this section. Try a shorter section (for example, one scene) and run it again.',
      all: 'All',
      couldNotParseLineEdit: 'Could not parse structured line edit results.',
      showRaw: 'Show raw response',
      hideRaw: 'Hide raw response',
      consistencyIssues: 'Consistency issues',
    };
    const map = this.chromeLang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /**
   * Localized display name for an analysis type value (he default, en for English books).
   * Reads from the shared ANALYSIS_TYPE_LABELS map so all surfaces stay in sync.
   */
  analysisTypeLabel(value: string): string {
    const map = ANALYSIS_TYPE_LABELS[this.chromeLang];
    return map[value] ?? value;
  }

  /**
   * Wave 3 / w6 (Q9-C): what the renamed recap pass does, and what it does NOT feed, in the book's
   * language. Read from the shared constant rather than restated here, because the book-briefs row on the
   * dashboard renders the other half of the same statement and the two must not drift.
   */
  get chapterRecapNote(): string {
    return CHAPTER_RECAP_RELATIONSHIP.pass[this.chromeLang];
  }

  // ── The book-wide writing style, as this per-chapter surface may speak of it ──

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the pointer and the empty states. */
  get baselineDir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /**
   * Derived state, READ-ONLY since w5: this surface no longer starts a build, so it has no client-tracked
   * BUILDING of its own. NOT BUILT / READY / STALE come from the a3 status fields per the documented state
   * machine, and only the not-built and stale readings drive anything here (the deviations pointer).
   */
  get baselineState(): 'not-built' | 'ready' | 'stale' | 'unknown' {
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

  // The cross-model warning went to the dashboard row with the build (w5): it is a reason to REFRESH the
  // artifact, and the refresh action no longer exists on this surface.

  /** True when the baseline is missing or incomplete (drives the deviations empty-state hint). */
  get baselineMissingOrInsufficient(): boolean {
    const st = this.baselineState;
    return st === 'not-built' || st === 'stale';
  }

  /**
   * Localized copy for the cross-scope writing-style POINTER and the run tab's empty states. he default,
   * en when the book language is English.
   *
   * w5: the build's own vocabulary (build / refresh / consent / estimate / paid note / cross-model) went
   * to the dashboard row with the build. What is left is what a per-chapter surface may honestly say
   * about a book-level artifact: that the artifact is missing or out of date, and where to go about it.
   * The user-facing name matches the row's new name, so the pointer and its destination read as one thing.
   */
  baselineLabel(key: string): string {
    const lang = this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
    const he: Record<string, string> = {
      hintBuild: 'כדי לזהות חריגות סגנון, יש לבנות תחילה את סגנון הכתיבה של הספר.',
      hintRefresh: 'סגנון הכתיבה של הספר אינו עדכני. רעננו אותו לקבלת תוצאות מדויקות יותר.',
      // DRAFT (Hebrew): verify wording/word-order with the user before sign-off.
      hintGoToHome: 'פתחו את לוח הספר',
      noRunYetScene: 'עדיין לא בוצע ניתוח עבור סצנה זו.',
      noRunYetChapter: 'עדיין לא בוצע ניתוח עבור פרק זה.',
      linguisticNoRunNote: 'הניתוח רץ לכל פרק בנפרד. הריצו ניתוח לפרק זה כדי לראות דוח. סגנון הכתיבה של הספר (הנבנה בלוח הספר) משמש רק להשוואה ואינו מייצר דוח לפרק.',
    };
    const en: Record<string, string> = {
      hintBuild: "To detect style deviations, build your book's writing style first.",
      hintRefresh: "Your book's writing style is out of date. Refresh it for more accurate results.",
      hintGoToHome: 'Open the book dashboard',
      noRunYetScene: 'No analysis run yet for this scene.',
      noRunYetChapter: 'No analysis run yet for this chapter.',
      linguisticNoRunNote: "Analysis runs per chapter. Run analysis on this chapter to see a report. Your book's writing style (built on the book dashboard) is only the comparison reference and does not create a per-chapter report.",
    };
    const map = lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  // w5: the consent estimate, its paid-tier predicate, the USD formatter and the whole consent gate
  // (open / cancel / confirm) moved WITH the build to
  // `features/book-dashboard/book-style-baseline-status-row.component.ts`. MOVE-2's rule is that consent
  // for a whole-book spend is asked where the whole-book action lives, so leaving a second copy of the
  // estimate here would be exactly the duplication the move exists to remove.

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
