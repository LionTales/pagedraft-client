/**
 * w8 native sweep follow-up. The GERUND-not-imperative decision (docs/HEBREW_NATIVE_REVIEW.md #11)
 * landed on `book-style-baseline-status-row.component.ts` only; its two siblings on the SAME dashboard
 * screen (`book-review-status-row`, `book-summary-status-row`) still spoke the old imperative until this
 * pass, so `רענון` rendered directly beside `רענן`. Green per-component specs did not catch it because
 * each row asserts only its OWN copy - nothing pinned that the three rows must agree with each other.
 *
 * This suite is that seam: it drives the three status-row components directly (no rendering - the label
 * maps are pure functions of `bookLanguage`) and asserts they answer the SAME word for the SAME
 * build-action, in both languages, so a future copy edit applied to one row cannot silently drift apart
 * from its siblings again.
 */
import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { BookStyleBaselineStatusRowComponent } from './book-style-baseline-status-row.component';
import { BookReviewStatusRowComponent } from './book-review-status-row.component';
import { BookSummaryStatusRowComponent } from './book-summary-status-row.component';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookProfileContinuationService } from '../../core/services/book-profile-continuation.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { JobRegistryService } from '../../core/services/job-registry.service';

describe('Book dashboard status rows: shared Hebrew build-action vocabulary', () => {
  let baseline: BookStyleBaselineStatusRowComponent;
  let review: BookReviewStatusRowComponent;
  let summary: BookSummaryStatusRowComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BookStyleBaselineStatusRowComponent,
        BookReviewStatusRowComponent,
        BookSummaryStatusRowComponent,
      ],
      providers: [
        {
          provide: StyleBaselineService,
          useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER },
        },
        {
          provide: BookReviewService,
          useValue: { getReviewStatus: () => NEVER, buildReview: () => NEVER, getReviewProgress: () => NEVER },
        },
        {
          provide: BookSummaryService,
          useValue: { getBookSummaryStatus: () => NEVER, buildBookSummary: () => NEVER },
        },
        {
          provide: BookProfileContinuationService,
          useValue: { stateFor$: () => NEVER, ensureAfterBriefs: () => NEVER },
        },
        {
          provide: AnalysisProgressService,
          useValue: { pollStyleBaselineProgress: () => NEVER, pollBookSummaryProgress: () => NEVER },
        },
        { provide: JobRegistryService, useValue: { track: () => {} } },
      ],
    }).compileComponents();

    // No detectChanges(): these components fetch status over HTTP on ngOnChanges, which this suite never
    // needs - the label maps are pure functions of `bookLanguage`, read directly below.
    baseline = TestBed.createComponent(BookStyleBaselineStatusRowComponent).componentInstance;
    review = TestBed.createComponent(BookReviewStatusRowComponent).componentInstance;
    summary = TestBed.createComponent(BookSummaryStatusRowComponent).componentInstance;
  });

  it('all three rows say the same word for the not-built action, in both languages', () => {
    for (const lang of ['he', 'en']) {
      baseline.bookLanguage = review.bookLanguage = summary.bookLanguage = lang;
      const expected = lang === 'he' ? 'בנייה' : 'Build now';
      expect(baseline.baselineLabel('buildNow')).withContext(`baseline/${lang}`).toBe(expected);
      expect(review.bookReviewLabel('buildNow')).withContext(`review/${lang}`).toBe(expected);
      expect(summary.bookSummaryLabel('buildNow')).withContext(`summary/${lang}`).toBe(expected);
    }
  });

  it('all three rows say the same word for the refresh action, in both languages', () => {
    for (const lang of ['he', 'en']) {
      baseline.bookLanguage = review.bookLanguage = summary.bookLanguage = lang;
      const expected = lang === 'he' ? 'רענון' : 'Refresh';
      expect(baseline.baselineLabel('refresh')).withContext(`baseline/${lang}`).toBe(expected);
      expect(review.bookReviewLabel('refresh')).withContext(`review/${lang}`).toBe(expected);
      expect(summary.bookSummaryLabel('refresh')).withContext(`summary/${lang}`).toBe(expected);
    }
  });

  it('the two rows that offer a rebuild action (baseline, summary) say the same word, in both languages', () => {
    // The review row has no rebuild action (its READY state renders no button at all), so it is
    // deliberately excluded here rather than tested against a key it does not define.
    for (const lang of ['he', 'en']) {
      baseline.bookLanguage = summary.bookLanguage = lang;
      const expected = lang === 'he' ? 'בנייה מחדש' : 'Rebuild';
      expect(baseline.baselineLabel('rebuild')).withContext(`baseline/${lang}`).toBe(expected);
      expect(summary.bookSummaryLabel('rebuild')).withContext(`summary/${lang}`).toBe(expected);
    }
  });

  it('no row uses an imperative verb form for buildNow/refresh, and none uses three ASCII dots for building', () => {
    const rows: Array<{ name: string; label: (key: string) => string }> = [
      { name: 'baseline', label: (k) => baseline.baselineLabel(k) },
      { name: 'review', label: (k) => review.bookReviewLabel(k) },
      { name: 'summary', label: (k) => summary.bookSummaryLabel(k) },
    ];
    baseline.bookLanguage = review.bookLanguage = summary.bookLanguage = 'he';
    for (const row of rows) {
      for (const key of ['buildNow', 'refresh']) {
        expect(row.label(key)).withContext(`${row.name}/${key}`).not.toMatch(/^(בנה|רענן)\b/);
      }
      expect(row.label('building')).withContext(`${row.name}/building`).not.toContain('...');
    }
  });
});
