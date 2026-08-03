/**
 * c04: the chunk THROUGHPUT clock and the approximate time-remaining estimator.
 *
 * ── Why a throughput estimator and not "time for one chunk x chunks remaining" ─────────────────────
 * The server fans chunks out with `Task.WhenAll` behind a semaphore (`UnifiedAnalysisService`), so
 * several chunks are in flight at once. The wall-clock time a single chunk takes is therefore NOT the
 * time it adds to the run, and multiplying it by the remaining count over-estimates by roughly the
 * degree of parallelism. Observed THROUGHPUT - elapsed divided by the number of chunks that have
 * actually completed in that window - measures the pipeline as a whole and needs to know nothing about
 * how wide it is.
 *
 * ── The monotonicity rule, which is a property of the SHAPE rather than of a ratchet ───────────────
 * The rate is evaluated AT THE LAST COMPLETION ({@link ChunkClock.lastCompletionAt}), not at "now".
 * That single choice buys both requirements at once:
 *   - NO JITTER: the estimate is CONSTANT between completions, so it does not twitch on every poll
 *     (the registry re-emits the job on every poll tick, several times per chunk).
 *   - NEVER COUNTS UP ON A LATE CHUNK: a chunk that is dragging contributes nothing until it lands, so
 *     a slow chunk cannot inflate the number while the user is watching it. The estimate is revised
 *     only when new evidence (a completion) actually arrives, and even then it is an average over
 *     EVERY completion observed so far, so one slow chunk moves it by 1/n rather than replacing it.
 * A hard "never increase" ratchet was rejected: a run that genuinely slows down would then be pinned at
 * a number it can no longer meet, which is a worse lie than a revision. Coarse rendering
 * (`formatEtaLabel`, in `core/i18n/run-strings.ts`) absorbs the small revisions, and the label says
 * "about" in both languages so the number never reads as a promise.
 *
 * `Date.now()` is deliberately NOT an input: every value the estimator reads is registry state, so the
 * function is fully deterministic and the whole edge-case matrix is unit-testable without a fixture,
 * a clock stub or a timer.
 */

/**
 * The per-JOB throughput clock. It lives on `TrackedJob` (the registry is its single owner) rather than
 * in a component, because a surface mounted mid-run - the Activity Center opened at 60%, a run dialog
 * re-opened after a minimize - would otherwise start counting from its OWN mount time and estimate off
 * a window that never happened.
 */
export interface ChunkClock {
  /**
   * ISO timestamp the throughput window starts at, or null when there is no trustworthy start.
   *
   * A run the CLIENT started stamps this at `track()` time, with {@link baselineCompleted} 0: the client
   * saw the run begin, so elapsed-since-then is real.
   *
   * A run discovered by REATTACH (a job that was already running before this browser tab existed) has
   * no such moment - the server started it minutes ago and the client cannot know when - so it starts
   * null and is stamped at the FIRST progress observation instead, with {@link baselineCompleted} set to
   * whatever was already done. The estimate then measures only the window this client actually observed,
   * which is honest, at the cost of needing one more chunk to complete before an estimate exists.
   */
  baselineAt: string | null;
  /** `completedChunks` as of {@link baselineAt}. Chunks finished before it are NOT counted as evidence. */
  baselineCompleted: number;
  /** ISO timestamp of the last observed INCREASE in `completedChunks`; null until the first one. */
  lastCompletionAt: string | null;
}

/** A clock with no observations yet. Also the reattach starting point (no trustworthy start time). */
export const EMPTY_CHUNK_CLOCK: ChunkClock = Object.freeze({
  baselineAt: null,
  baselineCompleted: 0,
  lastCompletionAt: null,
});

/** The clock for a run this client STARTED: the window opens now, with nothing yet completed. */
export function startChunkClock(atIso: string): ChunkClock {
  return { baselineAt: atIso, baselineCompleted: 0, lastCompletionAt: null };
}

