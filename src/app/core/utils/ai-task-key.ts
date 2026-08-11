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
 * the server actually surfaces (`AiTierPolicy.UserFacingTasks`).
 *
 * TWO KINDS OF "null", AND THEY ARE NOT THE SAME ANSWER (wave3-spine fixes c08, finding 27). A value can
 * fail to resolve for two very different reasons:
 *
 *  • It is a KNOWN pass that genuinely has no user-facing tier (Summarization, Custom, QA). The app knows
 *    this, so a surface may say it out loud: "this pass has no model tier choice".
 *  • It is anything else - a typo, a binding that was never a task, an analysis type added to the picker
 *    without a decision here. The app knows NOTHING about it, so the only honest render is nothing at all.
 *
 * {@link resolveAiTaskKey} answers null for both, which is correct for READS (there is no tier row either
 * way). {@link isKnownNoTierTask} is what separates them, and any surface that asserts a SENTENCE about the
 * absence must ask it rather than treating "did not resolve" as "the server reports no tier for it".
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
 * The values that are KNOWN to run with no user-facing tier at all: the server surfaces no tier row for
 * them, and that absence is a fact the app can state rather than a gap in its own knowledge.
 *
 * `Summarization` and `Custom` are the two analysis types the picker offers that land here; `QA` is an
 * AiTaskType a surface can bind directly. Together with the keys of {@link ANALYSIS_TYPE_TO_TASK} this
 * list PARTITIONS the vocabulary the client knows: every value in `ANALYSIS_TYPES` is in exactly one of
 * the two, which `ai-task-key.spec.ts` pins mechanically off that source so a seventh analysis type
 * cannot land in neither.
 */
export const NO_TIER_TASK_VALUES = ['Summarization', 'Custom', 'QA'] as const;

const NO_TIER_TASK_SET: ReadonlySet<string> = new Set<string>(NO_TIER_TASK_VALUES);

/**
 * Resolves an AnalysisType (or an AiTaskType name) to the task key the tier is stored under.
 * Returns null when the value has no user-facing tier control (Summarization, Custom, QA, unknown) -
 * see {@link isKnownNoTierTask} for telling those last two apart.
 */
export function resolveAiTaskKey(value: string | null | undefined): AiTaskKey | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return ANALYSIS_TYPE_TO_TASK[trimmed] ?? null;
}

/**
 * True only for a value this client RECOGNIZES as having no tier control ({@link NO_TIER_TASK_VALUES}).
 *
 * False for an unknown string, which is the whole point: "we know this pass has no tier" and "we have
 * never heard of this pass" are different facts, and only the first one may be asserted to a user.
 */
export function isKnownNoTierTask(value: string | null | undefined): boolean {
  return NO_TIER_TASK_SET.has((value ?? '').trim());
}
