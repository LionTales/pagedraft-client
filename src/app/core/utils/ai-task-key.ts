/**
 * ANALYSIS TYPE -> AI TASK KEY (tier-ux-rework c3).
 *
 * The tier is stored per (book, AiTaskType), and the `tasks[]` array on the ai-tier DTO is keyed by the
 * AiTaskType name. The run surfaces, however, are keyed by the user-facing AnalysisType (the type picker's
 * values). Several analysis types route to ONE task: LiteraryAnalysis, BookOverview, CharacterAnalysis and
 * StoryAnalysis all run as LinguisticAnalysis. A surface that bound a toggle straight to its AnalysisType
 * would therefore render four "different" toggles that are secretly one setting.
 *
 * This is the client-side mirror of the server's `AnalysisTaskMapping.ToAiTaskType` restricted to the tasks
 * the server actually surfaces (`AiTierPolicy.UserFacingTasks`). Anything else - Summarization, Custom, QA -
 * resolves to null, which means "no tier control for this type": the server does not report a tier for it,
 * so offering a toggle would be inventing an answer.
 *
 * The PUT endpoint also accepts AnalysisType names and normalizes them server-side, so this mapping is not
 * load-bearing for writes. It IS load-bearing for READS, which is why it lives here rather than being
 * hand-inlined per surface.
 */

/** The tasks the server reports a tier for (AiTierPolicy.UserFacingTasks). */
export const AI_TASK_KEYS = ['BookReview', 'LineEdit', 'LinguisticAnalysis', 'Proofread'] as const;

export type AiTaskKey = (typeof AI_TASK_KEYS)[number];

/**
 * AnalysisType -> AiTaskKey for every analysis type that HAS a tier control. Entries whose key equals their
 * value (Proofread, LineEdit, LinguisticAnalysis, BookReview) also make the function accept a task name
 * directly, so a caller that already holds an AiTaskType can pass it through unchanged.
 */
const ANALYSIS_TYPE_TO_TASK: Readonly<Record<string, AiTaskKey>> = {
  Proofread: 'Proofread',
  LineEdit: 'LineEdit',
  LinguisticAnalysis: 'LinguisticAnalysis',
  LiteraryAnalysis: 'LinguisticAnalysis',
  BookOverview: 'LinguisticAnalysis',
  CharacterAnalysis: 'LinguisticAnalysis',
  StoryAnalysis: 'LinguisticAnalysis',
  BookReview: 'BookReview',
};

/**
 * Resolves an AnalysisType (or an AiTaskType name) to the task key the tier is stored under.
 * Returns null when the value has no user-facing tier control (Summarization, Custom, QA, unknown).
 */
export function resolveAiTaskKey(value: string | null | undefined): AiTaskKey | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return ANALYSIS_TYPE_TO_TASK[trimmed] ?? null;
}
