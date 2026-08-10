import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { AiTierService } from '../../core/services/ai-tier.service';
import { AiTierReadiness, AiTierValue, BookAiTierDto, BookAiTierTaskDto } from '../../core/models/book';
import { AiTaskKey, resolveAiTaskKey } from '../../core/utils/ai-task-key';

/** Which setting this instance addresses: one task's override, or the book-level default seed. */
export type TierToggleScope = 'task' | 'book';

let popoverSeq = 0;

/**
 * Localized chrome for {@link TierToggleComponent.label}. DRAFT Hebrew (the two tier words in particular):
 * flag for native-speaker review before sign-off, matching the standing caveat on the other book-scoped
 * surfaces. No em-dash in any string, and no provider, model or version name in any string.
 *
 * Hoisted to module scope (rather than local to `label()`) so the key set is a single source of truth the
 * spec can enumerate mechanically via {@link TIER_TOGGLE_LABEL_KEYS} instead of hand-copying the list.
 */
export const TIER_TOGGLE_LABELS_HE: Record<string, string> = {
  tierFast: 'מהיר',
  tierThinking: 'מעמיק',

  groupAria: 'שכבת המודל למשימה זו',
  bookDefaultTitle: 'ברירת מחדל לניתוחים חדשים',
  infoAria: 'מידע על שכבות המודל',
  infoFast: 'מודל קטן יותר. מהיר יותר, וצורך פחות טוקנים.',
  infoThinking: 'מודל גדול יותר. מעמיק יותר, וצורך יותר טוקנים.',

  loading: 'טוען...',
  saving: 'שומר...',
  retry: 'נסו שוב',
  cancel: 'ביטול',
  loadError: 'טעינת השכבה נכשלה.',
  saveError: 'שמירת השכבה נכשלה. נסו שוב.',
  saveRejected: 'השרת דחה את הבקשה: השכבה המעמיקה אינה זמינה כאן. ההגדרה נשארה מהירה.',
  followDefault: 'לפי ברירת המחדל של הספר',

  consentBody:
    'השכבה המעמיקה מעבדת את טקסט הפרקים אצל ספק חיצוני, כלומר הטקסט יוצא מהמחשב הזה. מדובר בספר שטרם פורסם, ' +
    'ולכן הבחירה היא הצטרפות מפורשת בלבד.',
  consentConfirm: 'אני מאשר, עברו למעמיק',

  fallbackWarning: 'ההגדרה היא מעמיק, אך המשימה רצה בפועל בשכבה המהירה.',
  reasonTaskNotEligible: 'משימה זו רצה תמיד בשכבה המהירה.',
  // Wave 3 / w5, the Q11-A residue. DRAFT Hebrew - w8 native sweep.
  reasonNoTierControl: 'לפעולה הזו אין בחירת שכבת מודל. השרת אינו מדווח שכבה עבורה, ולכן אין כאן מה לשנות.',
  reasonLanguageAlwaysFast: 'בשפת הספר הזו המשימה רצה תמיד בשכבה המהירה. שינוי שפת הספר ישנה זאת.',
  reasonRouteNotConfigured: 'השכבה המעמיקה אינה מופעלת בשרת הזה כרגע.',
  reasonProviderNotRegistered: 'השכבה המעמיקה אינה זמינה בשרת הזה, ולכן ריצה בה תיכשל.',
  reasonCredentialsMissing: 'לשכבה המעמיקה אין הרשאת גישה בשרת הזה, ולכן ריצה בה תיכשל.',
};

