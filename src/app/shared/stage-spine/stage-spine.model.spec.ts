import { BookReviewStatusDto } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import {
  ChapterPassSignal,
  EXPORT_SURFACE_AVAILABLE,
  SPINE_STAGE_ORDER,
  StageSpineSignals,
  StageStatus,
  buildInputsFor,
  buildIsRefused,
  deriveStageSpine,
  emptyStageSpineSignals,
  focusStageId,
} from './stage-spine.model';

/**
 * Wave 3 / w2 - the derivation, asserted seeded-signal by seeded-signal.
 *
 * This suite is the fence around the rule the whole wave exists for: NOTHING IS PRESENTED AS DONE UNLESS
 * THE APP COMPUTED IT. The component this replaces hardcoded its first step to `done` and its last step
 * to a permanently grey placeholder, and no test caught either, because neither was derived from
 * anything a test could seed. Every case below seeds a payload and reads back the state.
 */

function summary(overrides: Partial<BookSummaryStatusDto> = {}): BookSummaryStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    totalChapters: 4,
    builtChapters: 4,
    staleCount: 0,
    hasSummary: true,
    ready: true,
    lastUpdatedAt: '2026-08-01T10:00:00Z',
    builtWithDifferentModel: false,
    summaryCoversBuiltChapters: true,
    activeBuildJobId: null,
    chaptersToBuild: 0,
    estimatedSeconds: 0,
    estimatedUsd: null,
    ...overrides,
  };
}

function review(overrides: Partial<BookReviewStatusDto> = {}): BookReviewStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    hasReview: true,
    findingCount: 23,
    openFindingCount: 12,
    resolvedFindingCount: 7,
    lastUpdatedAt: '2026-08-01T11:00:00Z',
    builtWithDifferentModel: false,
    staleVsBriefs: false,
    hasBriefs: true,
    activeBuildJobId: null,
    ready: true,
    chaptersReviewed: 4,
    chaptersTotal: 4,
    windowCount: 0,
    ranSynthesis: false,
    ranContinuityReduce: false,
    failedWindows: 0,
    ...overrides,
  };
}

function chapters(count: number, running: string[] = []): ChapterPassSignal[] {
  return Array.from({ length: count }, (_, i) => ({
    chapterId: `ch-${i}`,
    title: `Chapter ${i + 1}`,
    order: i,
    running: running.includes(`ch-${i}`),
  }));
}

function signals(overrides: Partial<StageSpineSignals> = {}): StageSpineSignals {
  return {
    chapters: null,
    chaptersWithText: null,
    summary: null,
    review: null,
    summaryRunning: false,
    reviewRunning: false,
    // The SHIPPED build fact (w4 built the export screen). A case that wants the other side of that seam
    // passes it explicitly, so no test silently asserts a configuration users never get.
    exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE,
    ...overrides,
  };
}

function stage(all: StageStatus[], id: string): StageStatus {
  const found = all.find(s => s.id === id);
  expect(found).withContext(`stage ${id} must exist`).toBeDefined();
  return found!;
}

