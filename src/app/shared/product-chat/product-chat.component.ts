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
import { Params, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { MarkdownTextComponent } from '../../features/analysis-panel/markdown-text.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import {
  AmbientChapterChoice,
  AmbientChapterService,
  AmbientChapterState,
} from '../../core/services/ambient-chapter.service';
import { BookContextService, CurrentBook } from '../../core/services/book-context.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { ProductChatService } from '../../core/services/product-chat.service';
import {
  AmbientChapterKey,
  ChatLanguage,
  ProductChatResponseDto,
  ProductChatTurnDto,
} from '../../core/models/product-chat';
import { ChatArtifactRef, parseArtifactRefs } from '../../core/models/chat-artifact-ref';
import { chatArtifactDestination } from '../../core/models/chat-artifact-routing';
import { bookSurfaceFocusToken } from '../../core/services/book-surface-focus.service';
import {
  ChatChromeLang,
  ChatStringKey,
  ambientChapterName,
  artifactChipLabel,
  bookLeftMarker,
  bookSwitchMarker,
  chatString,
  faultMessage,
  guideTitle,
} from '../../core/i18n/chat-strings';
// The transcript's entry types. Re-exported below so this component stays the one import site for
// anything that renders a transcript, which is what it was before the file-size split moved them.
import {
  AssistantEntry,
  BookMarkerEntry,
  ChatEntry,
  FaultEntry,
  UserEntry,
} from './product-chat-entries';

