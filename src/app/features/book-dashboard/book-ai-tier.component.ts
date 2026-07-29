import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiTierService } from '../../core/services/ai-tier.service';
import { BookAiTierDto } from '../../core/models/book';

/**
 * THE MODEL-TIER CONTROL (model-tier-fast-thinking plan, p3-4). One control, per book, on the book-scoped
 * dashboard.
 *
 * WHAT THIS COMPONENT IS ACTUALLY FOR. The tier is not a quality slider; it is a privacy and money decision
 * with a measured, NARROW benefit, and every design choice here follows from that:
 *
 *  • OPT-IN, WITH A CONSENT STEP. Choosing "thinking" sends this unpublished book's chapter text to a
 *    third-party provider. The default is fast for every book, and switching to thinking goes through an
 *    explicit confirm whose body restates the privacy sentence at the moment of the decision.
 *
 *  • THE EXCLUSIONS ARE NAMED ONE BY ONE. Phase 2 measured the cloud tier PER TASK and gave a GO on exactly
 *    two: linguistic analysis and HEBREW proofreading. Whole-book review and English proofreading are NO-GO
 *    because they are unmeasured, and term repair is excluded by a standing cost/privacy decision that is
 *    independent of quality. Copy that said "some features" would let a user believe their whole-book review
 *    got better, which is the specific claim the measurements do not support. So the copy lists them.
 *
 *  • IT SHOWS WHAT WILL ACTUALLY RUN, NOT WHAT WAS ASKED FOR. The routes come from the server, resolved by
 *    the same function the AI router resolves through. Two states this makes visible that a bare tier label
 *    would hide: an ENGLISH book keeps local proofreading even on the thinking tier (the language key
 *    outranks the tier key), and a book whose stored tier can no longer route falls back to the local model.
 *    That fallback is rendered as a warning, never swallowed - the point of the `fallbackActive` flag.
 *
 * NO NEW POLLING. It reads once per (bookId, language) change and after a successful write, matching the
 * sibling status rows' reset-on-book-switch behaviour.
 */
