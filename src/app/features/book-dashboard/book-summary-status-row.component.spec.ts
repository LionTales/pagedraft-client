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
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of } from 'rxjs';
import { BookSummaryStatusRowComponent } from './book-summary-status-row.component';
import { BookSummaryService } from '../../core/services/book-summary.service';
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
    builtWithModel: 'gemma4:12b',
    activeModel: 'gemma4:12b',
    builtWithDifferentModel: false,
    activeBuildJobId: null,
    chaptersToBuild: 0,
    estimatedSeconds: 0,
    estimatedUsd: null,
    ...overrides,
  };
}

describe('BookSummaryStatusRowComponent (wb3-c01)', () => {
  let component: BookSummaryStatusRowComponent;
  let fixture: ComponentFixture<BookSummaryStatusRowComponent>;
  // rf-c02: the row publishes its build job to the registry on start. Spy so we can assert track() and so
  // the real (root) registry (with its transitive deps) is not pulled into this component-focused TestBed.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track']);
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
      builtWithModel: 'old-model',
      activeModel: 'gemma4:12b',
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

    expect(component.bookSummaryBuilding).toBeFalse();
    expect(terminalCount).toBe(1);
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

    // Terminal emit on the open Subject: building flips false and the output emits false.
    poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });
    expect(component.bookSummaryBuilding).toBeFalse();
    expect(events).toEqual([true, false]);
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

    expect(component.bookSummaryBuilding).toBeFalse();
    expect(terminalCount).toBe(1);
  });
});