export type {
  AssistantEntry,
  BookMarkerEntry,
  ChatEntry,
  FaultEntry,
  UserEntry,
} from './product-chat-entries';

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
 *
 * ── BOOK CONTEXT (phase B, c2) ─────────────────────────────────────────────────────────────────────
 * The drawer is still app chrome. What changed is that it now KNOWS when it is open inside a book: the
 * bookId rides on every request from there, a compact line under the dock's tab states which book that
 * is, and answers can cite the manuscript's own artifacts as chips beside the guide chips. Outside a
 * book nothing about phase A moves - no bookId on the wire, no context line, no artifact chips, and the
 * server's book-question refusal stands exactly as it shipped.
 *
 * THE BOOK ID COMES FROM THE ROUTE, through {@link BookContextService}, not from a component input.
 * This surface has no host to give it one: it is mounted once by the dock for the life of the app,
 * across every route.
 *
 * ── THE OPEN CHAPTER (phase B, a2) ─────────────────────────────────────────────────────────────────
 * The bookId alone was not enough, and a live owner session is what proved it: asked "זה פרק שעבר
 * עריכה..." about the chapter on screen, Show had the book and answered from a product guide, because
 * nothing on the wire said which chapter "זה" was. So the drawer now also knows the open chapter,
 * through {@link AmbientChapterService} - pushed by the editor page rather than derived from the route,
 * because there is no chapter route segment to derive it from.
 *
 * TWO RULES GOVERN IT, and they outrank every other consideration on this surface:
 *
 *  1. AUTOMATIC FIRST. If the chapter is open on screen, the answer is about it and Show does not ask.
 *     The clarifying question is what happens when nothing resolves, never what happens instead of
 *     resolving, so this component's job is to make sure the key is actually on the wire; a client that
 *     fails to send it turns the whole feature into a prompt.
 *  2. EXPLICIT BEATS AMBIENT. The server enforces this for a chapter NAMED in the question; the client
 *     enforces it for a chapter the author TAPPED on a clarify chip (see {@link chooseChapter}).
 *
 * The context line grew a second value for the same reason it exists at all: once Show can answer about
 * one chapter rather than the whole book, an author who cannot see WHICH chapter cannot tell those two
 * answers apart. It stays a fact and not a setting - the way to change the chapter Show sees is to open
 * a different one.
 *
 * ── DECISION: a book switch KEEPS the transcript, and scopes the HISTORY ───────────────────────────
 * The alternative on the table was a hard reset. It was rejected because it throws away product Q&A
 * that is still perfectly valid - "how do I export?" does not stop being answered because the author
 * opened a different manuscript - and because a conversation that silently empties itself when you
 * navigate is a surface the author stops trusting with anything long.
 *
 * But keeping the transcript raises the exact risk the todo names: the previous book's answers must not
 * SILENTLY carry over. So the switch is handled on two levels, and both are needed:
 *
 *  1. VISIBLY, for the author: a {@link BookMarkerEntry} is inserted at the switch point, saying which
 *     book is in force from here on. Everything above it stays readable and is plainly marked as
 *     belonging to before.
 *  2. ON THE WIRE, for the model: {@link historyForServer} sends only turns whose captured `bookId`
 *     matches the current one, plus every turn taken OUTSIDE a book (those are product Q&A by
 *     definition and are what the "keep it" argument is about). So book A's answers are visible to the
 *     author and invisible to the model once the author is in book B. A marker alone would have left
 *     the model reading book A's chapter summaries while answering about book B, which is fabrication
 *     with a receipt.
 *
 * The one deliberate over-drop: a PRODUCT question asked while book A happened to be open is tagged
 * with book A and is dropped from the wire after a switch. It is the conservative direction, and
 * separating "product question asked inside a book" from "book question" would mean re-deriving on the
 * client the classification the server's prompt owns.
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
  private readonly bookContext = inject(BookContextService);
  private readonly ambientChapters = inject(AmbientChapterService);
  private readonly summaries = inject(BookSummaryService);
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

  /**
   * The book the drawer is currently looking at, or null outside one (phase B). Mirrored from
   * {@link BookContextService} so the OnPush template reads a plain field.
   */
  book: CurrentBook | null = null;

  /**
   * The chapter surface's latest snapshot, or null when no book surface is publishing one (phase B,
   * a2). Mirrored from {@link AmbientChapterService} so the OnPush template reads a plain field.
   *
   * NOT read directly by anything that matters: every consumer goes through {@link ambient}, which
   * additionally checks the snapshot belongs to the book the drawer currently names. The two services
   * move on different ticks during a book switch, and for one frame this can hold the PREVIOUS book's
   * chapter while {@link book} already holds the next one.
   */
  private ambientState: AmbientChapterState | null = null;

  /**
   * Whether the current book has book briefs built, or null while unknown.
   *
   * NULL IS NOT "NO". The tutoring empty state is shown only on a definite false, so a book whose
   * status read has not landed (or failed) gets the ordinary greeting rather than being told its briefs
   * are missing on no evidence. Same rule the dashboard's own first-run panel follows.
   */
  briefsBuilt: boolean | null = null;

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

    this.bookContext.currentBook$
      .pipe(takeUntil(this.destroy$))
      .subscribe(book => this.onBookContextChanged(book));

    // a2: the open chapter, pushed by the editor page. Its own subscription rather than a combineLatest
    // with the book above, because the two are genuinely independent facts arriving on their own ticks
    // and the reconciliation between them is a READ-time check (see {@link ambient}), not a join.
    this.ambientChapters.ambient$.pipe(takeUntil(this.destroy$)).subscribe(state => {
      this.ambientState = state;
      this.cdr.markForCheck();
    });
  }

  // ── Book context (phase B) ──────────────────────────────────────────────────────────────────────

  /**
   * The book changed, or its title landed.
   *
   * The MARKER is keyed on the id, not on the emission: the service emits a second time when the title
   * arrives, and writing a marker for that would put two rules in the transcript for one switch. A
   * marker is also not written for the FIRST book of an empty transcript - there is nothing above it to
   * separate from, and a conversation that opens with "from here on I am looking at X" before a word
   * has been said reads as noise rather than as a boundary.
   */
  private onBookContextChanged(book: CurrentBook | null): void {
    const previousId = this.book?.bookId ?? null;
    const nextId = book?.bookId ?? null;
    this.book = book;

    if (previousId !== nextId) {
      this.briefsBuilt = null;
      if (this.entries.length > 0) {
        this.entries = [
          ...this.entries,
          { kind: 'book-marker', id: this.nextId++, bookId: nextId, title: book?.title ?? null },
        ];
        this.scrollToLatest();
      }
      this.loadBriefsState(book);
    } else if (book && this.book) {
      // Same book, title landed: update the LAST marker for this book in place, so a marker written
      // before the title arrived does not keep saying "this book" forever.
      for (let i = this.entries.length - 1; i >= 0; i--) {
        const entry = this.entries[i];
        if (entry.kind !== 'book-marker') continue;
        if (entry.bookId === book.bookId && entry.title === null && book.title) {
          this.entries = [
            ...this.entries.slice(0, i),
            { ...entry, title: book.title },
            ...this.entries.slice(i + 1),
          ];
        }
        break;
      }
    }

    this.cdr.markForCheck();
  }

  /**
   * Read whether this book has briefs, for the tutoring empty state.
   *
   * The BRIEFS STATUS and not a general book read, because that is the one fact the empty state turns
   * on. A failure leaves {@link briefsBuilt} null, which renders the ordinary greeting: telling an
   * author their briefs are missing because a status GET failed would be the surface fabricating a
   * state, which is the same class of error the whole feature exists to avoid, just in chrome.
   */
  private loadBriefsState(book: CurrentBook | null): void {
    if (!book) return;
    const bookId = book.bookId;

    this.summaries
      .getBookSummaryStatus(bookId, book.language?.trim() || 'he')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: status => {
          if (this.book?.bookId !== bookId) return;
          // "Built" means there is something to answer FROM, which is per-chapter brief coverage. A
          // book mid-build (some chapters done) is not in the never-built state the empty state
          // describes, so it is not offered the build affordance.
          this.briefsBuilt = !!status && (status.hasSummary || status.builtChapters > 0);
          this.cdr.markForCheck();
        },
        error: () => {
          if (this.book?.bookId !== bookId) return;
          this.briefsBuilt = null;
          this.cdr.markForCheck();
        },
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

  // ── The context line, the marker and the book-artifact chips (phase B) ──────────────────────────

  /** The id to send with the next question, or null outside a book. */
  get bookId(): string | null {
    return this.book?.bookId ?? null;
  }

  /**
   * The book's name for the context line, falling back to "this book".
   *
   * The FALLBACK RATHER THAN HIDING THE LINE: a book IS open, that is the fact the line states, and a
   * line that appeared a moment after the drawer opened would read as a flicker instead of as a state.
   */
  get bookTitleLabel(): string {
    return this.book?.title?.trim() || this.label('bookContextUnnamed');
  }

  // ── The ambient open chapter (phase B, a2) ──────────────────────────────────────────────────────

  /**
   * The chapter snapshot, ONLY when it belongs to the book this drawer currently names.
   *
   * The book-id agreement is the whole guard. `BookContextService` derives from the router and
   * `AmbientChapterService` is pushed by the editor's change detection, so on a book switch there is a
   * window in which they disagree. Sending the pair from that window would put book A's chapter on a
   * request about book B, which is the same wrong-chapter fabrication as answering about chapter 3 when
   * the author named chapter 5, with the books swapped instead of the chapters.
   */
  private get ambient(): AmbientChapterState | null {
    return this.ambientChapters.forBook(this.book?.bookId ?? null);
  }

  /**
   * The chapter Show is looking at, or null when none is.
   *
   * Null covers three different real states and deliberately does not distinguish between them here,
   * because the SURFACE treats them identically (no chapter half on the context line): a book with no
   * chapters, the book-review dashboard (where the editor publishes null by contract), and a
   * book-scoped page that is not the editor at all (import, export), where nothing is publishing.
   * The WIRE keeps the distinction that matters, sending an explicit null rather than omitting the key.
   */
  get ambientChapter(): AmbientChapterChoice | null {
    return this.ambient?.openChapter ?? null;
  }

  /** The open chapter's display name for the context line, or null when there is no chapter. */
  get ambientChapterLabel(): string | null {
    const chapter = this.ambientChapter;
    return chapter ? ambientChapterName(this.appLang, chapter) : null;
  }

  /**
   * The context line's accessible name.
   *
   * Composed rather than a fixed string once a chapter is in play, because the line renders two values
   * separated by nothing but a dot: sighted readers get the separation from the layout, and a screen
   * reader would otherwise hear a book title and a chapter title run together with no indication which
   * is which. With NO chapter it is byte-identical to what phase B's c2 shipped, so the book-only line
   * is unchanged.
   */
  get bookContextAriaLabel(): string {
    const base = this.label('bookContextAria');
    const chapter = this.ambientChapterLabel;
    if (!chapter) return base;
    return `${base}: ${this.bookTitleLabel}. ${this.label('bookContextChapterAria')}: ${chapter}`;
  }

  /** How a clarify chip and an "about" tag name a chapter. One function, so they cannot disagree. */
  chapterChoiceLabel(chapter: AmbientChapterChoice): string {
    return ambientChapterName(this.appLang, chapter);
  }

  /** The "this turn was about X" tag on a turn re-asked from a clarify chip. */
  askedAboutLabel(chapter: string): string {
    return this.label('askedAboutChapter').replace('{0}', chapter);
  }

  /** The sentence a context-change marker shows. */
  markerText(entry: BookMarkerEntry): string {
    return entry.bookId
      ? bookSwitchMarker(this.appLang, entry.title)
      : bookLeftMarker(this.appLang);
  }

  /** A book-artifact chip's visible name. Falls back to the raw ref for a type we do not know. */
  artifactLabel(ref: ChatArtifactRef): string {
    return artifactChipLabel(this.appLang, ref);
  }

  /**
   * Where a chip goes, or null when it must render UNLINKED.
   *
   * Routed against the ANSWER's book, not the current one - see {@link AssistantEntry.bookId}.
   */
  artifactLink(ref: ChatArtifactRef, bookId: string | null): unknown[] | null {
    return chatArtifactDestination(ref, bookId)?.link ?? null;
  }

  /** The query params that go with {@link artifactLink}. Empty object when there is no destination. */
  artifactQueryParams(ref: ChatArtifactRef, bookId: string | null): Params {
    return chatArtifactDestination(ref, bookId)?.queryParams ?? {};
  }

  /** The "this answer is thinner than usual" sentence, for a partial book fault on a good answer. */
  get bookThinNote(): string {
    return this.label('bookThinNote');
  }

  // ── The tutoring empty state (phase B) ──────────────────────────────────────────────────────────

  /**
   * Whether the empty state should be the BOOK one: inside a book, definitely nothing built.
   *
   * Requires a definite `false` on {@link briefsBuilt}. Unknown renders the app-level greeting, which
   * is the honest thing to show when the surface does not know what it would be claiming.
   */
  get showBookEmptyState(): boolean {
    return !!this.book && this.briefsBuilt === false;
  }

  /**
   * The build affordance's destination: the BOOK BRIEFS STATUS ROW.
   *
   * DECISION, since "the build affordance" could have meant a button here that starts the build. It
   * does not, and that is deliberate. The briefs row owns the consent prompt, the wall-clock estimate,
   * the cost estimate, the live progress and the job-registry tracking. A second build trigger in the
   * drawer would either bypass all of that (starting an unestimated, unconsented build from a chat
   * panel) or duplicate it, and a duplicated consent flow is one that will drift from the real one.
   * Taking the author TO the control is actionable: it is one click, it lands on the thing that builds,
   * and it is the same place every other "build your briefs" affordance in the app points at.
   */
  get buildBriefsLink(): unknown[] | null {
    return this.bookId ? ['/books', this.bookId] : null;
  }

  get buildBriefsQueryParams(): Params {
    return { focus: bookSurfaceFocusToken({ target: 'status', stage: 'summary' }) };
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

  asMarker(entry: ChatEntry): BookMarkerEntry | null {
    return entry.kind === 'book-marker' ? entry : null;
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

  /**
   * The author answered a clarifying question by tapping a chapter (phase B, a2).
   *
   * IT RE-ASKS THE SAME SENTENCE WITH THE CHOSEN CHAPTER AS THE AMBIENT KEY, rather than rewriting the
   * question to name a chapter number, and that is the substantive decision here. Appending "(chapter
   * 3)" would push the answer through the server's EXPLICIT number path, where a 1-based label against
   * a 0-based order is genuinely ambiguous and can resolve to two chapters. Supplying the id and order
   * instead resolves exactly one chapter by identity, which is the whole reason the ambient key carries
   * an id at all. The question the author typed is left untouched.
   */
  chooseChapter(clarify: { question: string }, chapter: AmbientChapterChoice): void {
    if (this.pending) return;
    this.ask(clarify.question, chapter);
  }

  /**
   * @param chapterOverride A chapter the author picked EXPLICITLY from a clarify chip. It outranks the
   * ambient one, which is the client's half of "explicit beats ambient": the author has just answered
   * the question of which chapter they meant, so whatever happens to be open must not overrule them.
   */
  private ask(question: string, chapterOverride?: AmbientChapterChoice | null): void {
    // Sending is an answer to "did you mean to start over?" as clearly as Cancel is.
    this.confirmingReset = false;
    const history = this.historyForServer();
    // CAPTURED, not re-read on arrival. The author can navigate to another book while the answer is in
    // flight, and this answer is about the book it was ASKED in; re-reading the current book on arrival
    // would file it under the wrong manuscript and route its chips there too.
    const bookId = this.bookId;
    // Captured for the same reason and read ONCE, so the chapter this question is answered about is the
    // chapter that was on screen when it was asked. Reading it again on arrival would let an author who
    // switched chapters mid-answer get a reply filed under a chapter they had already left.
    const chapter = chapterOverride ?? this.ambientChapter;
    this.entries = [
      ...this.entries,
      {
        kind: 'user',
        id: this.nextId++,
        text: question,
        bookId,
        askedAboutChapter: chapterOverride ? this.chapterChoiceLabel(chapterOverride) : null,
      },
    ];
    this.pending = true;
    this.scrollToLatest();

    const ambient: AmbientChapterKey | null = chapter
      ? { id: chapter.id, order: chapter.order }
      : null;

    this.chat
      .ask(question, history, this.appLang, bookId, ambient)
      // `reset$` as well as `destroy$`: a reset ends this request outright, so its answer cannot be
      // appended to the transcript that replaced the one it was asked in.
      .pipe(takeUntil(this.destroy$), takeUntil(this.reset$))
      .subscribe({
        next: res => this.acceptResponse(res, question, bookId),
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
  private acceptResponse(
    res: ProductChatResponseDto,
    question: string,
    bookId: string | null
  ): void {
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
        bookId,
        // Parsed here rather than at render time so the template does not re-parse on every change
        // detection pass, and so an unknown ref is resolved once into the "renders unlinked" shape.
        artifactRefs: parseArtifactRefs(res.artifactRefs),
        // A fault on a GROUNDED answer is the partial case: the answer stands and one source was
        // unreadable. Carried onto the entry so the note travels with the answer it qualifies.
        bookFaultReason: res.bookFaultReason ?? null,
        clarify: this.clarifyFor(res, question, bookId),
      },
    ];
    this.settle();
  }

  /**
   * The clarify chips this answer should carry, or null (phase B, a2, d2 section (5)).
   *
   * THREE GUARDS, and each one closes a different way this could put an absurd question in front of the
   * author:
   *
   *  1. The SERVER has to have asked. The flag is computed from the selection, never from the answer's
   *     prose, so it is false by construction whenever a chapter resolved - which is what makes "Show
   *     never asks while the chapter is open on screen" a property rather than a hope.
   *  2. The chapter list has to belong to THIS answer's book, checked against the id captured when the
   *     question was sent rather than against whatever book is open now.
   *  3. THERE HAS TO BE MORE THAN ONE CHAPTER TO CHOOSE BETWEEN. The server enforces this too; it is
   *     repeated here because the owner's real book is a single chapter, "a clarifying question there
   *     would be absurd and must be impossible", and a rule that is impossible on one half only is a
   *     rule that one wire change can undo.
   */
  private clarifyFor(
    res: ProductChatResponseDto,
    question: string,
    bookId: string | null
  ): { question: string; choices: readonly AmbientChapterChoice[] } | null {
    if (res.needsChapterClarification !== true) return null;
    const chapters = this.ambientChapters.forBook(bookId)?.chapters ?? [];
    if (chapters.length < 2) return null;
    return { question, choices: chapters };
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
    const current = this.bookId;
    const turns: ProductChatTurnDto[] = [];
    for (const e of this.entries) {
      // PHASE B: a turn taken in a DIFFERENT book does not go up. It stays in the transcript, under its
      // context-change marker, where the author can still read it; what it must not do is condition an
      // answer about the book that is open now. A turn taken outside any book (`bookId: null`) always
      // goes up: those are product Q&A, and keeping them is the entire reason a switch does not clear
      // the thread. See the class doc's decision.
      if (e.kind === 'user' || e.kind === 'assistant') {
        if (e.bookId !== null && e.bookId !== current) continue;
      }
      if (e.kind === 'user') turns.push({ role: 'user', content: e.text });
      else if (e.kind === 'assistant') turns.push({ role: 'assistant', content: e.text });
      // A `book-marker` is never sent: nobody said it. It is a rule drawn in the transcript, and the
      // scoping above is what makes it true on the wire rather than only on screen.
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
