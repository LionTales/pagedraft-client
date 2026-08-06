/**
 * character-register-editing c2: CharacterRegisterComponent spec.
 *
 * Covers what the todo enumerates:
 *  - every edit path (add, suppress, restore, edit gender, edit aliases, plus the two confirm-as-is paths);
 *  - the confirmed-vs-extracted rendering (the feature: text badges, not colour alone);
 *  - the never-built empty state (the server's hasRegister:false 200), kept distinct from "built and empty";
 *  - save-failure reconciliation (a rejected batch writes NOTHING, so the optimistic patch must roll back);
 *  - the server's answer winning over the client's optimistic guess even when they disagree;
 *  - RTL (Hebrew book) and LTR (English book), and he/en label parity with no em-dash.
 *
 * The in-flight window is observed with a held-open Subject, never a synchronous of().
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NEVER, Subject, of, throwError } from 'rxjs';
import {
  CHARACTER_REGISTER_LABELS_EN,
  CHARACTER_REGISTER_LABELS_HE,
  CharacterRegisterComponent,
  CharacterRegisterLabelKey,
} from './character-register.component';
import { CharacterRegisterService } from '../../core/services/character-register.service';
import {
  CharacterRegisterDto,
  CharacterRegisterEntryDto,
} from '../../core/models/character-register';

function makeEntry(overrides: Partial<CharacterRegisterEntryDto> = {}): CharacterRegisterEntryDto {
  return {
    name: 'Dana',
    gender: 'female',
    role: 'protagonist',
    description: null,
    aliases: ['Dan'],
    isCharacter: true,
    isAuthorAdded: false,
    genderConfirmed: false,
    aliasesConfirmed: false,
    isCharacterConfirmed: false,
    ...overrides,
  };
}

function makeRegister(overrides: Partial<CharacterRegisterDto> = {}): CharacterRegisterDto {
  return {
    bookId: 'book-1',
    hasRegister: true,
    updatedAt: '2026-08-05T09:00:00Z',
    characters: [makeEntry()],
    ...overrides,
  };
}

describe('CharacterRegisterComponent (character-register-editing c2)', () => {
  let component: CharacterRegisterComponent;
  let fixture: ComponentFixture<CharacterRegisterComponent>;
  let service: jasmine.SpyObj<CharacterRegisterService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj<CharacterRegisterService>('CharacterRegisterService', [
      'getRegister',
      'applyEdits',
    ]);
    service.getRegister.and.returnValue(NEVER);
    service.applyEdits.and.returnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [CharacterRegisterComponent],
      providers: [{ provide: CharacterRegisterService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(CharacterRegisterComponent);
    component = fixture.componentInstance;
  });

  /** Bind a book context and run the load, exactly as the host's input binding would. */
  function mount(bookId = 'book-1', language = 'he'): void {
    component.bookId = bookId;
    component.bookLanguage = language;
    component.ngOnChanges({
      bookId: new SimpleChange(null, bookId, true),
      bookLanguage: new SimpleChange(null, language, true),
    });
    fixture.detectChanges();
  }

  function el(testId: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return (el(testId)?.textContent ?? '').trim();
  }

  // ── Load + rendering ─────────────────────────────────────────────────────────

  it('loads the register for the bound book and renders each character', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ characters: [makeEntry(), makeEntry({ name: 'Noam' })] }))
    );
    mount();

    expect(service.getRegister).toHaveBeenCalledWith('book-1');
    expect(el('cr-row-Dana')).not.toBeNull();
    expect(el('cr-row-Noam')).not.toBeNull();
    expect(text('cr-row-Dana')).toContain('Dana');
  });

  // ── Duplicate entry names (fix-plan c02) ─────────────────────────────────────
  //
  // The server now collapses two entries for one character, so this pair is the DEGRADATION
  // guarantee: if a duplicate ever reaches the row surface anyway, it must render two ordinary rows
  // rather than warn on every change-detection pass and share one edit form between them.

  /** A register holding ONE character twice, which is what a legacy payload could deliver. */
  function duplicateRegister(): CharacterRegisterDto {
    return makeRegister({ characters: [makeEntry(), makeEntry({ gender: 'male' })] });
  }

  function rowsIn(testId: string): NodeListOf<Element> {
    return (fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="${testId}"] .cr-row`);
  }

  it('renders two same-named entries as two rows, with no NG0955 duplicate-track-key warning', () => {
    // Angular reports a duplicated track key as a console WARNING, not a throw, so the only way to
    // observe it is to watch console.warn. It fires on EVERY change-detection pass, hence the extra
    // passes below.
    const warn = spyOn(console, 'warn');
    service.getRegister.and.returnValue(of(duplicateRegister()));
    mount();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(rowsIn('cr-list').length).toBe(2);
    // Mapped to the warning TEXT, not the raw args, so a failure prints the NG0955 message that names
    // the defect instead of an opaque array length.
    const duplicateKeyWarnings = warn.calls
      .allArgs()
      .filter((args) => args.some((arg) => /NG0955/.test(String(arg))))
      .map((args) => String(args[0]));
    expect(duplicateKeyWarnings).toEqual([]);
  });

  it('editing one of two same-named rows opens the form on that row ONLY', () => {
    service.getRegister.and.returnValue(of(duplicateRegister()));
    mount();

    component.startEdit(component.activeCharacters[1]);
    fixture.detectChanges();

    expect(component.isEditing(component.activeCharacters[1])).toBeTrue();
    expect(component.isEditing(component.activeCharacters[0])).toBeFalse();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="cr-edit-Dana"]').length
    ).toBe(1);
    // The one draft belongs to the row that was opened. Two open forms would share it, so the author
    // would be editing the second row's value inside the first row's form.
    expect(component.genderDraft).toBe('male');
  });

  it('surfaces a load failure as an error state rather than an empty list', () => {
    service.getRegister.and.returnValue(throwError(() => new Error('boom')));
    mount();

    expect(el('cr-load-error')).not.toBeNull();
    expect(el('cr-list')).toBeNull();
    expect(text('cr-load-error')).toBe(CHARACTER_REGISTER_LABELS_HE.loadError);
  });

  it('a book switch through ngOnChanges cancels the in-flight load, so its response reaches nobody', () => {
    // RENAMED (fix-plan c03). This spec used to be called "drops a register response that arrives
    // after the book context changed" and claimed to cover the `if (this.bookId !== bookId) return;`
    // guard in the load's next handler. It never did, and it CANNOT: `ngOnChanges` calls
    // `resetView()`, which unsubscribes `loadSub` BEFORE `load()` re-subscribes, so `late.next(...)`
    // below reaches no subscriber at all and the guard is never entered. Proven by mutation: with
    // that guard deleted from the component, this spec stayed green.
    //
    // What it DOES pin, and what it is now named for, is the teardown: a book switch cancels the
    // in-flight read. The guard itself is covered by the four specs immediately below.
    const late = new Subject<CharacterRegisterDto>();
    // Distinct observables per call: the book-2 load must NOT share the book-1 channel.
    service.getRegister.and.returnValues(late, NEVER);
    mount('book-1');
    expect(late.observed).withContext('the book-1 read should be live before the switch').toBeTrue();

    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });

    expect(late.observed)
      .withContext('the book switch left the book-1 read subscribed')
      .toBeFalse();

    late.next(makeRegister({ bookId: 'book-1' }));
    fixture.detectChanges();

    // The book-1 answer must not paint over the book-2 view.
    expect(component.characters.length).toBe(0);
  });

  // ── The bookId guard: an answer is accepted only for the book it was requested for ────────────
  //
  // There are FOUR copies of `if (this.bookId !== bookId) return;` in the component (the load's next
  // and error handlers, and the save's next and error handlers). Reaching any of them needs exactly
  // one state: a subscription that is still LIVE, opened for book-1, while `this.bookId` already
  // reads book-2.
  //
  // Going through `ngOnChanges` cannot produce that state, for either pair. `resetView()`
  // unsubscribes BOTH `loadSub` and `saveSub` before anything else happens, so a value emitted
  // afterwards reaches no subscriber and no guard is entered. That is precisely why the spec above
  // could not fail against a deleted guard, and why writing the save pair through `ngOnChanges`
  // would be vacuous in the same way even though `save()` itself never calls `resetView()`.
  //
  // So these four specs assign `component.bookId` DIRECTLY. That is the field the guard reads, and
  // it is also how the state arises for real: Angular writes an `@Input` as a plain property
  // assignment and only afterwards calls `ngOnChanges`, so between those two steps the component
  // genuinely holds the new `bookId` alongside the old, still-live subscription. Nothing async can
  // be observed inside that window in today's host, which is what makes the guard defence in depth
  // rather than live behaviour; assigning the field reproduces the state the guard was written for
  // without depending on a single change-detection pass to interleave.
  //
  // Each spec is revert-verified against its OWN copy of the guard, not against the set.

  it('load next: drops a register answer for a book that is no longer the bound one', () => {
    const late = new Subject<CharacterRegisterDto>();
    service.getRegister.and.returnValue(late);
    mount('book-1');
    expect(late.observed).withContext('the book-1 read must still be live').toBeTrue();

    component.bookId = 'book-2';
    late.next(makeRegister({ bookId: 'book-1', characters: [makeEntry({ name: 'Dana' })] }));
    fixture.detectChanges();

    expect(component.characters.map((c) => c.name))
      .withContext("book-1's register was painted onto the book-2 view")
      .toEqual([]);
    expect(component.register)
      .withContext("book-1's register became the book-2 view's server truth")
      .toBeNull();
  });

  it('load error: drops a load failure for a book that is no longer the bound one', () => {
    const late = new Subject<CharacterRegisterDto>();
    service.getRegister.and.returnValue(late);
    mount('book-1');
    expect(late.observed).withContext('the book-1 read must still be live').toBeTrue();

    component.bookId = 'book-2';
    late.error(new Error('boom'));
    fixture.detectChanges();

    expect(component.loadError)
      .withContext("book-1's load failure raised the error state on the book-2 view")
      .toBeFalse();
    expect(el('cr-load-error')).toBeNull();
  });

  it('save next: drops a PATCH answer for a book that is no longer the bound one', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount('book-1');

    const pending = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(pending);
    component.suppress(component.characters[0]);
    fixture.detectChanges();
    expect(pending.observed).withContext('the book-1 PATCH must still be live').toBeTrue();

    component.bookId = 'book-2';
    // A register the book-2 view could not possibly have asked for: the answer to book-1's batch.
    pending.next(makeRegister({ bookId: 'book-1', characters: [makeEntry({ name: 'Noam' })] }));
    fixture.detectChanges();

    expect(component.characters.map((c) => c.name))
      .withContext("book-1's PATCH answer replaced the working copy after the context changed")
      .toEqual(['Dana']);
    expect(component.saving)
      .withContext("book-1's PATCH answer resolved the in-flight save on the book-2 view")
      .toBeTrue();
  });

  it('save error: drops a PATCH failure for a book that is no longer the bound one', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount('book-1');

    const failing = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(failing);
    component.suppress(component.characters[0]);
    fixture.detectChanges();
    expect(failing.observed).withContext('the book-1 PATCH must still be live').toBeTrue();
    // The optimistic patch that the rejected-batch rollback would undo.
    expect(component.characters[0].isCharacter).toBeFalse();

    component.bookId = 'book-2';
    failing.error(new Error('400'));
    fixture.detectChanges();

    expect(component.saveError)
      .withContext("book-1's PATCH failure raised the save-failure banner on the book-2 view")
      .toBeFalse();
    expect(el('cr-save-error')).toBeNull();
    expect(component.characters[0].isCharacter)
      .withContext("book-1's rollback rewrote the working copy after the context changed")
      .toBeFalse();
  });

  it('cancelling an in-flight load by switching to no book lowers loading, not leaving it stuck', () => {
    const held = new Subject<CharacterRegisterDto>();
    service.getRegister.and.returnValue(held);
    mount('book-1');

    expect(component.loading).toBeTrue();
    expect(el('cr-loading')).not.toBeNull();

    // Switching to no book cancels the in-flight read via resetView()'s unsubscribe, then load()
    // early-returns without ever reaching a next/error handler that could lower `loading` itself.
    component.bookId = null;
    component.ngOnChanges({ bookId: new SimpleChange('book-1', null, false) });
    fixture.detectChanges();

    expect(component.loading).toBeFalse();
    expect(el('cr-loading')).toBeNull();
  });

  // ── Confirmed vs extracted: the feature ──────────────────────────────────────

  it('renders an author-CONFIRMED value and an EXTRACTED (guessed) value differently, in text', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          characters: [
            makeEntry({ name: 'Dana', genderConfirmed: true, aliasesConfirmed: false }),
          ],
        })
      )
    );
    mount();

    // Confirmed gender: a "Confirmed" badge and no invitation to confirm it again.
    expect(text('cr-gender-confirmed-Dana')).toContain(CHARACTER_REGISTER_LABELS_HE.badgeConfirmed);
    expect(el('cr-gender-extracted-Dana')).toBeNull();
    expect(el('cr-confirm-gender-Dana')).toBeNull();
    expect(el('cr-gender-Dana')!.classList).toContain('cr-confirmed');

    // Guessed aliases: a "Guessed" badge plus the confirm-as-is affordance.
    expect(text('cr-aliases-extracted-Dana')).toContain(CHARACTER_REGISTER_LABELS_HE.badgeExtracted);
    expect(el('cr-aliases-confirmed-Dana')).toBeNull();
    expect(el('cr-confirm-aliases-Dana')).not.toBeNull();
    expect(el('cr-aliases-Dana')!.classList).toContain('cr-extracted');
  });

  it('flags an entry the author added by hand', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ name: 'Dana', isAuthorAdded: true })] }))
    );
    mount();

    expect(text('cr-author-added-Dana')).toBe(CHARACTER_REGISTER_LABELS_HE.badgeAuthorAdded);
  });

  it('counts the entries still carrying a guessed value so the author knows where to look', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          characters: [
            makeEntry({ name: 'Dana', genderConfirmed: true, aliasesConfirmed: true }),
            makeEntry({ name: 'Noam', genderConfirmed: false, aliasesConfirmed: true }),
          ],
        })
      )
    );
    mount();

    expect(component.unconfirmedCount).toBe(1);
    expect(text('cr-attention')).toContain(CHARACTER_REGISTER_LABELS_HE.attentionSome);
  });

  it('renders the register stamp through the timezone-aware helper, never a raw date pipe', () => {
    service.getRegister.and.returnValue(of(makeRegister({ updatedAt: new Date().toISOString() })));
    mount();

    // "just now" in Hebrew: the relative-time helper's output, not an ISO string.
    expect(text('cr-updated')).toContain('הרגע');
    expect(text('cr-updated')).not.toContain('T');
  });

  // ── Empty states ─────────────────────────────────────────────────────────────

  it('explains a NEVER-BUILT register instead of rendering a blank list that reads as "no characters"', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ hasRegister: false, updatedAt: null, characters: [] }))
    );
    mount();

    expect(component.neverBuilt).toBeTrue();
    expect(el('cr-empty-never-built')).not.toBeNull();
    expect(text('cr-empty-never-built')).toContain(CHARACTER_REGISTER_LABELS_HE.emptyNeverBuiltTitle);
    expect(text('cr-empty-never-built')).toContain(CHARACTER_REGISTER_LABELS_HE.emptyNeverBuiltBody);
    expect(el('cr-list')).toBeNull();
    expect(el('cr-empty-built')).toBeNull();
    // The author can still seed the register by hand from the empty state.
    expect(el('cr-add-open')).not.toBeNull();
  });

  it('distinguishes "built but holds no characters" from "never built"', () => {
    service.getRegister.and.returnValue(of(makeRegister({ hasRegister: true, characters: [] })));
    mount();

    expect(component.neverBuilt).toBeFalse();
    expect(component.builtButEmpty).toBeTrue();
    expect(el('cr-empty-never-built')).toBeNull();
    expect(text('cr-empty-built')).toBe(CHARACTER_REGISTER_LABELS_HE.emptyBuiltNoCharacters);
  });

  // ── Edit paths ───────────────────────────────────────────────────────────────

  it('edit gender: sends ONLY the gender and reconciles from the server answer', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.startEdit(component.characters[0]);
    component.genderDraft = 'male';
    fixture.detectChanges();

    const answer = makeRegister({
      characters: [makeEntry({ gender: 'male', genderConfirmed: true })],
    });
    service.applyEdits.and.returnValue(of(answer));
    component.saveEdit(component.characters[0]);
    fixture.detectChanges();

    // Aliases were untouched, so they must be ABSENT: on this contract a PRESENT field also CONFIRMS,
    // and confirming a field the author never looked at is exactly what d1 forbids.
    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [
      { name: 'Dana', op: 'upsert', gender: 'male' },
    ]);
    expect(component.characters[0].gender).toBe('male');
    expect(component.characters[0].genderConfirmed).toBeTrue();
    expect(component.editingEntry).toBeNull();
    expect(text('cr-gender-confirmed-Dana')).toContain(CHARACTER_REGISTER_LABELS_HE.badgeConfirmed);
  });

  it('edit gender: an emptied gender is sent as "" (clear but CONFIRM), never omitted', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.startEdit(component.characters[0]);
    component.genderDraft = '';
    service.applyEdits.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ gender: null, genderConfirmed: true })] }))
    );
    component.saveEdit(component.characters[0]);

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [
      { name: 'Dana', op: 'upsert', gender: '' },
    ]);
  });

  it('edit aliases: sends ONLY the aliases, comma-split and trimmed', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.startEdit(component.characters[0]);
    component.aliasesDraft = ' Dan ,  Danny , ';
    const answer = makeRegister({
      characters: [makeEntry({ aliases: ['Dan', 'Danny'], aliasesConfirmed: true })],
    });
    service.applyEdits.and.returnValue(of(answer));
    component.saveEdit(component.characters[0]);
    fixture.detectChanges();

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [
      { name: 'Dana', op: 'upsert', aliases: ['Dan', 'Danny'] },
    ]);
    expect(component.characters[0].aliases).toEqual(['Dan', 'Danny']);
    expect(text('cr-aliases-Dana')).toContain('Dan, Danny');
  });

  it('edit with nothing changed issues NO request, and SAYS so instead of closing silently', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.startEdit(component.characters[0]);
    component.saveEdit(component.characters[0]);
    fixture.detectChanges();

    expect(service.applyEdits).not.toHaveBeenCalled();
    expect(component.editingEntry).toBeNull();

    // The value must still read as a GUESS: refusing to auto-confirm an untouched field is d1 §1.
    expect(component.characters[0].genderConfirmed).toBeFalse();
    expect(el('cr-gender-confirmed-Dana')).toBeNull();

    // ...but a silent close would read as "confirmed" to the author. Say what happened, and point at
    // the affordance that actually confirms.
    expect(text('cr-no-change-hint')).toContain(CHARACTER_REGISTER_LABELS_HE.nothingChanged);
  });

  it('the no-change hint is cleared by the next edit, and is not an error banner', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.startEdit(component.characters[0]);
    component.saveEdit(component.characters[0]);
    fixture.detectChanges();
    expect(component.noChangeHint).toBeTrue();
    // A no-op is not a failure: it must not raise the save-failure banner.
    expect(el('cr-save-error')).toBeNull();

    component.startEdit(component.characters[0]);
    fixture.detectChanges();
    expect(component.noChangeHint).toBeFalse();
    expect(el('cr-no-change-hint')).toBeNull();
  });

  it('a no-change hint raised on one book does not leak onto the next book switched to', () => {
    service.getRegister.and.returnValue(of(makeRegister({ bookId: 'book-1' })));
    mount('book-1');

    component.startEdit(component.characters[0]);
    component.saveEdit(component.characters[0]);
    fixture.detectChanges();
    expect(component.noChangeHint).toBeTrue();
    expect(el('cr-no-change-hint')).not.toBeNull();

    // Switch to a different book. The hint was about book-1's untouched edit; it says nothing about
    // book-2's freshly loaded register and must not render above it.
    service.getRegister.and.returnValue(of(makeRegister({ bookId: 'book-2' })));
    component.bookId = 'book-2';
    component.ngOnChanges({ bookId: new SimpleChange('book-1', 'book-2', false) });
    fixture.detectChanges();

    expect(component.noChangeHint).toBeFalse();
    expect(el('cr-no-change-hint')).toBeNull();
  });

  it('confirm-as-is sends the SAME gender value back, which is what confirms it', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    service.applyEdits.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ genderConfirmed: true })] }))
    );
    (el('cr-confirm-gender-Dana') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [
      { name: 'Dana', op: 'upsert', gender: 'female' },
    ]);
    expect(component.characters[0].genderConfirmed).toBeTrue();
  });

  it('confirm-as-is sends the SAME alias list back', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    service.applyEdits.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ aliasesConfirmed: true })] }))
    );
    (el('cr-confirm-aliases-Dana') as HTMLButtonElement).click();

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [
      { name: 'Dana', op: 'upsert', aliases: ['Dan'] },
    ]);
  });

  it('mark-not-a-character suppresses (never deletes) and the entry stays visible and restorable', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    service.applyEdits.and.returnValue(
      of(
        makeRegister({
          characters: [makeEntry({ isCharacter: false, isCharacterConfirmed: true })],
        })
      )
    );
    (el('cr-suppress-Dana') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [{ name: 'Dana', op: 'suppress' }]);
    expect(el('cr-row-Dana')).toBeNull();
    expect(el('cr-suppressed')).not.toBeNull();
    expect(el('cr-suppressed-row-Dana')).not.toBeNull();
    expect(el('cr-restore-Dana')).not.toBeNull();
  });

  it('restore puts a suppressed entry back into the character list', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          characters: [makeEntry({ isCharacter: false, isCharacterConfirmed: true })],
        })
      )
    );
    mount();

    service.applyEdits.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ isCharacter: true, isCharacterConfirmed: true })] }))
    );
    (el('cr-restore-Dana') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [{ name: 'Dana', op: 'restore' }]);
    expect(el('cr-row-Dana')).not.toBeNull();
    expect(el('cr-suppressed')).toBeNull();
  });

  it('add character: upserts with the optional fields it was given, and renders only the SERVER answer', () => {
    service.getRegister.and.returnValue(of(makeRegister({ hasRegister: false, characters: [] })));
    mount();

    component.openAdd();
    component.addName = '  Yael  ';
    component.addGender = 'female';
    component.addAliases = 'Yaeli';
    fixture.detectChanges();

    const pending = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(pending);
    (el('cr-add-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.applyEdits).toHaveBeenCalledWith('book-1', [
      { name: 'Yael', op: 'upsert', gender: 'female', aliases: ['Yaeli'] },
    ]);
    // NOT optimistic: whether that name creates an entry or matches an existing one through the
    // server's alias fallback is the server's decision, so nothing is rendered until it answers.
    expect(component.characters.length).toBe(0);

    pending.next(
      makeRegister({
        hasRegister: true,
        characters: [makeEntry({ name: 'Yael', aliases: ['Yaeli'], isAuthorAdded: true })],
      })
    );
    fixture.detectChanges();

    expect(el('cr-row-Yael')).not.toBeNull();
    expect(component.addOpen).toBeFalse();
  });

  it('add character: a blank name is refused locally and issues no request', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.openAdd();
    component.addName = '   ';
    fixture.detectChanges();
    (el('cr-add-submit') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service.applyEdits).not.toHaveBeenCalled();
    expect(text('cr-add-name-error')).toBe(CHARACTER_REGISTER_LABELS_HE.addNameRequired);
  });

  // ── Optimistic-update discipline ─────────────────────────────────────────────

  it('reconciles against the SERVER answer even when it disagrees with the optimistic patch', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    const pending = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(pending);
    component.suppress(component.characters[0]);
    fixture.detectChanges();

    // Optimistically suppressed while in flight.
    expect(component.characters[0].isCharacter).toBeFalse();

    // The server disagrees: Dana is still a character, and it knows about someone the client did not.
    pending.next(
      makeRegister({
        characters: [makeEntry({ name: 'Dana' }), makeEntry({ name: 'Noam' })],
      })
    );
    fixture.detectChanges();

    expect(component.characters.map((c) => c.name)).toEqual(['Dana', 'Noam']);
    expect(component.characters[0].isCharacter).toBeTrue();
    expect(el('cr-row-Noam')).not.toBeNull();
    expect(component.saveError).toBeFalse();
  });

  it('a failed save rolls back to the server truth and says so, leaving no rejected edit on screen', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    const failing = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(failing);
    component.suppress(component.characters[0]);
    fixture.detectChanges();
    expect(component.characters[0].isCharacter).toBeFalse();

    // A rejected batch writes NOTHING server-side, so any partially-applied UI state would be a lie.
    failing.error(new Error('400'));
    fixture.detectChanges();

    expect(component.characters[0].isCharacter).toBeTrue();
    expect(component.characters[0].isCharacterConfirmed).toBeFalse();
    expect(el('cr-row-Dana')).not.toBeNull();
    expect(el('cr-suppressed')).toBeNull();
    expect(component.saveError).toBeTrue();
    expect(text('cr-save-error')).toBe(CHARACTER_REGISTER_LABELS_HE.saveFailed);
  });

  it('a failed gender edit leaves the previous value on screen, not the rejected one', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    component.startEdit(component.characters[0]);
    component.genderDraft = 'male';
    const failing = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(failing);
    component.saveEdit(component.characters[0]);
    fixture.detectChanges();
    expect(component.characters[0].gender).toBe('male');

    failing.error(new Error('500'));
    fixture.detectChanges();

    expect(component.characters[0].gender).toBe('female');
    expect(component.characters[0].genderConfirmed).toBeFalse();
    expect(component.saveError).toBeTrue();
  });

  it('tracks the derived active/suppressed lists through an optimistic suppress and its rollback', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ name: 'Dana' }), makeEntry({ name: 'Noam' })] }))
    );
    mount();

    expect(component.activeCharacters.map((c) => c.name)).toEqual(['Dana', 'Noam']);
    expect(component.suppressedCharacters.length).toBe(0);

    const pending = new Subject<CharacterRegisterDto>();
    service.applyEdits.and.returnValue(pending);
    component.suppress(component.characters[0]);
    fixture.detectChanges();

    // Mid-flight: the optimistic patch already moved Dana out of active and into suppressed.
    expect(component.activeCharacters.map((c) => c.name)).toEqual(['Noam']);
    expect(component.suppressedCharacters.map((c) => c.name)).toEqual(['Dana']);
    expect(el('cr-row-Dana')).toBeNull();
    expect(el('cr-suppressed-row-Dana')).not.toBeNull();

    // The server rejects the batch: it wrote nothing, so the derived lists must roll back with the
    // raw list, not just `characters` itself.
    pending.error(new Error('400'));
    fixture.detectChanges();

    expect(component.activeCharacters.map((c) => c.name)).toEqual(['Dana', 'Noam']);
    expect(component.suppressedCharacters.length).toBe(0);
    expect(el('cr-row-Dana')).not.toBeNull();
    expect(el('cr-suppressed')).toBeNull();
  });

  it('disables every edit affordance while a save is in flight, and labels the pending button', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    service.applyEdits.and.returnValue(NEVER);
    component.suppress(component.characters[0]);
    fixture.detectChanges();

    expect(component.saving).toBeTrue();
    const buttons = fixture.debugElement
      .queryAll(By.css('button'))
      .map((b) => b.nativeElement as HTMLButtonElement);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBeTrue();
  });

  it('clears a previous save failure when the next save succeeds', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount();

    service.applyEdits.and.returnValue(throwError(() => new Error('400')));
    component.suppress(component.characters[0]);
    expect(component.saveError).toBeTrue();

    service.applyEdits.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ isCharacter: false, isCharacterConfirmed: true })] }))
    );
    component.suppress(component.characters[0]);
    fixture.detectChanges();

    expect(component.saveError).toBeFalse();
    expect(el('cr-save-error')).toBeNull();
  });

  // ── Direction + i18n ─────────────────────────────────────────────────────────

  it('renders RTL Hebrew chrome for a Hebrew book', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ characters: [makeEntry({ name: 'דנה', aliases: ['דן'] })] }))
    );
    mount('book-1', 'he');

    const root = el('character-register')!;
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(component.dir).toBe('rtl');
    expect(root.textContent).toContain(CHARACTER_REGISTER_LABELS_HE.title);
    expect(root.textContent).toContain('דנה');
  });

  it('renders LTR English chrome for an English book', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount('book-1', 'en');

    const root = el('character-register')!;
    expect(root.getAttribute('dir')).toBe('ltr');
    expect(component.dir).toBe('ltr');
    expect(root.textContent).toContain(CHARACTER_REGISTER_LABELS_EN.title);
    expect(text('cr-gender-Dana')).toContain(CHARACTER_REGISTER_LABELS_EN.genderFemale);
  });

  it('falls back to Hebrew chrome for a book in some third language', () => {
    service.getRegister.and.returnValue(of(makeRegister()));
    mount('book-1', 'fr');

    expect(component.langKey).toBe('he');
    expect(component.dir).toBe('rtl');
  });

  it('keeps he/en label parity and uses no em-dash in any user-facing string', () => {
    const heKeys = Object.keys(CHARACTER_REGISTER_LABELS_HE).sort();
    const enKeys = Object.keys(CHARACTER_REGISTER_LABELS_EN).sort();
    expect(heKeys).toEqual(enKeys);

    for (const key of heKeys as CharacterRegisterLabelKey[]) {
      expect(CHARACTER_REGISTER_LABELS_HE[key].length).toBeGreaterThan(0);
      expect(CHARACTER_REGISTER_LABELS_EN[key].length).toBeGreaterThan(0);
      expect(CHARACTER_REGISTER_LABELS_HE[key]).not.toContain('—');
      expect(CHARACTER_REGISTER_LABELS_EN[key]).not.toContain('—');
    }
  });

  it('localizes a non-standard stored gender by echoing it rather than blanking it', () => {
    expect(component.genderLabel('nonbinary')).toBe('nonbinary');
    expect(component.genderChoicesFor('nonbinary')).toContain('nonbinary');
    expect(component.genderChoicesFor('male')).toEqual(['male', 'female', 'unknown']);
  });
});
