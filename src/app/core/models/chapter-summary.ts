import { StructuredChunkSummaryData } from './analysis-context';

/**
 * Cross-app contract (wb3-c04): the per-chapter summary view + edit DTOs.
 * Fields mirror the backend ChapterSummaryViewDto / RederiveChapterSummaryResponse EXACTLY (camelCase JSON).
 * Do not rename without the BE.
 *
 * DUAL-SURFACE: one ChunkSummary row carries TWO surfaces -
 *   - the flat `summaryText` is the USER'S OWN authoritative understanding of the chapter (editable here);
 *   - the structured brief (read by the whole-book review) is indicated by `hasStructuredBrief`.
 * Each surface has its OWN freshness stamp (`summaryUserEditedAt` for the flat edit, `structuredBuiltAt` for
 * the structured brief); they share one `language`. `summaryUserEdited` is the clobber-guard flag - once set,
 * an automatic re-summary skips the row, and a re-derive (user-triggered) is offered to refresh the
 * structured brief from the edit.
 */
export interface ChapterSummaryViewDto {
  bookId: string;
  chapterId: string;
  language: string;
  /** The flat, user-authoritative chapter summary (free text; editable). */
  summaryText: string;
  /** True when there is a non-blank flat summary. */
  hasSummary: boolean;
  /** True when the AI-derived structured brief (read by the whole-book review) exists for this chapter. */
  hasStructuredBrief: boolean;
  /** True once the user has manually edited the flat summary (clobber-guard flag). */
  summaryUserEdited: boolean;
  /** When the flat summary was first stamped (AI re-summary stamp / row create time). UTC ISO or null. */
  createdAt: string | null;
  /** When the user last edited the flat summary. UTC ISO or null (until edited). */
  summaryUserEditedAt: string | null;
  /** When the structured brief was last (re)built. UTC ISO or null (until built). */
  structuredBuiltAt: string | null;
  /**
   * READ-only enrichment (wb3-c04 fallback): the PARSED structured-brief facts (plotEvents / characterStates /
   * thematicMarkers / toneNotes / openThreads), so the FE can render a human-readable digest of the AI
   * analysis when the flat `summaryText` is empty but a structured brief exists. Null when no structured brief
   * exists OR when the backend could not parse the StructuredJson (defensive parse). Mirrors the backend
   * ChapterSummaryViewDto.StructuredBrief; the type is the shared `StructuredChunkSummaryData` (analysis-context).
   */
  structuredBrief: StructuredChunkSummaryData | null;
}

/** PUT .../chapters/{chapterId}/summary request body. */
export interface UpdateChapterSummaryRequest {
  summaryText: string;
  language?: string;
}

/**
 * POST .../chapters/{chapterId}/summary/rederive response. `rederived` is true when a fresh structured brief
 * was produced from the user's edited summary; false (with a message) on a graceful model miss - the edit is
 * still saved + clobber-guarded.
 */
export interface RederiveChapterSummaryResponse {
  bookId: string;
  chapterId: string;
  language: string;
  rederived: boolean;
  hasStructuredBrief: boolean;
  structuredBuiltAt: string | null;
  message: string;
}
