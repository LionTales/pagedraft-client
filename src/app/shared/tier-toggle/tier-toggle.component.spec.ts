/**
 * tier-ux-rework c3: the shared tier toggle.
 *
 * The behaviour under test is mostly about what the surface REFUSES to do:
 *  - it never names a provider, a model or a version (model identity is internal IP). That pin is carried
 *    forward from the deleted dashboard control's f1 test and made STRICTER here, because the payload no
 *    longer carries routes at all;
 *  - it never shows four independent toggles for four analysis types that are secretly one setting;
 *  - it never commits 'thinking' without the consent step WHEN THE SERVER ASKS FOR ONE, and never renders a
 *    consent step when it does not;
 *  - it never renders a dead option without a reason;
 *  - it never repaints an older snapshot over a newer one (the race/supersession suite is carried forward
 *    from the predecessor control, whose defects were real).
 *
 * he/en parity and RTL are asserted here rather than left to the browser gate because a missing key falls
 * back to the KEY NAME in this codebase's label() idiom, which reads like a real English string.
 *
 * WHY THIS SUITE DRIVES THE REAL `AiTierService` OVER `HttpTestingController` (tier-ux-rework fixes c02).
 * Since c02 the answer this control paints is owned by the service and shared by every toggle mounted on the
 * book, so a jasmine spy standing in for the service would stub out the very ordering rules these tests
 * exist to pin (which answer supersedes which) and would let a component that paints nothing at all pass.
 * The testing backend also gives what a spy returning `of()` cannot: a request that stays OPEN across
 * assertions, which is the window every race here lives in. `req.cancelled` replaces the old
 * `subject.observers.length` proxy - it is the same fact, measured on the request rather than on the stub.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpClientTestingModule, HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { HttpRequest } from '@angular/common/http';
import { TierToggleComponent, TIER_TOGGLE_LABEL_KEYS, TIER_TOGGLE_LABELS_HE, TIER_TOGGLE_LABELS_EN } from './tier-toggle.component';
import { AiTierService } from '../../core/services/ai-tier.service';
import { NO_TIER_TASK_VALUES } from '../../core/utils/ai-task-key';
import { BookAiTierDto, BookAiTierTaskDto } from '../../core/models/book';

/**
 * FIXTURE FIDELITY (be-c01, from the P1 that let the P0 through). These defaults are a row the server really
 * sends: `storedTier: null` + `effectiveTier: 'fast'` + `ready` is what an inheriting task on a fast book
 * looks like. That is a property of the DEFAULTS ONLY - the moment a test overrides `thinkingReadiness`, the
 * inherited `effectiveTier` stops being an observation and becomes an assumption, and the vacuous
 * language-rung spec is what that costs. Under the fixed contract `effectiveTier` reports the tier that will
 * actually ROUTE, so it may read 'thinking' only when the readiness is 'ready'; every not-ready row reads
 * 'fast' whatever the book default or the stored override says. Write the whole row out when the case is
 * about which word is highlighted.
 */
function makeTask(overrides: Partial<BookAiTierTaskDto> = {}): BookAiTierTaskDto {
  return {
    task: 'Proofread',
    storedTier: null,
    effectiveTier: 'fast',
    thinkingReadiness: 'ready',
    fallbackActive: false,
    ...overrides,
  };
}

function makeDto(overrides: Partial<BookAiTierDto> = {}): BookAiTierDto {
  return {
    bookId: 'book-1',
    tier: 'fast',
    thinkingReadiness: 'ready',
    fallbackActive: false,
    consentRequired: true,
    tasks: [
      makeTask({ task: 'Proofread' }),
      makeTask({ task: 'LinguisticAnalysis' }),
      makeTask({ task: 'LineEdit', thinkingReadiness: 'taskNotEligible' }),
      makeTask({ task: 'BookReview', thinkingReadiness: 'taskNotEligible' }),
    ],
    ...overrides,
  };
}

/** The DTO with ONE task overridden, so a test can shape a single task without rebuilding the list. */
function withTask(dto: BookAiTierDto, task: string, overrides: Partial<BookAiTierTaskDto>): BookAiTierDto {
  return {
    ...dto,
    tasks: dto.tasks.map((t) => (t.task === task ? { ...t, ...overrides } : t)),
  };
}

/** Request matchers. Kept as predicates because `expectOne`/`match` CONSUME what they match. */
const isRead = (bookId = 'book-1') => (r: HttpRequest<unknown>) =>
  r.method === 'GET' && r.url === `/api/books/${bookId}/ai-tier`;
const isWrite = (bookId = 'book-1') => (r: HttpRequest<unknown>) =>
  r.method !== 'GET' && r.url.startsWith(`/api/books/${bookId}/ai-tier`);