export const TIER_TOGGLE_LABELS_EN: Record<string, string> = {
  tierFast: 'Fast',
  tierThinking: 'Thinking',

  groupAria: 'Model tier for this task',
  bookDefaultTitle: 'Default for new analyses',
  infoAria: 'About the model tiers',
  infoFast: 'A smaller model. Quicker, and uses fewer tokens.',
  infoThinking: 'A larger model. Goes deeper, and costs more tokens.',

  loading: 'Loading...',
  saving: 'Saving...',
  retry: 'Retry',
  cancel: 'Cancel',
  loadError: 'Could not load the tier.',
  saveError: 'Could not save the tier. Try again.',
  saveRejected: 'The server refused: the thinking tier is not available here. The setting stays on fast.',
  followDefault: 'Follow the book default',

  consentBody:
    'The thinking tier processes the chapter text at a third-party provider, which means the text leaves ' +
    'this machine. This is an unpublished book, so the choice is explicit opt-in only.',
  consentConfirm: 'I agree, switch to thinking',

  fallbackWarning: 'This is set to thinking, but the task is actually running on the fast tier.',
  reasonTaskNotEligible: 'This task always runs on the fast tier.',
  reasonNoTierControl: 'This pass has no model tier choice. The server does not report a tier for it, so there is nothing to change here.',
  reasonLanguageAlwaysFast:
    'For this book language the task always runs on the fast tier. Changing the book language changes that.',
  reasonRouteNotConfigured: 'The thinking tier is not enabled on this server right now.',
  reasonProviderNotRegistered: 'The thinking tier is not available on this server, so a run on it would fail.',
  reasonCredentialsMissing: 'The thinking tier has no access configured on this server, so a run on it would fail.',
};

/**
 * Mechanical enumeration of every label key {@link TierToggleComponent.label} serves, derived from the `he`
 * map so the spec's he/en-parity and no-em-dash guards can iterate this instead of a hand-authored list that
 * a new key could silently miss on both sides at once.
 */
export const TIER_TOGGLE_LABEL_KEYS: readonly string[] = Object.keys(TIER_TOGGLE_LABELS_HE);

