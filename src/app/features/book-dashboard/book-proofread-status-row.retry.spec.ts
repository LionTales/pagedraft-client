/**
 * c20: the whole-book proofread row's "retry the failed chapters" path. A chapter that fails in a run keeps
 * its previous result, which the server counts as fresh, so a normal start skips it; the status lists it in
 * `failedChapters` and the row offers a retry of exactly those through the same consent.
 *
 * Same harness shape as book-proofread-status-row.component.spec.ts (a fake registry with a real
 * BehaviorSubject behind `jobById$`, every service call a Subject held open), kept in its own file so the
 * c6 spec stays under the file-size ceiling.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { BookProofreadStatusRowComponent } from './book-proofread-status-row.component';
import { BookProofreadService } from '../../core/services/book-proofread.service';
import { JobRegistryService, TrackedJob, TrackMeta } from '../../core/services/job-registry.service';
import {
  BookProofreadFailedChapter, BookProofreadStatusDto, StartBookProofreadResponse,
} from '../../core/models/book-proofread';
import { PROOFREAD_STRINGS_EN, PROOFREAD_STRINGS_HE, proofreadString } from '../../core/i18n/proofread-strings';
import { formatEtaLabel } from '../../core/i18n/run-strings';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';

/** Every chapter fresh (so a normal start plans nothing), plus whatever failed list the test names. */
function makeStatus(failed: BookProofreadFailedChapter[] | undefined, overrides: Partial<BookProofreadStatusDto> = {}): BookProofreadStatusDto {
  const status: BookProofreadStatusDto = {
    activeJobId: null,
    chaptersWithText: 3,
    chaptersWithActiveProofread: 3,
    chaptersStale: 0,
    lastRunAt: new Date().toISOString(),
    plannedChapters: 0,
    estimatedChunks: 0,
    estimatedSeconds: 0,
    forcePlannedChapters: 3,
    forceEstimatedChunks: 6,
    forceEstimatedSeconds: 240,
    unreliableChapters: [],
    ...overrides,
  };
  if (failed !== undefined) {
    status.failedChapters = failed;
    status.failedEstimatedChunks = failed.length * 2;
    status.failedEstimatedSeconds = failed.length * 80;
  }
  return { ...status, ...overrides };
}

const YOMANO: BookProofreadFailedChapter = { chapterId: 'c-2', title: 'יומנו', order: 1 };
const EILON: BookProofreadFailedChapter = { chapterId: 'c-1', title: 'אילון', order: 0 };

function makeJob(overrides: Partial<TrackedJob> = {}): TrackedJob {
  return {
    id: 'BP1', kind: 'book-proofread', bookId: 'book-1', scopeLabel: 'הספר כולו',
    titleHe: 'הגהת ספר שלם', titleEn: 'Whole-book proofread', status: 'running', percent: 0,
    completedChunks: 0, totalChunks: 3, chunkClock: EMPTY_CHUNK_CLOCK, message: '',
    startedAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z',
    ...overrides,
  };
}

class FakeRegistry {
  readonly jobs = new BehaviorSubject<TrackedJob[]>([]);
  readonly trackCalls: Array<{ kind: string; bookId: string; jobId: string; meta: TrackMeta }> = [];

  track(kind: string, bookId: string, jobId: string, meta: TrackMeta = {}): void {
    this.trackCalls.push({ kind, bookId, jobId, meta });
    if (!this.jobs.value.some(j => j.id === jobId)) this.jobs.next([...this.jobs.value, makeJob({ id: jobId, bookId })]);
  }

  jobById$(jobId: string): Observable<TrackedJob | null> {
    return this.jobs.pipe(map(js => js.find(j => j.id === jobId) ?? null), distinctUntilChanged());
  }

  set(job: TrackedJob): void {
    this.jobs.next([...this.jobs.value.filter(j => j.id !== job.id), job]);
  }
}

