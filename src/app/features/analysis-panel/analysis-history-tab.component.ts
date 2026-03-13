import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto } from '../../core/models/analysis';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';
import { proofreadDiff } from '../../core/utils/proofread-diff';
import { SuggestionCardComponent } from './suggestion-card.component';

@Component({
  selector: 'app-analysis-history-tab',
  standalone: true,
  imports: [CommonModule, SuggestionCardComponent],
  templateUrl: './analysis-history-tab.component.html',
  styleUrl: './analysis-history-tab.component.scss'
})
export class AnalysisHistoryTabComponent implements OnChanges {
  @Input() history: AnalysisResultDto[] = [];
  @Input() analysisTypes: readonly { value: string; label: string }[] = [];
  @Input() historyFilterType: string | null = null;
  @Input() streamingText = '';
  @Input() sceneId: string | null = null;
  @Input() explainingSuggestionIds = new Set<string>();
  @Input() documentText = '';
  @Input() acceptedProofreadHistoryKeys = new Set<string>();
  @Input() dismissedProofreadHistoryKeys = new Set<string>();
  @Input() acceptedLineEditKeys = new Set<string>();
  @Input() dismissedLineEditKeys = new Set<string>();
  @Input() proofreadOriginalDocumentByRunKey = new Map<string, string>();

  @Output() historyFilterChange = new EventEmitter<string | null>();
  @Output() proofreadHistoryAccept = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() proofreadHistoryDismiss = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() explainSuggestionEvent = new EventEmitter<AnalysisSuggestion>();

  selectedIndex = 0;
  historySuggestionStatusFilter: 'all' | 'accepted' | 'dismissed' | 'reverted' | 'pending' = 'all';

