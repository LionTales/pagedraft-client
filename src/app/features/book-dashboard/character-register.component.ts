import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  CharacterRegisterCoverageDto,
  CharacterRegisterDto,
  CharacterRegisterEditDto,
  CharacterRegisterEntryDto,
} from '../../core/models/character-register';
import { CharacterRegisterService } from '../../core/services/character-register.service';
import { formatRelativeTime } from '../../core/utils/relative-time';

/** Every string this surface can put on screen. Closed union: a typo'd key is a compile error. */
export type CharacterRegisterLabelKey =
  // chrome
  | 'title'
  | 'subtitle'
  | 'reload'
  | 'reloading'
  | 'loading'
  | 'loadError'
  | 'updated'
  // provenance vocabulary (the feature)
  | 'legendConfirmed'
  | 'legendExtracted'
  | 'badgeConfirmed'
  | 'badgeExtracted'
  | 'badgeAuthorAdded'
  | 'attentionNone'
  | 'attentionSome'
  // coverage: how much of the book the register reflects (server truth, be-c03)
  | 'coverageCounts'
  | 'coverageGrows'
  | 'coveragePreLedger'
  | 'coverageComplete'
  | 'coverageNothingToRead'
  | 'coverageNoChapters'
  | 'coverageStale'
  | 'coverageUnscannable'
  | 'coverageLastScanned'
  // fields
  | 'fieldGender'
  | 'fieldAliases'
  | 'fieldRole'
  | 'noGender'
  | 'noAliases'
  | 'noRole'
  | 'genderMale'
  | 'genderFemale'
  | 'genderUnknown'
  | 'genderClear'
  // actions
  | 'edit'
  | 'save'
  | 'saving'
  | 'cancel'
  | 'confirmGender'
  | 'confirmAliases'
  | 'notACharacter'
  | 'restore'
  | 'addTitle'
  | 'addOpen'
  | 'addName'
  | 'addNamePlaceholder'
  | 'addSubmit'
  | 'addNameRequired'
  | 'aliasesPlaceholder'
  | 'aliasesHint'
  // states
  | 'emptyNeverBuiltTitle'
  | 'emptyNeverBuiltBody'
  | 'emptyBuiltNoCharacters'
  | 'emptyAllSuppressed'
  | 'suppressedTitle'
  | 'suppressedHint'
  | 'saveFailed'
  | 'nothingChanged';

/**
 * Hebrew chrome. DRAFT: every string here needs native-speaker review before sign-off (standing
 * convention). No em-dash in any user-facing string.
 */
