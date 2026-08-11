import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, throwError } from 'rxjs';

import { GuideContentDto } from '../../core/models/guide';
import { GuidesService } from '../../core/services/guides.service';
import { guidesString } from '../../core/i18n/guides-strings';
import {
  FirstRunOrientationComponent,
  ORIENTATION_STRINGS_EN,
  ORIENTATION_STRINGS_HE,
  OrientationStringKey,
} from './first-run-orientation.component';

/**
 * Wave 3 / w6 (Q10-D) - the first-run orientation panel.
 *
 * The claims worth pinning here are the ones the todo states as requirements and that a reader cannot
 * check by looking at the component: that its prose comes from the SERVED CORPUS and never from a local
 * fallback, that it never blocks, and that a corpus it cannot read produces an honest sentence rather
 * than an empty card or an invented one.
 */

const OVERVIEW_BODY = [
  '# How the work flows',
  '',
  'PageDraft has five stages.',
  '',
  '## The five stages',
  '',
  '1. **Import.** A DOCX manuscript becomes chapters in your book.',
  '2. **Book briefs.** A short structured brief for every chapter.',
  '',
  '## What actually depends on what',
  '',
  'Everything starts with import.',
].join('\n');

function guide(overrides: Partial<GuideContentDto> = {}): GuideContentDto {
  return {
    id: 'workflow-overview',
    stage: 'overview',
    audience: 'author',
    language: 'en',
    title: 'How the work flows',
    updated: '2026-08-11',
    order: 0,
    body: OVERVIEW_BODY,
    ...overrides,
  };
}

