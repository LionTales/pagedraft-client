/**
 * wb3-c01: Book summary / briefs status row spec, relocated from the per-chapter analysis panel
 * to the book-scoped dashboard child component (BookSummaryStatusRowComponent).
 *
 * Covers BOTH:
 *  - the four states (NOT BUILT / BUILDING+progress / READY+coverage / STALE+refresh), the consent gate,
 *    cross-model staleness, and he/en parity (ported from analysis-panel/book-summary-status-row.spec.ts);
 *  - the Subject-driven build orchestration (onBuildBookSummary -> pollBookSummaryBuild): language guard,
 *    reattach, stale-guard on a late OLD-language poll emit, and the c02 "summary terminal/error also
 *    refreshes the review row" behavior — which is now surfaced as the `summaryTerminal` @Output the
 *    dashboard host wires to the review row. The progress Subject is held OPEN across assertions so the
 *    terminal/error emit lands inside the real in-flight window (never a synchronous of()/throwError).
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { BookSummaryStatusRowComponent } from './book-summary-status-row.component';
import { BookSummaryService } from '../../core/services/book-summary.service';
import {
  BookProfileContinuationService,
  ProfileContinuationOutcome,
  ProfileContinuationRequest,
  ProfileContinuationState,
} from '../../core/services/book-profile-continuation.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { BookSummaryStatusDto } from '../../core/models/book-summary';

function makeBookSummaryStatus(
  overrides: Partial<BookSummaryStatusDto> = {}
): BookSummaryStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    totalChapters: 5,
    builtChapters: 5,
    staleCount: 0,
    hasSummary: true,
    ready: true,
    lastUpdatedAt: new Date().toISOString(),
    builtWithDifferentModel: false,
    summaryCoversBuiltChapters: true,
    activeBuildJobId: null,
    chaptersToBuild: 0,
    estimatedSeconds: 0,
    estimatedUsd: null,
    ...overrides,
  };
}

/**
 * c03. The dashboard's anatomy in miniature: something the host derives from this row's status, rendered
 * ABOVE the row, so it is already checked when the row's `ngOnChanges` runs. The real host binds an object
 * (`spineSignals`) there; this one binds a string, which is the same write with the failure Angular
 * actually reports.
 */
@Component({
  standalone: true,
  imports: [BookSummaryStatusRowComponent],
  template: `
    <p data-testid="host-probe">{{ probe }}</p>
    <app-book-summary-status-row
      [bookId]="bookId"
      [bookLanguage]="bookLanguage"
      (statusChange)="onStatus($event)">
    </app-book-summary-status-row>
  `,
})
class StatusAboveRowHostComponent {
  bookId: string | null = 'book-1';
  bookLanguage = 'he';
  probe = 'no status';
  onStatus(status: BookSummaryStatusDto | null): void {
    this.probe = status ? 'status loaded' : 'no status';
  }
}

/**
 * c04. A controllable stand-in for the shared profile continuation.
 *
 * The row is ONE of eight arrival paths and no longer owns the refresh, so what this spec can assert about
 * it is exactly two things: what it REPORTS to the continuation, and how it renders the continuation's
 * state - including a refresh some other arrival started. The gate itself (which arrivals earn a refresh,
 * and why one completion cannot pay for two) belongs to the service and is proven in its own spec against
 * the real thing.
 *
 * Every arrival's outcome is a Subject held OPEN, so the in-flight window is real: a synchronous `of()`
 * would settle the row before any assertion could observe the phase it is supposed to hold.
 */
class ProfileContinuationFake {
  /** Every arrival this row reported, in order. */
  readonly arrivals: ProfileContinuationRequest[] = [];
  private readonly outcomes: Subject<ProfileContinuationOutcome>[] = [];
  private readonly states = new BehaviorSubject<ReadonlyMap<string, ProfileContinuationState>>(new Map());

  ensureAfterBriefs(request: ProfileContinuationRequest): Observable<ProfileContinuationOutcome> {
    this.arrivals.push(request);
    const out = new Subject<ProfileContinuationOutcome>();
    this.outcomes.push(out);
    this.setState(request.bookId ?? '', 'running');
    return out.asObservable();
  }

  stateFor$(bookId: string | null | undefined): Observable<ProfileContinuationState> {
    const id = (bookId ?? '').trim();
    return this.states.pipe(map(s => (id ? s.get(id) ?? 'idle' : 'idle')), distinctUntilChanged());
  }

  /** Answer an arrival (the latest by default), moving the shared state exactly as the real service does. */
  settle(outcome: ProfileContinuationOutcome, index = this.outcomes.length - 1): void {
    const bookId = this.arrivals[index].bookId ?? '';
    this.setState(bookId, outcome === 'failed' ? 'failed' : 'idle');
    this.outcomes[index].next(outcome);
    this.outcomes[index].complete();
  }

  /** Drive the shared state directly, i.e. a refresh some OTHER arrival path started for this book. */
  setState(bookId: string, state: ProfileContinuationState): void {
    const next = new Map(this.states.value);
    if (state === 'idle') next.delete(bookId);
    else next.set(bookId, state);
    this.states.next(next);
  }
}

