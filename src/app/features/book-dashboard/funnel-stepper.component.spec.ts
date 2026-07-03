/**
 * rf-f02: FunnelStepperComponent spec.
 *
 * Covers:
 *   (a) No summary yet -> Assess is lit next-step ('current'), Revise 'available', Polish 'coming'.
 *   (b) Summary building (summaryRunning=true) -> Assess 'in-progress'.
 *   (c) Summary ready, review not built -> Assess 'current' (lit next-step).
 *   (d) Review ready -> Assess 'done', Revise 'current' (lit next-step); Polish always 'coming'.
 *   Exactly ONE step is lit ('current') at a time.
 *   CTA fires the mode-switch output (assessRequested / reviseRequested).
 *   RTL dir when book language Hebrew; he/en label parity.
 *   Polish has no clickable CTA (hasCta=false, no button element).
 *   Non-blocking: no assertions gating other UI (stepper is additive / advisory).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SimpleChange } from '@angular/core';
import {
  FunnelStepperComponent,
  ResolvedStep,
  StepState,
} from './funnel-stepper.component';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal input set for the component. */
function setInputs(
  component: FunnelStepperComponent,
  opts: {
    bookLanguage?: string | null;
    summaryRunning?: boolean;
    reviewRunning?: boolean;
    summaryReady?: boolean;
    reviewReady?: boolean;
    hasBriefs?: boolean;
  },
): void {
  component.bookLanguage = opts.bookLanguage ?? 'he';
  component.summaryRunning = opts.summaryRunning ?? false;
  component.reviewRunning = opts.reviewRunning ?? false;
  component.summaryReady = opts.summaryReady ?? false;
  component.reviewReady = opts.reviewReady ?? false;
  component.hasBriefs = opts.hasBriefs ?? false;
  // Trigger ngOnChanges so deriveSteps() runs.
  component.ngOnChanges({
    bookLanguage: new SimpleChange(null, component.bookLanguage, false),
    summaryRunning: new SimpleChange(false, component.summaryRunning, false),
    reviewRunning: new SimpleChange(false, component.reviewRunning, false),
    summaryReady: new SimpleChange(false, component.summaryReady, false),
    reviewReady: new SimpleChange(false, component.reviewReady, false),
    hasBriefs: new SimpleChange(false, component.hasBriefs, false),
  });
}

/** Return the state for a given step id from the resolved array. */
function stateOf(steps: ResolvedStep[], id: string): StepState {
  const step = steps.find(s => s.id === id);
  if (!step) throw new Error(`Step not found: ${id}`);
  return step.state;
}

