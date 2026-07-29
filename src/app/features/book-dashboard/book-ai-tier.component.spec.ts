/**
 * p3-4: the book model-tier control.
 *
 * The behaviour under test is mostly about what the surface REFUSES to claim:
 *  - it never renders a bare "thinking" when the tier is not actually routing (the visible-fallback rule);
 *  - it names every excluded task explicitly rather than saying "some features";
 *  - it never writes the thinking tier without an explicit consent step;
 *  - it re-renders from the SERVER's answer after a write, including after a 409 refusal.
 *
 * The he/en parity and RTL assertions are here rather than left to the browser gate because a missing key
 * silently falls back to the key NAME in this codebase's label() idiom, which reads like a real string.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { BookAiTierComponent } from './book-ai-tier.component';
import { AiTierService } from '../../core/services/ai-tier.service';
import { BookAiTierDto } from '../../core/models/book';

function makeTier(overrides: Partial<BookAiTierDto> = {}): BookAiTierDto {
  return {
    bookId: 'book-1',
    tier: 'fast',
    thinkingReadiness: 'ready',
    fallbackActive: false,
    routes: [
      { task: 'LinguisticAnalysis', provider: 'Ollama', model: 'gemma4:12b', usesTier: false },
      { task: 'Proofread', provider: 'Ollama', model: 'gemma4:12b', usesTier: false },
    ],
    ...overrides,
  };
}

function thinkingTier(overrides: Partial<BookAiTierDto> = {}): BookAiTierDto {
  return makeTier({
    tier: 'thinking',
    routes: [
      { task: 'LinguisticAnalysis', provider: 'OpenRouter', model: 'google/gemma-4-31b-it', usesTier: true },
      { task: 'Proofread', provider: 'OpenRouter', model: 'google/gemma-4-31b-it', usesTier: true },
    ],
    ...overrides,
  });
}

describe('BookAiTierComponent (p3-4)', () => {
  let fixture: ComponentFixture<BookAiTierComponent>;
  let component: BookAiTierComponent;
  let service: jasmine.SpyObj<AiTierService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj<AiTierService>('AiTierService', ['get', 'set']);
    service.get.and.returnValue(NEVER);
    service.set.and.returnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [BookAiTierComponent],
      providers: [{ provide: AiTierService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(BookAiTierComponent);
    component = fixture.componentInstance;
  });

  function mount(dto: BookAiTierDto, language = 'he'): void {
    service.get.and.returnValue(of(dto));
    component.bookId = 'book-1';
    component.bookLanguage = language;
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    fixture.detectChanges();
  }

  function text(testId: string): string {
    const el = fixture.debugElement.query(By.css(`[data-testid="${testId}"]`));
    return el ? (el.nativeElement.textContent || '').trim() : '';
  }

  function exists(testId: string): boolean {
    return !!fixture.debugElement.query(By.css(`[data-testid="${testId}"]`));
  }

  // ── The scope copy: the exclusions must be NAMED ─────────────────────────────

  it('names each excluded task explicitly, never "some features" (he)', () => {
    mount(makeTier(), 'he');
    const excluded = text('ai-tier-excludes');
    // BookReview, Proofread_en and TermRepair are the three p2-4 exclusions the copy must not soften.
    expect(excluded).toContain('סקירת ספר שלם');
    expect(excluded).toContain('הגהה באנגלית');
    expect(excluded).toContain('תיקון מונחים');
    // Plus the other two out-of-scope tasks.
    expect(excluded).toContain('עריכת שורה');
    expect(excluded).toContain('תקצירי');

    expect(text('ai-tier-applies')).toContain('ניתוח לשוני');
    expect(text('ai-tier-applies')).toContain('הגהה בעברית');
  });

  it('names each excluded task explicitly (en)', () => {
    mount(makeTier(), 'en');
    const excluded = text('ai-tier-excludes');
    expect(excluded).toContain('whole-book review');
    expect(excluded).toContain('English proofreading');
    expect(excluded).toContain('term repair');
    expect(excluded).toContain('line edit');
    expect(excluded).toContain('summaries');

    expect(text('ai-tier-applies')).toContain('linguistic analysis');
    expect(text('ai-tier-applies')).toContain('Hebrew proofreading');
  });

  it('states plainly that the text is sent to a third-party provider, in both languages', () => {
    mount(makeTier(), 'he');
    expect(text('ai-tier-privacy')).toContain('צד שלישי');
    expect(text('ai-tier-privacy')).toContain('OpenRouter');

    mount(makeTier(), 'en');
    expect(text('ai-tier-privacy')).toContain('third-party provider');
    expect(text('ai-tier-privacy')).toContain('OpenRouter');
  });

  /**
   * Every user-facing key must exist in BOTH maps. label() falls back to the KEY NAME, which renders as a
   * plausible-looking English word, so a missing Hebrew entry would not look broken in the browser.
   */
  it('has he/en parity for every label key it renders', () => {
    const keys = [
      'title', 'loading', 'saving', 'retry', 'cancel', 'loadError', 'saveError', 'saveRejected',
      'tierFast', 'tierThinking', 'fastDesc', 'thinkingDesc',
      'privacy', 'appliesTo', 'doesNotApplyTo',
      'consentTitle', 'consentConfirm',
      'fallbackWarning', 'reasonRouteNotConfigured', 'reasonProviderNotRegistered', 'reasonCredentialsMissing',
      'routesTitle', 'routeCloud', 'routeLocal', 'taskLinguistic', 'taskProofread',
    ];
    for (const key of keys) {
      component.bookLanguage = 'he';
      expect(component.label(key)).withContext(`he:${key}`).not.toBe(key);
      component.bookLanguage = 'en';
      expect(component.label(key)).withContext(`en:${key}`).not.toBe(key);
    }
  });

  it('uses no em-dash in any user-facing string', () => {
    for (const lang of ['he', 'en']) {
      component.bookLanguage = lang;
      for (const key of ['privacy', 'appliesTo', 'doesNotApplyTo', 'fallbackWarning', 'thinkingDesc', 'fastDesc',
        'consentTitle', 'consentConfirm', 'reasonRouteNotConfigured', 'reasonProviderNotRegistered',
        'reasonCredentialsMissing', 'saveRejected']) {
        expect(component.label(key)).withContext(`${lang}:${key}`).not.toContain('—');
      }
    }
  });

  it('follows the book language for [dir] (Hebrew default, LTR for English)', () => {
    mount(makeTier(), 'he');
    expect(fixture.debugElement.query(By.css('[data-testid="ai-tier-row"]')).attributes['dir']).toBe('rtl');

    mount(makeTier(), 'en');
    expect(fixture.debugElement.query(By.css('[data-testid="ai-tier-row"]')).attributes['dir']).toBe('ltr');
  });

  // ── Opt-in is explicit ──────────────────────────────────────────────────────

  it('does NOT write the tier on the first click: it opens a consent step first', () => {
    mount(makeTier());
    fixture.debugElement.query(By.css('[data-testid="ai-tier-option-thinking"]')).nativeElement.click();
    fixture.detectChanges();

    expect(service.set).not.toHaveBeenCalled();
    expect(exists('ai-tier-consent')).toBeTrue();
    // The consent body restates the privacy sentence at the moment of the decision.
    expect(text('ai-tier-consent')).toContain('OpenRouter');
  });

  it('writes thinking only after the consent is confirmed, and re-renders from the server answer', () => {
    mount(makeTier());
    service.set.and.returnValue(of(thinkingTier()));

    component.requestThinking();
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="ai-tier-consent-confirm"]')).nativeElement.click();
    fixture.detectChanges();

    expect(service.set).toHaveBeenCalledWith('book-1', 'thinking');
    expect(component.status!.tier).toBe('thinking');
    expect(exists('ai-tier-consent')).toBeFalse();
    expect(text('ai-tier-routes')).toContain('google/gemma-4-31b-it');
  });

  it('cancelling the consent leaves the book on fast and writes nothing', () => {
    mount(makeTier());
    component.requestThinking();
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="ai-tier-consent-cancel"]')).nativeElement.click();
    fixture.detectChanges();

    expect(service.set).not.toHaveBeenCalled();
    expect(exists('ai-tier-consent')).toBeFalse();
    expect(component.status!.tier).toBe('fast');
  });

  it('switching BACK to fast needs no consent (it can only reduce what leaves the machine)', () => {
    mount(thinkingTier());
    service.set.and.returnValue(of(makeTier()));

    fixture.debugElement.query(By.css('[data-testid="ai-tier-option-fast"]')).nativeElement.click();
    fixture.detectChanges();

    expect(service.set).toHaveBeenCalledWith('book-1', 'fast');
    expect(component.status!.tier).toBe('fast');
  });

  // ── Button labelling and disabled states ────────────────────────────────────

  it('marks the current tier as the checked radio and disables re-picking it', () => {
    mount(makeTier());
    const fast = fixture.debugElement.query(By.css('[data-testid="ai-tier-option-fast"]')).nativeElement as HTMLButtonElement;
    const thinking = fixture.debugElement.query(By.css('[data-testid="ai-tier-option-thinking"]')).nativeElement as HTMLButtonElement;

    expect(fast.getAttribute('aria-checked')).toBe('true');
    expect(fast.getAttribute('aria-disabled')).toBe('true');
    expect(fast.disabled).toBeFalse();
    expect(thinking.getAttribute('aria-checked')).toBe('false');
    expect(thinking.getAttribute('aria-disabled')).toBe('false');
    expect(thinking.disabled).toBeFalse();
  });

  it('disables the thinking option when the server says the tier cannot route here', () => {
    mount(makeTier({ thinkingReadiness: 'providerCredentialsMissing' }));
    const thinking = fixture.debugElement.query(By.css('[data-testid="ai-tier-option-thinking"]')).nativeElement as HTMLButtonElement;

    expect(thinking.getAttribute('aria-disabled')).toBe('true');
    expect(thinking.disabled).toBeFalse();
    expect(thinking.getAttribute('title')).toContain('מפתח גישה');
    // A fast book is told WHY, quietly, rather than being left with a dead control.
    expect(exists('ai-tier-unavailable')).toBeTrue();
  });

  it('keeps the aria-disabled thinking option focusable (a keyboard user must still be able to tab to it)', () => {
    mount(makeTier({ thinkingReadiness: 'providerCredentialsMissing' }));
    const thinking = fixture.debugElement.query(By.css('[data-testid="ai-tier-option-thinking"]')).nativeElement as HTMLButtonElement;
    expect(thinking.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it('clicking the aria-disabled thinking option calls neither set nor opens the consent panel', () => {
    mount(makeTier({ thinkingReadiness: 'providerCredentialsMissing' }));
    fixture.debugElement.query(By.css('[data-testid="ai-tier-option-thinking"]')).nativeElement.click();
    fixture.detectChanges();

    expect(service.set).not.toHaveBeenCalled();
    expect(exists('ai-tier-consent')).toBeFalse();
  });

  it('clicking the already-selected fast option issues no write', () => {
    mount(makeTier());
    fixture.debugElement.query(By.css('[data-testid="ai-tier-option-fast"]')).nativeElement.click();
    fixture.detectChanges();

    expect(service.set).not.toHaveBeenCalled();
  });

  it('shows a saving label and blocks a second write while one is in flight', () => {
    mount(thinkingTier());
    service.set.and.returnValue(NEVER);

    component.chooseFast();
    fixture.detectChanges();
    expect(text('ai-tier-saving')).toBe(component.label('saving'));

    component.chooseFast();
    expect(service.set).toHaveBeenCalledTimes(1);
  });

  // ── The visible fallback: THE point of the todo ─────────────────────────────

  it('renders an explicit warning when the stored tier is thinking but nothing routes to the cloud', () => {
    mount(thinkingTier({
      thinkingReadiness: 'routeNotConfigured',
      fallbackActive: true,
      routes: [
        { task: 'LinguisticAnalysis', provider: 'Ollama', model: 'gemma4:12b', usesTier: false },
        { task: 'Proofread', provider: 'Ollama', model: 'gemma4:12b', usesTier: false },
      ],
    }));

    expect(exists('ai-tier-fallback')).toBeTrue();
    expect(text('ai-tier-fallback')).toContain('המודל המקומי');
    // And the routes name the model that will really run, so the warning is checkable rather than a claim.
    expect(text('ai-tier-routes')).toContain('gemma4:12b');
    expect(text('ai-tier-routes')).not.toContain('google/gemma-4-31b-it');
  });

  it('warns that a run WILL FAIL when the tier routes to a provider that cannot serve it', () => {
    mount(thinkingTier({ thinkingReadiness: 'providerCredentialsMissing' }));
    // Not the silent-fallback state: a route DID move, it just cannot be served.
    expect(exists('ai-tier-fallback')).toBeFalse();
    expect(exists('ai-tier-will-fail')).toBeTrue();
    expect(text('ai-tier-will-fail')).toContain('תיכשל');
  });

  it('shows no fallback or failure banner on a healthy thinking book', () => {
    mount(thinkingTier());
    expect(exists('ai-tier-fallback')).toBeFalse();
    expect(exists('ai-tier-will-fail')).toBeFalse();
    expect(exists('ai-tier-unavailable')).toBeFalse();
  });

  /**
   * An ENGLISH book on the thinking tier: linguistic analysis goes to the cloud but proofreading does not,
   * because the server's language key outranks the tier key. Painting the whole book "cloud" would tell an
   * English author their proofreading leaves the machine when it does not.
   */
  it('reports per task, so an English book shows local proofreading on the thinking tier', () => {
    mount(thinkingTier({
      routes: [
        { task: 'LinguisticAnalysis', provider: 'OpenRouter', model: 'google/gemma-4-31b-it', usesTier: true },
        { task: 'Proofread', provider: 'Ollama', model: 'gemma4:12b', usesTier: false },
      ],
    }), 'en');

    const rows = fixture.debugElement.queryAll(By.css('[data-testid="ai-tier-routes"] .at-route'));
    expect(rows.length).toBe(2);
    expect(rows[0].nativeElement.textContent).toContain('Cloud');
    expect(rows[1].nativeElement.textContent).toContain('Local');
    expect(rows[1].nativeElement.textContent).toContain('gemma4:12b');
    expect(exists('ai-tier-fallback')).toBeFalse();
  });

  it('renders model ids left-to-right even inside the RTL layout', () => {
    mount(thinkingTier(), 'he');
    const model = fixture.debugElement.query(By.css('.at-route-model'));
    expect(model.attributes['dir']).toBe('ltr');
  });

  // ── Failure handling ────────────────────────────────────────────────────────

  it('surfaces a load failure with a retry rather than rendering an empty control', () => {
    service.get.and.returnValue(throwError(() => new Error('boom')));
    component.bookId = 'book-1';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    fixture.detectChanges();

    expect(exists('ai-tier-load-error')).toBeTrue();
    expect(exists('ai-tier-option-fast')).toBeFalse();
  });

  /**
   * A 409 means the server refused the tier between the read and the write. Saying "try again" would be
   * wrong advice, so the message says the tier is unavailable, and the control re-reads so it stops
   * offering an option the server will keep refusing.
   */
  it('explains a 409 refusal specifically and re-reads the server verdict', () => {
    mount(makeTier());
    service.set.and.returnValue(throwError(() => ({ status: 409 })));
    service.get.and.returnValue(of(makeTier({ thinkingReadiness: 'routeNotConfigured' })));

    component.requestThinking();
    component.confirmThinking();
    fixture.detectChanges();

    expect(text('ai-tier-save-error')).toBe(component.label('saveRejected'));
    expect(component.status!.thinkingReadiness).toBe('routeNotConfigured');
    expect((fixture.debugElement.query(By.css('[data-testid="ai-tier-option-thinking"]')).nativeElement as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the generic save error for a non-409 failure', () => {
    // Mounted on thinking (not fast) so chooseFast() is a genuine tier change, not a re-pick-the-current-tier
    // no-op - the aria-disabled guard added by f01 makes clicking the already-selected tier inert.
    mount(thinkingTier());
    service.set.and.returnValue(throwError(() => ({ status: 500 })));
    service.get.and.returnValue(of(makeTier()));

    component.chooseFast();
    fixture.detectChanges();

    expect(text('ai-tier-save-error')).toBe(component.label('saveError'));
  });

  it('re-reads when the book language changes, because the language changes the routes', () => {
    mount(makeTier(), 'he');
    expect(service.get).toHaveBeenCalledTimes(1);

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });
    expect(service.get).toHaveBeenCalledTimes(2);
  });

  // ── Same-key request supersession ───────────────────────────────────────────

  /**
   * The bookId guard is a context-CHANGE guard and does not cover two reads for the SAME book resolving out
   * of order. Every test in this block drives the reads with a `Subject` held OPEN across the assertions:
   * `of()` emits synchronously and would collapse the very window the defect lives in, so an `of()`-based
   * version of these tests passes against the un-fixed component and proves nothing.
   */
  it('shows the NEWER answer when two reads for the SAME book resolve out of order', () => {
    const stale = new Subject<BookAiTierDto>();
    const fresh = new Subject<BookAiTierDto>();
    service.get.and.returnValues(stale, fresh);

    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });

    // Same book, language changed: ngOnChanges re-enters reload() while the first read is still open.
    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    // The SECOND request answers first, then the abandoned FIRST answers afterwards.
    fresh.next(thinkingTier());
    stale.next(makeTier({ thinkingReadiness: 'routeNotConfigured' }));
    fixture.detectChanges();

    expect(component.status!.thinkingReadiness).toBe('ready');
    expect(component.status!.tier).toBe('thinking');
    // And the rendered routes list, which is the thing this surface exists to state truthfully.
    expect(text('ai-tier-routes')).toContain('google/gemma-4-31b-it');
    expect(text('ai-tier-routes')).not.toContain('gemma4:12b');
  });

  it('cancels the in-flight read when reload() re-enters for the SAME book', () => {
    const stale = new Subject<BookAiTierDto>();
    const fresh = new Subject<BookAiTierDto>();
    service.get.and.returnValues(stale, fresh);

    component.bookId = 'book-1';
    component.bookLanguage = 'he';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    expect(stale.observers.length).toBe(1);

    component.bookLanguage = 'en';
    component.ngOnChanges({ bookLanguage: new SimpleChange('he', 'en', false) });

    expect(stale.observers.length).toBe(0);
    expect(fresh.observers.length).toBe(1);
  });

  it('supersedes the post-failure re-read when the control reloads again', () => {
    mount(thinkingTier());
    service.set.and.returnValue(throwError(() => ({ status: 500 })));
    const reread = new Subject<BookAiTierDto>();
    const later = new Subject<BookAiTierDto>();
    service.get.and.returnValues(reread, later);

    component.chooseFast();
    expect(reread.observers.length).toBe(1);

    component.reload();
    expect(reread.observers.length).toBe(0);

    reread.next(makeTier({ thinkingReadiness: 'routeNotConfigured' }));
    later.next(thinkingTier());
    fixture.detectChanges();

    expect(component.status!.thinkingReadiness).toBe('ready');
  });

  /**
   * final-r02: the third supersession direction, which c01 left open. A read issued BEFORE a successful
   * write is older than the write's answer by construction, so it must not be allowed to repaint the
   * pre-write tier over it. Driven with a Subject held open across the write, never `of()`.
   */
  it('supersedes a read that was in flight when a write succeeds', () => {
    mount(makeTier());
    const overlapping = new Subject<BookAiTierDto>();
    service.get.and.returnValue(overlapping);
    const saved = new Subject<BookAiTierDto>();
    service.set.and.returnValue(saved);

    // A reload lands while the PUT is still open (a bookLanguage change does exactly this).
    component.requestThinking();
    component.confirmThinking();
    component.reload();
    expect(overlapping.observers.length).toBe(1);

    // The write answers first with the POST-write truth...
    saved.next(thinkingTier());
    // ...and the older read must no longer be listening, so its PRE-write snapshot cannot land.
    expect(overlapping.observers.length).toBe(0);
    overlapping.next(makeTier());
    fixture.detectChanges();

    expect(component.status!.tier).toBe('thinking');
    expect(text('ai-tier-routes')).toContain('google/gemma-4-31b-it');
  });

  /** Hygiene, not a crash fix: Angular 18 does not throw on a post-teardown detectChanges here. */
  it('leaves no active subscriber behind when destroyed with a read in flight', () => {
    const pending = new Subject<BookAiTierDto>();
    service.get.and.returnValue(pending);

    component.bookId = 'book-1';
    component.ngOnChanges({ bookId: new SimpleChange(null, 'book-1', true) });
    expect(pending.observers.length).toBe(1);

    fixture.destroy();

    expect(pending.observers.length).toBe(0);
  });

  it('does not call the server without a book id', () => {
    component.bookId = null;
    component.ngOnChanges({ bookId: new SimpleChange('book-1', null, false) });
    expect(service.get).not.toHaveBeenCalled();
  });
});
