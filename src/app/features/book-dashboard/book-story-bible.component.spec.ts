/**
 * wb3-c03: BookStoryBibleComponent spec - the Story Bible / continuity ledger (C).
 *
 * Covers:
 *  - Characters section rendered from character-dimension findings (chapter-anchored);
 *  - Threads section: continuity findings classified into open/dangling/resolved by editorial verdict;
 *  - Timeline section: continuity findings that carry >=1 chapter anchor (contradictions);
 *  - per-section empty states + the whole-bible empty state + load error;
 *  - chapter-anchor click emits openChapter with the right ChapterAnchor (wb3-f01 seam);
 *  - the loading window is observed via a held-open Subject (NEVER synchronous of() for the in-flight state);
 *  - he/en label parity (thread-state labels included).
 *
 * Data source: the SAME BookReviewFindingsDto the c02 findings panel reads (premise-verified: no FE endpoint
 * exposes the structured per-entity brief facts, so v1 derives the bible from continuity/character findings).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { BookStoryBibleComponent, ThreadState } from './book-story-bible.component';
import { BookReviewService } from '../../core/services/book-review.service';
import {
  BookFinding,
  BookReviewFindingsDto,
  ChapterAnchor,
  Verdict,
} from '../../core/models/book-review';

function makeFinding(overrides: Partial<BookFinding> = {}): BookFinding {
  return {
    id: 'f-1',
    dimension: 'continuity',
    verdict: 'improve',
    severity: 2,
    rationale: 'Her scar is on the left cheek in ch. 2 but the right in ch. 9.',
    evidence: [{ chapterId: 'c-2', chapterOrder: 2, excerpt: 'The scar ran down her left cheek.' }],
    chapterAnchors: [{ chapterId: 'c-2', order: 2, title: 'The Mark' }],
    suggestedAction: 'Pick one side and reconcile the later mention.',
    status: 'open',
    builtWithModel: 'gemma4:12b',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDto(overrides: Partial<BookReviewFindingsDto> = {}): BookReviewFindingsDto {
  return {
    bookId: 'book-1',
    language: 'he',
    findings: [makeFinding()],
    scores: [],
    ...overrides,
  };
}

describe('BookStoryBibleComponent (wb3-c03)', () => {
  let component: BookStoryBibleComponent;
  let fixture: ComponentFixture<BookStoryBibleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookStoryBibleComponent],
      providers: [
        {
          provide: BookReviewService,
          useValue: { getReviewFindings: () => NEVER },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookStoryBibleComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.bookLanguage = 'he';
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }
  function queryAll(selector: string) {
    return fixture.debugElement.queryAll(By.css(selector));
  }

  /** Trigger the initial load via ngOnChanges (mirrors how the host drives @Inputs). */
  function triggerInit(): void {
    component.ngOnChanges({
      bookId: new SimpleChange(null, component.bookId, true),
    });
  }

  function stubFindings(dto: BookReviewFindingsDto): void {
    const svc = TestBed.inject(BookReviewService);
    spyOn(svc, 'getReviewFindings').and.returnValue(of(dto));
  }

  // ── Characters ───────────────────────────────────────────────────────────────

  it('renders one Characters entry per character-dimension finding (chapter-anchored)', () => {
    stubFindings(
      makeDto({
        findings: [
          makeFinding({ id: 'char-1', dimension: 'character', verdict: 'improve' }),
          makeFinding({ id: 'char-2', dimension: 'character', verdict: 'keep' }),
          makeFinding({ id: 'cont-1', dimension: 'continuity' }), // not a character entry
          makeFinding({ id: 'plot-1', dimension: 'plot' }), // ignored entirely
        ],
      })
    );
    triggerInit();
    fixture.detectChanges();

    expect(component.characterEntries.map((f) => f.id)).toEqual(['char-1', 'char-2']);
    const section = query('[data-testid="bible-characters"]');
    expect(section).not.toBeNull();
    expect(query('[data-testid="bible-entry-char-1"]')).not.toBeNull();
    expect(query('[data-testid="bible-entry-char-2"]')).not.toBeNull();
    // A plot finding is never surfaced anywhere in the bible.
    expect(query('[data-testid="bible-entry-plot-1"]')).toBeNull();
  });

  it('shows the Characters empty hint when there are no character-dimension findings', () => {
    stubFindings(makeDto({ findings: [makeFinding({ id: 'cont-1', dimension: 'continuity' })] }));
    triggerInit();
    fixture.detectChanges();

    expect(component.hasCharacters).toBeFalse();
    expect(query('[data-testid="bible-characters-empty"]')).not.toBeNull();
  });

  // ── Threads ──────────────────────────────────────────────────────────────────

  it('classifies continuity findings into open/dangling/resolved threads by verdict', () => {
    stubFindings(
      makeDto({
        findings: [
          makeFinding({ id: 'open-1', dimension: 'continuity', verdict: 'improve' }),
          makeFinding({ id: 'dangling-1', dimension: 'continuity', verdict: 'cut' }),
          makeFinding({ id: 'resolved-1', dimension: 'continuity', verdict: 'keep' }),
        ],
      })
    );
    triggerInit();
    fixture.detectChanges();

    expect(component.threadStateOf('improve')).toBe('open');
    expect(component.threadStateOf('cut')).toBe('dangling');
    expect(component.threadStateOf('keep')).toBe('resolved');

    expect(component.threadsFor('open').map((f) => f.id)).toEqual(['open-1']);
    expect(component.threadsFor('dangling').map((f) => f.id)).toEqual(['dangling-1']);
    expect(component.threadsFor('resolved').map((f) => f.id)).toEqual(['resolved-1']);

    expect(query('[data-testid="thread-group-open"]')).not.toBeNull();
    expect(query('[data-testid="thread-group-dangling"]')).not.toBeNull();
    expect(query('[data-testid="thread-group-resolved"]')).not.toBeNull();
  });

  it('shows the Threads empty hint when there are no continuity findings', () => {
    stubFindings(makeDto({ findings: [makeFinding({ id: 'char-1', dimension: 'character' })] }));
    triggerInit();
    fixture.detectChanges();

    expect(component.hasThreads).toBeFalse();
    expect(query('[data-testid="bible-threads-empty"]')).not.toBeNull();
  });

  // ── Timeline ─────────────────────────────────────────────────────────────────

  it('renders Timeline entries only for continuity findings that carry a chapter anchor', () => {
    stubFindings(
      makeDto({
        findings: [
          makeFinding({ id: 'anchored', dimension: 'continuity', chapterAnchors: [{ chapterId: 'c-2', order: 2, title: 'The Mark' }] }),
          makeFinding({ id: 'no-anchor', dimension: 'continuity', chapterAnchors: [] }),
          makeFinding({ id: 'char-anchored', dimension: 'character', chapterAnchors: [{ chapterId: 'c-3', order: 3, title: 'X' }] }),
        ],
      })
    );
    triggerInit();
    fixture.detectChanges();

    // Only the anchored CONTINUITY finding is a timeline contradiction.
    expect(component.timelineEntries.map((f) => f.id)).toEqual(['anchored']);
    const timeline = query('[data-testid="bible-timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline.queryAll(By.css('[data-testid^="bible-entry-"]')).map((e) => e.attributes['data-testid'])).toEqual(['bible-entry-anchored']);
  });

  it('shows the Timeline empty hint when no continuity finding has an anchor', () => {
    stubFindings(
      makeDto({ findings: [makeFinding({ id: 'no-anchor', dimension: 'continuity', chapterAnchors: [] })] })
    );
    triggerInit();
    fixture.detectChanges();

    expect(component.hasTimeline).toBeFalse();
    expect(query('[data-testid="bible-timeline-empty"]')).not.toBeNull();
  });

  // ── Expand detail ────────────────────────────────────────────────────────────

  it('expands an entry to show evidence + suggested action on rationale click', () => {
    stubFindings(makeDto({ findings: [makeFinding({ id: 'f-1', dimension: 'continuity' })] }));
    triggerInit();
    fixture.detectChanges();

    expect(query('[data-testid="bible-detail-f-1"]')).toBeNull();
    query('[data-testid="bible-rationale-f-1"]').nativeElement.click();
    fixture.detectChanges();

    const detail = query('[data-testid="bible-detail-f-1"]');
    expect(detail).not.toBeNull();
    const text = detail.nativeElement.textContent as string;
    expect(text).toContain('left cheek'); // evidence excerpt
    expect(text).toContain('Pick one side'); // suggested action
  });

  // ── Empty + loading + error ──────────────────────────────────────────────────

  it('shows the whole-bible empty state when the review has zero findings', () => {
    stubFindings(makeDto({ findings: [] }));
    triggerInit();
    fixture.detectChanges();

    expect(component.isEmpty).toBeTrue();
    expect(query('[data-testid="bible-empty"]')).not.toBeNull();
    expect(query('[data-testid="bible-characters"]')).toBeNull();
  });

  it('shows the loading state while the fetch is in flight (held-open Subject, not yet emitted)', () => {
    const svc = TestBed.inject(BookReviewService);
    const findings$ = new Subject<BookReviewFindingsDto>();
    spyOn(svc, 'getReviewFindings').and.returnValue(findings$.asObservable());

    triggerInit();
    fixture.detectChanges();

    // BEFORE emit: the in-flight loading window is real (the Subject is held open).
    expect(component.loading).toBeTrue();
    expect(query('[data-testid="bible-loading"]')).not.toBeNull();
    expect(query('[data-testid="book-story-bible"]').query(By.css('[data-testid="bible-characters"]'))).toBeNull();

    // AFTER emit: loading clears and the sections render.
    findings$.next(makeDto({ findings: [makeFinding({ id: 'cont-1', dimension: 'continuity' })] }));
    findings$.complete();
    fixture.detectChanges();

    expect(component.loading).toBeFalse();
    expect(query('[data-testid="bible-loading"]')).toBeNull();
    expect(query('[data-testid="bible-threads"]')).not.toBeNull();
  });

  it('shows the error state when the findings fetch fails', () => {
    const svc = TestBed.inject(BookReviewService);
    spyOn(svc, 'getReviewFindings').and.returnValue(throwError(() => new Error('boom')));
    triggerInit();
    fixture.detectChanges();

    expect(component.loadError).toBeTrue();
    expect(query('[data-testid="bible-error"]')).not.toBeNull();
    expect(query('[data-testid="bible-characters"]')).toBeNull();
  });

  // ── Navigation seam (wb3-f01) ────────────────────────────────────────────────

  it('emits openChapter with the anchor when a chapter-anchor chip is clicked', () => {
    stubFindings(makeDto({ findings: [makeFinding({ id: 'f-1', dimension: 'continuity' })] }));
    triggerInit();
    fixture.detectChanges();

    let emitted: ChapterAnchor | null = null;
    component.openChapter.subscribe((a) => (emitted = a));

    query('[data-testid="bible-anchor-f-1-c-2"]').nativeElement.click();

    expect(emitted).not.toBeNull();
    expect(emitted!.chapterId).toBe('c-2');
    expect(emitted!.order).toBe(2);
  });

  // ── Refresh token re-reads ───────────────────────────────────────────────────

  it('re-reads findings when the refreshToken bumps (same book/language)', () => {
    const svc = TestBed.inject(BookReviewService);
    const spy = spyOn(svc, 'getReviewFindings').and.returnValue(of(makeDto()));
    triggerInit();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledTimes(1);

    component.ngOnChanges({ refreshToken: new SimpleChange(0, 1, false) });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── he/en parity ─────────────────────────────────────────────────────────────

  it('renders English labels when the book language is English', () => {
    component.bookLanguage = 'en';
    stubFindings(makeDto({ language: 'en' }));
    triggerInit();
    fixture.detectChanges();

    expect(component.bibleDir).toBe('ltr');
    expect(component.label('charactersTitle')).toBe('Characters');
    expect(component.label('threadsTitle')).toBe('Threads');
    expect(component.label('timelineTitle')).toBe('Timeline');
    expect(component.threadStateLabel('open')).toBe('Open');
    expect(component.threadStateLabel('dangling')).toBe('Dangling');
    expect(component.threadStateLabel('resolved')).toBe('Resolved');
    expect(component.verdictLabel('cut')).toBe('Cut');
  });

  it('every he label/thread-state map covers all enum values (he/en parity, no missing keys)', () => {
    component.bookLanguage = 'he';
    const states: ThreadState[] = ['open', 'resolved', 'dangling'];
    const verdicts: Verdict[] = ['keep', 'improve', 'cut'];
    const chrome = [
      'charactersTitle',
      'threadsTitle',
      'timelineTitle',
      'charactersEmpty',
      'threadsEmpty',
      'timelineEmpty',
      'empty',
      'loadError',
      'loading',
      'chapters',
      'evidence',
      'suggestedAction',
    ];
    for (const s of states) expect(component.threadStateLabel(s)).not.toBe(s);
    for (const v of verdicts) expect(component.verdictLabel(v)).not.toBe(v);
    for (const k of chrome) expect(component.label(k)).not.toBe(k);
  });
});