describe('FirstRunOrientationComponent (w6)', () => {
  let fixture: ComponentFixture<FirstRunOrientationComponent>;
  let component: FirstRunOrientationComponent;
  let reads: Subject<GuideContentDto>;
  let guidesSpy: { get: jasmine.Spy; list: jasmine.Spy };

  beforeEach(async () => {
    reads = new Subject<GuideContentDto>();
    guidesSpy = {
      get: jasmine.createSpy('get').and.callFake(() => reads.asObservable()),
      list: jasmine.createSpy('list'),
    };

    await TestBed.configureTestingModule({
      imports: [FirstRunOrientationComponent],
      providers: [{ provide: GuidesService, useValue: guidesSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(FirstRunOrientationComponent);
    component = fixture.componentInstance;
  });

  function open(lang: string | null = 'en'): void {
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.componentRef.setInput('bookLanguage', lang);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  }

  function q(testid: string) {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`));
  }

  function textOf(testid: string): string {
    const el = q(testid);
    return el ? (el.nativeElement as HTMLElement).textContent!.trim() : '';
  }

  function settle(dto: GuideContentDto = guide()): void {
    reads.next(dto);
    reads.complete();
    fixture.detectChanges();
  }

  function fail(status: number): void {
    guidesSpy.get.and.returnValue(
      throwError(() => new HttpErrorResponse({ status })) as Observable<GuideContentDto>,
    );
    component.reload();
    fixture.detectChanges();
  }

  // ── Where the prose comes from ───────────────────────────────────────────────────────────────────

  it('reads the WORKFLOW OVERVIEW guide, in the book language, and renders its first authored section', () => {
    open('he');

    expect(guidesSpy.get).toHaveBeenCalledWith('workflow-overview', 'he');

    settle(guide({ language: 'he' }));

    expect(textOf('orientation-section-title')).toBe('The five stages');
    expect(q('orientation-guide-body')).toBeTruthy();
    expect((q('orientation-guide-body').nativeElement as HTMLElement).textContent)
      .toContain('A DOCX manuscript becomes chapters in your book');
  });

  /**
   * THE THROWAWAY PATH, RULED OUT AT THE SOURCE (Q13-C). A corpus that cannot be read must produce an
   * honest sentence, never a paragraph of the component's own about the five stages: a local fallback is
   * how hardcoded tutorial copy gets in one release at a time.
   */
  it('says the corpus could not be read, and invents no stage prose of its own', () => {
    open('en');
    fail(503);

    expect(q('orientation-failure')).toBeTruthy();
    expect(textOf('orientation-failure')).toContain(guidesString('en', 'corpusUnavailable'));
    expect(q('orientation-guide-body')).toBeNull();
    expect(q('orientation-section-title')).toBeNull();

    const rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(rendered).not.toContain('Import');
    expect(rendered).not.toContain('Book briefs');
  });

  it('tells a transport failure apart from a corpus the server could not read', () => {
    open('en');
    fail(0);

    expect(textOf('orientation-failure')).toContain(guidesString('en', 'loadFailedBody'));
    expect(textOf('orientation-failure')).not.toContain(guidesString('en', 'corpusUnavailable'));
  });

  it('offers a retry that asks again', () => {
    open('en');
    fail(0);
    guidesSpy.get.calls.reset();
    guidesSpy.get.and.callFake(() => reads.asObservable());

    (q('orientation-retry').nativeElement as HTMLElement).click();
    fixture.detectChanges();

    expect(guidesSpy.get).toHaveBeenCalledWith('workflow-overview', 'en');
  });

  /**
   * A READ THAT NEVER ANSWERS. An errored read already resolves, because `settle()` turns the failure
   * into a value - but silence is a different state, and a reachable one: the host's own spec stubs
   * `GuidesService.get` with `NEVER`. Before the bound, that left the panel on its loading line forever
   * with no affordance at all. The stub here is the suite's default one, a Subject that is never fed,
   * which is the same shape.
   */
  it('bounds a read that never answers, and resolves the pending state to something pressable', fakeAsync(() => {
    open('en');

    // The bound must not make the in-flight state unobservable: a real read still shows the loading line.
    expect(q('orientation-loading')).withContext('in flight').toBeTruthy();
    expect(q('orientation-retry')).withContext('nothing to press yet, and nothing claimed yet').toBeNull();

    tick(FirstRunOrientationComponent.READ_TIMEOUT_MS - 1);
    fixture.detectChanges();
    expect(q('orientation-loading')).withContext('still inside the bound').toBeTruthy();

    tick(1);
    fixture.detectChanges();

    const retry = q('orientation-retry');
    expect(retry).withContext('a read that never answered must leave the author something to press').toBeTruthy();
    expect((retry.nativeElement as HTMLButtonElement).disabled).toBeFalse();
    expect(q('orientation-loading')).withContext('the pending state RESOLVED rather than stuck').toBeNull();

    // A read that hung is a transport fact, not the server reporting its corpus is not installed.
    expect(textOf('orientation-failure')).toContain(guidesString('en', 'loadFailedBody'));
    expect(textOf('orientation-failure')).not.toContain(guidesString('en', 'corpusUnavailable'));

    // ...and it still invents no stage prose of its own. Same claim as the corpus-failure test.
    expect(q('orientation-guide-body')).toBeNull();
    expect(q('orientation-section-title')).toBeNull();
    const rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(rendered).not.toContain('Import');
    expect(rendered).not.toContain('Book briefs');
    expect(textOf('orientation-points')).toContain(ORIENTATION_STRINGS_EN.pointSpine);
  }));

  it('is not a dead end after the bound: the retry asks again and a later answer still renders', fakeAsync(() => {
    open('en');
    tick(FirstRunOrientationComponent.READ_TIMEOUT_MS);
    fixture.detectChanges();
    guidesSpy.get.calls.reset();

    // Named before the click, so a pending state that never resolved reads as this claim failing
    // rather than as a bare TypeError on a missing element.
    expect(q('orientation-retry')).withContext('the bound must have produced a retry to press').toBeTruthy();
    (q('orientation-retry').nativeElement as HTMLElement).click();
    fixture.detectChanges();

    expect(guidesSpy.get).toHaveBeenCalledWith('workflow-overview', 'en');
    expect(q('orientation-loading')).toBeTruthy();

    settle();

    expect(textOf('orientation-section-title')).toBe('The five stages');
    expect(q('orientation-failure')).toBeNull();
  }));

  /**
   * A guide with no H2 at all still has its opening prose, which is authored content from the same
   * document. What must NOT happen is a blank card.
   */
  it('falls back to the guide OWN intro when it has no sections, and to nothing when it has neither', () => {
    open('en');
    settle(guide({ body: '# Title\n\nJust the opening prose.\n' }));
    expect((q('orientation-guide-body').nativeElement as HTMLElement).textContent)
      .toContain('Just the opening prose.');

    reads = new Subject<GuideContentDto>();
    component.reload();
    fixture.detectChanges();
    settle(guide({ body: '# Title\n' }));

    expect(q('orientation-guide-body')).toBeNull();
    expect(q('orientation-failure')).toBeNull();
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────

  it('fetches nothing while it is not open', () => {
    fixture.componentRef.setInput('bookId', 'book-1');
    fixture.componentRef.setInput('bookLanguage', 'en');
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();

    expect(guidesSpy.get).not.toHaveBeenCalled();
  });

  it('does not re-fetch when an unrelated binding is refreshed', () => {
    open('en');
    settle();
    expect(guidesSpy.get).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(guidesSpy.get).toHaveBeenCalledTimes(1);
  });

  it('emits the dismissal rather than storing it, from both close controls', () => {
    const dismissals: number[] = [];
    component.dismissed.subscribe(() => dismissals.push(1));
    open('en');
    settle();

    (q('orientation-close').nativeElement as HTMLElement).click();
    (q('orientation-dismiss').nativeElement as HTMLElement).click();

    expect(dismissals.length).toBe(2);
  });

  /**
   * The header `×` and the "Got it, do not show this again" button spend the identical permanent
   * dismissal (see `close()`), so their accessible names must not promise different things. Asserted
   * against the RENDERED attribute, not the constant alone, so the template wiring is covered too.
   */
  it('names the permanence of the close control in its accessible name, in both languages', () => {
    open('en');
    settle();
    expect(q('orientation-close').nativeElement.getAttribute('aria-label'))
      .toBe(ORIENTATION_STRINGS_EN.closeAria);
    expect(q('orientation-close').nativeElement.getAttribute('aria-label')).toMatch(/again/i);

    fixture.componentRef.setInput('bookLanguage', 'he');
    fixture.detectChanges();
    expect(q('orientation-close').nativeElement.getAttribute('aria-label'))
      .toBe(ORIENTATION_STRINGS_HE.closeAria);
    expect(q('orientation-close').nativeElement.getAttribute('aria-label')).toContain('שוב');
  });

  it('asks the host to open the WHOLE overview guide', () => {
    const opened: string[] = [];
    component.openGuide.subscribe(id => opened.push(id));
    open('en');
    settle();

    (q('orientation-read-guide').nativeElement as HTMLElement).click();

    expect(opened).toEqual(['workflow-overview']);
  });

  // ── It never blocks ──────────────────────────────────────────────────────────────────────────────

  /**
   * Builds take minutes, so a panel that had to be dealt with before work could start would fail Q10's
   * own constraint. "Never blocks" is a structural claim, so it is asserted structurally: no backdrop
   * element, no dialog role, and nothing taken out of the normal flow.
   */
  it('is an in-flow panel, not a modal: no backdrop, no dialog role, no fixed positioning', () => {
    open('en');
    settle();

    const panel = q('first-run-orientation').nativeElement as HTMLElement;
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(getComputedStyle(panel).position).not.toBe('fixed');

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[role="dialog"]').length).toBe(0);
    expect(host.querySelectorAll('.backdrop, .overlay-backdrop, .scrim').length).toBe(0);
  });

  /**
   * It TEACHES THE MECHANISM: the two permanent surfaces stay named even while the guide body is still
   * loading or has failed, so an author who dismisses it has still been told where the guidance lives.
   */
  it('always names the spine and the build rows, in every content state', () => {
    open('en');
    expect(textOf('orientation-points')).toContain(ORIENTATION_STRINGS_EN.pointSpine);
    expect(textOf('orientation-points')).toContain(ORIENTATION_STRINGS_EN.pointRows);

    fail(503);
    expect(textOf('orientation-points')).toContain(ORIENTATION_STRINGS_EN.pointSpine);
  });

  // ── Language and direction ───────────────────────────────────────────────────────────────────────

  it('is BOOK-scoped: Hebrew book renders Hebrew and rtl, English book renders English and ltr', () => {
    open('he');
    settle(guide({ language: 'he' }));
    let panel = q('first-run-orientation').nativeElement as HTMLElement;
    expect(panel.getAttribute('dir')).toBe('rtl');
    expect(panel.textContent).toContain(ORIENTATION_STRINGS_HE.panelTitle);

    fixture.componentRef.setInput('bookLanguage', 'en');
    fixture.detectChanges();
    panel = q('first-run-orientation').nativeElement as HTMLElement;
    expect(panel.getAttribute('dir')).toBe('ltr');
    expect(panel.textContent).toContain(ORIENTATION_STRINGS_EN.panelTitle);
  });

  it('defaults to Hebrew when the book has no language', () => {
    open(null);

    expect(guidesSpy.get).toHaveBeenCalledWith('workflow-overview', 'he');
    expect((q('first-run-orientation').nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
  });

  it('keeps he/en at parity and carries no em-dash or en-dash', () => {
    const heKeys = Object.keys(ORIENTATION_STRINGS_HE).sort();
    const enKeys = Object.keys(ORIENTATION_STRINGS_EN).sort();
    expect(heKeys).toEqual(enKeys);
    expect(heKeys.length).toBeGreaterThan(0);

    for (const key of heKeys as OrientationStringKey[]) {
      expect(ORIENTATION_STRINGS_HE[key].length).withContext(`he ${key}`).toBeGreaterThan(0);
      expect(ORIENTATION_STRINGS_EN[key].length).withContext(`en ${key}`).toBeGreaterThan(0);
      expect(ORIENTATION_STRINGS_HE[key]).withContext(`he ${key}`).not.toMatch(/[–—]/);
      expect(ORIENTATION_STRINGS_EN[key]).withContext(`en ${key}`).not.toMatch(/[–—]/);
    }
  });

  /**
   * Chatbot phase B has not shipped, and the panel must not depend on it. A pointer at Show today would
   * be an affordance for a capability that is not there, which is the exact class of claim this wave
   * exists to remove.
   */
  it('does not point at Show, which has not shipped', () => {
    open('he');
    settle(guide({ language: 'he' }));
    const rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(rendered).not.toContain('Show');
    expect(rendered).not.toContain('שואו');   // the assistant's Hebrew name, as chat-strings.ts spells it
  });
});
