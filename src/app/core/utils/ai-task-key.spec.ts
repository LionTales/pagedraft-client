/**
 * tier-ux-rework c3: the AnalysisType -> AiTaskType mirror.
 *
 * This map is load-bearing for READS: the DTO's tasks[] is keyed by AiTaskType, the run surfaces are keyed
 * by AnalysisType, and several analysis types share ONE task. Getting it wrong renders several "different"
 * toggles over one stored value. It mirrors the server's AnalysisTaskMapping restricted to the tasks the
 * server actually reports (AiTierPolicy.UserFacingTasks), so this pins both halves of that statement.
 */
import { AI_TASK_KEYS, resolveAiTaskKey } from './ai-task-key';

describe('resolveAiTaskKey', () => {
  it('maps every analysis type that ROUTES to LinguisticAnalysis onto that one task', () => {
    for (const analysisType of ['LinguisticAnalysis', 'LiteraryAnalysis', 'BookOverview', 'CharacterAnalysis', 'StoryAnalysis']) {
      expect(resolveAiTaskKey(analysisType)).withContext(analysisType).toBe('LinguisticAnalysis');
    }
  });

  it('passes an AiTaskType name through unchanged', () => {
    for (const task of AI_TASK_KEYS) {
      expect(resolveAiTaskKey(task)).withContext(task).toBe(task);
    }
  });

  /** No tier is reported for these, so a surface must render no control rather than invent an answer. */
  it('returns null for every type with no user-facing tier control', () => {
    for (const value of ['Summarization', 'Synopsis', 'Custom', 'QA', 'Nonsense', '', '   ', null, undefined]) {
      expect(resolveAiTaskKey(value)).withContext(String(value)).toBeNull();
    }
  });

  it('trims incidental whitespace rather than failing to resolve', () => {
    expect(resolveAiTaskKey('  Proofread ')).toBe('Proofread');
  });

  it('is case SENSITIVE, so a typo surfaces as "no control" instead of a wrong control', () => {
    expect(resolveAiTaskKey('proofread')).toBeNull();
  });
});
