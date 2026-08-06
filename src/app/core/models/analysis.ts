/**
 * An analysis result as the API returns it.
 *
 * DELIBERATELY CARRIES NO MODEL IDENTITY. This used to have a `modelName` (provider:model) that the run tab
 * and the history tab rendered beside the result heading, so a finished run displayed e.g.
 * "ספרותי (Ollama:gemma4:12b)". Which model ran is internal IP and changes over time, so the server stopped
 * sending it. Do not re-add it here: the field no longer exists on the wire, and AiTierResultSurface-
 * DeidentificationTests (API) fails if it comes back.
 */
export interface AnalysisResultDto {
  id: string;
  chapterId: string;
  jobId?: string | null;
  type: string;
  resultText: string;
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
  /**
   * INFORMATIONAL only (character-register-editing d1 section 4): this result was produced BEFORE the
   * book's character register was last changed, so the character facts the model was given may since
   * have been corrected. Never means the result is wrong, and nothing on the server re-runs, archives
   * or invalidates anything because of it.
   *
   * Server-computed at READ time (`register.UpdatedAt` vs `result.CreatedAt`) and gated to the analysis
   * types that actually pull the register into their prompt, so any other type reports false. It also
   * reports false on a FRESHLY produced result (`POST .../analyze`), which is correct: the run just saw
   * the current register. It becomes true only on a read-back route, i.e. `getHistory` and `getByJob`.
   */
  characterRegisterStale?: boolean;
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

/**
 * Shared he/en label maps for analysis types. Used by every surface that shows a
 * human-readable analysis-type label (analysis-panel, analysis-run-tab,
 * analysis-history-tab) so all three stay in sync. The canonical Hebrew values are
 * the SHORT forms ('לשוני', 'ספרותי') used on picker buttons.
 */
export const ANALYSIS_TYPE_LABELS: {
  he: Record<string, string>;
  en: Record<string, string>;
} = {
  he: {
    Proofread: 'הגהה',
    LineEdit: 'עריכת שורה',
    LinguisticAnalysis: 'לשוני',
    LiteraryAnalysis: 'ספרותי',
    Summarization: 'סיכום',
    Custom: 'מותאם',
  },
  en: {
    Proofread: 'Proofread',
    LineEdit: 'Line Edit',
    LinguisticAnalysis: 'Linguistic',
    LiteraryAnalysis: 'Literary',
    Summarization: 'Summarize',
    Custom: 'Custom',
  },
};

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
  /**
   * Whole-book REVIEW build-shape (wb4-c06). Populated ONLY on a BookReview build's TERMINAL progress poll —
   * the LIVE build-completion channel for the window/continuity/failed-window provenance the persisted status
   * probe reports as 0/false. Undefined/null on every other progress route and before a review build reaches
   * its terminal. The review status row captures these at the terminal so the "N windows[, continuity pass]"
   * detail + the "N windows failed" partial warning survive the post-build status refresh (which zeroes them).
   */
  bookReviewWindowCount?: number | null;
  bookReviewRanContinuityReduce?: boolean | null;
  bookReviewFailedWindows?: number | null;
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

