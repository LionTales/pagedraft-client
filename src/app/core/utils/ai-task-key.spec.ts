/**
 * tier-ux-rework c3: the AnalysisType -> AiTaskType mirror.
 *
 * This map is load-bearing for READS: the DTO's tasks[] is keyed by AiTaskType, the run surfaces are keyed
 * by AnalysisType, and several analysis types share ONE task. Getting it wrong renders several "different"
 * toggles over one stored value. It mirrors the server's AnalysisTaskMapping restricted to the tasks the
 * server actually reports (AiTierPolicy.UserFacingTasks), so this pins both halves of that statement.
 */
import { ANALYSIS_TYPES } from '../models/analysis';
import { AI_TASK_KEYS, NO_TIER_TASK_VALUES, isKnownNoTierTask, resolveAiTaskKey } from './ai-task-key';

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

/**
 * wave3-spine fixes c08, finding 27: "this pass has no tier" is a FACT the client holds about a known
 * pass; "did not resolve" is a gap in the client's own table. `resolveAiTaskKey` answers null for both,
 * which is right for reads and wrong as the basis for a sentence shown to a user, so the two are separated
 * here and the tier toggle asks this predicate rather than the resolver.
 */
describe('isKnownNoTierTask', () => {
  it('is true for exactly the passes the client knows have no tier', () => {
    for (const value of NO_TIER_TASK_VALUES) {
      expect(isKnownNoTierTask(value)).withContext(value).toBeTrue();
      expect(resolveAiTaskKey(value)).withContext(value).toBeNull();
    }
  });

  it('is FALSE for anything unrecognized, so an absence is never asserted about an unknown pass', () => {
    for (const value of ['Synopsis', 'Nonsense', 'summarization', 'QA-2', '', '   ', null, undefined]) {
      expect(isKnownNoTierTask(value)).withContext(String(value)).toBeFalse();
    }
  });

  it('trims incidental whitespace, exactly as resolveAiTaskKey does, so the two agree on one value', () => {
    expect(isKnownNoTierTask('  Custom ')).toBeTrue();
  });

  it('is false for every task that HAS a control, so the two sets cannot both claim a value', () => {
    for (const task of AI_TASK_KEYS) {
      expect(isKnownNoTierTask(task)).withContext(task).toBeFalse();
    }
  });

  /**
   * THE COMPLETENESS ORACLE. The discovered side is `ANALYSIS_TYPES` - the full known vocabulary, which is
   * what a seventh analysis type would be added to - and the decided side is this file's two sets. A type
   * added to the vocabulary without a tier decision lands in neither and goes RED here, which is the case
   * finding 27 describes ("a seventh analysis type added without a map entry"). Note that `ANALYSIS_TYPES`
   * is NOT the picker any more - Wave 3 / w7 split the picker out as `STARTABLE_ANALYSIS_TYPES`, a strict
   * subset (`analysis-labels.spec.ts` pins that) - so a type added only to the picker without also landing
   * here would silently skip this tier decision. This oracle must stay pointed at the full vocabulary.
   */
  it('PARTITIONS the known vocabulary: every analysis type either has a tier control or is a known no-tier pass', () => {
    const undecided = ANALYSIS_TYPES
      .map((t) => t.value as string)
      .filter((value) => resolveAiTaskKey(value) === null && !isKnownNoTierTask(value));

    expect(undecided)
      .withContext(
        'these analysis types have no tier decision: add them to ANALYSIS_TYPE_TO_TASK (they route to a ' +
          'task) or to NO_TIER_TASK_VALUES (they genuinely have no tier). Until then the tier toggle ' +
          'renders nothing for them, which is honest but probably not what was intended.',
      )
      .toEqual([]);
  });

  it('and no analysis type is claimed by BOTH sets', () => {
    const both = ANALYSIS_TYPES
      .map((t) => t.value as string)
      .filter((value) => resolveAiTaskKey(value) !== null && isKnownNoTierTask(value));
    expect(both).toEqual([]);
  });
});
