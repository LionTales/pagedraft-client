import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';

import {
  EXPORT_BUSY_COPY, EXPORT_LONG_NOTE_AFTER_MS, ExportBusyStatusComponent, formatExportElapsed,
} from './export-busy-status.component';
import { EXPORT_COPY } from './export-kinds';

describe('formatExportElapsed (f7)', () => {
  it('is mm:ss with two-digit seconds, truncating partial seconds', () => {
    expect(formatExportElapsed(0)).toBe('00:00');
    expect(formatExportElapsed(999)).toBe('00:00');
    expect(formatExportElapsed(9_000)).toBe('00:09');
    expect(formatExportElapsed(61_000)).toBe('01:01');
    expect(formatExportElapsed(6 * 60_000 + 5_000)).toBe('06:05');
    expect(formatExportElapsed(75 * 60_000)).toBe('75:00');
    expect(formatExportElapsed(-5)).toBe('00:00');
  });

  it('writes no em-dash or en-dash and carries Hebrew and English long notes', () => {
    const text = EXPORT_BUSY_COPY.longNote.he + EXPORT_BUSY_COPY.longNote.en;
    expect(/[–—]/.test(text)).toBeFalse();
    expect(EXPORT_BUSY_COPY.longNote.he.length).toBeGreaterThan(0);
    expect(EXPORT_BUSY_COPY.longNote.en.length).toBeGreaterThan(0);
  });
});

describe('ExportBusyStatusComponent (f7)', () => {
  let fixture: ComponentFixture<ExportBusyStatusComponent>;

  function make(lang: 'he' | 'en', longRunNote: boolean): void {
    fixture = TestBed.createComponent(ExportBusyStatusComponent);
    fixture.componentRef.setInput('lang', lang);
    fixture.componentRef.setInput('longRunNote', longRunNote);
    fixture.detectChanges();
  }
  const q = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() => TestBed.configureTestingModule({ imports: [ExportBusyStatusComponent] }));

  it('shows the spinner line, 00:00 and a polite live region at once', fakeAsync(() => {
    make('he', false);
    const line = q('export-busy-line')!;
    expect(line.textContent).toContain(EXPORT_COPY.preparing.he);
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(q('export-busy-elapsed')!.textContent!.trim()).toBe('00:00');
    expect(q('export-busy-elapsed')!.getAttribute('aria-hidden')).toBe('true');
    fixture.destroy();
  }));

  it('advances the clock every second', fakeAsync(() => {
    make('en', false);
    tick(3000);
    fixture.detectChanges();
    expect(q('export-busy-elapsed')!.textContent!.trim()).toBe('00:03');
    tick(65_000);
    fixture.detectChanges();
    expect(q('export-busy-elapsed')!.textContent!.trim()).toBe('01:08');
    fixture.destroy();
  }));

  it('shows the long note only after 10 s and only for proofread kinds', fakeAsync(() => {
    make('en', true);
    tick(EXPORT_LONG_NOTE_AFTER_MS - 1000);
    fixture.detectChanges();
    expect(q('export-busy-long-note')).toBeNull();
    tick(1000);
    fixture.detectChanges();
    const note = q('export-busy-long-note')!;
    expect(note.textContent!.trim()).toBe(EXPORT_BUSY_COPY.longNote.en);
    expect(note.getAttribute('aria-live')).toBe('polite');
    fixture.destroy();

    make('he', false);
    tick(60_000);
    fixture.detectChanges();
    expect(q('export-busy-long-note')).toBeNull();
    fixture.destroy();
  }));

  it('renders Hebrew copy for a Hebrew book', fakeAsync(() => {
    make('he', true);
    tick(10_000);
    fixture.detectChanges();
    expect(q('export-busy-long-note')!.textContent!.trim()).toBe(EXPORT_BUSY_COPY.longNote.he);
    fixture.destroy();
  }));

  it('clears its timer on destroy (no periodic task left pending)', fakeAsync(() => {
    make('en', true);
    tick(2000);
    fixture.destroy();
    // fakeAsync fails the test if a periodic timer is still queued; this would throw otherwise.
    tick(5000);
    discardPeriodicTasks();
  }));
});
