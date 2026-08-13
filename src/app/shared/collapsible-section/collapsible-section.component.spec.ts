/**
 * Wave 3 / w5 - THE COLLAPSIBLE SECTION, the owner's addition to Q6.
 *
 * Two things are pinned here and they matter for different reasons. The BEHAVIOUR (fold, unfold, remember
 * per book, default to the current layout) is the feature. The FAILURE MODE (storage unavailable, storage
 * corrupt) is the safety property: a view preference must never be able to break a dashboard, so every
 * storage path fails open to "use the defaults", which is indistinguishable from a first-run reader.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { CollapsibleSectionComponent } from './collapsible-section.component';
import { collapseStorageKey, readCollapseMap, writeCollapseState } from './collapse-store';

describe('CollapsibleSectionComponent (w5 collapse directive)', () => {
  let component: CollapsibleSectionComponent;
  let fixture: ComponentFixture<CollapsibleSectionComponent>;

  beforeEach(async () => {
    localStorage.removeItem(collapseStorageKey('book-1'));
    localStorage.removeItem(collapseStorageKey('book-2'));
    await TestBed.configureTestingModule({ imports: [CollapsibleSectionComponent] }).compileComponents();
    fixture = TestBed.createComponent(CollapsibleSectionComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.removeItem(collapseStorageKey('book-1'));
    localStorage.removeItem(collapseStorageKey('book-2'));
  });

  /** Bind the inputs the host binds, then run the OnChanges the host's binding would run. */
  function mount(sectionId: string, bookId: string | null, defaultCollapsed = false, dir: 'rtl' | 'ltr' = 'rtl'): void {
    component.sectionId = sectionId;
    component.bookId = bookId;
    component.defaultCollapsed = defaultCollapsed;
    component.dir = dir;
    component.heading = 'Section heading';
    component.ngOnChanges({
      sectionId: new SimpleChange(undefined, sectionId, true),
      bookId: new SimpleChange(undefined, bookId, true),
      defaultCollapsed: new SimpleChange(undefined, defaultCollapsed, true),
    });
    fixture.detectChanges();
  }

  function toggleEl(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('.cs-header')).nativeElement as HTMLButtonElement;
  }

  function bodyEl() {
    return fixture.debugElement.query(By.css('.cs-body'));
  }

  it('defaults to EXPANDED, because the wave must not hide anything the reader sees today', () => {
    mount('overview', 'book-1');
    expect(component.collapsed).toBeFalse();
    expect(bodyEl()).not.toBeNull();
  });

  it('a long content list may opt in to defaulting COLLAPSED', () => {
    mount('inputs', 'book-1', true);
    expect(component.collapsed).toBeTrue();
    expect(bodyEl()).toBeNull();
  });

  it('the collapsed body is REMOVED from the DOM, not just visually hidden', () => {
    mount('overview', 'book-1');
    expect(bodyEl()).not.toBeNull();
    toggleEl().click();
    fixture.detectChanges();
    // Removed rather than display:none, so a collapsed section cannot be tab-focused or read out.
    expect(bodyEl()).toBeNull();
  });

  it('the HEADER stays visible when collapsed: the directive may hide content, never its own affordance', () => {
    mount('inputs', 'book-1', true);
    expect(fixture.debugElement.query(By.css('.cs-header'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css(`[data-testid="collapse-toggle-inputs"]`))).not.toBeNull();
  });

  it('exposes the fold state to assistive tech via aria-expanded + aria-controls', () => {
    mount('overview', 'book-1');
    expect(toggleEl().getAttribute('aria-expanded')).toBe('true');
    expect(toggleEl().getAttribute('aria-controls')).toBe('cs-body-overview');
    expect(bodyEl().nativeElement.getAttribute('id')).toBe('cs-body-overview');

    toggleEl().click();
    fixture.detectChanges();
    expect(toggleEl().getAttribute('aria-expanded')).toBe('false');
  });

  it('mirrors with the bound direction rather than pinning a physical side', () => {
    mount('overview', 'book-1', false, 'ltr');
    expect(fixture.debugElement.query(By.css('.cs')).nativeElement.getAttribute('dir')).toBe('ltr');

    component.dir = 'rtl';
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.cs')).nativeElement.getAttribute('dir')).toBe('rtl');
  });

  // ── Persistence, per book ────────────────────────────────────────────────────

  it('remembers a fold for THIS book, and a stored value outranks the default', () => {
    mount('overview', 'book-1');
    toggleEl().click();
    fixture.detectChanges();

    expect(readCollapseMap('book-1')['overview']).toBeTrue();

    // A fresh mount of the same section on the same book reads the stored fold back.
    const second = TestBed.createComponent(CollapsibleSectionComponent);
    second.componentInstance.sectionId = 'overview';
    second.componentInstance.bookId = 'book-1';
    second.componentInstance.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    expect(second.componentInstance.collapsed).toBeTrue();
  });

  it('a stored EXPANDED outranks a defaultCollapsed of true (the reader wins over the default)', () => {
    writeCollapseState('book-1', 'inputs', false);
    mount('inputs', 'book-1', true);
    expect(component.collapsed).toBeFalse();
  });

  it('keys the memory per book: folding a section on one book does not fold it on another', () => {
    mount('overview', 'book-1');
    toggleEl().click();
    fixture.detectChanges();
    expect(component.collapsed).toBeTrue();

    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    fixture.detectChanges();

    expect(component.collapsed).withContext('book-2 has never been folded').toBeFalse();
    expect(readCollapseMap('book-1')['overview']).withContext("book-1's memory is untouched").toBeTrue();
  });

  it('writing one section preserves the other sections already stored for the book', () => {
    writeCollapseState('book-1', 'overview', true);
    writeCollapseState('book-1', 'plot', false);
    writeCollapseState('book-1', 'ask', true);

    const map = readCollapseMap('book-1');
    expect(map).toEqual({ overview: true, plot: false, ask: true });
  });

  // ── Fails open ───────────────────────────────────────────────────────────────

  it('reads as empty (i.e. uses the defaults) when storage throws', () => {
    spyOn(localStorage, 'getItem').and.throwError('SecurityError');
    expect(readCollapseMap('book-1')).toEqual({});
  });

  it('reads as empty when the stored value is corrupt, and ignores non-boolean entries', () => {
    localStorage.setItem(collapseStorageKey('book-1'), 'not json at all');
    expect(readCollapseMap('book-1')).toEqual({});

    localStorage.setItem(collapseStorageKey('book-1'), JSON.stringify(['an', 'array']));
    expect(readCollapseMap('book-1')).toEqual({});

    localStorage.setItem(collapseStorageKey('book-1'), JSON.stringify({ overview: 'yes', plot: true }));
    expect(readCollapseMap('book-1')).toEqual({ plot: true });
  });

  it('still folds for this session when the WRITE throws (it just is not remembered)', () => {
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
    mount('overview', 'book-1');

    expect(() => toggleEl().click()).not.toThrow();
    fixture.detectChanges();
    expect(component.collapsed).toBeTrue();
  });

  it('does nothing at all without a book id (there is nowhere to key the memory)', () => {
    expect(readCollapseMap(null)).toEqual({});
    const setSpy = spyOn(localStorage, 'setItem');
    writeCollapseState(null, 'overview', true);
    writeCollapseState('book-1', '', true);
    expect(setSpy).not.toHaveBeenCalled();
  });

  // ── openToken: the deep-link hook (chatbot phase B) ──────────────────────────────────────────────

  describe('openToken', () => {
    /** Bump the token the way a host does, and run the change the same way Angular would. */
    function bump(to: number): void {
      const from = component.openToken;
      component.openToken = to;
      component.ngOnChanges({ openToken: new SimpleChange(from, to, false) });
      fixture.detectChanges();
    }

    it('unfolds a section that is folded', () => {
      mount('inputs', 'book-1', true);
      expect(component.collapsed).toBeTrue();
      bump(1);
      expect(component.collapsed).toBeFalse();
    });

    it('does NOT persist: the author\'s own stored preference is untouched', () => {
      // A deep link that permanently unfolded a section the author had folded would be a link with a
      // side effect on their settings.
      writeCollapseState('book-1', 'inputs', true);
      mount('inputs', 'book-1', true);
      bump(1);
      expect(readCollapseMap('book-1')['inputs'])
        .withContext('still folded in storage; open for THIS mount only')
        .toBeTrue();
    });

    it('is inert on the FIRST binding, so a host with nothing to ask for changes nothing', () => {
      mount('inputs', 'book-1', true);
      component.ngOnChanges({ openToken: new SimpleChange(undefined, 0, true) });
      expect(component.collapsed).toBeTrue();
    });

    it('wins over the stored fold state when both change in the same tick', () => {
      // A chip can switch book and ask for a section in one navigation, so the re-seed and the request
      // arrive together. The request is the later intent and has to survive the re-seed.
      writeCollapseState('book-2', 'inputs', true);
      mount('inputs', 'book-1', true);
      component.bookId = 'book-2';
      component.openToken = 1;
      component.ngOnChanges({
        bookId: new SimpleChange('book-1', 'book-2', false),
        openToken: new SimpleChange(0, 1, false),
      });
      expect(component.collapsed).toBeFalse();
    });
  });
});