describe('TierToggleComponent (tier-ux-rework c3)', () => {
  let fixture: ComponentFixture<TierToggleComponent>;
  let component: TierToggleComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TierToggleComponent, HttpClientTestingModule],
      providers: [AiTierService],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TierToggleComponent);
    component = fixture.componentInstance;
  });

  /** The one pending read, as a handle a test can hold open across assertions. */
  function read(bookId = 'book-1'): TestRequest {
    return http.expectOne(isRead(bookId));
  }

  function pendingReads(bookId = 'book-1'): TestRequest[] {
    return http.match(isRead(bookId));
  }

  function pendingWrites(bookId = 'book-1'): TestRequest[] {
    return http.match(isWrite(bookId));
  }

  /** The one pending mutation (PUT for a tier, DELETE for a cleared override). */
  function write(bookId = 'book-1'): TestRequest {
    return http.expectOne(isWrite(bookId));
  }

  function mount(dto: BookAiTierDto, task: string | null = 'Proofread', language = 'he'): void {
    component.bookId = 'book-1';
    component.bookLanguage = language;
    if (task === null) {
      component.scope = 'book';
    } else {
      component.task = task;
    }
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    read().flush(dto);
    fixture.detectChanges();
  }

  function el(testId: string) {
    return fixture.debugElement.query(By.css(`[data-testid="${testId}"]`));
  }

  function text(testId: string): string {
    const found = el(testId);
    return found ? (found.nativeElement.textContent || '').trim() : '';
  }

  function exists(testId: string): boolean {
    return !!el(testId);
  }

  function button(testId: string): HTMLButtonElement {
    return el(testId).nativeElement as HTMLButtonElement;
  }

  // ── The two words, and which one is highlighted ─────────────────────────────

  it('renders exactly the two tier words, with the effective one selected (fast)', () => {
    mount(makeDto());

    expect(button('tier-toggle-fast').textContent!.trim()).toBe(component.label('tierFast'));
    expect(button('tier-toggle-thinking').textContent!.trim()).toBe(component.label('tierThinking'));
    expect(button('tier-toggle-fast').getAttribute('aria-checked')).toBe('true');
    expect(button('tier-toggle-thinking').getAttribute('aria-checked')).toBe('false');
    expect(el('tier-toggle-fast').classes['selected']).toBeTrue();
  });

  it('highlights thinking when the task resolves to thinking', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    expect(button('tier-toggle-thinking').getAttribute('aria-checked')).toBe('true');
    expect(el('tier-toggle-thinking').classes['selected']).toBeTrue();
    expect(component.selectedTier).toBe('thinking');
  });

  it('follows the book language for [dir] (Hebrew default, LTR for English)', () => {
    mount(makeDto(), 'Proofread', 'he');
    expect(el('tier-toggle').attributes['dir']).toBe('rtl');

    mount(makeDto(), 'Proofread', 'en');
    expect(el('tier-toggle').attributes['dir']).toBe('ltr');
  });

  // ── The info affordance ─────────────────────────────────────────────────────

  it('explains both tiers by SIZE and COST, never by model or provider', () => {
    mount(makeDto(), 'Proofread', 'en');
    const popover = text('tier-toggle-info-popover');

    expect(popover).toContain('smaller model');
    expect(popover).toContain('fewer tokens');
    expect(popover).toContain('larger model');
    expect(popover).toContain('more tokens');
  });

  it('pins the info popover open on click (touch) and closes it on a second click', () => {
    mount(makeDto());
    expect(el('tier-toggle-info-popover').classes['open']).toBeFalsy();
    expect(button('tier-toggle-info').getAttribute('aria-expanded')).toBe('false');

    button('tier-toggle-info').click();
    fixture.detectChanges();
    expect(el('tier-toggle-info-popover').classes['open']).toBeTrue();
    expect(button('tier-toggle-info').getAttribute('aria-expanded')).toBe('true');

    button('tier-toggle-info').click();
    fixture.detectChanges();
    expect(el('tier-toggle-info-popover').classes['open']).toBeFalsy();
  });

  it('wires the info button to the popover with aria-describedby, so a hover is never the only way in', () => {
    mount(makeDto());
    const describedBy = button('tier-toggle-info').getAttribute('aria-describedby');
    expect(describedBy).toBe(component.popoverId);
    expect(el('tier-toggle-info-popover').attributes['id']).toBe(component.popoverId);
  });

  // ── Analysis type -> task key ───────────────────────────────────────────────

  /**
   * LiteraryAnalysis, BookOverview, CharacterAnalysis and StoryAnalysis all ROUTE to LinguisticAnalysis.
   * Binding a toggle to the analysis type instead of the task would render four toggles that silently share
   * one stored value, so each would show a state its own writes did not produce.
   */
  it('resolves every analysis type that routes to LinguisticAnalysis onto the SAME task row', () => {
    const dto = withTask(makeDto(), 'LinguisticAnalysis', { storedTier: 'thinking', effectiveTier: 'thinking' });
    for (const analysisType of ['LinguisticAnalysis', 'LiteraryAnalysis', 'BookOverview', 'CharacterAnalysis', 'StoryAnalysis']) {
      mount(dto, analysisType);
      expect(component.taskKey).withContext(analysisType).toBe('LinguisticAnalysis');
      expect(component.selectedTier).withContext(analysisType).toBe('thinking');
    }
  });

  it('writes the RESOLVED task key, not the analysis type the surface is showing', () => {
    mount(makeDto(), 'LiteraryAnalysis');

    component.requestThinking();
    component.confirmThinking();

    const put = write();
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ tier: 'thinking', task: 'LinguisticAnalysis' });
  });

  /**
   * Wave 3 / w5, THE Q11-A RESIDUE. This test used to assert that the control rendered NOTHING for the two
   * passes the server reports no tier for. The owner's answer to Q11 kept the control at the point of use
   * and named exactly one thing to fix: those two passes get a disabled state WITH a reason instead of an
   * unexplained absence, because a control that silently vanishes reads as a rendering bug.
   */
  it('Q11-A residue: renders a DISABLED control with a reason for the two passes with no tier', () => {
    for (const analysisType of ['Summarization', 'Custom']) {
      mount(makeDto(), analysisType);
      expect(component.visible).withContext(analysisType).toBeTrue();
      expect(component.noTierControl).withContext(analysisType).toBeTrue();
      expect(exists('tier-toggle')).withContext(analysisType).toBeTrue();
      expect(exists('tier-toggle-no-control')).withContext(analysisType).toBeTrue();
      expect(exists('tier-toggle-reason')).withContext(analysisType).toBeTrue();
    }
  });

  it('Q11-A residue: the disabled control claims NO selected tier (the server reported none)', () => {
    mount(makeDto(), 'Summarization');
    const fast = fixture.debugElement.query(By.css('[data-testid="tier-toggle-fast"]'));
    const thinking = fixture.debugElement.query(By.css('[data-testid="tier-toggle-thinking"]'));

    expect(fast.nativeElement.getAttribute('aria-checked')).toBe('false');
    expect(thinking.nativeElement.getAttribute('aria-checked')).toBe('false');
    expect(fast.nativeElement.getAttribute('aria-disabled')).toBe('true');
    expect(thinking.nativeElement.getAttribute('aria-disabled')).toBe('true');
  });

  it('Q11-A residue: the reason has he/en parity, no em-dash, and names no model or provider', () => {
    for (const [lang, needle] of [['he', 'שכבת מודל'], ['en', 'model tier']] as const) {
      mount(makeDto(), 'Custom', lang);
      const reason = fixture.debugElement.query(By.css('[data-testid="tier-toggle-reason"]'))
        .nativeElement.textContent as string;
      expect(reason).withContext(lang).toContain(needle);
      expect(reason).withContext(lang).not.toContain('—');
      expect(reason).withContext(lang).not.toContain('–');
    }
  });

  it('still renders nothing at all when no task is bound (there is no pass to explain)', () => {
    mount(makeDto(), '');
    expect(component.visible).toBeFalse();
    expect(exists('tier-toggle')).toBeFalse();
  });

  /**
   * wave3-spine fixes c08, finding 27. `noTierControl` used to be "a non-empty task that did not resolve",
   * so ANY unrecognized string - a typo, a binding that was never a task, a seventh analysis type shipped
   * without a map entry - rendered the assertive sentence "The server does not report a tier for it, so
   * there is nothing to change here". That is a claim about the SERVER derived from a gap in the CLIENT's
   * table, and for a task the server does report a tier for it is flatly wrong. The explained-absence shape
   * is now reserved for `NO_TIER_TASK_VALUES`; everything else renders nothing, exactly as an unbound task
   * does. Silence says nothing untrue.
   */
  it('says NOTHING for a task it does not recognize, rather than asserting the server reports no tier', () => {
    for (const unknown of ['Nonsense', 'proofread', 'QA-2', 'Synopsis']) {
      mount(makeDto(), unknown);
      expect(component.noTierControl).withContext(unknown).toBeFalse();
      expect(component.visible).withContext(unknown).toBeFalse();
      expect(exists('tier-toggle')).withContext(unknown).toBeFalse();
      expect(exists('tier-toggle-no-control')).withContext(unknown).toBeFalse();
      expect(exists('tier-toggle-reason')).withContext(unknown).toBeFalse();
    }
  });

  it('keeps the explained absence for every KNOWN no-tier pass, including the QA task name', () => {
    for (const known of NO_TIER_TASK_VALUES) {
      mount(makeDto(), known);
      expect(component.noTierControl).withContext(known).toBeTrue();
      expect(exists('tier-toggle-no-control')).withContext(known).toBeTrue();
    }
  });

  it('re-derives from the snapshot in hand when the selected type changes, without a second read', () => {
    const dto = withTask(makeDto(), 'LinguisticAnalysis', { storedTier: 'thinking', effectiveTier: 'thinking' });
    mount(dto, 'Proofread');
    expect(component.selectedTier).toBe('fast');

    component.task = 'LinguisticAnalysis';
    component.ngOnChanges({ task: new SimpleChange('Proofread', 'LinguisticAnalysis', false) });
    fixture.detectChanges();

    expect(component.selectedTier).toBe('thinking');
    expect(pendingReads().length).withContext('the DTO already carries every task').toBe(0);
  });

  it('closes a consent panel opened for the PREVIOUS type when the selected type changes', () => {
    mount(makeDto(), 'Proofread');
    component.requestThinking();
    fixture.detectChanges();
    expect(exists('tier-toggle-consent')).toBeTrue();

    component.task = 'LinguisticAnalysis';
    component.ngOnChanges({ task: new SimpleChange('Proofread', 'LinguisticAnalysis', false) });
    fixture.detectChanges();

    expect(exists('tier-toggle-consent')).toBeFalse();
    expect(pendingWrites().length).toBe(0);
  });

  // ── The consent path ────────────────────────────────────────────────────────

  it('does NOT write on the first click when the server asks for consent: it opens the confirm', () => {
    mount(makeDto({ consentRequired: true }));

    button('tier-toggle-thinking').click();
    fixture.detectChanges();

    expect(exists('tier-toggle-consent')).toBeTrue();
    // The confirm restates WHAT IS AT STAKE at the moment of the decision: the text leaves this machine.
    expect(text('tier-toggle-consent')).toContain('ספק חיצוני');
    expect(text('tier-toggle-consent')).toContain('יוצא מהמחשב הזה');
    expect(pendingWrites().length).toBe(0);
  });

  it('writes thinking after the consent is confirmed and re-renders from the server answer', () => {
    mount(makeDto({ consentRequired: true }));

    component.requestThinking();
    fixture.detectChanges();
    button('tier-toggle-consent-confirm').click();
    fixture.detectChanges();

    const put = write();
    expect(put.request.body).toEqual({ tier: 'thinking', task: 'Proofread' });
    put.flush(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));
    fixture.detectChanges();

    expect(component.selectedTier).toBe('thinking');
    expect(exists('tier-toggle-consent')).toBeFalse();
  });

  it('cancelling the consent leaves the task on fast and writes nothing', () => {
    mount(makeDto({ consentRequired: true }));
    component.requestThinking();
    fixture.detectChanges();
    button('tier-toggle-consent-cancel').click();
    fixture.detectChanges();

    expect(exists('tier-toggle-consent')).toBeFalse();
    expect(component.selectedTier).toBe('fast');
    expect(pendingWrites().length).toBe(0);
  });

  /**
   * consentRequired is a DEPLOYMENT fact, not a preference: where both tiers are already off this machine
   * the local-vs-cloud consent sentence would be false, so the step must not render at all.
   */
  it('commits thinking directly, with no consent step, when the server says none is required', () => {
    mount(makeDto({ consentRequired: false }));

    button('tier-toggle-thinking').click();
    fixture.detectChanges();

    expect(exists('tier-toggle-consent')).toBeFalse();
    const put = write();
    expect(put.request.body).toEqual({ tier: 'thinking', task: 'Proofread' });
    put.flush(withTask(makeDto({ consentRequired: false }), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));
    fixture.detectChanges();

    expect(component.selectedTier).toBe('thinking');
  });

  it('switching BACK to fast needs no consent (it can only reduce what leaves the machine)', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    button('tier-toggle-fast').click();
    fixture.detectChanges();

    expect(exists('tier-toggle-consent')).toBeFalse();
    const put = write();
    expect(put.request.body).toEqual({ tier: 'fast', task: 'Proofread' });
    put.flush(makeDto());
    fixture.detectChanges();

    expect(component.selectedTier).toBe('fast');
  });

  // ── Disabled WITH a reason ──────────────────────────────────────────────────

  it('disables thinking with a reason for every not-ready readiness token', () => {
    const cases: Array<[BookAiTierTaskDto['thinkingReadiness'], string]> = [
      ['taskNotEligible', 'reasonTaskNotEligible'],
      ['languageAlwaysFast', 'reasonLanguageAlwaysFast'],
      ['routeNotConfigured', 'reasonRouteNotConfigured'],
      ['providerNotRegistered', 'reasonProviderNotRegistered'],
      ['providerCredentialsMissing', 'reasonCredentialsMissing'],
    ];
    for (const [token, labelKey] of cases) {
      mount(withTask(makeDto(), 'Proofread', { thinkingReadiness: token }));

      const thinking = button('tier-toggle-thinking');
      expect(thinking.getAttribute('aria-disabled')).withContext(token).toBe('true');
      // aria-disabled, NOT the native attribute: a keyboard user must still be able to tab to it and read why.
      expect(thinking.disabled).withContext(token).toBeFalse();
      expect(thinking.tabIndex).withContext(token).toBeGreaterThanOrEqual(0);
      expect(thinking.getAttribute('title')).withContext(token).toBe(component.label(labelKey));
      expect(text('tier-toggle-reason')).withContext(token).toBe(component.label(labelKey));
    }
  });

  /**
   * THE P0 CASE, AGAINST THE PAYLOAD THE SERVER REALLY SENDS.
   *
   * This test used to set only `{ thinkingReadiness: 'languageAlwaysFast' }` and inherit `effectiveTier:
   * 'fast'` from `makeTask`'s default - and it was green against the live defect, because at the time the
   * server sent `effectiveTier: "thinking"` for exactly this state whenever the book default was thinking.
   * The fixture pinned a payload production could not produce, so the assertion below was never exercised.
   *
   * The row is now written out in FULL, and it is the row captured verbatim from a live `GET
   * /api/books/{id}/ai-tier` on an English book whose default had just been PUT to "thinking" under the
   * be-c01 contract. Every field is stated rather than inherited, so a future change to `makeTask`'s defaults
   * cannot quietly re-vacuum it. The BOOK DEFAULT is thinking here on purpose: that is the whole point of the
   * case - the default says thinking, and this task must still read fast because the {task}_{lang} rung
   * outranks the tier rung.
   */
  it('the English-book Proofread case (language rung) reads as fast, disabled, with the language reason', () => {
    mount(
      withTask(makeDto({ tier: 'thinking' }), 'Proofread', {
        task: 'Proofread',
        storedTier: null,
        effectiveTier: 'fast',
        thinkingReadiness: 'languageAlwaysFast',
        fallbackActive: false,
      }),
      'Proofread',
      'en'
    );

    expect(component.selectedTier).toBe('fast');
    expect(button('tier-toggle-fast').getAttribute('aria-checked')).toBe('true');
    expect(button('tier-toggle-thinking').getAttribute('aria-checked')).toBe('false');
    expect(button('tier-toggle-thinking').getAttribute('aria-disabled')).toBe('true');
    expect(text('tier-toggle-reason')).toContain('book language');
    // The three-contradictory-statements bug: the highlighted word, the reason line and the warning all
    // disagreed. There is no warning to disagree with now, and no dead "follow the book default" link either
    // (this task carries no override of its own to clear).
    expect(exists('tier-toggle-fallback')).withContext('nothing on this control claims thinking').toBeFalse();
    expect(exists('tier-toggle-follow-default')).toBeFalse();
  });

  /**
   * The other two rows of the same P0, on a book default of thinking: LineEdit and BookReview are outside the
   * tier allowlist, so the default cannot reach them at all. Same rendered shape, different reason token.
   */
  it('a non-allowlisted task reads as fast under a thinking book default, with its own reason and no warning', () => {
    for (const task of ['LineEdit', 'BookReview']) {
      mount(
        withTask(makeDto({ tier: 'thinking' }), task, {
          task,
          storedTier: null,
          effectiveTier: 'fast',
          thinkingReadiness: 'taskNotEligible',
          fallbackActive: false,
        }),
        task
      );

      expect(component.selectedTier).withContext(task).toBe('fast');
      expect(button('tier-toggle-fast').getAttribute('aria-checked')).withContext(task).toBe('true');
      expect(button('tier-toggle-thinking').getAttribute('aria-disabled')).withContext(task).toBe('true');
      expect(text('tier-toggle-reason')).withContext(task).toBe(component.label('reasonTaskNotEligible'));
      expect(exists('tier-toggle-fallback')).withContext(task).toBeFalse();
    }
  });

  /**
   * THE OTHER HALF OF THE CONTRACT, which the clamp must not swallow: the SAME language-rung state but with
   * an override the user really did store (a Hebrew book opted in, then switched to English). Here the pill
   * still reads fast - that is what runs - and the warning DOES appear, because a setting the user made is
   * not being honoured, and the clear link is offered so they can act on it.
   */
  it('a dormant stored opt-in on the language-rung case still warns, and offers the clear link', () => {
    mount(
      withTask(makeDto({ tier: 'fast' }), 'Proofread', {
        task: 'Proofread',
        storedTier: 'thinking',
        effectiveTier: 'fast',
        thinkingReadiness: 'languageAlwaysFast',
        fallbackActive: true,
      }),
      'Proofread',
      'en'
    );

    expect(component.selectedTier).toBe('fast');
    expect(text('tier-toggle-fallback')).toBe(component.label('fallbackWarning'));
    expect(text('tier-toggle-reason')).toContain('book language');
    expect(exists('tier-toggle-follow-default')).toBeTrue();
  });

  it('clicking the disabled thinking option neither writes nor opens the consent step', () => {
    mount(withTask(makeDto(), 'Proofread', { thinkingReadiness: 'routeNotConfigured' }));

    button('tier-toggle-thinking').click();
    fixture.detectChanges();

    expect(exists('tier-toggle-consent')).toBeFalse();
    expect(pendingWrites().length).toBe(0);
  });

  it('clicking the already-selected option issues no write', () => {
    mount(makeDto());
    button('tier-toggle-fast').click();
    fixture.detectChanges();
    expect(pendingWrites().length).toBe(0);
  });

  it('shows no reason line at all when the tier is ready', () => {
    mount(makeDto());
    expect(exists('tier-toggle-reason')).toBeFalse();
    expect(exists('tier-toggle-fallback')).toBeFalse();
  });

  // ── Fall back visibly ───────────────────────────────────────────────────────

  /**
   * The operator kill-switch: the task stores thinking, the `{task}_thinking` key is gone, the run is local.
   *
   * FIXTURE FIDELITY (be-c01): `effectiveTier` is 'fast' here, not 'thinking'. It reports the tier that will
   * actually ROUTE, so a killed route reads fast while `storedTier` keeps saying thinking - that PAIRING is
   * the fallback, and it is the shape the live server sends. The old fixture paired `effectiveTier:
   * 'thinking'` with `routeNotConfigured`, which the server can no longer produce.
   */
  it('says so out loud when a task set to thinking is actually running fast', () => {
    mount(withTask(makeDto(), 'Proofread', {
      storedTier: 'thinking',
      effectiveTier: 'fast',
      thinkingReadiness: 'routeNotConfigured',
      fallbackActive: true,
    }));

    expect(exists('tier-toggle-fallback')).toBeTrue();
    expect(text('tier-toggle-fallback')).toBe(component.label('fallbackWarning'));
    // The warning is about the SETTING, so the highlighted word is still the honest one.
    expect(component.selectedTier).toBe('fast');
    expect(text('tier-toggle-reason')).toBe(component.label('reasonRouteNotConfigured'));
  });

  // ── Follow the book default again ───────────────────────────────────────────

  it('offers "follow the book default" only when the task carries its OWN override', () => {
    mount(makeDto());
    expect(exists('tier-toggle-follow-default')).withContext('inheriting').toBeFalse();

    mount(withTask(makeDto(), 'Proofread', { storedTier: 'fast', effectiveTier: 'fast' }));
    expect(exists('tier-toggle-follow-default')).withContext('overridden').toBeTrue();
  });

  it('clears the override through the explicit DELETE verb, not through a tier write', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'fast', effectiveTier: 'fast' }));

    button('tier-toggle-follow-default').click();
    fixture.detectChanges();

    const cleared = write();
    expect(cleared.request.method).toBe('DELETE');
    expect(cleared.request.url).toBe('/api/books/book-1/ai-tier/Proofread');
    cleared.flush(makeDto());
    fixture.detectChanges();

    expect(component.taskStatus!.storedTier).toBeNull();
  });

  // ── The book-default scope ──────────────────────────────────────────────────

  it('in book scope it reads the book default and writes it WITHOUT a task', () => {
    mount(makeDto({ tier: 'fast' }), null);

    expect(text('tier-toggle-title')).toBe(component.label('bookDefaultTitle'));
    expect(component.selectedTier).toBe('fast');

    component.requestThinking();
    component.confirmThinking();

    const put = write();
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ tier: 'thinking' });
    put.flush(makeDto({ tier: 'thinking' }));
    fixture.detectChanges();

    expect(component.selectedTier).toBe('thinking');
  });

  it('in book scope there is no per-task follow-default link (there is nothing to inherit from)', () => {
    mount(makeDto(), null);
    expect(exists('tier-toggle-follow-default')).toBeFalse();
  });

  // ── Model identity is internal IP: it must never render ─────────────────────

  /**
   * Carried forward from the deleted dashboard control's f1 pin test, and tightened. The payload no longer
   * carries provider/model at all (c2 removed the routes array), so this asserts the stronger property: NO
   * provider name, model id or vendor string appears anywhere in the rendered output, in either language,
   * on either tier, with the info popover open. The IP decision has to stay pinned somewhere, and this is
   * now the only component that renders tier UI.
   */
  it('never renders a provider, model or vendor name anywhere (model identity is internal IP)', () => {
    const forbidden = ['Ollama', 'ollama', 'OpenRouter', 'gemma', 'Gemma', 'google/', 'Dicta', 'Nemotron', 'GPT', 'Claude'];
    for (const language of ['he', 'en'] as const) {
      for (const dto of [makeDto(), withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' })]) {
        mount(dto, 'Proofread', language);
        component.toggleInfo();
        component.requestThinking();
        fixture.detectChanges();

        const rendered = (fixture.nativeElement as HTMLElement).textContent || '';
        for (const needle of forbidden) {
          expect(rendered).withContext(`${language}:${needle}`).not.toContain(needle);
        }
      }
    }
  });

  // ── he/en parity + no em-dash ───────────────────────────────────────────────
  //
  // The enumeration below is MECHANICAL (driven off TIER_TOGGLE_LABEL_KEYS, which is derived from
  // Object.keys(TIER_TOGGLE_LABELS_HE) in the component), not a hand-copied list: a label added to the
  // component's maps is picked up here automatically, so it cannot slip past both guards at once the way a
  // hand-authored list here could.

  it('the derived label key set is not vacuous', () => {
    // Guards against the accessor itself going empty (e.g. a broken export returning []), which would make
    // every for-of below a silent no-op and both guards pass without checking anything.
    expect(TIER_TOGGLE_LABEL_KEYS.length).withContext('key count').toBeGreaterThanOrEqual(20);
  });

  it('the en map has exactly the same key set as the he map', () => {
    const heKeys = Object.keys(TIER_TOGGLE_LABELS_HE).sort();
    const enKeys = Object.keys(TIER_TOGGLE_LABELS_EN).sort();
    const missingFromEn = heKeys.filter((k) => !enKeys.includes(k));
    const missingFromHe = enKeys.filter((k) => !heKeys.includes(k));
    expect(missingFromEn).withContext('keys in he but not en').toEqual([]);
    expect(missingFromHe).withContext('keys in en but not he').toEqual([]);
  });

  it('has he/en parity for every label key it renders', () => {
    for (const key of TIER_TOGGLE_LABEL_KEYS) {
      component.bookLanguage = 'he';
      expect(component.label(key)).withContext(`he:${key}`).not.toBe(key);
      component.bookLanguage = 'en';
      expect(component.label(key)).withContext(`en:${key}`).not.toBe(key);
      // Parity is not just presence: the two maps must not be the same string by accident of a fallback.
      component.bookLanguage = 'he';
      const he = component.label(key);
      component.bookLanguage = 'en';
      expect(he).withContext(`distinct:${key}`).not.toBe(component.label(key));
    }
  });

  it('uses no em-dash in any user-facing string', () => {
    for (const lang of ['he', 'en']) {
      component.bookLanguage = lang;
      for (const key of TIER_TOGGLE_LABEL_KEYS) {
        expect(component.label(key)).withContext(`${lang}:${key}`).not.toContain('—');
      }
    }
  });

  // ── Failure handling ────────────────────────────────────────────────────────

  it('surfaces a load failure with a retry rather than rendering an empty toggle', () => {
    component.bookId = 'book-1';
    component.task = 'Proofread';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    read().flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(exists('tier-toggle-load-error')).toBeTrue();
    expect(exists('tier-toggle-fast')).toBeFalse();
    expect(component.loading).withContext('the spinner comes down with the failure').toBeFalse();
  });

  it('the retry button re-reads and clears the failure', () => {
    component.bookId = 'book-1';
    component.task = 'Proofread';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    read().flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    button('tier-toggle-retry').click();
    fixture.detectChanges();
    read().flush(makeDto());
    fixture.detectChanges();

    expect(exists('tier-toggle-load-error')).toBeFalse();
    expect(exists('tier-toggle-fast')).toBeTrue();
  });

  it('hides the options when the server reports no row for this task', () => {
    mount({ ...makeDto(), tasks: [makeTask({ task: 'LineEdit' })] }, 'Proofread');
    expect(exists('tier-toggle-fast')).toBeFalse();
    expect(component.hasAnswer).toBeFalse();
  });

  /**
   * A 409 means the server refused the tier between the read and the write. Saying "try again" would be
   * wrong advice, so the message says the tier is unavailable, and the control re-reads so it stops offering
   * an option the server will keep refusing. Consent does not change this: it is a UI step, not a gate.
   */
  it('explains a 409 refusal specifically, reverts to the server state and re-reads the verdict', () => {
    mount(makeDto());

    component.requestThinking();
    component.confirmThinking();
    write().flush(null, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(text('tier-toggle-save-error')).toBe(component.label('saveRejected'));
    expect(component.selectedTier).withContext('never optimistically flipped').toBe('fast');
    expect(exists('tier-toggle-consent')).toBeFalse();

    // The re-read is the point: the control must stop offering an option the server will keep refusing.
    read().flush(withTask(makeDto(), 'Proofread', { thinkingReadiness: 'routeNotConfigured' }));
    fixture.detectChanges();

    expect(component.taskStatus!.thinkingReadiness).toBe('routeNotConfigured');
    expect(button('tier-toggle-thinking').getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the generic save error for a non-409 failure', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    write().flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(text('tier-toggle-save-error')).toBe(component.label('saveError'));
    expect(pendingReads().length).withContext('a failed write still re-reads the verdict').toBe(1);
  });

  it('shows a saving label and blocks a second overlapping write', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    fixture.detectChanges();
    expect(text('tier-toggle-saving')).toBe(component.label('saving'));

    component.chooseFast();

    expect(pendingWrites().length).toBe(1);
  });

  /**
   * NO OPTIMISTIC FLIP, measured in the window where an optimistic control would already have moved: the
   * request is issued and left OPEN, and the pill must still read what the server last said.
   */
  it('does not move the pill while a write is in flight', () => {
    mount(makeDto());

    component.requestThinking();
    component.confirmThinking();
    fixture.detectChanges();

    const put = write();
    expect(component.selectedTier).withContext('painted from the answer, never from the request').toBe('fast');
    expect(button('tier-toggle-fast').getAttribute('aria-checked')).toBe('true');
    expect(button('tier-toggle-thinking').getAttribute('aria-checked')).toBe('false');

    put.flush(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));
    fixture.detectChanges();
    expect(component.selectedTier).toBe('thinking');
  });

  it('re-reads when the book language changes, because the language changes what each task can do', () => {
    mount(makeDto(), 'Proofread', 'he');

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    expect(pendingReads().length).toBe(1);
  });

  it('does not call the server without a book id', () => {
    component.task = 'Proofread';
    component.bookId = null;
    component.ngOnChanges({ bookId: new SimpleChange('book-1', null, false) });
    expect(pendingReads().length).toBe(0);
    expect(component.loading).toBeFalse();
  });

  // ── Same-key request supersession (carried forward from the predecessor control) ──

  /**
   * The bookId guard is a context-CHANGE guard and does not cover two reads for the SAME book resolving out
   * of order. Every test in this block holds the requests OPEN across the assertions: an `of()`-based version
   * would collapse the very window the defect lives in and prove nothing.
   */
  it('shows the NEWER answer when two reads for the SAME book resolve out of order', () => {
    component.bookId = 'book-1';
    component.task = 'Proofread';
    component.bookLanguage = 'he';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    const stale = read();

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    const fresh = read();

    // The SECOND request answers first; the abandoned FIRST one can no longer land on anybody.
    fresh.flush(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));
    fixture.detectChanges();

    expect(stale.cancelled).withContext('the abandoned read is not even in flight').toBeTrue();
    expect(component.selectedTier).toBe('thinking');
    expect(component.taskStatus!.thinkingReadiness).toBe('ready');
  });

  it('cancels the in-flight read when reload() re-enters for the SAME book', () => {
    component.bookId = 'book-1';
    component.task = 'Proofread';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    const stale = read();

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    expect(stale.cancelled).toBeTrue();
    expect(pendingReads().length).withContext('exactly one live read at a time').toBe(1);
  });

  it('supersedes a read that was in flight when a write succeeds', () => {
    mount(makeDto());

    component.requestThinking();
    component.confirmThinking();
    const saved = write();
    component.reload();
    const overlapping = read();

    // The write answers first with the POST-write truth...
    saved.flush(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));
    fixture.detectChanges();

    // ...and the older read must no longer be able to land its PRE-write snapshot.
    expect(overlapping.cancelled).toBeTrue();
    expect(component.selectedTier).toBe('thinking');
  });

  it('supersedes the post-failure re-read when the control reloads again', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    write().flush('boom', { status: 500, statusText: 'Server Error' });
    const reread = read();

    component.reload();
    const later = read();

    expect(reread.cancelled).toBeTrue();
    later.flush(makeDto());
    fixture.detectChanges();

    expect(component.taskStatus!.thinkingReadiness).toBe('ready');
    expect(component.selectedTier).toBe('fast');
  });

  it('leaves no active subscriber behind when destroyed with a read in flight', () => {
    component.bookId = 'book-1';
    component.task = 'Proofread';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    const pending = read();

    fixture.destroy();

    expect(pending.cancelled).toBeTrue();
  });

  /** A read that never resolves must leave the control in ONE coherent state: spinner up, no options, no error. */
  it('keeps the loading state coherent while a read never resolves', () => {
    component.bookId = 'book-1';
    component.task = 'Proofread';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    const pending = read();
    fixture.detectChanges();

    expect(component.loading).toBeTrue();
    expect(exists('tier-toggle-loading')).toBeTrue();
    expect(exists('tier-toggle-fast')).withContext('no options without an answer').toBeFalse();
    expect(exists('tier-toggle-load-error')).toBeFalse();
    expect(pending.cancelled).toBeFalse();
  });

  // ── The `saving` latch across a context change ──────────────────────────────

  it('clears the saving latch on a book switch, so a late write cannot lock the next book', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    const pendingWrite = write();
    expect(component.saving).withContext('write in flight').toBeTrue();

    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    read('book-2').flush(makeDto({ bookId: 'book-2' }));
    fixture.detectChanges();

    expect(component.saving).withContext('latch cleared by the switch').toBeFalse();

    // The abandoned write now resolves for the OLD book: it must neither repaint nor re-lock book-2.
    pendingWrite.flush(makeDto({ bookId: 'book-1' }));
    fixture.detectChanges();

    expect(component.saving).withContext('stale response must not re-lock').toBeFalse();
    expect(component.status?.bookId).toBe('book-2');
  });

  it('keeps the saving latch through a language-only change, and the write itself clears it', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    const pendingWrite = write();

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    expect(component.saving).withContext('same book, write still in flight').toBeTrue();

    pendingWrite.flush(makeDto());
    fixture.detectChanges();

    expect(component.saving).withContext('cleared by its own handler').toBeFalse();
    expect(component.selectedTier).toBe('fast');
  });

  it('lowers the loading spinner when a successful write supersedes an open read', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    const pendingWrite = write();

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    const pendingRead = read();
    expect(component.loading).withContext('read in flight').toBeTrue();

    pendingWrite.flush(makeDto());
    fixture.detectChanges();

    expect(pendingRead.cancelled).toBeTrue();
    expect(component.loading).withContext('spinner lowered with the superseded read').toBeFalse();
    expect(exists('tier-toggle-loading')).toBeFalse();
  });

  it('lowers the loading spinner when a FAILED write cancels an open read before re-reading', () => {
    mount(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    component.chooseFast();
    const pendingWrite = write();

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    const pendingRead = read();
    expect(component.loading).toBeTrue();

    pendingWrite.flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(pendingRead.cancelled).toBeTrue();
    expect(component.loading).withContext('spinner lowered by the cancel').toBeFalse();
    expect(component.saving).toBeFalse();
    expect(component.saveError).toBeTruthy();
  });
});