  constructor(
    private lineEditParser: LineEditParserService,
    private suggestionKeyService: SuggestionKeyService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['history']) {
      this.selectedIndex = 0;
    }
  }

  get currentHistoryItem(): AnalysisResultDto | null {
    return this.history[this.selectedIndex] ?? null;
  }

  /**
   * Map server-side AnalysisSuggestionDto to the unified AnalysisSuggestion shape.
   * For history, offsets are kept as-is (no adjustment) and no heuristic filtering is applied.
   */
  private mapDtoSuggestionsForHistory(result: AnalysisResultDto): AnalysisSuggestion[] {
    const list: AnalysisSuggestionDto[] = (result?.suggestions ?? [])
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    return list.map(dto => ({
      id: dto.id,
      startOffset: dto.startOffset,
      endOffset: dto.endOffset,
      original: dto.originalText,
      suggested: dto.suggestedText,
      reason: dto.reason ?? undefined,
      category: dto.category ?? undefined,
      explanation: dto.explanation ?? undefined,
      outcome: dto.outcome ?? undefined
    }));
  }

  get proofreadSuggestionsForHistory(): AnalysisSuggestion[] {
    const current = this.currentHistoryItem;
    if (!current || (current.analysisType || current.type) !== 'Proofread') return [];
    if (current.suggestions && current.suggestions.length) {
      return this.mapDtoSuggestionsForHistory(current);
    }
    if (!current.resultText) return [];
    const runKey = this.suggestionKeyService.proofreadRunKeyForResult(current);
    const originalText = this.proofreadOriginalDocumentByRunKey.get(runKey) ?? this.documentText;
    if (!originalText) return [];
    return proofreadDiff(originalText, current.resultText);
  }

  get proofreadHistoryItemsWithStatus(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const current = this.currentHistoryItem;
    if (!current) return [];
    const suggestions = this.proofreadSuggestionsForHistory;
    const result: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] = [];

    if (current.suggestions && current.suggestions.length && suggestions.length) {
      for (const s of suggestions) {
        const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
        let status: 'accepted' | 'dismissed' | 'reverted' | 'pending';
        if (this.acceptedProofreadHistoryKeys.has(key)) {
          status = 'accepted';
        } else if (this.dismissedProofreadHistoryKeys.has(key)) {
          status = 'dismissed';
        } else {
          const outcome = (s.outcome || '').toLowerCase();
          if (outcome === 'accepted') status = 'accepted';
          else if (outcome === 'dismissed' || outcome === 'superseded') status = 'dismissed';
          else if (outcome === 'reverted') status = 'reverted';
          else status = 'pending';
        }
        result.push({ suggestion: s, status });
      }
      return this.suggestionKeyService.sortHistoryItemsWithRecentFirst(result, s => this.suggestionKeyService.proofreadSuggestionKey(current, s));
    }

    const keyBased = suggestions.map(s => {
      const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
      if (this.acceptedProofreadHistoryKeys.has(key)) return { suggestion: s, status: 'accepted' as const };
      if (this.dismissedProofreadHistoryKeys.has(key)) return { suggestion: s, status: 'dismissed' as const };
      return { suggestion: s, status: 'pending' as const };
    });
    return this.suggestionKeyService.sortHistoryItemsWithRecentFirst(keyBased, s => this.suggestionKeyService.proofreadSuggestionKey(current, s));
  }

  get filteredProofreadHistoryItemsWithStatus(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const list = this.proofreadHistoryItemsWithStatus;
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  isProofreadWithSuggestions(): boolean {
    const current = this.currentHistoryItem;
    return !!current && (current.analysisType || current.type) === 'Proofread' && this.proofreadHistoryItemsWithStatus.length > 0;
  }

  lineEditSuggestionsWithStatus(current: AnalysisResultDto): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const keyFor = (s: { original: string; suggested: string }) =>
      this.suggestionKeyService.lineEditSuggestionKey(current, s);

    if (current.suggestions && current.suggestions.length) {
      const base = this.mapDtoSuggestionsForHistory(current);
      const result: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] = [];

      for (const s of base) {
        const key = keyFor(s);
        let status: 'accepted' | 'dismissed' | 'reverted' | 'pending';
        if (this.acceptedLineEditKeys.has(key)) {
          status = 'accepted';
        } else if (this.dismissedLineEditKeys.has(key)) {
          status = 'dismissed';
        } else {
          const outcome = (s.outcome || '').toLowerCase();
          if (outcome === 'accepted') status = 'accepted';
          else if (outcome === 'dismissed' || outcome === 'superseded') status = 'dismissed';
          else if (outcome === 'reverted') status = 'reverted';
          else status = 'pending';
        }
        result.push({ suggestion: s, status });
      }

      return this.suggestionKeyService.sortHistoryItemsWithRecentFirst(result, s => keyFor(s));
    }

    const lineEdit = this.getLineEdit(current);
    if (!lineEdit) return [];
    const suggestions = this.lineEditParser.toLineEditSuggestionsWithOffsets(lineEdit.suggestions, this.documentText);
    const keyBased = suggestions.map(s => {
      const key = keyFor(s);
      if (this.acceptedLineEditKeys.has(key)) return { suggestion: s, status: 'accepted' as const };
      if (this.dismissedLineEditKeys.has(key)) return { suggestion: s, status: 'dismissed' as const };
      return { suggestion: s, status: 'pending' as const };
    });
    return this.suggestionKeyService.sortHistoryItemsWithRecentFirst(keyBased, s => keyFor(s));
  }

  filteredLineEditSuggestionsWithStatus(current: AnalysisResultDto): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const list = this.lineEditSuggestionsWithStatus(current);
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  getLineEdit(current: AnalysisResultDto) {
    return this.lineEditParser.getLineEdit(current);
  }

  metricCards(structuredResult: string): { label: string; value: string }[] {
    try {
      const data = JSON.parse(structuredResult) as Record<string, unknown>;
      const cards: { label: string; value: string }[] = [];
      const g = data['grammaticalityScore'];
      if (typeof g === 'number')
        cards.push({ label: 'Grammaticality', value: `${g.toFixed(2)} / 1.0` });
      const w = data['wordCount'];
      if (typeof w === 'number')
        cards.push({ label: 'Words', value: String(w) });
      const u = data['uniqueWordCount'];
      if (typeof u === 'number')
        cards.push({ label: 'Unique words', value: String(u) });
      const r = data['readabilityScore'];
      if (typeof r === 'number')
        cards.push({ label: 'Readability', value: `${r.toFixed(1)} / 10` });
      const themes = data['themes'];
      if (themes && Array.isArray(themes))
        cards.push({ label: 'Themes', value: String(themes.length) });
      const suggestions = data['suggestions'];
      if (suggestions && Array.isArray(suggestions))
        cards.push({ label: 'Suggestions', value: String(suggestions.length) });
      return cards;
    } catch {
      return [];
    }
  }

  analysisItems(text: string): string[] {
    if (!text?.trim()) return [];
    const trimmed = text.trim();
    if (!/\d+\.\s/.test(trimmed)) return [trimmed];
    const parts = trimmed.split(/\s*\d+\.\s*/).map(s => s.trim()).filter(Boolean);
    return parts.length ? parts : [trimmed];
  }

  onSetHistoryFilter(type: string | null): void {
    this.historyFilterChange.emit(type);
  }

  onProofreadHistoryAccept(s: AnalysisSuggestion): void {
    const current = this.currentHistoryItem;
    if (current) {
      this.proofreadHistoryAccept.emit({ suggestion: s, result: current });
    }
  }

  onProofreadHistoryDismiss(s: AnalysisSuggestion): void {
    const current = this.currentHistoryItem;
    if (current) {
      this.proofreadHistoryDismiss.emit({ suggestion: s, result: current });
    }
  }
}
