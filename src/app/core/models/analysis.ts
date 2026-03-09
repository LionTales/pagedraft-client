export interface AnalysisResultDto {
  id: string;
  chapterId: string;
  jobId?: string | null;
  type: string;
  resultText: string;
  modelName: string;
  createdAt: string;
  structuredResult?: string | null;
  scope?: string | null;
  analysisType?: string | null;
  sceneId?: string | null;
  bookId?: string | null;
  language?: string | null;
  /** True when API detected Proofread result nearly identical to input (possible length limit). */
  proofreadNoChangesHint?: boolean;
  /** When loading history (GET analyses), contains Accepted/Dismissed per suggestion. */
  suggestionOutcomes?: SuggestionOutcomeDto[] | null;
}

export interface RunAnalysisRequest {
  templateId?: string | null;
  customPrompt?: string | null;
  stream?: boolean;
  /** When using type picker: Proofread, LineEdit, LinguisticAnalysis, LiteraryAnalysis, Summarization, Custom */
  analysisType?: string | null;
  language?: string | null;
}

/** Analysis types for the type picker (matches API AnalysisType enum). */
export const ANALYSIS_TYPES = [
  { value: 'Proofread', label: 'Proofread' },
  { value: 'LineEdit', label: 'Line Edit' },
  { value: 'LinguisticAnalysis', label: 'Linguistic' },
  { value: 'LiteraryAnalysis', label: 'Literary' },
  { value: 'Summarization', label: 'Summarize' },
  { value: 'Custom', label: 'Custom' }
] as const;

export interface PromptTemplateDto {
  id: string;
  name: string;
  type: string;
  templateText: string;
  isBuiltIn: boolean;
  language: string;
}

/** Unified suggestion model for Proofread (from diff) and Line Edit (from structuredResult). */
export interface AnalysisSuggestion {
  startOffset?: number;
  endOffset?: number;
  original: string;
  suggested: string;
  reason?: string;
  category?: string;
}

/** One persisted suggestion outcome (Accepted/Dismissed) for restoring History tab state. */
export interface SuggestionOutcomeDto {
  analysisResultId: string;
  originalText: string;
  suggestedText: string;
  outcome: string;
}

export interface AnalysisProgressDto {
  jobId: string;
  analysisType: string;
  scope: string;
  bookId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  status: string;
  currentChunk: number;
  totalChunks: number;
  message: string;
  estimatedCompletionPercent: number;
}

export interface StartAnalysisJobResponse {
  jobId: string;
  analysisType: string;
  scope: string;
}