/**
 * THE SHARED PER-BOOK ANSWER (tier-ux-rework fixes c02).
 *
 * MEASURED DEFECT: the dashboard mounts two of these against one book (the book-default row and the
 * BookReview row) and the analysis panel a third. Each held its own private snapshot, so clicking Fast on the
 * book-default row repainted that row while the toggle higher up the SAME page kept showing thinking plus a
 * now-false fallback warning - even though the write's own response carried that task's new answer. Two
 * identical GETs also fired per dashboard load.
 *
 * The measurement was taken on the BookReview toggle, before be-c01 clamped `effectiveTier`; that particular
 * pill can no longer show 'thinking' at all, so the tests that assert a SIBLING PILL MOVING use an
 * allowlisted task (see `bookOnThinking` for the fidelity rule). The staleness itself is unchanged - it is a
 * property of the shared answer, not of which task is watching it.
 *
 * Every test below mounts REAL components against the REAL service and holds the requests open, because the
 * property at issue is exactly what happens between two components while a request is in flight.
 */
describe('TierToggleComponent shared per-book state (tier-ux-rework fixes c02)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TierToggleComponent, HttpClientTestingModule],
      providers: [AiTierService],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  interface Mounted {
    fixture: ComponentFixture<TierToggleComponent>;
    component: TierToggleComponent;
  }

  /** Mounts one toggle exactly as a host does: inputs, then the bookId ngOnChanges the host's binding fires. */
  function toggle(opts: { bookId?: string; task?: string | null; language?: string } = {}): Mounted {
    const bookId = opts.bookId ?? 'book-1';
    const f = TestBed.createComponent(TierToggleComponent);
    const c = f.componentInstance;
    c.bookId = bookId;
    c.bookLanguage = opts.language ?? 'he';
    if (opts.task === null) {
      c.scope = 'book';
    } else {
      c.task = opts.task ?? 'Proofread';
    }
    c.ngOnChanges({ bookId: new SimpleChange(null, bookId, true) });
    f.detectChanges();
    return { fixture: f, component: c };
  }

  function reads(bookId = 'book-1'): TestRequest[] {
    return http.match(isRead(bookId));
  }

  function writes(bookId = 'book-1'): TestRequest[] {
    return http.match(isWrite(bookId));
  }

  /**
   * Answers every read currently open for the book. Deliberately not `reads()[0]`: how MANY reads two mounted
   * toggles produce is the subject of its own test below, and hard-coding one here would make the other tests
   * fail during setup (with an unanswered toggle) instead of on the assertion they exist to make.
   */
  function flushReads(answer: BookAiTierDto, bookId = 'book-1'): void {
    const pending = reads(bookId);
    expect(pending.length).withContext('a read was expected').toBeGreaterThan(0);
    for (const req of pending) req.flush(answer);
  }

  function has(m: Mounted, testId: string): boolean {
    return !!m.fixture.debugElement.query(By.css(`[data-testid="${testId}"]`));
  }

  /**
   * The live shape: the book default is thinking and LinguisticAnalysis is riding it.
   *
   * FIXTURE FIDELITY (final-r03). The sibling whose PILL has to move is an ALLOWLISTED task, because since
   * be-c01 `effectiveTier` is the tier that will actually ROUTE and BookReview / LineEdit are outside
   * `AiTierPolicy.TieredTasks` - the server reads them `fast` + `taskNotEligible` whatever the book default
   * says, so a BookReview pill can never show 'thinking' and cannot witness a repaint. An earlier draft of
   * these fixtures overrode BookReview to `thinking` + `ready`, a payload production cannot produce; that is
   * the class of fixture that made the language-rung spec vacuous through the original P0. BookReview is
   * still mounted as the second toggle wherever the property under test is about the CHANNEL rather than the
   * pill (one GET per page load, adoption, in-flight isolation, the per-instance error and saving state),
   * which is the dashboard's real pairing.
   */
  function bookOnThinking(): BookAiTierDto {
    return withTask(makeDto({ tier: 'thinking' }), 'LinguisticAnalysis', {
      task: 'LinguisticAnalysis',
      storedTier: null,
      effectiveTier: 'thinking',
      thinkingReadiness: 'ready',
      fallbackActive: false,
    });
  }

  /** The same book after the default is flipped to fast: LinguisticAnalysis follows it down. */
  function bookOnFast(): BookAiTierDto {
    return withTask(makeDto({ tier: 'fast' }), 'LinguisticAnalysis', {
      task: 'LinguisticAnalysis',
      storedTier: null,
      effectiveTier: 'fast',
      thinkingReadiness: 'ready',
      fallbackActive: false,
    });
  }

  it('(b) issues ONE read for two toggles mounted on the same book', () => {
    // The dashboard's real pairing, and here the task does not matter: what is under test is the number of
    // GETs, not which word either pill ends up on.
    const bookDefault = toggle({ task: null });
    const bookReview = toggle({ task: 'BookReview' });

    const pending = reads();
    expect(pending.length).withContext('two toggles, one GET').toBe(1);

    pending[0].flush(bookOnThinking());
    bookDefault.fixture.detectChanges();
    bookReview.fixture.detectChanges();

    expect(bookDefault.component.selectedTier).withContext('the joiner still gets the answer').toBe('thinking');
    expect(bookReview.component.status?.tier).withContext('and so does the second toggle').toBe('thinking');
  });

  it('(a) repaints EVERY toggle on the book from ONE toggle\'s write', () => {
    const bookDefault = toggle({ task: null });
    const sibling = toggle({ task: 'LinguisticAnalysis' });
    flushReads(bookOnThinking());
    bookDefault.fixture.detectChanges();
    sibling.fixture.detectChanges();
    expect(sibling.component.selectedTier).withContext('precondition').toBe('thinking');

    // The measured click: Fast on the book-default row, with no consent step in the way.
    bookDefault.component.chooseFast();
    const put = writes();
    expect(put.length).toBe(1);
    expect(put[0].request.body).toEqual({ tier: 'fast' });
    put[0].flush(bookOnFast());
    bookDefault.fixture.detectChanges();
    sibling.fixture.detectChanges();

    expect(bookDefault.component.selectedTier).toBe('fast');
    expect(sibling.component.selectedTier).withContext('the sibling repaints from the same answer').toBe('fast');
    expect(has(sibling, 'tier-toggle-fallback')).withContext('and its warning is no longer claimed').toBeFalse();
    expect(reads().length).withContext('the write repaints, it does not trigger N re-reads').toBe(0);
  });

  it('(a) repaints a sibling from a write it did not issue WITHOUT touching that sibling\'s own error state', () => {
    const writer = toggle({ task: null });
    const sibling = toggle({ task: 'LinguisticAnalysis' });
    flushReads(bookOnThinking());

    // The sibling has a save error of its OWN from an earlier refused attempt.
    sibling.component.chooseFast();
    writes()[0].flush(null, { status: 409, statusText: 'Conflict' });
    sibling.fixture.detectChanges();
    flushReads(bookOnThinking()); // its post-failure re-read
    sibling.fixture.detectChanges();
    expect(sibling.component.saveError).withContext('precondition').toBe(sibling.component.label('saveRejected'));

    writer.component.chooseFast();
    writes()[0].flush(bookOnFast());
    sibling.fixture.detectChanges();

    expect(sibling.component.selectedTier).withContext('shared answer').toBe('fast');
    expect(sibling.component.saveError)
      .withContext('a save failure describes THIS control\'s attempt, not the book')
      .toBe(sibling.component.label('saveRejected'));
  });

  it('(c) a late answer for the PREVIOUS book cannot repaint the toggle that moved on', () => {
    const moved = toggle({ task: 'Proofread' });
    const stayed = toggle({ task: 'BookReview' });
    const firstRead = reads();
    expect(firstRead.length).toBe(1);

    // One toggle switches books while book-1's read is still open and held by the other toggle.
    moved.component.bookId = 'book-2';
    moved.component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    reads('book-2')[0].flush(makeDto({ bookId: 'book-2' }));
    moved.fixture.detectChanges();

    expect(firstRead[0].cancelled).withContext('still held open by the toggle that stayed').toBeFalse();
    firstRead[0].flush(makeDto({ bookId: 'book-1', tier: 'thinking' }));
    moved.fixture.detectChanges();
    stayed.fixture.detectChanges();

    expect(moved.component.status?.bookId).withContext('book-1 answer must not reach book-2').toBe('book-2');
    expect(moved.component.selectedTier).toBe('fast');
    expect(stayed.component.status?.bookId).withContext('the toggle that stayed does get it').toBe('book-1');
  });

  it('(c) a read a write has landed on top of cannot repaint anyone, even a toggle still holding it', () => {
    const writer = toggle({ task: null });
    const holder = toggle({ task: 'LinguisticAnalysis' });
    flushReads(bookOnThinking());

    // A read goes out (a language change on the holder), then a write from the OTHER toggle lands under it.
    holder.component.bookLanguage = 'en';
    holder.component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    const openRead = reads();
    expect(openRead.length).toBe(1);

    writer.component.chooseFast();
    writes()[0].flush(bookOnFast());
    holder.fixture.detectChanges();
    expect(holder.component.selectedTier).withContext('the write repainted it').toBe('fast');

    // The read now answers with what the server knew BEFORE the write. It must not go back.
    openRead[0].flush(bookOnThinking());
    holder.fixture.detectChanges();

    expect(holder.component.selectedTier).withContext('a pre-write answer cannot un-do a write').toBe('fast');
    expect(writer.component.selectedTier).toBe('fast');
  });

  it('(d) a refused write re-reads, and the fresh verdict reaches every toggle', () => {
    const writer = toggle({ task: 'Proofread' });
    const sibling = toggle({ task: 'BookReview' });
    flushReads(makeDto());

    writer.component.requestThinking();
    writer.component.confirmThinking();
    writes()[0].flush(null, { status: 409, statusText: 'Conflict' });
    writer.fixture.detectChanges();

    expect(writer.component.saveError).toBe(writer.component.label('saveRejected'));
    expect(writer.component.selectedTier).withContext('no optimistic flip on a refusal').toBe('fast');

    const reread = reads();
    expect(reread.length).withContext('the refusal is re-read, not assumed').toBe(1);
    reread[0].flush(withTask(makeDto(), 'Proofread', { thinkingReadiness: 'routeNotConfigured' }));
    writer.fixture.detectChanges();
    sibling.fixture.detectChanges();

    expect(writer.component.taskStatus!.thinkingReadiness).toBe('routeNotConfigured');
    expect(sibling.component.status?.tasks.find((t) => t.task === 'Proofread')!.thinkingReadiness)
      .withContext('the sibling learns the new verdict too')
      .toBe('routeNotConfigured');
  });

  it('(d) a generic write failure keeps the generic message and still re-reads', () => {
    const writer = toggle({ task: 'Proofread' });
    flushReads(withTask(makeDto(), 'Proofread', { storedTier: 'thinking', effectiveTier: 'thinking' }));

    writer.component.chooseFast();
    writes()[0].flush('boom', { status: 500, statusText: 'Server Error' });
    writer.fixture.detectChanges();

    expect(writer.component.saveError).toBe(writer.component.label('saveError'));
    expect(reads().length).toBe(1);
  });

  it('(e) a read that never resolves leaves both toggles loading, and detaching one does not abort the other', () => {
    const first = toggle({ task: 'Proofread' });
    const second = toggle({ task: 'BookReview' });
    const shared = reads();
    expect(shared.length).toBe(1);

    expect(first.component.loading).toBeTrue();
    expect(second.component.loading).toBeTrue();
    expect(has(first, 'tier-toggle-loading')).toBeTrue();

    // One toggle goes away. The request belongs to the book, not to it, so the other keeps waiting.
    first.fixture.destroy();
    expect(shared[0].cancelled).withContext('one detaching must not abort the other\'s read').toBeFalse();
    expect(second.component.loading).toBeTrue();

    shared[0].flush(makeDto());
    second.fixture.detectChanges();
    expect(second.component.loading).toBeFalse();
    expect(second.component.status).not.toBeNull();

    // And when the LAST subscriber for a book detaches, nothing is left in flight for it.
    const alone = toggle({ bookId: 'book-9' });
    const itsRead = reads('book-9');
    expect(itsRead.length).toBe(1);
    alone.fixture.destroy();
    expect(itsRead[0].cancelled).withContext('no subscriber left').toBeTrue();
  });

  /**
   * THE REAL DASHBOARD SHAPE, measured in the browser: its two toggles do not mount together. The BookReview
   * row's toggle appears about 140ms after the book-default row's, by which time the first GET has already
   * finished - so joining an in-flight read is not enough on its own to make a page load cost one GET.
   */
  it('(b) a toggle mounting AFTER the first read landed adopts that answer instead of reading again', async () => {
    const early = toggle({ task: null });
    reads()[0].flush(bookOnThinking());
    early.fixture.detectChanges();

    const late = toggle({ task: 'BookReview' });
    expect(reads().length).withContext('no second GET for the same page load').toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 0));
    late.fixture.detectChanges();

    expect(late.component.status?.tier).withContext('it shows what its sibling shows').toBe('thinking');
    expect(late.component.loading).withContext('an adopted answer is an answer').toBeFalse();
    expect(has(late, 'tier-toggle-loading')).toBeFalse();
  });

  /**
   * The other half of that bargain (trap b): the held answer must not outlive the toggles. Once the last one
   * for a book goes away there is nothing left to adopt, so the next visit reads rather than flashing a
   * snapshot from the previous one.
   */
  it('does not hand a previous VISIT\'s answer to a fresh mount', async () => {
    const first = toggle({ task: 'Proofread' });
    reads()[0].flush(makeDto({ tier: 'thinking' }));
    first.fixture.detectChanges();
    first.fixture.destroy();

    const revisit = toggle({ task: 'Proofread' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    revisit.fixture.detectChanges();

    expect(revisit.component.status).withContext('nothing painted before the fresh read').toBeNull();
    expect(revisit.component.loading).toBeTrue();
    const fresh = reads();
    expect(fresh.length).withContext('a new visit reads').toBe(1);
    fresh[0].flush(makeDto({ tier: 'fast' }));
    revisit.fixture.detectChanges();
    expect(revisit.component.status?.tier).toBe('fast');
  });

  it('(f) a write in flight moves nobody: not the writer, not its siblings', () => {
    const writer = toggle({ task: null });
    const sibling = toggle({ task: 'LinguisticAnalysis' });
    flushReads(bookOnThinking());
    writer.fixture.detectChanges();
    sibling.fixture.detectChanges();

    writer.component.chooseFast();
    writer.fixture.detectChanges();
    sibling.fixture.detectChanges();
    const put = writes();

    expect(writer.component.selectedTier).withContext('the requested value is not an answer').toBe('thinking');
    expect(sibling.component.selectedTier).toBe('thinking');
    expect(writer.component.saving).toBeTrue();
    expect(sibling.component.saving).withContext('the latch is per-instance, not shared').toBeFalse();

    put[0].flush(bookOnFast());
    writer.fixture.detectChanges();
    sibling.fixture.detectChanges();
    expect(writer.component.selectedTier).toBe('fast');
    expect(sibling.component.selectedTier).toBe('fast');
  });
});

