/**
 * Wave 3 / w5 (MOVE-1 + MOVE-2): the book-wide writing-style row, on the book dashboard.
 *
 * This suite is where the coverage that used to live in the per-chapter analysis panel and its Run tab
 * LANDED. It is not new coverage invented for a new component: the four states, the consent gate, the
 * estimate, the paid-tier note, the cross-model warning, the DEF-2 reattach and the registry track() are
 * the same properties, asserted against the surface that owns them now. The migration rule this repo has
 * paid for before is that a relocated behaviour carries its tests with it rather than being re-derived.
 *
 * Every build path is driven through an rxjs Subject held OPEN across the assertions, so a terminal or
 * error emit lands inside the real in-flight window; a synchronous of() would close that window before it
 * could be observed and would pass against code that never opened it.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of } from 'rxjs';
import { BookStyleBaselineStatusRowComponent } from './book-style-baseline-status-row.component';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { BookStyleBaselineStatusDto } from '../../core/models/style-baseline';

function makeStatus(overrides: Partial<BookStyleBaselineStatusDto> = {}): BookStyleBaselineStatusDto {
  return {
    bookId: 'book-1',
    language: 'he',
    totalChapters: 5,
    builtChapters: 5,
    staleCount: 0,
    hasBaseline: true,
    ready: true,
    lastUpdatedAt: new Date().toISOString(),
    builtWithDifferentModel: false,
    activeBuildJobId: null,
    chaptersToBuild: 0,
    estimatedSeconds: 0,
    estimatedUsd: null,
    ...overrides,
  };
}

describe('BookStyleBaselineStatusRowComponent (w5 MOVE-1 + MOVE-2)', () => {
  let component: BookStyleBaselineStatusRowComponent;
  let fixture: ComponentFixture<BookStyleBaselineStatusRowComponent>;
  let jobRegistrySpy: jasmine.SpyObj<JobRegistryService>;

  beforeEach(async () => {
    jobRegistrySpy = jasmine.createSpyObj<JobRegistryService>('JobRegistryService', ['track']);
    await TestBed.configureTestingModule({
      imports: [BookStyleBaselineStatusRowComponent],
      providers: [
        {
          provide: StyleBaselineService,
          useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER },
        },
        { provide: AnalysisProgressService, useValue: { pollStyleBaselineProgress: () => NEVER } },
        { provide: JobRegistryService, useValue: jobRegistrySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BookStyleBaselineStatusRowComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // ── The four states ──────────────────────────────────────────────────────────

  it('does not render the row while the state is unknown (null status)', () => {
    component.styleBaselineStatus = null;
    fixture.detectChanges();
    expect(query('[data-testid="book-style-baseline-row"]')).toBeNull();
  });

  it('NOT BUILT: shows the not-built badge and a "Build now" action', () => {
    component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0 });
    fixture.detectChanges();

    expect(component.baselineState).toBe('not-built');
    expect(query('[data-testid="bsb-not-built"]')).not.toBeNull();
    expect(query('[data-testid="bsb-build-now"]')).not.toBeNull();
  });

  it('BUILDING: shows the building status with a progress percent', () => {
    component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0 });
    component.styleBaselineBuilding = true;
    component.styleBaselineProgressPercent = 42;
    fixture.detectChanges();

    expect(component.baselineState).toBe('building');
    const building = query('[data-testid="bsb-building"]');
    expect(building).not.toBeNull();
    expect(building.nativeElement.textContent).toContain('42');
  });

  it('READY: shows coverage N/N, an "updated" relative time, AND a rebuild action', () => {
    component.styleBaselineStatus = makeStatus();
    fixture.detectChanges();

    expect(component.baselineState).toBe('ready');
    expect(query('[data-testid="bsb-ready"]').nativeElement.textContent).toContain('5/5');
    expect(component.baselineUpdatedRelative).not.toBe('');
    // The predecessor row offered nothing in the ready state, which is how the product ended up needing a
    // bare arrow for the other build. A rebuildable artifact keeps a rebuild affordance.
    expect(query('[data-testid="bsb-rebuild"]')).not.toBeNull();
  });

  it('STALE: shows the changed-chapter count and a Refresh action', () => {
    component.styleBaselineStatus = makeStatus({ ready: false, staleCount: 3, chaptersToBuild: 3 });
    fixture.detectChanges();

    expect(component.baselineState).toBe('stale');
    expect(query('[data-testid="bsb-stale"]').nativeElement.textContent).toContain('3');
    expect(query('[data-testid="bsb-refresh"]')).not.toBeNull();
  });

  // ── The consent gate, the estimate and the paid-tier note (MOVE-2) ───────────

  it('CONSENT gate: the build is NOT POSTed until the user confirms', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const buildSpy = spyOn(svc, 'buildStyleBaseline').and.returnValue(NEVER);
    component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0, chaptersToBuild: 5, estimatedSeconds: 120 });
    fixture.detectChanges();

    (query('[data-testid="bsb-build-now"]').nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(query('[data-testid="bsb-consent"]')).not.toBeNull();
    expect(buildSpy).not.toHaveBeenCalled();

    (query('[data-testid="bsb-consent-confirm"]').nativeElement as HTMLButtonElement).click();
    expect(buildSpy).toHaveBeenCalledWith('book-1', 'he');
  });

  it('CONSENT cancel: closes the prompt without building', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const buildSpy = spyOn(svc, 'buildStyleBaseline').and.returnValue(NEVER);
    component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0 });
    component.showBaselineConsent = true;
    fixture.detectChanges();

    (query('[data-testid="bsb-consent-cancel"]').nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.showBaselineConsent).toBeFalse();
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('CONSENT: hidden while a build is in flight, so a lingering confirm cannot duplicate it', () => {
    component.styleBaselineStatus = makeStatus({ ready: false, staleCount: 2, chaptersToBuild: 2 });
    component.showBaselineConsent = true;
    component.styleBaselineBuilding = true;
    fixture.detectChanges();
    expect(query('[data-testid="bsb-consent"]')).toBeNull();

    component.styleBaselineBuilding = false;
    fixture.detectChanges();
    expect(query('[data-testid="bsb-consent"]')).not.toBeNull();
  });

  it('confirmBaselineBuild is a no-op while building (closes the prompt, POSTs nothing)', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const buildSpy = spyOn(svc, 'buildStyleBaseline').and.returnValue(NEVER);
    component.showBaselineConsent = true;
    component.styleBaselineBuilding = true;

    component.confirmBaselineBuild();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(component.showBaselineConsent).toBeFalse();
  });

  it('CONSENT estimate: appends "~$" only for paid providers (estimatedUsd != null)', () => {
    component.styleBaselineStatus = makeStatus({ ready: false, chaptersToBuild: 3, estimatedSeconds: 120 });
    expect(component.baselineConsentEstimate).not.toContain('$');

    component.styleBaselineStatus = makeStatus({ ready: false, chaptersToBuild: 3, estimatedSeconds: 120, estimatedUsd: 0.12 });
    expect(component.baselineConsentEstimate).toContain('~$0.12');
  });

  it('PAID NOTE: the figure and its explanation can never appear apart', () => {
    component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0, chaptersToBuild: 4, estimatedSeconds: 120 });
    component.showBaselineConsent = true;
    fixture.detectChanges();
    expect(component.baselineConsentIsPaid).toBeFalse();
    expect(query('[data-testid="bsb-consent-paid-note"]')).toBeNull();

    component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0, chaptersToBuild: 4, estimatedSeconds: 120, estimatedUsd: 0.4 });
    fixture.detectChanges();
    expect(component.baselineConsentIsPaid).toBeTrue();
    const note = query('[data-testid="bsb-consent-paid-note"]');
    expect(note).not.toBeNull();
    expect(query('[data-testid="bsb-consent-estimate"]').nativeElement.textContent).toContain('$');
  });

  it('the paid note names a tier and a third-party provider, never a model or a vendor', () => {
    for (const lang of ['he', 'en']) {
      component.bookLanguage = lang;
      const note = component.baselineLabel('consentPaidNote').toLowerCase();
      for (const forbidden of ['gpt', 'openai', 'anthropic', 'claude', 'gemma', 'ollama', 'azure', 'llama']) {
        expect(note).withContext(`${lang}/${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  // ── Cross-model staleness ────────────────────────────────────────────────────

  it('CROSS-MODEL (he): shows the warning and keeps the refresh affordance reachable', () => {
    component.styleBaselineStatus = makeStatus({ ready: false, staleCount: 0, builtWithDifferentModel: true });
    fixture.detectChanges();

    expect(component.baselineState).toBe('stale');
    const warning = query('[data-testid="bsb-cross-model-warning"]');
    expect(warning).not.toBeNull();
    expect(warning.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(query('[data-testid="bsb-refresh"]')).not.toBeNull();
  });

  it('CROSS-MODEL (en): renders the English copy and an ltr direction', () => {
    component.bookLanguage = 'en';
    component.styleBaselineStatus = makeStatus({ language: 'en', ready: false, staleCount: 2, builtWithDifferentModel: true });
    fixture.detectChanges();

    const warning = query('[data-testid="bsb-cross-model-warning"]');
    expect(warning.nativeElement.textContent).toContain('different model');
    expect(warning.nativeElement.getAttribute('dir')).toBe('ltr');
  });

  it('CROSS-MODEL absent: no warning when builtWithDifferentModel is false', () => {
    component.styleBaselineStatus = makeStatus({ ready: false, staleCount: 2 });
    fixture.detectChanges();
    expect(query('[data-testid="bsb-cross-model-warning"]')).toBeNull();
  });

  // ── Build orchestration: track, reattach, language guard ─────────────────────

  it('publishes the build to the registry once with kind/bookId/jobId on a fresh build', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const progress = TestBed.inject(AnalysisProgressService);
    spyOn(svc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    spyOn(progress, 'pollStyleBaselineProgress').and.returnValue(NEVER);
    spyOn(svc, 'getStyleBaselineStatus').and.returnValue(NEVER);

    component.onBuildStyleBaseline();

    expect(jobRegistrySpy.track).toHaveBeenCalledOnceWith('style-baseline', 'book-1', 'job-1');
  });

  it('does NOT track a no-op build (there is no job to report)', () => {
    const svc = TestBed.inject(StyleBaselineService);
    spyOn(svc, 'buildStyleBaseline').and.returnValue(of({ jobId: null, noOp: true } as any));
    spyOn(svc, 'getStyleBaselineStatus').and.returnValue(NEVER);

    component.onBuildStyleBaseline();

    expect(jobRegistrySpy.track).not.toHaveBeenCalled();
    expect(component.styleBaselineBuilding).toBeFalse();
  });

  it('DEF-2: reattaches (BUILDING + polls that jobId + tracks it) when status advertises a build', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const progress = TestBed.inject(AnalysisProgressService);
    spyOn(svc, 'getStyleBaselineStatus').and.returnValue(of(makeStatus({ activeBuildJobId: 'job-running' })));
    const pollSpy = spyOn(progress, 'pollStyleBaselineProgress').and.returnValue(NEVER);

    component.loadStyleBaselineStatus();

    expect(pollSpy).toHaveBeenCalledWith('book-1', 'job-running', jasmine.anything());
    expect(component.styleBaselineBuilding).toBeTrue();
    expect(jobRegistrySpy.track).toHaveBeenCalledWith('style-baseline', 'book-1', 'job-running');
  });

  it('does not reattach twice to a jobId it already drove to terminal', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const progress = TestBed.inject(AnalysisProgressService);
    spyOn(svc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    const poll$ = new Subject<any>();
    spyOn(progress, 'pollStyleBaselineProgress').and.returnValue(poll$.asObservable());
    // Every status read keeps advertising the finished job (the lingering-registry-entry case).
    spyOn(svc, 'getStyleBaselineStatus').and.returnValue(of(makeStatus({ activeBuildJobId: 'job-1' })));

    component.onBuildStyleBaseline();
    poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });

    expect(component.styleBaselineBuilding).toBeFalse();
    // One poll for the build itself; the status read that follows must NOT open a second.
    expect((progress.pollStyleBaselineProgress as jasmine.Spy).calls.count()).toBe(1);
  });

  it('a build is keyed by (book, language): a language switch tears the current one down', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const progress = TestBed.inject(AnalysisProgressService);
    spyOn(svc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    const poll$ = new Subject<any>();
    spyOn(progress, 'pollStyleBaselineProgress').and.returnValue(poll$.asObservable());
    spyOn(svc, 'getStyleBaselineStatus').and.returnValue(NEVER);

    component.bookLanguage = 'he';
    component.onBuildStyleBaseline();
    expect(component.styleBaselineBuilding).toBeTrue();

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    expect(component.styleBaselineBuilding).toBeFalse();
    expect(component.styleBaselineStatus).toBeNull();

    // A late emit for the abandoned language must not resurrect the old build's state.
    poll$.next({ status: 'running', message: 'he-side', estimatedCompletionPercent: 50 });
    expect(component.styleBaselineBuilding).toBeFalse();
  });

  it('re-reads status once when a build reaches a terminal state (no other row depends on baseline builds today)', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const progress = TestBed.inject(AnalysisProgressService);
    spyOn(svc, 'buildStyleBaseline').and.returnValue(of({ jobId: 'job-1', noOp: false } as any));
    const poll$ = new Subject<any>();
    spyOn(progress, 'pollStyleBaselineProgress').and.returnValue(poll$.asObservable());
    const statusSpy = spyOn(svc, 'getStyleBaselineStatus').and.returnValue(NEVER);

    component.onBuildStyleBaseline();
    poll$.next({ status: 'succeeded', message: 'done', estimatedCompletionPercent: 100 });

    expect(component.styleBaselineBuilding).toBeFalse();
    expect(statusSpy).toHaveBeenCalledOnceWith('book-1', 'he');
  });

  it('a tier change re-reads the status through the same loader (supersede, not race)', () => {
    const svc = TestBed.inject(StyleBaselineService);
    const getSpy = spyOn(svc, 'getStyleBaselineStatus').and.returnValue(NEVER);

    component.onTierChanged();

    expect(getSpy).toHaveBeenCalledOnceWith('book-1', 'he');
  });

  // ── Naming, language rule, direction ─────────────────────────────────────────

  it('Hebrew (default): a user-comprehensible name, an explanation, and rtl', () => {
    component.styleBaselineStatus = makeStatus();
    fixture.detectChanges();

    const row = query('[data-testid="book-style-baseline-row"]');
    expect(row.nativeElement.getAttribute('dir')).toBe('rtl');
    expect(row.nativeElement.textContent).toContain('סגנון הכתיבה של הספר');
    // The artifact appears in NO shipped guide, so the row carries its own one-line explanation.
    expect(query('[data-testid="bsb-what"]').nativeElement.textContent).toContain('חורג');
  });

  it('English book: English name + explanation and ltr (book-scoped chrome follows the book)', () => {
    component.bookLanguage = 'en';
    component.styleBaselineStatus = makeStatus({ language: 'en' });
    fixture.detectChanges();

    const row = query('[data-testid="book-style-baseline-row"]');
    expect(row.nativeElement.getAttribute('dir')).toBe('ltr');
    expect(row.nativeElement.textContent).toContain("Your book's writing style");
    expect(query('[data-testid="bsb-what"]').nativeElement.textContent).toContain('flagged');
  });

  it('the row no longer uses the engineering term "baseline" in any user-facing string', () => {
    for (const lang of ['he', 'en']) {
      component.bookLanguage = lang;
      for (const key of ['title', 'what', 'consentTitle', 'consentBody', 'crossModelWarning']) {
        expect(component.baselineLabel(key).toLowerCase())
          .withContext(`${lang}/${key}`)
          .not.toContain('baseline');
      }
    }
  });

  it('he/en label parity, and no em-dash or en-dash in any user-facing string', () => {
    const keys = [
      'title', 'what', 'notBuilt', 'buildNow', 'building', 'refresh', 'rebuild', 'coverage', 'updated',
      'stalePrefix', 'consentTitle', 'consentBody', 'consentPaidNote', 'confirm', 'cancel',
      'crossModelWarning',
    ];
    for (const key of keys) {
      component.bookLanguage = 'he';
      const he = component.baselineLabel(key);
      component.bookLanguage = 'en';
      const en = component.baselineLabel(key);

      expect(he).withContext(`he missing key ${key}`).not.toBe(key);
      expect(en).withContext(`en missing key ${key}`).not.toBe(key);
      for (const text of [he, en]) {
        expect(text).withContext(`em-dash in ${key}`).not.toContain('—');
        expect(text).withContext(`en-dash in ${key}`).not.toContain('–');
      }
    }
  });

  // ── The D13 retarget's landing point ─────────────────────────────────────────

  it('scrolls itself into view when the host raises the focus token (the retargeted pointer)', (done) => {
    component.styleBaselineStatus = makeStatus();
    fixture.detectChanges();
    const row = query('[data-testid="book-style-baseline-row"]').nativeElement as HTMLElement;
    const scrollSpy = spyOn(row, 'scrollIntoView');
    spyOn(document, 'querySelector').and.returnValue(row);

    component.focusToken = 1;
    component.ngOnChanges({ focusToken: new SimpleChange(0, 1, false) });

    // The scroll is deferred a tick: the host raises the token in the same pass that switches the
    // assistant to Book review, so this row may not be laid out when the input arrives.
    setTimeout(() => {
      expect(scrollSpy).toHaveBeenCalled();
      done();
    });
  });

  it('does not scroll on the FIRST binding of the token (nobody asked)', () => {
    const scrollSpy = spyOn(document, 'querySelector');
    component.ngOnChanges({ focusToken: new SimpleChange(undefined, 0, true) });
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  // ── Wave 3 fixes / c02: the import precondition ────────────────────────────────────────────────────
  //
  // Found live on the empty book: the spine said `blocked, needs Import first` and this row's Build now
  // sat enabled below it. The row now reads the SAME chapter count the spine derives from.

  describe('c02: the import precondition, disabled WITH the reason', () => {
    it('disables the build and states why when the book has no chapters', () => {
      component.chapterCount = 0;
      component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0, totalChapters: 0 });
      fixture.detectChanges();

      const btn = query('[data-testid="bsb-build-now"]');
      expect(btn).withContext('disabled, never hidden').not.toBeNull();
      expect((btn.nativeElement as HTMLButtonElement).disabled).toBeTrue();
      const reason = query('[data-testid="bsb-needs-import"]');
      expect(reason).not.toBeNull();
      expect((reason.nativeElement as HTMLElement).textContent!.trim().length).toBeGreaterThan(0);
    });

    it('refuses to open the consent prompt for a book with no chapters', () => {
      component.chapterCount = 0;
      component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0, totalChapters: 0 });

      component.openBaselineConsent();

      expect(component.showBaselineConsent).toBeFalse();
    });

    it('leaves the build ENABLED while the chapter count is not known yet (null is not empty)', () => {
      component.chapterCount = null;
      component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0 });
      fixture.detectChanges();

      expect((query('[data-testid="bsb-build-now"]').nativeElement as HTMLButtonElement).disabled).toBeFalse();
      expect(query('[data-testid="bsb-needs-import"]')).toBeNull();
      component.openBaselineConsent();
      expect(component.showBaselineConsent).toBeTrue();
    });

    it('states the reason in the book language, both sides (he/en parity)', () => {
      component.chapterCount = 0;
      component.styleBaselineStatus = makeStatus({ hasBaseline: false, ready: false, builtChapters: 0, totalChapters: 0 });
      component.bookLanguage = 'he';
      fixture.detectChanges();
      const he = (query('[data-testid="bsb-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      component.bookLanguage = 'en';
      fixture.detectChanges();
      const en = (query('[data-testid="bsb-needs-import"]').nativeElement as HTMLElement).textContent!.trim();

      expect(he).not.toBe('needsImport');
      expect(en).not.toBe('needsImport');
      expect(he).not.toBe(en);
      expect(he).not.toContain('—');
      expect(en).not.toContain('—');
    });
  });
});