/** Count how many steps are in state 'current'. */
function currentCount(steps: ResolvedStep[]): number {
  return steps.filter(s => s.state === 'current').length;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('FunnelStepperComponent (rf-f02)', () => {
  let component: FunnelStepperComponent;
  let fixture: ComponentFixture<FunnelStepperComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FunnelStepperComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FunnelStepperComponent);
    component = fixture.componentInstance;
    // Run initial change detection so Angular fully initializes the component (OnPush).
    fixture.detectChanges();
  });

  // ── (a) No summary / nothing built ──────────────────────────────────────────

  describe('(a) no summary yet', () => {
    beforeEach(() => {
      setInputs(component, {
        summaryRunning: false,
        reviewRunning: false,
        summaryReady: false,
        reviewReady: false,
        hasBriefs: false,
      });
    });

    it('Structure is done', () => {
      expect(stateOf(component.resolvedSteps, 'structure')).toBe('done');
    });

    it('Assess is the lit next-step (current)', () => {
      expect(stateOf(component.resolvedSteps, 'assess')).toBe('current');
    });

    it('Revise is available (not current)', () => {
      expect(stateOf(component.resolvedSteps, 'revise')).toBe('available');
    });

    it('Polish is coming/disabled', () => {
      expect(stateOf(component.resolvedSteps, 'polish')).toBe('coming');
    });

    it('exactly ONE step is current', () => {
      expect(currentCount(component.resolvedSteps)).toBe(1);
    });

    it('Assess has a CTA', () => {
      const assess = component.resolvedSteps.find(s => s.id === 'assess')!;
      expect(assess.hasCta).toBeTrue();
      expect(assess.ctaLabel.length).toBeGreaterThan(0);
    });

    it('Polish has NO CTA', () => {
      const polish = component.resolvedSteps.find(s => s.id === 'polish')!;
      expect(polish.hasCta).toBeFalse();
    });
  });

  // ── (b) Summary building (job running) ───────────────────────────────────────

  describe('(b) summary building', () => {
    beforeEach(() => {
      setInputs(component, {
        summaryRunning: true,
        reviewRunning: false,
        summaryReady: false,
        reviewReady: false,
        hasBriefs: false,
      });
    });

    it('Assess is in-progress', () => {
      expect(stateOf(component.resolvedSteps, 'assess')).toBe('in-progress');
    });

    it('Structure is still done', () => {
      expect(stateOf(component.resolvedSteps, 'structure')).toBe('done');
    });

    it('Polish is still coming', () => {
      expect(stateOf(component.resolvedSteps, 'polish')).toBe('coming');
    });

    it('zero steps are current when assess is in-progress', () => {
      // in-progress is the active state for Assess; there is no separate 'current' step.
      expect(currentCount(component.resolvedSteps)).toBe(0);
    });
  });

  describe('(b2) review building', () => {
    beforeEach(() => {
      setInputs(component, {
        summaryRunning: false,
        reviewRunning: true,
        summaryReady: true,
        reviewReady: false,
        hasBriefs: true,
      });
    });

    it('Assess is in-progress when reviewRunning', () => {
      expect(stateOf(component.resolvedSteps, 'assess')).toBe('in-progress');
    });

    it('Polish is still coming', () => {
      expect(stateOf(component.resolvedSteps, 'polish')).toBe('coming');
    });
  });

  // ── (c) Summary ready, review not yet built ───────────────────────────────────

  describe('(c) summary ready, review not built', () => {
    beforeEach(() => {
      setInputs(component, {
        summaryRunning: false,
        reviewRunning: false,
        summaryReady: true,
        reviewReady: false,
        hasBriefs: true,
      });
    });

    it('Assess is still the lit next-step (current)', () => {
      expect(stateOf(component.resolvedSteps, 'assess')).toBe('current');
    });

    it('Revise is available (not current)', () => {
      expect(stateOf(component.resolvedSteps, 'revise')).toBe('available');
    });

    it('exactly ONE step is current', () => {
      expect(currentCount(component.resolvedSteps)).toBe(1);
    });

    it('Assess CTA label is non-empty', () => {
      const assess = component.resolvedSteps.find(s => s.id === 'assess')!;
      expect(assess.ctaLabel.length).toBeGreaterThan(0);
    });
  });

  // ── (d) Review ready ────────────────────────────────────────────────────────

  describe('(d) review ready', () => {
    beforeEach(() => {
      setInputs(component, {
        summaryRunning: false,
        reviewRunning: false,
        summaryReady: true,
        reviewReady: true,
        hasBriefs: true,
      });
    });

    it('Assess is done', () => {
      expect(stateOf(component.resolvedSteps, 'assess')).toBe('done');
    });

    it('Revise is the lit next-step (current)', () => {
      expect(stateOf(component.resolvedSteps, 'revise')).toBe('current');
    });

    it('Polish is still coming', () => {
      expect(stateOf(component.resolvedSteps, 'polish')).toBe('coming');
    });

    it('exactly ONE step is current', () => {
      expect(currentCount(component.resolvedSteps)).toBe(1);
    });

    it('Revise has a CTA', () => {
      const revise = component.resolvedSteps.find(s => s.id === 'revise')!;
      expect(revise.hasCta).toBeTrue();
    });

    it('Polish has no CTA', () => {
      const polish = component.resolvedSteps.find(s => s.id === 'polish')!;
      expect(polish.hasCta).toBeFalse();
    });
  });

  // ── CTA fires the mode-switch output ─────────────────────────────────────────

  describe('CTA outputs', () => {
    it('assessRequested emits when Assess CTA is clicked (class-level)', () => {
      setInputs(component, { summaryReady: false, reviewReady: false });
      // Spy on the EventEmitter's emit method directly so we don't depend on subscribe timing.
      const spy = spyOn(component.assessRequested, 'emit');
      component.onCtaClick('assess');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('reviseRequested emits when Revise CTA is clicked (class-level)', () => {
      setInputs(component, { summaryReady: true, reviewReady: true, hasBriefs: true });
      const spy = spyOn(component.reviseRequested, 'emit');
      component.onCtaClick('revise');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('no output fires for Polish (no hasCta; onCtaClick with polish is a no-op)', () => {
      setInputs(component, {});
      const assessSpy = spyOn(component.assessRequested, 'emit');
      const reviseSpy = spyOn(component.reviseRequested, 'emit');
      // Polish CTA should not exist, but even if called it should not emit.
      component.onCtaClick('polish');
      expect(assessSpy).not.toHaveBeenCalled();
      expect(reviseSpy).not.toHaveBeenCalled();
    });

    it('DOM: Assess CTA button triggers assessRequested (reviewReady=false)', () => {
      setInputs(component, { summaryReady: false, reviewReady: false });
      fixture.detectChanges();
      const spy = spyOn(component.assessRequested, 'emit');
      const btn = fixture.debugElement.query(By.css('[data-testid="funnel-cta-assess"]'));
      expect(btn).toBeTruthy('Assess CTA button should be in the DOM');
      btn.triggerEventHandler('click', null);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('DOM: Revise CTA button triggers reviseRequested (reviewReady=true)', () => {
      setInputs(component, { summaryReady: true, reviewReady: true, hasBriefs: true });
      fixture.detectChanges();
      const spy = spyOn(component.reviseRequested, 'emit');
      const btn = fixture.debugElement.query(By.css('[data-testid="funnel-cta-revise"]'));
      expect(btn).toBeTruthy('Revise CTA button should be in the DOM');
      btn.triggerEventHandler('click', null);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── RTL + dir ─────────────────────────────────────────────────────────────────

  describe('RTL direction', () => {
    it('dir=rtl when bookLanguage is he', () => {
      setInputs(component, { bookLanguage: 'he' });
      expect(component.dir).toBe('rtl');
      expect(component.isHebrew).toBeTrue();
    });

    it('dir=rtl when bookLanguage is null (Hebrew default)', () => {
      setInputs(component, { bookLanguage: null });
      expect(component.dir).toBe('rtl');
      expect(component.isHebrew).toBeTrue();
    });

    it('dir=ltr when bookLanguage is en', () => {
      setInputs(component, { bookLanguage: 'en' });
      expect(component.dir).toBe('ltr');
      expect(component.isHebrew).toBeFalse();
    });

    it('DOM: nav element has dir=rtl for Hebrew', () => {
      setInputs(component, { bookLanguage: 'he' });
      fixture.detectChanges();
      const nav = fixture.debugElement.query(By.css('.funnel-stepper'));
      expect(nav.nativeElement.getAttribute('dir')).toBe('rtl');
    });

    it('DOM: nav element has dir=ltr for English', () => {
      setInputs(component, { bookLanguage: 'en' });
      fixture.detectChanges();
      const nav = fixture.debugElement.query(By.css('.funnel-stepper'));
      expect(nav.nativeElement.getAttribute('dir')).toBe('ltr');
    });
  });

  // ── he/en label parity ────────────────────────────────────────────────────────

  describe('he/en label parity', () => {
    it('resolves non-empty labels in Hebrew (he)', () => {
      setInputs(component, { bookLanguage: 'he' });
      for (const step of component.resolvedSteps) {
        expect(step.label.length).toBeGreaterThan(0);
        expect(step.stateLabel.length).toBeGreaterThan(0);
      }
    });

    it('resolves non-empty labels in English (en)', () => {
      setInputs(component, { bookLanguage: 'en' });
      for (const step of component.resolvedSteps) {
        expect(step.label.length).toBeGreaterThan(0);
        expect(step.stateLabel.length).toBeGreaterThan(0);
      }
    });

    it('Hebrew and English step labels are different', () => {
      setInputs(component, { bookLanguage: 'he' });
      const heSteps = component.resolvedSteps.map(s => s.label);
      setInputs(component, { bookLanguage: 'en' });
      const enSteps = component.resolvedSteps.map(s => s.label);
      // At least some labels should differ between locales.
      const anyDiffers = heSteps.some((l, i) => l !== enSteps[i]);
      expect(anyDiffers).toBeTrue();
    });

    it('Assess CTA has non-empty label in Hebrew when no summary', () => {
      setInputs(component, { bookLanguage: 'he', summaryReady: false, reviewReady: false });
      const assess = component.resolvedSteps.find(s => s.id === 'assess')!;
      expect(assess.hasCta).toBeTrue();
      expect(assess.ctaLabel.length).toBeGreaterThan(0);
    });

    it('Assess CTA has non-empty label in English when no summary', () => {
      setInputs(component, { bookLanguage: 'en', summaryReady: false, reviewReady: false });
      const assess = component.resolvedSteps.find(s => s.id === 'assess')!;
      expect(assess.hasCta).toBeTrue();
      expect(assess.ctaLabel.length).toBeGreaterThan(0);
    });
  });

  // ── Polish: no dead click ────────────────────────────────────────────────────

  describe('Polish non-interactivity', () => {
    it('Polish hasCta is always false', () => {
      // Check across multiple scenarios.
      const scenarios = [
        { summaryReady: false, reviewReady: false },
        { summaryReady: true, reviewReady: false },
        { summaryReady: true, reviewReady: true, hasBriefs: true },
      ];
      for (const s of scenarios) {
        setInputs(component, s);
        const polish = component.resolvedSteps.find(st => st.id === 'polish')!;
        expect(polish.hasCta).toBeFalse();
        expect(polish.ctaLabel).toBe('');
      }
    });

    it('DOM: Polish has no CTA button when reviewReady=false', () => {
      setInputs(component, { reviewReady: false });
      fixture.detectChanges();
      const btn = fixture.debugElement.query(By.css('[data-testid="funnel-cta-polish"]'));
      expect(btn).toBeNull();
    });

    it('DOM: Polish has no CTA button when reviewReady=true', () => {
      setInputs(component, { summaryReady: true, reviewReady: true, hasBriefs: true });
      fixture.detectChanges();
      const btn = fixture.debugElement.query(By.css('[data-testid="funnel-cta-polish"]'));
      expect(btn).toBeNull();
    });
  });

  // ── Polish: coming-soon info affordance ────────────────────────────────────────

  describe('Polish coming-soon info popover', () => {
    it('renders an info button on the Polish step (not a CTA)', () => {
      setInputs(component, {});
      fixture.detectChanges();
      const infoBtn = fixture.debugElement.query(By.css('[data-testid="funnel-polish-info-btn"]'));
      expect(infoBtn).toBeTruthy();
      // It must NOT be the funnel CTA and must not turn Polish into a lit step.
      const polish = component.resolvedSteps.find(s => s.id === 'polish')!;
      expect(polish.hasCta).toBeFalse();
      expect(fixture.debugElement.query(By.css('[data-testid="funnel-cta-polish"]'))).toBeNull();
    });

    it('the info button toggles the explanation panel and aria-expanded', () => {
      setInputs(component, {});
      fixture.detectChanges();
      const infoBtn = fixture.debugElement.query(By.css('[data-testid="funnel-polish-info-btn"]'));
      // Closed initially.
      expect(component.polishInfoOpen).toBeFalse();
      expect(infoBtn.nativeElement.getAttribute('aria-expanded')).toBe('false');
      expect(fixture.debugElement.query(By.css('#funnel-polish-info'))).toBeNull();
      // Open.
      infoBtn.nativeElement.click();
      fixture.detectChanges();
      expect(component.polishInfoOpen).toBeTrue();
      expect(infoBtn.nativeElement.getAttribute('aria-expanded')).toBe('true');
      expect(fixture.debugElement.query(By.css('#funnel-polish-info'))).toBeTruthy();
      // Toggle closed again.
      infoBtn.nativeElement.click();
      fixture.detectChanges();
      expect(component.polishInfoOpen).toBeFalse();
      expect(fixture.debugElement.query(By.css('#funnel-polish-info'))).toBeNull();
    });

    it('shows the Hebrew explanation for a Hebrew book', () => {
      setInputs(component, { bookLanguage: 'he' });
      component.togglePolishInfo();
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.css('#funnel-polish-info')).nativeElement as HTMLElement;
      expect(panel.textContent).toContain('ליטוש');
      expect(panel.textContent).toContain('הגהה');
    });

    it('shows the English explanation for an English book', () => {
      setInputs(component, { bookLanguage: 'en' });
      component.togglePolishInfo();
      fixture.detectChanges();
      const panel = fixture.debugElement.query(By.css('#funnel-polish-info')).nativeElement as HTMLElement;
      expect(panel.textContent).toContain('Polish');
      expect((panel.textContent ?? '').toLowerCase()).toContain('proofread');
    });

    it('Escape closes the panel', () => {
      setInputs(component, {});
      component.togglePolishInfo();
      fixture.detectChanges();
      expect(component.polishInfoOpen).toBeTrue();
      component.onEscapeKey();
      fixture.detectChanges();
      expect(component.polishInfoOpen).toBeFalse();
      expect(fixture.debugElement.query(By.css('#funnel-polish-info'))).toBeNull();
    });

    it('the close button dismisses the panel', () => {
      setInputs(component, {});
      component.togglePolishInfo();
      fixture.detectChanges();
      const closeBtn = fixture.debugElement.query(By.css('[data-testid="funnel-polish-info-close"]'));
      expect(closeBtn).toBeTruthy();
      closeBtn.nativeElement.click();
      fixture.detectChanges();
      expect(component.polishInfoOpen).toBeFalse();
    });
  });

  // ── Step count ────────────────────────────────────────────────────────────────

  it('always renders exactly 4 steps', () => {
    setInputs(component, {});
    expect(component.resolvedSteps.length).toBe(4);
    fixture.detectChanges();
    const stepEls = fixture.debugElement.queryAll(By.css('.funnel-step'));
    expect(stepEls.length).toBe(4);
  });

  // ── Structure always done ─────────────────────────────────────────────────────

  it('Structure is done in every scenario (component mounted = book loaded)', () => {
    const scenarios = [
      { summaryReady: false, reviewReady: false },
      { summaryRunning: true },
      { summaryReady: true, reviewReady: false },
      { summaryReady: true, reviewReady: true, hasBriefs: true },
    ];
    for (const s of scenarios) {
      setInputs(component, s);
      expect(stateOf(component.resolvedSteps, 'structure')).toBe('done');
    }
  });

  // ── No em-dash in any user-facing string ──────────────────────────────────────

  it('no em-dash (0x2014) in any resolved label or CTA', () => {
    const scenarios = [
      { bookLanguage: 'he', summaryReady: false, reviewReady: false },
      { bookLanguage: 'en', summaryReady: true, reviewReady: true, hasBriefs: true },
    ];
    for (const s of scenarios) {
      setInputs(component, s);
      for (const step of component.resolvedSteps) {
        expect(step.label).not.toContain('—');
        expect(step.stateLabel).not.toContain('—');
        expect(step.ctaLabel).not.toContain('—');
      }
    }
  });
});
