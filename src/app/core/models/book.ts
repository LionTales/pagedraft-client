// ─── Model tier (model-tier-fast-thinking plan, p3-4) ────────────────────────

/** The two tiers. 'fast' is the default for every book and means local, free, private. */
export type AiTierValue = 'fast' | 'thinking';

/**
 * Whether the thinking tier is usable, and if not, why not. Every value is a TOKEN, never a sentence: the
 * server deliberately sends no prose because this client is he/en bilingual and owns the copy. The failure
 * values are kept distinct because they need different sentences and imply different user actions:
 *  - 'routeNotConfigured'        the tier keys are absent, so a book stored as thinking SILENTLY runs local
 *                                (an operator kill switch, so an operator can undo it);
 *  - 'providerNotRegistered'     the tier names a provider this server does not have, so a run would fail;
 *  - 'providerCredentialsMissing' the provider has no access configured here, so a run would fail;
 *  - 'taskNotEligible'           PER TASK: this task is off the thinking allowlist (LineEdit, BookReview).
 *                                Permanent product property, nothing to fix;
 *  - 'languageAlwaysFast'        PER TASK: the {task}_{lang} rung outranks the tier rung for this book's
 *                                language (the English-Proofread NO-GO). The fix is the BOOK LANGUAGE, not
 *                                the deployment, which is why it is not folded into routeNotConfigured.
 */
export type AiTierReadiness =
  | 'ready'
  | 'routeNotConfigured'
  | 'providerNotRegistered'
  | 'providerCredentialsMissing'
  | 'taskNotEligible'
  | 'languageAlwaysFast';

/**
 * One user-facing task's tier answer (tier-ux-rework c1/c2). Keyed by the AiTaskType name (`Proofread`,
 * `LineEdit`, `LinguisticAnalysis`, `BookReview`), NOT by AnalysisType: several analysis types route to one
 * task, so resolve an analysis type through {@link resolveAiTaskKey} before matching against this list, or
 * four "different" toggles would secretly be one setting.
 *
 * There is deliberately NO provider/model field anywhere on this payload, and since be-c03 no routing-derived
 * field of any kind. Model identity is internal IP and the server strips it before serializing; do not re-add
 * a "which model" field for debugging. The one that was here, a `processingLocation` token justified as the
 * fact the consent copy could not be written without, was read by nothing and could not have been: it
 * described the task's CURRENT effective tier, which when a consent prompt opens is always 'fast', while
 * consent is a question about the thinking route the user is about to move to.
 */
export interface BookAiTierTaskDto {
  /** The AiTaskType name. */
  task: string;
  /** This task's own override, or null when it INHERITS the book default. null is NOT the same as 'fast'. */
  storedTier: AiTierValue | null;
  /**
   * THE TIER THAT WILL ACTUALLY ROUTE for this task, already clamped server-side (be-c01) - NOT the stored
   * setting and NOT "the override else the book default". A task the tier cannot move (LineEdit, BookReview),
   * one whose book language always stays fast (an English book's Proofread) or one whose thinking route an
   * operator removed reads 'fast' here however the book default is set. Bind the highlighted option to this
   * and never re-derive it: what was ASKED for is `storedTier` + `fallbackActive`.
   */
  effectiveTier: AiTierValue;
  /** Whether 'thinking' can route FOR THIS TASK. Anything but 'ready' means a PUT of thinking is a 409. */
  thinkingReadiness: AiTierReadiness;
  /**
   * 'Thinking' was asked for and is NOT being honoured: the per-task form of "fall back visibly, never
   * silently", and a claim about the SETTING rather than about the run. It can be true while `effectiveTier`
   * reads 'fast' - that pairing IS the fallback. It is deliberately false when a book default merely washed
   * over a task that could never honour it, because the `thinkingReadiness` reason covers that case and a
   * warning there would contradict the option beside it.
   */
  fallbackActive: boolean;
}

/** GET/PUT/DELETE /api/books/{bookId}/ai-tier. */
export interface BookAiTierDto {
  bookId: string;
  /** The book-level DEFAULT tier. Since c1 it is a SEED: a task with its own override does not follow it. */
  tier: AiTierValue;
  /** Deployment-wide readiness (the book-default control's verdict). Per-task verdicts live on `tasks`. */
  thinkingReadiness: AiTierReadiness;
  /**
   * The BOOK DEFAULT is 'thinking' but NO route actually uses the tier, so it is running on the local models.
   * This is the visible-fallback flag: the UI must render it rather than showing an unqualified "thinking".
   * Scoped to the book default, which is what the book-scope toggle highlights: a per-task opt-in that is not
   * being honoured raises `fallbackActive` on THAT task's row instead, so this flag can never contradict the
   * pill rendered beside it.
   */
  fallbackActive: boolean;
  /**
   * Whether the client must render an explicit consent step before committing a task to 'thinking'. It is a
   * RENDERING instruction driven by deployment topology (in a hosted deployment both tiers are already off
   * this machine, so the local-vs-cloud consent step is meaningless there), NOT an authorization gate: the
   * server's 409 on an unroutable 'thinking' request is unchanged and independent of it.
   */
  consentRequired: boolean;
  /** Every user-facing task's stored and effective tier, so a per-task toggle renders the server's answer. */
  tasks: BookAiTierTaskDto[];
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
