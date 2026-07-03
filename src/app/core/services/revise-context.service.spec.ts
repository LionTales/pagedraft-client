/**
 * rf-f05: ReviseContextService spec.
 * Verifies that setting and clearing the addressing context flows through the observable correctly.
 */
import { TestBed } from '@angular/core/testing';
import { ReviseContextService } from './revise-context.service';

describe('ReviseContextService (rf-f05)', () => {
  let service: ReviseContextService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ReviseContextService);
  });

  it('starts with null context', () => {
    let ctx: unknown = 'sentinel';
    service.currentlyAddressing$.subscribe(v => (ctx = v));
    expect(ctx).toBeNull();
  });

  it('set() emits the context through currentlyAddressing$', () => {
    const emitted: unknown[] = [];
    service.currentlyAddressing$.subscribe(v => emitted.push(v));

    service.set({ findingId: 'f-1', oneLiner: 'The midpoint reversal lands without setup.', chapterId: 'c-3' });

    expect(emitted.length).toBe(2); // initial null + the new value
    expect(emitted[1]).toEqual({ findingId: 'f-1', oneLiner: 'The midpoint reversal lands without setup.', chapterId: 'c-3' });
  });

  it('clear() emits null', () => {
    service.set({ findingId: 'f-1', oneLiner: 'One liner', chapterId: 'c-1' });

    const emitted: unknown[] = [];
    service.currentlyAddressing$.subscribe(v => emitted.push(v));

    service.clear();

    expect(emitted[emitted.length - 1]).toBeNull();
  });

  it('snapshot returns the current value synchronously', () => {
    expect(service.snapshot).toBeNull();
    service.set({ findingId: 'f-2', oneLiner: 'Test', chapterId: 'c-5' });
    expect(service.snapshot).toEqual({ findingId: 'f-2', oneLiner: 'Test', chapterId: 'c-5' });
    service.clear();
    expect(service.snapshot).toBeNull();
  });

  it('set() overwrites a prior context', () => {
    service.set({ findingId: 'f-1', oneLiner: 'First', chapterId: 'c-1' });
    service.set({ findingId: 'f-2', oneLiner: 'Second', chapterId: 'c-2' });
    expect(service.snapshot?.findingId).toBe('f-2');
    expect(service.snapshot?.chapterId).toBe('c-2');
  });
});