describe('BookSummaryStatusRowComponent (wb3-c01)', () => {
  let component: BookSummaryStatusRowComponent;
  let fixture: ComponentFixture<BookSummaryStatusRowComponent>;
  // rf-c02: the row publishes its build job to the registry on start. Spy so we can assert track() and so
  // the real (root) registry (with its transitive deps) is not pulled into this component-focused TestBed.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;
  /**
   * Wave 3 / w5 (Q4-A) gave this row the profile refresh as phase 2 of its build; c04 moved the refresh
   * itself into the shared continuation, so what the row depends on now is that service. Faked rather than
   * real, so this component-focused TestBed does not pull in HttpClient or the job registry - the
   * NullInjector trap this suite has now paid for three separate features.
   */
  let continuation: ProfileContinuationFake;

  beforeEach(async () => {
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track']);
    continuation = new ProfileContinuationFake();
    await TestBed.configureTestingModule({
      imports: [BookSummaryStatusRowComponent],
      providers: [
        {
          provide: BookSummaryService,
          useValue: {
            getBookSummaryStatus: () => NEVER,
            buildBookSummary: () => NEVER,
          },
        },
        { provide: BookProfileContinuationService, useValue: continuation },
        {
          provide: AnalysisProgressService,
          useValue: {
          pollBookSummaryProgress: () => NEVER,
          },
        },
        { provide: JobRegistryService, useValue: jobRegistrySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookSummaryStatusRowComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('does not render the row while status is still unknown (null)', () => {
    component.bookSummaryStatus = null;
    component.bookSummaryBuilding = false;
    fixture.detectChanges();
    expect(query('[data-testid="book-summary-row"]')).toBeNull();
  });

  it('renders the row as soon as a status is available', () => {
    component.bookSummaryStatus = makeBookSummaryStatus();
    fixture.detectChanges();
    expect(query('[data-testid="book-summary-row"]')).not.toBeNull();
  });

  // ── NOT BUILT ──────────────────────────────────────────────────────────────

  it('NOT BUILT: shows the not-built badge and a "Build now" button', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false,
      ready: false,
      builtChapters: 0,
      staleCount: 0,
      lastUpdatedAt: null,
      chaptersToBuild: 5,
      estimatedSeconds: 120,
    });
    fixture.detectChanges();

    expect(component.bookSummaryState).toBe('not-built');
    expect(query('[data-testid="bsum-not-built"]')).not.toBeNull();
    expect(query('[data-testid="bsum-build-now"]')).not.toBeNull();
    expect(query('[data-testid="bsum-ready"]')).toBeNull();
    expect(query('[data-testid="bsum-stale"]')).toBeNull();
  });

  // ── BUILDING ───────────────────────────────────────────────────────────────

  it('BUILDING: shows the building status with a progress percent', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, builtChapters: 0 });
    component.bookSummaryBuilding = true;
    component.bookSummaryProgressPercent = 55;
    fixture.detectChanges();

    expect(component.bookSummaryState).toBe('building');
    const el = query('[data-testid="bsum-building"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('55%');
    expect(query('[data-testid="bsum-build-now"]')).toBeNull();
  });

  it('BUILDING: BUILDING flag wins over the status snapshot (client-tracked state)', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: true, ready: true });
    component.bookSummaryBuilding = true;
    fixture.detectChanges();

    expect(component.bookSummaryState).toBe('building');
  });

  // ── READY ──────────────────────────────────────────────────────────────────

  it('READY: shows coverage N/N and a non-empty "updated" relative time', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      builtChapters: 4,
      totalChapters: 4,
      lastUpdatedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    });
    fixture.detectChanges();

    expect(component.bookSummaryState).toBe('ready');
    const el = query('[data-testid="bsum-ready"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('4/4');
    expect(component.bookSummaryUpdatedRelative).not.toBe('');
  });

  // ── STALE ──────────────────────────────────────────────────────────────────

  it('STALE: shows the changed-chapter count and a "Refresh" action', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      ready: false,
      staleCount: 3,
      chaptersToBuild: 3,
      estimatedSeconds: 90,
    });
    fixture.detectChanges();

    expect(component.bookSummaryState).toBe('stale');
    const el = query('[data-testid="bsum-stale"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('3');
    expect(query('[data-testid="bsum-refresh"]')).not.toBeNull();
  });

  // ── CONSENT GATE ───────────────────────────────────────────────────────────

  it('CONSENT gate: build is NOT POSTed until the user confirms', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const buildSpy = spyOn(summarySvc, 'buildBookSummary').and.returnValue(NEVER);
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false,
      ready: false,
      builtChapters: 0,
      chaptersToBuild: 3,
      estimatedSeconds: 75,
    });
    fixture.detectChanges();

    // Click "Build now" -> consent appears, no build yet.
    query('[data-testid="bsum-build-now"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="bsum-consent"]')).not.toBeNull();
    expect(buildSpy).not.toHaveBeenCalled();

    // Estimate shows chapters + minutes; no "$" because estimatedUsd is null.
    const estimate = query('[data-testid="bsum-consent-estimate"]').nativeElement.textContent;
    expect(estimate).toContain('3');
    expect(estimate).toContain('2'); // ceil(75/60) = 2
    expect(estimate).not.toContain('$');

    // Confirm -> build fires exactly once and consent closes.
    query('[data-testid="bsum-consent-confirm"]').nativeElement.click();
    fixture.detectChanges();
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  it('CONSENT cancel: closes without building', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const buildSpy = spyOn(summarySvc, 'buildBookSummary').and.returnValue(NEVER);
    component.bookSummaryStatus = makeBookSummaryStatus({
    hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 1, estimatedSeconds: 30,
    });
    fixture.detectChanges();

    query('[data-testid="bsum-build-now"]').nativeElement.click();
    fixture.detectChanges();
    query('[data-testid="bsum-consent-cancel"]').nativeElement.click();
    fixture.detectChanges();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(query('[data-testid="bsum-consent"]')).toBeNull();
  });

  it('CONSENT estimate: appends "~$" only for paid providers (estimatedUsd != null)', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false, ready: false, builtChapters: 0,
      chaptersToBuild: 10, estimatedSeconds: 600, estimatedUsd: 0.15,
    });
    fixture.detectChanges();
    query('[data-testid="bsum-build-now"]').nativeElement.click();
    fixture.detectChanges();

    const estimate = query('[data-testid="bsum-consent-estimate"]').nativeElement.textContent;
    expect(estimate).toContain('$0.15');
  });

  // ── NIT 70: singular Hebrew forms + the genuine-no-op rebuild estimate ──────────────────────────────

  it('CONSENT estimate (he): singular "1 chapter" reads "פרק", never "1 פרקים"', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 1, estimatedSeconds: 30,
    });
    expect(component.bookSummaryConsentEstimate).toContain('~1 פרק,');
    expect(component.bookSummaryConsentEstimate).not.toContain('פרקים');
  });

  it('CONSENT estimate (he): singular "1 minute" reads "דקה", never "1 דקות"', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 2, estimatedSeconds: 30,
    });
    expect(component.bookSummaryConsentEstimate).toContain('~1 דקה');
    expect(component.bookSummaryConsentEstimate).not.toContain('דקות');
  });

  it('CONSENT estimate (he): plural counts keep their plural forms', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 3, estimatedSeconds: 90,
    });
    expect(component.bookSummaryConsentEstimate).toBe('~3 פרקים, ~2 דקות');
  });

  it('CONSENT estimate (en): singular counts read "1 chapter" / implicit "min"', () => {
    component.bookLanguage = 'en';
    component.bookSummaryStatus = makeBookSummaryStatus({
      language: 'en', hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 1, estimatedSeconds: 30,
    });
    expect(component.bookSummaryConsentEstimate).toBe('~1 chapter, ~1 min');
  });

  it('CONSENT estimate: a genuine REBUILD no-op (chaptersToBuild 0) reads "~0 chapters/פרקים, ~0 min/דקות", not "~1 min"', () => {
    // Found live: a REBUILD on an already-fresh book returns chaptersToBuild: 0, estimatedSeconds: 0 from
    // the server (a real no-op - BookSummaryService.BuildBookSummaryAsync answers NoOp: true with no model
    // call for this exact state). The client's old minutes floor (Math.max(1, ...)) manufactured a false
    // "~1 minute" for that zero-work state; it must now read zero minutes too.
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: true, ready: true, builtChapters: 5, totalChapters: 5,
      chaptersToBuild: 0, estimatedSeconds: 0,
    });
    expect(component.bookSummaryConsentEstimate).toBe('~0 פרקים, ~0 דקות');
  });

  it('CONSENT: hidden while a build is in flight (prevents duplicate build on lingering confirm)', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
    ready: false, staleCount: 2, chaptersToBuild: 2, estimatedSeconds: 90,
    });
    component.showBookSummaryConsent = true;
    component.bookSummaryBuilding = true;
    fixture.detectChanges();

    expect(query('[data-testid="bsum-consent"]')).toBeNull();

    component.bookSummaryBuilding = false;
    fixture.detectChanges();
    expect(query('[data-testid="bsum-consent"]')).not.toBeNull();
  });

  it('confirmBookSummaryBuild is a no-op while building (closes prompt, builds nothing)', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const buildSpy = spyOn(summarySvc, 'buildBookSummary').and.returnValue(NEVER);
    component.showBookSummaryConsent = true;
    component.bookSummaryBuilding = true;

    component.confirmBookSummaryBuild();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  // ── ngOnChanges consent dismissal / reset-on-switch ─────────────────────────

  it('clears the consent prompt when the book changes', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);
    component.showBookSummaryConsent = true;
    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  it('clears the consent prompt when the book language changes', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);
    component.showBookSummaryConsent = true;
    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  // ── Cross-model staleness ──────────────────────────────────────────────────

  it('CROSS-MODEL (he): shows the Hebrew warning and keeps a Refresh affordance', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      ready: false,
      staleCount: 2,
      builtWithDifferentModel: true,
      chaptersToBuild: 2,
      estimatedSeconds: 60,
    });
    fixture.detectChanges();

    const warning = query('[data-testid="bsum-cross-model-warning"]');
    expect(warning).not.toBeNull();
    expect(warning.nativeElement.textContent).toContain('מודל אחר');
    expect(warning.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(component.bookSummaryState).toBe('stale');
    expect(query('[data-testid="bsum-refresh"]')).not.toBeNull();
  });

  it('CROSS-MODEL forced to stale even when staleCount is 0', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      ready: false,
      staleCount: 0,
      builtWithDifferentModel: true,
      chaptersToBuild: 1,
      estimatedSeconds: 30,
    });
    fixture.detectChanges();

    expect(component.bookSummaryState).toBe('stale');
    expect(query('[data-testid="bsum-cross-model-warning"]')).not.toBeNull();
  });

  it('CROSS-MODEL (en): renders the English warning copy and ltr dir', () => {
    component.bookLanguage = 'en';
    component.bookSummaryStatus = makeBookSummaryStatus({
      language: 'en',
      ready: false,
      staleCount: 2,
      builtWithDifferentModel: true,
      chaptersToBuild: 2,
      estimatedSeconds: 60,
    });
    fixture.detectChanges();

    const warning = query('[data-testid="bsum-cross-model-warning"]');
    expect(warning).not.toBeNull();
    expect(warning.nativeElement.textContent).toContain('different model');
    expect(warning.nativeElement.getAttribute('dir')).toBe('ltr');
  });

  it('CROSS-MODEL absent: no warning when builtWithDifferentModel is false', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      ready: false,
      staleCount: 2,
      builtWithDifferentModel: false,
      chaptersToBuild: 2,
      estimatedSeconds: 60,
    });
    fixture.detectChanges();

    expect(component.bookSummaryBuiltWithDifferentModel).toBeFalse();
    expect(query('[data-testid="bsum-cross-model-warning"]')).toBeNull();
  });

  // ── he/en parity ───────────────────────────────────────────────────────────

  it('Hebrew (default): title is "תקצירי ספר" and dir is rtl', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 1, estimatedSeconds: 30 });
    fixture.detectChanges();

    const row = query('[data-testid="book-summary-row"]');
    expect(row.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(row.nativeElement.textContent).toContain('תקצירי ספר');
  });

  it('English: title is "Book briefs" and dir is ltr', () => {
    component.bookLanguage = 'en';
    component.bookSummaryStatus = makeBookSummaryStatus({ language: 'en', hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 1, estimatedSeconds: 30 });
    fixture.detectChanges();

    const row = query('[data-testid="book-summary-row"]');
    expect(row.nativeElement.getAttribute('dir')).toBe('ltr');
    expect(row.nativeElement.textContent).toContain('Book briefs');
  });

  // ── Build orchestration (language guard / reattach / stale-guard) ───────────

  it('loadBookSummaryStatus requests status for the CURRENT language', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const statusSpy = spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);

    component.bookLanguage = 'en';
    component.loadBookSummaryStatus();

    expect(statusSpy).toHaveBeenCalledWith('book-1', 'en');
  });

  it('resets + reloads for the new language on a bookLanguage change, and ignores a stale OLD-language poll emit', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);

    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-he', noOp: false } as any));
    const hePoll$ = new Subject<any>();
    spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(hePoll$.asObservable());
    const statusSpy = spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(
      of(makeBookSummaryStatus({ language: 'en', activeBuildJobId: null }))
    );

    // Start a build for 'he'.
    component.bookLanguage = 'he';
    component.onBuildBookSummary();
    expect(component.bookSummaryBuilding).toBeTrue();
    expect(progressSvc.pollBookSummaryProgress).toHaveBeenCalledWith('book-1', 'job-he', jasmine.anything());

    // Switch language to 'en'.
    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    // The OLD-language in-flight build/poll is torn down and the new language re-read its own status.
    expect(component.bookSummaryBuilding).toBeFalse();
    expect((component as any).bookSummaryProgressStop$).toBeNull();
    expect(statusSpy).toHaveBeenCalledWith('book-1', 'en');

    // A late emit on the OLD 'he' poll must NOT flip BUILDING / progress back for the new language.
    hePoll$.next({ status: 'running', message: 'still going', estimatedCompletionPercent: 50 });
    expect(component.bookSummaryBuilding).toBeFalse();
    expect(component.bookSummaryProgressMessage).not.toBe('still going');
  });

  it('reattaches (BUILDING + polls that jobId) for the read language when status advertises an activeBuildJobId', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(
      of(makeBookSummaryStatus({ language: 'en', activeBuildJobId: 'job-running' }))
    );
    const pollSpy = spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(NEVER);

    component.bookLanguage = 'en';
    component.loadBookSummaryStatus();

    expect(pollSpy).toHaveBeenCalledWith('book-1', 'job-running', jasmine.anything());
    expect(component.bookSummaryBuilding).toBeTrue();
    // rf-c02: the reattached build is published to the registry so the editor affordance can read it.
    expect(jobRegistrySpy.track).toHaveBeenCalledWith('summary', 'book-1', 'job-running');
  });

  // ── rf-c02: the row PUBLISHES its build job to the registry on start (track), so the editor's single
  //    "review running" affordance can be derived from jobRegistry.anyRunningForBook$. ─────────────────
  it('rf-c02: publishes the summary build to the registry once with kind/bookId/jobId on a fresh build', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);
    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(NEVER);
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);

    component.bookLanguage = 'he';
    component.onBuildBookSummary();

    expect(jobRegistrySpy.track).toHaveBeenCalledOnceWith('summary', 'book-1', 'job-1');
  });

  it('rf-c02: does NOT track a NO-OP build (no jobId)', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: null, noOp: true } as any));
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);

    component.bookLanguage = 'he';
    component.onBuildBookSummary();

    expect(jobRegistrySpy.track).not.toHaveBeenCalled();
  });

  // c02: a finished SUMMARY build makes briefs present, so the host must refresh the book-REVIEW row's gate.
  // The component surfaces this as the `summaryTerminal` @Output. The poll is held open with a Subject so the
  // terminal/error emit lands inside the real in-flight window.
  it('c02: emits summaryTerminal when a book-summary build SUCCEEDS', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);

    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    const poll$ = new Subject<any>();
    spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(poll$.asObservable());
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);
    let terminalCount = 0;
    component.summaryTerminal.subscribe(() => terminalCount++);

    component.bookLanguage = 'he';
    component.onBuildBookSummary();
    expect(component.bookSummaryBuilding).toBeTrue();

    poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });

    // Q4-A: summaryTerminal fires at the BRIEFS terminal (that is what clears the review row's gate), but
    // the building latch stays raised through phase 2, the folded profile refresh. The BookService stub
    // returns NEVER, so the row is still in the profile phase here - and must still read as building.
    expect(terminalCount).toBe(1);
    expect(component.profilePhase).toBeTrue();
    expect(component.bookSummaryBuilding)
      .withContext('the row must not read ready while the profile cards below it are still rebuilding')
      .toBeTrue();
  });

  it('c02: emits summaryTerminal when the book-summary build poll ERRORS', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);

    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    const poll$ = new Subject<any>();
    spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(poll$.asObservable());
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);
    let terminalCount = 0;
    component.summaryTerminal.subscribe(() => terminalCount++);

    component.bookLanguage = 'he';
    component.onBuildBookSummary();
    expect(component.bookSummaryBuilding).toBeTrue();

    poll$.error(new Error('poll dropped'));

    expect(component.bookSummaryBuilding).toBeFalse();
    expect(terminalCount).toBe(1);
  });

  // ── P2-6: buildingChange output (drives the editor "review running" affordance) ─────────────
  // The poll is held OPEN with a Subject so the start->terminal transition lands inside the real
  // in-flight window (never a synchronous of()).
  it('P2-6: emits buildingChange(true) on build start and buildingChange(false) on terminal', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);

    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    const poll$ = new Subject<any>();
    spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(poll$.asObservable());
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);

    const events: boolean[] = [];
    component.buildingChange.subscribe((b) => events.push(b));

    component.bookLanguage = 'he';
    component.onBuildBookSummary();
    // Build started: building flag flipped true and the output emitted true exactly once.
    expect(component.bookSummaryBuilding).toBeTrue();
    expect(events).toEqual([true]);

    // The build is still in flight (Subject open): no further emit.
    poll$.next({ status: 'running', message: 'working', estimatedCompletionPercent: 40 });
    expect(events).toEqual([true]);

    // Q4-A: the briefs terminal hands over to phase 2 (the folded profile refresh) rather than ending the
    // action, so the latch is STILL true and no false has been emitted yet. This is the property the host
    // fan-out depends on: `buildingChange(false)` must fire once, after BOTH halves, or the dashboard
    // reloads its profile card while the profile is still being written.
    poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });
    expect(component.bookSummaryBuilding).toBeTrue();
    expect(events).toEqual([true]);
  });

  // ── Q4-A: the folded profile refresh (what the removed bare arrow used to do on its own) ────────────
  describe('Q4-A: the bare arrow folded into this row as phase 2', () => {
    /** Start a build whose briefs half succeeds, leaving the row in the profile phase. */
    function buildToProfilePhase(language = 'he'): Subject<any> {
      const summarySvc = TestBed.inject(BookSummaryService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(poll$.asObservable());
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);
      component.bookLanguage = language;
      component.onBuildBookSummary();
      poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });
      return poll$;
    }

    it('reports the succeeded briefs build to the shared continuation, with its jobId and language', () => {
      buildToProfilePhase('en');

      expect(continuation.arrivals.length).toBe(1);
      expect(continuation.arrivals[0]).toEqual({
        bookId: 'book-1',
        language: 'en',
        reason: 'briefs-succeeded',
        // c04: the jobId is what collapses this report and the job registry's independent observation of
        // the SAME terminal into one refresh. Without it the registry watch - which is what covers every
        // path where this row is not mounted - would pay for a second whole-book profile build.
        briefsJobId: 'job-1',
      });
    });

    it('falls back to Hebrew when the book language is blank (same rule as the briefs call)', () => {
      buildToProfilePhase('   ');
      expect(continuation.arrivals[0].language).toBe('he');
    });

    it('lowers the building latch only once the profile refresh settles', () => {
      const events: boolean[] = [];
      component.buildingChange.subscribe((b) => events.push(b));

      buildToProfilePhase();
      expect(events).toEqual([true]);

      continuation.settle('built');
      expect(component.profilePhase).toBeFalse();
      expect(component.bookSummaryBuilding).toBeFalse();
      expect(events).toEqual([true, false]);
    });

    it('settles the same way when the gate SKIPPED the refresh (the same completion already ran it)', () => {
      const events: boolean[] = [];
      component.buildingChange.subscribe((b) => events.push(b));

      buildToProfilePhase();
      continuation.settle('skipped');

      expect(component.profilePhase).toBeFalse();
      expect(component.profilePhaseFailed)
        .withContext('a refusal by the gate is not a failure - the profile is current either way')
        .toBeFalse();
      expect(events).toEqual([true, false]);
    });

    it('reports a failed profile half specifically, rather than as a failed build', () => {
      buildToProfilePhase();
      continuation.settle('failed');

      expect(component.profilePhaseFailed).toBeTrue();
      expect(component.bookSummaryBuilding).toBeFalse();
      // The row hides itself while the state is unknown, and the status GET is stubbed to NEVER here, so
      // seed a status before asserting on rendered output rather than asserting into a hidden row.
      component.bookSummaryStatus = makeBookSummaryStatus();
      fixture.detectChanges();
      const line = query('[data-testid="bsum-profile-failed"]');
      expect(line).not.toBeNull();
      expect(line.nativeElement.textContent).toContain('פרופיל');
    });

    it('does NOT run the profile half when the briefs half fails or is canceled', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      const progressSvc = TestBed.inject(AnalysisProgressService);
      spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(poll$.asObservable());
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildBookSummary();
      poll$.next({ status: 'failed', message: 'boom', estimatedCompletionPercent: 10 });

      expect(continuation.arrivals).toEqual([]);
      expect(component.bookSummaryBuilding).toBeFalse();
      expect(component.profilePhase).toBeFalse();
    });

    it('drops a profile outcome that lands after the book changed under it', () => {
      buildToProfilePhase();

      component.bookId = 'book-2';
      continuation.settle('failed');

      expect(component.profilePhaseFailed)
        .withContext('a failure belonging to the abandoned book must not surface on the new one')
        .toBeFalse();
    });

    it('still arrives at the continuation on a NO-OP briefs build, as a USER-REQUESTED build', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: null, noOp: true } as any));
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildBookSummary();

      expect(continuation.arrivals).toEqual([
        // Not `briefs-already-fresh`: the author pressed the action and confirmed a consent prompt that
        // names the profile cards, and this is the ONLY way to rebuild a profile whose inputs did not
        // change. There is no jobId to key on because nothing was built.
        { bookId: 'book-1', language: 'he', reason: 'user-requested', briefsJobId: null },
      ]);
    });

    /**
     * c04 / finding 6, the half this row cannot start: the continuation runs for THIS book but some other
     * arrival path started it (the import handoff card's build finishing, a build reattached by the job
     * registry after a reload). The row must not read READY while the profile cards below it are being
     * rewritten, and the dashboard's completion fan-out hangs off the same latch.
     */
    it('renders a continuation it did not start, and settles when that one finishes', () => {
      component.bookLanguage = 'he';
      component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
      component.bookSummaryStatus = makeBookSummaryStatus();
      const events: boolean[] = [];
      component.buildingChange.subscribe((b) => events.push(b));

      continuation.setState('book-1', 'running');

      expect(component.profilePhase).toBeTrue();
      expect(component.bookSummaryState)
        .withContext('a profile build running for this book is this row\'s ceremony, whoever started it')
        .toBe('building');
      expect(events).toEqual([true]);

      continuation.setState('book-1', 'idle');
      expect(component.profilePhase).toBeFalse();
      expect(component.bookSummaryBuilding).toBeFalse();
      expect(events).toEqual([true, false]);
    });

    it('ignores a continuation running for a DIFFERENT book', () => {
      component.bookLanguage = 'he';
      component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });

      continuation.setState('book-2', 'running');

      expect(component.profilePhase).toBeFalse();
      expect(component.bookSummaryBuilding).toBeFalse();
    });

    it('offers a rebuild in the READY state, because the removed arrow was available in every state', () => {
      component.bookSummaryStatus = makeBookSummaryStatus();
      fixture.detectChanges();

      expect(component.bookSummaryState).toBe('ready');
      expect(query('[data-testid="bsum-rebuild"]')).not.toBeNull();
    });

    it('states what the one action produces, in both languages, with no em-dash', () => {
      component.bookSummaryStatus = makeBookSummaryStatus();
      fixture.detectChanges();
      const he = query('[data-testid="bsum-builds"]').nativeElement.textContent as string;
      expect(he).toContain('פרופיל');
      expect(he).not.toContain('—');

      component.bookLanguage = 'en';
      fixture.detectChanges();
      const en = query('[data-testid="bsum-builds"]').nativeElement.textContent as string;
      expect(en).toContain('profile cards');
      expect(en).not.toContain('—');
    });
  });

  /**
   * c04 / finding 23. The status GET was swallowed, and because the row's `*ngIf` keys on the derived state
   * being anything but 'unknown', the row then rendered NOTHING. Since Q4-A folded the bare arrow into it,
   * this row is the ONLY path to the whole build ceremony, so a silent disappearance left the author with
   * no way to build briefs OR the book profile until they reloaded the page.
   */
  describe('c04: a failed status read is visible and retryable, not silent', () => {
    it('renders an error and a retry instead of vanishing when the status GET fails', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(throwError(() => ({ status: 500 })));

      component.loadBookSummaryStatus();
      fixture.detectChanges();

      expect(component.bookSummaryState)
        .withContext('the row still knows nothing about the briefs - that is exactly what it must say')
        .toBe('unknown');
      expect(query('[data-testid="book-summary-row"]'))
        .withContext('the row must not disappear: it is the only path to the build')
        .not.toBeNull();
      expect(query('[data-testid="bsum-status-error"]')).not.toBeNull();
      expect(query('[data-testid="bsum-status-retry"]')).not.toBeNull();
      // It must not describe briefs it could not read.
      expect(query('[data-testid="bsum-ready"]')).toBeNull();
      expect(query('[data-testid="bsum-not-built"]')).toBeNull();
    });

    it('says it in the book language, with no em-dash', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(throwError(() => ({ status: 500 })));

      component.loadBookSummaryStatus();
      fixture.detectChanges();
      expect(query('[data-testid="bsum-status-error"]'))
        .withContext('the failure must be rendered before it can be read in either language')
        .not.toBeNull();
      const he = query('[data-testid="bsum-status-error"]').nativeElement.textContent as string;
      expect(he).toContain('תקצירי הספר');
      expect(he).not.toContain('—');
      expect(query('[data-testid="bsum-status-retry"]').nativeElement.textContent).toContain('נסו שוב');

      component.bookLanguage = 'en';
      fixture.detectChanges();
      const en = query('[data-testid="bsum-status-error"]').nativeElement.textContent as string;
      expect(en).toContain('could not read');
      expect(en).not.toContain('—');
      expect(query('[data-testid="bsum-status-retry"]').nativeElement.textContent).toContain('Try again');
    });

    it('the retry re-issues the read, and a second failure keeps the error up', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      // Held OPEN across assertions so the retry's in-flight window is real: the error latch must be
      // cleared on the way in and re-raised only by the new answer, never left over from the old one.
      const first$ = new Subject<BookSummaryStatusDto>();
      const second$ = new Subject<BookSummaryStatusDto>();
      const getSpy = spyOn(summarySvc, 'getBookSummaryStatus').and.returnValues(
        first$.asObservable(), second$.asObservable(),
      );

      component.loadBookSummaryStatus();
      first$.error({ status: 500 });
      fixture.detectChanges();
      expect(component.bookSummaryStatusError).toBeTrue();

      expect(query('[data-testid="bsum-status-retry"]'))
        .withContext('there must be a retry to press')
        .not.toBeNull();
      query('[data-testid="bsum-status-retry"]').nativeElement.click();
      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(component.bookSummaryStatusError)
        .withContext('the retry is in flight: the previous failure must not still be on screen')
        .toBeFalse();

      second$.error({ status: 500 });
      fixture.detectChanges();
      expect(component.bookSummaryStatusError).toBeTrue();
      expect(query('[data-testid="bsum-status-error"]')).not.toBeNull();
    });

    it('a successful retry restores the real row and its build action', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      const first$ = new Subject<BookSummaryStatusDto>();
      const second$ = new Subject<BookSummaryStatusDto>();
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValues(first$.asObservable(), second$.asObservable());

      component.loadBookSummaryStatus();
      first$.error({ status: 500 });
      fixture.detectChanges();

      expect(query('[data-testid="bsum-status-retry"]'))
        .withContext('there must be a retry to press')
        .not.toBeNull();
      query('[data-testid="bsum-status-retry"]').nativeElement.click();
      second$.next(makeBookSummaryStatus({ hasSummary: false, ready: false, builtChapters: 0 }));
      fixture.detectChanges();

      expect(query('[data-testid="bsum-status-error"]')).toBeNull();
      expect(query('[data-testid="bsum-not-built"]')).not.toBeNull();
      expect(query('[data-testid="bsum-build-now"]'))
        .withContext('the whole point of the retry: the build ceremony is reachable again')
        .not.toBeNull();
    });

    /**
     * Found live at :4201: with the status read failed AND a profile continuation running for the book
     * (one started by another arrival path), the row rendered "we could not read the status" and
     * "Building the book profile..." beside each other. Both were true, but the failure line stands IN
     * PLACE OF a status this row does not have, so it belongs only where there is nothing else to say.
     */
    it('yields to a real state: a running continuation replaces the failure line, not sits beside it', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(throwError(() => ({ status: 500 })));
      component.bookLanguage = 'he';
      component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
      fixture.detectChanges();
      expect(query('[data-testid="bsum-status-error"]')).not.toBeNull();

      continuation.setState('book-1', 'running');
      fixture.detectChanges();

      expect(query('[data-testid="bsum-building"]')).not.toBeNull();
      expect(query('[data-testid="bsum-status-error"]'))
        .withContext('the row has something to say now; the stand-in must step aside')
        .toBeNull();
    });

    it('drops a failure that belongs to a book the row has already left', () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      const first$ = new Subject<BookSummaryStatusDto>();
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(first$.asObservable());

      component.loadBookSummaryStatus();
      component.bookId = 'book-2';
      first$.error({ status: 500 });

      expect(component.bookSummaryStatusError)
        .withContext("book-1's failure must not be reported on book-2's row")
        .toBeFalse();
    });
  });

  it('P2-6: emits buildingChange(true) when reattaching to an in-progress job advertised by status', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    const progressSvc = TestBed.inject(AnalysisProgressService);
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(
      of(makeBookSummaryStatus({ activeBuildJobId: 'job-running' }))
    );
    spyOn(progressSvc, 'pollBookSummaryProgress').and.returnValue(NEVER);

    const events: boolean[] = [];
    component.buildingChange.subscribe((b) => events.push(b));

    component.loadBookSummaryStatus();

    // Reattach set building=true via the setter, so the output fired true.
    expect(component.bookSummaryBuilding).toBeTrue();
    expect(events).toEqual([true]);
  });

  it('c02: emits summaryTerminal when the build is a NO-OP (already fresh summary)', () => {
    const summarySvc = TestBed.inject(BookSummaryService);
    spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: null, noOp: true } as any));
    spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(NEVER);
    let terminalCount = 0;
    component.summaryTerminal.subscribe(() => terminalCount++);

    component.bookLanguage = 'he';
    component.onBuildBookSummary();

    // Q4-A: a no-op says the BRIEFS are fresh; it says nothing about the profile, so the folded phase 2
    // still runs and the latch stays raised until it settles (the BookService stub returns NEVER here).
    expect(terminalCount).toBe(1);
    expect(component.profilePhase).toBeTrue();
    expect(component.bookSummaryBuilding).toBeTrue();
  });

  // ── Wave 3 fixes / c02: the build cannot contradict the spine on a book with no chapters ───────────
  //
  // Found live: the spine rendered stage 2 `חסום / צריך קודם: ייבוא` and this row's Build now button sat
  // enabled roughly 200px below it, opening a consent prompt that offered to analyse the chapters of a book
  // with zero chapters. The precondition is the same one the spine derives, so the two must agree.

  describe('c02: the import precondition, disabled WITH the reason', () => {
    function notBuiltStatus(): BookSummaryStatusDto {
      return makeBookSummaryStatus({
        hasSummary: false, ready: false, builtChapters: 0, totalChapters: 0,
        staleCount: 0, lastUpdatedAt: null, chaptersToBuild: 0, estimatedSeconds: 0,
      });
    }

    it('disables the build and states why when the book has no chapters', () => {
      component.chapterCount = 0;
      component.bookSummaryStatus = notBuiltStatus();
      fixture.detectChanges();

      const btn = query('[data-testid="bsum-build-now"]');
      expect(btn).withContext('disabled, never hidden: the author must still see the build').not.toBeNull();
      expect((btn.nativeElement as HTMLButtonElement).disabled).toBeTrue();
      const reason = query('[data-testid="bsum-needs-import"]');
      expect(reason).withContext('a disabled action always carries its reason').not.toBeNull();
      expect((reason.nativeElement as HTMLElement).textContent!.trim().length).toBeGreaterThan(0);
    });

    it('refuses to open the consent prompt for a book with no chapters, even bypassing the button', () => {
      component.chapterCount = 0;
      component.bookSummaryStatus = notBuiltStatus();

      component.openBookSummaryConsent();

      expect(component.showBookSummaryConsent).toBeFalse();
    });

    it('leaves the build ENABLED while the chapter count is not known yet (null is not empty)', () => {
      component.chapterCount = null;
      component.bookSummaryStatus = notBuiltStatus();
      fixture.detectChanges();

      expect((query('[data-testid="bsum-build-now"]').nativeElement as HTMLButtonElement).disabled).toBeFalse();
      expect(query('[data-testid="bsum-needs-import"]')).toBeNull();
      component.openBookSummaryConsent();
      expect(component.showBookSummaryConsent).toBeTrue();
    });

    it('leaves the build ENABLED on a book that has chapters', () => {
      component.chapterCount = 3;
      component.bookSummaryStatus = notBuiltStatus();
      fixture.detectChanges();

      expect((query('[data-testid="bsum-build-now"]').nativeElement as HTMLButtonElement).disabled).toBeFalse();
      expect(query('[data-testid="bsum-needs-import"]')).toBeNull();
    });

    it('states the reason in the book language, both sides (he/en parity)', () => {
      component.chapterCount = 0;
      component.bookSummaryStatus = notBuiltStatus();
      component.bookLanguage = 'he';
      fixture.detectChanges();
      const he = (query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      component.bookLanguage = 'en';
      fixture.detectChanges();
      const en = (query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      expect(he).not.toBe('needsImport');
      expect(en).not.toBe('needsImport');
      expect(he).not.toBe(en);
      expect(he).not.toContain('—');
      expect(en).not.toContain('—');
    });

    it('disables the REBUILD and REFRESH actions too, so no state can escape the precondition', () => {
      component.chapterCount = 0;
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: true, ready: true, totalChapters: 0, builtChapters: 0 });
      fixture.detectChanges();
      expect((query('[data-testid="bsum-rebuild"]').nativeElement as HTMLButtonElement).disabled).toBeTrue();

      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: true, ready: false, staleCount: 2, totalChapters: 0, builtChapters: 0 });
      fixture.detectChanges();
      expect((query('[data-testid="bsum-refresh"]').nativeElement as HTMLButtonElement).disabled).toBeTrue();
    });
  });

  // ── final-r02: the SECOND shape of the same contradiction - rows, but nothing written in them ──────
  //
  // Found live at 1440x900 Hebrew on a book with three chapters created empty: this row's Build now was
  // ENABLED with no reason given, and pressing it offered `~3 פרקים, ~2 דקות` of real GPU time roughly
  // 200px below a spine reading "there are 3 chapters in the book, but nothing has been written in them,
  // so a file made now would be empty". c02 taught the row `chapterCount === 0`; c01 had already taught
  // the spine to read the text count as well, and the two drifted apart on exactly the books between them.
  //
  // The refusal is deliberate rather than a warning: the server answers this build as a TOTAL no-op
  // (`ChapterBriefService.LoadOrBuildChapterBriefAsync` short-circuits on blank text before any model call,
  // and the rollup then persists nothing), so permitting it would run a progress bar and an activity entry
  // to produce nothing at all.

  describe('final-r02: the no-text precondition, on every action the row gates', () => {
    function rowsButNoText(): void {
      component.chapterCount = 3;
      component.chaptersWithText = 0;
    }

    it('disables the build and states why when the chapters exist but carry no text', () => {
      rowsButNoText();
      component.bookSummaryStatus = makeBookSummaryStatus({
        hasSummary: false, ready: false, builtChapters: 0, totalChapters: 3,
        staleCount: 3, chaptersToBuild: 3, estimatedSeconds: 90,
      });
      fixture.detectChanges();

      const btn = query('[data-testid="bsum-build-now"]');
      expect(btn).withContext('disabled, never hidden').not.toBeNull();
      expect((btn.nativeElement as HTMLButtonElement).disabled).toBeTrue();
      expect((query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim().length)
        .toBeGreaterThan(0);
    });

    it('gives the no-text book its OWN reason, not the one written for a book with no chapters', () => {
      component.chapterCount = 0;
      component.chaptersWithText = 0;
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, totalChapters: 0 });
      fixture.detectChanges();
      const noChapters = (query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      rowsButNoText();
      fixture.detectChanges();
      const noText = (query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      expect(noChapters.length).toBeGreaterThan(0);
      expect(noText.length).toBeGreaterThan(0);
      expect(noText)
        .withContext('telling this author to add a chapter is advice they have already followed')
        .not.toBe(noChapters);
    });

    it('states the no-text reason in the book language, both sides (he/en parity, no em-dash)', () => {
      rowsButNoText();
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, totalChapters: 3 });
      component.bookLanguage = 'he';
      fixture.detectChanges();
      const he = (query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      component.bookLanguage = 'en';
      fixture.detectChanges();
      const en = (query('[data-testid="bsum-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      expect(he).not.toBe('needsText');
      expect(en).not.toBe('needsText');
      expect(he).not.toBe(en);
      expect(he).not.toContain('—');
      expect(en).not.toContain('—');
    });

    it('disables the REBUILD and REFRESH actions too, so no state can escape the precondition', () => {
      rowsButNoText();
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: true, ready: true, totalChapters: 3, builtChapters: 3 });
      fixture.detectChanges();
      expect((query('[data-testid="bsum-rebuild"]').nativeElement as HTMLButtonElement).disabled).toBeTrue();
      expect(query('[data-testid="bsum-needs-import"]')).not.toBeNull();

      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: true, ready: false, staleCount: 2, totalChapters: 3, builtChapters: 3 });
      fixture.detectChanges();
      expect((query('[data-testid="bsum-refresh"]').nativeElement as HTMLButtonElement).disabled).toBeTrue();
      expect(query('[data-testid="bsum-needs-import"]')).not.toBeNull();
    });

    it('refuses to open the consent prompt, even bypassing the button', () => {
      rowsButNoText();
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, totalChapters: 3 });

      component.openBookSummaryConsent();

      expect(component.showBookSummaryConsent).toBeFalse();
    });

    it('leaves the build ENABLED while the TEXT count is not known yet (null is not zero)', () => {
      component.chapterCount = 3;
      component.chaptersWithText = null;
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, totalChapters: 3 });
      fixture.detectChanges();

      expect((query('[data-testid="bsum-build-now"]').nativeElement as HTMLButtonElement).disabled).toBeFalse();
      expect(query('[data-testid="bsum-needs-import"]')).toBeNull();
    });

    it('leaves the build ENABLED as soon as one chapter carries text', () => {
      component.chapterCount = 3;
      component.chaptersWithText = 1;
      component.bookSummaryStatus = makeBookSummaryStatus({ hasSummary: false, ready: false, totalChapters: 3 });
      fixture.detectChanges();

      expect((query('[data-testid="bsum-build-now"]').nativeElement as HTMLButtonElement).disabled).toBeFalse();
      expect(query('[data-testid="bsum-needs-import"]')).toBeNull();
    });
  });

  /**
   * final-r02, item 3: the estimate is a CLAIM ABOUT WORK, and the server's `chaptersToBuild` counts
   * chapters with no fresh brief - which an empty chapter can never acquire, so it is counted forever while
   * no build will ever touch it. Measured against the live API on the three-empty-chapter book:
   * `chaptersToBuild: 3, estimatedSeconds: 90` for a run that issues zero model calls.
   */
  describe('final-r02: the consent estimate is capped by the chapters that actually have text', () => {
    it('claims only the chapters a build can really read on a partly-written book', () => {
      component.chapterCount = 10;
      component.chaptersWithText = 7;
      component.bookLanguage = 'en';
      component.bookSummaryStatus = makeBookSummaryStatus({
        hasSummary: false, ready: false, totalChapters: 10, chaptersToBuild: 10, estimatedSeconds: 300,
      });

      expect(component.bookSummaryConsentEstimate).toContain('~7 chapters');
      expect(component.bookSummaryConsentEstimate).not.toContain('~10 chapters');
    });

    it('leaves the server figure alone when the text count is not known', () => {
      component.chapterCount = 10;
      component.chaptersWithText = null;
      component.bookLanguage = 'en';
      component.bookSummaryStatus = makeBookSummaryStatus({
        hasSummary: false, ready: false, totalChapters: 10, chaptersToBuild: 10, estimatedSeconds: 300,
      });

      expect(component.bookSummaryConsentEstimate).toContain('~10 chapters');
    });

    it('never inflates the server figure: the cap can only remove a claim', () => {
      component.chapterCount = 10;
      component.chaptersWithText = 10;
      component.bookLanguage = 'en';
      component.bookSummaryStatus = makeBookSummaryStatus({
        hasSummary: false, ready: false, totalChapters: 10, chaptersToBuild: 2, estimatedSeconds: 60,
      });

      expect(component.bookSummaryConsentEstimate).toContain('~2 chapters');
    });
  });

  /**
   * c03. `ngOnChanges` runs INSIDE the host's change-detection pass, and this row's outputs are bound into
   * host state that the stage spine - declared ABOVE this row in the host template, so already checked in
   * that same pass - renders from. Publishing the context reset synchronously from there writes to a
   * checked binding and the host dies on NG0100 (the host spec drives the whole shape).
   *
   * These cases pin the row's half of the contract: the reset itself stays synchronous (the row is
   * immediately, honestly empty), only the PUBLISH is deferred to the microtask queue, which drains after
   * the pass; and the deferred publish carries the row's CURRENT status, not the value it was scheduled
   * with, so an answer that lands first is never overwritten by a stale null.
   */
  describe('c03: the context reset publishes outside the host change-detection pass', () => {
    it('does not emit statusChange synchronously from ngOnChanges, and does emit it one microtask later', fakeAsync(() => {
      component.bookSummaryStatus = makeBookSummaryStatus();
      const emitted: (BookSummaryStatusDto | null)[] = [];
      component.statusChange.subscribe((s) => emitted.push(s));

      component.bookLanguage = 'en';
      component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

      expect(component.bookSummaryStatus)
        .withContext('the reset itself is synchronous: the row must not keep rendering the old language')
        .toBeNull();
      expect(emitted)
        .withContext('emitting here would write to a host binding the spine above this row already checked')
        .toEqual([]);

      tick();

      expect(emitted)
        .withContext('the host still has to learn the previous status is gone, just not mid-pass')
        .toEqual([null]);
    }));

    it('does not emit buildingChange synchronously either when the reset tears down a build in flight', fakeAsync(() => {
      const summarySvc = TestBed.inject(BookSummaryService);
      spyOn(summarySvc, 'buildBookSummary').and.returnValue(of({ jobId: 'job-he', noOp: false } as any));
      component.bookLanguage = 'he';
      component.onBuildBookSummary();
      expect(component.bookSummaryBuilding).withContext('precondition: a build is in flight').toBeTrue();

      const emitted: boolean[] = [];
      component.buildingChange.subscribe((b) => emitted.push(b));

      component.bookLanguage = 'en';
      component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

      expect(component.bookSummaryBuilding).toBeFalse();
      expect(emitted).toEqual([]);

      tick();

      expect(emitted).toEqual([false]);
    }));

    /**
     * The dashboard's own spine binding is an OBJECT, and Angular's dev-mode verification treats any two
     * objects as equal, so the shipped host survives the mid-pass write with a stale binding rather than an
     * error. This host derives a PRIMITIVE from the same output, exactly as any count, chip or badge placed
     * above the rows would, and that is a hard NG0100. It pins the rule (do not write the host's state from
     * inside its pass) instead of the current tolerance.
     */
    it('does not break a host that derives a primitive above this row (ExpressionChanged)', async () => {
      const summarySvc = TestBed.inject(BookSummaryService);
      const read$ = new Subject<BookSummaryStatusDto>();
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(read$.asObservable());

      const host = TestBed.createComponent(StatusAboveRowHostComponent);
      host.detectChanges();
      // The status answers OUTSIDE a change-detection pass, the way a real HTTP response does.
      read$.next(makeBookSummaryStatus());
      host.detectChanges();
      expect(host.componentInstance.probe)
        .withContext('precondition: the host renders something derived from the row status')
        .toBe('status loaded');

      host.componentInstance.bookLanguage = 'en';

      // Update pass then verification pass: exactly what a dev-mode ApplicationRef.tick() runs.
      expect(() => { host.detectChanges(); host.checkNoChanges(); }).not.toThrow();

      // ...and the host still learns about the reset, one microtask later.
      await host.whenStable();
      host.detectChanges();
      expect(host.componentInstance.probe).toBe('no status');
    });

    it('lets a status that answers before the deferred publish drains win over the reset null', fakeAsync(() => {
      const summarySvc = TestBed.inject(BookSummaryService);
      const enStatus = makeBookSummaryStatus({ language: 'en' });
      const enRead$ = new Subject<BookSummaryStatusDto>();
      spyOn(summarySvc, 'getBookSummaryStatus').and.returnValue(enRead$.asObservable());
      component.bookSummaryStatus = makeBookSummaryStatus({ language: 'he' });
      const emitted: (BookSummaryStatusDto | null)[] = [];
      component.statusChange.subscribe((s) => emitted.push(s));

      component.bookLanguage = 'en';
      component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
      // The new language answers while the reset's publish is still queued.
      enRead$.next(enStatus);
      tick();

      expect(emitted[emitted.length - 1])
        .withContext('a queued null from the reset must never clobber the answer for the new language')
        .toBe(enStatus);
      expect(component.bookSummaryStatus).toBe(enStatus);
    }));
  });
});