/**
 * Fold one progress observation into the clock. Pure: the registry passes the job's previous count, the
 * newly observed count and the observation time, and gets the next clock back.
 *
 * Three rules, in order:
 *  1. An observation with no chunk count at all (a non-chunked run, or a poll before chunking) changes
 *     nothing - it is not evidence about throughput either way.
 *  2. A clock with no baseline adopts THIS observation as its baseline (the reattach path). It does not
 *     also record a completion: the chunks already done at that moment happened before the window.
 *  3. Otherwise, an INCREASE in the completed count stamps {@link ChunkClock.lastCompletionAt}. A repeat
 *     of the same count (the poll re-reporting an unchanged snapshot, which is most polls) is not a
 *     completion and must not move the stamp, or the rate would be measured over a window whose end
 *     keeps drifting forward while its numerator stands still.
 */
export function advanceChunkClock(
  clock: ChunkClock,
  previousCompleted: number | null,
  observedCompleted: number | null,
  atIso: string,
): ChunkClock {
  if (observedCompleted == null || !Number.isFinite(observedCompleted)) return clock;

  if (clock.baselineAt === null) {
    return { baselineAt: atIso, baselineCompleted: observedCompleted, lastCompletionAt: null };
  }

  const previous = previousCompleted ?? clock.baselineCompleted;
  if (observedCompleted > previous) {
    return { ...clock, lastCompletionAt: atIso };
  }
  return clock;
}

/** Everything the estimator reads. All of it is registry-owned `TrackedJob` state. */
export interface ChunkEtaInput {
  completedChunks: number | null;
  totalChunks: number | null;
  clock: ChunkClock;
}

/**
 * Approximate milliseconds of work remaining, or null when there is no BASIS for an estimate.
 *
 * null - meaning the surface shows nothing at all - in every one of these cases, on purpose:
 *  - no chunk shape (`totalChunks` null or <= 0): a single-shot run has no throughput to observe;
 *  - nothing completed yet inside the observed window: one data point is needed before a rate exists,
 *    which is exactly the `0 of 10` moment the user described as looking stalled. It looks stalled
 *    because there genuinely is no information yet; the COUNTS carry that, an invented number would not;
 *  - every chunk is done (remaining 0): the run is finishing, not waiting;
 *  - no baseline yet (a reattached job before its first observation) or a non-parsable/backwards clock;
 *  - a zero-length observation window (the completion landed in the same millisecond the window opened):
 *    no time has actually been observed, so there is no rate to extrapolate from - a `0` here would render
 *    as "less than a minute", which is a confident lie rather than an absence of evidence.
 *
 * A one-chunk run therefore never shows an estimate in either direction: before the chunk lands there is
 * no rate, and after it lands there is nothing left to wait for. That is correct, not a gap.
 */
export function estimateRemainingMs(input: ChunkEtaInput): number | null {
  const total = input.totalChunks;
  const completed = input.completedChunks;
  if (total == null || !Number.isFinite(total) || total <= 0) return null;
  if (completed == null || !Number.isFinite(completed)) return null;

  const remainingChunks = total - completed;
  if (remainingChunks <= 0) return null;

  const { baselineAt, baselineCompleted, lastCompletionAt } = input.clock;
  if (!baselineAt || !lastCompletionAt) return null;

  const baseMs = Date.parse(baselineAt);
  const lastMs = Date.parse(lastCompletionAt);
  if (!Number.isFinite(baseMs) || !Number.isFinite(lastMs)) return null;

  const observedCompletions = completed - baselineCompleted;
  if (observedCompletions < 1) return null;

  const observedMs = lastMs - baseMs;
  if (observedMs <= 0) return null; // negative: clock skew / a re-stamped baseline; zero: no time observed yet, so there is no rate to extrapolate from

  const msPerChunk = observedMs / observedCompletions;
  return Math.round(msPerChunk * remainingChunks);
}
