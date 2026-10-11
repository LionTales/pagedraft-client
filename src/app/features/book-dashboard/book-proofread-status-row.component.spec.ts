/**
 * c6: the whole-book proofread row on the book dashboard.
 *
 * The row adds no poller: it follows the parent job through the registry. So the registry here is a
 * FAKE with a real BehaviorSubject behind `jobById$`, and each test drives the parent job's status the
 * way the registry would, including its terminal. Every service call is a Subject held open, so the
 * in-flight windows (status read behind the consent, the start POST, the cancel) are observable.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { BookProofreadStatusRowComponent, outcomeOf } from './book-proofread-status-row.component';
import { BookProofreadService } from '../../core/services/book-proofread.service';
import { JobRegistryService, TrackedJob, TrackMeta } from '../../core/services/job-registry.service';
import { BookProofreadStatusDto, StartBookProofreadResponse } from '../../core/models/book-proofread';
import { PROOFREAD_STRINGS_EN, PROOFREAD_STRINGS_HE, proofreadString } from '../../core/i18n/proofread-strings';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';

function makeStatus(overrides: Partial<BookProofreadStatusDto> = {}): BookProofreadStatusDto {
  return {
    activeJobId: null,
    chaptersWithText: 3,
    chaptersWithActiveProofread: 0,
    chaptersStale: 0,
    lastRunAt: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<TrackedJob> = {}): TrackedJob {
  return {
    id: 'BP1',
    kind: 'book-proofread',
    bookId: 'book-1',
    scopeLabel: 'הספר כולו',
    titleHe: 'הגהת ספר שלם',
    titleEn: 'Whole-book proofread',
    status: 'running',
    percent: 0,
    completedChunks: 0,
    totalChunks: 3,
    chunkClock: EMPTY_CHUNK_CLOCK,
    message: '',
    startedAt: '2026-10-11T10:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    ...overrides,
  };
}

/** The registry, reduced to what the row and its inline progress bar read. */
class FakeRegistry {
  readonly jobs = new BehaviorSubject<TrackedJob[]>([]);
  readonly trackCalls: Array<{ kind: string; bookId: string; jobId: string; meta: TrackMeta }> = [];

  track(kind: string, bookId: string, jobId: string, meta: TrackMeta = {}): void {
    this.trackCalls.push({ kind, bookId, jobId, meta });
    if (!this.jobs.value.some(j => j.id === jobId)) {
      this.jobs.next([...this.jobs.value, makeJob({ id: jobId, bookId })]);
    }
  }

  jobById$(jobId: string): Observable<TrackedJob | null> {
    return this.jobs.pipe(map(js => js.find(j => j.id === jobId) ?? null), distinctUntilChanged());
  }

  set(job: TrackedJob): void {
    this.jobs.next([...this.jobs.value.filter(j => j.id !== job.id), job]);
  }
}

