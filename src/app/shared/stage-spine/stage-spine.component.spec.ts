import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { BookReviewStatusDto } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { StageActionEvent, StageSpineComponent } from './stage-spine.component';
import {
  COMPACT_UNKNOWN_LABEL,
  STAGE_GUIDE_BROADER_NOTE,
  STAGE_GUIDE_LINK_LABEL,
  STAGE_NAMES,
  STATE_LABELS,
} from './stage-spine.copy';
import { StageGuideLink, stageGuideLink } from './stage-guide';
import { ChapterPassSignal, EXPORT_SURFACE_AVAILABLE, SPINE_STAGE_ORDER, StageSpineSignals } from './stage-spine.model';

/**
 * Wave 3 / w2 - the spine as rendered.
 *
 * The centrepiece of this suite is the LAYOUT CONTRACT at 300px, which is the constraint that killed the
 * component this one replaces. The panel the spine lives in is 300 to 380 pixels wide, and the four-label
 * horizontal strip that shipped there could not render its own four names at the 380 DEFAULT, in either
 * language. The reconciled model has five names, three of them multi-word in both languages, and the
 * brief forbids solving that with truncation or a tooltip. So the form is a vertical stack, and
 * `describe('the 300px layout contract')` below is the proof, asserted in Hebrew first and then mirrored
 * in English, rather than a claim in a comment.
 */

function summary(overrides: Partial<BookSummaryStatusDto> = {}): BookSummaryStatusDto {
  return {
    bookId: 'book-1', language: 'he', totalChapters: 4, builtChapters: 4, staleCount: 0,
    hasSummary: true, ready: true, lastUpdatedAt: '2026-08-01T10:00:00Z', builtWithDifferentModel: false,
    summaryCoversBuiltChapters: true, activeBuildJobId: null, chaptersToBuild: 0, estimatedSeconds: 0,
    estimatedUsd: null, ...overrides,
  };
}

function review(overrides: Partial<BookReviewStatusDto> = {}): BookReviewStatusDto {
  return {
    bookId: 'book-1', language: 'he', hasReview: true, findingCount: 23, openFindingCount: 12,
    resolvedFindingCount: 7, lastUpdatedAt: '2026-08-01T11:00:00Z', builtWithDifferentModel: false,
    staleVsBriefs: false, hasBriefs: true, activeBuildJobId: null, ready: true, chaptersReviewed: 4,
    chaptersTotal: 4, windowCount: 0, ranSynthesis: false, ranContinuityReduce: false, failedWindows: 0,
    ...overrides,
  };
}

function chapters(count: number, running: string[] = []): ChapterPassSignal[] {
  return Array.from({ length: count }, (_, i) => ({
    chapterId: `ch-${i}`, title: `Chapter ${i + 1}`, order: i, running: running.includes(`ch-${i}`),
  }));
}

function signals(overrides: Partial<StageSpineSignals> = {}): StageSpineSignals {
  return {
    chapters: null, chaptersWithText: null, summary: null, review: null,
    // The SHIPPED build fact, so every case below renders the spine the way users get it (w4).
    summaryRunning: false, reviewRunning: false, exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE, ...overrides,
  };
}

/** A fully built, fully current book: every stage that CAN be ready, is. */
function healthyBook(): StageSpineSignals {
  return signals({
    chapters: chapters(4), chaptersWithText: 4, summary: summary(), review: review(),
  });
}

/**
 * NIT 48. `healthyBook()` alone only ever renders `ready`, so the 300px contract never measured the
 * elements that ONLY appear on the other states: the `behind` action button carries the longest label in
 * the whole vocabulary ("בנייה מחדש של התקצירים" / "Rebuild the briefs"), the `blocked` row carries the
 * blocked sentence, and the `behind` row carries the magnitude badge and reason line. One book that is
 * simultaneously `ready` (import, export), `behind` (briefs, with a magnitude and a reason) and `blocked`
 * (review, on the missing briefs) exercises all three in a single render.
 */
function mixedStatesBook(): StageSpineSignals {
  return signals({
    chapters: chapters(4),
    chaptersWithText: 4,
    summary: summary({ ready: false, staleCount: 2 }),
    review: review({ hasBriefs: false }),
  });
}

