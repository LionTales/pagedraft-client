/**
 * c02: a Hebrew book shows NO Latin-script run chrome, ASSERTED ON THE RENDERED DOM.
 *
 * This is deliberately not a map assertion. `run-strings.spec.ts` already proves the map is localized,
 * and the map was never the defect: the run dialog rendered `TrackedJob.message`, the BACKEND's raw
 * English prose ("Running chunk 2/10", "Proofread finished", a .NET exception string), so a perfectly
 * translated map sat unread beside English text in RTL Hebrew chrome next to a localized `בריצה` pill.
 * A map assertion cannot catch a surface that never reads the map. Only reading the DOM can.
 *
 * It drives all THREE progress surfaces from ONE registry job, exactly as `three-surface-parity.spec.ts`
 * drives the percent, because "no Latin anywhere in the run chrome" is a claim about the whole set:
 *   (i)   the run dialog        - app-analysis-run-dialog   (BOOK-scoped chrome: follows bookLanguage)
 *   (ii)  the in-page indicator - app-job-progress-inline   (numbers only)
 *   (iii) the Activity Center   - app-activity-center       (APP-level chrome: Hebrew-default)
 * The two language sources are respected rather than unified: the dialog is told the book is Hebrew,
 * the Activity Center is Hebrew because the app is.
 *
 * The backend messages fed in below are the REAL strings `AnalysisProgressTracker` emits
 * (`ChunkStarted` / `SetStatus`), so a regression that re-binds `job.message` into any template fails
 * here rather than in front of a user.
 */
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideRouter } from '@angular/router';
import { NEVER, ReplaySubject, Subject, of } from 'rxjs';

import { AnalysisRunDialogComponent } from './analysis-run-dialog.component';
import { JobProgressInlineComponent } from '../job-progress-inline/job-progress-inline.component';
import { ActivityCenterComponent } from '../activity-center/activity-center.component';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { AnalysisProgressDto } from '../../core/models/analysis';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { runString } from '../../core/i18n/run-strings';

const JOB_ID = 'JOB-I18N-1';
const BOOK_ID = 'book-1';

@Component({
  standalone: true,
  imports: [AnalysisRunDialogComponent, JobProgressInlineComponent, ActivityCenterComponent],
  template: `
    <app-analysis-run-dialog
      [(open)]="open"
      [runEvents]="events$"
      analysisType="Proofread"
      [bookLanguage]="bookLanguage">
    </app-analysis-run-dialog>

    <app-job-progress-inline [jobId]="jobId"></app-job-progress-inline>

    <app-activity-center></app-activity-center>
  `,
})
class RunChromeHostComponent {
  open = false;
  jobId: string | null = null;
  bookLanguage = 'he';
  events$ = new ReplaySubject<AnalysisRunEvent>(16);
}

function progress(overrides: Partial<AnalysisProgressDto>): AnalysisProgressDto {
  return {
    jobId: JOB_ID,
    analysisType: 'Proofread',
    scope: 'Chapter',
    status: 'Running',
    currentChunk: 0,
    totalChunks: 0,
    completedChunks: 0,
    message: '',
    estimatedCompletionPercent: -1,
    ...overrides,
  };
}

