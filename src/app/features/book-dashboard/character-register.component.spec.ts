/**
 * character-register-editing c2: CharacterRegisterComponent spec.
 *
 * Covers what the todo enumerates:
 *  - every edit path (add, suppress, restore, edit gender, edit aliases, plus the two confirm-as-is paths);
 *  - the confirmed-vs-extracted rendering (the feature: text badges, not colour alone);
 *  - the never-built empty state (the server's hasRegister:false 200), kept distinct from "built and empty";
 *  - the coverage line (automatic-coverage c01): the SERVER's counts, the four states it can report,
 *    and that no number on it can be produced from the character list;
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
  CharacterRegisterCoverageDto,
  CharacterRegisterDto,
  CharacterRegisterEntryDto,
} from '../../core/models/character-register';

/**
 * A coverage block. The default is the ordinary mid-book state (partly covered, still growing), which
 * is what most specs want in the background. The server guarantees
 * `covered + pending + stale + unscannable === total`, so every override below keeps that sum.
 */
function makeCoverage(
  overrides: Partial<CharacterRegisterCoverageDto> = {}
): CharacterRegisterCoverageDto {
  return {
    totalChapters: 40,
    coveredChapters: 3,
    pendingChapters: 37,
    staleChapters: 0,
    unscannableChapters: 0,
    isComplete: false,
    lastScannedAt: '2026-08-05T09:00:00Z',
    ...overrides,
  };
}

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
    coverage: makeCoverage(),
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
      of(
        makeRegister({
          hasRegister: false,
          updatedAt: null,
          characters: [],
          // The server sends coverage on the never-built state too, and it reads "0 of 40".
          coverage: makeCoverage({
            coveredChapters: 0,
            pendingChapters: 40,
            lastScannedAt: null,
          }),
        })
      )
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

    // The coverage line joins the never-built state rather than replacing it: "0 of 40" is the honest
    // answer here, and nothing has been scanned yet so there is no last-read stamp to show.
    expect(text('cr-coverage-counts')).toBe('פרקים שהמאגר משקף: 0 מתוך 40.');
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageGrows);
    expect(el('cr-coverage-scanned')).toBeNull();
  });

  it('distinguishes "built but holds no characters" from "never built"', () => {
    service.getRegister.and.returnValue(of(makeRegister({ hasRegister: true, characters: [] })));
    mount();

    expect(component.neverBuilt).toBeFalse();
    expect(component.builtButEmpty).toBeTrue();
    expect(el('cr-empty-never-built')).toBeNull();
    expect(text('cr-empty-built')).toBe(CHARACTER_REGISTER_LABELS_HE.emptyBuiltNoCharacters);
  });

  it('says the register is ALL SUPPRESSED rather than claiming every value is confirmed', () => {
    // The attention line counts over the ACTIVE list, so an all-suppressed register scored zero
    // unconfirmed values and rendered "every value has been confirmed by you" above an empty list -
    // a claim about editable values the author never confirmed. Neither existing empty state covers
    // this: the register HAS been built and it DOES hold entries.
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          hasRegister: true,
          characters: [
            makeEntry({ name: 'Dana', isCharacter: false, isCharacterConfirmed: true }),
            makeEntry({ name: 'Noam', isCharacter: false, isCharacterConfirmed: true }),
          ],
        })
      )
    );
    mount();

    expect(component.neverBuilt).toBeFalse();
    expect(component.builtButEmpty).toBeFalse();
    expect(component.activeCharacters.length).toBe(0);
    expect(text('cr-empty-all-suppressed')).toBe(CHARACTER_REGISTER_LABELS_HE.emptyAllSuppressed);
    expect(el('cr-attention')).toBeNull();

    // The way out of the state stays on screen: both names are still listed as suppressed, each with
    // its Restore.
    expect(el('cr-suppressed')).not.toBeNull();
    expect(el('cr-restore-Dana')).not.toBeNull();
    expect(el('cr-restore-Noam')).not.toBeNull();
  });

  it('still shows the attention line when even ONE character is active', () => {
    // The guard is "no active entries", not "any entry is suppressed" - a register with one of each
    // must keep counting.
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          characters: [
            makeEntry({ name: 'Dana' }),
            makeEntry({ name: 'Noam', isCharacter: false, isCharacterConfirmed: true }),
          ],
        })
      )
    );
    mount();

    expect(el('cr-empty-all-suppressed')).toBeNull();
    expect(text('cr-attention')).toContain(CHARACTER_REGISTER_LABELS_HE.attentionSome);
    expect(text('cr-attention')).toContain('1');
  });

  // ── Coverage: how much of the book the register reflects (automatic-coverage c01) ─────────────
  //
  // The line is a statement of FACT, not a control panel: it says how much of the book the register
  // reflects and that it fills in one chapter at a time, as the author runs the analyses that read
  // the register. It must never read as "nearly done", and there is deliberately no scan button to
  // assert the absence of.

  it('renders the coverage the SERVER reported, and says the register is still filling in', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ coverage: makeCoverage({ coveredChapters: 3, pendingChapters: 37 }) }))
    );
    mount();

    expect(el('cr-coverage')).not.toBeNull();
    expect(text('cr-coverage-counts')).toBe('פרקים שהמאגר משקף: 3 מתוך 40.');
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageGrows);
    // Not complete, so it must not claim every chapter contributed.
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coverageComplete);
    // ...and it is NOT the pre-ledger state: three chapters have contributed. This is the cell the
    // pre-ledger branch is most likely to steal, so the exclusion is asserted rather than assumed.
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coveragePreLedger);
    // A quiet line of fact, not an instruction: nothing here offers to trigger a scan.
    expect(el('cr-coverage')!.querySelectorAll('button').length).toBe(0);
  });

  it('reports the SERVER coverage even when the character list would suggest another number', () => {
    // The anti-derivation assertion. The character list answers "who was found", coverage answers
    // "which chapters were read", and inferring one from the other is exactly the defect this pins:
    // seven characters are on screen while the server says three chapters of forty have contributed,
    // and 3/40 is what must be rendered. A client-side count of characters (7), of rows, or of
    // anything else in `characters` cannot produce this line.
    const many = ['Dana', 'Noam', 'Yael', 'Gil', 'Roni', 'Tal', 'Adi'].map((name) =>
      makeEntry({ name })
    );
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          characters: many,
          coverage: makeCoverage({ coveredChapters: 3, pendingChapters: 37 }),
        })
      )
    );
    mount();

    expect(component.activeCharacters.length).toBe(7);
    expect(text('cr-coverage-counts')).toBe('פרקים שהמאגר משקף: 3 מתוך 40.');
    expect(component.coverage).toBe(component.register!.coverage);
  });

  it('says every chapter that holds text has contributed once the server calls coverage complete', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          coverage: makeCoverage({
            coveredChapters: 40,
            pendingChapters: 0,
            isComplete: true,
          }),
        })
      )
    );
    mount();

    expect(text('cr-coverage-counts')).toBe('פרקים שהמאגר משקף: 40 מתוך 40.');
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageComplete);
    // ...and stops saying it is still filling in.
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coverageGrows);
  });

  it('a book whose chapters are ALL unscannable reads as nothing to read, never as fully covered', () => {
    // The server calls this state COMPLETE with zero covered (there is genuinely nothing left to
    // scan). Rendering the ordinary complete sentence here would claim every chapter contributed to a
    // register that read no chapter at all.
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          coverage: makeCoverage({
            totalChapters: 3,
            coveredChapters: 0,
            pendingChapters: 0,
            unscannableChapters: 3,
            isComplete: true,
            lastScannedAt: null,
          }),
        })
      )
    );
    mount();

    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageNothingToRead);
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coverageComplete);
    // Zero covered and zero stale describes this state too, so the pre-ledger branch must not reach
    // it: nothing here will EVER be counted, and "counted from here on" would be a false promise.
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coveragePreLedger);
    expect(text('cr-coverage-counts')).toBe('פרקים שהמאגר משקף: 0 מתוך 3.');
    expect(text('cr-coverage-unscannable')).toBe('פרקים שאין בהם טקסט לקריאה: 3.');
  });

  it('a book with no chapters says so instead of counting "0 of 0"', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          coverage: makeCoverage({
            totalChapters: 0,
            coveredChapters: 0,
            pendingChapters: 0,
            isComplete: false,
            lastScannedAt: null,
          }),
        })
      )
    );
    mount();

    expect(el('cr-coverage-counts')).toBeNull();
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageNoChapters);
    // A book with no chapters also has zero covered and zero stale. The no-chapters test runs FIRST
    // for exactly that reason, so the pre-ledger sentence must not appear here.
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coveragePreLedger);
  });

  it('names stale and unscannable chapters only when the server reports some', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          coverage: makeCoverage({
            totalChapters: 40,
            coveredChapters: 30,
            pendingChapters: 7,
            staleChapters: 2,
            unscannableChapters: 1,
          }),
        })
      )
    );
    mount();

    expect(text('cr-coverage-stale')).toContain('2');
    expect(text('cr-coverage-stale')).toContain('פרקים שהשתנו מאז שנקראו');
    expect(text('cr-coverage-unscannable')).toBe('פרקים שאין בהם טקסט לקריאה: 1.');
  });

  it('omits the stale and unscannable clauses when both are zero', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ coverage: makeCoverage({ staleChapters: 0, unscannableChapters: 0 }) }))
    );
    mount();

    expect(el('cr-coverage-stale')).toBeNull();
    expect(el('cr-coverage-unscannable')).toBeNull();
  });

  it('renders the last-read stamp through the timezone-aware helper, never a raw date pipe', () => {
    service.getRegister.and.returnValue(
      of(makeRegister({ coverage: makeCoverage({ lastScannedAt: new Date().toISOString() }) }))
    );
    mount();

    expect(text('cr-coverage-scanned')).toContain(CHARACTER_REGISTER_LABELS_HE.coverageLastScanned);
    expect(text('cr-coverage-scanned')).toContain('הרגע');
    expect(text('cr-coverage-scanned')).not.toContain('T');
  });

  it('renders the English coverage copy for an English book', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          coverage: makeCoverage({
            coveredChapters: 3,
            pendingChapters: 36,
            staleChapters: 1,
            unscannableChapters: 0,
          }),
        })
      )
    );
    mount('book-1', 'en');

    expect(text('cr-coverage-counts')).toBe('Chapters reflected in the register: 3 of 40.');
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_EN.coverageGrows);
    expect(text('cr-coverage-stale')).toContain('Chapters changed since they were read: 1.');
    expect(text('cr-coverage-scanned')).toContain(CHARACTER_REGISTER_LABELS_EN.coverageLastScanned);
    expect(el('character-register')!.getAttribute('dir')).toBe('ltr');
  });

  // ── The pre-ledger state (coverage-fixes c01) ──────────────────────────────────────────────────
  //
  // The scan ledger is newer than the registers it counts, so EVERY register that predates it reports
  // zero covered chapters while listing the characters it found in that very book. Reproduced from the
  // real Hebrew book that exposed it: hasRegister true, nine characters, 0 of 80 covered, nothing
  // stale. Without its own sentence the card understates itself to zero with the contradicting
  // evidence rendered a few lines below.

  it('a register that exists with an EMPTY ledger says nothing has been counted yet, not just "it fills in"', () => {
    const nine = ['Dana', 'Noam', 'Yael', 'Gil', 'Roni', 'Tal', 'Adi', 'Omer', 'Shira'].map((name) =>
      makeEntry({ name })
    );
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          hasRegister: true,
          characters: nine,
          coverage: makeCoverage({
            totalChapters: 80,
            coveredChapters: 0,
            pendingChapters: 80,
            staleChapters: 0,
            unscannableChapters: 0,
            isComplete: false,
            lastScannedAt: null,
          }),
        })
      )
    );
    mount();

    // The server's own numbers still render unchanged: this fix explains the zero, it does not hide it.
    expect(text('cr-coverage-counts')).toBe('פרקים שהמאגר משקף: 0 מתוך 80.');
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coveragePreLedger);
    // The generic sentence would leave "0 of 80" standing beside nine characters found in this book.
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coverageGrows);
    // Chosen from SERVER fields only. Nine characters are on screen and none of them picked the branch.
    expect(component.activeCharacters.length).toBe(9);
  });

  it('renders the English pre-ledger sentence for an English book', () => {
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          hasRegister: true,
          characters: [makeEntry({ name: 'Mira' }), makeEntry({ name: 'Devlin' })],
          coverage: makeCoverage({
            totalChapters: 1,
            coveredChapters: 0,
            pendingChapters: 1,
            staleChapters: 0,
            unscannableChapters: 0,
            isComplete: false,
            lastScannedAt: null,
          }),
        })
      )
    );
    mount('book-1', 'en');

    expect(text('cr-coverage-counts')).toBe('Chapters reflected in the register: 0 of 1.');
    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_EN.coveragePreLedger);
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_EN.coverageGrows);
  });

  it('a NEVER-BUILT register keeps the ordinary filling-in sentence, never the pre-ledger one', () => {
    // The neighbouring cell, and the reason the branch tests `hasRegister` rather than only the counts:
    // a never-built register reports zero covered and zero stale too (the server answers it with a null
    // register, so its ledger is empty by construction). Saying "what the register already holds" about
    // a register that does not exist would be a new falsehood in place of the old one.
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          hasRegister: false,
          updatedAt: null,
          characters: [],
          coverage: makeCoverage({
            coveredChapters: 0,
            pendingChapters: 40,
            staleChapters: 0,
            lastScannedAt: null,
          }),
        })
      )
    );
    mount();

    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageGrows);
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coveragePreLedger);
  });

  it('a ledger with lines but nothing fresh still reads as filling in, not as an empty ledger', () => {
    // The other neighbouring cell, and the reason the branch tests `staleChapters` as well as
    // `coveredChapters`: every chapter that contributed has since been edited, so covered is zero while
    // the ledger plainly HAS lines. "No chapter has been counted yet" would be false here.
    service.getRegister.and.returnValue(
      of(
        makeRegister({
          hasRegister: true,
          coverage: makeCoverage({
            totalChapters: 40,
            coveredChapters: 0,
            pendingChapters: 35,
            staleChapters: 5,
            unscannableChapters: 0,
            isComplete: false,
          }),
        })
      )
    );
    mount();

    expect(text('cr-coverage-status')).toBe(CHARACTER_REGISTER_LABELS_HE.coverageGrows);
    expect(text('cr-coverage')).not.toContain(CHARACTER_REGISTER_LABELS_HE.coveragePreLedger);
    expect(text('cr-coverage-stale')).toContain('5');
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

  it('keeps he/en PLACEHOLDER parity, so no language silently drops a number', () => {
    // Label parity above proves both records hold the same KEYS. It cannot see that the Hebrew
    // `coverageCounts` still carries {covered} and {total}: a translation that dropped one would keep
    // its key, stay non-empty, pass every check above, and render a sentence with a number missing.
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of Object.keys(CHARACTER_REGISTER_LABELS_HE) as CharacterRegisterLabelKey[]) {
      expect(placeholders(CHARACTER_REGISTER_LABELS_HE[key]))
        .withContext(`placeholder mismatch on "${key}"`)
        .toEqual(placeholders(CHARACTER_REGISTER_LABELS_EN[key]));
    }

    // Non-vacuity: at least one key really does carry placeholders, so the loop above is not
    // comparing empty arrays for every single key.
    expect(placeholders(CHARACTER_REGISTER_LABELS_HE.coverageCounts)).toEqual([
      '{covered}',
      '{total}',
    ]);
  });

  it('localizes a non-standard stored gender by echoing it rather than blanking it', () => {
    expect(component.genderLabel('nonbinary')).toBe('nonbinary');
    expect(component.genderChoicesFor('nonbinary')).toContain('nonbinary');
    expect(component.genderChoicesFor('male')).toEqual(['male', 'female', 'unknown']);
  });
});
