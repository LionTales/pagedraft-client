/**
 * wb2-f03: Book review status row spec.
 * Tests the four states (NOT BUILT / BUILDING+progress / READY+findingCount / STALE+refresh),
 * the "needs summary first" gate (hasBriefs===false), and the consent flow.
 * Clones the book-summary-status-row.spec.ts pattern, targeting AnalysisRunTabComponent.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { BookReviewStatusDto } from '../../core/models/book-review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AnalysisRunTabComponent – Book review status row (wb2-f03)', () => {
  let component: AnalysisRunTabComponent;
  let fixture: ComponentFixture<AnalysisRunTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisRunTabComponent],
      providers: [{ provide: LineEditParserService, useValue: { getLineEdit: () => null } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisRunTabComponent);
    component = fixture.componentInstance;
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
      hasReview: false,
      ready: false,
      hasBriefs: false,
      findingCount: 0,
      lastUpdatedAt: null,
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('needs-summary');
    expect(query('[data-testid="brev-needs-summary"]')).not.toBeNull();
    expect(query('[data-testid="brev-needs-summary-hint"]')).not.toBeNull();
    // Build action must not be present.
    expect(query('[data-testid="brev-build-now"]')).toBeNull();
    expect(query('[data-testid="brev-refresh"]')).toBeNull();
  });

  it('NEEDS-SUMMARY: openBookReviewConsent is a no-op (cannot build without briefs)', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false, hasBriefs: false });
    fixture.detectChanges();

    let emitted = 0;
    component.buildBookReview.subscribe(() => emitted++);

    component.openBookReviewConsent();
    fixture.detectChanges();

    // Consent must not open.
    expect(query('[data-testid="brev-consent"]')).toBeNull();
    expect(emitted).toBe(0);
  });

  it('NEEDS-SUMMARY: confirmBookReviewBuild is a no-op when hasBriefs is false', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false, hasBriefs: false });
    component.showBookReviewConsent = true; // force-open to test the guard inside confirm
    fixture.detectChanges();

    let emitted = 0;
    component.buildBookReview.subscribe(() => emitted++);

    component.confirmBookReviewBuild();

    expect(emitted).toBe(0);
    expect(component.showBookReviewConsent).toBeFalse();
  });

  // ── NOT BUILT ──────────────────────────────────────────────────────────────

  it('NOT BUILT: shows the not-built badge and a "Build now" button', () => {
    component.bookReviewStatus = makeBookReviewStatus({
      hasReview: false,
      ready: false,
      findingCount: 0,
      lastUpdatedAt: null,
      hasBriefs: true,
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
    // Build action must not be offered while building.
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
      hasReview: true,
      ready: false,
      staleVsBriefs: true,
      findingCount: 5,
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
      hasReview: true,
      ready: false,
      staleVsBriefs: false,
      builtWithDifferentModel: true,
      builtWithModel: 'old-model',
      activeModel: 'gemma4:12b',
    });
    fixture.detectChanges();

    expect(component.bookReviewState).toBe('stale');
    expect(query('[data-testid="brev-cross-model-warning"]')).not.toBeNull();
    expect(query('[data-testid="brev-refresh"]')).not.toBeNull();
  });

  // ── CONSENT GATE ───────────────────────────────────────────────────────────

  it('CONSENT gate: build is NOT emitted until the user confirms', () => {
    component.bookReviewStatus = makeBookReviewStatus({
      hasReview: false,
      ready: false,
      findingCount: 0,
      hasBriefs: true,
    });
    let emittedCount = 0;
    component.buildBookReview.subscribe(() => emittedCount++);
    fixture.detectChanges();

    // Click "Build now" -> consent appears, no emit yet.
    query('[data-testid="brev-build-now"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="brev-consent"]')).not.toBeNull();
    expect(emittedCount).toBe(0);

    // Confirm -> emit fires exactly once and consent closes.
    query('[data-testid="brev-consent-confirm"]').nativeElement.click();
    fixture.detectChanges();
    expect(emittedCount).toBe(1);
    expect(component.showBookReviewConsent).toBeFalse();
  });

  it('CONSENT cancel: closes without emitting', () => {
    component.bookReviewStatus = makeBookReviewStatus({
      hasReview: false, ready: false, hasBriefs: true, findingCount: 0,
    });
    let emittedCount = 0;
    component.buildBookReview.subscribe(() => emittedCount++);
    fixture.detectChanges();

    query('[data-testid="brev-build-now"]').nativeElement.click();
    fixture.detectChanges();
    query('[data-testid="brev-consent-cancel"]').nativeElement.click();
    fixture.detectChanges();

    expect(emittedCount).toBe(0);
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

  it('confirmBookReviewBuild is a no-op while building (closes prompt, emits no duplicate)', () => {
    let emitted = 0;
    component.buildBookReview.subscribe(() => emitted++);
    component.bookReviewStatus = makeBookReviewStatus({ hasBriefs: true });
    component.showBookReviewConsent = true;
    component.bookReviewBuilding = true;

    component.confirmBookReviewBuild();

    expect(emitted).toBe(0);
    expect(component.showBookReviewConsent).toBeFalse();
  });

  // ── ngOnChanges consent dismissal ──────────────────────────────────────────

  it('clears the consent prompt when the book changes', () => {
    component.showBookReviewConsent = true;
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    expect(component.showBookReviewConsent).toBeFalse();
  });

  it('clears the consent prompt when the book language changes', () => {
    component.showBookReviewConsent = true;
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    expect(component.showBookReviewConsent).toBeFalse();
  });

  it('clears the consent prompt when a build becomes in flight (reattach)', () => {
    component.showBookReviewConsent = true;
    component.ngOnChanges({ bookReviewBuilding: new SimpleChange(false, true, false) });
    expect(component.showBookReviewConsent).toBeFalse();
  });

  it('does NOT clear the consent prompt on an unrelated input change', () => {
    component.showBookReviewConsent = true;
    component.ngOnChanges({ sceneId: new SimpleChange(null, 'scene-9', false) });
    expect(component.showBookReviewConsent).toBeTrue();
  });

  // ── Cross-model staleness ──────────────────────────────────────────────────

  it('CROSS-MODEL (he): shows the Hebrew warning and keeps a Refresh affordance', () => {
    component.bookReviewStatus = makeBookReviewStatus({
      hasReview: true,
      ready: false,
      staleVsBriefs: false,
      builtWithModel: 'old-model',
      activeModel: 'gemma4:12b',
      builtWithDifferentModel: true,
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
      language: 'en',
      hasReview: true,
      ready: false,
      staleVsBriefs: false,
      builtWithDifferentModel: true,
      builtWithModel: 'old-model',
      activeModel: 'gemma4:12b',
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
    // DRAFT Hebrew: "תקצירי ספר" appears in the hint text.
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

  // ── BUILD OUTCOME: failed / degraded (wb2-c05) ─────────────────────────────

  it('FAILED outcome: renders a red error banner so a total failure is not a silent green finish', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuildOutcomeMessage = '';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-failed"]');
    expect(el).not.toBeNull();
    // role=alert for assistive tech; Hebrew (default) copy + rtl dir.
    expect(el.nativeElement.getAttribute('role')).toBe('alert');
    expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(el.nativeElement.textContent).toContain('נכשלה');
    // The degraded banner must not also render.
    expect(query('[data-testid="brev-build-degraded"]')).toBeNull();
  });

  it('DEGRADED outcome: renders a softer warning banner naming the partial failure', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: true, ready: true, findingCount: 4 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'degraded';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-degraded"]');
    expect(el).not.toBeNull();
    // Hebrew (default) localized copy enriched with the structured findingCount.
    expect(el.nativeElement.textContent).toContain('חלקית');
    expect(el.nativeElement.textContent).toContain('4');
    expect(query('[data-testid="brev-build-failed"]')).toBeNull();
  });

  // wb2-c01: the banner must NEVER surface the raw, hardcoded-English BE terminal message to
  // Hebrew users. It must always render the localized he label, regardless of the @Input message.
  it('FAILED (he): renders the HEBREW label and NOT the raw English BE message', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false, findingCount: 0 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'failed';
    // Non-empty hardcoded-English BE terminal message (as BookReviewService.cs emits).
    component.bookReviewBuildOutcomeMessage =
      'Whole-book review failed: the combined review call produced no findings.';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-failed"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    // Banner text equals the Hebrew label...
    expect(el.nativeElement.textContent.trim()).toBe(component.bookReviewLabel('buildFailed'));
    expect(el.nativeElement.textContent).toContain('נכשלה');
    // ...and does NOT leak any of the English BE message.
    expect(el.nativeElement.textContent).not.toContain('Whole-book review failed');
    expect(el.nativeElement.textContent).not.toContain('combined review call');
  });

  it('DEGRADED (he): renders the HEBREW label and NOT the raw English BE message', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: true, ready: true, findingCount: 4 });
    component.bookReviewBuilding = false;
    component.bookReviewBuildOutcome = 'degraded';
    component.bookReviewBuildOutcomeMessage =
      'Whole-book review built with warnings: 4 findings across 4/6 dimensions (2 failed).';
    fixture.detectChanges();

    const el = query('[data-testid="brev-build-degraded"]');
    expect(el).not.toBeNull();
    expect(el.nativeElement.getAttribute('dir')).toBe('rtl');
    // Localized Hebrew copy, enriched with the structured findingCount (4) — no English parsing.
    expect(el.nativeElement.textContent).toContain('חלקית');
    expect(el.nativeElement.textContent).toContain('4');
    // ...and does NOT leak any of the English BE message.
    expect(el.nativeElement.textContent).not.toContain('built with warnings');
    expect(el.nativeElement.textContent).not.toContain('2 failed');
  });

  it('OUTCOME banner is hidden while a new build is in flight (transient progress owns the row)', () => {
    component.bookReviewStatus = makeBookReviewStatus({ hasReview: false, ready: false });
    component.bookReviewBuildOutcome = 'failed';
    component.bookReviewBuilding = true; // a new build started; the old failure banner must yield
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
});
