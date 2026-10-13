/**
 * c01 (whole-book proofread fixes): the row when the CLIENT loses the run's poll.
 *
 * The poll keeps going through transient errors now (analysis-progress.service), but a long enough outage
 * still ends it, and before c01 the row then said "failed" for a run the server was still working on, with
 * no way back: it refused to re-attach the same `activeJobId`, and the registry's `track` returned the
 * terminal job ("terminal is forever").
 *
 * Unlike the c6 / c20 row specs this one runs the REAL JobRegistryService, because the defect lives in the
 * hand-off between the two (the registry records who ended the job; the row reads it; the registry resumes
 * on the row's re-track). Only the poll is stubbed: each `pollBookProofreadProgress` subscription gets its
 * own held Subject, so `polls.length` counts the polls the registry actually started (the NEW
 * subscription a re-attach must make), and an outage is `polls[i].error(...)` with the error shape the
 * real poll raises when its budget runs out.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, of } from 'rxjs';

import { BookProofreadStatusRowComponent } from './book-proofread-status-row.component';
import { BookProofreadService } from '../../core/services/book-proofread.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { BookProofreadStatusDto, StartBookProofreadResponse } from '../../core/models/book-proofread';
import { AnalysisProgressDto } from '../../core/models/analysis';
import { PROOFREAD_STRINGS_EN, proofreadCountString } from '../../core/i18n/proofread-strings';

function makeStatus(overrides: Partial<BookProofreadStatusDto> = {}): BookProofreadStatusDto {
  return {
    activeJobId: null,
    chaptersWithText: 3,
    chaptersWithActiveProofread: 0,
    chaptersStale: 0,
    lastRunAt: null,
    plannedChapters: 3,
    estimatedChunks: 6,
    estimatedSeconds: 240,
    forcePlannedChapters: 3,
    forceEstimatedChunks: 6,
    forceEstimatedSeconds: 240,
    unreliableChapters: [],
    ...overrides,
  };
}

function progress(completed: number, status = 'Running'): AnalysisProgressDto {
  return {
    jobId: 'BP1', analysisType: 'Proofread', scope: 'Book', status,
    currentChunk: completed, totalChunks: 3, completedChunks: completed, message: '', estimatedCompletionPercent: 0,
  };
}

/** What the real poll raises when its transient-error budget runs out (any non-404). */
const OUTAGE = new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' });
/** What the real poll raises at once for a job the server does not know. */
const NOT_FOUND = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });

