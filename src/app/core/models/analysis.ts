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

/**
 * Analysis types for the type picker.
 *
 * `value` IS THE WIRE VALUE (the API's `AnalysisType` enum) and may never be renamed here: it is what
 * `POST .../analyze` carries, what every persisted `AnalysisResult` row holds, and what the repair-config
 * and tier-routing keys are looked up by. `label` is a DISPLAY string and nothing else - see the Wave 3 /
 * w6 note on {@link ANALYSIS_TYPE_LABELS} for the one that changed.
 */
export const ANALYSIS_TYPES = [
  { value: 'Proofread', label: 'Proofread' },
  { value: 'LineEdit', label: 'Line Edit' },
  { value: 'LinguisticAnalysis', label: 'Linguistic' },
  { value: 'LiteraryAnalysis', label: 'Literary' },
  { value: 'Summarization', label: 'Chapter recap' },
  { value: 'Custom', label: 'Custom' }
] as const;

/**
 * Shared he/en label maps for analysis types. Used by every surface that shows a
 * human-readable analysis-type label (analysis-panel, analysis-run-tab,
 * analysis-history-tab) so all three stay in sync. The canonical Hebrew values are
 * the SHORT forms ('לשוני', 'ספרותי') used on picker buttons.
 *
 * ── Wave 3 / w6 (Q9-C): `Summarization` IS DISPLAYED AS "Chapter recap" / "תמצית פרק" ──────────────
 * The pass used to be labelled "Summarize" / "סיכום", which collided head-on with the book-level build
 * this wave settled as "Book briefs" / "תקצירי ספר" - and in Hebrew it collided twice, because the
 * legacy name of that same book-level build is "סיכום הספר". The guides burned two sections and an FAQ
 * entry keeping the two apart and the confusion survived, which is why Q9 chose to rename rather than
 * only annotate.
 *
 * THE NEW HEBREW AVOIDS BOTH COLLIDING WORDS. "תמצית פרק" shares no root with "תקציר" (ק.צ.ר) and is
 * not "סיכום" (ס.כ.ם); it also carries its own scope word, פרק, so the label states what it is scoped
 * to. DRAFT Hebrew, gated on the w8 native-speaker sweep like every other string this wave introduced.
 *
 * THE KEYS ARE WIRE VALUES AND DID NOT MOVE. `Summarization` is still what the client sends, what the
 * server persists and what a history row read back from the database carries, so an older result renders
 * under the new label with no migration and no dual-read. Renaming a key here would break every one of
 * those at once; this map is a display mapping and is the correct place to absorb a label change.
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
    // DRAFT he - w8 native sweep. Was 'סיכום'; see the collision note above.
    Summarization: 'תמצית פרק',
    Custom: 'מותאם',
  },
  en: {
    Proofread: 'Proofread',
    LineEdit: 'Line Edit',
    LinguisticAnalysis: 'Linguistic',
    LiteraryAnalysis: 'Literary',
    Summarization: 'Chapter recap',
    Custom: 'Custom',
  },
};

/**
 * Wave 3 / w6 (Q9-C's second half): THE RELATIONSHIP STATEMENT, ON THE SURFACE.
 *
 * The decision was rename AND state on the surface what the pass does and does not feed, because the
 * guides already tried explaining it in three places and the confusion survived. The statement is
 * therefore rendered in the product, in TWO places, and it lives here so those two cannot drift:
 *
 *  - {@link pass}   on the chapter analysis Run tab, whenever the recap pass is the selected one. Said
 *                   from the pass's side: this is what you get, and this is what it does not feed.
 *  - {@link briefs} on the book-briefs row of the book dashboard, which is the OTHER end of the same
 *                   confusion (the author who ran the recap on every chapter and wonders why the briefs
 *                   are still not built). Said from the briefs' side, naming the pass by its new label.
 *
 * No em-dash and no en-dash in either sentence. Hebrew is DRAFT, w8 native sweep.
 */
export const CHAPTER_RECAP_RELATIONSHIP: {
  pass: { he: string; en: string };
  briefs: { he: string; en: string };
} = {
  pass: {
    he: 'מתמצת את הפרק הזה עבור הקריאה שלכם. אינו מזין את תקצירי הספר.',
    en: 'Summarizes this chapter for you to read. It does not feed the book briefs.',
  },
  briefs: {
    he: 'תקצירי הספר הם בנייה נפרדת. הרצת "תמצית פרק" על כל פרק בנפרד אינה מפיקה אותם.',
    en: 'The book briefs are a separate build. Running Chapter recap on every chapter does not produce them.',
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

