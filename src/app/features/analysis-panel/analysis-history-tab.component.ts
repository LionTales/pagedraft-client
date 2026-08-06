import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { ANALYSIS_TYPE_LABELS, AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto, isConsistencySuggestion } from '../../core/models/analysis';
import { LineEditParserService, ParsedLineEdit } from '../../core/services/line-edit-parser.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';
import { proofreadDiff } from '../../core/utils/proofread-diff';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { SuggestionCardComponent } from './suggestion-card.component';
import { LinguisticResultComponent } from './linguistic-result.component';
import { LiteraryResultComponent } from './literary-result.component';
import { MarkdownTextComponent } from './markdown-text.component';
import { resolveCardLang } from './card-lang';

@Component({
  selector: 'app-analysis-history-tab',
  standalone: true,
  imports: [CommonModule, SuggestionCardComponent, LinguisticResultComponent, LiteraryResultComponent, MarkdownTextComponent],
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
  @Input() dismissedConsistencyKeys = new Set<string>();
  /** Book language (e.g. 'he', 'en'); feeds the consistency card label localization. */
  @Input() bookLanguage: string | null = null;
  @Input() proofreadOriginalDocumentByRunKey = new Map<string, string>();

  @Output() historyFilterChange = new EventEmitter<string | null>();
  @Output() proofreadHistoryAccept = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() proofreadHistoryDismiss = new EventEmitter<{ suggestion: AnalysisSuggestion; result: AnalysisResultDto }>();
  @Output() explainSuggestionEvent = new EventEmitter<AnalysisSuggestion>();

  selectedIndex = 0;
  historySuggestionStatusFilter: 'all' | 'accepted' | 'dismissed' | 'reverted' | 'pending' = 'all';

  /** Cached result of lineEditSuggestionsWithStatus for the current history item; invalidated by ngOnChanges. */
  private _lineEditSuggestionsWithStatusCache: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] | null = null;
  private _lineEditSuggestionsWithStatusCacheResultId: string | null = null;

  /** Cached result of consistencySuggestionsWithStatus for the current history item; invalidated by ngOnChanges. */
  private _consistencySuggestionsWithStatusCache: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] | null = null;
  private _consistencySuggestionsWithStatusCacheResultId: string | null = null;

  /** Cached parsed LineEdit for the current history item; avoids repeated JSON.parse in template. */
  private _lineEditCache: ParsedLineEdit | null = null;
  private _lineEditCacheResultId: string | null = null;

  /** Cached metric cards for the current structured result; avoids repeated JSON.parse in template. */
  private _metricCardsCache: { label: string; value: string }[] | null = null;
  private _metricCardsCacheResultKey: string | null = null;

  /** Cached proofread suggestions with status for the current history item; invalidated by ngOnChanges. */
  private _proofreadHistoryItemsWithStatusCache: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] | null = null;
  private _proofreadHistoryItemsWithStatusCacheResultId: string | null = null;

  constructor(
    private lineEditParser: LineEditParserService,
    private suggestionKeyService: SuggestionKeyService
  ) {}

  /** Book-scoped chrome language ('he' default, 'en' for an English book). */
  get chromeLang(): 'he' | 'en' {
    return (this.bookLanguage?.trim().toLowerCase() || 'he').startsWith('en') ? 'en' : 'he';
  }

  /** Localized History-tab chrome strings (he default, en fallback). Keeps he/en parity. */
  histLabel(key: string): string {
    const he: Record<string, string> = {
      history: 'היסטוריה',
      all: 'הכל',
      whatHappened: 'הצעות: מה קרה',
      accepted: 'הוחל',
      dismissed: 'נדחה',
      reverted: 'בוטל',
      pending: 'ממתין',
      consistencyIssues: 'בעיות עקביות',
      unreliableProofread: 'לא הצלחנו להפיק הגהה אמינה עבור קטע זה. נסו קטע קצר יותר (למשל סצנה אחת) והריצו שוב.',
      // DRAFT (Hebrew): verify wording/word-order with the user before sign-off.
      characterRegisterStale: 'מאגר הדמויות של הספר השתנה אחרי שהניתוח הזה רץ, ולכן ייתכן שפרטי הדמויות שהוא קיבל אינם מעודכנים.',
      noHistoryScene: 'אין עדיין היסטוריית ניתוח לסצנה זו.',
      noHistoryChapter: 'אין עדיין היסטוריית ניתוח לפרק זה.',
    };
    const en: Record<string, string> = {
      history: 'History',
      all: 'All',
      whatHappened: 'Suggestions: what happened',
      accepted: 'Accepted',
      dismissed: 'Dismissed',
      reverted: 'Reverted',
      pending: 'Pending',
      consistencyIssues: 'Consistency issues',
      unreliableProofread: 'We could not produce a reliable proofread for this section. Try a shorter section (for example, one scene) and run it again.',
      characterRegisterStale: 'The book character register changed after this analysis ran, so the character details it was given may be out of date.',
      noHistoryScene: 'No analysis history yet for this scene.',
      noHistoryChapter: 'No analysis history yet for this chapter.',
    };
    const map = this.chromeLang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Timezone-aware relative time for a history item's createdAt (no raw | date). Follows the book language. */
  itemTime(iso: string | null | undefined): string {
    return formatRelativeTime(iso, this.chromeLang);
  }

  /** Localized label for an analysis-type filter button (he default, en fallback). */
  analysisTypeLabel(value: string): string {
    const map = ANALYSIS_TYPE_LABELS[this.chromeLang];
    return map[value] ?? value;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['history']) {
      this.selectedIndex = 0;
    }
    const lineEditCacheKeys = ['history', 'acceptedLineEditKeys', 'dismissedLineEditKeys', 'documentText'];
    if (lineEditCacheKeys.some(k => changes[k])) {
      this._lineEditSuggestionsWithStatusCache = null;
      this._lineEditSuggestionsWithStatusCacheResultId = null;
      this._lineEditCache = null;
      this._lineEditCacheResultId = null;
      this._metricCardsCache = null;
      this._metricCardsCacheResultKey = null;
    }
    const proofreadCacheKeys = ['history', 'acceptedProofreadHistoryKeys', 'dismissedProofreadHistoryKeys', 'documentText', 'proofreadOriginalDocumentByRunKey'];
    if (proofreadCacheKeys.some(k => changes[k])) {
      this._proofreadHistoryItemsWithStatusCache = null;
      this._proofreadHistoryItemsWithStatusCacheResultId = null;
    }
    const consistencyCacheKeys = ['history', 'dismissedConsistencyKeys'];
    if (consistencyCacheKeys.some(k => changes[k])) {
      this._consistencySuggestionsWithStatusCache = null;
      this._consistencySuggestionsWithStatusCacheResultId = null;
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
    const cacheKey = `${this.selectedIndex}:${current.id ?? ''}`;
    if (this._proofreadHistoryItemsWithStatusCacheResultId === cacheKey) {
      return this._proofreadHistoryItemsWithStatusCache ?? [];
    }
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
      this._proofreadHistoryItemsWithStatusCache = this.suggestionKeyService.sortHistoryItemsWithRecentFirst(result, s => this.suggestionKeyService.proofreadSuggestionKey(current, s));
    } else {
      const keyBased = suggestions.map(s => {
        const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
        if (this.acceptedProofreadHistoryKeys.has(key)) return { suggestion: s, status: 'accepted' as const };
        if (this.dismissedProofreadHistoryKeys.has(key)) return { suggestion: s, status: 'dismissed' as const };
        return { suggestion: s, status: 'pending' as const };
      });
      this._proofreadHistoryItemsWithStatusCache = this.suggestionKeyService.sortHistoryItemsWithRecentFirst(keyBased, s => this.suggestionKeyService.proofreadSuggestionKey(current, s));
    }
    this._proofreadHistoryItemsWithStatusCacheResultId = cacheKey;
    return this._proofreadHistoryItemsWithStatusCache ?? [];
  }

  get filteredProofreadHistoryItemsWithStatus(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const list = this.proofreadHistoryItemsWithStatus;
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  isProofreadWithSuggestions(): boolean {
    const current = this.currentHistoryItem;
    if (!current || (current.analysisType || current.type) !== 'Proofread') return false;
    // An unreliable proofread shows ONLY the warning paragraph: suppress the raw #textResult fallback too
    // (the dropped/unrelated text is not worth showing). Returning true here means "do not show raw text".
    if (current.proofreadResultUnreliable) return true;
    return this.proofreadHistoryItemsWithStatus.length > 0;
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

  /**
   * Cached list of line-edit suggestions with status for the current history item, then filtered by
   * historySuggestionStatusFilter. Use this in the template instead of calling
   * lineEditSuggestionsWithStatus(current) so the work runs at most once per change detection
   * (and only when cache is invalidated).
   */
  get filteredLineEditSuggestionsWithStatusForCurrent(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const current = this.currentHistoryItem;
    if (!current || (current.analysisType || current.type) !== 'LineEdit') return [];
    const resultId = current.id ?? '';
    const cacheKey = `${this.selectedIndex}:${resultId}`;
    if (this._lineEditSuggestionsWithStatusCacheResultId !== cacheKey) {
      this._lineEditSuggestionsWithStatusCache = this.lineEditSuggestionsWithStatus(current);
      this._lineEditSuggestionsWithStatusCacheResultId = cacheKey;
    }
    const list = this._lineEditSuggestionsWithStatusCache ?? [];
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  /**
   * Consistency (register/tense/POV) suggestions with outcome status for the current LinguisticAnalysis
   * history item. Mirrors lineEditSuggestionsWithStatus but sourced ONLY from result.suggestions whose
   * category startsWith 'consistency-' (single source of truth, disjoint from line-edit/proofread).
   * Read-only display; navigate-only items carry no Accept.
   */
  private consistencySuggestionsWithStatus(current: AnalysisResultDto): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const keyFor = (s: { original: string; suggested: string }) =>
      this.suggestionKeyService.lineEditSuggestionKey(current, s);

    const base = this.mapDtoSuggestionsForHistory(current).filter(s => isConsistencySuggestion(s));
    const result: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] = [];

    for (const s of base) {
      const key = keyFor(s);
      let status: 'accepted' | 'dismissed' | 'reverted' | 'pending';
      if (this.dismissedConsistencyKeys.has(key)) {
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

  /** Cached + status-filtered consistency suggestions for the current LinguisticAnalysis history item. */
  get filteredConsistencySuggestionsWithStatusForCurrent(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const current = this.currentHistoryItem;
    if (!current || (current.analysisType || current.type) !== 'LinguisticAnalysis') return [];
    const resultId = current.id ?? '';
    const cacheKey = `${this.selectedIndex}:${resultId}`;
    if (this._consistencySuggestionsWithStatusCacheResultId !== cacheKey) {
      this._consistencySuggestionsWithStatusCache = this.consistencySuggestionsWithStatus(current);
      this._consistencySuggestionsWithStatusCacheResultId = cacheKey;
    }
    const list = this._consistencySuggestionsWithStatusCache ?? [];
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  /** Language for the consistency suggestion-card labels in History; resolved from the result / book language. */
  get consistencyCardLang(): 'he' | 'en' {
    return resolveCardLang(this.currentHistoryItem, this.bookLanguage);
  }

  getLineEdit(current: AnalysisResultDto): ParsedLineEdit | null {
    return this.lineEditParser.getLineEdit(current);
  }

  /**
   * Cached parsed LineEdit for the current history item. Use in template instead of getLineEdit(current)
   * so JSON.parse runs at most once per change detection when the current item changes.
   */
  get lineEditForCurrent(): ParsedLineEdit | null {
    const current = this.currentHistoryItem;
    if (!current || (current.analysisType || current.type) !== 'LineEdit') return null;
    const cacheKey = `${this.selectedIndex}:${current.id ?? ''}`;
    if (this._lineEditCacheResultId !== cacheKey) {
      this._lineEditCache = this.lineEditParser.getLineEdit(current);
      this._lineEditCacheResultId = cacheKey;
    }
    return this._lineEditCache;
  }

  /**
   * Cached metric cards for the current history item. Use in template instead of metricCards(current.structuredResult)
   * so JSON.parse runs at most once per change detection when the current item or its structuredResult changes.
   */
  get metricCardsForCurrent(): { label: string; value: string }[] {
    const current = this.currentHistoryItem;
    if (!current?.structuredResult) return [];
    const cacheKey = `${this.selectedIndex}:${current.id ?? ''}:${current.structuredResult}`;
    if (this._metricCardsCacheResultKey !== cacheKey) {
      this._metricCardsCache = this.metricCards(current.structuredResult);
      this._metricCardsCacheResultKey = cacheKey;
    }
    return this._metricCardsCache ?? [];
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