/**
 * tier-ux-rework fixes c04: the `tierChanged` @Output.
 *
 * A tier change moves the ACTIVE MODEL, which is what `builtWithDifferentModel` on the style-baseline /
 * book-summary / book-review statuses is computed from - and those rows render inches from this control. So
 * a successful write has to tell its host, and the interesting part is everything it must NOT tell it:
 *
 *  - not on a failure or a 409 (nothing moved, so no status went stale);
 *  - not on a no-op click, which never reaches the write path at all;
 *  - and, since c02 made the ANSWER shared across every toggle on the book, exactly ONCE per write however
 *    many toggles that answer repaints. This suite therefore mounts TWO instances for the emit-count case,
 *    because a one-instance test passes just as happily against an emit driven off the shared channel.
 *
 * The window is driven with the testing backend, not `of()`: a request held open across assertions is the
 * only shape in which "the emit happened when the answer landed, not when the click did" is observable.
 */
describe('TierToggleComponent tierChanged (tier-ux-rework fixes c04)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TierToggleComponent, HttpClientTestingModule],
      providers: [AiTierService],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  interface Watched {
    fixture: ComponentFixture<TierToggleComponent>;
    component: TierToggleComponent;
    /** Every `tierChanged` this instance emitted, so the COUNT is assertable and not just "did it fire". */
    events: number;
  }

  /** Mounts one toggle with its `tierChanged` counted, exactly as a host binding would consume it. */
  function toggle(opts: { bookId?: string; task?: string | null; language?: string } = {}): Watched {
    const bookId = opts.bookId ?? 'book-1';
    const f = TestBed.createComponent(TierToggleComponent);
    const c = f.componentInstance;
    c.bookId = bookId;
    c.bookLanguage = opts.language ?? 'he';
    if (opts.task === null) {
      c.scope = 'book';
    } else {
      c.task = opts.task ?? 'Proofread';
    }
    const watched: Watched = { fixture: f, component: c, events: 0 };
    c.tierChanged.subscribe(() => watched.events++);
    c.ngOnChanges({ bookId: new SimpleChange(null, bookId, true) });
    f.detectChanges();
    return watched;
  }

  function reads(bookId = 'book-1'): TestRequest[] {
    return http.match(isRead(bookId));
  }

  function writes(bookId = 'book-1'): TestRequest[] {
    return http.match(isWrite(bookId));
  }

  function flushReads(answer: BookAiTierDto, bookId = 'book-1'): void {
    const pending = reads(bookId);
    expect(pending.length).withContext('a read was expected').toBeGreaterThan(0);
    for (const req of pending) req.flush(answer);
  }

  /**
   * The book default is thinking and both ALLOWLISTED tasks are riding it, so a flip really moves both pills.
   *
   * FIXTURE FIDELITY (final-r03). Only Proofread and LinguisticAnalysis may carry `effectiveTier: 'thinking'`:
   * since be-c01 the field is the tier that will actually ROUTE, and BookReview / LineEdit are outside
   * `AiTierPolicy.TieredTasks`, so the server reads them `fast` + `taskNotEligible` whatever the book default
   * says. `makeDto` already writes those two rows correctly and this helper leaves them alone - an earlier
   * draft overrode BookReview to `thinking` + `ready`, which is a payload production cannot produce and is
   * exactly the class of fixture that made the language-rung spec vacuous through the original P0.
   */
  function bookOnThinking(): BookAiTierDto {
    const riding = { storedTier: null, effectiveTier: 'thinking', thinkingReadiness: 'ready', fallbackActive: false } as const;
    const dto = withTask(makeDto({ tier: 'thinking' }), 'Proofread', { task: 'Proofread', ...riding });
    return withTask(dto, 'LinguisticAnalysis', { task: 'LinguisticAnalysis', ...riding });
  }

  /** The same book after the flip to fast. */
  function bookOnFast(): BookAiTierDto {
    return makeDto({ tier: 'fast' });
  }

  it('(a) a successful write emits exactly ONE tierChanged, even with two toggles mounted on the book', () => {
    const writer = toggle({ task: null });
    // The sibling is an ALLOWLISTED task on purpose (final-r03): a BookReview toggle can never show anything
    // but 'fast', so it cannot witness a repaint - the emit-count half of that pairing is covered by the
    // per-TASK test below, which keeps the dashboard's real book-default + BookReview shape.
    const sibling = toggle({ task: 'LinguisticAnalysis' });
    flushReads(bookOnThinking());
    writer.fixture.detectChanges();
    sibling.fixture.detectChanges();

    expect(sibling.component.selectedTier).withContext('precondition').toBe('thinking');

    writer.component.chooseFast();
    const put = writes();
    expect(put.length).toBe(1);
    expect(writer.events).withContext('the request is not the answer').toBe(0);

    put[0].flush(bookOnFast());
    writer.fixture.detectChanges();
    sibling.fixture.detectChanges();

    expect(sibling.component.selectedTier).withContext('the sibling DID repaint from it').toBe('fast');
    expect(writer.events).withContext('one write, one event, from the instance that issued it').toBe(1);
    expect(sibling.events)
      .withContext('a repainted sibling did not issue this write and must not announce it')
      .toBe(0);
  });

  it('(a) a per-TASK write emits too, and still only once', () => {
    const proofread = toggle({ task: 'Proofread' });
    const sibling = toggle({ task: 'BookReview' });
    flushReads(bookOnThinking());

    proofread.component.chooseFast();
    const put = writes();
    expect(put.length).toBe(1);
    expect(put[0].request.body).toEqual({ tier: 'fast', task: 'Proofread' });
    put[0].flush(bookOnFast());
    proofread.fixture.detectChanges();

    expect(proofread.events).toBe(1);
    expect(sibling.events).toBe(0);
  });

  it('(b) a FAILED write emits nothing', () => {
    const t = toggle({ task: 'Proofread' });
    flushReads(bookOnThinking());

    t.component.chooseFast();
    writes()[0].flush(null, { status: 500, statusText: 'Server Error' });
    t.fixture.detectChanges();

    expect(t.component.saveError).withContext('precondition: the failure was surfaced').toBe(
      t.component.label('saveError')
    );
    expect(t.events).withContext('nothing moved, so no status went stale').toBe(0);

    // The post-failure re-read must not sneak an emit in either: a READ is not a change.
    flushReads(bookOnThinking());
    t.fixture.detectChanges();
    expect(t.events).toBe(0);
  });

  it('(b) a 409 refusal emits nothing', () => {
    const t = toggle({ task: 'Proofread' });
    flushReads(makeDto({ tier: 'fast' }));

    t.component.confirmThinking();
    writes()[0].flush(null, { status: 409, statusText: 'Conflict' });
    t.fixture.detectChanges();

    expect(t.component.saveError).withContext('precondition').toBe(t.component.label('saveRejected'));
    expect(t.events).withContext('the server refused: the tier did not move').toBe(0);
  });

  it('(c) a click on the ALREADY-SELECTED option writes nothing and emits nothing', () => {
    const t = toggle({ task: 'Proofread' });
    flushReads(makeDto({ tier: 'fast' })); // already on fast

    t.component.chooseFast();
    t.fixture.detectChanges();

    expect(writes().length).withContext('precondition: the no-op returns before the write path').toBe(0);
    expect(t.events).toBe(0);
  });

  it('(d) clearing an override emits too, because it changes the effective tier', () => {
    const t = toggle({ task: 'Proofread' });
    flushReads(
      withTask(makeDto({ tier: 'fast' }), 'Proofread', {
        task: 'Proofread',
        storedTier: 'thinking',
        effectiveTier: 'thinking',
        thinkingReadiness: 'ready',
        fallbackActive: false,
      })
    );
    t.fixture.detectChanges();
    expect(t.component.canFollowBookDefault).withContext('precondition').toBeTrue();

    t.component.followBookDefault();
    const del = writes();
    expect(del.length).toBe(1);
    expect(del[0].request.method).toBe('DELETE');
    expect(t.events).withContext('not before the answer').toBe(0);

    del[0].flush(makeDto({ tier: 'fast' }));
    t.fixture.detectChanges();
    expect(t.events).toBe(1);
  });

  it('a write that answers AFTER the host switched books emits nothing for the new book', () => {
    const t = toggle({ task: 'Proofread' });
    flushReads(bookOnThinking());

    t.component.chooseFast();
    const put = writes();
    expect(put.length).toBe(1);

    // The host rebinds to another book while the PUT is still open.
    t.component.bookId = 'book-2';
    t.component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    put[0].flush(bookOnFast());
    t.fixture.detectChanges();

    expect(t.events).withContext('book-1 changed; the host is now showing book-2').toBe(0);
  });
});

