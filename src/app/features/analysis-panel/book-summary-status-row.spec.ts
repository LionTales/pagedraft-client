/**
 * wb1-f01: Book summary / briefs status row spec.
 * Tests the four states (NOT BUILT / BUILDING+progress / READY+coverage / STALE+refresh)
 * and the consent gate (build is not POSTed until the user confirms).
 * Mirrors the style-baseline describe block in analysis-run-tab.component.spec.ts.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { BookSummaryStatusDto } from '../../core/models/book-summary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AnalysisRunTabComponent – Book summary status row (wb1-f01)', () => {
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
    component.bookSummaryStatus = null;
    component.bookSummaryBuilding = false;
    fixture.detectChanges();
    expect(query('[data-testid="book-summary-row"]')).toBeNull();
  });

  it('renders the row as soon as a status is available (regardless of analysis type)', () => {
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
    // Build action must not be offered while building.
    expect(query('[data-testid="bsum-build-now"]')).toBeNull();
  });

  it('BUILDING: BUILDING flag wins over the status snapshot (client-tracked state)', () => {
    // Status says ready, but a build is in flight on the client.
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

  it('CONSENT gate: build is NOT emitted until the user confirms', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false,
      ready: false,
      builtChapters: 0,
      chaptersToBuild: 3,
      estimatedSeconds: 75,
    });
    let emittedCount = 0;
    component.buildBookSummary.subscribe(() => emittedCount++);
    fixture.detectChanges();

    // Click "Build now" -> consent appears, no emit yet.
    query('[data-testid="bsum-build-now"]').nativeElement.click();
    fixture.detectChanges();
    expect(query('[data-testid="bsum-consent"]')).not.toBeNull();
    expect(emittedCount).toBe(0);

    // Estimate shows chapters + minutes; no "$" because estimatedUsd is null.
    const estimate = query('[data-testid="bsum-consent-estimate"]').nativeElement.textContent;
    expect(estimate).toContain('3');
    expect(estimate).toContain('2'); // ceil(75/60) = 2
    expect(estimate).not.toContain('$');

    // Confirm -> emit fires exactly once and consent closes.
    query('[data-testid="bsum-consent-confirm"]').nativeElement.click();
    fixture.detectChanges();
    expect(emittedCount).toBe(1);
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  it('CONSENT cancel: closes without emitting', () => {
    component.bookSummaryStatus = makeBookSummaryStatus({
      hasSummary: false, ready: false, builtChapters: 0, chaptersToBuild: 1, estimatedSeconds: 30,
    });
    let emittedCount = 0;
    component.buildBookSummary.subscribe(() => emittedCount++);
    fixture.detectChanges();

    query('[data-testid="bsum-build-now"]').nativeElement.click();
    fixture.detectChanges();
    query('[data-testid="bsum-consent-cancel"]').nativeElement.click();
    fixture.detectChanges();

    expect(emittedCount).toBe(0);
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

  it('confirmBookSummaryBuild is a no-op while building (closes prompt, emits no duplicate)', () => {
    let emitted = 0;
    component.buildBookSummary.subscribe(() => emitted++);
    component.showBookSummaryConsent = true;
    component.bookSummaryBuilding = true;

    component.confirmBookSummaryBuild();

    expect(emitted).toBe(0);
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  // ── ngOnChanges consent dismissal ──────────────────────────────────────────

  it('clears the consent prompt when the book changes', () => {
    component.showBookSummaryConsent = true;
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  it('clears the consent prompt when the book language changes', () => {
    component.showBookSummaryConsent = true;
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  it('clears the consent prompt when a build becomes in flight (reattach)', () => {
    component.showBookSummaryConsent = true;
    component.ngOnChanges({ bookSummaryBuilding: new SimpleChange(false, true, false) });
    expect(component.showBookSummaryConsent).toBeFalse();
  });

  it('does NOT clear the consent prompt on an unrelated input change', () => {
    component.showBookSummaryConsent = true;
    component.ngOnChanges({ sceneId: new SimpleChange(null, 'scene-9', false) });
    expect(component.showBookSummaryConsent).toBeTrue();
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
});
