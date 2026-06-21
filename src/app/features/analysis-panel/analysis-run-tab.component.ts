import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AnalysisResultDto, AnalysisSuggestion } from '../../core/models/analysis';
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
export class AnalysisRunTabComponent {
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
  @Input() bookLanguage: string | null = null;
  @Input() sceneId: string | null = null;

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

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
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