export const CHARACTER_REGISTER_LABELS_HE: Record<CharacterRegisterLabelKey, string> = {
  title: 'מאגר הדמויות',
  subtitle: 'הדמויות שהניתוח מכיר. תיקון שלכם גובר על הניחוש בכל ניתוח הבא.',
  reload: 'רענון',
  reloading: 'מרענן...',
  loading: 'טוען את מאגר הדמויות...',
  loadError: 'שגיאה בטעינת מאגר הדמויות. נסו שוב.',
  updated: 'עודכן',

  legendConfirmed: 'אושר על ידכם',
  legendExtracted: 'ניחוש של המערכת',
  badgeConfirmed: 'מאושר',
  badgeExtracted: 'ניחוש',
  badgeAuthorAdded: 'נוסף על ידכם',
  attentionNone: 'כל הערכים אושרו על ידכם.',
  attentionSome: 'ערכים שעדיין לא אושרו:',

  // DRAFT (Hebrew), and shipping that way BY DECISION (2026-08-06): the nine coverage strings below
  // have not had a native-speaker pass on wording or word-order, and the author chose to ship them and
  // correct them from QA and POC-user feedback instead of blocking on one. So this marker is a standing
  // invitation to improve the copy, NOT an unmet release gate - do not read it as work that was missed.
  // `{covered}` / `{total}` / `{stale}` / `{unscannable}` are filled with the SERVER's numbers; they sit
  // inside the sentence so each language keeps its own word order, and any rewrite must preserve them
  // verbatim (a spec pins he/en placeholder parity).
  coverageCounts: 'פרקים שהמאגר משקף: {covered} מתוך {total}.',
  coverageGrows: 'המאגר מתמלא ככל שמריצים את הניתוחים שקוראים אותו.',
  coveragePreLedger:
    'עדיין לא נספר אף פרק. מה שכבר יש במאגר נרשם לפני שהתחילה הספירה לפי פרקים, ומכאן והלאה הפרקים נספרים ככל שמריצים את הניתוחים שקוראים את המאגר.',
  coverageComplete: 'כל פרק שיש בו טקסט כבר תרם למאגר.',
  coverageNothingToRead: 'אין בספר פרק שיש בו טקסט שהניתוח יכול לקרוא, ולכן אין עדיין מה לשקף במאגר.',
  coverageNoChapters: 'אין עדיין פרקים בספר, ולכן אין מה לשקף במאגר.',
  coverageStale: 'פרקים שהשתנו מאז שנקראו: {stale}. כל אחד מהם ייקרא שוב בניתוח הבא שקורא את המאגר.',
  coverageUnscannable: 'פרקים שאין בהם טקסט לקריאה: {unscannable}.',
  coverageLastScanned: 'נקרא לאחרונה',

  fieldGender: 'מגדר',
  fieldAliases: 'כינויים',
  fieldRole: 'תפקיד',
  noGender: 'לא נקבע',
  noAliases: 'אין כינויים',
  noRole: 'לא נקבע',
  genderMale: 'זכר',
  genderFemale: 'נקבה',
  genderUnknown: 'לא ידוע',
  genderClear: 'ללא מגדר',

  edit: 'עריכה',
  save: 'שמירה',
  saving: 'שומר...',
  cancel: 'ביטול',
  confirmGender: 'אשרו את המגדר',
  confirmAliases: 'אשרו את הכינויים',
  notACharacter: 'זו לא דמות',
  restore: 'החזרה לרשימה',
  addTitle: 'הוספת דמות',
  addOpen: 'הוספת דמות',
  addName: 'שם',
  addNamePlaceholder: 'שם הדמות',
  addSubmit: 'הוספה',
  addNameRequired: 'יש להזין שם.',
  aliasesPlaceholder: 'כינוי, כינוי נוסף',
  aliasesHint: 'הפרידו כינויים בפסיק.',

  emptyNeverBuiltTitle: 'מאגר הדמויות עדיין לא נבנה',
  emptyNeverBuiltBody:
    'המאגר נבנה אוטומטית בריצת הניתוח הראשונה שזקוקה לו. אפשר גם להוסיף דמות כאן כבר עכשיו.',
  emptyBuiltNoCharacters: 'המאגר נבנה, אך אין בו דמויות.',
  // DRAFT (Hebrew): verify wording/word-order with the user before sign-off.
  emptyAllSuppressed: 'כל השמות במאגר מסומנים כלא דמויות, ולכן אין כרגע דמויות פעילות. אפשר להחזיר שם מהרשימה שלמטה.',
  suppressedTitle: 'סומנו כלא דמויות',
  suppressedHint: 'שמות אלה לא נשלחים לניתוח, וריצה חדשה לא תחזיר אותם.',
  saveFailed: 'השמירה נכשלה. השינוי לא נשמר והרשימה חזרה למצב שבשרת.',
  nothingChanged: 'לא שיניתם דבר, ולכן לא נשמר עדכון. הערך עדיין מסומן כניחוש. כדי לאשר אותו כנכון, השתמשו בכפתור האישור שליד השדה.',
};

/** English chrome. No em-dash in any user-facing string. */
export const CHARACTER_REGISTER_LABELS_EN: Record<CharacterRegisterLabelKey, string> = {
  title: 'Character register',
  subtitle: 'The characters the analysis knows about. Your corrections beat the guess on every later run.',
  reload: 'Reload',
  reloading: 'Reloading...',
  loading: 'Loading the character register...',
  loadError: 'Failed to load the character register. Try again.',
  updated: 'Updated',

  legendConfirmed: 'Confirmed by you',
  legendExtracted: 'Guessed by the system',
  badgeConfirmed: 'Confirmed',
  badgeExtracted: 'Guessed',
  badgeAuthorAdded: 'Added by you',
  attentionNone: 'Every value has been confirmed by you.',
  attentionSome: 'Values not confirmed yet:',

  coverageCounts: 'Chapters reflected in the register: {covered} of {total}.',
  coverageGrows: 'It fills in as you run the analyses that read the register.',
  coveragePreLedger:
    'No chapter has been counted yet. What the register already holds was recorded before this per-chapter count began, and chapters are counted from here on as you run the analyses that read the register.',
  coverageComplete: 'Every chapter that holds text has contributed to the register.',
  coverageNothingToRead:
    'No chapter in this book holds text an analysis can read, so there is nothing for the register to reflect yet.',
  coverageNoChapters: 'This book has no chapters yet, so there is nothing for the register to reflect.',
  coverageStale:
    'Chapters changed since they were read: {stale}. Each one is read again the next time an analysis that reads the register runs on it.',
  coverageUnscannable: 'Chapters holding no text to read: {unscannable}.',
  coverageLastScanned: 'Last read',

  fieldGender: 'Gender',
  fieldAliases: 'Aliases',
  fieldRole: 'Role',
  noGender: 'Not set',
  noAliases: 'No aliases',
  noRole: 'Not set',
  genderMale: 'Male',
  genderFemale: 'Female',
  genderUnknown: 'Unknown',
  genderClear: 'No gender',

  edit: 'Edit',
  save: 'Save',
  saving: 'Saving...',
  cancel: 'Cancel',
  confirmGender: 'Confirm the gender',
  confirmAliases: 'Confirm the aliases',
  notACharacter: 'Not a character',
  restore: 'Restore to the list',
  addTitle: 'Add a character',
  addOpen: 'Add a character',
  addName: 'Name',
  addNamePlaceholder: 'Character name',
  addSubmit: 'Add',
  addNameRequired: 'A name is required.',
  aliasesPlaceholder: 'alias, another alias',
  aliasesHint: 'Separate aliases with a comma.',

  emptyNeverBuiltTitle: 'This register has not been built yet',
  emptyNeverBuiltBody:
    'It is built automatically on the first analysis run that needs it. You can also add a character here right now.',
  emptyBuiltNoCharacters: 'The register was built, but it holds no characters.',
  emptyAllSuppressed:
    'Every name in this register is marked as not a character, so there are no active characters right now. You can restore one from the list below.',
  suppressedTitle: 'Marked as not characters',
  suppressedHint: 'These names are kept out of the analysis, and a new run will not bring them back.',
  saveFailed: 'The save failed. Nothing was changed and the list is back to what the server holds.',
  nothingChanged: 'You did not change anything, so nothing was saved. The value is still marked as a guess. To confirm it as correct, use the Confirm button next to the field.',
};

