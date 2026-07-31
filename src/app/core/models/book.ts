// ─── Model tier (model-tier-fast-thinking plan, p3-4) ────────────────────────

/** The two tiers. 'fast' is the default for every book and means local, free, private. */
export type AiTierValue = 'fast' | 'thinking';

/**
 * Whether the thinking tier is usable on THIS server, and if not, why not. The three failure values are
 * kept distinct because they need three different sentences and imply three different user actions:
 *  - 'routeNotConfigured'        the tier keys are absent, so a book stored as thinking SILENTLY runs local;
 *  - 'providerNotRegistered'     the tier names a provider this server does not have, so a run would fail;
 *  - 'providerCredentialsMissing' the provider has no API key here, so a run would fail.
 */
export type AiTierReadiness =
  | 'ready'
  | 'routeNotConfigured'
  | 'providerNotRegistered'
  | 'providerCredentialsMissing';

/**
 * One allowlisted task's ACTUAL route for this book. `usesTier` false is not an error: for an English book
 * the server's `Proofread_en` key outranks the tier, so English proofreading stays local on both tiers by
 * design, and the surface says so per task rather than painting the whole book "cloud".
 */
export interface BookAiTierRouteDto {
  task: string;
  provider: string;
  model: string;
  usesTier: boolean;
}

/** GET/PUT /api/books/{bookId}/ai-tier. */
export interface BookAiTierDto {
  bookId: string;
  tier: AiTierValue;
  thinkingReadiness: AiTierReadiness;
  /**
   * The book stores 'thinking' but NO route actually uses the tier, so it is running on the local models.
   * This is the visible-fallback flag: the UI must render it rather than showing an unqualified "thinking".
   */
  fallbackActive: boolean;
  routes: BookAiTierRouteDto[];
}

export interface BookDto {
  id: string;
  title: string;
  author: string | null;
  language: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The book's model tier. The server NORMALIZES this on the way out, so it is always exactly 'fast' or
   * 'thinking' even though the column is a nullable free string; the client must not re-implement the
   * defensive parse, or the two would eventually disagree about what an unrecognised value means.
   */
  aiTier: AiTierValue;
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

export interface ScenesClearedEvent {
  bookId: string;
  chapterId: string;
  clearedSceneIds: string[];
}

export interface ScenesReorderedEvent {
  bookId: string;
  chapterId: string;
  newOrder: { sceneId: string; order: number }[];
}
