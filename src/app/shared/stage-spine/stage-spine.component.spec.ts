import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { BookReviewStatusDto } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { StageActionEvent, StageSpineComponent } from './stage-spine.component';
import { STAGE_NAMES, STATE_LABELS } from './stage-spine.copy';
import { ChapterPassSignal, SPINE_STAGE_ORDER, StageSpineSignals } from './stage-spine.model';

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
    summaryRunning: false, reviewRunning: false, exportSurfaceAvailable: false, ...overrides,
  };
}

/** A fully built, fully current book: every stage that CAN be ready, is. */
function healthyBook(): StageSpineSignals {
  return signals({
    chapters: chapters(4), chaptersWithText: 4, summary: summary(), review: review(),
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

    it('shows all five HEBREW names IN FULL at 300px, with no clipping and no ellipsis', () => {
      at300('he');

      const expected = SPINE_STAGE_ORDER.map(id => STAGE_NAMES[id].he);
      expect(expected).toEqual(['ייבוא', 'תקצירי ספר', 'עריכה התפתחותית', 'מעברי עריכה על פרק', 'ייצוא']);

      nameEls().forEach((el, i) => {
        const ctx = `stage name "${expected[i]}"`;
        // 1. The WHOLE name is in the DOM, character for character.
        expect(el.textContent!.trim()).withContext(ctx).toBe(expected[i]);
        // 2. Nothing is cut off horizontally: the text fits inside its own box (it wraps if it must).
        expect(el.scrollWidth).withContext(`${ctx} horizontal clip`).toBeLessThanOrEqual(el.clientWidth + 1);
        // 3. Nothing is cut off vertically either, which is how a wrapped name gets hidden instead.
        expect(el.scrollHeight).withContext(`${ctx} vertical clip`).toBeLessThanOrEqual(el.clientHeight + 1);
        // 4. The two mechanisms the brief FORBIDS are absent, not merely unused at this width.
        const style = getComputedStyle(el);
        expect(style.textOverflow).withContext(`${ctx} text-overflow`).not.toBe('ellipsis');
        expect(style.whiteSpace).withContext(`${ctx} white-space`).not.toBe('nowrap');
        // 5. And the name is genuinely rendered, not a zero-size box that trivially satisfies the above.
        expect(el.getBoundingClientRect().width).withContext(`${ctx} width`).toBeGreaterThan(8);
        expect(el.getBoundingClientRect().height).withContext(`${ctx} height`).toBeGreaterThan(6);
      });
    });

    it('shows all five ENGLISH names IN FULL at 300px (the mirror pass)', () => {
      at300('en');
      const expected = SPINE_STAGE_ORDER.map(id => STAGE_NAMES[id].en);
      nameEls().forEach((el, i) => {
        expect(el.textContent!.trim()).toBe(expected[i]);
        expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
        expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight + 1);
        expect(getComputedStyle(el).textOverflow).not.toBe('ellipsis');
        expect(getComputedStyle(el).whiteSpace).not.toBe('nowrap');
      });
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
      expect(stateOf('export')).toBe('unavailable');
      expect(root().querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('opens the Import row by default and offers the import there', () => {
      expect(fixture.debugElement.query(By.css('[data-testid="spine-stage-body-import"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="spine-action-import"]'))).not.toBeNull();
    });

    it('names the missing prerequisite on the blocked review row, in words', () => {
      expand('review');
      expect(text('[data-testid="spine-blocked-review"]')).toContain(STAGE_NAMES['briefs'].he);
    });

    it('offers the FIX on the blocked review row, not just the diagnosis', () => {
      expand('review');
      const emitted: StageActionEvent[] = [];
      component.stageAction.subscribe(e => emitted.push(e));
      (fixture.debugElement.query(By.css('[data-testid="spine-action-review"]')).nativeElement as HTMLElement).click();
      expect(emitted).toEqual([{ stage: 'review', action: 'build-briefs' }]);
    });
  });

  // ── Every state renders from seeded signals ───────────────────────────────────────────────────────

  describe('state rendering', () => {
    it('renders the state token for each of the six vocabulary states, in Hebrew', () => {
      render(signals({ chapters: [], chaptersWithText: 0 }));
      expect(text('[data-testid="spine-stage-state-import"]')).toBe(STATE_LABELS['not-started'].he);
      expect(text('[data-testid="spine-stage-state-briefs"]')).toBe(STATE_LABELS['blocked'].he);
      expect(text('[data-testid="spine-stage-state-export"]')).toBe(STATE_LABELS['unavailable'].he);

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
      expect(behind).toContain('תצורה');
      // The action reads as a REBUILD, because the artifact exists.
      expect(text('[data-testid="spine-action-briefs"]')).toContain('מחדש');
    });

    it('states the honest reason for the unavailable export stage', () => {
      render(healthyBook());
      expand('export');
      expect(stateOf('export')).toBe('unavailable');
      expect(text('[data-testid="spine-unavailable-export"]').length).toBeGreaterThan(20);
    });

    it('renders the review progress from the two counts, without deriving open from the others', () => {
      render(healthyBook());
      expand('review');
      const progress = text('[data-testid="spine-progress-review"]');
      expect(progress).toContain('7');
      expect(progress).toContain('23');
      expect(progress).toContain('12');
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
        expect(text('[data-testid="spine-stage-state-export"]')).toBe(STATE_LABELS['unavailable'][lang]);
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
});
