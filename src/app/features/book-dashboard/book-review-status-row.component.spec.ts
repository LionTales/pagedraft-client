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
import { BookReviewStatusDto } from '../../core/models/book-review';

function makeBookReviewStatus(
  overrides: Partial<BookReviewStatusDto> = {}
): BookReviewStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    hasReview: true,
    findingCount: 12,
    lastUpdatedAt: new Date().toISOString(),
    builtWithModel: 'gemma4:12b',
    activeModel: 'gemma4:12b',
    builtWithDifferentModel: false,
    staleVsBriefs: false,
    hasBriefs: true,
    activeBuildJobId: null,
    ready: true,
    ...overrides,
  };
}

describe('BookReviewStatusRowComponent (wb3-c01)', () => {
  let component: BookReviewStatusRowComponent;
  let fixture: ComponentFixture<BookReviewStatusRowComponent>;

  beforeEach(async () => {
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
      builtWithModel: 'old-model', activeModel: 'gemma4:12b',
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
      hasReview: true, ready: false, staleVsBriefs: false, builtWithModel: 'old-model',
      activeModel: 'gemma4:12b', builtWithDifferentModel: true,
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
      builtWithDifferentModel: true, builtWithModel: 'old-model', activeModel: 'gemma4:12b',
    });
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