describe('a Hebrew book shows no Latin-script run chrome (c02)', () => {
  let fixture: ComponentFixture<RunChromeHostComponent>;
  let host: RunChromeHostComponent;
  let poll$: Subject<AnalysisProgressDto>;

  const root = () => fixture.nativeElement as HTMLElement;

  /** The visible text of one surface, whitespace-collapsed. */
  function surfaceText(selector: string): string {
    const el = root().querySelector(selector);
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Every Latin letter currently rendered by a surface (empty means "fully localized"). */
  function latinIn(selector: string): string[] {
    return surfaceText(selector).match(/[A-Za-z]+/g) ?? [];
  }

  function assertNoLatinAnywhere(phase: string): void {
    expect(latinIn('.rd-card')).withContext(`run dialog, ${phase}`).toEqual([]);
    expect(latinIn('app-job-progress-inline')).withContext(`in-page indicator, ${phase}`).toEqual([]);
    expect(latinIn('.ac-panel')).withContext(`Activity Center, ${phase}`).toEqual([]);
  }

  async function setUpWith(bookLanguage: string): Promise<void> {
    poll$ = new Subject<AnalysisProgressDto>();

    await TestBed.configureTestingModule({
      imports: [RunChromeHostComponent],
      providers: [
        provideRouter([]),
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => poll$.asObservable(),
            pollBookSummaryProgress: () => NEVER,
            pollBookReviewProgress: () => NEVER,
            pollStyleBaselineProgress: () => NEVER,
          },
        },
        { provide: AnalysisService, useValue: { getActiveAnalysisJobs: () => of([]) } },
        { provide: BookSummaryService, useValue: { getBookSummaryStatus: () => of({ activeBuildJobId: null }) } },
        { provide: BookReviewService, useValue: { getReviewStatus: () => of({ activeBuildJobId: null }) } },
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => of({ activeBuildJobId: null }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RunChromeHostComponent);
    host = fixture.componentInstance;
    host.bookLanguage = bookLanguage;

    TestBed.inject(JobRegistryService)
      .track('proofread', BOOK_ID, JOB_ID, { chapterId: 'ch-1', analysisType: 'Proofread' });
    host.jobId = JOB_ID;
    host.open = true;
    fixture.detectChanges();
    host.events$.next({ kind: 'job-started', jobId: JOB_ID });
    fixture.detectChanges();

    // Open the Activity Center panel so its row is genuinely in the DOM (OnPush: click the real bell).
    (root().querySelector('.ac-bell') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  describe('Hebrew book', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await setUpWith('he');
    });

    it('is non-vacuous: all three surfaces really are mounted and showing this run', () => {
      // Without this, "no Latin letters" would be trivially satisfied by an empty page.
      expect(root().querySelector('.rd-card')).not.toBeNull();
      expect(root().querySelector('.jpi-track')).not.toBeNull();
      expect(root().querySelector('.ac-row')).not.toBeNull();
      expect(surfaceText('.rd-message').length).toBeGreaterThan(0);
    });

    it('renders no Latin chrome MID-RUN, while the backend is sending English chunk prose', () => {
      // The exact string AnalysisProgressTracker.ChunkStarted writes, and the one the user screenshotted
      // rendered raw inside RTL Hebrew chrome.
      poll$.next(progress({
        completedChunks: 2, totalChunks: 10, currentChunk: 3, message: 'Running chunk 3/10',
      }));
      fixture.detectChanges();

      // The percent still lands (parity with the other two surfaces is untouched by this change).
      expect(root().querySelector('.rd-progress-track')!.getAttribute('aria-valuenow')).toBe('20');
      // And the message line is the COMPOSED Hebrew sentence, not the backend's. c04: it now carries
      // the same 2-of-10 the backend prose was carrying, as localized STRUCTURED counts - which is the
      // whole reason option (ii) was chosen over parsing "Running chunk 3/10".
      expect(surfaceText('.rd-message'))
        .toBe(runString('he', 'progressCompleted', { type: 'הגהה', completed: 2, total: 10 }));
      assertNoLatinAnywhere('mid-run');
    });

    it('renders no Latin chrome at a FAILED terminal carrying a raw .NET exception message', () => {
      poll$.next(progress({ completedChunks: 2, totalChunks: 10, message: 'Running chunk 3/10' }));
      fixture.detectChanges();

      // AnalysisController's background catch block sends `ex.Message` verbatim. This is the worst case:
      // untranslatable server text arriving on the one field the dialog used to render.
      poll$.next(progress({
        status: 'Failed',
        completedChunks: 2,
        totalChunks: 10,
        message: 'System.InvalidOperationException: the model returned no content',
      }));
      fixture.detectChanges();

      expect(surfaceText('.rd-message')).toBe(runString('he', 'runFailed', { type: 'הגהה' }));
      assertNoLatinAnywhere('failed terminal');
    });

    it('renders no Latin chrome at a SUCCEEDED terminal carrying the backend "Proofread finished"', () => {
      poll$.next(progress({
        status: 'Succeeded', completedChunks: 10, totalChunks: 10, message: 'Proofread finished',
      }));
      fixture.detectChanges();

      expect(surfaceText('.rd-message')).toBe(runString('he', 'runSucceeded', { type: 'הגהה' }));
      assertNoLatinAnywhere('succeeded terminal');
    });
  });

  // The control. Without it, "no Latin letters" could be satisfied by a dialog that stopped saying
  // anything at all - the assertion has to be about LOCALIZATION, not about silence.
  describe('English book (the control)', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await setUpWith('en');
    });

    it('renders the SAME sentences in English, book-scoped, while the Activity Center stays Hebrew', () => {
      poll$.next(progress({ completedChunks: 2, totalChunks: 10, message: 'Running chunk 3/10' }));
      fixture.detectChanges();

      // c04: the same STRUCTURED counts the Hebrew case above asserts, in the other language. Keeping
      // this in step with its Hebrew sibling is the point of a control: a count that appeared on one
      // language's sentence only would be exactly the asymmetry this spec exists to catch.
      expect(surfaceText('.rd-message'))
        .toBe(runString('en', 'progressCompleted', { type: 'Proofread', completed: 2, total: 10 }));
      expect(latinIn('.rd-card').length).toBeGreaterThan(0);

      // The Activity Center is APP-level chrome and does NOT follow the book: it stays Hebrew-default.
      // c02 keeps each surface's existing language source rather than unifying them.
      expect(latinIn('.ac-panel')).toEqual([]);
    });
  });
});