/**
 * LAYOUT: the info panel must stay inside the narrow scrolling column it lives in.
 *
 * WHY THESE ARE REAL ASSERTIONS AND NOT STRUCTURE PROXIES. The suite runs in ChromeHeadless with
 * `src/styles.scss` loaded (angular.json test target), so the component's own stylesheet and the design
 * tokens are both live and `getBoundingClientRect()` returns real geometry. These specs therefore measure the
 * SAME property the browser gate measures: the popover's inline edges against its nearest clipping ancestor,
 * not the viewport. A viewport-only check passes while the copy is being cut off, which is exactly how this
 * shipped: anchored to the 1.15rem `?` wrapper mid-row, an 18rem panel grew straight out through the edge of
 * a ~347px `overflow: auto` column and lost 50-80px of Hebrew and 57px of English, with no horizontal
 * scrollbar to recover it.
 *
 * WHAT THEY DO NOT PROVE. They stand up ONE synthetic scroller of a representative width; they do not prove
 * the three real placements (analysis run tab, book review status row, the book default card) are inside
 * THEIR ancestors at THEIR widths, nor that the copy reads correctly to a human. That is the browser gate's
 * job and it was run. What these pin is the mechanism: row-anchored + clamped, so a future edit that moves
 * the containing block back to the `?` or drops the clamp fails here rather than in a screenshot months later.
 */