describe('BookProofreadStatusRowComponent: retry the failed chapters (c20)', () => {
  let fixture: ComponentFixture<BookProofreadStatusRowComponent>;
  let component: BookProofreadStatusRowComponent;
  let registry: FakeRegistry;
  let statusCalls: Array<Subject<BookProofreadStatusDto>>;
  let startCalls: Array<{ args: [string, string, boolean]; reply: Subject<StartBookProofreadResponse> }>;
  let startFailedCalls: Array<{ args: [string, string]; reply: Subject<StartBookProofreadResponse> }>;

  beforeEach(async () => {
    registry = new FakeRegistry();
    statusCalls = [];
    startCalls = [];
    startFailedCalls = [];
    const service = {
      getStatus: () => {
        const s = new Subject<BookProofreadStatusDto>();
        statusCalls.push(s);
        return s.asObservable();
      },
      start: (bookId: string, language: string, force: boolean) => {
        const reply = new Subject<StartBookProofreadResponse>();
        startCalls.push({ args: [bookId, language, force], reply });
        return reply.asObservable();
      },
      startFailed: (bookId: string, language: string) => {
        const reply = new Subject<StartBookProofreadResponse>();
        startFailedCalls.push({ args: [bookId, language], reply });
        return reply.asObservable();
      },
      cancel: () => new Subject<unknown>().asObservable(),
    };
    await TestBed.configureTestingModule({
      imports: [BookProofreadStatusRowComponent],
      providers: [
        { provide: BookProofreadService, useValue: service },
        { provide: JobRegistryService, useValue: registry },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BookProofreadStatusRowComponent);
    component = fixture.componentInstance;
  });

  function init(lang: 'he' | 'en'): void {
    component.bookId = 'book-1';
    component.bookLanguage = lang;
    component.chapterCount = 3;
    component.chaptersWithText = 3;
    component.ngOnChanges({
      bookId: new SimpleChange(null, 'book-1', true),
      bookLanguage: new SimpleChange(null, lang, true),
    });
    fixture.detectChanges();
  }

  function answerStatus(status: BookProofreadStatusDto): void {
    statusCalls[statusCalls.length - 1].next(status);
    fixture.detectChanges();
  }

  function el(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return (el(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function items(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid="bpr-failed-list"] li'))
      .map(li => ((li as HTMLElement).textContent ?? '').trim());
  }

  function startResponse(overrides: Partial<StartBookProofreadResponse> = {}): StartBookProofreadResponse {
    return { jobId: 'BP2', started: true, skippedFresh: 0, plannedChapters: 1, estimatedChunks: 2, estimatedSeconds: 80, ...overrides };
  }

  for (const lang of ['he', 'en'] as const) {
    const S = lang === 'he' ? PROOFREAD_STRINGS_HE : PROOFREAD_STRINGS_EN;
    const t = (k: Parameters<typeof proofreadString>[1], p?: Record<string, string | number>) => proofreadString(lang, k, p);

    describe(`(${lang})`, () => {
      it('ONE failed chapter: the singular note, its 1-based number and title, the singular retry, no "nothing to do"', () => {
        init(lang);
        answerStatus(makeStatus([YOMANO]));
        expect(text('bpr-failed-note')).toBe(S.failedNoteOne);
        expect(items()).toEqual([t('failedChapterItem', { number: 2, title: 'יומנו' })]);
        expect(items()[0]).toContain(lang === 'he' ? 'פרק 2' : 'Chapter 2'); // stored order 1, never "1"
        expect(text('bpr-retry-failed')).toBe(S.retryFailedButtonOne);
        // Every chapter is fresh, which would say "nothing to do": the failed note wins.
        expect(el('bpr-nothing-to-do')).toBeNull();
        expect(el('bpr-run-again')).not.toBeNull();
      });

      it('TWO failed chapters: the plural note with the count, both in reading order, the plural retry', () => {
        init(lang);
        answerStatus(makeStatus([EILON, YOMANO]));
        expect(text('bpr-failed-note')).toBe(t('failedNote', { count: 2 }));
        expect(items()).toEqual([
          t('failedChapterItem', { number: 1, title: 'אילון' }),
          t('failedChapterItem', { number: 2, title: 'יומנו' }),
        ]);
        expect(text('bpr-retry-failed')).toBe(S.retryFailedButton);
      });

      it('an untitled failed chapter is named by its number alone', () => {
        init(lang);
        answerStatus(makeStatus([{ chapterId: 'c-9', title: '  ', order: 4 }]));
        expect(items()).toEqual([t('failedChapterItemUntitled', { number: 5 })]);
      });

      it('RETRY CONSENT: re-reads status, then names the failed chapter with the onlyFailed ETA; starts nothing yet', () => {
        init(lang);
        answerStatus(makeStatus([YOMANO]));
        el('bpr-retry-failed')!.click();
        fixture.detectChanges();
        expect(statusCalls.length).toBe(2);
        expect((el('bpr-retry-failed') as HTMLButtonElement).disabled).toBeTrue(); // in flight
        answerStatus(makeStatus([YOMANO], { failedEstimatedSeconds: 200 } as Partial<BookProofreadStatusDto>));

        expect(el('bpr-consent')).not.toBeNull();
        expect(el('bpr-consent')!.textContent).toContain(S.consentRetryTitleOne);
        expect(text('bpr-consent-body')).toBe(S.consentRetryBodyOne);
        expect(text('bpr-consent-eta')).toBe(formatEtaLabel(lang, 200_000, 'total'));
        expect(el('bpr-consent-rerun')).toBeNull();
        expect(el('bpr-consent-skipped')).toBeNull();
        expect((el('bpr-retry-failed') as HTMLButtonElement).disabled).toBeTrue(); // a consent is open
        expect(startCalls.length + startFailedCalls.length).toBe(0);
      });

      it('RETRY CONSENT for two: the plural title and the body with the count', () => {
        init(lang);
        answerStatus(makeStatus([EILON, YOMANO]));
        el('bpr-retry-failed')!.click();
        answerStatus(makeStatus([EILON, YOMANO]));
        expect(el('bpr-consent')!.textContent).toContain(S.consentRetryTitle);
        expect(text('bpr-consent-body')).toBe(t('consentRetryBody', { chapters: 2 }));
      });

      it('an estimate of 0 renders no ETA line on the retry consent', () => {
        init(lang);
        answerStatus(makeStatus([YOMANO]));
        el('bpr-retry-failed')!.click();
        answerStatus(makeStatus([YOMANO], { failedEstimatedSeconds: 0 } as Partial<BookProofreadStatusDto>));
        expect(el('bpr-consent')).not.toBeNull();
        expect(el('bpr-consent-eta')).toBeNull();
      });
    });
  }

  describe('start and outcome', () => {
    it('confirming the retry calls startFailed (never start) and tracks the run as book-proofread', () => {
      init('he');
      answerStatus(makeStatus([YOMANO]));
      el('bpr-retry-failed')!.click();
      answerStatus(makeStatus([YOMANO]));
      el('bpr-consent-confirm')!.click();
      fixture.detectChanges();

      expect(startCalls.length).toBe(0);
      expect(startFailedCalls.map(c => c.args)).toEqual([['book-1', 'he']]);
      startFailedCalls[0].reply.next(startResponse());
      fixture.detectChanges();

      expect(registry.trackCalls.map(c => [c.kind, c.jobId])).toEqual([['book-proofread', 'BP2']]);
      expect(el('bpr-running')).not.toBeNull();
      expect(el('bpr-failed')).toBeNull(); // hidden while the retry runs
      // c20 gate: a one-chapter retry reads 'of 1 chapter', never 'of 1 chapters'.
      registry.set(makeJob({ id: 'BP2', completedChunks: 0, totalChunks: 1 }));
      fixture.detectChanges();
      expect(text('bpr-running')).toBe(proofreadString('he', 'runningOne', { done: 0 }));
    });

    it('the retry finishing clean re-reads status, and an empty list drops the block', () => {
      init('en');
      answerStatus(makeStatus([YOMANO]));
      el('bpr-retry-failed')!.click();
      answerStatus(makeStatus([YOMANO]));
      el('bpr-consent-confirm')!.click();
      startFailedCalls[0].reply.next(startResponse());
      fixture.detectChanges();
      registry.set(makeJob({ id: 'BP2', status: 'succeeded', completedChunks: 1, totalChunks: 1, percent: 100 }));
      fixture.detectChanges();

      expect(text('bpr-outcome-done')).toBe(PROOFREAD_STRINGS_EN.doneSummaryOne);
      answerStatus(makeStatus([]));
      expect(el('bpr-failed')).toBeNull();
    });

    it('a PARTIAL run links straight to the retry: the partial outcome and the failed block side by side', () => {
      init('he');
      answerStatus(makeStatus(undefined, { chaptersWithActiveProofread: 0, plannedChapters: 3, estimatedSeconds: 240 }));
      el('bpr-start')!.click();
      answerStatus(makeStatus(undefined, { chaptersWithActiveProofread: 0, plannedChapters: 3, estimatedSeconds: 240 }));
      el('bpr-consent-confirm')!.click();
      startCalls[0].reply.next(startResponse({ jobId: 'BP1', plannedChapters: 3 }));
      fixture.detectChanges();
      registry.set(makeJob({ id: 'BP1', status: 'succeeded', completedChunks: 2, totalChunks: 3, percent: 100 }));
      fixture.detectChanges();
      answerStatus(makeStatus([YOMANO]));

      expect(text('bpr-outcome-partial')).toBe(proofreadString('he', 'partial', { done: 2, total: 3 }));
      expect(text('bpr-failed-note')).toBe(PROOFREAD_STRINGS_HE.failedNoteOne);
      expect(el('bpr-retry-failed')).not.toBeNull();
    });

    it('a retry whose fresh status lists nothing any more opens no consent and says nothing', () => {
      init('he');
      answerStatus(makeStatus([YOMANO]));
      el('bpr-retry-failed')!.click();
      answerStatus(makeStatus([]));
      expect(el('bpr-consent')).toBeNull();
      expect(el('bpr-failed')).toBeNull();
      expect(startFailedCalls.length).toBe(0);
    });

    it('a retry start answering started=false re-reads status without the "nothing to do" line', () => {
      init('he');
      answerStatus(makeStatus([YOMANO]));
      el('bpr-retry-failed')!.click();
      answerStatus(makeStatus([YOMANO]));
      el('bpr-consent-confirm')!.click();
      startFailedCalls[0].reply.next(startResponse({ started: false, jobId: '00000000-0000-0000-0000-000000000000' }));
      fixture.detectChanges();

      expect(component.nothingToDo).toBeFalse();
      expect(registry.trackCalls.length).toBe(0);
      expect(statusCalls.length).toBe(3);
      answerStatus(makeStatus([]));
      expect(el('bpr-failed')).toBeNull();
    });

    it('an older API without the field shows no failed block', () => {
      init('he');
      answerStatus(makeStatus(undefined));
      expect(el('bpr-failed')).toBeNull();
      expect(el('bpr-nothing-to-do')).not.toBeNull();
    });
  });

  // ── c02: one word per chapter state, on the be-c05 split ─────────────────────────────────────────────
  // Seeded status cells, expectations written from the rule (covered = "N of M proofread", never all of them
  // beside a partial outcome or the failed list; edited = "edited since"; unreliable = "needs proofreading
  // again", unless the failed block already names that chapter), not from running the component.
  describe('c02: coverage, edited and unreliable never contradict each other', () => {
    const NOW = new Date().toISOString();

    /** Idle -> consent -> a run over 3 chapters that ends Succeeded with 2 of 3 done (PARTIAL). */
    function runPartial(lang: 'he' | 'en'): void {
      init(lang);
      const before = makeStatus(undefined, { chaptersWithActiveProofread: 0, lastRunAt: null, plannedChapters: 3, estimatedSeconds: 240 });
      answerStatus(before);
      el('bpr-start')!.click();
      answerStatus(before);
      el('bpr-consent-confirm')!.click();
      startCalls[0].reply.next(startResponse({ jobId: 'BP1', plannedChapters: 3 }));
      fixture.detectChanges();
      registry.set(makeJob({ id: 'BP1', status: 'succeeded', completedChunks: 2, totalChunks: 3, percent: 100 }));
      fixture.detectChanges();
    }

    for (const lang of ['he', 'en'] as const) {
      const S = lang === 'he' ? PROOFREAD_STRINGS_HE : PROOFREAD_STRINGS_EN;
      const t = (k: Parameters<typeof proofreadString>[1], p?: Record<string, string | number>) => proofreadString(lang, k, p);
      const allOf3 = t('coverage', { done: 3, total: 3 });
      const editedWords = lang === 'he' ? 'נערך' : 'edited since';

      it(`(${lang}) ONE unreliable chapter after a partial run: "2 of 3", never "edited since", the unreliable wording`, () => {
        runPartial(lang);
        // be-c05: the unreliable chapter is not covered and not edited; the in-memory failed record does not
        // list it (an API restart, or an older server without the field).
        answerStatus(makeStatus([], {
          chaptersWithActiveProofread: 2, chaptersEdited: 0, chaptersUnreliable: 1, chaptersStale: 1,
          lastRunAt: NOW, plannedChapters: 1, unreliableChapters: [YOMANO],
        }));
        expect(text('bpr-outcome-partial')).toBe(t('partial', { done: 2, total: 3 }));
        expect(text('bpr-coverage')).toContain(t('coverage', { done: 2, total: 3 }));
        expect(fixture.nativeElement.textContent).not.toContain(allOf3);
        expect(el('bpr-stale')).withContext('an unreliable chapter is not "edited since"').toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain(editedWords);
        expect(text('bpr-unreliable')).toBe(S.unreliableNoteOne);
      });

      it(`(${lang}) a partial run whose failed chapter kept its old result: no "3 of 3" beside it`, () => {
        runPartial(lang);
        // The failed chapter's previous reliable result still counts as covered, so the server says 3 of 3.
        answerStatus(makeStatus([YOMANO], { chaptersWithActiveProofread: 3, chaptersEdited: 0, chaptersUnreliable: 0 }));
        expect(text('bpr-outcome-partial')).toBe(t('partial', { done: 2, total: 3 }));
        expect(fixture.nativeElement.textContent).not.toContain(allOf3);
        // The last-run time still stands, and the book is not described as never proofread.
        expect(text('bpr-coverage')).toBe(component.lastRunText);
        expect(component.lastRunText).not.toBe('');
        expect(el('bpr-idle-hint')).toBeNull();
        expect(text('bpr-failed-note')).toBe(S.failedNoteOne);
      });

      it(`(${lang}) an unreliable chapter the failed block names is reported THERE only`, () => {
        runPartial(lang);
        // be-c01: an unreliable result in a whole-book run also lands the chapter in the failed record.
        answerStatus(makeStatus([YOMANO], {
          chaptersWithActiveProofread: 2, chaptersEdited: 0, chaptersUnreliable: 1, chaptersStale: 1,
          unreliableChapters: [YOMANO],
        }));
        expect(items()).toEqual([t('failedChapterItem', { number: 2, title: 'יומנו' })]);
        expect(el('bpr-unreliable')).withContext('the failed block owns this chapter').toBeNull();
        expect(el('bpr-stale')).toBeNull();
        expect(text('bpr-coverage')).toContain(t('coverage', { done: 2, total: 3 }));
      });

      it(`(${lang}) an EDITED chapter keeps the edited wording; unreliable says nothing at 0`, () => {
        init(lang);
        answerStatus(makeStatus([], { chaptersWithActiveProofread: 3, chaptersEdited: 1, chaptersUnreliable: 0, chaptersStale: 1, plannedChapters: 1 }));
        expect(text('bpr-coverage')).toContain(allOf3);
        expect(text('bpr-stale')).toBe(S.staleNoteOne);
        expect(el('bpr-unreliable')).toBeNull();
      });

      it(`(${lang}) edited 2 and unreliable 2 (not failed): each plural on its own line`, () => {
        init(lang);
        answerStatus(makeStatus([], {
          chaptersWithText: 5, chaptersWithActiveProofread: 3, chaptersEdited: 2, chaptersUnreliable: 2, chaptersStale: 4,
          plannedChapters: 4, unreliableChapters: [EILON, YOMANO],
        }));
        expect(text('bpr-stale')).toBe(t('staleNote', { count: 2 }));
        expect(text('bpr-unreliable')).toBe(t('unreliableNote', { count: 2 }));
      });

      it(`(${lang}) an OLDER API without the split: the mixed stale count keeps the old wording, no unreliable note`, () => {
        init(lang);
        const old = makeStatus(undefined, { chaptersWithActiveProofread: 3, chaptersStale: 1, plannedChapters: 1 });
        delete old.chaptersEdited;
        delete old.chaptersUnreliable;
        answerStatus(old);
        expect(text('bpr-stale')).toBe(S.staleNoteOne);
        expect(el('bpr-unreliable')).toBeNull();
        expect(component.freshChapters).withContext('old covered (3) minus old stale (1)').toBe(2);
      });
    }

    it('freshChapters on the split: covered minus EDITED only (an unreliable chapter is not covered any more)', () => {
      init('en');
      answerStatus(makeStatus([], { chaptersWithActiveProofread: 2, chaptersEdited: 1, chaptersUnreliable: 1, chaptersStale: 2 }));
      expect(component.freshChapters).toBe(1);
    });
  });
});