@Component({
  selector: 'app-book-ai-tier',
  standalone: true,
  templateUrl: './book-ai-tier.component.html',
  styleUrl: './book-ai-tier.component.scss',
})
export class BookAiTierComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], AND the routes read. */
  @Input() bookLanguage: string | null = null;

  status: BookAiTierDto | null = null;
  loading = false;
  loadError = false;
  saving = false;
  saveError: string | null = null;
  /** True while the explicit opt-in confirm for the thinking tier is open. */
  showConsent = false;

  /**
   * The single in-flight READ, held so a new read can cancel the previous one.
   *
   * The `this.bookId !== bookId` guards below are context-CHANGE guards: they drop a response that arrived
   * after the host switched books, and nothing more. They do NOT cover two reads for the SAME book resolving
   * out of order, which is reachable twice over: `ngOnChanges` re-enters `reload()` on a bookLanguage change
   * while a read is still open, and the post-failure re-read in `write()` can race a concurrent `reload()`.
   * Whichever response lands last wins, so an older snapshot can overwrite a newer one and leave a stale
   * readiness verdict and a stale routes list on screen. Those are the two things this surface exists to
   * state truthfully, so the reads supersede one another instead.
   *
   * THREE supersession points, not two (final-r02 added the third): `reload()`, the post-failure re-read in
   * `write()`, and `write()`'s SUCCESS handler - a read issued before a write landed is older than the
   * write's own answer, so it must not be allowed to repaint the pre-write state over it.
   */
  private readSub: Subscription | null = null;

  constructor(private aiTier: AiTierService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    // The book's LANGUAGE changes which model each task resolves to (an English book's proofreading never
    // reaches the tier), so the routes must be re-read on a language change, not only on a book change.
    if (changes['bookId'] || changes['bookLanguage']) {
      this.showConsent = false;
      this.saveError = null;
      // A BOOK switch abandons the previous book's in-flight write, and both of `write()`'s handlers
      // early-return on the book-id guard BEFORE clearing this latch. Every other piece of state already
      // re-initializes on a book switch (`reload()` below resets status, loading and loadError, exactly as
      // the sibling summaries control resets its own row latches on reload), so `saving` was simply missing
      // from that list: a PUT resolving after the switch left the newly shown book locked forever, showing
      // the saving spinner with both tier options aria-disabled.
      //
      // Scoped to a bookId change deliberately. On a LANGUAGE-only change the book id is unchanged, so the
      // write's own handler still passes its guard and clears the latch itself; clearing it here would
      // instead unlock the buttons while that same book's PUT is still in flight and admit a second
      // overlapping write.
      //
      // Also deliberately NOT fixed by clearing `saving` before the guard inside the handlers: a late
      // response for book A would then clear the latch out from under book B's own in-flight write.
      if (changes['bookId']) this.saving = false;
      this.reload();
    }
  }

  /**
   * Angular 18 does not throw on a `detectChanges()` after teardown here (verified in a live browser with a
   * delayed GET and the component unmounted mid-flight: no error, no console output), so this is hygiene
   * rather than a crash fix. It stops an abandoned read from holding the component and its handler alive.
   */
  ngOnDestroy(): void {
    this.cancelRead();
  }

  reload(): void {
    const bookId = this.bookId;
    // Supersede any read already in flight, INCLUDING one for this same book, so the newest read is always
    // the one that gets to write `status`.
    this.cancelRead();
    this.status = null;
    this.loadError = false;
    if (!bookId) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.readSub = this.aiTier.get(bookId).subscribe({
      next: (dto) => {
        // Drop a response that arrived after the host switched books.
        if (this.bookId !== bookId) return;
        this.status = dto;
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

  /**
   * Drops the in-flight read, if any. Safe to call when there is none or when it already completed.
   *
   * IT ALSO CLEARS `loading`, and that belongs here rather than at each call site (Bugbot round 2, PR #28).
   * `loading` is raised in exactly ONE place, `reload()`, immediately after starting a read, and it is
   * lowered only by that read's own next/error handlers. So unsubscribing the read destroys the only code
   * path that could ever lower it: `write()`'s success handler supersedes the read (final-r02) and its
   * failure handler cancels before re-reading, and BOTH left the spinner up forever whenever a `reload()`
   * was open at the time - a bookLanguage change or the retry button during a PUT. The control then rendered
   * the loading label on top of a perfectly good tier it had just received.
   *
   * Clearing it at the two write sites instead would be two hand-copied lines that the next caller of
   * cancelRead() would not know to copy. Putting it here makes it an INVARIANT: `loading` means "a read is
   * in flight", so dropping the read makes it false by definition. `reload()` re-raises it right after, and
   * the post-failure re-read deliberately leaves it down (it keeps rendering the last good answer while it
   * re-fetches, per its own note), so all four call sites are correct without one of them naming the latch.
   */
  private cancelRead(): void {
    this.readSub?.unsubscribe();
    this.readSub = null;
    this.loading = false;
  }

  // ── Localization (book-scoped chrome: follows bookLanguage, Hebrew default) ──

  private get langKey(): 'he' | 'en' {
    return (this.bookLanguage ?? 'he').toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  get dir(): 'rtl' | 'ltr' {
    return this.langKey === 'he' ? 'rtl' : 'ltr';
  }

  /** True when at least one allowlisted task is actually routed to the cloud right now. */
  get anyRouteUsesTier(): boolean {
    return !!this.status?.routes?.some((r) => r.usesTier);
  }

  /**
   * Whether the thinking option is selectable at all. Anything other than a "ready" server verdict means
   * the tier cannot route on this deployment, and the server rejects the write, so offering an enabled
   * control would be an invitation to a 409.
   */
  get canChooseThinking(): boolean {
    return this.status?.thinkingReadiness === 'ready';
  }

  /** The sentence explaining a non-ready readiness verdict. Empty when the tier is ready. */
  get unavailableReasonText(): string {
    switch (this.status?.thinkingReadiness) {
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

  taskLabel(task: string): string {
    if (task === 'LinguisticAnalysis') return this.label('taskLinguistic');
    if (task === 'Proofread') return this.label('taskProofread');
    return task;
  }

  /**
   * Localized static chrome. DRAFT Hebrew: flag for native-speaker review before sign-off, matching the
   * standing caveat on the other book-scoped surfaces. No em-dash in any user-facing string.
   */
  label(key: string): string {
    const he: Record<string, string> = {
      title: 'שכבת המודל של הספר',
      loading: 'טוען...',
      saving: 'שומר...',
      retry: 'נסו שוב',
      cancel: 'ביטול',
      loadError: 'טעינת הגדרת השכבה נכשלה.',
      saveError: 'שמירת השכבה נכשלה. נסו שוב.',
      saveRejected: 'השרת דחה את הבקשה: שכבת החשיבה אינה זמינה כאן. הספר נשאר בשכבה מהירה.',

      tierFast: 'מהיר',
      tierThinking: 'חשיבה',
      fastDesc: 'מודל מקומי. חינם, פרטי, והטקסט אינו יוצא מהמחשב הזה.',
      thinkingDesc: 'מודל בענן. איכות מדודה גבוהה יותר, עולה כסף, והטקסט נשלח לספק חיצוני.',

      privacy:
        'בחירה בשכבת החשיבה שולחת את טקסט הפרקים של הספר לספק צד שלישי (OpenRouter), כלומר הטקסט יוצא מהמחשב הזה. ' +
        'מדובר בספר שטרם פורסם, ולכן הבחירה היא הצטרפות מפורשת בלבד: ברירת המחדל היא מהיר, וכל הטקסט נשאר מקומי.',
      appliesTo: 'השכבה חלה על שתי משימות בלבד: ניתוח לשוני, והגהה בעברית.',
      doesNotApplyTo:
        'היא אינה חלה על סקירת ספר שלם, על הגהה באנגלית, על עריכת שורה, על תקצירי פרקים וספר, ועל תיקון מונחים. ' +
        'משימות אלה ממשיכות לרוץ על המודל המקומי בשתי השכבות.',

      consentTitle: 'לאשר שליחת טקסט הספר לספק חיצוני?',
      consentConfirm: 'אני מאשר, עברו לשכבת חשיבה',

      fallbackWarning:
        'הספר מוגדר לשכבת חשיבה, אך מודל הענן אינו מוגדר בשרת הזה. הריצות מתבצעות בפועל על המודל המקומי המפורט למטה.',
      reasonRouteNotConfigured: 'שכבת החשיבה אינה מוגדרת בשרת הזה, ולכן אין לאן לנתב אותה.',
      reasonProviderNotRegistered:
        'שכבת החשיבה מפנה לספק שאינו רשום בשרת הזה, ולכן ריצה בשכבה זו תיכשל.',
      reasonCredentialsMissing:
        'לספק הענן אין מפתח גישה בשרת הזה, ולכן ריצה בשכבת חשיבה תיכשל.',

      routesTitle: 'מה ירוץ בפועל',
      routeCloud: 'ענן',
      routeLocal: 'מקומי',
      taskLinguistic: 'ניתוח לשוני',
      taskProofread: 'הגהה',
    };

    const en: Record<string, string> = {
      title: 'Model tier for this book',
      loading: 'Loading...',
      saving: 'Saving...',
      retry: 'Retry',
      cancel: 'Cancel',
      loadError: 'Could not load the tier setting.',
      saveError: 'Could not save the tier. Try again.',
      saveRejected: 'The server refused: the thinking tier is not available here. The book stays on fast.',

      tierFast: 'Fast',
      tierThinking: 'Thinking',
      fastDesc: 'Local model. Free, private, and the text never leaves this machine.',
      thinkingDesc: 'Cloud model. Measurably better quality, costs money, and the text is sent to a third-party provider.',

      privacy:
        'Choosing the thinking tier sends the chapter text of this book to a third-party provider (OpenRouter), ' +
        'which means the text leaves this machine. This is an unpublished book, so the choice is explicit opt-in ' +
        'only: the default is fast, and all text stays local.',
      appliesTo: 'The tier applies to two tasks only: linguistic analysis, and Hebrew proofreading.',
      doesNotApplyTo:
        'It does not apply to whole-book review, to English proofreading, to line edit, to chapter and book ' +
        'summaries, or to term repair. Those keep running on the local model on both tiers.',

      consentTitle: 'Send the text of this book to a third-party provider?',
      consentConfirm: 'I agree, switch to thinking',

      fallbackWarning:
        'This book is set to the thinking tier, but the cloud model is not configured on this server. ' +
        'Runs are actually using the local model listed below.',
      reasonRouteNotConfigured: 'The thinking tier is not configured on this server, so there is nothing to route to.',
      reasonProviderNotRegistered:
        'The thinking tier points at a provider that is not registered on this server, so a run on it would fail.',
      reasonCredentialsMissing:
        'The cloud provider has no API key on this server, so a thinking-tier run would fail.',

      routesTitle: 'What will actually run',
      routeCloud: 'Cloud',
      routeLocal: 'Local',
      taskLinguistic: 'Linguistic analysis',
      taskProofread: 'Proofreading',
    };

    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Opens the explicit opt-in confirm. Never writes directly. The guard mirrors the option button's
   * `aria-disabled` expression in the template (`saving || status.tier === 'thinking' || !canChooseThinking`):
   * the button stays focusable for keyboard users even when aria-disabled, so the click handler itself must
   * no-op, including the re-pick-the-current-tier case.
   */
  requestThinking(): void {
    if (!this.canChooseThinking || this.saving || this.status?.tier === 'thinking') return;
    this.saveError = null;
    this.showConsent = true;
  }

  cancelConsent(): void {
    this.showConsent = false;
  }

  confirmThinking(): void {
    this.write('thinking');
  }

  /**
   * Opting back out needs no consent: it can only reduce what leaves the machine. Guarded to mirror the
   * fast option button's `aria-disabled` expression (`saving || status.tier === 'fast'`), since that button
   * stays focusable while aria-disabled, so re-picking the already-selected fast tier must not issue a write.
   */
  chooseFast(): void {
    if (this.saving || this.status?.tier === 'fast') return;
    this.showConsent = false;
    this.write('fast');
  }

  private write(tier: 'fast' | 'thinking'): void {
    const bookId = this.bookId;
    if (!bookId || this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.aiTier.set(bookId, tier).subscribe({
      next: (dto) => {
        if (this.bookId !== bookId) return;
        // final-r02: a WRITE's answer supersedes any read still in flight too. That read was issued before
        // this write landed, so its snapshot is older by construction; without this, a `reload()` that
        // overlapped the PUT (a bookLanguage change, or the retry button) would resolve afterwards and
        // repaint the PRE-write tier and routes over the server's post-write answer. The failure path below
        // already cancels for the same reason; only the success path was missing it.
        this.cancelRead();
        // Re-render from the SERVER's answer, not from what was asked for: it carries the readiness and the
        // routes, and those are the only trustworthy statement of what will run.
        this.status = dto;
        this.saving = false;
        this.showConsent = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (this.bookId !== bookId) return;
        this.saving = false;
        this.showConsent = false;
        // A 409 means the server judged the tier unroutable between the read and the write (a key removed,
        // a config reload). Say that specifically rather than "try again", which would be wrong advice.
        this.saveError = err?.status === 409 ? this.label('saveRejected') : this.label('saveError');
        // Re-read so the control shows the server's current verdict rather than a stale "ready". Held and
        // superseded like every other read: this one races a concurrent reload() by construction, and it
        // deliberately does NOT blank `status` or raise the spinner, so the control keeps rendering the last
        // good answer while the verdict is re-fetched.
        this.cancelRead();
        this.readSub = this.aiTier.get(bookId).subscribe({
          next: (dto) => {
            if (this.bookId !== bookId) return;
            this.status = dto;
            this.cdr.detectChanges();
          },
          error: () => this.cdr.detectChanges(),
        });
        this.cdr.detectChanges();
      },
    });
  }
}