@Component({
  standalone: true,
  imports: [TierToggleComponent],
  template: `
    <section class="tt-spec-scroller">
      <app-tier-toggle
        [bookId]="bookId"
        [bookLanguage]="bookLanguage"
        [task]="task"
        [scope]="scope">
      </app-tier-toggle>
    </section>
  `,
  styles: [
    `
      /* The real surfaces are narrow scrolling columns: the analysis run tab is ~347px with overflow:auto,
         the book dashboard the same, and the book default card is that minus 16px of card padding a side. */
      .tt-spec-scroller {
        inline-size: 305px;
        block-size: 400px;
        overflow: auto;
      }
    `,
  ],
})
class TierToggleScrollerHostComponent {
  bookId: string | null = 'book-1';
  bookLanguage = 'he';
  task: string | null = 'Proofread';
  scope: 'task' | 'book' = 'task';
}

describe('TierToggleComponent layout (tier-ux-rework c3 loop-back)', () => {
  let fixture: ComponentFixture<TierToggleScrollerHostComponent>;
  let host: TierToggleScrollerHostComponent;
  let http: HttpTestingController;

  function dto(): BookAiTierDto {
    return {
      bookId: 'book-1',
      tier: 'fast',
      thinkingReadiness: 'ready',
      fallbackActive: false,
      consentRequired: true,
      tasks: [
        makeTask({ task: 'Proofread' }),
        makeTask({ task: 'LinguisticAnalysis' }),
        makeTask({ task: 'BookReview', thinkingReadiness: 'taskNotEligible' }),
      ],
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TierToggleScrollerHostComponent, HttpClientTestingModule],
      providers: [AiTierService],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TierToggleScrollerHostComponent);
    host = fixture.componentInstance;
  });

  function render(scope: 'task' | 'book', language: string, task: string | null = 'Proofread'): void {
    host.scope = scope;
    host.bookLanguage = language;
    host.task = scope === 'book' ? null : task;
    fixture.detectChanges();
    // A scope/task change re-derives from the snapshot in hand; a first render or a language change reads.
    for (const req of http.match(isRead())) req.flush(dto());
    fixture.detectChanges();
  }

  function q(selector: string): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLElement;
  }

  /** Pins the panel open the way a touch user does; hover cannot be synthesized. */
  function openPopover(): void {
    (q('[data-testid="tier-toggle-info"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function scroller(): HTMLElement {
    return q('.tt-spec-scroller');
  }

  for (const [language, dir] of [['he', 'rtl'], ['en', 'ltr']] as const) {
    it(`keeps the open info panel inside its clipping ancestor in ${dir} (task scope)`, () => {
      render('task', language);
      openPopover();

      const pop = q('[data-testid="tier-toggle-info-popover"]').getBoundingClientRect();
      const clip = scroller().getBoundingClientRect();

      expect(q('[data-testid="tier-toggle"]').getAttribute('dir')).toBe(dir);
      expect(pop.width).withContext('panel rendered').toBeGreaterThan(0);
      expect(pop.left).withContext(`${dir}: inline-start edge inside the scroller`).toBeGreaterThanOrEqual(clip.left - 0.5);
      expect(pop.right).withContext(`${dir}: inline-end edge inside the scroller`).toBeLessThanOrEqual(clip.right + 0.5);
      // Nothing to chase with a scrollbar either: the column must not gain horizontal overflow at all.
      expect(scroller().scrollWidth).withContext(`${dir}: no horizontal overflow`).toBe(scroller().clientWidth);
    });

    it(`keeps the open info panel inside its clipping ancestor in ${dir} (book scope)`, () => {
      render('book', language);
      openPopover();

      const pop = q('[data-testid="tier-toggle-info-popover"]').getBoundingClientRect();
      const clip = scroller().getBoundingClientRect();

      expect(pop.left).toBeGreaterThanOrEqual(clip.left - 0.5);
      expect(pop.right).toBeLessThanOrEqual(clip.right + 0.5);
      expect(scroller().scrollWidth).toBe(scroller().clientWidth);
    });
  }

  /**
   * The mechanism, stated directly: the row is the containing block. If someone puts `position: relative` back
   * on `.tt-info-wrap` the panel re-anchors to a 1.15rem button mid-row and the clamp below stops meaning
   * anything, so assert the offset parent rather than only the outcome.
   */
  it('anchors the panel to the toggle ROW, not to the 1.15rem info button wrapper', () => {
    render('task', 'he');
    openPopover();

    const pop = q('[data-testid="tier-toggle-info-popover"]') as HTMLElement;
    expect(pop.offsetParent).toBe(q('[data-testid="tier-toggle"]'));
    expect(getComputedStyle(q('.tt-info-wrap')).position).withContext('a relative wrapper steals it back').toBe('static');
    // Clamped to the row, so it can never be wider than the column that holds it.
    expect(pop.getBoundingClientRect().width)
      .toBeLessThanOrEqual(q('[data-testid="tier-toggle"]').getBoundingClientRect().width + 0.5);
  });

  /**
   * The book default row is the LAST element of the dashboard's scrolling column, so a panel hanging below it
   * lands past the block-end edge and shows ~7px of itself. It opens block-start there and block-end
   * everywhere else.
   */
  it('opens the panel block-start in book scope and block-end in task scope', () => {
    render('book', 'he');
    openPopover();
    let row = q('[data-testid="tier-toggle"]').getBoundingClientRect();
    let pop = q('[data-testid="tier-toggle-info-popover"]').getBoundingClientRect();
    expect(q('[data-testid="tier-toggle"]').classList).toContain('tt-scope-book');
    expect(pop.bottom).withContext('book scope opens upward').toBeLessThanOrEqual(row.top + 0.5);

    render('task', 'he');
    openPopover();
    row = q('[data-testid="tier-toggle"]').getBoundingClientRect();
    pop = q('[data-testid="tier-toggle-info-popover"]').getBoundingClientRect();
    expect(q('[data-testid="tier-toggle"]').classList).not.toContain('tt-scope-book');
    expect(pop.top).withContext('task scope opens downward').toBeGreaterThanOrEqual(row.bottom - 0.5);
  });

  /**
   * The book-default card is a ONE-LINE settings row. The title used to be a bold body-sm flex item with an
   * auto basis, and because flex line-breaking runs BEFORE flex shrinking its full max-content width decided
   * the line: the `?` was pushed onto a second flex row and the card rendered 87px tall. The title now takes a
   * zero basis, so it yields to the control and wraps its own text instead.
   */
  it('keeps the info button on the same line as the segmented control in book scope', () => {
    render('book', 'he');

    const seg = q('.tt-seg').getBoundingClientRect();
    const info = q('[data-testid="tier-toggle-info"]').getBoundingClientRect();

    expect(info.top).withContext('info wrapped onto a second row').toBeLessThan(seg.bottom);
    expect(info.bottom).toBeGreaterThan(seg.top);
    // And the row is a single flex line, not the control stacked under the title. Bounded by seg+info rather
    // than by seg alone so a font whose Hebrew title needs two TEXT lines at this width does not flake the
    // test: two stacked flex lines are always at least seg+info tall, one line never is.
    expect(q('[data-testid="tier-toggle"]').getBoundingClientRect().height)
      .withContext('the control stacked onto a second flex line')
      .toBeLessThan(seg.height + info.height);
  });

  it('still renders the title in book scope (the fit is won by layout, not by dropping copy)', () => {
    render('book', 'en');
    expect(q('[data-testid="tier-toggle-title"]').textContent!.trim()).toBe('Default for new analyses');
  });
});