/** The gender values the extractor emits, plus the explicit "confirmed, no gender" clear. */
const GENDER_OPTIONS = ['male', 'female', 'unknown'] as const;

/**
 * The author's edit surface over the book's character register (character-register-editing plan, c2).
 *
 * ── What it is for ────────────────────────────────────────────────────────────────────────────────
 * Every character the analysis knows about, with the ONE distinction that makes the surface worth
 * having: which values a human CONFIRMED and which the extractor GUESSED. That is where the author's
 * attention is worth spending, so it is rendered as a first-class per-field badge (text + glyph, never
 * colour alone) rather than a subtle styling difference.
 *
 * ── Optimistic-update discipline (a repeatedly-reviewed defect class here) ────────────────────────
 * `register` holds the LAST SERVER TRUTH and is never mutated; `characters` is the rendered working
 * copy. A row-scoped edit patches the working copy optimistically BY INDEX (never by re-deriving the
 * server's name/alias matching key), then:
 *   - on success the working copy is REPLACED wholesale by the server's returned register. The client
 *     never assumes its patch landed, and never merges its guess into the answer.
 *   - on failure it is rolled back to `register` and the failure is surfaced. A rejected PATCH batch
 *     writes NOTHING server-side, so a partial-success UI state is always wrong.
 * The ADD path is deliberately NOT optimistic: whether a new name creates an entry or matches an
 * existing one through the alias fallback is the SERVER's decision, and guessing it here would be
 * re-deriving a rule this client must not own.
 *
 * ── Contract rules that stay on the server ───────────────────────────────────────────────────────
 * The matching key (trim + case-insensitive with alias fallback), permanent suppression, provenance
 * defaults and the stamp are all server-side. An ABSENT `gender`/`aliases` means "untouched" and a
 * PRESENT one means "set AND confirm", so this component omits a field it is not editing rather than
 * sending it unchanged. `hasRegister: false` (a 200) is the server's own "never built" answer and is
 * never inferred from an empty list.
 *
 * ── Coverage (automatic-coverage plan, c01) ──────────────────────────────────────────────────────
 * The card also states how much of the book the register actually reflects, because a silent
 * automatic mechanism that quietly covers 3 of 40 chapters is worse than a manual one the author can
 * see. It is a LINE OF FACT, not a control panel: coverage grows one chapter at a time, at the pace
 * the author runs the analyses that read the register (Proofread, LiteraryAnalysis, QA, Synopsis,
 * per `PromptFactory.RendersCharacterRegister` on the server; the other analysis types never scan),
 * and the copy says so rather than implying the register is complete or about to be. There is no scan
 * button, deliberately (d1 did not conclude one is needed), and no chapter identities are listed,
 * because a list of chapters still to scan is a work queue.
 * Every number comes from `register.coverage` (the server's own count off its scan ledger) and NONE is
 * re-derived from `characters`: that list says who was found, not which chapters were read.
 *
 * he/en parity, `[dir]` from the BOOK language (not the app chrome), no em-dash.
 */