/**
 * THE TIER TOGGLE (tier-ux-rework c3). One shared control, mounted once per edit-type run surface and once
 * more (scope="book") as the book default.
 *
 * WHAT IT IS FOR. The tier is not a quality slider; it is a cost and (in a dev topology) a privacy decision.
 * Everything here follows from that:
 *
 *  • TWO WORDS, NOT A PARAGRAPH. The predecessor control printed a title, two descriptions, an applies-to
 *    list and a privacy paragraph in the dashboard hero position. This renders the two tier words as a
 *    segmented toggle plus one info affordance (hover tooltip on a pointer device, click/tap popover on
 *    touch), because the decision is per edit type and belongs next to the button that spends the tokens.
 *
 *  • IT NAMES NO MODEL AND NO PROVIDER, EVER. Model identity is internal IP. The server strips provider and
 *    model from the payload (there is no `routes` array any more), and the copy here talks about "a smaller
 *    model" / "a larger model", never about which one or whose. The spec pins that; do not soften it.
 *
 *  • IT RENDERS THE SERVER'S ANSWER, NOT THE REQUEST. The selected word is the task's `effectiveTier`, which
 *    the server defines as THE TIER THAT WILL ACTUALLY ROUTE (be-c01) - already clamped against task
 *    eligibility and the language rung, so the highlighted word can never contradict the reason line beside
 *    it. The disabled state comes from the task's `thinkingReadiness`, and a task whose SETTING says thinking
 *    while the run stays fast (`fallbackActive`) says so out loud in a third line. The client never computes
 *    routing and must not start: clamping here as well would be a second copy of the precedence.
 *
 *  • CONSENT IS DEPLOYMENT-SHAPED. `consentRequired` on the DTO decides whether picking thinking goes
 *    through an inline confirm: in dev fast is local, so the confirm states that the text leaves this
 *    machine; in a hosted deployment both tiers are already off-machine and the step is meaningless. The
 *    client never hardcodes either topology, and the server's 409 does not depend on this flag.
 *
 * NO OPTIMISTIC FLIP. The toggle only ever paints what the server returned: a click starts the PUT, the
 * `saving` latch blocks a second overlapping write, and the answer (or the failure) repaints. That is
 * deliberate for a setting whose whole job is to state truthfully what will run - an optimistic "thinking"
 * that the server then refuses with a 409 is exactly the silent lie this surface exists to prevent.
 *
 * THE ANSWER IS SHARED, THE ATTEMPT IS NOT (tier-ux-rework fixes c02). Several of these are mounted against
 * one book at once - the dashboard alone has the book-default row and the BookReview row - so `status` is fed
 * by {@link AiTierService.watch}, a per-book channel every read and every write pushes into. One toggle's
 * write therefore repaints all of them (it used to repaint only itself, leaving a sibling advertising a tier
 * the same page had just changed), and N mounted toggles cost ONE GET. What stays per-instance is everything
 * that describes THIS control's attempt rather than the book: `loading`, `loadError`, `saving`, `saveError`,
 * the 409 wording and the consent panel. Painting goes through the channel and nowhere else, so there is
 * exactly one place that decides which answer is current.
 *
 * WHAT THE CHANNEL DOES NOT REACH (tier-ux-rework fixes c04). It repaints TOGGLES. The rows that depend on
 * the ACTIVE MODEL rather than on the setting - the style baseline, the book summary, the book review, each
 * with its own `builtWithDifferentModel` flag - are the host's, so a successful write also raises
 * {@link TierToggleComponent.tierChanged} for the host to re-read them. That event is per WRITE, not per
 * repainted toggle.
 *
 * READS SUPERSEDE ONE ANOTHER (carried over from the predecessor control's race fixes). Three points: a new
 * `reload()`, a write's SUCCESS handler (a read issued before the write landed is older by construction), and
 * the write's post-failure re-read. Without them an older snapshot can repaint a stale readiness verdict over
 * a newer one, and readiness is the one thing this control must not get wrong. Since c02 the RULE lives in
 * the service (a shared answer cannot be superseded by whoever happens to still be listening - see the
 * "what cancel means now" note there), and the three points here are what invoke it: `reload()` and the
 * post-failure re-read take a fresh stamp through `refresh()`, and a write's answer outranks every read
 * issued before it landed. Unsubscribing on top of that is this instance DETACHING - it lowers its own
 * spinner and stops it waiting; it never decides anything for the other toggles.
 *
 * A TASK CHANGE DOES NOT RE-FETCH. The DTO carries every user-facing task, so switching the selected analysis
 * type re-derives from the snapshot in hand. Only a book or language change re-reads (the language changes
 * which tasks can move at all).
 */
