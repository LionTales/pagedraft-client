/**
 * c04: the chunk throughput clock and the time-remaining estimator, tested as PURE FUNCTIONS.
 *
 * No fixture, no TestBed, no clock stub and no timers: `estimateRemainingMs` takes `Date.now()` as an
 * input nowhere, so the entire edge-case matrix is expressible as plain values. That is deliberate -
 * "a bad estimator is worse than none", and an estimator that can only be exercised through a rendered
 * dialog is one whose edge cases do not get exercised at all.
 */
import {
  ChunkClock,
  EMPTY_CHUNK_CLOCK,
  advanceChunkClock,
  estimateRemainingMs,
  startChunkClock,
} from './chunk-eta';

/** A fixed wall clock, so every timestamp in this file is readable as "T + n seconds". */
const T0 = Date.parse('2026-08-03T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

/** A clock for a client-started run whose window is [0s, `lastCompletionSeconds`]. */
function liveClock(lastCompletionSeconds: number | null): ChunkClock {
  return {
    baselineAt: at(0),
    baselineCompleted: 0,
    lastCompletionAt: lastCompletionSeconds === null ? null : at(lastCompletionSeconds),
  };
}

describe('chunk-eta: startChunkClock / advanceChunkClock (c04)', () => {
  it('a client-started run opens its window immediately, with nothing completed', () => {
    expect(startChunkClock(at(0))).toEqual({
      baselineAt: at(0),
      baselineCompleted: 0,
      lastCompletionAt: null,
    });
  });

  it('an observation with NO chunk count is not evidence and changes nothing', () => {
    const clock = liveClock(null);
    expect(advanceChunkClock(clock, null, null, at(30))).toBe(clock);
    // ...including for a job that has never had a baseline: a non-chunked run must not open a window.
    expect(advanceChunkClock(EMPTY_CHUNK_CLOCK, null, null, at(30))).toBe(EMPTY_CHUNK_CLOCK);
  });

  it('a REATTACHED job adopts its first observation as the baseline, chunks and all', () => {
    // The run started before this tab existed: 4 chunks were already done when the client first looked.
    const next = advanceChunkClock(EMPTY_CHUNK_CLOCK, null, 4, at(120));
    expect(next).toEqual({ baselineAt: at(120), baselineCompleted: 4, lastCompletionAt: null });
    // Those 4 are NOT recorded as a completion: they happened outside the observed window, so counting
    // them would divide a window this client never saw by work it never timed.
    expect(next.lastCompletionAt).toBeNull();
  });

  it('records a completion only when the count actually INCREASES', () => {
    const clock = liveClock(null);
    // The steady state of the poll: the same snapshot re-reported. Not a completion.
    expect(advanceChunkClock(clock, 0, 0, at(10))).toBe(clock);
    // A real completion.
    expect(advanceChunkClock(clock, 0, 1, at(10)).lastCompletionAt).toBe(at(10));
    // A snapshot that goes BACKWARDS (a lagging replica) is not a completion either.
    expect(advanceChunkClock(liveClock(30), 3, 2, at(40)).lastCompletionAt).toBe(at(30));
  });

  it('a repeated snapshot does not drag the window end forward (the rate would decay to nothing)', () => {
    let clock = advanceChunkClock(liveClock(null), 0, 2, at(20));
    for (const t of [25, 30, 35, 40]) clock = advanceChunkClock(clock, 2, 2, at(t));
    expect(clock.lastCompletionAt).toBe(at(20));
  });
});

describe('chunk-eta: estimateRemainingMs (c04)', () => {
  it('uses observed THROUGHPUT, so parallel chunks need no special case', () => {
    // 4 chunks completed in the first 20s of the window (in parallel, behind the server's semaphore).
    // 5s per chunk of PIPELINE time x 6 remaining = 30s. Multiplying a single chunk's own wall-clock
    // duration would have over-estimated by roughly the degree of parallelism.
    const ms = estimateRemainingMs({ completedChunks: 4, totalChunks: 10, clock: liveClock(20) });
    expect(ms).toBe(30_000);
  });

  it('NO estimate before the first chunk completes: 0 of 10 has no basis at all', () => {
    expect(estimateRemainingMs({ completedChunks: 0, totalChunks: 10, clock: liveClock(null) })).toBeNull();
    // Even if a lastCompletionAt somehow existed, zero observed completions is still no rate.
    expect(estimateRemainingMs({ completedChunks: 0, totalChunks: 10, clock: liveClock(20) })).toBeNull();
  });

  it('NO estimate once every chunk is done', () => {
    expect(estimateRemainingMs({ completedChunks: 10, totalChunks: 10, clock: liveClock(60) })).toBeNull();
    // And an over-count (a snapshot claiming more than the total) does not produce a negative time.
    expect(estimateRemainingMs({ completedChunks: 12, totalChunks: 10, clock: liveClock(60) })).toBeNull();
  });

  it('NO estimate for a job with no start time (reattached, before its first observation)', () => {
    expect(estimateRemainingMs({ completedChunks: 4, totalChunks: 10, clock: EMPTY_CHUNK_CLOCK })).toBeNull();
  });

  it('a reattached job estimates from the window it ACTUALLY observed, not from the run start', () => {
    // Baseline stamped at 4 done; two more completed 60s later. The rate is 30s per chunk over the
    // OBSERVED window, and the 4 pre-baseline chunks contribute to neither side of the division.
    const clock: ChunkClock = { baselineAt: at(0), baselineCompleted: 4, lastCompletionAt: at(60) };
    expect(estimateRemainingMs({ completedChunks: 6, totalChunks: 10, clock })).toBe(120_000);
  });

  it('NO estimate when totalChunks is 0 or null (a single-shot run has no chunks to time)', () => {
    expect(estimateRemainingMs({ completedChunks: 1, totalChunks: 0, clock: liveClock(20) })).toBeNull();
    expect(estimateRemainingMs({ completedChunks: 1, totalChunks: null, clock: liveClock(20) })).toBeNull();
    expect(estimateRemainingMs({ completedChunks: null, totalChunks: 10, clock: liveClock(20) })).toBeNull();
  });

  it('a ONE-chunk run never shows an estimate, in either direction', () => {
    // Before: no completion, so no rate. After: nothing remains. Both are correctly silent.
    expect(estimateRemainingMs({ completedChunks: 0, totalChunks: 1, clock: liveClock(null) })).toBeNull();
    expect(estimateRemainingMs({ completedChunks: 1, totalChunks: 1, clock: liveClock(20) })).toBeNull();
  });

  it('a STALLED run does not count up: the estimate is fixed until a chunk actually lands', () => {
    // This is the monotonicity rule, and it is a property of the SHAPE: the rate is evaluated at the
    // last completion, so time passing with nothing finishing is not an input. A chunk that drags for
    // ten minutes cannot inflate the number the user is staring at.
    const stalled = liveClock(20);
    const first = estimateRemainingMs({ completedChunks: 2, totalChunks: 10, clock: stalled });
    expect(first).toBe(80_000);
    // Same clock, arbitrarily later in wall-clock time (the registry keeps re-emitting the job on every
    // poll tick): identical answer, which is also why the line does not jitter between chunks.
    expect(estimateRemainingMs({ completedChunks: 2, totalChunks: 10, clock: stalled })).toBe(first);
  });

  it('averages over EVERY observed completion, so one slow chunk moves it by 1/n', () => {
    // 1 chunk in 10s -> 9 remaining x 10s = 90s.
    expect(estimateRemainingMs({ completedChunks: 1, totalChunks: 10, clock: liveClock(10) })).toBe(90_000);
    // The 5th completion arrives after a slow patch (window now 100s): the rate is the AVERAGE 20s, not
    // the last chunk's own duration, so the revision is bounded rather than a lurch.
    expect(estimateRemainingMs({ completedChunks: 5, totalChunks: 10, clock: liveClock(100) })).toBe(100_000);
  });

  it('refuses to guess on an unusable clock rather than returning a wrong number', () => {
    expect(estimateRemainingMs({
      completedChunks: 2,
      totalChunks: 10,
      clock: { baselineAt: 'not-a-date', baselineCompleted: 0, lastCompletionAt: at(20) },
    })).toBeNull();
    // Backwards window (clock skew, or a baseline re-stamped after a completion).
    expect(estimateRemainingMs({
      completedChunks: 2,
      totalChunks: 10,
      clock: { baselineAt: at(60), baselineCompleted: 0, lastCompletionAt: at(20) },
    })).toBeNull();
  });

  it('a ZERO-length window yields no estimate: no time was observed, so there is no rate to extrapolate', () => {
    // The completion lands in the same millisecond the window opened (baselineAt === lastCompletionAt).
    // Naive division would produce 0/completions = 0, which renders as "less than a minute" on a run that
    // may have several chunks left - a confidently wrong number, not an absence of evidence.
    expect(estimateRemainingMs({ completedChunks: 2, totalChunks: 10, clock: liveClock(0) })).toBeNull();
  });

  it('CONTROL: a genuinely one-millisecond window still yields an estimate (proves the guard is about a ZERO window, not small ones)', () => {
    const oneMsClock: ChunkClock = {
      baselineAt: at(0),
      baselineCompleted: 0,
      lastCompletionAt: new Date(T0 + 1).toISOString(),
    };
    // 1 chunk observed over 1ms extrapolates to a (very large) estimate over the 999,999 remaining
    // chunks. The exact number is not the point - the point is that it is a number, not null. Without
    // this control, a future guard like `observedMs < 1000` would also pass the zero-window spec above
    // while silently breaking every sub-second (but genuinely non-zero) window.
    expect(estimateRemainingMs({ completedChunks: 1, totalChunks: 1_000_000, clock: oneMsClock })).toBe(999_999);
  });
});
