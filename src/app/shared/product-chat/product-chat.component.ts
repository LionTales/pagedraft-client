import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostBinding,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { MarkdownTextComponent } from '../../features/analysis-panel/markdown-text.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { ProductChatService } from '../../core/services/product-chat.service';
import {
  ChatLanguage,
  ProductChatResponseDto,
  ProductChatTurnDto,
} from '../../core/models/product-chat';
import {
  ChatChromeLang,
  ChatStringKey,
  chatString,
  faultMessage,
  guideTitle,
} from '../../core/i18n/chat-strings';

// ── Transcript entries ────────────────────────────────────────────────────────────────────────────

/** Something the author typed. */
export interface UserEntry {
  kind: 'user';
  id: number;
  text: string;
}

/**
 * Something the assistant actually said, grounded in guides. `guideIds` may be empty in principle,
 * but a grounded answer from this server always names at least one guide; the template renders the
 * citation block only when there is something to cite rather than an empty label.
 */
export interface AssistantEntry {
  kind: 'assistant';
  id: number;
  text: string;
  guideIds: string[];
  language: ChatLanguage;
}

/**
 * The assistant DECLINING to speak. Not an assistant turn, and rendered nothing like one.
 *
 * This is the entry type the whole feature is built around. `isGrounded: false` means the server
 * refused to put an ungrounded answer in front of the author, and if the client rendered that refusal
 * in an assistant bubble it would have undone the refusal - the author would read a message from the
 * assistant and treat it as one. So a fault gets its own entry kind, its own block, its own copy, and
 * is never fed back into the history sent to the server.
 *
 * `question` is kept so the author can retry the exact thing they asked instead of retyping it.
 * `reason` is the raw wire code (or the client-side `network`), resolved to prose at render time.
 */
export interface FaultEntry {
  kind: 'fault';
  id: number;
  reason: string;
  question: string;
}

export type ChatEntry = UserEntry | AssistantEntry | FaultEntry;