describe('BookProofreadStatusRowComponent (c6)', () => {
  let fixture: ComponentFixture<BookProofreadStatusRowComponent>;
  let component: BookProofreadStatusRowComponent;
  let registry: FakeRegistry;
  let statusCalls: Array<Subject<BookProofreadStatusDto>>;
  let startCalls: Array<{ args: [string, string, boolean]; reply: Subject<StartBookProofreadResponse> }>;
  let cancelCalls: Array<{ args: [string, string]; reply: Subject<unknown> }>;

  beforeEach(async () => {
    registry = new FakeRegistry();
    statusCalls = [];
    startCalls = [];
    cancelCalls = [];
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
      cancel: (bookId: string, jobId: string) => {
        const reply = new Subject<unknown>();
        cancelCalls.push({ args: [bookId, jobId], reply });
        return reply.asObservable();
      },
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

  function init(lang: 'he' | 'en', opts: { chapterCount?: number | null; chaptersWithText?: number | null } = {}): void {
    component.bookId = 'book-1';
    component.bookLanguage = lang;
    component.chapterCount = opts.chapterCount === undefined ? 3 : opts.chapterCount;
    component.chaptersWithText = opts.chaptersWithText === undefined ? 3 : opts.chaptersWithText;
    component.ngOnChanges({
      bookId: new SimpleChange(null, 'book-1', true),
      bookLanguage: new SimpleChange(null, lang, true),
    });
    fixture.detectChanges();
  }

  /** Answer the latest status read. */
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

  function startResponse(overrides: Partial<StartBookProofreadResponse> = {}): StartBookProofreadResponse {
    return {
      jobId: 'BP1', started: true, skippedFresh: 0, plannedChapters: 3, estimatedChunks: 12, estimatedSeconds: 480,
      ...overrides,
    };
  }

  /** Drive idle -> consent -> confirmed -> running. */
  function startRun(lang: 'he' | 'en', resp = startResponse()): void {
    init(lang);
    answerStatus(makeStatus());
    el('bpr-start')!.click();
    answerStatus(makeStatus());
    el('bpr-consent-confirm')!.click();
    startCalls[startCalls.length - 1].reply.next(resp);
    fixture.detectChanges();
  }

  it('renders nothing until the status has answered', () => {
    init('he');
    expect(el('book-proofread-row')).toBeNull();
  });

  for (const lang of ['he', 'en'] as const) {
    const S = lang === 'he' ? PROOFREAD_STRINGS_HE : PROOFREAD_STRINGS_EN;
    const t = (k: Parameters<typeof proofreadString>[1], p?: Record<string, string | number>) => proofreadString(lang, k, p);

    describe(`state matrix (${lang})`, () => {
      it('[dir] follows the book language', () => {
        init(lang);
        answerStatus(makeStatus());
        expect(el('book-proofread-row')!.getAttribute('dir')).toBe(lang === 'he' ? 'rtl' : 'ltr');
      });

      it('IDLE, never proofread: title, the idle hint and the start action', () => {
        init(lang);
        answerStatus(makeStatus());
        expect(fixture.nativeElement.textContent).toContain(S.title);
        expect(text('bpr-idle-hint')).toBe(S.idleHint);
        expect(text('bpr-start')).toBe(S.startButton);
        expect(el('bpr-run-again')).toBeNull();
        expect(el('bpr-coverage')).toBeNull();
      });

      it('STALE: coverage, the stale note, and a normal (non-forced) start', () => {
        init(lang);
        answerStatus(makeStatus({ chaptersWithActiveProofread: 3, chaptersStale: 1, lastRunAt: new Date().toISOString() }));
        expect(text('bpr-coverage')).toContain(t('coverage', { done: 3, total: 3 }));
        expect(text('bpr-stale')).toBe(t('staleNote', { count: 1 }));
        expect(el('bpr-start')).not.toBeNull();
      });

      it('ALL FRESH: says so and offers only the explicit run-again path', () => {
        init(lang);
        answerStatus(makeStatus({ chaptersWithActiveProofread: 3 }));
        expect(text('bpr-nothing-to-do')).toBe(S.nothingToDo);
        expect(text('bpr-run-again')).toBe(S.runAgainButton);
        expect(el('bpr-start')).toBeNull();
        expect(el('bpr-stale')).toBeNull();
      });

      it('BLOCKED (chapters with no text): the action is disabled WITH its reason', () => {
        init(lang, { chapterCount: 2, chaptersWithText: 0 });
        answerStatus(makeStatus({ chaptersWithText: 0 }));
        expect((el('bpr-start') as HTMLButtonElement).disabled).toBeTrue();
        expect(text('bpr-blocked')).toBe(S.needsText);
      });

      it('BLOCKED (no chapters): names the import', () => {
        init(lang, { chapterCount: 0, chaptersWithText: 0 });
        answerStatus(makeStatus({ chaptersWithText: 0 }));
        expect(text('bpr-blocked')).toBe(S.needsImport);
      });

      it('CONSENT: re-reads status, then shows planned + skipped chapters and the pace line; starts nothing', () => {
        init(lang);
        answerStatus(makeStatus({ chaptersWithActiveProofread: 2, chaptersStale: 1 }));
        el('bpr-start')!.click();
        fixture.detectChanges();
        expect((el('bpr-start') as HTMLButtonElement).disabled).withContext('disabled while the read runs').toBeTrue();
        expect(el('bpr-consent')).toBeNull();
        answerStatus(makeStatus({ chaptersWithActiveProofread: 2, chaptersStale: 1 }));
        // 3 with text, 1 fresh (2 active - 1 stale) -> 2 planned, 1 skipped.
        expect(text('bpr-consent-body')).toBe(t('consentBody', { chapters: 2 }));
        expect(text('bpr-consent-skipped')).toBe(t('consentSkipped', { skipped: 1 }));
        expect(text('bpr-consent-pace')).toBe(S.consentPace);
        expect(el('bpr-consent-rerun')).toBeNull();
        expect(startCalls.length).toBe(0);
      });

      it('CONSENT (forced): every chapter, and says it replaces the current suggestions', () => {
        init(lang);
        answerStatus(makeStatus({ chaptersWithActiveProofread: 3 }));
        el('bpr-run-again')!.click();
        answerStatus(makeStatus({ chaptersWithActiveProofread: 3 }));
        expect(text('bpr-consent-body')).toBe(t('consentBody', { chapters: 3 }));
        expect(text('bpr-consent-rerun')).toBe(S.consentRerun);
        el('bpr-consent-confirm')!.click();
        expect(startCalls[0].args).toEqual(['book-1', lang, true]);
      });

      it('RUNNING: counts off the registry job, the inline bar, the server ETA and a cancel action', () => {
        startRun(lang);
        registry.set(makeJob({ completedChunks: 1, totalChunks: 3, percent: 33 }));
        fixture.detectChanges();
        expect(text('bpr-running')).toBe(t('running', { done: 1, total: 3 }));
        expect(fixture.nativeElement.querySelector('app-job-progress-inline')).not.toBeNull();
        // 480 s for 3 chapters, 2 to go -> 320 s -> "about 6 minutes".
        expect(text('bpr-eta')).toContain(lang === 'he' ? '6' : 'about 6 minutes');
        expect(text('bpr-cancel')).toBe(S.cancelButton);
        expect(el('bpr-start')).toBeNull();
        expect(el('bpr-consent')).toBeNull();
      });

      it('DONE: the summary and the annotated download', () => {
        startRun(lang);
        registry.set(makeJob({ status: 'succeeded', completedChunks: 3, totalChunks: 3, percent: 100 }));
        fixture.detectChanges();
        expect(text('bpr-outcome-done')).toBe(t('doneSummary', { count: 3 }));
        expect(text('bpr-download')).toBe(S.downloadLink);
        expect(el('bpr-running')).toBeNull();
      });

      it('PARTIAL: succeeded short of the plan reads partial, never done', () => {
        startRun(lang);
        registry.set(makeJob({ status: 'succeeded', completedChunks: 2, totalChunks: 3, percent: 100 }));
        fixture.detectChanges();
        expect(text('bpr-outcome-partial')).toBe(t('partial', { done: 2, total: 3 }));
        expect(el('bpr-outcome-done')).toBeNull();
        expect(el('bpr-download')).not.toBeNull();
      });

      it('FAILED: an alert, and no download', () => {
        startRun(lang);
        registry.set(makeJob({ status: 'failed', completedChunks: 0, totalChunks: 3 }));
        fixture.detectChanges();
        expect(text('bpr-outcome-failed')).toBe(S.failed);
        expect(el('bpr-outcome-failed')!.getAttribute('role')).toBe('alert');
        expect(el('bpr-download')).toBeNull();
      });

      it('CANCELED: names how many chapters were kept', () => {
        startRun(lang);
        registry.set(makeJob({ status: 'canceled', completedChunks: 1, totalChunks: 3 }));
        fixture.detectChanges();
        expect(text('bpr-outcome-canceled')).toBe(t('canceled', { done: 1 }));
        expect(el('bpr-download')).not.toBeNull();
      });
    });
  }

  describe('start, track, cancel', () => {
    it('confirm POSTs a NON-forced start and publishes the run to the registry as book-proofread', () => {
      startRun('he');
      expect(startCalls[0].args).toEqual(['book-1', 'he', false]);
      expect(registry.trackCalls).toEqual([{ kind: 'book-proofread', bookId: 'book-1', jobId: 'BP1', meta: {} }]);
      expect(component.running).toBeTrue();
    });

    it('a start that answers started=false shows "nothing to do" and tracks nothing', () => {
      init('en');
      answerStatus(makeStatus());
      el('bpr-start')!.click();
      answerStatus(makeStatus());
      el('bpr-consent-confirm')!.click();
      startCalls[0].reply.next(startResponse({ started: false, jobId: '00000000-0000-0000-0000-000000000000', plannedChapters: 0 }));
      fixture.detectChanges();
      expect(registry.trackCalls.length).toBe(0);
      expect(component.nothingToDo).toBeTrue();
    });

    it('a failed start says so and leaves the action available', () => {
      init('en');
      answerStatus(makeStatus());
      el('bpr-start')!.click();
      answerStatus(makeStatus());
      el('bpr-consent-confirm')!.click();
      startCalls[0].reply.error(new Error('500'));
      fixture.detectChanges();
      expect(text('bpr-error')).toBe(PROOFREAD_STRINGS_EN.startFailed);
      expect((el('bpr-start') as HTMLButtonElement).disabled).toBeFalse();
    });

    it('cancel POSTs the parent id, shows "stopping" and disables itself until the terminal arrives', () => {
      startRun('he');
      el('bpr-cancel')!.click();
      fixture.detectChanges();
      expect(cancelCalls[0].args).toEqual(['book-1', 'BP1']);
      expect(text('bpr-cancel')).toBe(PROOFREAD_STRINGS_HE.cancelling);
      expect((el('bpr-cancel') as HTMLButtonElement).disabled).toBeTrue();
      cancelCalls[0].reply.next({ canceled: true });
      fixture.detectChanges();
      expect(component.running).withContext('still running: the current chapter finishes first').toBeTrue();
      registry.set(makeJob({ status: 'canceled', completedChunks: 1 }));
      fixture.detectChanges();
      expect(component.cancelling).toBeFalse();
      expect(el('bpr-outcome-canceled')).not.toBeNull();
    });

    it('a failed cancel re-enables the button and says so', () => {
      startRun('en');
      el('bpr-cancel')!.click();
      cancelCalls[0].reply.error(new Error('500'));
      fixture.detectChanges();
      expect((el('bpr-cancel') as HTMLButtonElement).disabled).toBeFalse();
      expect(text('bpr-error')).toBe(PROOFREAD_STRINGS_EN.cancelFailed);
    });

    it('the download raises openExport with the annotated book kind', () => {
      const kinds: string[] = [];
      component.openExport.subscribe(k => kinds.push(k));
      startRun('he');
      registry.set(makeJob({ status: 'succeeded', completedChunks: 3 }));
      fixture.detectChanges();
      el('bpr-download')!.click();
      expect(kinds).toEqual(['book-docx-proofread']);
    });

    it('the terminal re-reads status, and a lingering activeJobId for the HANDLED run does not re-attach it', () => {
      startRun('he');
      const readsBefore = statusCalls.length;
      registry.set(makeJob({ status: 'succeeded', completedChunks: 3 }));
      fixture.detectChanges();
      expect(statusCalls.length).toBe(readsBefore + 1);
      answerStatus(makeStatus({ activeJobId: 'BP1', chaptersWithActiveProofread: 3 }));
      expect(component.running).toBeFalse();
      expect(registry.trackCalls.length).toBe(1);
    });
  });

  describe('(c) a run already in flight is shown, never offered a second consent', () => {
    it('on load: status.activeJobId attaches the run (reattached) and offers no start', () => {
      init('he');
      answerStatus(makeStatus({ activeJobId: 'OTHER' }));
      expect(registry.trackCalls).toEqual([{ kind: 'book-proofread', bookId: 'book-1', jobId: 'OTHER', meta: { reattached: true } }]);
      expect(el('bpr-running')).not.toBeNull();
      expect(el('bpr-start')).toBeNull();
      expect(el('bpr-eta')).withContext('a reattached run has no estimate until observed').toBeNull();
    });

    it('on start: a run started elsewhere since the row loaded is attached instead of a consent', () => {
      init('en');
      answerStatus(makeStatus());
      el('bpr-start')!.click();
      answerStatus(makeStatus({ activeJobId: 'OTHER' }));
      expect(el('bpr-consent')).toBeNull();
      expect(component.running).toBeTrue();
      expect(registry.trackCalls[0].jobId).toBe('OTHER');
      expect(startCalls.length).toBe(0);
    });

    it('on confirm: the API handing back an in-flight run follows THAT run', () => {
      startRun('en', startResponse({ jobId: 'OTHER' }));
      expect(registry.trackCalls[0].jobId).toBe('OTHER');
      expect(component.running).toBeTrue();
    });
  });

  describe('context switches', () => {
    it('a book switch drops an open consent and the run being followed', () => {
      init('he');
      answerStatus(makeStatus());
      el('bpr-start')!.click();
      answerStatus(makeStatus());
      expect(el('bpr-consent')).not.toBeNull();
      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
      fixture.detectChanges();
      expect(component.consent).toBeNull();
      expect(el('book-proofread-row')).toBeNull();
    });

    it('a status answer for the PREVIOUS book is dropped', () => {
      init('he');
      const stale = statusCalls[0];
      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
      stale.next(makeStatus({ activeJobId: 'OLD' }));
      expect(component.status).toBeNull();
      expect(registry.trackCalls.length).toBe(0);
    });
  });

  describe('outcomeOf', () => {
    it('maps the parent terminal by chapters proofread vs planned', () => {
      expect(outcomeOf(makeJob({ status: 'succeeded', completedChunks: 3, totalChunks: 3 })).kind).toBe('done');
      expect(outcomeOf(makeJob({ status: 'succeeded', completedChunks: 2, totalChunks: 3 })).kind).toBe('partial');
      expect(outcomeOf(makeJob({ status: 'failed', completedChunks: 0 })).kind).toBe('failed');
      expect(outcomeOf(makeJob({ status: 'canceled', completedChunks: 1 }))).toEqual({ kind: 'canceled', done: 1, total: 3 });
    });
  });
});