describe('StageSpineComponent (Wave 3 / w2)', () => {
  let fixture: ComponentFixture<StageSpineComponent>;
  let component: StageSpineComponent;

  beforeEach(async () => {
    // Deliberately NO providers: the spine is presentational and must stay that way. If this TestBed ever
    // needs one, the spine has grown a dependency that every host's spec will then have to carry too.
    await TestBed.configureTestingModule({ imports: [StageSpineComponent] }).compileComponents();
    fixture = TestBed.createComponent(StageSpineComponent);
    component = fixture.componentInstance;
  });

  function render(next: StageSpineSignals, bookLanguage: string | null = 'he'): void {
    fixture.componentRef.setInput('bookLanguage', bookLanguage);
    fixture.componentRef.setInput('signals', next);
    fixture.detectChanges();
  }

  function root(): HTMLElement {
    return fixture.debugElement.query(By.css('[data-testid="stage-spine"]')).nativeElement as HTMLElement;
  }

  function row(id: string): HTMLElement {
    return fixture.debugElement.query(By.css(`[data-testid="spine-stage-${id}"]`)).nativeElement as HTMLElement;
  }

  function stateOf(id: string): string {
    return row(id).dataset['state'] ?? '';
  }

  function text(selector: string): string {
    const el = fixture.debugElement.query(By.css(selector));
    return el ? (el.nativeElement as HTMLElement).textContent!.trim() : '';
  }

  /** Press a row's head, exactly as a user would. Toggles. */
  function clickHead(id: string): void {
    (fixture.debugElement.query(By.css(`[data-testid="spine-stage-head-${id}"]`))
      .nativeElement as HTMLElement).click();
    fixture.detectChanges();
  }

  /** Ensure a row is open, whether or not it was the one the spine opened by default. */
  function expand(id: string): void {
    if (!fixture.debugElement.query(By.css(`[data-testid="spine-stage-body-${id}"]`))) clickHead(id);
  }

  // ── THE 300px LAYOUT CONTRACT ──────────────────────────────────────────────────────────────────────

  describe('the 300px layout contract (brief section 2.6)', () => {
    /**
     * Constrain the host to the NARROWEST the panel can be. Everything measured below is real layout in
     * a real browser: Karma runs Chrome, the global stylesheet with the --pd-* tokens is loaded by the
     * test builder, and the component's own styles are applied by the TestBed.
     */
    function at300(lang: string): void {
      const host = fixture.nativeElement as HTMLElement;
      host.style.width = '300px';
      host.style.boxSizing = 'border-box';
      render(healthyBook(), lang);
    }

    /** Every stage name element, in canonical order. */
    function nameEls(): HTMLElement[] {
      return SPINE_STAGE_ORDER.map(
        id => fixture.debugElement.query(By.css(`[data-testid="spine-stage-name-${id}"]`)).nativeElement as HTMLElement,
      );
    }

    /** Every stage's state-chip element, in canonical order. Always in the DOM (part of the row head). */
    function stateEls(): HTMLElement[] {
      return SPINE_STAGE_ORDER.map(
        id => fixture.debugElement.query(By.css(`[data-testid="spine-stage-state-${id}"]`)).nativeElement as HTMLElement,
      );
    }

    /**
     * NIT 48. The five clipping/ellipsis/zero-size checks the Hebrew name test always ran, factored out so
     * every element this contract measures - name, state chip, action button, blocked sentence, behind
     * block - gets the SAME checks in BOTH languages, including the zero-size guard the English name test
     * used to skip (a box that trivially satisfies "no clipping" by rendering nothing).
     */
    function assertFits(el: HTMLElement, ctx: string): void {
      expect(el.scrollWidth).withContext(`${ctx} horizontal clip`).toBeLessThanOrEqual(el.clientWidth + 1);
      expect(el.scrollHeight).withContext(`${ctx} vertical clip`).toBeLessThanOrEqual(el.clientHeight + 1);
      const style = getComputedStyle(el);
      expect(style.textOverflow).withContext(`${ctx} text-overflow`).not.toBe('ellipsis');
      expect(style.whiteSpace).withContext(`${ctx} white-space`).not.toBe('nowrap');
      expect(el.getBoundingClientRect().width).withContext(`${ctx} width`).toBeGreaterThan(8);
      expect(el.getBoundingClientRect().height).withContext(`${ctx} height`).toBeGreaterThan(6);
    }

    it('shows all five HEBREW names IN FULL at 300px, with no clipping and no ellipsis', () => {
      at300('he');

      const expected = SPINE_STAGE_ORDER.map(id => STAGE_NAMES[id].he);
      expect(expected).toEqual(['ייבוא', 'תקצירי ספר', 'עריכה התפתחותית', 'עריכת פרק', 'ייצוא']);

      nameEls().forEach((el, i) => {
        const ctx = `stage name "${expected[i]}"`;
        // The WHOLE name is in the DOM, character for character, before the shared shape checks below.
        expect(el.textContent!.trim()).withContext(ctx).toBe(expected[i]);
        assertFits(el, ctx);
      });
    });

    it('shows all five ENGLISH names IN FULL at 300px (the mirror pass)', () => {
      at300('en');
      const expected = SPINE_STAGE_ORDER.map(id => STAGE_NAMES[id].en);
      nameEls().forEach((el, i) => {
        const ctx = `stage name "${expected[i]}"`;
        expect(el.textContent!.trim()).withContext(ctx).toBe(expected[i]);
        assertFits(el, ctx);
      });
    });

    it('shows the state chip in full at 300px, across ready/behind/blocked/per-chapter, in both languages', () => {
      for (const lang of ['he', 'en']) {
        const host = fixture.nativeElement as HTMLElement;
        host.style.width = '300px';
        host.style.boxSizing = 'border-box';
        render(mixedStatesBook(), lang);

        // Sanity: this fixture really does exercise four distinct chip words, not four copies of "ready".
        expect(stateOf('import')).toBe('ready');
        expect(stateOf('briefs')).toBe('behind');
        expect(stateOf('review')).toBe('blocked');
        expect(stateOf('chapter-passes')).toBe('per-chapter');
        expect(stateOf('export')).toBe('ready');

        stateEls().forEach((el, i) => {
          assertFits(el, `${lang} state chip "${SPINE_STAGE_ORDER[i]}" (${el.textContent!.trim()})`);
        });
      }
    });

    it('shows the longest action-button label ("Rebuild the briefs") in full at 300px, in both languages', () => {
      for (const lang of ['he', 'en']) {
        const host = fixture.nativeElement as HTMLElement;
        host.style.width = '300px';
        host.style.boxSizing = 'border-box';
        render(mixedStatesBook(), lang);
        expand('briefs');

        const expected = lang === 'he' ? 'בנייה מחדש של התקצירים' : 'Rebuild the briefs';
        const el = fixture.debugElement.query(By.css('[data-testid="spine-action-briefs"]'))
          .nativeElement as HTMLElement;
        expect(el.textContent!.trim()).withContext(`${lang} action label`).toBe(expected);
        assertFits(el, `${lang} action button`);
      }
    });

    it('shows the blocked sentence in full at 300px, in both languages', () => {
      for (const lang of ['he', 'en']) {
        const host = fixture.nativeElement as HTMLElement;
        host.style.width = '300px';
        host.style.boxSizing = 'border-box';
        render(mixedStatesBook(), lang);
        expand('review');

        const el = fixture.debugElement.query(By.css('[data-testid="spine-blocked-review"]'))
          .nativeElement as HTMLElement;
        expect(el.textContent!.trim().length).withContext(`${lang} blocked sentence non-empty`).toBeGreaterThan(0);
        assertFits(el, `${lang} blocked sentence`);
      }
    });

    it('shows the behind block (magnitude badge + reason) in full at 300px, in both languages', () => {
      for (const lang of ['he', 'en']) {
        const host = fixture.nativeElement as HTMLElement;
        host.style.width = '300px';
        host.style.boxSizing = 'border-box';
        render(mixedStatesBook(), lang);
        expand('briefs');

        const block = fixture.debugElement.query(By.css('[data-testid="spine-behind-briefs"]'))
          .nativeElement as HTMLElement;
        assertFits(block, `${lang} behind block`);

        const magnitude = fixture.debugElement.query(By.css('[data-testid="spine-behind-magnitude-briefs"]'))
          .nativeElement as HTMLElement;
        expect(magnitude.textContent!.trim().length).withContext(`${lang} behind magnitude non-empty`)
          .toBeGreaterThan(0);
        assertFits(magnitude, `${lang} behind magnitude`);
      }
    });

    it('is a VERTICAL STACK, not a five-column strip: rows descend and each takes the full width', () => {
      at300('he');
      const rows = SPINE_STAGE_ORDER.map(id => row(id).getBoundingClientRect());
      for (let i = 1; i < rows.length; i++) {
        // A horizontal strip would put these side by side, at the same top.
        expect(rows[i].top).withContext(`row ${i} sits below row ${i - 1}`).toBeGreaterThan(rows[i - 1].top);
        // ...and would give each row roughly a fifth of the width. Each row owns nearly all of it.
        expect(rows[i].width).withContext(`row ${i} width`).toBeGreaterThan(300 * 0.8);
      }
    });

    it('never overflows the 300px panel horizontally, in either language', () => {
      for (const lang of ['he', 'en']) {
        at300(lang);
        const el = root();
        expect(el.scrollWidth).withContext(`${lang} horizontal overflow`).toBeLessThanOrEqual(el.clientWidth + 1);
      }
    });

    it('the COMPACT density never overflows the 300px panel horizontally either, in either language', () => {
      for (const lang of ['he', 'en']) {
        const host = fixture.nativeElement as HTMLElement;
        host.style.width = '300px';
        host.style.boxSizing = 'border-box';
        fixture.componentRef.setInput('density', 'compact');
        render(mixedStatesBook(), lang);
        const el = fixture.debugElement.query(By.css('[data-testid="stage-spine-compact"]')).nativeElement as HTMLElement;
        expect(el.scrollWidth).withContext(`${lang} compact horizontal overflow`).toBeLessThanOrEqual(el.clientWidth + 1);
      }
    });

    it('carries NO title attribute anywhere: a tooltip is not an answer to a name that does not fit', () => {
      at300('he');
      expect(root().querySelectorAll('[title]').length).toBe(0);
    });

    it('still fits at the 380px default the old strip already clipped at', () => {
      const host = fixture.nativeElement as HTMLElement;
      host.style.width = '380px';
      render(healthyBook(), 'he');
      nameEls().forEach((el, i) => {
        expect(el.textContent!.trim()).toBe(STAGE_NAMES[SPINE_STAGE_ORDER[i]].he);
        expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
      });
    });
  });

  // ── The empty book: the exact live contradiction the brief reproduced ──────────────────────────────

  describe('the empty book', () => {
    beforeEach(() => render(signals({ chapters: [], chaptersWithText: 0 })));

    it('lights Import, blocks the review naming the briefs, and claims NOTHING is done', () => {
      expect(stateOf('import')).toBe('not-started');
      expect(stateOf('briefs')).toBe('blocked');
      expect(stateOf('review')).toBe('blocked');
      expect(stateOf('chapter-passes')).toBe('blocked');
      // w4: the screen exists, so stage 5 says the TRUE thing about this book - there is nothing to put in
      // a file yet - instead of the old "no export screen". Blocked by Import, which is the server's 409.
      expect(stateOf('export')).toBe('blocked');
      expect(root().querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('opens the Import row by default and offers the import there', () => {
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="spine-action-import"]'))).not.toBeNull();
    });

    it('names the missing prerequisite on the blocked review row, in words', () => {
      expand('review');
      expect(text('[data-testid="spine-blocked-review"]')).toContain(STAGE_NAMES['import'].he);
    });

    it('offers a WALKABLE fix on the blocked review row, not one that dead-ends on another blocked row', () => {
      // The `blocked` contract is two halves: name the prerequisite AND offer the way to fix it. This row
      // used to offer `build-briefs`, but stage 2 is itself blocked on an empty book, so pressing it landed
      // the user on a briefs row that could not build - the diagnosis was right and the fix went nowhere.
      // The only action a user can actually walk from an empty book is the import, and that is what it must
      // emit; the briefs prerequisite is still named once chapters exist and it is the real one.
      expand('review');
      const emitted: StageActionEvent[] = [];
      component.stageAction.subscribe(e => emitted.push(e));
      (fixture.debugElement.query(By.css('[data-testid="spine-action-review"]')).nativeElement as HTMLElement).click();
      expect(emitted).toEqual([{ stage: 'review', action: 'open-import' }]);
    });

    it('offers the SAME one walkable action on every blocked row, so the empty book has one CTA', () => {
      const emitted: StageActionEvent[] = [];
      component.stageAction.subscribe(e => emitted.push(e));
      for (const stage of ['briefs', 'review', 'chapter-passes', 'export'] as const) {
        expand(stage);
        (fixture.debugElement.query(By.css(`[data-testid="spine-action-${stage}"]`)).nativeElement as HTMLElement).click();
      }
      expect(emitted.map(e => e.action)).toEqual(['open-import', 'open-import', 'open-import', 'open-import']);
    });
  });

  // ── Every state renders from seeded signals ───────────────────────────────────────────────────────

  describe('state rendering', () => {
    it('renders the state token for each of the six vocabulary states, in Hebrew', () => {
      render(signals({ chapters: [], chaptersWithText: 0 }));
      expect(text('[data-testid="spine-stage-state-import"]')).toBe(STATE_LABELS['not-started'].he);
      expect(text('[data-testid="spine-stage-state-briefs"]')).toBe(STATE_LABELS['blocked'].he);
      expect(text('[data-testid="spine-stage-state-export"]')).toBe(STATE_LABELS['blocked'].he);

      render(signals({
        chapters: chapters(2, ['ch-0']), chaptersWithText: 2,
        summary: summary({ ready: false, staleCount: 2 }), review: review({ activeBuildJobId: 'j' }),
      }));
      expect(text('[data-testid="spine-stage-state-import"]')).toBe(STATE_LABELS['ready'].he);
      expect(text('[data-testid="spine-stage-state-briefs"]')).toBe(STATE_LABELS['behind'].he);
      expect(text('[data-testid="spine-stage-state-review"]')).toBe(STATE_LABELS['running'].he);
    });

    it('says "not known" rather than a state while the signals have not arrived', () => {
      render(signals());
      expect(stateOf('import')).toBe('unknown');
      expect(stateOf('briefs')).toBe('unknown');
      expect(stateOf('review')).toBe('unknown');
      // And nothing anywhere claims a built artifact.
      expect(root().querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('gives the behind state its own treatment: magnitude, reason and a rebuild, not a failure', () => {
      render(signals({
        chapters: chapters(9), chaptersWithText: 9,
        summary: summary({ ready: false, staleCount: 4, builtWithDifferentModel: true }),
      }));
      expand('briefs');
      expect(stateOf('briefs')).toBe('behind');
      // The magnitude is rendered as its own element, not buried in a sentence.
      expect(text('[data-testid="spine-behind-magnitude-briefs"]')).toContain('4');
      // Both reasons are stated.
      const behind = text('[data-testid="spine-behind-briefs"]');
      expect(behind).toContain('4');
      expect(behind).toContain('הגדרה');
      // The action reads as a REBUILD, because the artifact exists.
      expect(text('[data-testid="spine-action-briefs"]')).toContain('מחדש');
    });

    // ── w4: stage 5 is a real, computed stage ──────────────────────────────────────────────────────
    //
    // It used to render `unavailable` plus a sentence explaining that the app had no export screen. w4 built
    // the screen, so both the state and the sentence are gone; what replaces them is a state derived from
    // the chapters exactly like stage 1's, and an action with somewhere to go.

    it('reads ready and offers the export action on a book that has chapters', () => {
      render(healthyBook());
      expand('export');
      expect(stateOf('export')).toBe('ready');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-action-export"]'))).not.toBeNull();
    });

    it('emits open-export when that action is pressed, so the host can route to the screen', () => {
      render(healthyBook());
      expand('export');
      const emitted: StageActionEvent[] = [];
      component.stageAction.subscribe(e => emitted.push(e));
      (fixture.debugElement.query(By.css('[data-testid="spine-action-export"]')).nativeElement as HTMLElement).click();
      expect(emitted).toEqual([{ stage: 'export', action: 'open-export' }]);
    });

    /**
     * The book with rows and no words. Stage 5 used to render `ready` beside a stage 1 saying "none of them
     * has any text yet", and the download it offered was an empty file.
     */
    it('does not read ready on a book whose chapters are all empty, and says why', () => {
      render(signals({ chapters: chapters(3), chaptersWithText: 0 }));
      expand('export');
      expect(stateOf('export')).toBe('blocked');
      expect(root().querySelectorAll('[data-state="ready"]').length).toBe(0);
      // The blocked sentence names the prerequisite; the detail says what is actually missing, so a
      // blocked row on a book that plainly HAS chapters does not read as the spine being wrong.
      expect(text('[data-testid="spine-blocked-export"]')).toContain(STAGE_NAMES['import'].he);
      const detail = text('[data-testid="spine-export-detail"]');
      expect(detail).toContain('3');
      expect(detail.length).toBeGreaterThan(10);
    });

    it('says the same thing in English, and says nothing extra once a chapter carries text', () => {
      render(signals({ chapters: chapters(3), chaptersWithText: 0 }), 'en');
      expand('export');
      expect(text('[data-testid="spine-export-detail"]').toLowerCase()).toContain('empty');

      render(signals({ chapters: chapters(3), chaptersWithText: 1 }), 'en');
      expand('export');
      expect(stateOf('export')).toBe('ready');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-export-detail"]'))).toBeNull();
    });

    /** Finding 18: `null` is NOT KNOWN, and no sentence may be built from it. */
    it('renders NO count sentence on either stage when the text count has not landed', () => {
      render(signals({ chapters: null, chapterCount: 12, chaptersWithText: null }));
      expand('import');
      expect(stateOf('import')).toBe('unknown');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-import-detail"]'))).toBeNull();
      expand('export');
      expect(stateOf('export')).toBe('unknown');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-export-detail"]'))).toBeNull();
    });

    it('never renders the retired "no export screen" sentence, in either language', () => {
      for (const lang of ['he', 'en'] as const) {
        render(healthyBook(), lang);
        expand('export');
        expect(fixture.debugElement.query(By.css('[data-testid="spine-unavailable-export"]'))).toBeNull();
        expect(stateOf('export')).not.toBe('unavailable');
      }
    });

    it('renders the review progress from the two counts, without deriving open from the others', () => {
      render(healthyBook());
      expand('review');
      const progress = text('[data-testid="spine-progress-review"]');
      expect(progress).toContain('7');
      expect(progress).toContain('23');
      expect(progress).toContain('12');
    });

    /**
     * Finding 30: 23 findings, 7 resolved, 12 open leaves 4 `acknowledged` - a bucket neither field
     * counts. The old sentence ("7 of 23 resolved, 12 still open") named only 19 of the 23, which visibly
     * fails to reconcile beside a ledger that shows a third group. The reconciled sentence must name all
     * three counts so 7 + 4 + 12 = 23 actually appears end to end.
     */
    it('names the acknowledged bucket too, so the three counts add back up to the total', () => {
      render(healthyBook());
      expand('review');
      const progress = text('[data-testid="spine-progress-review"]');
      expect(progress).toContain('4');
      expect(progress).toContain('7');
      expect(progress).toContain('23');
      expect(progress).toContain('12');
    });

    /** Finding 32: digits embedded inside this sentence are isolated (unicode-bidi), same as the marker/
     *  chapter-order/behind-magnitude spans - just at the string level, since this count has no DOM
     *  element of its own. */
    it('isolates the digits inside the review progress sentence', () => {
      render(healthyBook());
      expand('review');
      const nums = fixture.debugElement.query(By.css('[data-testid="spine-progress-review"]'))
        .queryAll(By.css('.iso'));
      expect(nums.length).withContext('one isolated span per embedded count').toBeGreaterThanOrEqual(3);
    });

    /** Finding 32: same treatment for stage 1's import detail. */
    it('isolates the digits inside the import detail sentence', () => {
      render(signals({ chapters: chapters(3), chaptersWithText: 2 }));
      expand('import');
      const nums = fixture.debugElement.query(By.css('[data-testid="spine-import-detail"]'))
        .queryAll(By.css('.iso'));
      expect(nums.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Stage 4: an entry point, never a tick ─────────────────────────────────────────────────────────

  describe('stage 4 renders as a per-chapter entry point', () => {
    it('shows a per-chapter marker instead of a book-level state', () => {
      render(healthyBook());
      expect(stateOf('chapter-passes')).toBe('per-chapter');
      expect(text('[data-testid="spine-stage-state-chapter-passes"]')).toBe('לפי פרק');
    });

    it('opens a chapter list and emits the chosen chapter', () => {
      render(healthyBook());
      expand('chapter-passes');
      (fixture.debugElement.query(By.css('[data-testid="spine-chapters-toggle"]')).nativeElement as HTMLElement).click();
      fixture.detectChanges();

      const items = fixture.debugElement.queryAll(By.css('[data-testid^="spine-chapter-ch-"]'));
      expect(items.length).toBe(4);

      const picked: ChapterPassSignal[] = [];
      component.openChapter.subscribe(c => picked.push(c));
      (items[2].nativeElement as HTMLElement).click();
      expect(picked.map(c => c.chapterId)).toEqual(['ch-2']);
    });

    it('marks the chapters that have a pass in flight, and only those', () => {
      render(signals({ chapters: chapters(4, ['ch-1']), chaptersWithText: 4, summary: summary(), review: review() }));
      expand('chapter-passes');
      (fixture.debugElement.query(By.css('[data-testid="spine-chapters-toggle"]')).nativeElement as HTMLElement).click();
      fixture.detectChanges();

      expect(stateOf('chapter-passes')).toBe('running');
      const running = fixture.debugElement.queryAll(By.css('.chapter-running'));
      expect(running.length).toBe(1);
    });
  });

  // ── Language and direction, both ways ─────────────────────────────────────────────────────────────

  describe('book-scoped language and direction', () => {
    it('renders Hebrew right to left for a Hebrew book', () => {
      render(healthyBook(), 'he');
      expect(root().getAttribute('dir')).toBe('rtl');
      expect(text('[data-testid="spine-stage-name-review"]')).toBe(STAGE_NAMES['review'].he);
    });

    it('renders English left to right for an ENGLISH book, even though the app default is Hebrew', () => {
      render(healthyBook(), 'en');
      expect(root().getAttribute('dir')).toBe('ltr');
      SPINE_STAGE_ORDER.forEach(id => {
        expect(text(`[data-testid="spine-stage-name-${id}"]`)).toBe(STAGE_NAMES[id].en);
      });
    });

    it('falls back to Hebrew, the primary language, when the book language is unset', () => {
      render(healthyBook(), null);
      expect(root().getAttribute('dir')).toBe('rtl');
      expect(text('[data-testid="spine-stage-name-import"]')).toBe(STAGE_NAMES['import'].he);
    });

    it('carries no untranslated state token in either language', () => {
      for (const lang of ['he', 'en'] as const) {
        render(signals({ chapters: [], chaptersWithText: 0 }), lang);
        expect(text('[data-testid="spine-stage-state-briefs"]')).toBe(STATE_LABELS['blocked'][lang]);
        expect(text('[data-testid="spine-stage-state-export"]')).toBe(STATE_LABELS['blocked'][lang]);
      }
    });
  });

  // ── Progressive disclosure ────────────────────────────────────────────────────────────────────────

  describe('self-explaining rows', () => {
    it('opens the stage that wants something, so one row always explains itself unprompted', () => {
      render(signals({
        chapters: chapters(3), chaptersWithText: 3, summary: summary(),
        review: review({ hasReview: false, ready: false, findingCount: 0, openFindingCount: 0, resolvedFindingCount: 0 }),
      }));
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-review"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-briefs"]'))).toBeNull();
    });

    it('lets the user open any row, and keeps their choice when new signals land', () => {
      render(healthyBook());
      expand('import');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();

      // A status poll lands, changing the focus stage. The user's open row must not move under them.
      render(signals({ chapters: chapters(4), chaptersWithText: 4, summary: summary({ ready: false, staleCount: 1 }) }));
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();
    });

    it('closes a row when its own head is pressed again', () => {
      render(healthyBook());
      clickHead('import');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();
      clickHead('import');
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).toBeNull();
    });

    it('explains every stage, in both languages, with no empty explanation', () => {
      for (const lang of ['he', 'en'] as const) {
        render(healthyBook(), lang);
        for (const id of SPINE_STAGE_ORDER) {
          expand(id);
          expect(text(`[data-testid="spine-stage-body-${id}"] .stage-line--explain`).length)
            .withContext(`${id} explanation in ${lang}`).toBeGreaterThan(10);
        }
      }
    });
  });

  // ── The standing copy constraints ─────────────────────────────────────────────────────────────────

  describe('copy constraints', () => {
    /** Render every stage, expanded, in one language and return all of the spine's visible text. */
    function allText(lang: 'he' | 'en'): string {
      let out = '';
      for (const id of SPINE_STAGE_ORDER) {
        for (const seed of [
          signals({ chapters: [], chaptersWithText: 0 }),
          signals({ chapters: chapters(3, ['ch-0']), chaptersWithText: 0 }),
          signals({
            chapters: chapters(3), chaptersWithText: 3,
            summary: summary({ ready: false, staleCount: 2, summaryCoversBuiltChapters: false, builtWithDifferentModel: true }),
            review: review({ ready: false, staleVsBriefs: true, builtWithDifferentModel: true }),
          }),
          signals({ chapters: chapters(3), chaptersWithText: 3, summary: summary(), review: review(), exportSurfaceAvailable: true }),
        ]) {
          render(seed, lang);
          expand(id);
          out += root().textContent ?? '';
        }
      }
      return out;
    }

    it('uses no em-dash and no en-dash, in either language', () => {
      expect(allText('he')).not.toMatch(/[–—]/);
      expect(allText('en')).not.toMatch(/[–—]/);
    });

    it('names no model, vendor or provider, in either language', () => {
      const forbidden = /gemma|ollama|openai|gpt|claude|anthropic|azure|nemotron|dicta|mistral|llama/i;
      expect(allText('he')).not.toMatch(forbidden);
      expect(allText('en')).not.toMatch(forbidden);
    });

    it('does not call the out of date state an error or a failure', () => {
      render(signals({ chapters: chapters(3), chaptersWithText: 3, summary: summary({ ready: false, staleCount: 2 }) }), 'en');
      expand('briefs');
      const behind = text('[data-testid="spine-behind-briefs"]').toLowerCase();
      expect(behind).not.toContain('error');
      expect(behind).not.toContain('fail');
      expect(behind).toContain('rebuild');
    });
  });

  // ── THE COMPACT DENSITY (Wave 3 / w3) ─────────────────────────────────────────────────────────────
  //
  // Compact is a DENSITY of this component, not a second component: same derivation, same state
  // vocabulary, same copy module with the same language argument. What it may do differently is show
  // LESS - and these tests pin exactly how much less, and that the "less" is stated honestly rather than
  // guessed, because that is the rule the books list would otherwise break by fetching per row.

  describe('the compact density', () => {
    /** Render compact. Same inputs as the full density plus the density switch. */
    function renderCompact(next: StageSpineSignals, bookLanguage: string | null = 'he'): void {
      fixture.componentRef.setInput('density', 'compact');
      fixture.componentRef.setInput('bookLanguage', bookLanguage);
      fixture.componentRef.setInput('signals', next);
      fixture.detectChanges();
    }

    function compactRoot(): HTMLElement {
      return fixture.debugElement.query(By.css('[data-testid="stage-spine-compact"]')).nativeElement as HTMLElement;
    }

    function pip(id: string): HTMLElement {
      return fixture.debugElement.query(By.css(`[data-testid="spine-compact-pip-${id}"]`)).nativeElement as HTMLElement;
    }

    function summaryLine(): string {
      return (fixture.debugElement.query(By.css('[data-testid="spine-compact-summary"]'))
        .nativeElement as HTMLElement).textContent!.trim();
    }

    it('renders the five stages as pips, in canonical order, and NOT the full rows', () => {
      renderCompact(healthyBook());
      const pips = fixture.debugElement.queryAll(By.css('[data-testid^="spine-compact-pip-"]'));
      expect(pips.length).toBe(5);
      expect(pips.map(p => (p.nativeElement as HTMLElement).dataset['testid']!.replace('spine-compact-pip-', '')))
        .toEqual([...SPINE_STAGE_ORDER]);
      // The full density must not be mounted too: one spine, one indicator.
      expect(fixture.debugElement.query(By.css('[data-testid="stage-spine"]'))).toBeNull();
    });

    it('drives stage 1 from the BOOKS-LIST counts alone, with no chapter list at all', () => {
      // Exactly what GET /api/books gives a row: two numbers and nothing else.
      renderCompact(signals({ chapters: null, chapterCount: 5, chaptersWithText: 5 }));
      expect(pip('import').dataset['state']).toBe('ready');

      renderCompact(signals({ chapters: null, chapterCount: 0, chaptersWithText: 0 }));
      expect(pip('import').dataset['state']).toBe('not-started');
      // And an empty book still says the three dependent stages cannot start yet. That is computed, not
      // assumed: with zero chapters a build has nothing to read.
      expect(pip('briefs').dataset['state']).toBe('blocked');
      expect(pip('review').dataset['state']).toBe('blocked');
      expect(pip('chapter-passes').dataset['state']).toBe('blocked');
    });

    it('says NOT KNOWN HERE for a stage the surface has no signal for, in both languages', () => {
      // A books-list row: chapters counted, briefs and review never fetched.
      const listRow = signals({ chapters: null, chapterCount: 5, chaptersWithText: 5 });

      renderCompact(listRow, 'he');
      expect(pip('briefs').dataset['state']).toBe('unknown');
      expect(pip('briefs').textContent).toContain('לא ידוע מכאן');
      // It must NOT claim the stage is loading: on this surface nothing further is coming.
      expect(pip('briefs').textContent).not.toContain('נטען');
      // And it must never invent a settled state.
      expect(pip('briefs').textContent).not.toContain(STATE_LABELS['ready'].he);
      expect(pip('briefs').textContent).not.toContain(STATE_LABELS['not-started'].he);

      renderCompact(listRow, 'en');
      expect(pip('briefs').textContent).toContain('Not known here');
      expect(pip('briefs').textContent).not.toContain('Loading');
      expect(pip('briefs').textContent).not.toContain(STATE_LABELS['ready'].en);
    });

    it('carries every pip full stage name and state for assistive technology, never an abbreviation', () => {
      renderCompact(healthyBook(), 'he');
      for (const id of SPINE_STAGE_ORDER) {
        expect(pip(id).textContent).toContain(STAGE_NAMES[id].he);
      }
      // Nothing in the compact density carries a tooltip either: the 2.6 rule holds at both densities.
      expect(compactRoot().querySelectorAll('[title]').length).toBe(0);
    });

    it('names the FOCUS stage in its one line of text when nothing is running, in both languages', () => {
      const empty = signals({ chapters: [], chapterCount: 0, chaptersWithText: 0 });

      renderCompact(empty, 'he');
      expect(summaryLine()).toContain(STAGE_NAMES['import'].he);
      expect(summaryLine()).toContain(STATE_LABELS['not-started'].he);

      renderCompact(empty, 'en');
      expect(summaryLine()).toContain(STAGE_NAMES['import'].en);
      expect(summaryLine()).toContain(STATE_LABELS['not-started'].en);
    });

    /**
     * w8 / E1, and it is a RENDERED-OUTPUT claim rather than a focus-function one: the line is prefixed
     * with `הבא:` / "Next:", so whatever stage it names is being called the next thing to do.
     *
     * The books-list payload is the whole defect. A row carries two counts and nothing else, so stage 1
     * settles (`ready`, the manuscript is in) while stages 2 to 5 are permanently `unknown` - and the old
     * unknown fallback read "any stage unknown -> stage 1", which on this payload is not a first-paint
     * condition that resolves but the steady state of the surface. Every books-list row with a manuscript
     * therefore rendered `הבא: ייבוא, מוכן`: a FINISHED stage announced as next.
     *
     * The assertion is deliberately about what the line must NOT say. A test that only pinned the new
     * answer would pass again the moment the fallback drifted to any other settled stage.
     */
    it('never calls a SETTLED stage next: a books-list row with a manuscript does not summarise Import', () => {
      // Exactly what GET /api/books gives a row, on a book that has already been imported.
      const listRow = signals({ chapters: null, chapterCount: 5, chaptersWithText: 5 });

      renderCompact(listRow, 'he');
      // Premise, so this cannot pass vacuously on a payload that failed to settle stage 1.
      expect(pip('import').dataset['state']).toBe('ready');
      expect(pip('briefs').dataset['state']).toBe('unknown');
      expect(summaryLine()).toContain('הבא:');
      expect(summaryLine()).not.toContain(STAGE_NAMES['import'].he);
      expect(summaryLine()).not.toContain(STATE_LABELS['ready'].he);
      // It names the first stage this screen cannot speak for, and admits it cannot speak for it.
      expect(summaryLine()).toContain(STAGE_NAMES['briefs'].he);
      expect(summaryLine()).toContain(COMPACT_UNKNOWN_LABEL.he);

      renderCompact(listRow, 'en');
      expect(summaryLine()).toContain('Next:');
      expect(summaryLine()).not.toContain(STAGE_NAMES['import'].en);
      expect(summaryLine()).not.toContain(STATE_LABELS['ready'].en);
      expect(summaryLine()).toContain(STAGE_NAMES['briefs'].en);
      expect(summaryLine()).toContain(COMPACT_UNKNOWN_LABEL.en);
    });

    it('a RUNNING stage takes over the line, even when an earlier stage also wants attention', () => {
      // Stage 1 is not-started (chapters exist, none has text) AND a briefs build is in flight. The
      // running build wins: carrying that signal on every route is this density's whole job.
      renderCompact(signals({
        chapters: chapters(3), chapterCount: 3, chaptersWithText: 0, summaryRunning: true,
      }), 'he');
      expect(pip('briefs').dataset['state']).toBe('running');
      expect(summaryLine()).toContain('בונה עכשיו');
      expect(summaryLine()).toContain(STAGE_NAMES['briefs'].he);

      renderCompact(signals({
        chapters: chapters(3), chapterCount: 3, chaptersWithText: 0, reviewRunning: true,
      }), 'en');
      expect(summaryLine()).toContain('Building now');
      expect(summaryLine()).toContain(STAGE_NAMES['review'].en);
    });

    it('mirrors with the BOOK language, not with the surface it is mounted on', () => {
      renderCompact(healthyBook(), 'he');
      expect(compactRoot().getAttribute('dir')).toBe('rtl');
      renderCompact(healthyBook(), 'en');
      expect(compactRoot().getAttribute('dir')).toBe('ltr');
      // Null falls back to Hebrew, the primary language - never to the caller's locale.
      renderCompact(healthyBook(), null);
      expect(compactRoot().getAttribute('dir')).toBe('rtl');
    });

    it('is presentational: no buttons, so it cannot trap a row or a bar that owns its own controls', () => {
      renderCompact(signals({ chapters: [], chapterCount: 0, chaptersWithText: 0 }));
      expect(compactRoot().querySelectorAll('button').length).toBe(0);
      expect(compactRoot().querySelectorAll('a').length).toBe(0);
    });

    it('uses no em-dash and no en-dash, in either language', () => {
      for (const lang of ['he', 'en']) {
        for (const seed of [
          signals({ chapters: null, chapterCount: 0, chaptersWithText: 0 }),
          signals({ chapters: null, chapterCount: 5, chaptersWithText: 5 }),
          signals({ chapters: chapters(3), chapterCount: 3, chaptersWithText: 3, summaryRunning: true }),
          healthyBook(),
        ]) {
          renderCompact(seed, lang);
          expect(compactRoot().textContent ?? '').not.toMatch(/[–—]/);
        }
      }
    });
  });

  // ── THE GLANCE CONTRACT: BLOCKED MAY NOT READ AS PROGRESS ─────────────────────────────────────────
  //
  // These are RENDERED-PIXEL tests, not token tests: everything below is read back with
  // getComputedStyle from a real Chrome layout, so they hold whatever the tokens are renamed to and
  // fail if a later restyle puts `blocked` back into a progress tint.
  //
  // The defect they close was found live on /books. `blocked` was drawn in the secondary teal ramp -
  // filled, saturated, solid-bordered - exactly the visual class `ready` occupies. In the compact
  // density every pip's label is `pd-visually-hidden`, so colour is all a sighted reader gets, and the
  // EMPTY book (one not-started stage plus four blocked ones) showed five filled pips while a book with
  // real chapters showed two filled and three hollow. The book with nothing done read as further along
  // than the books with work in them - the same glance-level lie, one surface over, that this whole wave
  // exists to remove. The text and the accessible names were honest the entire time, which is why only
  // the drawing changed.

  describe('the glance contract: blocked may not read as progress', () => {
    /** Parse any computed colour into channels. Chrome returns `rgb()` / `rgba()`. */
    function channels(value: string): { r: number; g: number; b: number; a: number } {
      const n = value.match(/[\d.]+/g)!.map(Number);
      return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
    }

    /** WCAG relative luminance. */
    function luminance(c: { r: number; g: number; b: number }): number {
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    }

    /** WCAG contrast ratio between two computed colours. */
    function contrast(fg: string, bg: string): number {
      const [a, b] = [luminance(channels(fg)), luminance(channels(bg))];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    /** The state chip of a full-density row. */
    function chip(id: string): HTMLElement {
      return fixture.debugElement.query(By.css(`[data-testid="spine-stage-state-${id}"]`)).nativeElement as HTMLElement;
    }

    function renderCompact(next: StageSpineSignals, bookLanguage: string | null = 'he'): void {
      fixture.componentRef.setInput('density', 'compact');
      fixture.componentRef.setInput('bookLanguage', bookLanguage);
      fixture.componentRef.setInput('signals', next);
      fixture.detectChanges();
    }

    function pips(): HTMLElement[] {
      return fixture.debugElement.queryAll(By.css('[data-testid^="spine-compact-pip-"]'))
        .map(p => p.nativeElement as HTMLElement);
    }

    /** A pip is "filled" when it carries an actual (non-transparent) background. */
    function filledPips(): string[] {
      return pips()
        .filter(p => channels(getComputedStyle(p).backgroundColor).a > 0)
        .map(p => p.dataset['state']!);
    }

    /** A books-list row for a book with NOTHING done: no chapters at all. */
    const emptyBookRow = () => signals({ chapters: null, chapterCount: 0, chaptersWithText: 0 });
    /** A books-list row for a book with REAL WORK in it: chapters, all of them written. */
    const workedBookRow = () => signals({ chapters: null, chapterCount: 5, chaptersWithText: 5 });

    it('THE FINDING: the empty book never shows more filled pips than a book with real work', () => {
      // This is the defect stated as an assertion. The states themselves are unchanged and honest -
      // what was wrong was that four of them were PAINTED as though something had happened.
      renderCompact(emptyBookRow());
      const empty = filledPips();
      expect(empty).toEqual(['not-started']);   // only the stage that is actually asking for a move

      renderCompact(workedBookRow());
      const worked = filledPips();
      expect(worked).toEqual(['ready', 'ready']);

      expect(empty.length).toBeLessThan(worked.length);
    });

    it('holds in English too, since the pips are the same drawing in both directions', () => {
      renderCompact(emptyBookRow(), 'en');
      const empty = filledPips();
      renderCompact(workedBookRow(), 'en');
      expect(empty.length).toBeLessThan(filledPips().length);
    });

    it('draws every blocked pip unfilled, and every computed-progress pip filled', () => {
      renderCompact(emptyBookRow());
      for (const p of pips()) {
        const alpha = channels(getComputedStyle(p).backgroundColor).a;
        if (p.dataset['state'] === 'blocked') expect(alpha).toBe(0);
        else expect(alpha).toBeGreaterThan(0);
      }
    });

    it('gives the blocked pip a NON-COLOUR mark, because its label is visually hidden', () => {
      // Colour alone is not an accessible signal, and this density has no visible label to fall back on.
      // The mark is a strike drawn as a background stripe; what matters to this test is that it EXISTS
      // and that nothing which actually happened wears it.
      renderCompact(emptyBookRow());
      const blocked = pips().find(p => p.dataset['state'] === 'blocked')!;
      expect(getComputedStyle(blocked).backgroundImage).toContain('gradient');

      const notStarted = pips().find(p => p.dataset['state'] === 'not-started')!;
      expect(getComputedStyle(notStarted).backgroundImage).toBe('none');
      renderCompact(workedBookRow());
      for (const p of pips()) expect(getComputedStyle(p).backgroundImage).toBe('none');
    });

    it('keeps blocked distinguishable from the no-signal pips it now sits beside', () => {
      // Both are honestly "no progress", but they mean different things - a computed prerequisite versus
      // a surface that never asked - so the drawing must not collapse them into one another.
      renderCompact(signals({ chapters: null, chapterCount: 3, chaptersWithText: 0 }));
      const blocked = pips().find(p => p.dataset['state'] === 'blocked');
      const unknown = pips().find(p => p.dataset['state'] === 'unknown');
      expect(blocked).toBeTruthy();
      expect(unknown).toBeTruthy();
      expect(getComputedStyle(blocked!).borderStyle).not.toBe(getComputedStyle(unknown!).borderStyle);
      expect(getComputedStyle(blocked!).backgroundImage).toContain('gradient');
      expect(getComputedStyle(unknown!).backgroundImage).toBe('none');
    });

    it('keeps the blocked pip legible: its digit, its mark and its edge clear the accessible ratios', () => {
      renderCompact(emptyBookRow());
      const blocked = pips().find(p => p.dataset['state'] === 'blocked')!;
      // The compact spine is mounted on the app surface, which is the plain white row background.
      const surface = 'rgb(255, 255, 255)';
      const ink = getComputedStyle(blocked).color;
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
      // The strike is drawn in `currentColor`, so the digit's ink is the mark's ink; the edge is the one
      // other non-text mark that identifies the state and takes the 3:1 bar.
      expect(getComputedStyle(blocked).backgroundImage).toContain(ink);
      expect(contrast(getComputedStyle(blocked).borderTopColor, surface)).toBeGreaterThanOrEqual(3);
    });

    it('draws the full-density blocked chip out of the neutral ramp, not a progress tint', () => {
      render(emptyBookRow());
      const blockedBg = getComputedStyle(chip('briefs')).backgroundColor;
      const blockedInk = getComputedStyle(chip('briefs')).color;

      render(healthyBook());
      const readyBg = getComputedStyle(chip('briefs')).backgroundColor;
      const readyInk = getComputedStyle(chip('briefs')).color;

      expect(blockedBg).not.toBe(readyBg);
      expect(blockedInk).not.toBe(readyInk);

      // The no-progress family, stated positively: blocked is drawn like the honest "not known", which is
      // the other thing on this spine that reports no work done.
      render(signals({ chapters: chapters(3), chapterCount: 3, chaptersWithText: 3 }));
      expect(getComputedStyle(chip('briefs')).backgroundColor).toBe(blockedBg);
    });

    it('keeps the full-density blocked chip and its prerequisite sentence readable', () => {
      render(emptyBookRow());
      const c = getComputedStyle(chip('briefs'));
      expect(contrast(c.color, c.backgroundColor)).toBeGreaterThanOrEqual(4.5);

      expand('briefs');
      const sentence = fixture.debugElement.query(By.css('[data-testid="spine-blocked-briefs"]'))
        .nativeElement as HTMLElement;
      const rowBg = getComputedStyle(row('briefs')).backgroundColor;
      expect(contrast(getComputedStyle(sentence).color, rowBg)).toBeGreaterThanOrEqual(4.5);
    });
  });

  // ── Wave 3 / w6 (Q13-A): the pointer from a row into the guide that answers it ────────────────────

  describe('the stage -> guide pointer (w6)', () => {
    /** A book with no chapters at all: four of the five rows are blocked, which is the point. */
    const emptyBook = () => signals({ chapters: [], chapterCount: 0, chaptersWithText: 0 });

    /**
     * EVERY row, in EVERY state. "What is this stage" is asked at least as often from a blocked row as
     * from a ready one, so a pointer that only appeared on rows with work done would be missing exactly
     * where a first-run author needs it. The empty book is the state in which four of the five rows are
     * blocked, which is what makes it the right fixture for this claim.
     */
    it('offers the guide link on every stage, on a book with nothing in it', () => {
      render(emptyBook());

      for (const stage of SPINE_STAGE_ORDER) {
        expand(stage);
        const link = fixture.debugElement.query(By.css(`[data-testid="spine-guide-${stage}"]`));
        expect(link).withContext(`no guide link on ${stage}`).toBeTruthy();
        expect((link.nativeElement as HTMLElement).textContent!.trim())
          .toBe(STAGE_GUIDE_LINK_LABEL.he);
      }
    });

    /**
     * It EMITS rather than navigating. The spine owns no Router by design (adding one would put a
     * provider in every host's TestBed), and the whole link travels so the host never re-derives the join.
     */
    it('emits the resolved link for the stage that was pressed, and navigates nowhere itself', () => {
      render(healthyBook());
      const seen: StageGuideLink[] = [];
      component.openGuide.subscribe(link => seen.push(link));

      expand('review');
      (fixture.debugElement.query(By.css('[data-testid="spine-guide-review"]'))
        .nativeElement as HTMLElement).click();

      expect(seen.length).toBe(1);
      expect(seen[0]).toEqual(stageGuideLink('review'));
      expect(seen[0].guideId).toBe('whole-book-review');
    });

    /**
     * THE ONE ROW WHOSE GUIDE IS BROADER THAN ITS STAGE says so before the author follows it. Asserted
     * against the rendered DOM on both sides, so "only briefs" is a property of the render and not only
     * of the map.
     */
    it('warns on the briefs row only, that its guide covers more than the stage', () => {
      render(healthyBook());

      expand('briefs');
      expect(text('[data-testid="spine-guide-note-briefs"]')).toBe(STAGE_GUIDE_BROADER_NOTE.he);

      for (const stage of SPINE_STAGE_ORDER.filter(s => s !== 'briefs')) {
        expand(stage);
        expect(fixture.debugElement.query(By.css(`[data-testid="spine-guide-note-${stage}"]`)))
          .withContext(`${stage} must not claim its guide is broader`).toBeNull();
      }
    });

    /** he/en parity, in the render rather than in the map. */
    it('renders the pointer in the BOOK language, both ways', () => {
      render(healthyBook(), 'en');
      expand('export');
      expect(text('[data-testid="spine-guide-export"]')).toBe(STAGE_GUIDE_LINK_LABEL.en);

      render(healthyBook(), 'he');
      expand('export');
      expect(text('[data-testid="spine-guide-export"]')).toBe(STAGE_GUIDE_LINK_LABEL.he);
    });

    /** Compact is a five-pip rail with no rows to hang a link on, and deliberately non-interactive. */
    it('does not appear in the compact density', () => {
      fixture.componentRef.setInput('density', 'compact');
      render(healthyBook());

      expect(fixture.debugElement.queryAll(By.css('[data-testid^="spine-guide-"]')).length).toBe(0);
    });
  });
});
