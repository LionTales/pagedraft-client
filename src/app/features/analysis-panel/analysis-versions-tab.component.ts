import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AnalysisResultDto, AnalysisSuggestionDto } from '../../core/models/analysis';
import { DocumentVersionDto } from '../../core/services/document-version.service';
import { SuggestionKeyService } from '../../core/services/suggestion-key.service';
import { normalizeTextForAnalysis } from '../../core/utils/normalize-text-for-analysis';
import { formatRelativeTime } from '../../core/utils/relative-time';

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
  /** Book language (e.g. 'he', 'en'). Drives the localized chrome; Hebrew default. */
  @Input() bookLanguage: string | null = null;
  @Input() allAnalyses: AnalysisResultDto[] = [];
  @Input() latestResult: AnalysisResultDto | null = null;

  @Output() revert = new EventEmitter<string>();
  @Output() redoVersion = new EventEmitter<DocumentVersionDto>();

  constructor(private suggestionKeyService: SuggestionKeyService) {}

  /** Book-scoped chrome language: Hebrew default, English only for an English book. */
  get lang(): 'he' | 'en' {
    return (this.bookLanguage?.trim().toLowerCase() || 'he').startsWith('en') ? 'en' : 'he';
  }

  /** Logical direction for the chrome; follows the book language so en books render ltr. */
  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'en' ? 'ltr' : 'rtl';
  }

  /** Localized Versions-tab chrome (he default, en fallback). Keeps he/en parity. */
  label(key: string): string {
    const he: Record<string, string> = {
      selectChapter: 'בחרו פרק כדי לראות גרסאות.',
      hint: 'כל אישור או שמירה יוצרים גרסה. שחזרו כדי להחזיר את המסמך למצב זה.',
      original: 'מקור:',
      suggested: 'הצעה:',
      redo: 'החל מחדש את ההצעה',
      revert: 'שחזר',
      revertLockedTitle: 'לא ניתן לשחזר - הורץ ניתוח חדש על הטקסט המעודכן',
      noVersionsScene: 'אין עדיין גרסאות לסצנה זו. אשרו הצעה או שמרו כדי ליצור אחת.',
      noVersionsChapter: 'אין עדיין גרסאות לפרק זה. אשרו הצעה או שמרו כדי ליצור אחת.',
    };
    const en: Record<string, string> = {
      selectChapter: 'Select a chapter to see versions.',
      hint: 'Each accept or save creates a version. Revert to restore the document to that state.',
      original: 'Original:',
      suggested: 'Suggested:',
      redo: 'Redo suggestion',
      revert: 'Revert',
      revertLockedTitle: 'Cannot revert - a newer analysis was run on the updated text',
      noVersionsScene: 'No versions yet for this scene. Accept a suggestion or save to create one.',
      noVersionsChapter: 'No versions yet for this chapter. Accept a suggestion or save to create one.',
    };
    const map = this.lang === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Timezone-aware relative time for a version's createdAt (no raw | date). Follows the book language. */
  versionTime(iso: string | null | undefined): string {
    return formatRelativeTime(iso, this.lang);
  }

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
