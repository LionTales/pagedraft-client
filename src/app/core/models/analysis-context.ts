/**
 * Cross-app contract (wb1-f02): structured brief DTOs mirroring the backend AnalysisContext.cs
 * records. Fields use camelCase JSON (ASP.NET Core default, no JsonNamingPolicy override in
 * Program.cs). Do not rename without BE.
 *
 * These are Phase-1 type definitions only — no rendering yet (that is Phase 3).
 * Sources:
 *   StructuredChunkSummaryData  — Models/AnalysisContext.cs ~line 142
 *   ChapterBrief                — Models/AnalysisContext.cs ~line 99
 *   ChapterCharacterState       — Models/AnalysisContext.cs ~line 111
 *   BookBrief                   — Models/AnalysisContext.cs ~line 124
 */

/** Character state snapshot within a chapter, shared by ChapterBrief and StructuredChunkSummaryData. */
export interface ChapterCharacterState {
  name: string;
  state: string | null;
  emotionalArc: string | null;
}

/**
 * L0 structured chapter brief — the machine-readable summary stored in ChunkSummary.StructuredJson.
 * Feeds into ChapterBrief assembly on the server.
 */
export interface StructuredChunkSummaryData {
  plotEvents: string[];
  characterStates: ChapterCharacterState[];
  thematicMarkers: string[];
  toneNotes: string | null;
  openThreads: string[];
}

/**
 * L1 chapter brief — deserialized from ChunkSummary.StructuredJson + chapter metadata.
 * Provides narrative context for scene/chapter-level analyses.
 */
export interface ChapterBrief {
  title: string;
  order: number;
  summary: string | null;
  plotEvents: string[];
  characterStates: ChapterCharacterState[];
  thematicMarkers: string[];
  toneNotes: string | null;
  openThreads: string[];
}

/**
 * L2 book brief — high-level book metadata assembled from BookBible + BookProfile.
 * Gives analyses global story awareness.
 */
export interface BookBrief {
  genre: string | null;
  subGenre: string | null;
  targetAudience: string | null;
  /** 1 (very simple) to 10 (high literature). */
  literatureLevel: number | null;
  themes: string[];
  synopsis: string | null;
}