/**
 * The product assistant: the ASSISTANT TAB of the app dock, answering questions about PageDraft from
 * the shipped guides with a citation on every answer (chatbot phase A, c2; merged in A.1, w1).
 *
 * ── WHAT THE MERGE MOVED OUT OF HERE ───────────────────────────────────────────────────────────────
 * c2 shipped this as a standalone drawer on the inline-END edge with its own launcher in the bottom
 * inline-end corner, deliberately opposite the Activity Center so the two could not collide. The owner
 * then asked for ONE drawer with tabs and ONE launcher, so the shell is gone: {@link AppDockComponent}
 * owns the launcher, the backdrop, the drawer, the edge it is pinned to (inline-START, which is the
 * physical right in Hebrew, the side the owner asked for), the tab strip that carries this surface's
 * title, and the close and widen controls. The whole non-occlusion argument that used to live here
 * went with them: there is one panel now, so there is no pair to keep apart.
 *
 * What remains is the conversation, gated on {@link AppOverlayService.isTabShowing$} for the assistant
 * tab. The component stays MOUNTED whether or not that tab is showing, which is load-bearing: the
 * transcript lives in this instance for the life of the session, so unmounting it on a tab switch or a
 * close would silently discard the author's conversation.
 *
 * ── Language ───────────────────────────────────────────────────────────────────────────────────────
 * App-level chrome, so Hebrew-default, following the Activity Center's convention and its documented
 * reasoning: this surface is reachable from every route, including ones where no book is open, so
 * there is no book language to follow. `appLang` is hardcoded until a global i18n service exists,
 * exactly as `ActivityCenterComponent.appLang` is. The ANSWER's direction is separate and comes from
 * the server's `language` field per message, so a Hebrew answer reads RTL inside English chrome
 * without the client re-detecting anything.
 *
 * ── Phase A boundary ───────────────────────────────────────────────────────────────────────────────
 * The transcript lives here, in memory, for the life of the session. There is deliberately
 * no history list, no "previous conversations", no token or quota readout, and no settings affordance
 * anywhere in this template, because all three are phase C and the quota one additionally needs a
 * usage-metering backend that does not exist. The UI must not imply a feature that is not there.
 *
 * ── STARTING OVER (A.1, w2) ────────────────────────────────────────────────────────────────────────
 * That session-long transcript is also a liability, and the owner hit it: with two refusals still
 * inside the history window the assistant drifted to answering about a different editing pass than the
 * one asked about, and kept re-litigating the refusals. {@link startNewConversation} is the escape
 * hatch. It empties the transcript so the very next request goes up with an empty `history` array,
 * which is the property that actually stops one bad turn poisoning the rest of the session.
 *
 * It is emphatically NOT phase C: nothing is saved, named, listed or reopenable, and the control that
 * drives it is deliberately unlabelled with any of that vocabulary. Clearing here means gone.
 *
 * THE CONTROL LIVES IN THIS TAB BODY, not in the dock header, on two grounds. The state it acts on
 * ({@link entries}, {@link pending}, the in-flight subscription) lives only here, so a header button
 * would have needed a new cross-component channel purely to know when to be enabled; and the dock
 * header is chrome SHARED by both tabs, where an assistant-only control would have to hide itself on
 * the activity tab, which is the exact leak w1's tab gating exists to prevent.
 *
 * ── Identity (A.2, f1; header dropped f02) ────────────────────────────────────────────────────────
 * The assistant is named Show / שואו. The name is a single string, `drawerTitle`, which the DOCK reads
 * for the assistant tab's label; this component names Show through `roleAssistant` and the empty
 * state's greeting, which are drawn from the same map, so the tab and the per-turn role label can
 * never say two different names. This component renders NO in-pane header: f02 found one rendered
 * directly beneath the dock's own assistant tab, which already carries Show's face and the same name
 * and is the one of the two that survives a scroll, so the pair read as the same identity shown twice
 * rather than as two different things. The tab is what stays. Inside the pane the face now appears in
 * exactly one place, the empty state (f03), which greets the author by name before the first turn and
 * is replaced by the transcript the moment there is one; `roleAssistant` names Show again on every
 * turn after that. So identity is established without a persistent avatar+name block eating vertical
 * space from a narrow drawer.
 *
 * No streaming: the citation is only known once the answer completes, and a streamed reply would put
 * prose the author can act on on screen before anything said where it came from.
 */
