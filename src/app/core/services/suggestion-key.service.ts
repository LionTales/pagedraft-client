import { Injectable } from '@angular/core';

import { AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto } from '../models/analysis';
import { normalizeTextForAnalysis } from '../utils/normalize-text-for-analysis';

@Injectable({
  providedIn: 'root'
})
export class SuggestionKeyService {
  private recentOutcomeKeys: string[] = [];

  /** Stable key for a Proofread run (chapterId, sceneId, createdAt). Used to store/retrieve original document text and for suggestion keys. */
  proofreadRunKeyForResult(r: AnalysisResultDto): string {
    return `${r.chapterId}-${r.sceneId ?? ''}-${r.createdAt}`;
  }

  /** Normalize text for key matching (NFC) so API and diff produce the same key. */
  private normalizeKeyText(t: string): string {
    return (t ?? '').normalize('NFC');
  }

  /** Stable key for a Proofread run + suggestion (chapterId, sceneId, createdAt, original, suggested). */
  proofreadRunKey(r: AnalysisResultDto, s: { original: string; suggested: string }): string {
    const o = this.normalizeKeyText(s.original);
    const g = this.normalizeKeyText(s.suggested);
    return `${this.proofreadRunKeyForResult(r)}-${o}-${g}`;
  }

  /**
   * Key for a Proofread suggestion outcome.
   * Uses id when available (persisted run) so it matches API-stored outcomes; otherwise run key for streaming.
   */
  proofreadSuggestionKey(r: AnalysisResultDto, s: { original: string; suggested: string }): string {
    const o = this.normalizeKeyText(s.original);
    const g = this.normalizeKeyText(s.suggested);
    return r.id ? `${(r.id || '').toLowerCase()}-${o}-${g}` : this.proofreadRunKey(r, s);
  }

  /**
   * Key for a Line Edit suggestion outcome.
   * Uses id when available; otherwise falls back to a stable run-based key.
   */
  lineEditSuggestionKey(r: AnalysisResultDto, s: { original: string; suggested: string }): string {
    const id = (r.id || '').toLowerCase();
    const o = this.normalizeKeyText(s.original);
    const g = this.normalizeKeyText(s.suggested);
    if (id) return `${id}-${o}-${g}`;
    const runPart = `${r.chapterId}-${r.sceneId ?? ''}-${r.createdAt}`;
    return `${runPart}-${o}-${g}`;
  }

  /** Track a suggestion outcome change so recently-touched items float to the top of History. */
  trackRecentOutcomeKey(key: string): void {
    if (!key) return;
    this.recentOutcomeKeys = [key, ...this.recentOutcomeKeys.filter(k => k !== key)].slice(0, 50);
  }

  /** Current list of recently-touched outcome keys (most-recent first). */
  getRecentOutcomeKeys(): string[] {
    return this.recentOutcomeKeys.slice();
  }

  /** Order for History suggestion list: pending first, then accepted, then reverted, then dismissed. */
  suggestionStatusOrder(s: 'accepted' | 'dismissed' | 'reverted' | 'pending'): number {
    return s === 'pending' ? 0 : s === 'accepted' ? 1 : s === 'reverted' ? 2 : 3;
  }

  /**
   * Sort history items so that suggestions whose outcome changed in this session appear first
   * (in most-recent change order). Items not touched in this session fall back to status ordering.
   */
  sortHistoryItemsWithRecentFirst<
    TStatus extends 'accepted' | 'dismissed' | 'reverted' | 'pending'
  >(
    items: { suggestion: AnalysisSuggestion; status: TStatus }[],
    keySelector: (s: AnalysisSuggestion) => string
  ): { suggestion: AnalysisSuggestion; status: TStatus }[] {
    if (!items.length || !this.recentOutcomeKeys.length) {
      return items.sort(
        (a, b) => this.suggestionStatusOrder(a.status) - this.suggestionStatusOrder(b.status)
      );
    }
    const orderMap = new Map(this.recentOutcomeKeys.map((k, i) => [k, i]));
    return items.sort((a, b) => {
      const ka = keySelector(a.suggestion);
      const kb = keySelector(b.suggestion);
      const ia = orderMap.has(ka) ? orderMap.get(ka)! : Number.POSITIVE_INFINITY;
      const ib = orderMap.has(kb) ? orderMap.get(kb)! : Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia - ib;
      return this.suggestionStatusOrder(a.status) - this.suggestionStatusOrder(b.status);
    });
  }

  /**
   * Apply an outcome to suggestion DTOs across results.
   * Returns the set of suggestionIds that were updated.
   */
  applyOutcomeToSuggestionDtos(
    latestResult: AnalysisResultDto | null | undefined,
    allAnalyses: AnalysisResultDto[] | null | undefined,
    suggestionId: string,
    outcome: 'Accepted' | 'Dismissed' | 'Reverted' | 'Superseded'
  ): Set<string> {
    const updatedIds = new Set<string>();
    this.updateSuggestionDtos(latestResult, allAnalyses, suggestionId, (dto) => {
      dto.outcome = outcome;
      if (dto.id) {
        updatedIds.add(dto.id);
      }
    });
    return updatedIds;
  }

