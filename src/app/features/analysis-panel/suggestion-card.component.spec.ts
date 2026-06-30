import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SuggestionCardComponent } from './suggestion-card.component';
import { AnalysisSuggestion } from '../../core/models/analysis';

function buildSuggestion(overrides: Partial<AnalysisSuggestion>): AnalysisSuggestion {
  return {
    original: 'He walked slowly.',
    suggested: '',
    reason: 'POV inconsistency',
    category: 'consistency-pov',
    ...overrides
  };
}

describe('SuggestionCardComponent', () => {
  let fixture: ComponentFixture<SuggestionCardComponent>;
  let component: SuggestionCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuggestionCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SuggestionCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.suggestion = buildSuggestion({});
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('navigate-only item (empty suggested)', () => {
    beforeEach(() => {
      component.suggestion = buildSuggestion({
        id: 'nav-1',
        original: 'She glanced up.',
        suggested: '',
        category: 'consistency-pov',
        startOffset: 100,
        endOffset: 115
      });
      fixture.detectChanges();
    });

    it('navigateOnly getter returns true', () => {
      expect(component.navigateOnly).toBe(true);
    });

    it('should NOT render Accept button', () => {
      const accept = fixture.debugElement.query(By.css('.btn-accept'));
      expect(accept).toBeNull();
    });

    it('should render Show button', () => {
      const show = fixture.debugElement.query(By.css('.btn-show'));
      expect(show).not.toBeNull();
    });

    it('should render Text row with plain span (no frag-delete)', () => {
      const navigateText = fixture.debugElement.query(By.css('.suggestion-navigate-text'));
      expect(navigateText).not.toBeNull();
      expect(navigateText.nativeElement.textContent).toContain('She glanced up.');
      const fragDelete = fixture.debugElement.query(By.css('.frag-delete'));
      expect(fragDelete).toBeNull();
    });

    it('should NOT render Suggested row', () => {
      const suggested = fixture.debugElement.query(By.css('.suggestion-suggested'));
      expect(suggested).toBeNull();
    });

    it('Dismiss button label is OK', () => {
      const dismiss = fixture.debugElement.query(By.css('.btn-dismiss'));
      expect(dismiss.nativeElement.textContent.trim()).toBe('OK');
    });
  });

  describe('navigate-only item with null offsets (fallback descriptive, NOT navigable)', () => {
    beforeEach(() => {
      component.suggestion = buildSuggestion({
        id: 'nav-2',
        original: 'She glanced up.',
        suggested: '',
        category: 'consistency-pov',
        startOffset: null,
        endOffset: null
      });
      fixture.detectChanges();
    });

    it('should NOT render Show button when navigate-only and no offsets', () => {
      const show = fixture.debugElement.query(By.css('.btn-show'));
      expect(show).toBeNull();
    });

    it('card click does not emit showInDocument when navigate-only and no offsets', () => {
      const emitted: AnalysisSuggestion[] = [];
      component.showInDocument.subscribe((s: AnalysisSuggestion) => emitted.push(s));
      const card = fixture.debugElement.query(By.css('.suggestion-card'));
      card.nativeElement.click();
      expect(emitted.length).toBe(0);
    });
  });

  describe('consistency sub-category labels (he/en parity)', () => {
    it('getCategoryLabel returns POV for consistency-pov when lang=en', () => {
      component.suggestion = buildSuggestion({ category: 'consistency-pov' });
      component.lang = 'en';
      fixture.detectChanges();
      expect(component.getCategoryLabel('consistency-pov')).toBe('POV');
    });

    it('getCategoryLabel returns נקודת מבט for consistency-pov when lang=he', () => {
      component.suggestion = buildSuggestion({ category: 'consistency-pov' });
      component.lang = 'he';
      fixture.detectChanges();
      expect(component.getCategoryLabel('consistency-pov')).toBe('נקודת מבט');
    });

    it('getCategoryLabel returns Register for consistency-register when lang=en', () => {
      component.suggestion = buildSuggestion({ category: 'consistency-register' });
      component.lang = 'en';
      fixture.detectChanges();
      expect(component.getCategoryLabel('consistency-register')).toBe('Register');
    });

    it('getCategoryLabel returns רישום for consistency-register when lang=he', () => {
      component.suggestion = buildSuggestion({ category: 'consistency-register' });
      component.lang = 'he';
      fixture.detectChanges();
      expect(component.getCategoryLabel('consistency-register')).toBe('רישום');
    });

    it('getCategoryLabel still returns Consistency for consistency key when lang=en (no regression)', () => {
      component.suggestion = buildSuggestion({ category: 'consistency' });
      component.lang = 'en';
      fixture.detectChanges();
      expect(component.getCategoryLabel('consistency')).toBe('Consistency');
    });

    it('rendered chip for consistency-register carries category-consistency-register class', () => {
      component.suggestion = buildSuggestion({
        id: 'reg-1',
        original: 'He spoke.',
        suggested: '',
        category: 'consistency-register',
        startOffset: 0,
        endOffset: 9
      });
      component.lang = 'en';
      fixture.detectChanges();
      const chip = fixture.debugElement.query(By.css('.category-consistency-register'));
      expect(chip).not.toBeNull();
    });
  });

  // =========================================================================
  // navigate-only: clicking Show emits showInDocument with the suggestion
  // =========================================================================

  describe('navigate-only: Show button emits showInDocument', () => {
    let emitted: AnalysisSuggestion[];
    const navSuggestion: AnalysisSuggestion = {
      id: 'nav-emit-1',
      original: 'He looked away.',
      suggested: '',
      category: 'consistency-pov',
      startOffset: 50,
      endOffset: 65,
    };

    beforeEach(() => {
      emitted = [];
      component.suggestion = { ...navSuggestion };
      component.showInDocument.subscribe((s: AnalysisSuggestion) => emitted.push(s));
      fixture.detectChanges();
    });

    it('clicking Show button emits showInDocument with the suggestion (correct id)', () => {
      const show = fixture.debugElement.query(By.css('.btn-show'));
      expect(show).not.toBeNull();
      show.nativeElement.click();
      expect(emitted.length).toBe(1);
      expect(emitted[0].id).toBe('nav-emit-1');
    });

    it('clicking Show button emits showInDocument with the correct offsets', () => {
      fixture.debugElement.query(By.css('.btn-show')).nativeElement.click();
      expect(emitted[0].startOffset).toBe(50);
      expect(emitted[0].endOffset).toBe(65);
    });

    it('clicking Show button emits showInDocument with the original text', () => {
      fixture.debugElement.query(By.css('.btn-show')).nativeElement.click();
      expect(emitted[0].original).toBe('He looked away.');
    });
  });

  // =========================================================================
  // stale navigate-only: Show button is disabled and card is dimmed
  // =========================================================================

  describe('stale navigate-only item', () => {
    beforeEach(() => {
      component.suggestion = buildSuggestion({
        id: 'stale-1',
        original: 'She ran fast.',
        suggested: '',
        category: 'consistency-tense',
        startOffset: 10,
        endOffset: 23,
      });
      component.stale = true;
      fixture.detectChanges();
    });

    it('card element carries stale CSS class', () => {
      const card = fixture.debugElement.query(By.css('.suggestion-card'));
      expect(card.classes['stale']).toBe(true);
    });

    it('Show button is disabled when stale', () => {
      const show = fixture.debugElement.query(By.css('.btn-show'));
      expect(show).not.toBeNull();
      expect(show.nativeElement.disabled).toBe(true);
    });

    it('stale-badge is rendered inside the card', () => {
      const badge = fixture.debugElement.query(By.css('.stale-badge'));
      expect(badge).not.toBeNull();
    });
  });

  // =========================================================================
  // Dismiss emits the suggestion back to the parent
  // =========================================================================

  describe('dismiss emits the suggestion', () => {
    it('clicking Dismiss (OK) emits the suggestion via dismiss output', () => {
      const suggestion = buildSuggestion({
        id: 'dis-1',
        original: 'He thought twice.',
        suggested: '',
        category: 'consistency-pov',
        startOffset: 0,
        endOffset: 17,
      });
      component.suggestion = suggestion;
      fixture.detectChanges();

      const emitted: AnalysisSuggestion[] = [];
      component.dismiss.subscribe((s: AnalysisSuggestion) => emitted.push(s));

      const btn = fixture.debugElement.query(By.css('.btn-dismiss'));
      btn.nativeElement.click();

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe(suggestion);
    });
  });

  describe('normal has-change item (non-empty suggested)', () => {
    beforeEach(() => {
      component.suggestion = buildSuggestion({
        id: 'chg-1',
        original: 'He walked slowly.',
        suggested: 'He crept forward.',
        startOffset: 50,
        endOffset: 67
      });
      fixture.detectChanges();
    });

    it('navigateOnly getter returns false', () => {
      expect(component.navigateOnly).toBe(false);
    });

    it('should render Accept button', () => {
      const accept = fixture.debugElement.query(By.css('.btn-accept'));
      expect(accept).not.toBeNull();
    });

    it('should render Show button', () => {
      const show = fixture.debugElement.query(By.css('.btn-show'));
      expect(show).not.toBeNull();
    });

    it('should render Original diff row', () => {
      const original = fixture.debugElement.query(By.css('.suggestion-original'));
      expect(original).not.toBeNull();
    });

    it('should render Suggested diff row', () => {
      const suggested = fixture.debugElement.query(By.css('.suggestion-suggested'));
      expect(suggested).not.toBeNull();
    });

    it('should NOT render navigate-text row', () => {
      const navigateText = fixture.debugElement.query(By.css('.suggestion-navigate-text'));
      expect(navigateText).toBeNull();
    });

    it('Dismiss button label is Dismiss', () => {
      const dismiss = fixture.debugElement.query(By.css('.btn-dismiss'));
      expect(dismiss.nativeElement.textContent.trim()).toBe('Dismiss');
    });
  });

  // =========================================================================
  // Non-consistency suggestion with empty suggested (e.g. pure-deletion in
  // proofread/line-edit). Must NOT be treated as navigate-only: Accept button
  // and Original diff row must still render.
  // =========================================================================

  describe('non-consistency suggestion with empty suggested (pure-deletion)', () => {
    beforeEach(() => {
      component.suggestion = buildSuggestion({
        id: 'del-1',
        original: 'some words',
        suggested: '',
        category: 'style',
        startOffset: 0,
        endOffset: 10
      });
      fixture.detectChanges();
    });

    it('navigateOnly getter returns false for non-consistency empty-suggested', () => {
      expect(component.navigateOnly).toBe(false);
    });

    it('should render Accept button for pure-deletion non-consistency suggestion', () => {
      const accept = fixture.debugElement.query(By.css('.btn-accept'));
      expect(accept).not.toBeNull();
    });

    it('should render Original diff row (delete-diff) for pure-deletion non-consistency suggestion', () => {
      const original = fixture.debugElement.query(By.css('.suggestion-original'));
      expect(original).not.toBeNull();
    });

    it('should render Show button for pure-deletion non-consistency suggestion with offsets', () => {
      const show = fixture.debugElement.query(By.css('.btn-show'));
      expect(show).not.toBeNull();
    });

    it('Dismiss button label is Dismiss (not OK) for pure-deletion non-consistency suggestion', () => {
      const dismiss = fixture.debugElement.query(By.css('.btn-dismiss'));
      expect(dismiss.nativeElement.textContent.trim()).toBe('Dismiss');
    });
  });

  // =========================================================================
  // Bug 1: rationaleOpen is per-suggestion presentational state. When a list
  // reuses a card instance for ANOTHER suggestion (filter/reorder/trackBy), the
  // detail panel must collapse — but an in-place / immutable explanation update
  // to the SAME suggestion (the "Why?" flow) must keep it open.
  // =========================================================================

  describe('rationale open-state across suggestion reuse (Bug 1)', () => {
    it('collapses an open rationale when the card instance is reused for a DIFFERENT suggestion', () => {
      const first = buildSuggestion({ id: 'a-1', original: 'x', suggested: 'y', reason: 'r1' });
      component.suggestion = first;
      component.ngOnChanges({ suggestion: new SimpleChange(undefined, first, true) });
      component.toggleRationale();
      expect(component.rationaleOpen).toBeTrue();

      // The list reused this same instance for a different item (e.g. after a filter/reorder).
      const second = buildSuggestion({ id: 'b-2', original: 'p', suggested: 'q', reason: 'r2' });
      component.suggestion = second;
      component.ngOnChanges({ suggestion: new SimpleChange(first, second, false) });
      expect(component.rationaleOpen).toBeFalse();
    });

    it('collapses for id-less suggestions reused by object identity (different reference)', () => {
      const first = buildSuggestion({ original: 'x', suggested: 'y', reason: 'r1' }); // no id
      component.suggestion = first;
      component.ngOnChanges({ suggestion: new SimpleChange(undefined, first, true) });
      component.toggleRationale();
      expect(component.rationaleOpen).toBeTrue();

      const second = buildSuggestion({ original: 'p', suggested: 'q', reason: 'r2' }); // no id, new ref
      component.suggestion = second;
      component.ngOnChanges({ suggestion: new SimpleChange(first, second, false) });
      expect(component.rationaleOpen).toBeFalse();
    });

    it('keeps the rationale open when the SAME suggestion (same id) is replaced to graft an explanation', () => {
      const s = buildSuggestion({ id: 'same-1', original: 'x', suggested: 'y', reason: 'r' });
      component.suggestion = s;
      component.ngOnChanges({ suggestion: new SimpleChange(undefined, s, true) });
      component.toggleRationale();
      expect(component.rationaleOpen).toBeTrue();

      // The "Why?" flow grafts an explanation. Even if done immutably (new object, SAME id), the open
      // rationale the user is reading must NOT collapse out from under them.
      const explained = { ...s, explanation: 'because of POV drift' };
      component.suggestion = explained;
      component.ngOnChanges({ suggestion: new SimpleChange(s, explained, false) });
      expect(component.rationaleOpen).toBeTrue();
    });
  });
});
