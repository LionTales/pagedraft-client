/**
 * wb3-c01: Book review status row spec, relocated from the per-chapter analysis panel to the book-scoped
 * dashboard child component (BookReviewStatusRowComponent).
 *
 * Covers BOTH:
 *  - the row states (NOT BUILT / BUILDING+progress / READY+findingCount / STALE+refresh), the
 *    "needs summary first" gate (hasBriefs===false), the consent flow, cross-model staleness, the
 *    failed/degraded build-outcome banner (localized he/en copy), and he/en parity (ported from
 *    analysis-panel/book-review-status-row.spec.ts);
 *  - the Subject-driven build orchestration (onBuildBookReview -> pollBookReviewBuild): in-flight then
 *    terminal failed/degraded/plain, stale-guard on a context switch, reset-on-book-switch clearing the
 *    outcome banner, the post-build degraded-count reconcile, HTTP-start failure, and the poll-error
 *    failed/clear-on-ready reconcile (ported from the c03 describe block). The progress Subject is held
 *    OPEN across assertions so the terminal/error emit lands inside the real in-flight window.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { BookReviewStatusRowComponent } from './book-review-status-row.component';
import { BookReviewService } from '../../core/services/book-review.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { AiTierService } from '../../core/services/ai-tier.service';
import { BookReviewStatusDto } from '../../core/models/book-review';

function makeBookReviewStatus(
  overrides: Partial<BookReviewStatusDto> = {}
): BookReviewStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    hasReview: true,
    findingCount: 12,
    openFindingCount: 12,
    resolvedFindingCount: 0,
    lastUpdatedAt: new Date().toISOString(),
    builtWithDifferentModel: false,
    staleVsBriefs: false,
    hasBriefs: true,
    activeBuildJobId: null,
    ready: true,
    // wb4-c06 coverage fields: defaults match the status-probe case (0/false - not persisted)
    chaptersReviewed: 0,
    chaptersTotal: 0,
    windowCount: 0,
    ranSynthesis: false,
    ranContinuityReduce: false,
    failedWindows: 0,
    ...overrides,
  };
}

describe('BookReviewStatusRowComponent (wb3-c01)', () => {
  let component: BookReviewStatusRowComponent;
  let fixture: ComponentFixture<BookReviewStatusRowComponent>;
  // rf-c02: the row publishes its build job to the registry on start. Spy so we can assert track() and so
  // the real (root) registry (with its transitive deps) is not pulled into this component-focused TestBed.
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track']);
    await TestBed.configureTestingModule({
      imports: [BookReviewStatusRowComponent],
      providers: [
        {
          provide: BookReviewService,
          useValue: {
            getReviewStatus: () => NEVER,
            buildReview: () => NEVER,
            getReviewProgress: () => NEVER,
          },
        },
        { provide: JobRegistryService, useValue: jobRegistrySpy },
        // tier-ux-rework c3: the row now hosts the BookReview tier toggle, which injects AiTierService
        // (-> HttpClient). Stubbed so the suite does not fail with a NullInjector error naming HttpClient.
        {
          provide: AiTierService,
          useValue: {
            // `watch` is the shared per-book answer channel (tier-ux-rework fixes c02): the toggle subscribes
            // to it on every mount, so a stub without it fails this suite with a TypeError from a child.
            watch: () => NEVER,
            refresh: () => NEVER,
            get: () => NEVER,
            setTask: () => NEVER,
            setBookDefault: () => NEVER,
            clearTask: () => NEVER,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookReviewStatusRowComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('does not render the row while status is still unknown (null)', () => {
    component.bookReviewStatus = null;
    component.bookReviewBuilding = false;
    fixture.detectChanges();
    expect(query('[data-testid="book-review-row"]')).toBeNull();
  });

  it('renders the row as soon as a status is available', () => {
    component.bookReviewStatus = makeBookReviewStatus();
    fixture.detectChanges();
    expect(query('[data-testid="book-review-row"]')).not.toBeNull();
  });

  /**
   * tier-ux-rework c3: the whole-book review launcher carries its OWN tier toggle, wired to the BookReview
   * task. The review is off the thinking allowlist, so the toggle renders disabled with the server's reason
   * rather than being hidden: the launcher is exactly where a user asks "which model does this spend".
   */
  it('hosts a tier toggle wired to the BookReview task', () => {
    component.bookReviewStatus = makeBookReviewStatus();
    component.bookLanguage = 'he';
    fixture.detectChanges();

    const toggles = fixture.debugElement.queryAll(By.css('app-tier-toggle'));
    expect(toggles.length).toBe(1);
    expect(toggles[0].componentInstance.task).toBe('BookReview');
    expect(toggles[0].componentInstance.bookId).toBe('book-1');
    expect(toggles[0].componentInstance.bookLanguage).toBe('he');
  });

  // ── NEEDS SUMMARY GATE (hasBriefs===false) ─────────────────────────────────

  it('NEEDS-SUMMARY: shows the hint and no build button when hasBriefs is false', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: false, ready: false, hasBriefs: false, findingCount: 0, lastUpdatedAt: null,
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('needs-summary');
    expect(query('[data-testid="brev-needs-summary"]')).not.toBeNull();
    expect(query('[data-testid="brev-needs-summary-hint"]')).not.toBeNull();
    expect(query('[data-testid="brev-build-now"]')).toBeNull();
    expect(query('[data-testid="brev-refresh"]')).toBeNull();
  });

  it('NEEDS-SUMMARY: openBookReviewConsent is a no-op (cannot build without briefs)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const buildSpy = spyOn(reviewSvc, 'buildReview').and.returnValue(NEVER);
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false, hasBriefs: false });
    fixture.detectChanges();

    component.openBookReviewConsent();
    fixture.detectChanges();

    expect(query('[data-testid="brev-consent"]')).toBeNull();
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('NEEDS-SUMMARY: confirmBookReviewBuild is a no-op when hasBriefs is false', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const buildSpy = spyOn(reviewSvc, 'buildReview').and.returnValue(NEVER);
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false, hasBriefs: false });
    component.showBookReviewConsent = true;
    fixture.detectChanges();

    component.confirmBookReviewBuild();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(component.showBookReviewConsent).toBeFalse();
  });

  // ── NOT BUILT ──────────────────────────────────────────────────────────────

  it('NOT BUILT: shows the not-built badge and a "Build now" button', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: false, ready: false, findingCount: 0, lastUpdatedAt: null, hasBriefs: true,
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('not-built');
    expect(query('[data-testid="brev-not-built"]')).not.toBeNull();
    expect(query('[data-testid="brev-build-now"]')).not.toBeNull();
    expect(query('[data-testid="brev-ready"]')).toBeNull();
    expect(query('[data-testid="brev-stale"]')).toBeNull();
  });

  // ── BUILDING ───────────────────────────────────────────────────────────────

  it('BUILDING: shows the building status with a progress percent', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false });
    component.bookReviewBuilding = true;
    component.bookReviewProgressPercent = 42;
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('building');
    const el = query('[data-testid="brev-building"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('42%');
    expect(query('[data-testid="brev-build-now"]')).toBeNull();
  });

  it('BUILDING: BUILDING flag wins over the status snapshot (client-tracked state)', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: true, ready: true });
    component.bookReviewBuilding = true;
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('building');
  });

  // ── READY ──────────────────────────────────────────────────────────────────

  it('READY: shows finding count and a non-empty "updated" relative time', () => {
    component.bookReviewStatus = makeBookReviewStatus({
      findingCount: 7,
      lastUpdatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('ready');
    const el = query('[data-testid="brev-ready"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('7');
    expect(component.bookReviewUpdatedRelative).not.toBe('');
  });

  // ── STALE ──────────────────────────────────────────────────────────────────

  it('STALE (staleVsBriefs): shows stale finding count and a "Refresh" action', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: true, ready: false, staleVsBriefs: true, findingCount: 5,
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('stale');
    const el = query('[data-testid="brev-stale"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('5');
    expect(query('[data-testid="brev-refresh"]')).not.toBeNull();
  });

  it('STALE (builtWithDifferentModel): forced stale even when staleVsBriefs is false', () => {
    component.bookReviewStatus = makeBookReviewStatus({
      hasReview: true, ready: false, staleVsBriefs: false, builtWithDifferentModel: true,
          });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('stale');
    expect(query('[data-testid="brev-cross-model-warning"]')).not.toBeNull();
    expect(query('[data-testid="brev-refresh"]')).not.toBeNull();
  });

  it('ready=false with hasReview=true and no stale flags is STALE, NOT ready (trusts status.ready)', () => {
    component.bookReviewBuilding = false;
    component.bookReviewStatus = makeBookReviewStatus({
      hasReview: true, ready: false, staleVsBriefs: false, builtWithDifferentModel: false,
      hasBriefs: true, activeBuildJobId: 'job-1', findingCount: 3,
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('stale');
    expect(query('[data-testid="brev-ready"]')).toBeNull();
    expect(query('[data-testid="brev-stale"]')).not.toBeNull();
  });

  // ── DEGRADED BUILD BANNER: count source ──────────────────────────────────────

  it('DEGRADED banner enriches from bookReviewBuildOutcomeCount, NOT the stale bookReviewStatus.findingCount', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({ findingCount: 99 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'degraded';
    component.bookReviewBuildOutcomeCount = 3;
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-degraded"]');
    expect(el).not.toBeNull();
    const text = el.nativeElement.textContent as string;
    expect(text).toContain('3');
    expect(text).toContain('findings were saved');
    expect(text).not.toContain('99');
  });

  it('DEGRADED banner shows the plain copy (no count) until the post-build count is known (null)', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({ findingCount: 99 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'degraded';
    component.bookReviewBuildOutcomeCount = null;
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-degraded"]');
    expect(el).not.toBeNull();
    const text = el.nativeElement.textContent as string;
    expect(text).not.toContain('findings were saved');
    expect(text).not.toContain('99');
  });

  // ── CONSENT GATE ───────────────────────────────────────────────────────────

  it('CONSENT gate: build is NOT POSTed until the user confirms', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const buildSpy = spyOn(reviewSvc, 'buildReview').and.returnValue(NEVER);
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: false, ready: false, findingCount: 0, hasBriefs: true,
    });
    fixture.detectChanges();

    query('[data-testid="brev-build-now"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="brev-consent"]')).not.toBeNull();
    expect(buildSpy).not.toHaveBeenCalled();

    query('[data-testid="brev-consent-confirm"]').nativeElement.click();
    fixture.detectChanges();
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(component.showBookReviewConsent).toBeFalse();
  });

  it('CONSENT cancel: closes without building', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const buildSpy = spyOn(reviewSvc, 'buildReview').and.returnValue(NEVER);
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: false, ready: false, hasBriefs: true, findingCount: 0,
    });
    fixture.detectChanges();

    query('[data-testid="brev-build-now"]').nativeElement.click();
    fixture.detectChanges();
    query('[data-testid="brev-consent-cancel"]').nativeElement.click();
    fixture.detectChanges();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(query('[data-testid="brev-consent"]')).toBeNull();
  });

  it('CONSENT: hidden while a build is in flight (prevents duplicate build on lingering confirm)', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: true, ready: false, staleVsBriefs: true,
    });
    component.showBookReviewConsent = true;
    component.bookReviewBuilding = true;
    fixture.detectChanges();

    expect(query('[data-testid="brev-consent"]')).toBeNull();

    component.bookReviewBuilding = false;
    fixture.detectChanges();
    expect(query('[data-testid="brev-consent"]')).not.toBeNull();
  });

  it('confirmBookReviewBuild is a no-op while building (closes prompt, builds nothing)', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    const buildSpy = spyOn(reviewSvc, 'buildReview').and.returnValue(NEVER);
    component.bookReviewStatus = makeBookReviewStatus({ hasBriefs: true });
    component.showBookReviewConsent = true;
    component.bookReviewBuilding = true;

    component.confirmBookReviewBuild();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(component.showBookReviewConsent).toBeFalse();
  });

  // ── ngOnChanges consent dismissal ──────────────────────────────────────────

  it('clears the consent prompt when the book changes', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);
    component.showBookReviewConsent = true;
    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    expect(component.showBookReviewConsent).toBeFalse();
  });

  it('clears the consent prompt when the book language changes', () => {
    const reviewSvc = TestBed.inject(BookReviewService);
    spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);
    component.showBookReviewConsent = true;
    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    expect(component.showBookReviewConsent).toBeFalse();
  });

  // ── Cross-model staleness ──────────────────────────────────────────────────

  it('CROSS-MODEL (he): shows the Hebrew warning and keeps a Refresh affordance', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: true, ready: false, staleVsBriefs: false,       builtWithDifferentModel: true,
    });
    fixture.detectChanges();

    const warning = query('[data-testid="brev-cross-model-warning"]');
    expect(warning).not.toBeNull();
    expect(warning.nativeElement.textContent).toContain('מודל אחר');
    expect(warning.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(component.bookReviewState).toBe('stale');
    expect(query('[data-testid="brev-refresh"]')).not.toBeNull();
  });

  it('CROSS-MODEL absent: no warning when builtWithDifferentModel is false', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: true, ready: false, staleVsBriefs: true, builtWithDifferentModel: false,
    });
    fixture.detectChanges();

    expect(component.bookReviewBuiltWithDifferentModel).toBeFalse();
    expect(query('[data-testid="brev-cross-model-warning"]')).toBeNull();
  });

  // ── he/en parity ───────────────────────────────────────────────────────────

  it('Hebrew (default): title is "עריכה התפתחותית" and dir is rtl', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: false, ready: false, findingCount: 0, hasBriefs: true,
    });
    fixture.detectChanges();

    const row = query('[data-testid="book-review-row"]');
    expect(row.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(row.nativeElement.textContent).toContain('עריכה התפתחותית');
  });

  it('English: title is "Developmental review" and dir is ltr', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({
    language: 'en', hasReview: false, ready: false, findingCount: 0, hasBriefs: true,
    });
    fixture.detectChanges();

    const row = query('[data-testid="book-review-row"]');
    expect(row.nativeElement.getAttribute('dir')).toBe('ltr');
    expect(row.nativeElement.textContent).toContain('Developmental review');
  });

  it('English: CROSS-MODEL warning renders in English with ltr dir', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({
      language: 'en', hasReview: true, ready: false, staleVsBriefs: false,
      builtWithDifferentModel: true,     });
    fixture.detectChanges();

    const warning = query('[data-testid="brev-cross-model-warning"]');
    expect(warning).not.toBeNull();
    expect(warning.nativeElement.textContent).toContain('different model');
    expect(warning.nativeElement.getAttribute('dir')).toBe('ltr');
  });

  it('Hebrew: needs-summary hint contains the Hebrew prompt to build briefs first', () => {
    component.bookReviewStatus = makeBookReviewStatus({
    hasReview: false, ready: false, hasBriefs: false, findingCount: 0,
    });
    fixture.detectChanges();

    const hint = query('[data-testid="brev-needs-summary-hint"]');
    expect(hint).not.toBeNull();
    expect(hint.nativeElement.textContent).toContain('תקצירי ספר');
  });

  it('English: needs-summary hint uses English copy', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({
    language: 'en', hasReview: false, ready: false, hasBriefs: false, findingCount: 0,
    });
    fixture.detectChanges();

    const hint = query('[data-testid="brev-needs-summary-hint"]');
    expect(hint).not.toBeNull();
    expect(hint.nativeElement.textContent).toContain('book summary');
  });

  // ── BUILD OUTCOME: failed / degraded banner copy (localized he/en) ──────────

  it('FAILED outcome: renders a red error banner so a total failure is not a silent green finish', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuildOutcomeMessage = '';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-failed"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.getAttribute('role')).toBe('alert');
    expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(el.nativeElement.textContent).toContain('נכשלה');
    expect(query('[data-testid="brev-build-degraded"]')).toBeNull();
  });

  it('DEGRADED outcome: renders a softer warning banner naming the partial failure', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: true, ready: true, findingCount: 12 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'degraded';
    component.bookReviewBuildOutcomeCount = 4;
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-degraded"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent).toContain('חלקית');
    expect(el.nativeElement.textContent).toContain('4');
    expect(el.nativeElement.textContent).not.toContain('12');
    expect(query('[data-testid="brev-build-failed"]')).toBeNull();
  });

  it('FAILED (he): renders the HEBREW label and NOT the raw English BE message', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false, findingCount: 0 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuildOutcomeMessage =
      'Whole-book review failed: the combined review call produced no findings.';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-failed"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(el.nativeElement.textContent.trim()).toBe(component.bookReviewLabel('buildFailed'));
    expect(el.nativeElement.textContent).toContain('נכשלה');
    expect(el.nativeElement.textContent).not.toContain('Whole-book review failed');
    expect(el.nativeElement.textContent).not.toContain('combined review call');
  });

  it('DEGRADED (he): renders the HEBREW label and NOT the raw English BE message', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: true, ready: true, findingCount: 12 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'degraded';
    component.bookReviewBuildOutcomeCount = 4;
    component.bookReviewBuildOutcomeMessage =
      'Whole-book review built with warnings: 4 findings across 4/6 dimensions (2 failed).';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-degraded"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(el.nativeElement.textContent).toContain('חלקית');
    expect(el.nativeElement.textContent).toContain('4');
    expect(el.nativeElement.textContent).not.toContain('built with warnings');
    expect(el.nativeElement.textContent).not.toContain('2 failed');
  });

  it('OUTCOME banner is hidden while a new build is in flight (transient progress owns the row)', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false });
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuilding = true;
    fixture.detectChanges();

    expect(query('[data-testid="brev-build-failed"]')).toBeNull();
  });

  it('No outcome (null): neither failed nor degraded banner renders', () => {
    component.bookReviewStatus = makeBookReviewStatus();
    component.bookReviewBuildOutcome = null;
    fixture.detectChanges();

    expect(query('[data-testid="brev-build-failed"]')).toBeNull();
    expect(query('[data-testid="brev-build-degraded"]')).toBeNull();
  });

  it('English: FAILED banner uses the English generic copy when no server message', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({ language: 'en', hasReview: false, ready: false });
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuildOutcomeMessage = '';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-failed"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.getAttribute('dir')).toBe('ltr');
    expect(el.nativeElement.textContent).toContain('review build failed');
  });

  it('English: FAILED banner uses the localized label, not the raw BE message either', () => {
    component.bookLanguage = 'en';
    component.bookReviewStatus = makeBookReviewStatus({ language: 'en', hasReview: false, ready: false });
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuildOutcomeMessage =
      'Whole-book review failed: the combined review call produced no findings.';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-failed"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.textContent.trim()).toBe(component.bookReviewLabel('buildFailed'));
    expect(el.nativeElement.textContent).not.toContain('combined review call');
  });

  // ── Build orchestration (ported from c03; Subject-driven, held open across assertions) ──────
  describe('book review build orchestration (ported c03)', () => {
    it('(a) in-flight then terminal failed: BUILDING true mid-flight, then outcome=failed and BUILDING false', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      poll$.next({ status: 'running', message: 'building', estimatedCompletionPercent: 40 });
      expect(component.bookReviewBuilding).toBeTrue();
      expect(component.bookReviewBuildOutcome).toBeNull();

      poll$.next({ status: 'failed', message: 'all dimensions failed', estimatedCompletionPercent: 100 });
      expect(component.bookReviewBuildOutcome).toBe('failed');
      expect(component.bookReviewBuildOutcomeMessage).toBe('all dimensions failed');
      expect(component.bookReviewBuilding).toBeFalse();
    });

    it('(b) terminal succeeded with a PLAIN message -> outcome stays null (no false degraded)', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());

      component.bookLanguage = 'he';
      component.onBuildBookReview();
      expect(component.bookReviewBuilding).toBeTrue();

      poll$.next({ status: 'succeeded', message: 'Book review built successfully', estimatedCompletionPercent: 100 });

      expect(component.bookReviewBuildOutcome).toBeNull();
      expect(component.bookReviewBuildOutcomeMessage).toBe('');
      expect(component.bookReviewBuilding).toBeFalse();
    });

    it('(c) terminal succeeded WITH a "(N failed)" / "with warnings" message -> outcome=degraded', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());

      component.bookLanguage = 'he';
      component.onBuildBookReview();
      expect(component.bookReviewBuilding).toBeTrue();

      poll$.next({ status: 'succeeded', message: 'Built with warnings (2 failed)', estimatedCompletionPercent: 100 });

      expect(component.bookReviewBuildOutcome).toBe('degraded');
      expect(component.bookReviewBuildOutcomeMessage).toBe('Built with warnings (2 failed)');
      expect(component.bookReviewBuilding).toBeFalse();
    });

    it('(d) STALE GUARD: a terminal emit after the bookId changed mid-flight does NOT mutate the new context', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-A', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());

      component.bookId = 'book-A';
      component.bookLanguage = 'he';
      component.onBuildBookReview();
      expect(component.bookReviewBuilding).toBeTrue();

      // Switch context FIRST (the user navigated to a different book) — THEN the stale poll fires terminal.
      component.bookId = 'book-B';
      poll$.next({ status: 'failed', message: 'stale failure from book A', estimatedCompletionPercent: 100 });

      expect(component.bookReviewBuildOutcome).toBeNull();
      expect(component.bookReviewBuildOutcomeMessage).toBe('');
    });

    it('(e) RESET-ON-SWITCH: a bookId change via ngOnChanges clears a prior failed outcome + message', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);
      component.bookReviewBuildOutcome = 'failed';
      component.bookReviewBuildOutcomeMessage = 'previous book failure';

      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });

      expect(component.bookReviewBuildOutcome).toBeNull();
      expect(component.bookReviewBuildOutcomeMessage).toBe('');
    });

    it('(f) DEGRADED: the banner count comes from the POST-BUILD status refresh, not the pre-build snapshot', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const status$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(status$.asObservable());

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      poll$.next({ status: 'succeeded', message: 'Built with warnings (2 failed)', estimatedCompletionPercent: 100 });
      expect(component.bookReviewBuildOutcome).toBe('degraded');
      expect(component.bookReviewBuildOutcomeCount).toBeNull();

      status$.next({ findingCount: 4, ready: false, activeBuildJobId: null } as any);
      expect(component.bookReviewBuildOutcomeCount).toBe(4);
    });

    it('(g) DEGRADED: a FAILED post-build status refresh leaves the count null (never a wrong total)', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const status$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(status$.asObservable());

      component.bookLanguage = 'he';
      component.onBuildBookReview();
      poll$.next({ status: 'succeeded', message: 'Built with warnings (2 failed)', estimatedCompletionPercent: 100 });

      status$.error(new Error('status refresh failed'));
      expect(component.bookReviewBuildOutcome).toBe('degraded');
      expect(component.bookReviewBuildOutcomeCount).toBeNull();
    });

    it('(h) HTTP START failure (no job id): outcome=failed so the failed start is not a silent no-op', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(throwError(() => new Error('network down')));
      const progressSpy = spyOn(reviewSvc, 'getReviewProgress').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      expect(component.bookReviewBuilding).toBeFalse();
      expect(component.bookReviewBuildOutcome).toBe('failed');
      expect(progressSpy).not.toHaveBeenCalled();
    });

    it('(i) poll error but the build actually FINISHED: a ready status refresh clears the stale failed banner', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(
        of({ ready: true, hasReview: true, findingCount: 5, activeBuildJobId: null } as any));

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      poll$.error(new Error('poll dropped'));

      expect(component.bookReviewBuildOutcome).toBeNull();
      expect(component.bookReviewStatus?.ready).toBeTrue();
    });

    it('(j) poll error and the build genuinely FAILED: a not-ready status keeps the failed banner', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(
        of({ ready: false, hasReview: false, findingCount: 0, activeBuildJobId: null } as any));

      component.bookLanguage = 'he';
      component.onBuildBookReview();
      poll$.error(new Error('poll dropped'));

      expect(component.bookReviewBuildOutcome).toBe('failed');
    });

    it('(k) HTTP START failure: an unrelated ready status refresh must NOT clear the failed banner', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(throwError(() => new Error('network down')));
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(NEVER);
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(
        of({ ready: true, hasReview: true, findingCount: 7, activeBuildJobId: null } as any));

      component.bookLanguage = 'he';
      component.onBuildBookReview();
      expect(component.bookReviewBuildOutcome).toBe('failed');

      component.loadBookReviewStatus();

      expect(component.bookReviewBuildOutcome).toBe('failed');
    });

    it('(l) while degraded, an unrelated status refresh must NOT overwrite the post-build count', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const statusSpy = spyOn(reviewSvc, 'getReviewStatus');
      statusSpy.and.returnValue(of({ ready: true, hasReview: true, findingCount: 4, activeBuildJobId: null } as any));

      component.bookLanguage = 'he';
      component.onBuildBookReview();
      poll$.next({ status: 'succeeded', message: 'Built with warnings (2 failed)', estimatedCompletionPercent: 100 });

      expect(component.bookReviewBuildOutcome).toBe('degraded');
      expect(component.bookReviewBuildOutcomeCount).toBe(4);

      statusSpy.and.returnValue(of({ ready: true, hasReview: true, findingCount: 99, activeBuildJobId: null } as any));
      component.loadBookReviewStatus();

      expect(component.bookReviewBuildOutcomeCount).toBe(4);
    });

    it('(m) an overlapping refresh that cancels the post-build fetch still fills the degraded count', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const statusSubjects: Subject<any>[] = [];
      spyOn(reviewSvc, 'getReviewStatus').and.callFake(() => {
        const s = new Subject<any>();
        statusSubjects.push(s);
        return s.asObservable();
      });

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      poll$.next({ status: 'succeeded', message: 'Built with warnings (2 failed)', estimatedCompletionPercent: 100 });
      expect(component.bookReviewBuildOutcome).toBe('degraded');
      expect(component.bookReviewBuildOutcomeCount).toBeNull();
      expect(statusSubjects.length).toBe(1);

      component.loadBookReviewStatus();
      expect(statusSubjects.length).toBe(2);
      statusSubjects[0].next({ ready: true, hasReview: true, findingCount: 999, activeBuildJobId: null } as any);
      expect(component.bookReviewBuildOutcomeCount).toBeNull();

      statusSubjects[1].next({ ready: true, hasReview: true, findingCount: 7, activeBuildJobId: null } as any);
      expect(component.bookReviewBuildOutcomeCount).toBe(7);
    });

    it('(n) an overlapping refresh after a poll-error failed still clears the banner on a later ready response', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const statusSubjects: Subject<any>[] = [];
      spyOn(reviewSvc, 'getReviewStatus').and.callFake(() => {
        const s = new Subject<any>();
        statusSubjects.push(s);
        return s.asObservable();
      });

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      poll$.error(new Error('poll dropped'));
      expect(component.bookReviewBuildOutcome).toBe('failed');
      expect(statusSubjects.length).toBe(1);

      component.loadBookReviewStatus();
      expect(statusSubjects.length).toBe(2);

      statusSubjects[1].next({ ready: true, hasReview: true, findingCount: 5, activeBuildJobId: null } as any);
      expect(component.bookReviewBuildOutcome).toBeNull();
    });

    it('(o) reattaches (BUILDING + polls that jobId) when status advertises an activeBuildJobId', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(
        of(makeBookReviewStatus({ language: 'en', activeBuildJobId: 'job-running', ready: false, hasReview: false }))
      );
      const pollSpy = spyOn(reviewSvc, 'getReviewProgress').and.returnValue(NEVER);

      component.bookLanguage = 'en';
      component.loadBookReviewStatus();

      expect(pollSpy).toHaveBeenCalledWith('book-1', 'job-running', jasmine.anything());
      expect(component.bookReviewBuilding).toBeTrue();
      // rf-c02: the reattached build is published to the registry so the editor affordance can read it.
      expect(jobRegistrySpy.track).toHaveBeenCalledWith('review', 'book-1', 'job-running');
    });
  });

  // ── rf-c02: the row PUBLISHES its build job to the registry on start (track), so the editor's single
  //    "review running" affordance can be derived from jobRegistry.anyRunningForBook$. ─────────────────
  describe('rf-c02: publishes review build to the job registry', () => {
    it('tracks the review build once with kind/bookId/jobId on a fresh build', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(NEVER);
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      expect(jobRegistrySpy.track).toHaveBeenCalledOnceWith('review', 'book-1', 'job-1');
    });

    it('does NOT track a NO-OP build (no jobId)', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: null, noOp: true } as any));
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      expect(jobRegistrySpy.track).not.toHaveBeenCalled();
    });
  });

  // ── wb4-c06: Coverage provenance (chaptersReviewed/Total, windowCount, failedWindows) ──────

  describe('wb4-c06: coverage provenance in READY state', () => {
    it('READY with coverage: renders "Reviewed N/N chapters" when chaptersTotal > 0 (he)', () => {
      component.bookReviewStatus = makeBookReviewStatus({
        chaptersReviewed: 8, chaptersTotal: 10,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0,
      });
      fixture.detectChanges();

      expect(component.bookReviewState).toBe('ready');
      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('8');
      expect(text).toContain('10');
      // Hebrew: "נסקרו"
      expect(text).toContain('נסקרו');
    });

    it('READY with coverage: renders "Reviewed N/N chapters" in English when bookLanguage is en', () => {
      component.bookLanguage = 'en';
      component.bookReviewStatus = makeBookReviewStatus({
        language: 'en', chaptersReviewed: 5, chaptersTotal: 6,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0,
      });
      fixture.detectChanges();

      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('Reviewed');
      expect(text).toContain('5');
      expect(text).toContain('6');
    });

    it('READY without coverage (chaptersTotal=0): coverage element is NOT rendered', () => {
      component.bookReviewStatus = makeBookReviewStatus({
      chaptersReviewed: 0, chaptersTotal: 0, windowCount: 0,
      });
      fixture.detectChanges();

      expect(query('[data-testid="brev-coverage-chapters"]')).toBeNull();
    });

    it('READY with windowCount > 0: shows window detail inside coverage element', () => {
      component.bookLanguage = 'en';
      component.bookReviewStatus = makeBookReviewStatus({
        language: 'en', chaptersReviewed: 4, chaptersTotal: 4,
        windowCount: 3, ranContinuityReduce: false, failedWindows: 0,
      });
      fixture.detectChanges();

      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('3 windows');
      expect(text).not.toContain('continuity pass');
    });

    it('READY with windowCount > 0 and ranContinuityReduce: shows window detail + continuity pass', () => {
      component.bookLanguage = 'en';
      component.bookReviewStatus = makeBookReviewStatus({
        language: 'en', chaptersReviewed: 4, chaptersTotal: 4,
        windowCount: 3, ranContinuityReduce: true, failedWindows: 0,
      });
      fixture.detectChanges();

      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('3 windows');
      expect(text).toContain('continuity pass');
    });

    it('READY with windowCount=0: window detail element is NOT rendered (never shows "0 windows")', () => {
      component.bookLanguage = 'en';
      component.bookReviewStatus = makeBookReviewStatus({
        language: 'en', chaptersReviewed: 4, chaptersTotal: 4,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0,
      });
      fixture.detectChanges();

      const coverageEl = query('[data-testid="brev-coverage-chapters"]');
      // Coverage text renders (chaptersTotal > 0) but window detail must NOT appear
      expect(coverageEl).not.toBeNull();
      expect(coverageEl.nativeElement.textContent).not.toContain('0 windows');
      expect(coverageEl.nativeElement.textContent).not.toContain('windows');
    });

    it('PARTIAL warning (en): shows failedWindows warning when failedWindows > 0', () => {
      component.bookLanguage = 'en';
      component.bookReviewStatus = makeBookReviewStatus({
        language: 'en', chaptersReviewed: 4, chaptersTotal: 5,
        windowCount: 5, ranContinuityReduce: false, failedWindows: 2,
      });
      fixture.detectChanges();

      const el = query('[data-testid="brev-partial-warning"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('2');
      expect(text).toContain('windows failed');
    });

    it('PARTIAL warning (he): shows Hebrew failedWindows warning when failedWindows > 0', () => {
      component.bookReviewStatus = makeBookReviewStatus({
        chaptersReviewed: 3, chaptersTotal: 4,
        windowCount: 4, ranContinuityReduce: false, failedWindows: 1,
      });
      fixture.detectChanges();

      const el = query('[data-testid="brev-partial-warning"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('1');
      expect(text).toContain('נכשלו');
    });

    it('PARTIAL warning absent: NOT rendered when failedWindows=0 (status-probe default)', () => {
      component.bookReviewStatus = makeBookReviewStatus({
        chaptersReviewed: 4, chaptersTotal: 4,
        windowCount: 4, ranContinuityReduce: false, failedWindows: 0,
      });
      fixture.detectChanges();

      expect(query('[data-testid="brev-partial-warning"]')).toBeNull();
    });

    it('FAILED banner still shows when bookReviewBuildOutcome is "failed" (coverage fields do not suppress it)', () => {
      component.bookReviewStatus = makeBookReviewStatus({
        hasReview: false, ready: false,
        chaptersReviewed: 0, chaptersTotal: 0, windowCount: 0,
        ranContinuityReduce: false, failedWindows: 0,
      });
      component.bookReviewBuilding = false;
      component.bookReviewBuildOutcome = 'failed';
      component.bookReviewBuildOutcomeMessage = '';
      fixture.detectChanges();

      const el = query('[data-testid="brev-build-failed"]');
      expect(el).not.toBeNull();
      expect(el.nativeElement.getAttribute('role')).toBe('alert');
      expect(el.nativeElement.textContent).toContain('נכשלה');
    });

    it('PARTIAL coverage: bookReviewCoverageText contains real done/total AND decimal percentage', () => {
      component.bookReviewStatus = makeBookReviewStatus({
      chaptersReviewed: 40, chaptersTotal: 64,
      });
      fixture.detectChanges();

      const text = component.bookReviewCoverageText;
      expect(text).toContain('40/64');
      expect(text).toContain('(62.5%)');
    });

    it('FULL coverage: bookReviewCoverageText contains (100%) when all chapters reviewed', () => {
      component.bookReviewStatus = makeBookReviewStatus({
      chaptersReviewed: 48, chaptersTotal: 48,
      });
      fixture.detectChanges();

      const text = component.bookReviewCoverageText;
      expect(text).toContain('(100%)');
    });

    it('chaptersTotal=0: bookReviewCoverageText is empty and brev-coverage-chapters is absent', () => {
      component.bookReviewStatus = makeBookReviewStatus({
      chaptersReviewed: 0, chaptersTotal: 0,
      });
      fixture.detectChanges();

      expect(component.bookReviewCoverageText).toBe('');
      expect(query('[data-testid="brev-coverage-chapters"]')).toBeNull();
    });
  });

  // ── wb4-c06 FIX: build-shape captured from the LIVE build terminal survives the post-build status refresh ──
  // The window/continuity/failed-window shape is build-time-only: the persisted status probe reports 0/false,
  // and loadBookReviewStatus() (run at every build terminal) replaces bookReviewStatus with that zeroed probe.
  // The row now captures the shape from the TERMINAL progress payload so the window detail + partial warning
  // still render after a real build completes.
  describe('wb4-c06 fix: window detail + partial warning survive the post-build status refresh', () => {
    it('window detail renders after a build terminal even though the status refresh zeroes windowCount', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      // The post-build status refresh returns the ZEROED build-shape (the persisted probe) but real chapter
      // coverage + ready, exactly as the backend does after an async build.
      const status$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(status$.asObservable());

      component.bookLanguage = 'en';
      component.onBuildBookReview();

      // Terminal progress carries the LIVE build-shape (3 windows + continuity pass, no failures).
      poll$.next({
        status: 'succeeded', message: 'built', estimatedCompletionPercent: 100,
        bookReviewWindowCount: 3, bookReviewRanContinuityReduce: true, bookReviewFailedWindows: 0,
      });
      // The post-build status refresh: READY, real coverage, but the build-shape ZEROED (status probe default).
      status$.next(makeBookReviewStatus({
        language: 'en', ready: true, activeBuildJobId: null,
        chaptersReviewed: 4, chaptersTotal: 4,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0,
      }));
      fixture.detectChanges();

      expect(component.bookReviewState).toBe('ready');
      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      // The captured shape (3 windows + continuity pass) renders, NOT the zeroed status probe.
      expect(text).toContain('3 windows');
      expect(text).toContain('continuity pass');
    });

    it('partial-window warning renders after a build terminal despite the zeroed status refresh', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const status$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(status$.asObservable());

      component.bookLanguage = 'en';
      component.onBuildBookReview();

      // A degraded terminal: 5 windows, 2 failed.
      poll$.next({
        status: 'succeeded', message: 'Built with warnings (2 failed)', estimatedCompletionPercent: 100,
        bookReviewWindowCount: 5, bookReviewRanContinuityReduce: false, bookReviewFailedWindows: 2,
      });
      status$.next(makeBookReviewStatus({
        language: 'en', ready: true, activeBuildJobId: null,
        chaptersReviewed: 4, chaptersTotal: 5,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0,
      }));
      fixture.detectChanges();

      const el = query('[data-testid="brev-partial-warning"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('2');
      expect(text).toContain('windows failed');
    });

    it('a LEGACY build terminal (windowCount 0) hides the window detail even after the refresh', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      const status$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(status$.asObservable());

      component.bookLanguage = 'en';
      component.onBuildBookReview();

      // Legacy per-dimension build: windowCount 0 (no windows). A captured 0 must HIDE the detail (nullish
      // coalesce, not falling through to any status value).
      poll$.next({
        status: 'succeeded', message: 'built', estimatedCompletionPercent: 100,
        bookReviewWindowCount: 0, bookReviewRanContinuityReduce: false, bookReviewFailedWindows: 0,
      });
      status$.next(makeBookReviewStatus({
        language: 'en', ready: true, activeBuildJobId: null,
        chaptersReviewed: 3, chaptersTotal: 3,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0,
      }));
      fixture.detectChanges();

      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull(); // coverage text still shows (chaptersTotal > 0)
      expect(el.nativeElement.textContent).not.toContain('windows');
      expect(query('[data-testid="brev-partial-warning"]')).toBeNull();
    });

    it('Bug 1: a NO-OP rebuild (already fresh) preserves the window detail — no terminal repopulates it', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      // The POST no-ops (review already fresh): no jobId, so NO progress poll / terminal runs.
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: null, noOp: true } as any));
      const pollSpy = spyOn(reviewSvc, 'getReviewProgress').and.returnValue(NEVER);
      const readyStatus = makeBookReviewStatus({
        language: 'en', ready: true, activeBuildJobId: null,
        chaptersReviewed: 4, chaptersTotal: 4,
        windowCount: 0, ranContinuityReduce: false, failedWindows: 0, // the zeroed status probe
      });
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(of(readyStatus));

      component.bookLanguage = 'en';
      component.bookReviewStatus = readyStatus;
      // A prior live build in this session captured the shape currently on screen.
      component.bookReviewBuildWindowCount = 4;
      component.bookReviewBuildRanContinuityReduce = true;

      component.onBuildBookReview();
      fixture.detectChanges();

      // No build ran (no poll), the review + READY state are unchanged, so the window detail MUST survive.
      expect(pollSpy).not.toHaveBeenCalled();
      expect(component.bookReviewState).toBe('ready');
      const el = query('[data-testid="brev-coverage-chapters"]');
      expect(el).not.toBeNull();
      const text = el.nativeElement.textContent as string;
      expect(text).toContain('4 windows');
      expect(text).toContain('continuity pass');
    });

    it('Bug 2: a FAILED terminal PRESERVES the captured shape describing the still-displayed cached review', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);

      component.bookLanguage = 'en';
      // A prior successful build's shape describes the review currently on screen.
      component.bookReviewBuildWindowCount = 3;
      component.bookReviewBuildRanContinuityReduce = true;
      component.bookReviewBuildFailedWindows = 0;

      component.onBuildBookReview();

      // The rebuild TOTAL-fails: persist skipped, the displayed review is unchanged. This build's shape (2 windows,
      // 2 failed) must NOT be applied, AND the prior captured shape must NOT be wiped (it still describes what is
      // on screen in READY). Applying 2/2 would be misleading; nulling it would erase a valid detail (Bug 2).
      poll$.next({
        status: 'failed', message: 'no findings produced', estimatedCompletionPercent: 100,
        bookReviewWindowCount: 2, bookReviewRanContinuityReduce: false, bookReviewFailedWindows: 2,
      });

      expect(component.bookReviewBuildOutcome).toBe('failed');
      expect(component.bookReviewBuildWindowCount).toBe(3);
      expect(component.bookReviewBuildRanContinuityReduce).toBeTrue();
      expect(component.bookReviewBuildFailedWindows).toBe(0);
    });

    it('Bug 2: a CANCELED terminal (e.g. a failed job reattached from another tab) preserves the captured shape', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);

      component.bookLanguage = 'en';
      component.bookReviewBuildWindowCount = 5;
      component.bookReviewBuildRanContinuityReduce = false;
      component.bookReviewBuildFailedWindows = 1;

      component.onBuildBookReview();
      poll$.next({ status: 'canceled', message: 'reattaching', estimatedCompletionPercent: 0 });

      // A canceled build produced no new review → the on-screen review + its shape are unchanged.
      expect(component.bookReviewBuildWindowCount).toBe(5);
      expect(component.bookReviewBuildRanContinuityReduce).toBeFalse();
      expect(component.bookReviewBuildFailedWindows).toBe(1);
    });

    it('captured build-shape is cleared on a book switch (does not leak onto the next book)', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'getReviewStatus').and.returnValue(NEVER);
      // Simulate a prior build's captured shape.
      component.bookReviewBuildWindowCount = 3;
      component.bookReviewBuildRanContinuityReduce = true;
      component.bookReviewBuildFailedWindows = 1;

      component.bookId = 'book-2';
      component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });

      expect(component.bookReviewBuildWindowCount).toBeNull();
      expect(component.bookReviewBuildRanContinuityReduce).toBeNull();
      expect(component.bookReviewBuildFailedWindows).toBeNull();
    });
  });

  // ── c01: emit 'building' at the START of a user-initiated build ─────────────
  // A rebuild keeps the row at ready/stale the whole build, so the host kept the OLD findings on screen
  // and the post-build ready/stale emit was a no-op token bump (already showing). Emitting 'building' up
  // front makes the host unmount the findings panel for the duration and re-read after the build.
  describe('c01: emits building at the start of a user-initiated build', () => {
    it('onBuildBookReview() emits reviewStateChange("building") in-flight (held-open poll)', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      // Held-open progress Subject: the build stays in flight so 'building' is observed, never collapsed.
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());

      const emitted: string[] = [];
      component.reviewStateChange.subscribe((s) => emitted.push(s));

      component.bookLanguage = 'he';
      component.onBuildBookReview();

      // Still in flight (poll Subject never completed) — the host must already have seen 'building'.
      expect(component.bookReviewBuilding).toBeTrue();
      expect(emitted).toContain('building');
      // The FIRST emit on a user-initiated build is 'building' (before any status-driven emit).
      expect(emitted[0]).toBe('building');
    });

    it('confirmBookReviewBuild() (consent path) also emits reviewStateChange("building")', () => {
      const reviewSvc = TestBed.inject(BookReviewService);
      spyOn(reviewSvc, 'buildReview').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
      const poll$ = new Subject<any>();
      spyOn(reviewSvc, 'getReviewProgress').and.returnValue(poll$.asObservable());

      const emitted: string[] = [];
      component.reviewStateChange.subscribe((s) => emitted.push(s));

      // Stale review with briefs present: consent opens, then the user confirms the rebuild.
      component.bookLanguage = 'he';
      component.bookReviewStatus = makeBookReviewStatus({ hasReview: true, ready: false, staleVsBriefs: true });
      component.showBookReviewConsent = true;
      component.confirmBookReviewBuild();

      expect(component.bookReviewBuilding).toBeTrue();
      expect(component.showBookReviewConsent).toBeFalse();
      expect(emitted).toContain('building');
    });
  });
});
