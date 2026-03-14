import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin } from 'rxjs';
import { ANALYSIS_TYPES, AnalysisResultDto, AnalysisSuggestion, AnalysisSuggestionDto, PromptTemplateDto } from '../../core/models/analysis';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisRunOrchestrationService, AnalysisRunContext, AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { DocumentVersionService, DocumentVersionDto } from '../../core/services/document-version.service';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';
import { ApplyCorrectionEvent } from '../language-engine/issue-panel.component';
import { proofreadDiff } from '../../core/utils/proofread-diff';
import { normalizeTextForAnalysis } from '../../core/utils/normalize-text-for-analysis';
import { SuggestionCardComponent } from './suggestion-card.component';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { AnalysisHistoryTabComponent } from './analysis-history-tab.component';
import { AnalysisVersionsTabComponent } from './analysis-versions-tab.component';

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SuggestionCardComponent, AnalysisRunTabComponent, AnalysisHistoryTabComponent, AnalysisVersionsTabComponent],
  templateUrl: './analysis-panel.component.html',
  styleUrl: './analysis-panel.component.scss'
})
export class AnalysisPanelComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  @Input() chapterId: string | null = null;
  @Input() sceneId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Used for analysis and templates. Defaults to 'he' if not set. */
  @Input() bookLanguage: string | null = null;
  /** Current document plain text (from editor). Used for Proofread diff and Line Edit offset mapping. */
  @Input() documentText: string = '';
  /** Chapter/scene the current document belongs to; used to avoid restoring with stale documentText after chapter switch. */
  @Input() documentChapterId: string | null = null;
  @Input() documentSceneId: string | null = null;
  /** If provided, called before run/streaming so the editor can save; must return Promise that resolves when save is done. */
  @Input() saveBeforeRun?: () => Promise<void>;
  @Output() analysisStarted = new EventEmitter<void>();
  @Output() analysisCompleted = new EventEmitter<void>();
  /** Optional human-readable status for the global analysis spinner (e.g. estimated chunks). */
  @Output() analysisStatus = new EventEmitter<string>();
  /** Optional numeric progress (0–100) for the global analysis spinner. */
  @Output() analysisProgressPercent = new EventEmitter<number | null>();
  @Output() applyCorrection = new EventEmitter<ApplyCorrectionEvent>();
  @Output() showInDocument = new EventEmitter<{ suggestionId?: string; startOffset?: number; endOffset?: number; originalText?: string }>();
  @Output() suggestionRangesChange = new EventEmitter<{ suggestionId?: string; startOffset: number; endOffset: number }[]>();
  @Output() revertToVersion = new EventEmitter<string>();

  readonly analysisTypes = ANALYSIS_TYPES;
  selectedAnalysisType: string = 'Proofread';
  prompt = '';
  selectedTemplateId: string | null = null;
  isRunning = false;
  streamingText = '';

  templates: PromptTemplateDto[] = [];
  history: AnalysisResultDto[] = [];
  /** All analyses from the API (Active + Archived); History tab shows only Archived. Exposed for child component bindings. */
  allAnalyses: AnalysisResultDto[] = [];
  historyFilterType: string | null = null;

  /** When true, emit suggestion ranges so the editor highlights them; when false, emit [] so no highlights are applied. */
  highlightSuggestionsInDocument = true;
  /** Sub-tab: 'run' shows only latest result; 'history' shows filter + list + selected; 'versions' shows saved snapshots. */
  activeSubTab: 'run' | 'history' | 'versions' = 'run';
  /** Error message from last run (e.g. "Proofread text is too long"); cleared on next run or success. */
  runError: string | null = null;
  /** Latest result shown on Run tab (set when run completes or streaming completes). */
  latestResult: AnalysisResultDto | null = null;
  /** Proofread suggestions populated from server-side AnalysisSuggestion rows; shown on Run tab with Accept/Dismiss. */
  proofreadSuggestions: AnalysisSuggestion[] = [];
  /** True when diff produced too many suggestions (likely model returned unrelated content); show "try shorter section" instead of cards. */
  proofreadSuggestionsUnreliable = false;
  /** Keys of dismissed Line Edit suggestions (so we hide them in History). Key: `${resultId}-${original}-${suggested}` */
  dismissedLineEditKeys = new Set<string>();
  /** Keys of accepted Line Edit suggestions in History (read-only display). */
  acceptedLineEditKeys = new Set<string>();
  /** Keys of dismissed Proofread suggestions in History view. Key: `${resultId}-${original}-${suggested}` */
  dismissedProofreadHistoryKeys = new Set<string>();
  /** Keys of accepted Proofread suggestions in History (read-only display). */
  acceptedProofreadHistoryKeys = new Set<string>();
  /** Active run subscription; cancelled on destroy or when starting a new run. */
  private runSubscription: Subscription | null = null;
  /** Original document text at the time of each Proofread run (key = chapterId-sceneId-createdAt). Used so History diff shows all suggestions including accepted. */
  proofreadOriginalDocumentByRunKey = new Map<string, string>();
  /** True after we've restored proofread suggestions for the current chapter/scene (so we don't re-run diff on every documentText change while user edits). */
  private hasRestoredProofreadForCurrentContext = false;
  /** Versions list for the Versions tab (chapter/scene document snapshots). */
  versions: DocumentVersionDto[] = [];
  /** Timestamp when the current run started (for duration display). */
  private runStartedAt: number | null = null;
  /** Human-readable duration label for the last completed run (e.g. "45s", "2m 10s"). */
  lastRunDurationLabel: string | null = null;
  /** Latest estimated completion percent for the current Proofread run (0–100). */
  currentProgressPercent: number | null = null;
  /** Line Edit suggestions for the current Run tab (from server-side AnalysisSuggestion rows). */
  lineEditRunSuggestions: AnalysisSuggestion[] = [];
  /** True after we've restored Line Edit suggestions for the current chapter/scene (so we don't re-run mapping on every documentText change while user edits). */
  private hasRestoredLineEditForCurrentContext = false;
  /** Cached list of Active analyses (by status) for the current chapter/scene, used for re-analysis warnings. */
  private activeAnalyses: AnalysisResultDto[] = [];
  /** IDs of suggestions currently being explained via the Why? button (empty = none loading). */
  explainingSuggestionIds = new Set<string>();
  /** Map backend AnalysisSuggestionDto to the unified AnalysisSuggestion shape used in the UI. */
  private mapDtoSuggestions(
    result: AnalysisResultDto | null | undefined,
    adjustOffsets: boolean = true,
    applyHeuristicFilter: boolean = true
  ): AnalysisSuggestion[] {
    const list: AnalysisSuggestionDto[] = (result?.suggestions ?? [])
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const mapped = list.map(dto => ({
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

    // Optionally validate and correct offsets: the server's normalized text may differ slightly
    // from the client's (Syncfusion GetText vs manual SFDT walk). If the slice at the
    // reported offsets doesn't match originalText, search nearby and fix. This is only safe
    // to apply for the current document; for historical results we keep server offsets as-is.
    if (adjustOffsets) {
      try {
        if (this.documentText && mapped.length) {
          const doc = this.documentText;
          const searchRadius = 30;
          for (const s of mapped) {
            if (s.startOffset == null || s.endOffset == null || !s.original) continue;
            const normalizedOriginal = normalizeTextForAnalysis(s.original || '');
            if (!normalizedOriginal) continue;
            const slice = doc.slice(s.startOffset, s.endOffset);
            if (slice === normalizedOriginal) continue;
            const searchStart = Math.max(0, s.startOffset - searchRadius);
            const searchEnd = Math.min(doc.length, s.endOffset + searchRadius);
            const region = doc.slice(searchStart, searchEnd);

            // Find the occurrence of s.original within the search window whose
            // absolute position is closest to the original startOffset. This
            // avoids snapping to the first repeated word in the region.
            let bestRelativeIdx = -1;
            let bestDistance = Number.MAX_SAFE_INTEGER;
            let scanIdx = region.indexOf(normalizedOriginal);
            while (scanIdx >= 0) {
              const absPos = searchStart + scanIdx;
              const distance = Math.abs(absPos - s.startOffset);
              if (distance < bestDistance) {
                bestDistance = distance;
                bestRelativeIdx = scanIdx;
                if (distance === 0) break;
              }
              scanIdx = region.indexOf(normalizedOriginal, scanIdx + 1);
            }

            if (bestRelativeIdx >= 0) {
              s.startOffset = searchStart + bestRelativeIdx;
              s.endOffset = s.startOffset + normalizedOriginal.length;
            }
          }
        }
      } catch {
        // best-effort correction only
      }
    }

    if (!applyHeuristicFilter) {
      return mapped;
    }

    return mapped.filter(s => {
      const origLen = (s.original ?? '').length;
      const sugLen = (s.suggested ?? '').length;
      if (origLen > 60 && sugLen <= 5) return false;
      return true;
    });
  }

  ngOnDestroy(): void {
    this.runSubscription?.unsubscribe();
    this.orchestrationService.stopProgressPolling();
  }

  constructor(
    private analysisService: AnalysisService,
    private documentVersionService: DocumentVersionService,
    private cdr: ChangeDetectorRef,
    private orchestrationService: AnalysisRunOrchestrationService,
    private lineEditParser: LineEditParserService,
    private suggestionKeyService: SuggestionKeyService
  ) {}


  get canRun(): boolean {
    if (!this.bookId || !this.chapterId) return false;
    if (this.selectedAnalysisType === 'Custom') return !!this.prompt?.trim();
    return true;
  }

  onSelectAnalysisType(type: string): void {
    this.selectedAnalysisType = type;

    if (!this.allAnalyses || this.allAnalyses.length === 0) {
      this.activeSubTab = 'run';
      return;
    }

    const activeForType = this.activeAnalyses.filter(
      r => (r.analysisType || r.type) === type
    );
    const allForType = this.allAnalyses.filter(
      r => (r.analysisType || r.type) === type
    );
    const candidates = (activeForType.length ? activeForType : allForType)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const candidate = candidates[0];

    if (!candidate) {
      this.activeSubTab = 'run';
      return;
    }

    this.latestResult = candidate;

    if (this.documentMatchesCurrentContext && this.documentText) {
      if (type === 'Proofread') {
        this.restoreProofreadStateFromLatestResult();
      } else if (type === 'LineEdit') {
        this.restoreLineEditStateFromResult(candidate);
      }
    }

    this.activeSubTab = 'run';
  }

  setHistoryFilter(type: string | null): void {
    this.historyFilterType = type;
    // When we already have a full history snapshot, just rebuild client-side
    // from allAnalyses to avoid an extra network round-trip on every filter click.
    if (this.allAnalyses && this.allAnalyses.length) {
      this.rebuildHistoryFromAllAnalyses();
      // Preserve any in-flight streaming run (no id) in the History list,
      // but only when its analysis type matches the current history filter (or when showing All).
      if (this.latestResult && !this.latestResult.id) {
        const latestType = this.latestResult.analysisType || this.latestResult.type;
        if (!this.historyFilterType || latestType === this.historyFilterType) {
          this.history = [this.latestResult, ...this.history];
        }
      }
    } else {
      this.loadHistory();
    }
  }

  /** Call after Revert (or other outcome change) so History tab shows updated suggestion statuses (e.g. Reverted). */
  refreshHistory(): void {
    this.loadHistory();
  }

  /** Reload versions list and outcomes so Versions tab updates (e.g. Revert → Redo button, or after Redo). */
  refreshVersions(): void {
    this.loadVersions();
  }

  loadVersions(): void {
    if (!this.bookId || !this.chapterId) return;
    this.documentVersionService.list(this.bookId, this.chapterId, this.sceneId ?? undefined).subscribe({
      next: (list) => {
        const raw = list ?? [];
        // Sort newest → oldest so we keep the latest snapshot per suggestion when de-duping.
        raw.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const seenSuggestionIds = new Set<string>();
        const seenSuggestionKeys = new Set<string>();
        const deduped: DocumentVersionDto[] = [];

        for (const v of raw) {
          const sid = (v.suggestionId ?? '').toLowerCase();
          if (sid) {
            if (seenSuggestionIds.has(sid)) {
              continue;
            }
            seenSuggestionIds.add(sid);
            deduped.push(v);
            continue;
          }

          if (v.originalText != null && v.suggestedText != null) {
            const key = `${normalizeTextForAnalysis(v.originalText)}\u241f${normalizeTextForAnalysis(v.suggestedText)}`;
            if (seenSuggestionKeys.has(key)) {
              continue;
            }
            seenSuggestionKeys.add(key);
            deduped.push(v);
          } else {
            deduped.push(v);
          }
        }

        this.versions = deduped;
        this.cdr.detectChanges();
      },
      error: () => {
        this.versions = [];
        this.cdr.detectChanges();
      }
    });
  }

  onRevert(versionId: string): void {
    this.revertToVersion.emit(versionId);
  }


  /** Re-apply the suggestion (replace original with suggested), set outcome to Accepted, refresh versions and history. */
  onRedoVersion(v: DocumentVersionDto): void {
    const analysisId = v.analysisResultId ?? v.analysisId;
    if (!analysisId || v.originalText == null || v.suggestedText == null || !this.bookId || !this.chapterId) return;

    let dto: AnalysisSuggestionDto | null = null;
    const suggestionId = (v.suggestionId ?? '').toLowerCase();
    if (suggestionId) {
      dto = this.findSuggestionDtoById(suggestionId);
    }

    if (!dto) {
      const aidLower = analysisId.toLowerCase();
      const orig = normalizeTextForAnalysis(v.originalText);
      const sugg = normalizeTextForAnalysis(v.suggestedText);
      const analysis = this.allAnalyses.find(r => (r.id || '').toLowerCase() === aidLower);
      dto = analysis?.suggestions?.find(s =>
        normalizeTextForAnalysis(s.originalText ?? '') === orig &&
        normalizeTextForAnalysis(s.suggestedText ?? '') === sugg
      ) ?? null;
    }

    if (!dto?.id) {
      // Legacy analyses without persisted suggestions: still re-apply in the editor and refresh
      // History/Versions so the UI no longer shows this version as "reverted".
      this.applyCorrection.emit({
        text: v.suggestedText,
        originalText: v.originalText,
        analysisId,
        skipCreatingVersion: true
      });
      this.refreshHistory();
      this.refreshVersions();
      return;
    }

    // Re-apply the suggestion in the editor without creating another version.
    this.applyCorrection.emit({
      text: v.suggestedText,
      originalText: v.originalText,
      analysisId,
      skipCreatingVersion: true
    });

    dto.outcome = 'Accepted';
    const key = this.proofreadSuggestionKeyForDto(dto);
    if (key) this.suggestionKeyService.trackRecentOutcomeKey(key);

    this.analysisService
      .updateSuggestionOutcome(this.bookId, this.chapterId, dto.id, 'Accepted')
      .subscribe({
        next: () => {
          // Refresh lists so Versions/History reflect new outcome and styling.
          this.loadHistory(true);
          this.loadVersions();
        },
        error: () => {
          // Even if PATCH fails, refresh so UI reflects whatever the server currently has.
          this.refreshHistory();
          this.refreshVersions();
        }
      });
  }



  markSuggestionReverted(analysisId: string, originalText: string, suggestedText: string, suggestionId?: string | null): void {
    const { updatedSuggestionIds } = suggestionId
      ? this.suggestionKeyService.markSuggestionRevertedById(this.latestResult, this.allAnalyses, suggestionId)
      : this.suggestionKeyService.markSuggestionReverted(this.latestResult, this.allAnalyses, analysisId, originalText, suggestedText);

    this.persistRevertedOutcomes(updatedSuggestionIds);
  }

  private persistRevertedOutcomes(updatedSuggestionIds: Set<string>): void {
    if (!this.bookId || !this.chapterId || updatedSuggestionIds.size === 0) {
      this.refreshHistory();
      this.refreshVersions();
      return;
    }

    const calls = Array.from(updatedSuggestionIds).map(id =>
      this.analysisService.updateSuggestionOutcome(this.bookId!, this.chapterId!, id, 'Reverted')
    );

    forkJoin(calls).subscribe({
      next: () => {
        this.refreshHistory();
        this.refreshVersions();
      },
      error: () => {
        this.refreshHistory();
        this.refreshVersions();
      }
    });
  }


  getLineEdit(current: AnalysisResultDto) {
    return this.lineEditParser.getLineEdit(current);
  }


  private recomputeLineEditOffsets(): void {
    const result = this.lineEditParser.recomputeLineEditOffsets(this.lineEditRunSuggestions, this.documentText);
    if (result.changed) {
      this.lineEditRunSuggestions = [...result.suggestions];
      this.emitSuggestionRanges();
    }
  }

  onLineEditAccept(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    const startOffset = suggestion.startOffset;
    const endOffset = suggestion.endOffset;
    if (startOffset != null && endOffset != null) {
      this.applyCorrection.emit({
        text: suggestion.suggested,
        startOffset,
        endOffset,
        originalText: suggestion.original,
        analysisId: current.id,
        suggestionId: suggestion.id
      });
    } else {
      this.applyCorrection.emit({
        text: suggestion.suggested,
        originalText: suggestion.original,
        analysisId: current.id,
        suggestionId: suggestion.id
      });
    }
    const key = this.suggestionKeyService.lineEditSuggestionKey(current, {
      original: suggestion.original,
      suggested: suggestion.suggested
    });
    this.acceptedLineEditKeys.add(key);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    if (this.bookId && this.chapterId && current.id && suggestion.id) {
      this.applyOutcomeToSuggestionDtos(suggestion.id, 'Accepted');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, suggestion.id, 'Accepted')
        .subscribe({ error: () => {} });
    }
    this.lineEditRunSuggestions = [];
    this.hasRestoredLineEditForCurrentContext = false;
    this.emitSuggestionRanges();
  }

  onLineEditDismiss(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    const key = this.suggestionKeyService.lineEditSuggestionKey(current, {
      original: suggestion.original,
      suggested: suggestion.suggested
    });
    this.dismissedLineEditKeys.add(key);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    // Remove from the current Run tab suggestions so dismissed items disappear immediately
    this.lineEditRunSuggestions = this.lineEditRunSuggestions.filter(x => x !== suggestion);
    if (this.bookId && this.chapterId && current.id && suggestion.id) {
      this.applyOutcomeToSuggestionDtos(suggestion.id, 'Dismissed');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, suggestion.id, 'Dismissed')
        .subscribe({ error: () => {} });
    }
    this.emitSuggestionRanges();
  }

  onShowInDocument(s: AnalysisSuggestion): void {
    if (s.startOffset != null && s.endOffset != null) {
      this.showInDocument.emit({
        suggestionId: s.id,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original || undefined
      });
    } else if (s.original) {
      this.showInDocument.emit({
        suggestionId: s.id,
        originalText: s.original
      });
    }
  }

  /** Auto-select the first suggestion's range in the editor so the user immediately sees what changed. */
  private autoShowFirstSuggestion(): void {
    if (!this.proofreadSuggestions.length) return;
    const first = this.proofreadSuggestions[0];
    if (first.startOffset != null && first.endOffset != null) {
      this.showInDocument.emit({
        suggestionId: first.id,
        startOffset: first.startOffset,
        endOffset: first.endOffset,
        originalText: first.original || undefined
      });
    }
  }

  onProofreadAccept(s: AnalysisSuggestion): void {
    if (s.startOffset != null && s.endOffset != null) {
      this.applyCorrection.emit({
        text: s.suggested,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original,
        analysisId: this.latestResult?.id ?? undefined,
        suggestionId: s.id
      });
    } else {
      this.applyCorrection.emit({
        text: s.suggested,
        originalText: s.original,
        analysisId: this.latestResult?.id ?? undefined,
        suggestionId: s.id
      });
    }
    if (this.latestResult) {
      const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult, s);
      this.acceptedProofreadHistoryKeys.add(key);
      this.suggestionKeyService.trackRecentOutcomeKey(key);
      if (this.bookId && this.chapterId && this.latestResult.id && s.id) {
        this.applyOutcomeToSuggestionDtos(s.id, 'Accepted');
        this.analysisService
          .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Accepted')
          .subscribe({ error: () => {} });
      }
    }
    this.proofreadSuggestions = [];
    this.hasRestoredProofreadForCurrentContext = false;
    this.emitSuggestionRanges();
    this.cdr.detectChanges();
  }

  onProofreadDismiss(s: AnalysisSuggestion): void {
    this.proofreadSuggestions = this.proofreadSuggestions.filter(x => x !== s);
    if (this.latestResult) {
      const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult, s);
      this.dismissedProofreadHistoryKeys.add(key);
      this.suggestionKeyService.trackRecentOutcomeKey(key);
      if (this.bookId && this.chapterId && this.latestResult.id && s.id) {
        this.applyOutcomeToSuggestionDtos(s.id, 'Dismissed');
        this.analysisService
          .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Dismissed')
          .subscribe({ error: () => {} });
      }
    }
    this.emitSuggestionRanges();
    this.cdr.detectChanges();
  }

  private applyExplanationToSuggestionDtos(suggestionId: string, explanation: string): void {
    const apply = (result: AnalysisResultDto | null | undefined) => {
      const dto = result?.suggestions?.find(x => x.id === suggestionId);
      if (dto) dto.explanation = explanation;
    };
    apply(this.latestResult);
    this.allAnalyses?.forEach(r => { if (r !== this.latestResult) apply(r); });
  }

  private applyOutcomeToSuggestionDtos(
    suggestionId: string,
    outcome: 'Accepted' | 'Dismissed' | 'Reverted' | 'Superseded'
  ): void {
    this.suggestionKeyService.applyOutcomeToSuggestionDtos(
      this.latestResult, this.allAnalyses, suggestionId, outcome
    );
  }

  private findSuggestionDtoById(suggestionId: string): AnalysisSuggestionDto | null {
    return this.suggestionKeyService.findSuggestionDtoById(
      this.latestResult, this.allAnalyses, suggestionId
    );
  }

  private proofreadSuggestionKeyForDto(dto: AnalysisSuggestionDto): string | null {
    return this.suggestionKeyService.proofreadSuggestionKeyForDto(this.allAnalyses, dto);
  }

  onExplainSuggestion(s: AnalysisSuggestion): void {
    if (!s.id || !this.bookId || !this.chapterId) return;
    if (this.explainingSuggestionIds.has(s.id)) return;
    this.explainingSuggestionIds.add(s.id);
    this.cdr.detectChanges();
    this.analysisService.explainSuggestion(this.bookId, this.chapterId, s.id).subscribe({
      next: (res) => {
        s.explanation = res.explanation;
        this.applyExplanationToSuggestionDtos(s.id!, res.explanation);
        this.explainingSuggestionIds.delete(s.id!);
        this.cdr.detectChanges();
      },
      error: () => {
        this.explainingSuggestionIds.delete(s.id!);
        this.cdr.detectChanges();
      }
    });
  }

  onProofreadHistoryAccept(event: { suggestion: AnalysisSuggestion; result: AnalysisResultDto }): void {
    const { suggestion: s, result: current } = event;
    if (s.startOffset != null && s.endOffset != null) {
      this.applyCorrection.emit({
        text: s.suggested,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original,
        analysisId: current.id
      });
    } else {
      this.applyCorrection.emit({ text: s.suggested, originalText: s.original, analysisId: current.id });
    }
    const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
    this.acceptedProofreadHistoryKeys.add(key);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    if (this.bookId && this.chapterId && current.id && s.id) {
      this.applyOutcomeToSuggestionDtos(s.id, 'Accepted');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Accepted')
        .subscribe({ error: () => {} });
    }
    this.proofreadSuggestions = [];
    this.hasRestoredProofreadForCurrentContext = false;
    this.emitSuggestionRanges();
  }

  onProofreadHistoryDismiss(event: { suggestion: AnalysisSuggestion; result: AnalysisResultDto }): void {
    const { suggestion: s, result: current } = event;
    const key = this.suggestionKeyService.proofreadSuggestionKey(current, s);
    this.dismissedProofreadHistoryKeys.add(key);
    this.suggestionKeyService.trackRecentOutcomeKey(key);
    if (this.bookId && this.chapterId && current.id && s.id) {
      this.applyOutcomeToSuggestionDtos(s.id, 'Dismissed');
      this.analysisService
        .updateSuggestionOutcome(this.bookId, this.chapterId, s.id, 'Dismissed')
        .subscribe({ error: () => {} });
    }
  }

  /**
   * Emit current suggestion ranges so the editor can show highlights.
   * For Proofread, uses proofreadSuggestions; for Line Edit, uses lineEditRunSuggestions.
   * When highlightSuggestionsInDocument is false, emits [].
   */
  private emitSuggestionRanges(): void {
    if (!this.highlightSuggestionsInDocument) {
      this.suggestionRangesChange.emit([]);
      return;
    }
    const type = this.latestResult?.analysisType || this.latestResult?.type;
    let source: AnalysisSuggestion[] = [];
    if (type === 'Proofread') {
      source = this.proofreadSuggestions;
    } else if (type === 'LineEdit') {
      source = this.lineEditRunSuggestions;
    } else {
      this.suggestionRangesChange.emit([]);
      return;
    }
    const ranges = source
      .filter(s => s.startOffset != null && s.endOffset != null)
      .map(s => ({
        suggestionId: s.id,
        startOffset: s.startOffset!,
        endOffset: s.endOffset!
      }));
    this.suggestionRangesChange.emit(ranges);
  }

  /** Called when the user toggles "Highlight suggestion words in document"; re-emit so editor updates. */
  onHighlightOptionChange(): void {
    this.emitSuggestionRanges();
  }


  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['chapterId'] || changes['sceneId']) {
      // Clear run state so we don't show another chapter's suggestions; history load will restore if available
      this.latestResult = null;
      this.proofreadSuggestions = [];
      this.proofreadSuggestionsUnreliable = false;
      this.lineEditRunSuggestions = [];
      this.history = [];
      this.allAnalyses = [];
      this.activeAnalyses = [];
      this.dismissedProofreadHistoryKeys.clear();
      this.acceptedProofreadHistoryKeys.clear();
      this.dismissedLineEditKeys.clear();
      this.acceptedLineEditKeys.clear();
      this.streamingText = '';
      this.hasRestoredProofreadForCurrentContext = false;
      this.hasRestoredLineEditForCurrentContext = false;
      this.explainingSuggestionIds.clear();
      // Clear versions so we don't show versions from another chapter/scene.
      this.versions = [];
      // Reset history filter so we load all types for the new chapter and can restore Proofread state
      this.historyFilterType = null;
      if (this.bookId && this.chapterId) {
        this.loadTemplates();
        this.loadHistory();
        // Eagerly load versions for the new context so Versions tab and
        // version-related helpers (isVersionReverted / isVersionLocked)
        // have up-to-date data regardless of the currently active sub-tab.
        this.loadVersions();
      }
    }
    if (changes['bookLanguage'] && this.bookId && this.chapterId) {
      this.loadTemplates();
    }
    if (changes['documentText']) {
      // Only restore when we have no suggestions yet and document text is for the current chapter/scene,
      // and we haven't already restored for this context (avoids re-diffing on every edit).
      if (
        !this.hasRestoredProofreadForCurrentContext &&
        this.proofreadSuggestions.length === 0 &&
        this.documentMatchesCurrentContext &&
        this.documentText
      ) {
        this.restoreProofreadStateFromLatestResult();
      }

      // For Line Edit, when we have a latestResult and the document now matches the current context,
      // restore run-tab suggestions once (so offsets are computed against the correct document).
      if (
        this.latestResult &&
        (this.latestResult.analysisType || this.latestResult.type) === 'LineEdit' &&
        !this.hasRestoredLineEditForCurrentContext &&
        this.lineEditRunSuggestions.length === 0 &&
        this.documentMatchesCurrentContext &&
        this.documentText
      ) {
        this.restoreLineEditStateFromResult(this.latestResult);
        this.hasRestoredLineEditForCurrentContext = true;
      }

      // Offset-recompute: when documentText becomes available and existing Line Edit
      // suggestions have null offsets (e.g. from salvaged JSON parsed before the editor
      // loaded), re-run offset mapping so "Show" can use precise navigation.
      if (
        this.documentText &&
        this.lineEditRunSuggestions.length > 0 &&
        this.lineEditRunSuggestions.some(s => s.startOffset == null || s.endOffset == null)
      ) {
        this.recomputeLineEditOffsets();
      }
    }
  }

  /**
   * When we have a Proofread latestResult and document text for the current chapter,
   * restore proofread suggestions and emit ranges so highlights show.
   * Prefers server-side suggestions (which carry id, explanation, outcome) and falls back
   * to client-side proofreadDiff for legacy/streaming runs that lack persisted suggestions.
   * Filters out suggestions that are already accepted or dismissed so they don't reappear on Run tab.
   */
  private restoreProofreadStateFromLatestResult(): void {
    if (!this.latestResult) return;
    const type = this.latestResult.analysisType || this.latestResult.type;
    if (type !== 'Proofread') return;

    let all: AnalysisSuggestion[];
    if (this.latestResult.suggestions && this.latestResult.suggestions.length) {
      all = this.mapDtoSuggestions(this.latestResult);
    } else if (this.documentText && this.latestResult.resultText) {
      all = proofreadDiff(this.documentText, this.latestResult.resultText);
    } else {
      return;
    }

    this.proofreadSuggestions = all.filter(s => {
      const outcome = (s.outcome || '').toLowerCase();
      // Treat Reverted as actionable again on the Run tab:
      // only hide Accepted, Dismissed, and Superseded.
      if (outcome === 'accepted' || outcome === 'dismissed' || outcome === 'superseded') return false;
      const key = this.suggestionKeyService.proofreadSuggestionKey(this.latestResult!, s);
      return !this.acceptedProofreadHistoryKeys.has(key) && !this.dismissedProofreadHistoryKeys.has(key);
    });
    this.hasRestoredProofreadForCurrentContext = true;
    this.emitSuggestionRanges();
  }

  /**
   * Restore Line Edit suggestions for the Run tab from the given result.
   * Prefers server-side suggestions (including outcome), and falls back to structuredResult
   * when no suggestions DTOs exist. Filters out suggestions that are already accepted,
   * dismissed, reverted, or superseded so they don't reappear on the Run tab.
   */
  private restoreLineEditStateFromResult(result: AnalysisResultDto): void {
    if ((result.analysisType || result.type) !== 'LineEdit') return;

    const mapped = this.mapDtoSuggestions(result);
    const base: AnalysisSuggestion[] = mapped.length
      ? mapped
      : (() => {
          const lineEdit = this.getLineEdit(result);
          return lineEdit ? this.lineEditParser.toLineEditSuggestionsWithOffsets(lineEdit.suggestions, this.documentText) : [];
        })();

    this.lineEditRunSuggestions = base.filter(s => {
      const outcome = (s.outcome || '').toLowerCase();
      if (outcome === 'accepted' || outcome === 'dismissed' || outcome === 'superseded') {
        return false;
      }
      const key = this.suggestionKeyService.lineEditSuggestionKey(result, {
        original: s.original,
        suggested: s.suggested
      });
      return !this.acceptedLineEditKeys.has(key) && !this.dismissedLineEditKeys.has(key);
    });
    this.hasRestoredLineEditForCurrentContext = true;
    this.emitSuggestionRanges();
  }

  /** True when documentText is known to be for the current chapter/scene (so safe to restore from latestResult). */
  private get documentMatchesCurrentContext(): boolean {
    if (this.documentChapterId !== this.chapterId) return false;
    return (this.documentSceneId ?? null) === (this.sceneId ?? null);
  }

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  private loadTemplates(): void {
    this.analysisService.getTemplates().subscribe({
      next: (items) => {
        this.templates = (items ?? []).filter(t => !t.language || t.language === this.language);
      },
      error: () => {
        this.templates = [];
      }
    });
  }

  private loadHistory(mergeWithExisting = false): void {
    if (!this.bookId || !this.chapterId) return;
    const loadingChapterId = this.chapterId;
    const loadingSceneId = this.sceneId ?? undefined;
    this.analysisService
      // Always load the full unfiltered history for this chapter/scene; historyFilterType
      // is applied client-side so allAnalyses remains a complete dataset for other logic.
      .getHistory(this.bookId, this.chapterId, undefined, this.sceneId ?? undefined)
      .subscribe({
      next: (items) => {
        // Ignore if user switched chapter/scene before this response
        if (this.chapterId !== loadingChapterId || (this.sceneId ?? undefined) !== loadingSceneId) return;
        const fromApi = items ?? [];
        // allAnalyses should always reflect the latest full server state for this chapter/scene
        // (all types, Active + Archived). Replace it on each load to avoid stale or type-filtered data.
        const shouldMerge = mergeWithExisting;
        this.allAnalyses = fromApi;
        // Use the current historyFilterType at response time so we don't override
        // a user filter change that happened while this request was in flight.
        this.rebuildHistoryFromAllAnalyses();
        // Full reload: clear outcome key sets so displayed state is exactly what the API returned (avoids stale Reverted/Accepted and duplicate display).
        // When we're merely changing the history filter or merging async results, keep in-memory
        // Accepted/Dismissed/Reverted sets so the current session's state is preserved.
        if (!shouldMerge) {
          this.acceptedProofreadHistoryKeys.clear();
          this.dismissedProofreadHistoryKeys.clear();
          this.acceptedLineEditKeys.clear();
          this.dismissedLineEditKeys.clear();
        }
        // Prepend streaming run (no id) so it appears in History and Accepted/Dismissed keys match,
        // but only when its analysis type matches the current history filter (or when showing All).
        if (this.latestResult && !this.latestResult.id) {
          const latestType = this.latestResult.analysisType || this.latestResult.type;
          if (!this.historyFilterType || latestType === this.historyFilterType) {
            this.history = [this.latestResult, ...this.history];
          }
        }
        // Decide which result should be treated as "latest" for the Run tab:
        // - If we already have a synthetic streaming latestResult for this type, keep it for this pass.
        // - Otherwise, prefer the most recent analysis whose type matches the currently selected type,
        //   so the Run tab never shows results for a different analysis type than the picker.
        let latestCandidate: AnalysisResultDto | null = null;
        if (this.latestResult && !this.latestResult.id && (this.latestResult.analysisType || this.latestResult.type) === this.selectedAnalysisType) {
          latestCandidate = this.latestResult;
        } else {
          const activeForType = this.activeAnalyses.filter(
            r => (r.analysisType || r.type) === this.selectedAnalysisType
          );
          const allForType = this.allAnalyses.filter(
            r => (r.analysisType || r.type) === this.selectedAnalysisType
          );
          const candidates = activeForType.length ? activeForType : allForType;
          candidates.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          latestCandidate = candidates[0] ?? null;
        }
        if (latestCandidate) {
          let shouldUpdateLatest = false;
          if (!this.latestResult) {
            shouldUpdateLatest = true;
          } else {
            const existingTime = new Date(this.latestResult.createdAt).getTime();
            const candidateTime = new Date(latestCandidate.createdAt).getTime();
            if (candidateTime >= existingTime) {
              shouldUpdateLatest = true;
            }
          }
          if (shouldUpdateLatest) {
            this.latestResult = latestCandidate;
            const latestType = this.latestResult.analysisType || this.latestResult.type;
            if (this.documentMatchesCurrentContext && this.documentText) {
              // Avoid clobbering in-progress Run tab work: when the user is on the Run tab,
              // only auto-restore if we don't already have suggestions for that type.
              if (
                latestType === 'Proofread' &&
                (this.activeSubTab !== 'run' || this.proofreadSuggestions.length === 0)
              ) {
                this.restoreProofreadStateFromLatestResult();
              } else if (
                latestType === 'LineEdit' &&
                (this.activeSubTab !== 'run' || this.lineEditRunSuggestions.length === 0)
              ) {
                this.restoreLineEditStateFromResult(this.latestResult);
              }
            }
          }
        }
        this.cdr.detectChanges();
      },
      error: () => {
        // swallow for now; panel stays empty
      }
    });
  }

  /** Recompute activeAnalyses and history from the current allAnalyses, honoring the given history filter. */
  private rebuildHistoryFromAllAnalyses(filterType: string | null = this.historyFilterType): void {
    // Always work from a createdAt-descending view so History ordering stays stable
    // even if the API response order changes or we prepend results locally.
    const sorted = [...this.allAnalyses].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    // Cache Active analyses (by status) for re-analysis lifecycle checks.
    this.activeAnalyses = sorted.filter(r => (r.status || '').toLowerCase() === 'active');
    // History should reflect all runs (Active + non-Active) in newest-first order.
    const base = sorted;
    this.history = filterType
      ? base.filter(r => (r.analysisType || r.type) === filterType)
      : base.slice();
  }


  runAnalysis(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunning) return;
    const pending = this.getPendingSuggestionCountForActive();
    const scopeLabel = this.sceneId ? 'scene' : 'chapter';
    if (!this.orchestrationService.confirmReanalysisIfPendingSuggestions(pending, scopeLabel)) return;

    this.prepareForRun();
    const ctx = this.buildRunContext();
    this.runSubscription?.unsubscribe();
    this.runSubscription = this.orchestrationService
      .runAnalysisAfterSave(ctx, this.saveBeforeRun)
      .subscribe({
        next: (event) => this.handleRunEvent(event),
        error: () => this.onRunFinished(),
        complete: () => this.onRunFinished()
      });
  }

  runStreaming(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunning) return;
    const pending = this.getPendingSuggestionCountForActive();
    const scopeLabel = this.sceneId ? 'scene' : 'chapter';
    if (!this.orchestrationService.confirmReanalysisIfPendingSuggestions(pending, scopeLabel)) return;

    const ctx = this.buildRunContext();
    this.prepareForRun();
    this.analysisStatus.emit(
      this.orchestrationService.emitInitialStatusForRun(ctx.selectedAnalysisType, ctx.documentText, true)
    );

    const startStreaming = () => {
      this.runSubscription?.unsubscribe();
      this.runSubscription = this.orchestrationService.doRunStreaming(ctx).subscribe({
        next: (event) => this.handleRunEvent(event),
        error: () => this.onRunFinished(),
        complete: () => this.onRunFinished()
      });
    };

    if (this.saveBeforeRun) {
      this.saveBeforeRun()
        .then(startStreaming)
        .catch(() => {
          this.isRunning = false;
          this.analysisCompleted.emit();
        });
    } else {
      startStreaming();
    }
  }

  private prepareForRun(): void {
    this.isRunning = true;
    this.runError = null;
    this.streamingText = '';
    this.proofreadSuggestions = [];
    this.proofreadSuggestionsUnreliable = false;
    this.lineEditRunSuggestions = [];
    this.hasRestoredLineEditForCurrentContext = false;
    this.emitSuggestionRanges();
    this.analysisStarted.emit();
    this.runStartedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.lastRunDurationLabel = null;
    this.currentProgressPercent = null;
    this.analysisProgressPercent.emit(null);
  }

  private buildRunContext(): AnalysisRunContext {
    return {
      bookId: this.bookId!,
      chapterId: this.chapterId!,
      sceneId: this.sceneId,
      selectedAnalysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || null) : null,
      language: this.language,
      documentText: this.documentText
    };
  }

  private handleRunEvent(event: AnalysisRunEvent): void {
    switch (event.kind) {
      case 'status':
        this.analysisStatus.emit(event.message);
        break;
      case 'progress':
        this.analysisStatus.emit(event.message);
        if (event.percent != null) {
          this.currentProgressPercent = event.percent;
          this.analysisProgressPercent.emit(event.percent);
        }
        if (event.rawStatus === 'failed') {
          this.isRunning = false;
          this.runError = `${this.selectedAnalysisType || 'Analysis'} failed – see error message.`;
          this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
          this.analysisCompleted.emit();
        } else if (event.rawStatus === 'canceled') {
          this.isRunning = false;
          this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
          this.analysisCompleted.emit();
        }
        break;
      case 'sync-result':
      case 'job-result':
        this.onRunResultReceived(event.result);
        break;
      case 'job-started':
        break;
      case 'streaming-token':
        this.streamingText += event.token;
        break;
      case 'streaming-complete':
        this.onStreamingCompleted(event.latestResult);
        break;
      case 'error':
        this.isRunning = false;
        this.runError = event.message;
        this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
        this.analysisCompleted.emit();
        break;
    }
    this.cdr.detectChanges();
  }

  private onRunResultReceived(result: AnalysisResultDto): void {
    this.isRunning = false;
    this.runError = null;
    this.allAnalyses = [result, ...this.allAnalyses];
    this.rebuildHistoryFromAllAnalyses();
    this.latestResult = result;
    this.activeSubTab = 'run';
    this.applyProofreadOrLineEditResultToRunTab(result);
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
    this.analysisCompleted.emit();
  }

  private onStreamingCompleted(latestResult: AnalysisResultDto): void {
    this.isRunning = false;
    this.latestResult = latestResult;
    this.activeSubTab = 'run';
    if (this.selectedAnalysisType === 'Proofread' && this.documentText != null && this.streamingText) {
      this.proofreadOriginalDocumentByRunKey.set(
        this.suggestionKeyService.proofreadRunKeyForResult(latestResult),
        this.documentText
      );
      this.proofreadSuggestions = proofreadDiff(this.documentText, this.streamingText);
      this.proofreadSuggestionsUnreliable = false;
      this.hasRestoredProofreadForCurrentContext = true;
      this.emitSuggestionRanges();
      this.autoShowFirstSuggestion();
    }
    this.loadHistory(true);
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
    this.analysisCompleted.emit();
  }

  private onRunFinished(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.lastRunDurationLabel = this.orchestrationService.formatRunDuration(this.runStartedAt);
    this.analysisCompleted.emit();
    this.cdr.detectChanges();
  }

  private applyProofreadOrLineEditResultToRunTab(result: AnalysisResultDto): void {
    const type = result.analysisType || result.type;
    if (type === 'Proofread') {
      if (this.documentText != null) {
        this.proofreadOriginalDocumentByRunKey.set(
          this.suggestionKeyService.proofreadRunKeyForResult(result),
          this.documentText
        );
      }
      let all: AnalysisSuggestion[] = [];
      let mapped = this.mapDtoSuggestions(result);
      if (!mapped.length && (result.suggestions?.length ?? 0) > 0) {
        mapped = this.mapDtoSuggestions(result, true, false);
      }
      if (mapped.length) {
        all = mapped;
      } else if (this.documentText && result.resultText) {
        all = proofreadDiff(this.documentText, result.resultText);
      }
      this.proofreadSuggestions = all;
      this.proofreadSuggestionsUnreliable = false;
      this.hasRestoredProofreadForCurrentContext = true;
      this.emitSuggestionRanges();
      this.autoShowFirstSuggestion();
    } else if (type === 'LineEdit') {
      this.restoreLineEditStateFromResult(result);
    }
  }

  /** Count pending suggestions (no outcome) on Active analyses matching the current selected type.
   * Uses mapDtoSuggestions so the pending count matches what the user actually sees in the UI. */
  private getPendingSuggestionCountForActive(): number {
    if (!this.activeAnalyses?.length) return 0;
    const type = this.selectedAnalysisType;
    let total = 0;

    for (const analysis of this.activeAnalyses) {
      const analysisType = analysis.analysisType || analysis.type;
      if (analysisType !== type) continue;
      // For pending-count calculations, keep all suggestions (no heuristic length-based filtering).
      const suggestions = this.mapDtoSuggestions(analysis, false, false);
      total += suggestions.filter(s => {
        const outcome = (s.outcome || '').toLowerCase();
        return !outcome || outcome === 'pending';
      }).length;
    }

    return total;
  }

  saveAsTemplate(): void {
    const trimmed = (this.prompt || '').trim();
    if (!trimmed) return;

    const name = prompt('Template name (for re-use later):', '')?.trim();
    if (!name) return;

    const templateText = `${trimmed}\n\n---\nטקסט הפרק:\n{chapter_text}`;

    this.analysisService.createTemplate({
      name,
      type: this.selectedAnalysisType === 'Custom' ? 'Custom' : this.selectedAnalysisType,
      templateText,
      language: this.language
    }).subscribe({
      next: (created) => {
        this.templates = [created, ...this.templates];
      },
      error: () => {}
    });
  }
}

