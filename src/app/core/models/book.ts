export interface BookDto {
  id: string;
  title: string;
  author: string | null;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookDetailDto extends BookDto {
  chapters: ChapterSummaryDto[];
}

export interface ChapterSummaryDto {
  id: string;
  title: string;
  partName: string | null;
  order: number;
  wordCount: number;
  updatedAt: string;
}

export interface ChapterDto extends ChapterSummaryDto {
  contentSfdt: string;
}

export interface ImportResultDto {
  bookId: string;
  chaptersCreated: number;
  chapters: ChapterSummaryDto[];
}

export interface ImportPreviewChapterDto {
  tempId: string;
  order: number;
  title: string;
  partName: string | null;
  wordCount: number;
  snippet: string;
  sfdtJson: string;
}

export interface ImportPreviewResponseDto {
  bookId: string;
  fileName: string;
  fileSize: number;
  pageCount: number | null;
  chapters: ImportPreviewChapterDto[];
}

export interface ImportConfirmationChapterDto {
  tempId: string;
  title: string;
  partName: string | null;
  order: number;
  include: boolean;
  sfdtJson: string;
}

export interface ImportConfirmationRequest {
  mode: 'append' | 'overwrite';
  chapters: ImportConfirmationChapterDto[];
}

export interface ImportConfirmationResultDto {
  bookId: string;
  importedCount: number;
  skippedCount: number;
  totalChapters: number;
  chapters: ChapterSummaryDto[];
}

export interface ChapterUpdatedEvent {
  bookId: string;
  chapterId: string;
  wordCount: number;
  updatedAt: string;
}

export interface ChapterCreatedEvent {
  bookId: string;
  chapterId: string;
  title: string;
  order: number;
}

export interface ChapterDeletedEvent {
  bookId: string;
  chapterId: string;
}

export interface ChapterReorderedEvent {
  bookId: string;
  newOrder: { chapterId: string; order: number }[];
}

// ─── Scenes (Phase 3) ─────────────────────────────────────────────────
export interface SceneDto {
  id: string;
  chapterId: string;
  title: string;
  order: number;
  contentSfdt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SceneSummaryDto {
  id: string;
  chapterId: string;
  title: string;
  order: number;
  updatedAt: string;
}

export interface CreateSceneDto {
  title: string;
  order?: number | null;
  contentSfdt?: string | null;
}

export interface UpdateSceneDto {
  title?: string | null;
  order?: number | null;
  contentSfdt?: string | null;
}

export interface ReorderScenesRequest {
  scenes: { sceneId: string; order: number }[];
}

// ─── Book intelligence (Phase 4 / 5) ─────────────────────────────────────

/** GET /api/books/{bookId}/profile response. */
export interface BookProfileDto {
  id: string;
  bookId: string;
  genre: string | null;
  subGenre: string | null;
  synopsis: string | null;
  targetAudience: string | null;
  literatureLevel: number | null;
  languageRegister: string | null;
  charactersJson: string | null;
  storyStructureJson: string | null;
  language: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/books/{bookId}/profile/refresh */
export interface RefreshProfileRequest {
  language?: string | null;
}

/** POST /api/books/{bookId}/summarize */
export interface SummarizeBookRequest {
  language?: string | null;
}

/** POST /api/books/{bookId}/ask */
export interface AskBookRequest {
  question: string;
  language?: string | null;
}

/** Parsed from BookProfileDto.charactersJson (CharacterAnalysisResult). */
export interface CharacterAnalysisResult {
  characters: CharacterEntry[];
  relationships: CharacterRelationship[];
  summary?: string;
}

export interface CharacterEntry {
  name: string;
  role: string;
  description?: string;
  arc?: string;
  firstAppearanceChapter?: number;
}

export interface CharacterRelationship {
  character1: string;
  character2: string;
  relationship: string;
}

/** Parsed from BookProfileDto.storyStructureJson (StoryAnalysisResult). */
export interface StoryAnalysisResult {
  plotStructure: PlotStructure;
  pacing?: string;
  conflicts: ConflictEntry[];
  summary?: string;
}

export interface PlotStructure {
  setup?: string;
  risingAction?: string;
  climax?: string;
  fallingAction?: string;
  resolution?: string;
}

export interface ConflictEntry {
  type: string;
  description?: string;
  status?: string;
}

export interface SceneCreatedEvent {
  bookId: string;
  chapterId: string;
  sceneId: string;
  title: string;
  order: number;
}

export interface SceneUpdatedEvent {
  bookId: string;
  chapterId: string;
  sceneId: string;
  updatedAt: string;
}

export interface SceneDeletedEvent {
  bookId: string;
  chapterId: string;
  sceneId: string;
}

export interface ScenesReorderedEvent {
  bookId: string;
  chapterId: string;
  newOrder: { sceneId: string; order: number }[];
}
