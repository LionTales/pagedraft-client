import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AnalysisResultDto, AnalysisSuggestionDto } from '../../core/models/analysis';
import { DocumentVersionDto } from '../../core/services/document-version.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';
import { normalizeTextForAnalysis } from '../../core/utils/normalize-text-for-analysis';

@Component({
  selector: 'app-analysis-versions-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analysis-versions-tab.component.html',
  styleUrl: './analysis-versions-tab.component.scss'
})
export class AnalysisVersionsTabComponent {
  @Input() versions: DocumentVersionDto[] = [];
  @Input() bookId: string | null = null;
  @Input() chapterId: string | null = null;
  @Input() sceneId: string | null = null;
  @Input() allAnalyses: AnalysisResultDto[] = [];
  @Input() latestResult: AnalysisResultDto | null = null;

  @Output() revert = new EventEmitter<string>();
  @Output() redoVersion = new EventEmitter<DocumentVersionDto>();

  constructor(private suggestionKeyService: SuggestionKeyService) {}

  isVersionReverted(v: DocumentVersionDto): boolean {
    const suggestionId = (v.suggestionId ?? '').toLowerCase();
    if (suggestionId) {
      const dto = this.suggestionKeyService.findSuggestionDtoById(
        this.latestResult, this.allAnalyses, suggestionId
      );
      if (dto) {
        return (dto.outcome || '').toLowerCase() === 'reverted';
      }
    }

    const aid = (v.analysisResultId ?? v.analysisId) ?? '';
    if (!aid || v.originalText == null || v.suggestedText == null) return false;
    const orig = normalizeTextForAnalysis(v.originalText);
    const sugg = normalizeTextForAnalysis(v.suggestedText);
    const aidLower = aid.toLowerCase();
    const analysis = this.allAnalyses.find(r => (r.id || '').toLowerCase() === aidLower);
    if (!analysis?.suggestions?.length) return false;
    const match = analysis.suggestions.find(s =>
      normalizeTextForAnalysis(s.originalText ?? '') === orig &&
      normalizeTextForAnalysis(s.suggestedText ?? '') === sugg &&
      (s.outcome || '').toLowerCase() === 'reverted'
    );
    return !!match;
  }

  isVersionLocked(v: DocumentVersionDto): boolean {
    const status = (v.analysisStatus || '').toLowerCase();
    return status === 'archived';
  }

  versionLabelOriginal(label: string | null | undefined): string | null {
    if (!label || !label.includes(' → Suggested: ')) return null;
    const prefix = 'Original: ';
    const idx = label.indexOf(prefix);
    if (idx === -1) return null;
    const start = idx + prefix.length;
    const end = label.indexOf(' → Suggested: ', start);
    return end === -1 ? null : label.slice(start, end).trim();
  }

  versionLabelSuggested(label: string | null | undefined): string | null {
    if (!label) return null;
    const sep = ' → Suggested: ';
    const idx = label.indexOf(sep);
    return idx === -1 ? null : label.slice(idx + sep.length).trim();
  }
}