describe('deriveStageSpine (Wave 3 / w2)', () => {
  it('renders exactly five stages, in canonical order, always', () => {
    expect(deriveStageSpine(signals()).map(s => s.id)).toEqual([...SPINE_STAGE_ORDER]);
    expect(SPINE_STAGE_ORDER).toEqual(['import', 'briefs', 'review', 'chapter-passes', 'export']);
  });

  // ── The shared precondition (final-r02) ─────────────────────────────────────
  //
  // ONE predicate, read by the spine's stages 1, 2, 3 and 5 AND by the dashboard's three build rows. It
  // exists because those two sides spelled it separately and drifted: c01 taught the stages to read both
  // counts, c02 taught the rows `chapterCount === 0` alone, and a book with three chapters created empty
  // fell exactly between them - the spine said nothing had been written while the rows beside it offered
  // to spend a real model run on those chapters.

  describe('buildInputsFor / buildIsRefused', () => {
    it('answers unknown for an absent count on either side, and refuses neither', () => {
      expect(buildInputsFor(null, null)).toBe('unknown');
      expect(buildInputsFor(null, 0)).toBe('unknown');
      expect(buildInputsFor(3, null)).toBe('unknown');
      expect(buildIsRefused('unknown')).toBeFalse();
    });

    it('tells the two empty books apart, and refuses both', () => {
      expect(buildInputsFor(0, 0)).toBe('no-chapters');
      expect(buildInputsFor(3, 0)).toBe('no-text');
      expect(buildIsRefused('no-chapters')).toBeTrue();
      expect(buildIsRefused('no-text')).toBeTrue();
    });

    it('permits the build as soon as ONE chapter carries text', () => {
      expect(buildInputsFor(3, 1)).toBe('has-text');
      expect(buildIsRefused('has-text')).toBeFalse();
    });

    /**
     * The order of the two null checks is load-bearing: with no rows there is no text question to ask, so
     * a zero chapter count must not be reported as "not known" merely because the text count is absent.
     */
    it('answers no-chapters even when the text count has not landed', () => {
      expect(buildInputsFor(0, null)).toBe('no-chapters');
    });
  });

  // ── Stage 1: Import ─────────────────────────────────────────────────────────

  describe('stage 1 Import', () => {
    it('is not-started for a book with no chapters, and offers the import', () => {
      const s = stage(deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 })), 'import');
      expect(s.state).toBe('not-started');
      expect(s.action).toBe('open-import');
    });

    it('is ready once at least one chapter carries text', () => {
      const s = stage(deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 1 })), 'import');
      expect(s.state).toBe('ready');
    });

    it('is NOT ready when chapters exist but none has text yet', () => {
      const s = stage(deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 0 })), 'import');
      expect(s.state).toBe('not-started');
      expect(s.chapterCount).toBe(3);
      expect(s.chaptersWithText).toBe(0);
    });

    /**
     * `null` is NOT KNOWN, and the file's own contract says so at {@link StageSpineSignals}. This branch
     * used to read `(chaptersWithText ?? 0) > 0`, which turned an absent fact into the positive claim
     * "none of them has any text yet" and rendered that sentence on a book nothing had been said about.
     */
    it('is unknown, not not-started, when the chapter count is known and the text count is NOT', () => {
      const s = stage(deriveStageSpine(signals({ chapters: null, chapterCount: 12, chaptersWithText: null })), 'import');
      expect(s.unknown).toBeTrue();
      expect(s.state).toBeNull();
      // And it offers no action, because it does not know whether one is needed.
      expect(s.action).toBeNull();
    });

    it('needs no text count to answer for a book with zero chapters: no rows, no text, a fact', () => {
      const s = stage(deriveStageSpine(signals({ chapters: null, chapterCount: 0, chaptersWithText: null })), 'import');
      expect(s.state).toBe('not-started');
      expect(s.action).toBe('open-import');
    });

    it('is unknown, NOT done, before the chapter list has landed', () => {
      // The retired stepper reported this exact situation as `Structure: Done`, on the reasoning that
      // mounting required a bookId. Mounting never required chapters.
      const s = stage(deriveStageSpine(signals()), 'import');
      expect(s.state).toBeNull();
      expect(s.unknown).toBeTrue();
    });

    it('never reports running: import is a fire-and-forget POST pair with no persisted job', () => {
      const everyImportState = [
        stage(deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 })), 'import').state,
        stage(deriveStageSpine(signals({ chapters: chapters(2), chaptersWithText: 2 })), 'import').state,
        stage(deriveStageSpine(signals()), 'import').state,
      ];
      expect(everyImportState).not.toContain('running');
    });
  });

  // ── Stage 2: Book briefs ────────────────────────────────────────────────────

  describe('stage 2 Book briefs', () => {
    it('is blocked by Import when the book has no chapters', () => {
      const s = stage(deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 })), 'briefs');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('import');
    });

    it('is not-started when no summary exists', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary({ hasSummary: false, ready: false }),
      })), 'briefs');
      expect(s.state).toBe('not-started');
      expect(s.action).toBe('build-briefs');
    });

    /**
     * final-r02. Found live: on a book with three chapters created empty this stage offered `Build briefs`
     * beside a stage 1 saying nothing had been written in them, and the dashboard's briefs row 200px below
     * was enabled with it. The server answers that build as a total no-op, so the offer is a claim about
     * work that will not happen; and c02's walkability rule forbids an action the neighbouring row refuses.
     */
    it('is blocked by Import when the chapters exist but not one of them carries text', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 0, summary: summary({ hasSummary: false, ready: false }),
      })), 'briefs');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('import');
      expect(s.action)
        .withContext('the offered action must be the one the author can actually walk')
        .toBe('open-import');
    });

    it('refuses a no-text book even before the status payload lands: it is a fact about the chapters', () => {
      const s = stage(deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 0 })), 'briefs');
      expect(s.state).toBe('blocked');
      expect(s.unknown).toBeFalse();
    });

    it('does NOT refuse while the text count is unknown (null is not zero)', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: null, chapterCount: 3, chaptersWithText: null, summary: summary({ hasSummary: false, ready: false }),
      })), 'briefs');
      expect(s.state).toBe('not-started');
    });

    /**
     * A run that IS in flight may not be called blocked. Both running signals therefore outrank the no-text
     * refusal - reachable when the chapters were emptied after a build started.
     */
    it('reports a build in flight as running, not blocked, on a book with no text', () => {
      const clientSide = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 0, summaryRunning: true,
      })), 'briefs');
      expect(clientSide.state).toBe('running');

      const serverSide = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 0, summary: summary({ activeBuildJobId: 'job-9' }),
      })), 'briefs');
      expect(serverSide.state).toBe('running');
    });

    it('is running when the payload carries an active build job', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary({ activeBuildJobId: 'job-9' }),
      })), 'briefs');
      expect(s.state).toBe('running');
    });

    it('is running the moment this client starts a build, before the status read catches up', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summaryRunning: true,
        summary: summary({ hasSummary: false, ready: false }),
      })), 'briefs');
      expect(s.state).toBe('running');
    });

    it('is ready when the payload says ready', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary(),
      })), 'briefs');
      expect(s.state).toBe('ready');
    });

    // `behind` is the state the strip this replaces could not express AT ALL, and the one users hit most.
    describe('behind', () => {
      it('carries chapters-changed with staleCount as the magnitude', () => {
        const s = stage(deriveStageSpine(signals({
          chapters: chapters(6), chaptersWithText: 6,
          summary: summary({ ready: false, staleCount: 3 }),
        })), 'briefs');
        expect(s.state).toBe('behind');
        expect(s.behindReasons).toEqual(['chapters-changed']);
        expect(s.behindMagnitude).toBe(3);
      });

      it('carries coverage-grew from summaryCoversBuiltChapters, with no magnitude', () => {
        const s = stage(deriveStageSpine(signals({
          chapters: chapters(6), chaptersWithText: 6,
          summary: summary({ ready: false, staleCount: 0, summaryCoversBuiltChapters: false }),
        })), 'briefs');
        expect(s.state).toBe('behind');
        expect(s.behindReasons).toEqual(['coverage-grew']);
        expect(s.behindMagnitude).toBeNull();
      });

      it('carries configuration-changed from builtWithDifferentModel', () => {
        const s = stage(deriveStageSpine(signals({
          chapters: chapters(6), chaptersWithText: 6,
          summary: summary({ ready: false, staleCount: 0, builtWithDifferentModel: true }),
        })), 'briefs');
        expect(s.behindReasons).toEqual(['configuration-changed']);
      });

      it('reports EVERY reason that holds, not just the first', () => {
        const s = stage(deriveStageSpine(signals({
          chapters: chapters(6), chaptersWithText: 6,
          summary: summary({
            ready: false, staleCount: 2, summaryCoversBuiltChapters: false, builtWithDifferentModel: true,
          }),
        })), 'briefs');
        expect(s.behindReasons).toEqual(['chapters-changed', 'coverage-grew', 'configuration-changed']);
      });

      it('is never behind when no summary exists: that is not-started, not out of date', () => {
        const s = stage(deriveStageSpine(signals({
          chapters: chapters(6), chaptersWithText: 6,
          // summaryCoversBuiltChapters is false whenever no summary exists, which is exactly why it may
          // only be read as a REASON alongside hasSummary.
          summary: summary({ hasSummary: false, ready: false, summaryCoversBuiltChapters: false }),
        })), 'briefs');
        expect(s.state).toBe('not-started');
        expect(s.behindReasons).toEqual([]);
      });
    });
  });

  // ── Stage 3: Developmental review ───────────────────────────────────────────

  describe('stage 3 Developmental review', () => {
    it('is blocked BY THE BRIEFS when hasBriefs is false, and offers building them', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, review: review({ hasBriefs: false, hasReview: false, ready: false }),
      })), 'review');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('briefs');
      expect(s.action).toBe('build-briefs');
    });

    /**
     * final-r02, the same walkability rule one book further out: the briefs this stage needs cannot be
     * built from empty chapters either, so naming them would point the author at a refused row.
     */
    it('names IMPORT on a book whose chapters carry no text, for the same reason', () => {
      const all = deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 0,
        review: review({ hasBriefs: false, hasReview: false, ready: false }),
      }));
      const s = stage(all, 'review');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('import');
      expect(s.action).toBe('open-import');
      // Every stage that offers a whole-book build says the same thing and points at the same door. Stage 4
      // is deliberately NOT among them: it offers navigation into the chapters, which is where the author
      // has to go to fix this, and it makes no claim to contradict.
      const blocked = all.filter(x => x.state === 'blocked');
      expect(blocked.map(x => x.id)).toEqual(['briefs', 'review', 'export']);
      expect(blocked.every(x => x.blockedBy === 'import' && x.action === 'open-import')).toBeTrue();
      expect(stage(all, 'chapter-passes').perChapter).toBeTrue();
      expect(stage(all, 'chapter-passes').state).toBeNull();
    });

    it('reports a review build in flight as running, not blocked, on a book with no text', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 0, reviewRunning: true,
      })), 'review');
      expect(s.state).toBe('running');
    });

    it('does NOT refuse the review while the text count is unknown (null is not zero)', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: null, chapterCount: 3, chaptersWithText: null, review: review({ hasReview: false, ready: false }),
      })), 'review');
      expect(s.state).toBe('not-started');
    });

    it('names IMPORT on a book with no chapters, because the briefs are not walkable there either', () => {
      const all = deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 }));
      const s = stage(all, 'review');
      expect(s.state).toBe('blocked');
      // Not `briefs`: stage 2 is itself blocked on this book and retargets to the import, so naming the
      // briefs here would send the user to a row that cannot build. The four blocked stages agree.
      expect(s.blockedBy).toBe('import');
      expect(s.action).toBe('open-import');
      const blockedStages = all.filter(x => x.state === 'blocked');
      expect(blockedStages.map(x => x.id)).toEqual(['briefs', 'review', 'chapter-passes', 'export']);
      expect(blockedStages.every(x => x.blockedBy === 'import' && x.action === 'open-import')).toBe(true);
    });

    it('is not-started once briefs exist but no review has been built', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3,
        review: review({ hasReview: false, ready: false, findingCount: 0, openFindingCount: 0, resolvedFindingCount: 0 }),
      })), 'review');
      expect(s.state).toBe('not-started');
      expect(s.action).toBe('build-review');
    });

    it('is behind for briefs-rebuilt, and for a configuration change, and reports both', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3,
        review: review({ ready: false, staleVsBriefs: true, builtWithDifferentModel: true }),
      })), 'review');
      expect(s.state).toBe('behind');
      expect(s.behindReasons).toEqual(['briefs-rebuilt', 'configuration-changed']);
    });

    it('is ready when the payload says ready, and then offers the findings', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, review: review(),
      })), 'review');
      expect(s.state).toBe('ready');
      expect(s.action).toBe('open-findings');
    });

    /**
     * Finding 17: `deriveReview` used to RE-DERIVE the ready/behind decision from
     * `staleVsBriefs || builtWithDifferentModel` instead of trusting `review.ready`, unlike its sibling
     * `deriveBriefs`. These two cases seed a `ready` that DISAGREES with the two booleans, which the old
     * derivation could never see (it never read `ready` at all) - so both fail on the reverted code.
     */
    it('TRUSTS `ready` over the two booleans: ready=true wins even if staleVsBriefs also says true', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3,
        review: review({ ready: true, staleVsBriefs: true }),
      })), 'review');
      expect(s.state).toBe('ready');
      expect(s.action).toBe('open-findings');
    });

    it('TRUSTS `ready` over the two booleans: ready=false is behind even if neither booleans says why', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3,
        review: review({ ready: false, staleVsBriefs: false, builtWithDifferentModel: false }),
      })), 'review');
      expect(s.state).toBe('behind');
      expect(s.behindReasons).toEqual([]);
    });

    it('carries the finding counts VERBATIM, so open is never derived as total minus resolved', () => {
      // 23 total, 7 resolved, 12 open. The missing 4 are `acknowledged`, a third bucket that neither
      // count includes - which is exactly why the open count ships as its own field.
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, review: review(),
      })), 'review');
      expect(s.findingTotal).toBe(23);
      expect(s.findingResolved).toBe(7);
      expect(s.findingOpen).toBe(12);
      expect(s.findingOpen).not.toBe(s.findingTotal! - s.findingResolved!);
    });

    it('is running while a build is in flight', () => {
      const fromPayload = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, review: review({ activeBuildJobId: 'job-4' }),
      })), 'review');
      const fromClient = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, reviewRunning: true, review: review(),
      })), 'review');
      expect(fromPayload.state).toBe('running');
      expect(fromClient.state).toBe('running');
    });
  });

  // ── Stage 4: Chapter editing passes ─────────────────────────────────────────

  describe('stage 4 Chapter editing passes', () => {
    it('makes NO book-level claim in its steady state: no state token, the chapters instead', () => {
      const s = stage(deriveStageSpine(signals({ chapters: chapters(5), chaptersWithText: 5 })), 'chapter-passes');
      expect(s.state).toBeNull();
      expect(s.perChapter).toBeTrue();
      expect(s.unknown).toBeFalse();
      expect(s.chapters?.length).toBe(5);
    });

    it('can never read ready or not-started, whatever the other stages say', () => {
      const everything = deriveStageSpine(signals({
        chapters: chapters(5), chaptersWithText: 5, summary: summary(), review: review(),
        exportSurfaceAvailable: true,
      }));
      const s = stage(everything, 'chapter-passes');
      expect(s.state).not.toBe('ready');
      expect(s.state).not.toBe('not-started');
    });

    it('is blocked by Import when the book has no chapters (gated on stage 1 only)', () => {
      const s = stage(deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 })), 'chapter-passes');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('import');
    });

    it('is NOT blocked by the briefs or the review, which it does not depend on', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(2), chaptersWithText: 2,
        summary: summary({ hasSummary: false, ready: false }),
        review: review({ hasBriefs: false, hasReview: false, ready: false }),
      })), 'chapter-passes');
      expect(s.state).toBeNull();
      expect(s.perChapter).toBeTrue();
    });

    it('is running when any chapter has a pass in flight, and marks WHICH chapter', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(4, ['ch-2']), chaptersWithText: 4,
      })), 'chapter-passes');
      expect(s.state).toBe('running');
      expect(s.chapters!.filter(c => c.running).map(c => c.chapterId)).toEqual(['ch-2']);
    });
  });

  // ── Stage 5: Export ─────────────────────────────────────────────────────────

  describe('stage 5 Export', () => {
    it('is ready on a book with chapters, and offers the export screen (w4)', () => {
      const s = stage(deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 3 })), 'export');
      expect(s.state).toBe('ready');
      expect(s.action).toBe('open-export');
    });

    it('is blocked by Import with no chapters, which is exactly the API 409 said before it is spent', () => {
      const s = stage(deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 })), 'export');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('import');
    });

    it('is gated on chapters ONLY, never on the briefs or the review', () => {
      const s = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3,
        summary: summary({ hasSummary: false, ready: false }),
        review: review({ hasBriefs: false, hasReview: false, ready: false }),
      })), 'export');
      expect(s.state).toBe('ready');
    });

    /**
     * THE DEFECT THIS STAGE SHIPPED. `ready` was read off `chapterCount > 0` alone, so a book whose three
     * chapters were created empty rendered stage 1 `not-started` ("none of them has any text yet") and
     * stage 5 `ready` in the same column, and the user who followed stage 5 downloaded a .docx containing
     * nothing, HTTP 200, no error. The signal was already on the wire.
     */
    it('is NOT ready when chapters exist but none of them carries any text', () => {
      const all = deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 0 }));
      const s = stage(all, 'export');
      expect(s.state).not.toBe('ready');
      expect(s.state).toBe('blocked');
      expect(s.blockedBy).toBe('import');
      // The action must be one the user can walk from here, exactly as on the empty book.
      expect(s.action).toBe('open-import');
      // And it agrees with stage 1 rather than contradicting it in the same column.
      expect(stage(all, 'import').state).toBe('not-started');
      expect(all.filter(x => x.state === 'ready')).toEqual([]);
    });

    it('carries the two counts, so the row can say WHY a file made now would be empty', () => {
      const s = stage(deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 0 })), 'export');
      expect(s.chapterCount).toBe(3);
      expect(s.chaptersWithText).toBe(0);
    });

    it('reads the same signal stage 1 reads, whatever the surface: counts with no chapter list', () => {
      const fromCounts = stage(
        deriveStageSpine(signals({ chapters: null, chapterCount: 4, chaptersWithText: 0 })), 'export');
      expect(fromCounts.state).toBe('blocked');
      const withText = stage(
        deriveStageSpine(signals({ chapters: null, chapterCount: 4, chaptersWithText: 1 })), 'export');
      expect(withText.state).toBe('ready');
    });

    it('says it does not know, rather than ready, when the text count has not landed', () => {
      const s = stage(deriveStageSpine(signals({ chapters: null, chapterCount: 4, chaptersWithText: null })), 'export');
      expect(s.unknown).toBeTrue();
      expect(s.state).toBeNull();
      expect(s.action).toBeNull();
    });

    it('says it does not know, rather than ready, while the chapter count has not landed', () => {
      const s = stage(deriveStageSpine(signals({ chapters: null, chapterCount: null })), 'export');
      expect(s.unknown).toBeTrue();
      expect(s.state).toBeNull();
    });

    // ── The build-fact seam ──────────────────────────────────────────────────
    //
    // `exportSurfaceAvailable` is a fact about the CLIENT BUILD, not about the book. It is kept because a
    // build without the screen is a real (if currently hypothetical) thing; what is asserted here is that
    // the SHIPPED value can never produce `unavailable`, so no user meets a greyed stage with no reason.

    it('is unavailable only for a build with no export screen, which is not the shipped one', () => {
      const off = stage(deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, exportSurfaceAvailable: false,
      })), 'export');
      expect(off.state).toBe('unavailable');
      expect(off.action).toBeNull();
      expect(EXPORT_SURFACE_AVAILABLE).toBeTrue();
    });

    it('never reads unavailable under the shipped constant, whatever the rest of the book says', () => {
      const seeds: Partial<StageSpineSignals>[] = [
        {},
        { chapters: [], chaptersWithText: 0 },
        { chapters: chapters(2), chaptersWithText: 0 },
        { chapters: chapters(2), chaptersWithText: 2, summary: summary(), review: review() },
        { chapters: null, chapterCount: 7, chaptersWithText: 7 },
      ];
      for (const seed of seeds) {
        expect(stage(deriveStageSpine(signals(seed)), 'export').state).not.toBe('unavailable');
      }
    });

    it('the shared empty signals carry the shipped build fact, so no host can seed a stale false', () => {
      expect(emptyStageSpineSignals().exportSurfaceAvailable).toBe(EXPORT_SURFACE_AVAILABLE);
    });
  });

  // ── The empty book: the live contradiction the brief reproduced ─────────────

  describe('the empty book', () => {
    it('lights Import and blocks the review, and NOTHING reads done', () => {
      const all = deriveStageSpine(signals({ chapters: [], chaptersWithText: 0 }));
      expect(stage(all, 'import').state).toBe('not-started');
      expect(stage(all, 'briefs').state).toBe('blocked');
      expect(stage(all, 'review').state).toBe('blocked');
      expect(stage(all, 'chapter-passes').state).toBe('blocked');
      // w4: stage 5 now says the true thing about THIS BOOK (nothing to put in a file) rather than about
      // the app (no screen). Both are honest; only one of them is still true.
      expect(stage(all, 'export').state).toBe('blocked');
      expect(all.filter(s => s.state === 'ready')).toEqual([]);
      expect(focusStageId(all)).toBe('import');
    });
  });

  // ── The book with rows and no words: where stage 5 used to say ready ────────

  describe('a book whose chapters are all empty', () => {
    it('claims nothing is ready, and the server agrees: this book answers 409 nothingWritten', () => {
      const all = deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 0 }));
      expect(stage(all, 'import').state).toBe('not-started');
      expect(stage(all, 'export').state).toBe('blocked');
      expect(all.filter(s => s.state === 'ready')).toEqual([]);
      // Stage 4 still refuses a book-level claim; it is gated on rows existing, not on words.
      expect(stage(all, 'chapter-passes').perChapter).toBeTrue();
    });

    it('opens on Import, which is the one thing to do about it', () => {
      expect(focusStageId(deriveStageSpine(signals({ chapters: chapters(3), chaptersWithText: 0 }))))
        .toBe('import');
    });
  });

  // ── The books-list shape: counts with no chapter list ───────────────────────

  it('derives stage 1 from explicit counts when there is no chapter list (the books-list payload)', () => {
    const all = deriveStageSpine(signals({ chapters: null, chapterCount: 4, chaptersWithText: 4 }));
    expect(stage(all, 'import').state).toBe('ready');
    // Stage 4 still refuses a book-level claim; without the list it simply says it does not know.
    expect(stage(all, 'chapter-passes').unknown).toBeTrue();
  });

  // ── Focus ──────────────────────────────────────────────────────────────────

  describe('focusStageId', () => {
    it('picks the first stage in canonical order that wants something', () => {
      const all = deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary(),
        review: review({ ready: false, staleVsBriefs: true }),
      }));
      expect(focusStageId(all)).toBe('review');
    });

    it('falls back to the per-chapter stage when every stage is settled', () => {
      const all = deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary(), review: review(),
      }));
      expect(focusStageId(all)).toBe('chapter-passes');
    });

    /**
     * NIT 46, and the assertion the fix for it shipped without: "every stage is settled" and "nothing has
     * landed yet" both produce a `find` miss, so the settled-book fallback above passes either way. On the
     * FIRST PAINT of every host the signals are empty and every stage reads `unknown`, and the unguarded
     * fallback opened "Chapter editing passes" there before visibly jumping to whichever stage actually
     * wanted attention the instant real data arrived. Deleting the guard leaves the whole suite green
     * without this case.
     */
    it('lands on Import, not the per-chapter stage, while nothing has landed yet', () => {
      const all = deriveStageSpine(emptyStageSpineSignals());
      // Premise: this is a `find` MISS, exactly like the settled book above - so the two cases are only
      // told apart by the guard under test.
      expect(all.every(s => s.unknown)).toBeTrue();
      expect(all.every(s => s.state === null)).toBeTrue();
      expect(focusStageId(all)).toBe('import');
    });

    /**
     * w8 / E1. The fallback used to be "any stage unknown -> stage 1", which reads as a first-paint guard
     * but is not one: on the books-list payload (two counts, no statuses) stages 2 to 5 are unknown
     * FOREVER, so the fallback fired forever and named a stage that is already `ready`. Compact renders
     * the focus stage behind the word `הבא:` / "Next:", so that was a finished stage called next.
     *
     * The premise lines below are what keep this test honest: it is only a real test of the fallback if
     * the `find` for a wanting stage genuinely misses AND stage 1 is genuinely settled.
     */
    it('does not name a SETTLED stage on the books-list payload, where later stages are unknown forever', () => {
      const all = deriveStageSpine(signals({ chapters: null, chapterCount: 5, chaptersWithText: 5 }));
      expect(stage(all, 'import').state).toBe('ready');
      expect(all.every(s => s.state === null || !['blocked', 'not-started', 'running', 'behind'].includes(s.state)))
        .toBeTrue();
      expect(stage(all, 'briefs').unknown).toBeTrue();

      expect(focusStageId(all)).not.toBe('import');
      expect(focusStageId(all)).toBe('briefs');
    });

    it('still prefers a stage that wants something over the loading fallback', () => {
      // Half-landed: the chapters and the briefs status are in, the review status is not. Stage 2 wants a
      // build, and that beats both fallbacks while stage 3 is still loading.
      //
      // The fixture used to be `chapters(3), chaptersWithText: 0` and leaned on stages 2 and 3 reading
      // `unknown` with no payload. final-r02 gave those two stages the same no-text refusal stages 1 and 5
      // already had, so on that book nothing is `unknown` any more and the premise below could no longer
      // hold. The case under test is unchanged: a stage that WANTS something outranks the loading fallback.
      const all = deriveStageSpine(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary({ hasSummary: false, ready: false }),
      }));
      expect(all.some(s => s.unknown)).toBeTrue();
      expect(focusStageId(all)).toBe('briefs');
    });
  });
});