@Component({
  selector: 'app-product-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, FormsModule, RouterLink, MarkdownTextComponent],
  templateUrl: './product-chat.component.html',
  styleUrl: './product-chat.component.scss',
})
export class ProductChatComponent implements OnDestroy {
  private readonly chat = inject(ProductChatService);
  private readonly overlays = inject(AppOverlayService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly destroy$ = new Subject<void>();

  /**
   * Fires when the transcript is thrown away.
   *
   * This is the WHOLE in-flight safety mechanism, and it is one mechanism on purpose. Every request is
   * piped through `takeUntil(reset$)` as well as `takeUntil(destroy$)`, so a reset UNSUBSCRIBES the
   * request that belonged to the conversation being discarded: RxJS then guarantees that neither
   * `next` nor `error` can still fire, so there is no code path along which a late answer could be
   * appended to the fresh transcript, and the HTTP request itself is cancelled rather than left to land
   * in the background. A second guard at the append site (a conversation serial, say) would read as
   * belt and braces but would be unreachable, and an unreachable rule is one nobody can see applied.
   */
  private readonly reset$ = new Subject<void>();

  /** Scroll container for the transcript, so a new turn is not left below the fold. */
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;

  /**
   * App-level chrome language. Hebrew-default per the app-level i18n convention (see the class doc).
   * Hardcoded for now because no global i18n service exists; change here when one is added. Kept
   * private and mirrored on {@link lang} so a spec can flip it the same way the Activity Center's
   * spec does.
   */
  private appLang: ChatChromeLang = 'he';

  /**
   * Whether this tab's content is on screen, owned by the shared service.
   *
   * The dock keeps this component mounted either way, so a false here empties the DOM without
   * touching the transcript below it.
   */
  readonly isTabShowing$ = this.overlays.isTabShowing$('assistant');

  /** The in-memory transcript. Session-scoped: nothing here is persisted or reloaded. */
  entries: ChatEntry[] = [];

  /** The composer's text. Two-way bound. */
  draft = '';

  /** A request is in flight. Blocks a second send and drives the in-flight row. */
  pending = false;

  /**
   * The reset is ARMED: the author asked to start over and the destructive step is one deliberate,
   * differently-labelled click away. See {@link requestReset} for why a second click exists at all.
   */
  confirmingReset = false;

  /**
   * Monotonic across resets. Ids are never reused, so a cleared transcript can never collide with the
   * `track` identity of a turn the view is still tearing down.
   */
  private nextId = 1;

  constructor() {
    // Disarm on leaving the tab. Without this the confirmation could sit armed behind a closed drawer
    // and be completed days later by a click the author no longer connects to the question, which is
    // precisely the accident the confirmation exists to prevent.
    this.isTabShowing$.pipe(takeUntil(this.destroy$)).subscribe(showing => {
      if (!showing && this.confirmingReset) {
        this.confirmingReset = false;
        this.cdr.markForCheck();
      }
    });
  }

  /** Dir on the host, so this surface mirrors with the app language even mounted on its own. */
  @HostBinding('attr.dir')
  get dir(): 'rtl' | 'ltr' {
    return this.appLang === 'he' ? 'rtl' : 'ltr';
  }

  /** The chrome language, for the template and for specs. */
  get lang(): ChatChromeLang {
    return this.appLang;
  }

  /** Snapshot of whether this tab is showing, for the imperative paths and for specs. */
  get isShowing(): boolean {
    return this.overlays.isTabShowing('assistant');
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────────

  /** Resolve a localized chrome string. */
  label(key: ChatStringKey): string {
    return chatString(this.appLang, key);
  }

  /** The display title of a cited guide, falling back to the raw id for a guide we do not know. */
  citationTitle(id: string): string {
    return guideTitle(this.appLang, id);
  }

  /** The singular or plural citation label, so one guide does not get introduced as several. */
  citationLabel(ids: string[]): string {
    return this.label(ids.length === 1 ? 'citationOne' : 'citationMany');
  }

  /**
   * A citation chip was clicked (A.2, c1). The chip's own `routerLink` does the navigating; this
   * CLOSES the dock.
   *
   * DECISION, stated because the plan asked for one: the drawer closes rather than staying open. It is
   * a full-height panel on the inline-start edge with no modal semantics, so leaving it open would put
   * it directly over the guide it just sent the author to, and at a narrow viewport it covers nearly
   * all of it. Closing costs nothing that matters: this component stays MOUNTED across a close, so the
   * transcript, the composer's contents and the scroll position are all still there when the launcher
   * is used again. The alternative (stay open) would trade a real occlusion for a saving that the
   * mounting already provides.
   *
   * `close()` on the service rather than `closeTab('assistant')`: the author is looking at the
   * assistant tab by definition (this chip is in its transcript), and the dock as a whole is what has
   * to get out of the way.
   */
  openCitation(): void {
    this.overlays.close();
  }

  /** The honest sentence for a fault code. Distinct per reason; never a generic catch-all. */
  faultText(reason: string): string {
    return faultMessage(this.appLang, reason);
  }

  /** Per-message direction, from the SERVER's answer language. Never re-detected here. */
  dirFor(language: ChatLanguage): 'rtl' | 'ltr' {
    return language === 'he' ? 'rtl' : 'ltr';
  }

  // ── Entry narrowing for the template ────────────────────────────────────────────────────────────
  //
  // Angular's template type checker does not narrow a discriminated union from an `@if` condition, so
  // each branch asks for its own already-narrowed value via `@if (asX(entry); as x)`. Returning null
  // rather than a boolean is what makes the narrowing survive into the block.

  asUser(entry: ChatEntry): UserEntry | null {
    return entry.kind === 'user' ? entry : null;
  }

  asAssistant(entry: ChatEntry): AssistantEntry | null {
    return entry.kind === 'assistant' ? entry : null;
  }

  asFault(entry: ChatEntry): FaultEntry | null {
    return entry.kind === 'fault' ? entry : null;
  }

  // ── Showing / hiding ────────────────────────────────────────────────────────────────────────────
  //
  // The dock owns the launcher, the close button, the widen control and Escape. All this surface can
  // do is bring its own tab forward, which is what a deep link or a keyboard shortcut into the
  // assistant would use.

  /** Bring the assistant tab forward, opening the dock if it is closed. */
  show(): void {
    this.overlays.openTab('assistant');
  }

  /** Dismiss this tab. A no-op if the author has already switched to the other one. */
  close(): void {
    this.overlays.closeTab('assistant');
  }

  // ── Starting over ───────────────────────────────────────────────────────────────────────────────

  /**
   * Whether there is anything a reset would throw away.
   *
   * The control is not rendered at all when this is false, which is the cheapest of the three guards:
   * in the empty state there is no button to mis-click, and the affordance appears exactly when it has
   * become useful.
   */
  get hasConversation(): boolean {
    // A request in flight always has its own user turn in the transcript already, so this covers the
    // in-flight case without a second clause that nothing could reach.
    return this.entries.length > 0;
  }

  /**
   * ARM the reset. The first click destroys nothing.
   *
   * A one-click reset of a long thread is unrecoverable here in a way it is not in a product with
   * saved history: phase A persists nothing, so a mis-click is the conversation, gone. Hence a
   * two-step gesture whose second step is labelled with what it does rather than "OK".
   *
   * Refused while a request is in flight, so the armed state cannot be waiting when the answer lands.
   */
  requestReset(): void {
    if (this.pending || !this.hasConversation) return;
    this.confirmingReset = true;
  }

  /** Stand down, leaving the transcript untouched. */
  cancelReset(): void {
    this.confirmingReset = false;
  }

  /** The second, deliberate click. Only this one clears anything. */
  confirmReset(): void {
    if (!this.confirmingReset || this.pending) return;
    this.startNewConversation();
  }

  /**
   * Empty the transcript so the next question is asked clean.
   *
   * Public because it is the mechanism rather than the gesture: the UI reaches it only through the
   * two-step confirmation above, and it is written to be SAFE on its own terms so that any other
   * caller (a keyboard shortcut, a spec, a future deep link) cannot corrupt the fresh transcript.
   * `reset$` unsubscribes anything in flight before the transcript is replaced, so the discarded
   * conversation's answer can no longer be delivered anywhere. See {@link reset$}.
   *
   * The COMPOSER's text is deliberately left alone: it is what the author is about to say, not part of
   * what they just cleared, and silently blanking it would make a reset destroy more than it offered
   * to.
   */
  startNewConversation(): void {
    this.reset$.next();
    this.entries = [];
    this.pending = false;
    this.confirmingReset = false;
    this.cdr.markForCheck();
  }

  // ── Asking ──────────────────────────────────────────────────────────────────────────────────────

  /** Whether the composer's current contents can be sent. */
  get canSend(): boolean {
    return !this.pending && this.draft.trim().length > 0;
  }

  /** Send whatever is in the composer. */
  submit(): void {
    if (!this.canSend) return;
    const question = this.draft.trim();
    this.draft = '';
    this.ask(question);
  }

  /** Fill the composer from an empty-state example, so the author can edit before sending. */
  useExample(key: ChatStringKey): void {
    this.draft = this.label(key);
  }

  /**
   * Retry a failed exchange.
   *
   * Drops the fault AND the user turn it answered, then re-asks through the ordinary
   * {@link ask} path, so a retried question travels exactly the same code as a fresh one. The
   * alternative - keeping the user turn and re-sending - would either duplicate that turn (once in
   * the history, once as the question) or need a second, differently-shaped send path.
   */
  retry(entry: FaultEntry): void {
    if (this.pending) return;
    const at = this.entries.indexOf(entry);
    if (at < 0) return;
    const from = at > 0 && this.entries[at - 1].kind === 'user' ? at - 1 : at;
    this.entries = this.entries.slice(0, from);
    this.ask(entry.question);
  }

  private ask(question: string): void {
    // Sending is an answer to "did you mean to start over?" as clearly as Cancel is.
    this.confirmingReset = false;
    const history = this.historyForServer();
    this.entries = [...this.entries, { kind: 'user', id: this.nextId++, text: question }];
    this.pending = true;
    this.scrollToLatest();

    this.chat
      .ask(question, history, this.appLang)
      // `reset$` as well as `destroy$`: a reset ends this request outright, so its answer cannot be
      // appended to the transcript that replaced the one it was asked in.
      .pipe(takeUntil(this.destroy$), takeUntil(this.reset$))
      .subscribe({
        next: res => this.acceptResponse(res, question),
        error: () => this.acceptFault('network', question),
      });
  }

  /**
   * Turn a 200 into a transcript entry.
   *
   * The `isGrounded` branch is the entire point of the contract, so it is the FIRST thing tested and
   * the two outcomes produce different entry kinds rather than the same bubble with a flag on it. A
   * fail-safe carries prose in `answer` too, and that prose is deliberately not rendered: the server
   * has only two fail-safe sentences for four fault codes, so the client's per-reason copy says more,
   * and putting server prose in the failure block would make it read like a short answer.
   */
  private acceptResponse(res: ProductChatResponseDto, question: string): void {
    if (!res?.isGrounded) {
      this.acceptFault(res?.faultReason ?? 'unknown', question);
      return;
    }
    this.entries = [
      ...this.entries,
      {
        kind: 'assistant',
        id: this.nextId++,
        text: res.answer ?? '',
        guideIds: res.guideIds ?? [],
        language: res.language === 'en' ? 'en' : 'he',
      },
    ];
    this.settle();
  }

  private acceptFault(reason: string, question: string): void {
    this.entries = [...this.entries, { kind: 'fault', id: this.nextId++, reason, question }];
    this.settle();
  }

  private settle(): void {
    this.pending = false;
    this.cdr.markForCheck();
    this.scrollToLatest();
  }

  /**
   * The transcript as the server should see it.
   *
   * FAULT ENTRIES ARE EXCLUDED. A fail-safe is the assistant declining to speak, so replaying it as
   * an `assistant` turn would condition the next answer on words the assistant never said and would
   * teach it that refusing is the register of this conversation. Only real turns are sent; the
   * service then applies its own upper bound on how many of them go on the wire, and the server
   * applies the window it actually reads.
   */
  private historyForServer(): ProductChatTurnDto[] {
    const turns: ProductChatTurnDto[] = [];
    for (const e of this.entries) {
      if (e.kind === 'user') turns.push({ role: 'user', content: e.text });
      else if (e.kind === 'assistant') turns.push({ role: 'assistant', content: e.text });
    }
    return turns;
  }

  /** Keep the newest turn in view. Deferred a frame so the new node exists before we measure. */
  private scrollToLatest(): void {
    setTimeout(() => {
      const el = this.scroller?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.reset$.complete();
    // Scoped to THIS tab: tearing this body down while the author is reading the activity tab must
    // not close the drawer they are looking at.
    this.overlays.closeTab('assistant');
  }
}