@Component({
  selector: 'app-character-register',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './character-register.component.html',
  styleUrl: './character-register.component.scss',
})
export class CharacterRegisterComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language ('he' / 'en'). Drives localization AND [dir]. Defaults to Hebrew. */
  @Input() bookLanguage: string | null = null;

  /** The last register the SERVER returned. Never mutated; the rollback target. */
  register: CharacterRegisterDto | null = null;
  /** The rendered working copy. Diverges from `register` only while an optimistic patch is in flight. */
  characters: CharacterRegisterEntryDto[] = [];
  /**
   * Entries the author still treats as characters. A FIELD, not a getter: recomputed by
   * `setCharacters()` every time `characters` is written, never re-filtered on every change-detection
   * pass. Read by the active-rows `@for` in the template.
   */
  activeCharacters: CharacterRegisterEntryDto[] = [];
  /**
   * Entries the author marked as not-a-character. Shown so suppression stays visible and reversible.
   * A FIELD for the same reason as `activeCharacters`; read by the suppressed-rows `@for` and the
   * `suppressedCharacters.length` check in the template.
   */
  suppressedCharacters: CharacterRegisterEntryDto[] = [];

  loading = false;
  loadError = false;
  /** True while a PATCH is in flight. Every edit affordance is disabled meanwhile. */
  saving = false;
  /** True when the last PATCH failed (the edit was NOT saved and has been rolled back). */
  saveError = false;

  /**
   * Set when the author opened the editor and saved without touching anything.
   *
   * A silent no-op reads as "I confirmed this" while the badge still says "guess", which is the one
   * misreading this surface must not allow: the confirmed-vs-guessed distinction IS the feature. We
   * still refuse to auto-confirm an untouched field (d1 §1), so the honest resolution is to say
   * nothing was saved and point at the affordance that does confirm it.
   */
  noChangeHint = false;

  /**
   * The entry currently in inline-edit mode, held BY REFERENCE, or null.
   *
   * Deliberately not the entry's NAME. A register can legitimately hold two entries with the same
   * name (the server now collapses them, but a legacy payload in flight or any future duplicate must
   * DEGRADE rather than misbehave), and a name-keyed comparison opened the edit form on BOTH rows at
   * once, sharing one gender/aliases draft between them. A reference matches exactly one row no matter
   * what the names are.
   *
   * A consequence worth naming: any write of `characters` replaces the entry objects, so a reference
   * held across a server answer stops matching and the form closes. That is the right outcome - the
   * row the author was editing is no longer the row on screen.
   */
  editingEntry: CharacterRegisterEntryDto | null = null;
  genderDraft = '';
  aliasesDraft = '';

  addOpen = false;
  addName = '';
  addGender = '';
  addAliases = '';
  /** True when the add form was submitted with a blank name. */
  addNameError = false;

  readonly genderOptions = GENDER_OPTIONS;

  private loadSub: Subscription | null = null;
  private saveSub: Subscription | null = null;

  constructor(
    private registers: CharacterRegisterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      this.resetView();
      this.load();
    }
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
    this.saveSub?.unsubscribe();
  }

  // ── Load ───────────────────────────────────────────────────────────────────────

  /** Read the register. Drops a response that arrives after the book changed. */
  load(): void {
    if (!this.bookId) {
      this.register = null;
      this.setCharacters([]);
      return;
    }
    const bookId = this.bookId;
    this.loading = true;
    this.loadError = false;
    this.saveError = false;
    this.loadSub?.unsubscribe();
    // Both handlers below open with `if (this.bookId !== bookId) return;`: an answer is accepted only
    // for the book it was requested for. A book switch through `ngOnChanges` cancels this read before
    // it can answer (`resetView()` unsubscribes), so the guard is defence in depth against any other
    // route to a changed `bookId` with this subscription still live. Covered by the specs named
    // "load next: ..." and "load error: ...", which reproduce that state by assigning `bookId`
    // directly; a spec that switches books through `ngOnChanges` CANNOT reach either guard.
    this.loadSub = this.registers.getRegister(bookId).subscribe({
      next: (dto) => {
        if (this.bookId !== bookId) return;
        this.acceptServerAnswer(dto);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId) return;
        this.loading = false;
        this.loadError = true;
        this.cdr.detectChanges();
      },
    });
  }

  private resetView(): void {
    this.loadSub?.unsubscribe();
    // `loading` is lowered only inside the load's own next/error handlers (both inside the
    // `this.loadSub = ...subscribe({...})` in `load()`), and dropping the subscription above destroys
    // both of them before either can fire. `load()` also
    // early-returns without touching `loading` when `bookId` is null. So the unsubscribe itself is
    // the one place that knows the in-flight read just ended: `loading` means a read is in flight,
    // and cancelling the only read makes that false, never true.
    this.loading = false;
    this.saveSub?.unsubscribe();
    this.register = null;
    this.setCharacters([]);
    this.loadError = false;
    this.saveError = false;
    this.saving = false;
    // A hint raised while editing book A must not leak onto book B's freshly loaded register.
    this.noChangeHint = false;
    this.cancelEdit();
    this.closeAdd();
  }

  /**
   * The ONLY way server state enters this component: replace both the truth and the rendered copy.
   * Never merges the client's optimistic guess into the answer.
   */
  private acceptServerAnswer(dto: CharacterRegisterDto): void {
    this.register = dto;
    this.setCharacters((dto.characters ?? []).map((c) => this.cloneEntry(c)));
  }

  private cloneEntry(e: CharacterRegisterEntryDto): CharacterRegisterEntryDto {
    return { ...e, aliases: [...(e.aliases ?? [])] };
  }

  /**
   * The ONE place `characters` is assigned. Assignment and the derived-list recompute are kept
   * inseparable on purpose: `activeCharacters`/`suppressedCharacters` used to be getters that
   * re-filtered on every change-detection pass (review findings 12/13), and the replacement must not
   * trade that for five call sites each hand-copying "assign, then remember to recompute" - a
   * hand-copied invariant per call site is the same bug wearing a hat. Route every writer through here.
   *
   * Every current writer of `this.characters` (re-grep `this\.characters\s*=` to re-verify against
   * drift; a hit outside this method means a sixth writer showed up and must be routed through here too):
   *   1. `load()` - `bookId` is falsy, clears to empty before returning.
   *   2. `resetView()` - book/language switch, clears to empty.
   *   3. `acceptServerAnswer()` - the server's answer replaces the working copy (load success AND the
   *      save-reconcile path both go through this one method).
   *   4. `save()` optimistic patch - the row-scoped in-flight guess, applied by index.
   *   5. `save()` error handler - rollback to the pre-patch list after a rejected batch.
   */
  private setCharacters(next: CharacterRegisterEntryDto[]): void {
    this.characters = next;
    this.activeCharacters = next.filter((c) => c.isCharacter);
    this.suppressedCharacters = next.filter((c) => !c.isCharacter);
  }

  // ── Derived views ──────────────────────────────────────────────────────────────

  /** True when the SERVER says this book's register has never been built (a 200, not a 404). */
  get neverBuilt(): boolean {
    return !this.loading && !this.loadError && !!this.register && !this.register.hasRegister;
  }

  /** True when the register exists but holds nothing. A different statement from `neverBuilt`. */
  get builtButEmpty(): boolean {
    return (
      !this.loading &&
      !this.loadError &&
      !!this.register &&
      this.register.hasRegister &&
      this.characters.length === 0
    );
  }

  /** How many active entries still carry at least one guessed (unconfirmed) editable value. */
  get unconfirmedCount(): number {
    return this.activeCharacters.filter((c) => !c.genderConfirmed || !c.aliasesConfirmed).length;
  }

  /** Localized, timezone-aware "updated ..." for the register stamp (never a raw `| date`). */
  get updatedLabel(): string {
    return formatRelativeTime(this.register?.updatedAt, this.langKey);
  }

  // ── Coverage: how much of the book the register reflects ───────────────────────
  //
  // SERVER TRUTH ONLY. Every number rendered below is read straight off `register.coverage`, which the
  // server computes from the persisted scan ledger. NOTHING here is derived from `characters`,
  // `activeCharacters` or any other client-side list: the character list answers "who was found", the
  // coverage answers "which chapters were read", and a client that inferred one from the other would be
  // inventing an answer it cannot have (a chapter can be read and contribute no new character at all).
  //
  // What it says is deliberately a line of FACT, not an instruction and not a control panel: coverage
  // grows ONE chapter at a time, at the pace the author runs the analyses that read the register
  // (Proofread, LiteraryAnalysis, QA, Synopsis; see `PromptFactory.RendersCharacterRegister` on the
  // server), so a long book can stay partly reflected for a long time even after many other analyses
  // have run on it. Nothing here may imply the register is complete, or about to be. There is no scan
  // button, by design.
  //
  // It may not UNDERstate itself either, which is the other half of the same honesty. The scan ledger
  // is newer than the registers it counts, so a register built before per-chapter tracking existed
  // reports zero covered chapters while listing the characters it found in that book, and the two read
  // as a contradiction. `coverageStatusLabel` gives that state its own sentence rather than letting the
  // generic "it fills in" stand beside a zero it does not explain; the closed-set table on that getter
  // is what keeps the new cell from stealing a neighbour's.

  /** The server's coverage block, or null when no register answer is on screen. Never re-derived. */
  get coverage(): CharacterRegisterCoverageDto | null {
    return this.register?.coverage ?? null;
  }

  /**
   * "Chapters reflected in the register: 3 of 40." Rendered only when the book HAS chapters, since
   * "0 of 0" is a count of nothing (that state gets `coverageNoChapters` instead).
   */
  get coverageCountsLabel(): string {
    const c = this.coverage;
    if (!c) return '';
    return this.fill('coverageCounts', { covered: c.coveredChapters, total: c.totalChapters });
  }

  /**
   * The one sentence that says what the numbers mean. Five mutually exclusive states, each an honest
   * reading of a state the server can genuinely report:
   *   - no chapters at all: there is nothing to reflect yet (the server calls this NOT complete).
   *   - a register exists and the LEDGER IS EMPTY: nothing has contributed, but the register is not
   *     empty either. This is the pre-ledger state - every register that predates per-chapter tracking
   *     lands here - and without its own sentence the card opens by UNDERstating itself to "0 of 80"
   *     directly above the characters it found in that very book. It says what is true: no chapter has
   *     been counted yet, what is already held was recorded before the count began, and counting runs
   *     from here on.
   *   - not complete, otherwise: it fills in as the author runs analyses that read the register. The
   *     default, and the one that must not be dressed up as nearly-done.
   *   - complete with something covered: every chapter that CAN contribute has, up to the extraction
   *     pre-pass's word cap on its current text (not necessarily the whole chapter for a long one).
   *   - complete with nothing covered: every chapter is unscannable, so completeness here means there
   *     is nothing to read, not that the register is full. Saying "every chapter contributed" would be
   *     a plain falsehood on this state.
   *
   * ── THE CLOSED SET ───────────────────────────────────────────────────────────────────────────────
   * This surface has already shipped one missing-cell bug (an all-suppressed register rendering "every
   * value has been confirmed by you"), so the cross of the five booleans this getter can branch on is
   * materialized here rather than argued informally. H = `hasRegister`, T0 = `totalChapters === 0`,
   * IC = `isComplete`, C0 = `coveredChapters === 0`, S0 = `staleChapters === 0`. 32 cells; 10 are
   * reachable, and the other 22 are UNREACHABLE BY CONSTRUCTION on the server (deliberate no-ops, not
   * oversights). The three structural facts that kill them, all from
   * `CharacterRegisterCoverage.Summarize` and `CharacterRegisterService.GetAsync`:
   *   (i)   `isComplete = total > 0 && pending == 0 && stale == 0`, so T0 forces !IC, and IC forces S0.
   *   (ii)  `hasRegister:false` is answered with a NULL register, so the ledger is empty: !H forces
   *         C0 and S0.
   *   (iii) T0 means there are no chapters to classify at all: T0 forces C0 and S0.
   *
   * | H | T0 | IC | C0 | S0 | state | branch |
   * |---|----|----|----|----|-------|--------|
   * | T | T  | F  | T  | T  | register exists, book has no chapters | `coverageNoChapters` |
   * | F | T  | F  | T  | T  | never built, book has no chapters     | `coverageNoChapters` |
   * | T | F  | T  | F  | T  | complete, something covered           | `coverageComplete` |
   * | T | F  | T  | T  | T  | complete, every chapter unscannable   | `coverageNothingToRead` |
   * | F | F  | T  | T  | T  | never built, every chapter unscannable | `coverageNothingToRead` |
   * | T | F  | F  | F  | F  | partly covered, some chapters edited  | `coverageGrows` |
   * | T | F  | F  | F  | T  | partly covered (the ordinary mid-book state) | `coverageGrows` |
   * | T | F  | F  | T  | F  | nothing covered but the ledger HAS lines (all scanned chapters were since edited) | `coverageGrows` |
   * | F | F  | F  | T  | T  | never built, chapters outstanding     | `coverageGrows` |
   * | T | F  | F  | T  | T  | **register exists, ledger empty**     | `coveragePreLedger` (new) |
   *
   * Unreachable (no branch, and none needed): every T0 cell with IC, !C0 or !S0 (14, by (i)+(iii));
   * every IC cell with !S0 (4 more, by (i)); every !H cell with !C0 or !S0 (4 more, by (ii)).
   *
   * WHAT THE NEW CELL MUST NOT STEAL, and why it does not:
   *   - `coverageNoChapters` (T0) satisfies C0 && S0 too, so the T0 test stays FIRST and wins.
   *   - `coverageNothingToRead` (IC && C0) satisfies C0 && S0 too, so the new test lives strictly
   *     inside the `!isComplete` arm and can never reach it. On an all-unscannable book "counted from
   *     here on" would be a promise the server can never keep.
   *   - the ordinary mid-book state is held off by `coveredChapters === 0`, and a ledger that has lines
   *     but no fresh ones by `staleChapters === 0`. Both are SERVER fields.
   *
   * `hasRegister` is read off `register`, which is the server's answer. Nothing here consults
   * `characters` / `characters.length`: "who was found" is a different question from "what has been
   * counted", and deriving one from the other is the defect the whole coverage block exists to avoid.
   */
  get coverageStatusLabel(): string {
    const c = this.coverage;
    if (!c) return '';
    if (c.totalChapters === 0) return this.label('coverageNoChapters');
    if (!c.isComplete) {
      const ledgerEmpty = c.coveredChapters === 0 && c.staleChapters === 0;
      return this.register?.hasRegister === true && ledgerEmpty
        ? this.label('coveragePreLedger')
        : this.label('coverageGrows');
    }
    return c.coveredChapters > 0
      ? this.label('coverageComplete')
      : this.label('coverageNothingToRead');
  }

  /** "Chapters changed since they were read: 2." Rendered only when the server reports some. */
  get coverageStaleLabel(): string {
    const c = this.coverage;
    if (!c) return '';
    return this.fill('coverageStale', { stale: c.staleChapters });
  }

  /**
   * "Chapters holding no text to read: 1." Named rather than omitted, so the four buckets visibly add
   * up to the total and an author is never left wondering why the count stopped moving.
   */
  get coverageUnscannableLabel(): string {
    const c = this.coverage;
    if (!c) return '';
    return this.fill('coverageUnscannable', { unscannable: c.unscannableChapters });
  }

  /** Localized, timezone-aware last-scan stamp (the same helper as `updatedLabel`, never `| date`). */
  get coverageLastScannedLabel(): string {
    return formatRelativeTime(this.coverage?.lastScannedAt, this.langKey);
  }

  // ── Row editing ────────────────────────────────────────────────────────────────

  isEditing(entry: CharacterRegisterEntryDto): boolean {
    return this.editingEntry === entry;
  }

  startEdit(entry: CharacterRegisterEntryDto): void {
    if (this.saving) return;
    this.saveError = false;
    this.noChangeHint = false;
    this.editingEntry = entry;
    this.genderDraft = (entry.gender ?? '').trim();
    this.aliasesDraft = (entry.aliases ?? []).join(', ');
  }

  cancelEdit(): void {
    this.editingEntry = null;
    this.genderDraft = '';
    this.aliasesDraft = '';
  }

  /**
   * Save the inline edit, sending ONLY the fields that actually changed.
   *
   * Omitting an untouched field is not an optimization: on this contract a PRESENT field is also a
   * CONFIRMATION, so sending an unchanged gender back would silently mark a guess as author-blessed
   * (d1 §1 exists precisely to stop the author re-owning fields they never looked at).
   */
  saveEdit(entry: CharacterRegisterEntryDto): void {
    if (this.saving) return;
    const index = this.characters.indexOf(entry);
    if (index < 0) return;

    const gender = this.genderDraft.trim();
    const aliases = this.parseAliases(this.aliasesDraft);
    const edit: CharacterRegisterEditDto = { name: entry.name, op: 'upsert' };
    let changed = false;

    if (gender !== (entry.gender ?? '').trim()) {
      edit.gender = gender;
      changed = true;
    }
    if (!this.aliasesEqual(aliases, entry.aliases ?? [])) {
      edit.aliases = aliases;
      changed = true;
    }

    if (!changed) {
      // Deliberately NOT a silent close: see noChangeHint.
      this.noChangeHint = true;
      this.cancelEdit();
      return;
    }

    const patched = this.cloneEntry(entry);
    if (edit.gender !== undefined) {
      patched.gender = edit.gender.length === 0 ? null : edit.gender;
      patched.genderConfirmed = true;
    }
    if (edit.aliases !== undefined) {
      patched.aliases = [...edit.aliases];
      patched.aliasesConfirmed = true;
    }

    this.cancelEdit();
    this.save([edit], index, patched);
  }

  /** Bless the extractor's guessed gender as-is (sends the same value, which CONFIRMS it). */
  confirmGender(entry: CharacterRegisterEntryDto): void {
    const index = this.characters.indexOf(entry);
    if (this.saving || index < 0) return;
    const patched = this.cloneEntry(entry);
    patched.genderConfirmed = true;
    this.save([{ name: entry.name, op: 'upsert', gender: (entry.gender ?? '').trim() }], index, patched);
  }

  /** Bless the extractor's guessed aliases as-is (an empty list is a confirmed empty list). */
  confirmAliases(entry: CharacterRegisterEntryDto): void {
    const index = this.characters.indexOf(entry);
    if (this.saving || index < 0) return;
    const patched = this.cloneEntry(entry);
    patched.aliasesConfirmed = true;
    this.save([{ name: entry.name, op: 'upsert', aliases: [...(entry.aliases ?? [])] }], index, patched);
  }

  /**
   * Mark not-a-character. This is the "remove" action and it is deliberately a SUPPRESSION: only a
   * persisted decision stops a future re-extraction from re-adding the name.
   */
  suppress(entry: CharacterRegisterEntryDto): void {
    const index = this.characters.indexOf(entry);
    if (this.saving || index < 0) return;
    const patched = this.cloneEntry(entry);
    patched.isCharacter = false;
    patched.isCharacterConfirmed = true;
    this.cancelEdit();
    this.save([{ name: entry.name, op: 'suppress' }], index, patched);
  }

  /** The inverse of suppress. */
  restore(entry: CharacterRegisterEntryDto): void {
    const index = this.characters.indexOf(entry);
    if (this.saving || index < 0) return;
    const patched = this.cloneEntry(entry);
    patched.isCharacter = true;
    patched.isCharacterConfirmed = true;
    this.save([{ name: entry.name, op: 'restore' }], index, patched);
  }

  // ── Add ────────────────────────────────────────────────────────────────────────

  openAdd(): void {
    if (this.saving) return;
    this.addOpen = true;
    this.addNameError = false;
    this.saveError = false;
  }

  closeAdd(): void {
    this.addOpen = false;
    this.addName = '';
    this.addGender = '';
    this.addAliases = '';
    this.addNameError = false;
  }

  /**
   * Add a character. NOT optimistic on purpose: whether this name creates a new entry or matches an
   * existing one through the server's alias fallback is the server's call, and the only honest answer
   * is the register it returns.
   */
  submitAdd(): void {
    if (this.saving) return;
    const name = this.addName.trim();
    if (!name) {
      this.addNameError = true;
      return;
    }
    this.addNameError = false;

    const edit: CharacterRegisterEditDto = { name, op: 'upsert' };
    const gender = this.addGender.trim();
    if (gender) edit.gender = gender;
    const aliases = this.parseAliases(this.addAliases);
    if (aliases.length > 0) edit.aliases = aliases;

    this.save([edit], null, null);
  }

  // ── The one save path ──────────────────────────────────────────────────────────

  /**
   * PATCH one batch and reconcile.
   *
   * `optimisticIndex`/`optimisticEntry` are the row-scoped optimistic patch, applied BY INDEX so the
   * client never has to reproduce the server's matching key. Pass nulls for a save whose outcome the
   * client cannot honestly predict (the add path).
   */
  private save(
    edits: CharacterRegisterEditDto[],
    optimisticIndex: number | null,
    optimisticEntry: CharacterRegisterEntryDto | null
  ): void {
    // Belt-and-braces re-entrancy backstop, not live UI behavior: every edit affordance in
    // character-register.component.html (save/cancel, both confirm buttons, edit, suppress, restore,
    // add-open, add-submit, add-cancel) carries `[disabled]="saving"`, so this branch cannot be reached
    // by a click while `saving` is true - it only guards a non-template caller from racing two batches.
    if (!this.bookId || this.saving) return;
    const bookId = this.bookId;
    /** The exact list to restore if the server rejects the batch (it writes nothing on rejection). */
    const rollback = this.characters;

    if (optimisticIndex !== null && optimisticEntry !== null) {
      const next = this.characters.slice();
      next[optimisticIndex] = optimisticEntry;
      this.setCharacters(next);
    }

    this.saving = true;
    this.saveError = false;
    this.noChangeHint = false;
    this.saveSub?.unsubscribe();
    // Same guard as the load pair, and reached the same way. `save()` never calls `resetView()`, but
    // `resetView()` still unsubscribes `saveSub`, so a book switch through `ngOnChanges` cancels this
    // PATCH rather than letting it answer into the new context. Covered by "save next: ..." and
    // "save error: ...", which assign `bookId` directly while this subscription is live.
    this.saveSub = this.registers.applyEdits(bookId, edits).subscribe({
      next: (dto) => {
        if (this.bookId !== bookId) return;
        // Reconcile: the SERVER's register replaces the working copy outright. Whatever the optimistic
        // patch assumed is discarded, whether it happened to be right or not.
        this.acceptServerAnswer(dto);
        this.saving = false;
        this.saveError = false;
        this.closeAdd();
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId) return;
        // The batch wrote NOTHING. Put back exactly what was on screen before the optimistic patch so
        // the author is never left looking at an edit the server rejected.
        this.setCharacters(rollback);
        this.saving = false;
        this.saveError = true;
        this.cdr.detectChanges();
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  /** Split the comma-separated alias input. Server-side normalization still applies on top. */
  private parseAliases(raw: string): string[] {
    return raw
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }

  private aliasesEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === (b[i] ?? '').trim());
  }

  /**
   * The gender values offered for an entry: the standard vocabulary, plus whatever non-standard value
   * is already stored so opening the editor can never silently rewrite it.
   */
  genderChoicesFor(current: string): string[] {
    const value = current.trim();
    if (!value || (GENDER_OPTIONS as readonly string[]).includes(value)) {
      return [...GENDER_OPTIONS];
    }
    return [...GENDER_OPTIONS, value];
  }

  /** Localized gender value (falls back to the raw stored string for a non-standard value). */
  genderLabel(gender: string | null | undefined): string {
    const value = (gender ?? '').trim();
    switch (value) {
      case 'male':
        return this.label('genderMale');
      case 'female':
        return this.label('genderFemale');
      case 'unknown':
        return this.label('genderUnknown');
      case '':
        return this.label('noGender');
      default:
        return value;
    }
  }

  // ── Localization ───────────────────────────────────────────────────────────────

  private get language(): string {
    return this.bookLanguage?.trim() || 'he';
  }

  /** Hebrew unless the BOOK is explicitly English (matching every other book-scoped surface). */
  get langKey(): 'he' | 'en' {
    return this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  /** [dir] follows the book language, not the app chrome. */
  get dir(): 'rtl' | 'ltr' {
    return this.langKey === 'en' ? 'ltr' : 'rtl';
  }

  label(key: CharacterRegisterLabelKey): string {
    return (this.langKey === 'he' ? CHARACTER_REGISTER_LABELS_HE : CHARACTER_REGISTER_LABELS_EN)[key];
  }

  /**
   * Localized label with `{name}` placeholders filled in.
   *
   * The alternative (concatenating a label fragment, a number and a second fragment in the template)
   * fixes ONE word order for every language, which is wrong the moment Hebrew and English disagree
   * about where the number belongs. Keeping the placeholder inside the string lets each language own
   * its own sentence. An unknown placeholder is left standing rather than replaced with "undefined",
   * so a typo shows up as itself; the spec pins he/en placeholder parity.
   */
  private fill(key: CharacterRegisterLabelKey, values: Record<string, number | string>): string {
    return this.label(key).replace(/\{(\w+)\}/g, (token, name: string) =>
      name in values ? String(values[name]) : token
    );
  }
}
