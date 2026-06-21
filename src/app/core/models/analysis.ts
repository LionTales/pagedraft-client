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
  /** True when the Proofread run produced no changes - including a genuinely-clean result. No longer drives the Run-tab warning by itself; use proofreadResultUnreliable for that. */
  proofreadNoChangesHint?: boolean;
  /** True when the proofread result is untrustworthy (model returned empty or content unrelated to input). Drives the Run-tab "unreliable result" warning; clean text leaves this false. */
  proofreadResultUnreliable?: boolean;
  /** Active/Archived status of this analysis result. */
  status?: string | null;
  /** Server-side suggestions for this analysis run (Proofread and Line Edit). */
  suggestions?: AnalysisSuggestionDto[] | null;
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

/** Unified suggestion model used in the UI for Proofread and Line Edit. */
export interface AnalysisSuggestion {
  id?: string;
  startOffset?: number | null;
  endOffset?: number | null;
  original: string;
  suggested: string;
  reason?: string;
  category?: string;
  explanation?: string;
  outcome?: string | null;
  contextBefore?: string;
  contextAfter?: string;
  stale?: boolean;
}

/**
 * True when a suggestion is a linguistic *consistency* issue (register / tense / POV shift),
 * identified by its `category` starting with `consistency-`. Used as the single discriminator that
 * keeps the three suggestion families (proofread / line-edit / consistency) disjoint:
 * line-edit's own `consistency` category is an EXACT match (no trailing `-`), so it is NOT a
 * consistency issue under this predicate and the families never double-count.
 */
export function isConsistencySuggestion(s: { category?: string | null } | null | undefined): boolean {
  return (s?.category ?? '').toLowerCase().startsWith('consistency-');
}

/** Server-side suggestion DTO returned from the backend. */
export interface AnalysisSuggestionDto {
  id: string;
  analysisResultId: string;
  originalText: string;
  suggestedText: string;
  startOffset: number;
  endOffset: number;
  reason?: string | null;
  category?: string | null;
  explanation?: string | null;
  outcome?: string | null;
  orderIndex: number;
  contextBefore?: string | null;
  contextAfter?: string | null;
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
  completedChunks: number;
  message: string;
  estimatedCompletionPercent: number;
}

export interface StartAnalysisJobResponse {
  jobId: string;
  analysisType: string;
  scope: string;
}

/** Server config for when to use chunked (analysis-jobs) flow; matches API GET /api/config/analysis-chunk-thresholds. */
export interface AnalysisChunkThresholdsDto {
  proofreadChunkTargetWords: number;
  lineEditChunkTargetWords: number;
}