@Component({
  selector: 'app-tier-toggle',
  standalone: true,
  templateUrl: './tier-toggle.component.html',
  styleUrl: './tier-toggle.component.scss',
})
export class TierToggleComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Drives localization, [dir], AND the per-task readiness read. */
  @Input() bookLanguage: string | null = null;
  /**
   * The surface's AnalysisType (or an AiTaskType name) when {@link scope} is 'task'. Resolved through
   * {@link resolveAiTaskKey} because several analysis types share one task. A type with no tier control
   * (Summarization, Custom) resolves to null and the whole control renders nothing rather than inventing an
   * answer the server did not give.
   */
  @Input() task: string | null = null;
  /** 'task' (default) addresses this task's override; 'book' addresses the book default seed. */
  @Input() scope: TierToggleScope = 'task';

  /**
   * A WRITE THIS INSTANCE ISSUED SUCCEEDED, so the ACTIVE MODEL for at least one task may have moved
   * (tier-ux-rework fixes c04). Hosts use it to re-read the model-dependent status they own: the style
   * baseline, the book summary and the book review each carry a `builtWithDifferentModel` flag computed
   * against the active model, and those rows render inches from this control. Without this the cross-model
   * staleness warning appeared only after a manual page reload.
   *
   * WHY IT LIVES ON THE INSTANCE THAT ISSUED THE WRITE, AND NOT ON THE SERVICE CHANNEL. Since c02 a write's
   * answer fans out to EVERY toggle mounted on the book, so an emit driven by the shared channel would turn
   * one write into N events (the dashboard alone mounts two) and make the host's re-read count depend on how
   * many toggles happen to be on the page. `submit`'s success handler runs exactly once per write, in the
   * one component that called it, so "once per write" is structural here rather than something a host has to
   * de-duplicate. Painting is still the channel's job; this only reports that a write HAPPENED.
   *
   * EMITTED ON SUCCESS ONLY: not on a failure, not on a 409 (the setting did not move, so no model moved
   * either), and not on a no-op click, which returns before `submit` is ever reached.
   */
  @Output() tierChanged = new EventEmitter<void>();

  status: BookAiTierDto | null = null;
  loading = false;
  loadError = false;
  saving = false;
  saveError: string | null = null;
  /** True while the inline opt-in confirm for the thinking tier is open (consentRequired deployments). */
  showConsent = false;
  /** True while the info popover is pinned open by a click/tap (hover shows it without this on desktop). */
  infoOpen = false;

  /** Unique per instance so several toggles on one page do not share an aria-describedby target. */
  readonly popoverId = `tier-toggle-info-${++popoverSeq}`;

  /** The single in-flight READ, held so this instance can detach from it (see `cancelRead`). */
  private readSub: Subscription | null = null;
  /** This instance's subscription to the book's shared answer channel. The ONLY thing that sets `status`. */
  private watchSub: Subscription | null = null;

  constructor(private aiTier: AiTierService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['task'] || changes['scope']) {
      // A consent panel opened for the PREVIOUS task must never be confirmable into flipping the NEW one,
      // and a save error / pinned popover about the previous task is noise on this one.
      this.showConsent = false;
      this.saveError = null;
      this.infoOpen = false;
    }
    if (changes['bookId'] || changes['bookLanguage']) {
      this.showConsent = false;
      this.saveError = null;
      this.infoOpen = false;
      // A BOOK switch abandons the previous book's in-flight write, whose handlers early-return on the
      // book-id guard BEFORE clearing this latch: without the reset a PUT resolving after the switch leaves
      // the newly shown book locked with both options aria-disabled forever. Scoped to a bookId change on
      // purpose: on a language-only change the write's own handler still passes its guard and clears the
      // latch itself, and clearing it here would admit a second overlapping write.
      if (changes['bookId']) this.saving = false;
      // A book change may join a read another toggle just issued for that book (that is how the dashboard's
      // two toggles cost one GET). A LANGUAGE change must not: the language decides which tasks can move at
      // all, so an answer computed before it is worthless however recent it is.
      this.reload(!!changes['bookId']);
    }
    // A task change deliberately does NOT re-read: the DTO in hand already carries every task.
  }

  ngOnDestroy(): void {
    this.cancelRead();
    this.stopWatching();
  }

  /**
   * Re-reads this book's tier. `joinInFlight` is for the MOUNT path only, where an identical read another
   * toggle just issued is exactly the answer wanted; every other caller (the retry button, a language change,
   * the post-failure re-read) forces a fresh read that supersedes anything already in flight, which is why
   * the default is false.
   */
  reload(joinInFlight = false): void {
    const bookId = this.bookId;
    // Detach from any read already in flight, INCLUDING one for this same book: the request below takes a
    // newer stamp, so the service will drop the older answer for everyone (not just for this instance).
    this.cancelRead();
    this.status = null;
    this.loadError = false;
    this.stopWatching();
    if (!bookId) {
      this.loading = false;
      return;
    }
    // Subscribed BEFORE the read is issued so the read's own answer arrives through the same one channel that
    // a sibling toggle's write does, rather than through a second, privately-ordered path.
    this.watchSub = this.aiTier.watch(bookId).subscribe({
      next: (dto) => this.accept(bookId, dto),
      // The channel is documented never to error; the handler is here so that a future change which makes it
      // errorable cannot leave this subscription without one.
      error: () => this.cdr.detectChanges(),
    });
    this.loading = true;
    const read$ = joinInFlight ? this.aiTier.get(bookId) : this.aiTier.refresh(bookId);
    this.readSub = read$.subscribe({
      next: (dto) => {
        if (this.bookId !== bookId) return; // dropped: the host switched books
        this.loading = false;
        // The answer normally arrives through the channel a moment earlier. It does not when the service
        // judged it superseded - and if THAT left this instance with nothing at all to show (the superseding
        // read belonged to a toggle that has since been destroyed), an answer this instance really received
        // beats an empty control. The guard is against overwriting a newer answer that has ALREADY ARRIVED;
        // it is not a claim that no newer answer exists. One still in flight has not set `status` yet, so a
        // superseded answer can paint here first - and is then replaced through the channel the moment the
        // newer one lands, which is why "briefly stale" is the worst this can be and "blank" is not.
        if (!this.status) this.status = dto;
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

  /** Paints an answer the service accepted as current for this book, whichever toggle's call produced it. */
  private accept(bookId: string, dto: BookAiTierDto): void {
    if (this.bookId !== bookId) return; // the host switched books while the channel was still hooked up
    this.status = dto;
    // A server answer IS a load result, so a stale "could not load / retry" line beside real data would be a
    // lie. Nothing else per-instance is touched: `loading` still means "a read of MINE is in flight", and a
    // save failure is about this control's own attempt, so neither is the shared channel's to clear.
    this.loadError = false;
    this.cdr.detectChanges();
  }

  /**
   * Detaches from the in-flight read, if any, and lowers `loading` with it. `loading` means "a read is in
   * flight", and `reload()` is the only place that raises it, so clearing it here makes that an invariant
   * every call site inherits instead of a line each caller must remember to copy. It does NOT cancel the
   * request for other instances: the shared read is aborted only when its last subscriber detaches, and
   * whether its answer may still repaint anyone is the service's decision, not this instance's.
   */
  private cancelRead(): void {
    this.readSub?.unsubscribe();
    this.readSub = null;
    this.loading = false;
  }

  private stopWatching(): void {
    this.watchSub?.unsubscribe();
    this.watchSub = null;
  }

  // ── Scope resolution ────────────────────────────────────────────────────────

  /** The AiTaskType key this instance addresses, or null in book scope / for a type with no tier control. */
  get taskKey(): AiTaskKey | null {
    return this.scope === 'book' ? null : resolveAiTaskKey(this.task);
  }

  /**
   * Whether this control renders at all.
   *
   * Wave 3 / w5 - THE Q11-A RESIDUE. Q11 itself is a no-op by decision (the tier control stays at the
   * point of use), but the owner's answer named one thing to fix: for the two passes where the control
   * simply VANISHED (Summarization and Custom, the two analysis types with no user-facing tier), an
   * unexplained absence is replaced by a disabled state with a reason. So this is now true whenever a task
   * is bound at all; {@link noTierControl} decides which of the two shapes renders.
   */
  get visible(): boolean {
    return this.scope === 'book' || this.taskKey !== null || this.noTierControl;
  }

  /**
   * True for a bound analysis type that has NO tier control at all (Summarization, Custom).
   *
   * The disabled state this drives asserts nothing the app has not computed: it does not paint a selected
   * tier, because the server reports no tier row for these tasks and inventing one would be exactly the
   * "answer the server did not give" this component's contract forbids. It states the fact that IS known -
   * that this pass has no tier choice - and says so where the control used to disappear.
   */
  get noTierControl(): boolean {
    return this.scope === 'task' && !!(this.task ?? '').trim() && this.taskKey === null;
  }

  /** This task's row on the DTO. Null in book scope, or when the server did not report the task. */
  get taskStatus(): BookAiTierTaskDto | null {
    const key = this.taskKey;
    if (!key || !this.status) return null;
    return (this.status.tasks ?? []).find((t) => t.task === key) ?? null;
  }

  /** True once there is a server answer for THIS scope, so the options can render. */
  get hasAnswer(): boolean {
    if (!this.status) return false;
    return this.scope === 'book' ? true : this.taskStatus !== null;
  }

  /**
   * What will actually run: the task's `effectiveTier`, or the book default in book scope. NO CLAMPING HERE
   * (be-c01): the server already reports the tier that will route, so a task that cannot move reads 'fast'
   * on the wire. Re-deriving it client-side would be a second copy of the routing precedence, which is the
   * one thing this component's contract forbids.
   */
  get selectedTier(): AiTierValue {
    if (this.scope === 'book') return this.status?.tier ?? 'fast';
    return this.taskStatus?.effectiveTier ?? this.status?.tier ?? 'fast';
  }

  private get readiness(): AiTierReadiness | null {
    return this.scope === 'book'
      ? this.status?.thinkingReadiness ?? null
      : this.taskStatus?.thinkingReadiness ?? null;
  }

  /** True when this setting resolves 'thinking' but is running locally anyway (the visible-fallback flag). */
  get fallbackActive(): boolean {
    return this.scope === 'book' ? !!this.status?.fallbackActive : !!this.taskStatus?.fallbackActive;
  }

  /**
   * Whether the thinking option is selectable at all. Anything other than a 'ready' verdict means the server
   * rejects the write with a 409, so an enabled control would be an invitation to a refusal.
   */
  get canChooseThinking(): boolean {
    return this.readiness === 'ready';
  }

  /** The one-sentence reason the thinking option is unavailable. Empty when it is available. */
  get reasonText(): string {
    switch (this.readiness) {
      case 'taskNotEligible':
        return this.label('reasonTaskNotEligible');
      case 'languageAlwaysFast':
        return this.label('reasonLanguageAlwaysFast');
      case 'routeNotConfigured':
        return this.label('reasonRouteNotConfigured');
      case 'providerNotRegistered':
        return this.label('reasonProviderNotRegistered');
      case 'providerCredentialsMissing':
        return this.label('reasonCredentialsMissing');
      default:
        return '';
    }
  }

  /** True when this task carries its OWN override, so "follow the book default again" is a real action. */
  get canFollowBookDefault(): boolean {
    return this.scope === 'task' && !!this.taskStatus && this.taskStatus.storedTier !== null && !this.saving;
  }

  /** Accessible name for the radio group: the setting this instance changes. */
  get groupAriaLabel(): string {
    return this.scope === 'book' ? this.label('bookDefaultTitle') : this.label('groupAria');
  }

  // ── Localization (book-scoped chrome: follows bookLanguage, Hebrew default) ──

  private get langKey(): 'he' | 'en' {
    return (this.bookLanguage ?? 'he').toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  get dir(): 'rtl' | 'ltr' {
    return this.langKey === 'he' ? 'rtl' : 'ltr';
  }

  /**
   * Localized chrome. Looks up {@link TIER_TOGGLE_LABELS_HE} / {@link TIER_TOGGLE_LABELS_EN}, falling back to
   * the key itself for an unknown key (several tests rely on that fallback to catch a missing key).
   */
  label(key: string): string {
    const map = this.langKey === 'he' ? TIER_TOGGLE_LABELS_HE : TIER_TOGGLE_LABELS_EN;
    return map[key] ?? key;
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  /** Pins the info popover open for touch. On a pointer device hover/focus reveals it without a click. */
  toggleInfo(): void {
    this.infoOpen = !this.infoOpen;
  }

  /**
   * Picks the thinking tier. With `consentRequired` it opens the inline confirm first; without it (a hosted
   * deployment, where both tiers are already off this machine) it commits directly. The guard mirrors the
   * option button's `aria-disabled` expression, because an aria-disabled button stays focusable and
   * clickable for keyboard users, so the handler itself must no-op.
   */
  requestThinking(): void {
    if (!this.canChooseThinking || this.saving || this.selectedTier === 'thinking') return;
    this.saveError = null;
    if (this.status?.consentRequired) {
      this.showConsent = true;
      return;
    }
    this.write('thinking');
  }

  cancelConsent(): void {
    this.showConsent = false;
  }

  confirmThinking(): void {
    this.write('thinking');
  }

  /**
   * Opting back out needs no consent: it can only reduce what leaves the machine. Guarded to mirror the fast
   * option's `aria-disabled` expression for the same focusability reason as above.
   */
  chooseFast(): void {
    if (this.saving || this.selectedTier === 'fast') return;
    this.showConsent = false;
    this.write('fast');
  }

  /** Drops this task's override so it inherits the book default again (the explicit clear verb). */
  followBookDefault(): void {
    const bookId = this.bookId;
    const taskKey = this.taskKey;
    if (!bookId || !taskKey || this.saving || !this.canFollowBookDefault) return;
    this.showConsent = false;
    this.submit(this.aiTier.clearTask(bookId, taskKey), bookId);
  }

  private write(tier: AiTierValue): void {
    const bookId = this.bookId;
    if (!bookId || this.saving) return;
    const taskKey = this.taskKey;
    if (this.scope === 'task' && !taskKey) return;
    const request$ =
      this.scope === 'book'
        ? this.aiTier.setBookDefault(bookId, tier)
        : this.aiTier.setTask(bookId, taskKey!, tier);
    this.submit(request$, bookId);
  }

  /**
   * Shared write path for every mutation (set task, set book default, clear override). All three return the
   * whole DTO, so all three repaint from the SERVER's answer rather than from what was asked for, and all
   * three supersede an overlapping read - for every toggle on the book, not just this one: the service
   * publishes the answer to the shared channel before this handler runs.
   *
   * It is also the ONE place {@link tierChanged} fires from, which is what makes "one write, one event" true
   * for all three mutations at once (see that field for why the emit is not driven off the shared channel).
   */
  private submit(request$: Observable<BookAiTierDto>, bookId: string): void {
    this.saving = true;
    this.saveError = null;
    request$.subscribe({
      next: () => {
        if (this.bookId !== bookId) return; // the host switched books mid-write
        // A read issued before this write landed is older by construction; without this detach it would
        // resolve afterwards and leave the spinner up over an answer that is already on screen. It does not
        // need to assign `status`: the answer arrived through the channel, which is the ONE painting path.
        this.cancelRead();
        this.saving = false;
        this.showConsent = false;
        this.cdr.detectChanges();
        // Last, so a host handler that re-reads its own model-dependent status observes this control already
        // settled on the server's answer rather than mid-write.
        this.tierChanged.emit();
      },
      error: (err) => {
        if (this.bookId !== bookId) return;
        this.saving = false;
        this.showConsent = false;
        // A 409 means the server judged the tier unroutable between the read and the write (a key removed, a
        // config reload, a language change). Say that specifically rather than "try again", which would be
        // wrong advice. Consent never softens it: the 409 is an authorization answer, consent is a UI step.
        this.saveError = err?.status === 409 ? this.label('saveRejected') : this.label('saveError');
        // Re-read so the control shows the server's current verdict rather than a stale 'ready'. Held and
        // superseded like every other read, and deliberately WITHOUT blanking the status or raising the
        // spinner, so the last good answer stays on screen while the verdict is re-fetched. It goes through
        // `refresh`, not `get`: joining a read that was already in flight when the write was refused would be
        // joining an answer computed BEFORE the refusal, which is the stale 'ready' this exists to replace.
        this.cancelRead();
        this.readSub = this.aiTier.refresh(bookId).subscribe({
          // The verdict paints through the channel, so every other toggle on the book learns it too.
          next: () => this.cdr.detectChanges(),
          error: () => this.cdr.detectChanges(),
        });
        this.cdr.detectChanges();
      },
    });
  }
}