describe('BookProofreadStatusRowComponent: a lost poll (c01)', () => {
  let fixture: ComponentFixture<BookProofreadStatusRowComponent>;
  let component: BookProofreadStatusRowComponent;
  let polls: Array<Subject<AnalysisProgressDto>>;
  let statusCalls: Array<Subject<BookProofreadStatusDto>>;
  let startCalls: Array<Subject<StartBookProofreadResponse>>;

  beforeEach(async () => {
    polls = [];
    statusCalls = [];
    startCalls = [];
    const progressStub = {
      pollBookProofreadProgress: (_b: string, _j: string, stop$: Observable<unknown>) => {
        const s = new Subject<AnalysisProgressDto>();
        polls.push(s);
        stop$.subscribe(() => s.complete());
        return s.asObservable();
      },
    };
    const proofread = {
      getStatus: () => {
        const s = new Subject<BookProofreadStatusDto>();
        statusCalls.push(s);
        return s.asObservable();
      },
      start: () => {
        const s = new Subject<StartBookProofreadResponse>();
        startCalls.push(s);
        return s.asObservable();
      },
      cancel: () => new Subject<unknown>().asObservable(),
    };
    await TestBed.configureTestingModule({
      imports: [BookProofreadStatusRowComponent],
      providers: [
        JobRegistryService,
        { provide: AnalysisProgressService, useValue: progressStub },
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs: () => of([]) } },
        { provide: BookSummaryService, useValue: {} },
        { provide: BookReviewService, useValue: {} },
        { provide: StyleBaselineService, useValue: {} },
        { provide: BookProofreadService, useValue: proofread },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BookProofreadStatusRowComponent);
    component = fixture.componentInstance;
  });

  function el(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return (el(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function answerStatus(status: BookProofreadStatusDto): void {
    statusCalls[statusCalls.length - 1].next(status);
    fixture.detectChanges();
  }

  function runningLine(done: number): string {
    return proofreadCountString('en', 'running', 3, { done, total: 3 });
  }

  /** Start a run (idle -> consent -> confirm -> BP1), and let the poll report 1 of 3 chapters. */
  function startAndProgress(): void {
    component.bookId = 'book-1';
    component.bookLanguage = 'en';
    component.chapterCount = 3;
    component.chaptersWithText = 3;
    component.ngOnChanges({
      bookId: new SimpleChange(null, 'book-1', true),
      bookLanguage: new SimpleChange(null, 'en', true),
    });
    fixture.detectChanges();
    answerStatus(makeStatus());
    el('bpr-start')!.click();
    answerStatus(makeStatus());
    el('bpr-consent-confirm')!.click();
    startCalls[0].next({ jobId: 'BP1', started: true, skippedFresh: 0, plannedChapters: 3, estimatedChunks: 6, estimatedSeconds: 240 });
    fixture.detectChanges();
    expect(polls.length).toBe(1);
    polls[0].next(progress(1));
    fixture.detectChanges();
    expect(text('bpr-running')).toBe(runningLine(1));
  }

  /** The poll's budget runs out: the registry finalizes BP1 as failed, ended by a poll error. */
  function losePoll(index = 0): void {
    polls[index].error(OUTAGE);
    fixture.detectChanges();
  }

  it('a lost poll asks the status, and keeps showing the run (no premature "failed") while it waits', () => {
    startAndProgress();
    const readsBefore = statusCalls.length;
    losePoll();
    expect(statusCalls.length).withContext('the loss triggers ONE status read').toBe(readsBefore + 1);
    expect(el('bpr-outcome-failed')).toBeNull();
    expect(text('bpr-running')).toBe(runningLine(1));
    expect(el('bpr-start')).withContext('no Start offered for a run that may be going on').toBeNull();
  });

  it('status still lists BP1: the row re-attaches (a NEW poll), shows running and the counts, never "failed"', () => {
    startAndProgress();
    losePoll();
    answerStatus(makeStatus({ activeJobId: 'BP1' }));
    expect(polls.length).withContext('the registry resumed the poll for the re-attached run').toBe(2);
    expect(component.running).toBeTrue();
    expect(text('bpr-running')).toBe(runningLine(1));
    expect(el('bpr-outcome-failed')).toBeNull();

    polls[1].next(progress(2));
    fixture.detectChanges();
    expect(text('bpr-running')).toBe(runningLine(2));

    polls[1].next(progress(3, 'Succeeded'));
    fixture.detectChanges();
    expect(el('bpr-outcome-done')).not.toBeNull();
    expect(el('bpr-outcome-failed')).toBeNull();
  });

  it('status no longer lists it: the run is reported failed (the window settles)', () => {
    startAndProgress();
    losePoll();
    answerStatus(makeStatus());
    expect(text('bpr-outcome-failed')).toBe(PROOFREAD_STRINGS_EN.failed);
    expect(component.running).toBeFalse();
    expect(polls.length).toBe(1);
  });

  it('the status read itself fails: the run is reported failed, never left hanging', () => {
    startAndProgress();
    losePoll();
    statusCalls[statusCalls.length - 1].error(new Error('500'));
    fixture.detectChanges();
    expect(text('bpr-outcome-failed')).toBe(PROOFREAD_STRINGS_EN.failed);
    expect(component.running).toBeFalse();
  });

  it('after a settled failure, a start answered with started=true BP1 re-attaches instead of the stale failure', () => {
    startAndProgress();
    losePoll();
    statusCalls[statusCalls.length - 1].error(new Error('500'));
    fixture.detectChanges();
    expect(el('bpr-outcome-failed')).not.toBeNull();

    el('bpr-start')!.click();
    answerStatus(makeStatus());
    el('bpr-consent-confirm')!.click();
    startCalls[1].next({ jobId: 'BP1', started: true, skippedFresh: 0, plannedChapters: 3, estimatedChunks: 6, estimatedSeconds: 240 });
    fixture.detectChanges();

    expect(polls.length).withContext('a NEW poll for the same id').toBe(2);
    expect(component.running).toBeTrue();
    expect(el('bpr-outcome-failed')).toBeNull();
    expect(text('bpr-running')).toBe(runningLine(1));
  });

  it('after a settled failure, a later status listing BP1 re-attaches (the lost run is not a handled one)', () => {
    startAndProgress();
    losePoll();
    statusCalls[statusCalls.length - 1].error(new Error('500'));
    fixture.detectChanges();

    el('bpr-start')!.click();
    answerStatus(makeStatus({ activeJobId: 'BP1' }));
    expect(el('bpr-consent')).toBeNull();
    expect(polls.length).toBe(2);
    expect(component.running).toBeTrue();
    expect(el('bpr-outcome-failed')).toBeNull();
  });

  it('a SERVER-ended parent (404) is not re-attached even if a status still lists it (no re-poll loop)', () => {
    startAndProgress();
    polls[0].error(NOT_FOUND);
    fixture.detectChanges();
    expect(text('bpr-outcome-failed')).toBe(PROOFREAD_STRINGS_EN.failed);
    answerStatus(makeStatus({ activeJobId: 'BP1' }));
    expect(polls.length).toBe(1);
    expect(component.running).toBeFalse();
    expect(el('bpr-outcome-failed')).not.toBeNull();
  });
});
