import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SegmentedControlComponent, SegmentedOption } from './segmented-control.component';

const OPTIONS: SegmentedOption[] = [
  { value: 'edit', label: 'Edit help', count: 3 },
  { value: 'review', label: 'Book review' },
  { value: 'bible', label: 'Story bible', icon: '📖' }
];

describe('SegmentedControlComponent', () => {
  let fixture: ComponentFixture<SegmentedControlComponent>;
  let component: SegmentedControlComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SegmentedControlComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SegmentedControlComponent);
    component = fixture.componentInstance;
    component.options = OPTIONS;
    component.value = 'edit';
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders one segment per option with the localized labels', () => {
    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    expect(segs.length).toBe(3);
    expect(segs[0].nativeElement.textContent).toContain('Edit help');
    expect(segs[1].nativeElement.textContent).toContain('Book review');
    expect(segs[2].nativeElement.textContent).toContain('Story bible');
  });

  it('exposes a radiogroup track and radio segments for a11y', () => {
    const track = fixture.debugElement.query(By.css('.seg-track'));
    expect(track.attributes['role']).toBe('radiogroup');
    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    segs.forEach(s => expect(s.attributes['role']).toBe('radio'));
  });

  it('binds aria-label on the radiogroup when ariaLabel is set', () => {
    component.ariaLabel = 'Review mode';
    fixture.detectChanges();
    const track = fixture.debugElement.query(By.css('.seg-track'));
    expect(track.attributes['aria-label']).toBe('Review mode');
  });

  it('marks the active segment and reflects aria-checked from value', () => {
    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    expect(segs[0].classes['active']).toBe(true);
    expect(segs[0].attributes['aria-checked']).toBe('true');
    expect(segs[1].attributes['aria-checked']).toBe('false');
  });

  it('aria-checked follows a changed value input', () => {
    component.value = 'review';
    fixture.detectChanges();
    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    expect(segs[1].classes['active']).toBe(true);
    expect(segs[1].attributes['aria-checked']).toBe('true');
    expect(segs[0].attributes['aria-checked']).toBe('false');
  });

  it('uses a roving tabindex so only the selected segment is tabbable', () => {
    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    expect(segs[0].attributes['tabindex']).toBe('0');
    expect(segs[1].attributes['tabindex']).toBe('-1');
    expect(segs[2].attributes['tabindex']).toBe('-1');
  });

  it('clicking a segment emits valueChange and sets the active segment', () => {
    const emitted: string[] = [];
    component.valueChange.subscribe(v => emitted.push(v));

    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    segs[1].nativeElement.click();
    fixture.detectChanges();

    expect(emitted).toEqual(['review']);
    expect(component.value).toBe('review');
    expect(segs[1].classes['active']).toBe(true);
  });

  it('clicking the already-active segment does NOT re-emit', () => {
    const emitted: string[] = [];
    component.valueChange.subscribe(v => emitted.push(v));

    const segs = fixture.debugElement.queryAll(By.css('.seg'));
    segs[0].nativeElement.click();

    expect(emitted.length).toBe(0);
  });

  it('renders a count badge only for options that have a count', () => {
    const counts = fixture.debugElement.queryAll(By.css('.seg-count'));
    expect(counts.length).toBe(1);
    expect(counts[0].nativeElement.textContent.trim()).toBe('3');
  });

  it('renders an icon when provided', () => {
    const icon = fixture.debugElement.query(By.css('.seg-icon'));
    expect(icon).not.toBeNull();
    expect(icon.nativeElement.textContent).toContain('📖');
  });

  describe('keyboard navigation', () => {
    it('ArrowRight moves selection to the next segment (LTR)', () => {
      const emitted: string[] = [];
      component.valueChange.subscribe(v => emitted.push(v));
      const segs = fixture.debugElement.queryAll(By.css('.seg'));

      segs[0].nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(component.value).toBe('review');
      expect(emitted).toEqual(['review']);
    });

    it('ArrowLeft wraps from the first to the last segment (LTR)', () => {
      const segs = fixture.debugElement.queryAll(By.css('.seg'));
      segs[0].nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(component.value).toBe('bible');
    });

    it('ArrowRight moves toward the start when rtl is true', () => {
      component.rtl = true;
      fixture.detectChanges();
      const segs = fixture.debugElement.queryAll(By.css('.seg'));

      // value starts at index 0 ('edit'); RTL ArrowRight = previous = wraps to last.
      segs[0].nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(component.value).toBe('bible');
    });

    it('moves DOM focus to the newly-selected segment', () => {
      // Attach to the document so focus() actually updates document.activeElement.
      document.body.appendChild(fixture.nativeElement);
      try {
        const segs = fixture.debugElement.queryAll(By.css('.seg'));
        segs[0].nativeElement.focus();

        segs[0].nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        fixture.detectChanges();

        expect(component.value).toBe('review');
        expect(document.activeElement).toBe(segs[1].nativeElement);
      } finally {
        document.body.removeChild(fixture.nativeElement);
      }
    });
  });

  describe('layout inputs', () => {
    it('applies the full-width class by default', () => {
      const track = fixture.debugElement.query(By.css('.seg-track'));
      expect(track.classes['seg-full']).toBe(true);
    });

    it('applies the sm class when size is sm', () => {
      component.size = 'sm';
      fixture.detectChanges();
      const track = fixture.debugElement.query(By.css('.seg-track'));
      expect(track.classes['seg-sm']).toBe(true);
    });

    it('sets dir=rtl on the track when rtl is true', () => {
      component.rtl = true;
      fixture.detectChanges();
      const track = fixture.debugElement.query(By.css('.seg-track'));
      expect(track.attributes['dir']).toBe('rtl');
    });
  });
});