  /** Find a suggestion DTO by id across latestResult and allAnalyses. */
  findSuggestionDtoById(
    latestResult: AnalysisResultDto | null | undefined,
    allAnalyses: AnalysisResultDto[] | null | undefined,
    suggestionId: string
  ): AnalysisSuggestionDto | null {
    let found: AnalysisSuggestionDto | null = null;
    if (!suggestionId) return null;
    this.updateSuggestionDtos(latestResult, allAnalyses, suggestionId, (dto) => {
      if (!found) {
        found = dto;
      }
    });
    return found;
  }

  /** Build a stable History key for a suggestion DTO using its parent analysis result. */
  proofreadSuggestionKeyForDto(
    allAnalyses: AnalysisResultDto[] | null | undefined,
    dto: AnalysisSuggestionDto
  ): string | null {
    if (!dto.analysisResultId || !allAnalyses?.length) return null;
    const analysis = allAnalyses.find(
      r => (r.id || '').toLowerCase() === dto.analysisResultId.toLowerCase()
    );
    if (!analysis) return null;
    return this.proofreadSuggestionKey(analysis, {
      original: dto.originalText,
      suggested: dto.suggestedText
    });
  }

  /**
   * Mark a suggestion as Reverted in in-memory analysis results using analysis id and original/suggested text.
   * Returns the set of suggestionIds that were updated and the recent outcome keys that should be tracked.
   */
  markSuggestionReverted(
    latestResult: AnalysisResultDto | null | undefined,
    allAnalyses: AnalysisResultDto[] | null | undefined,
    analysisId: string,
    originalText: string,
    suggestedText: string
  ): { updatedSuggestionIds: Set<string>; recentKeys: string[] } {
    if (!analysisId || !originalText || !suggestedText) {
      return { updatedSuggestionIds: new Set<string>(), recentKeys: [] };
    }

    const id = analysisId.toLowerCase();
    const normOriginal = normalizeTextForAnalysis(originalText);
    const normSuggested = normalizeTextForAnalysis(suggestedText);

    const updatedSuggestionIds = new Set<string>();
    const recentKeys: string[] = [];

    const updateResult = (result: AnalysisResultDto | null | undefined): void => {
      if (!result?.suggestions?.length || (result.id || '').toLowerCase() !== id) return;
      const dto = result.suggestions.find(x =>
        normalizeTextForAnalysis(x.originalText ?? '') === normOriginal &&
        normalizeTextForAnalysis(x.suggestedText ?? '') === normSuggested
      );
      if (dto) {
        dto.outcome = 'Reverted';
        if (dto.id) {
          updatedSuggestionIds.add(dto.id);
        }
        const key = this.proofreadSuggestionKey(result, {
          original: originalText,
          suggested: suggestedText
        });
        recentKeys.push(key);
      }
    };

    if (latestResult) {
      updateResult(latestResult);
    }
    if (allAnalyses?.length) {
      for (const r of allAnalyses) {
        updateResult(r);
      }
    }

    recentKeys.forEach(k => this.trackRecentOutcomeKey(k));

    return { updatedSuggestionIds, recentKeys };
  }

  /**
   * Mark a suggestion as Reverted using its stable suggestionId.
   * Returns the set of suggestionIds that were updated and the recent outcome keys that should be tracked.
   */
  markSuggestionRevertedById(
    latestResult: AnalysisResultDto | null | undefined,
    allAnalyses: AnalysisResultDto[] | null | undefined,
    suggestionId: string
  ): { updatedSuggestionIds: Set<string>; recentKeys: string[] } {
    if (!suggestionId) {
      return { updatedSuggestionIds: new Set<string>(), recentKeys: [] };
    }

    const updatedIds = new Set<string>();
    const recentKeys: string[] = [];

    this.updateSuggestionDtos(latestResult, allAnalyses, suggestionId, (dto, result) => {
      dto.outcome = 'Reverted';
      if (dto.id) {
        updatedIds.add(dto.id);
      }
      const key = this.proofreadSuggestionKey(result, {
        original: dto.originalText ?? '',
        suggested: dto.suggestedText ?? ''
      });
      recentKeys.push(key);
    });

    recentKeys.forEach(k => this.trackRecentOutcomeKey(k));

    return { updatedSuggestionIds: updatedIds, recentKeys };
  }

  private updateSuggestionDtos(
    latestResult: AnalysisResultDto | null | undefined,
    allAnalyses: AnalysisResultDto[] | null | undefined,
    suggestionId: string,
    update: (dto: AnalysisSuggestionDto, result: AnalysisResultDto) => void
  ): void {
    const sources: AnalysisResultDto[] = [];
    if (latestResult) {
      sources.push(latestResult);
    }
    if (allAnalyses?.length) {
      for (const r of allAnalyses) {
        if (r === latestResult) continue;
        sources.push(r);
      }
    }
    for (const result of sources) {
      if (!result?.suggestions?.length) continue;
      const dto = result.suggestions.find(x => x.id && x.id === suggestionId);
      if (dto) {
        update(dto, result);
      }
    }
  }
}

