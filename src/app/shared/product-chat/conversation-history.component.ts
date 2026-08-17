import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, takeUntil } from 'rxjs';

import { ConversationService } from '../../core/services/conversation.service';
import {
  ConversationListItemDto,
  ConversationMessageDto,
} from '../../core/models/conversation';
import { ChatChromeLang } from '../../core/i18n/chat-strings';
import {
  HistoryStringKey,
  conversationBookBadge,
  historyString,
} from '../../core/i18n/history-strings';
import { formatRelativeTime } from '../../core/utils/relative-time';

/**
 * What {@link ConversationHistoryComponent.resume} hands the drawer: the conversation's id and its
 * WHOLE transcript, already fetched.
 *
 * The messages travel with the id rather than being re-fetched by the parent, so this panel owns its
 * own loading and failure states in one place. A parent that re-fetched would need a second spinner and
 * a second error surface for the same request, and the failure would then be reported by whichever of
 * the two happened to be on screen.
 */
export interface ConversationResume {
  id: string;
  messages: ConversationMessageDto[];
}

/**
 * THE CONVERSATION HISTORY LIST inside Show's tab (Show C1, c2).
 *
 * ── Why a sibling component and not more of `ProductChatComponent` ────────────────────────────────
 * Two reasons, and the first is the weaker one. `product-chat.component.ts` is already past this
 * repo's ~700-line soft ceiling and has waived it twice. The real reason is that this surface holds a
 * completely separate state machine - a paged list, a book filter, an inline rename, a two-step delete
 * - none of which touches the transcript invariant that file exists to protect (`entries`, `pending`
 * and the `reset$` unsubscribe are one rule and must not be divided). The two surfaces meet at exactly
 * one seam: {@link resume} hands over rows, and the parent turns them into entries.
 *
 * ── WHAT THIS COMPONENT MUST NEVER DO ─────────────────────────────────────────────────────────────
 * Compose, cap or select a history window. C1's one architectural rule is that the composed prompt does
 * not change by a byte; the stored rows are replayed into ORDINARY transcript entries by
 * `conversation-hydration.ts`, and the unchanged `historyForServer()` selects the window from those.
 * A "last N turns" helper here would be a second window rule one refactor away from the real one.
 *
 * ── The destructive control is two-step, exactly like the drawer's own ────────────────────────────
 * Delete is a HARD delete server-side, with no undo, so the second click is labelled with what it does
 * rather than with a bare OK - the same gesture, and the same reasoning, as
 * `ProductChatComponent.requestReset`. Arming is per row: arming one row disarms any other, so there is
 * never more than one armed delete on screen to mis-click.
 *
 * App-level chrome: Hebrew-default and RTL-first, inherited from the drawer through {@link lang}.
 */
@Component({
  selector: 'app-conversation-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './conversation-history.component.html',
  styleUrl: './conversation-history.component.scss',
})
export class ConversationHistoryComponent implements OnInit, OnChanges, OnDestroy {
  private readonly conversations = inject(ConversationService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  /** The chrome language, pushed down from the drawer so the two can never disagree. */
  @Input() lang: ChatChromeLang = 'he';

  /** The book the drawer is looking at, or null outside one. Drives the filter's availability. */
  @Input() currentBookId: string | null = null;

  /** That book's title, for the badge on rows belonging to it. */
  @Input() currentBookTitle: string | null = null;

  /** The conversation already on screen, marked so resuming what you are reading is not on offer. */
  @Input() activeConversationId: string | null = null;

  /** The author chose a conversation, and its transcript is already loaded. */
  @Output() resume = new EventEmitter<ConversationResume>();

  /** A conversation was deleted, so the drawer can stop threading it if it was the current one. */
  @Output() deleted = new EventEmitter<string>();

  items: ConversationListItemDto[] = [];
  page = 1;
  pageSize = ConversationService.ListPageSize;
  totalCount = 0;
  nearCapWarning = false;

  /**
   * WHETHER A LIST READ IS IN FLIGHT, and that is the whole of what it means.
   *
   * The implication runs one way only: dropping the read makes this false, so it is lowered at the one
   * place a read is dropped ({@link cancelListRead}) rather than by a line copied into each handler. The
   * converse - "false therefore nothing is loading" - is not claimed, because a silent background
   * refresh added later would be a read that deliberately raises no spinner.
   */
  loading = false;
  loadError = false;

  /**
   * FILTERED TO THE OPEN BOOK, or every conversation.
   *
   * DEFAULTS TO FALSE, deliberately, even inside a book. An omitted book filter means EVERY
   * conversation, app-level ones included; a list that opened pre-filtered would hide the author's
   * product Q&A behind a control they did not know was set, and "my conversations are gone" is the
   * worst first impression a history feature can make. The filter is an act, not a default.
   */
  bookOnly = false;

  /** The row being renamed, or null. One at a time: an inline editor per row would be a form. */
  renamingId: string | null = null;
  renameDraft = '';
  renameError: 'blank' | 'failed' | null = null;

  /** The row whose delete is ARMED, or null. Arming one disarms every other. */
  confirmingDeleteId: string | null = null;
  deleteError = false;

  /** The row being opened, or null. Blocks a second open while one is in flight. */
  resumingId: string | null = null;
  resumeError = false;

  /** The row whose DELETE is in flight, or null. Blocks a second delete of the same row. */
  deletingId: string | null = null;

  /** The row whose RENAME is in flight, or null. Blocks a second save of the same edit. */
  savingRenameId: string | null = null;

  /**
   * The most recent list read's subscription, held so the NEXT one can cancel it.
   *
   * SUPERSESSION, not de-duplication: `load()` is reached from the pager, the book filter, a book
   * change and the retry button, and two of those are one press apart. Left overlapping, the reads
   * resolve in whatever order the network hands them back and the LAST one wins - and because the
   * handler re-reads `page` out of the response, the loser rewinding the list looks like the author's
   * second press never happened rather than like an error.
   *
   * Not cleared when a read finishes: it is only ever read in order to cancel, and unsubscribing a
   * subscription that has already completed is a no-op.
   */
  private listSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The author navigated to another book while the panel is open. Only reload when the filter is
    // actually ON: with it off the list is book-independent and a reload would be a request that
    // returns the same rows.
    if (changes['currentBookId'] && !changes['currentBookId'].firstChange && this.bookOnly) {
      this.page = 1;
      this.load();
    }
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────────

  label(key: HistoryStringKey): string {
    return historyString(this.lang, key);
  }

  /** The row's timestamp, timezone-aware and relative. Never a raw date pipe (page conventions). */
  relativeTime(iso: string | null | undefined): string {
    return formatRelativeTime(iso, this.lang);
  }

  /** The row's book badge, or null for an app-level conversation. */
  badge(item: ConversationListItemDto): string | null {
    return conversationBookBadge(this.lang, item.bookId, this.currentBookId, this.currentBookTitle);
  }

  messageCountLabel(item: ConversationListItemDto): string {
    return this.label('historyMessages').replace('{0}', String(item.messageCount ?? 0));
  }

  pageLabel(): string {
    return this.label('historyPage').replace('{0}', String(this.page));
  }

  isCurrent(item: ConversationListItemDto): boolean {
    return !!this.activeConversationId && item.id === this.activeConversationId;
  }

  /** Whether the book filter can be offered at all: there has to be a book to filter to. */
  get canFilterByBook(): boolean {
    return !!this.currentBookId;
  }

  get hasNewer(): boolean {
    return this.page > 1;
  }

  get hasOlder(): boolean {
    return this.page * this.pageSize < this.totalCount;
  }

  /** The empty state's sentence: a filtered empty list is a different fact from an empty account. */
  get emptyKey(): HistoryStringKey {
    return this.bookOnly && this.canFilterByBook ? 'historyEmptyBook' : 'historyEmpty';
  }

  // ── The list ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Drop whatever list read is in flight.
   *
   * THE ONE PLACE `loading` IS LOWERED OTHER THAN BY A RESPONSE. Unsubscribing means neither `next` nor
   * `error` can still fire, so the `loading = false` inside them is gone with the request; lowering it
   * here rather than in each handler is what keeps {@link loading}'s meaning ("a list read is in
   * flight") true at every instant instead of only at the instants a response happens to arrive.
   */
  private cancelListRead(): void {
    this.listSub?.unsubscribe();
    this.listSub = null;
    this.loading = false;
  }

  load(): void {
    // Supersede rather than race. See {@link listSub}.
    this.cancelListRead();
    this.loading = true;
    this.loadError = false;
    this.cdr.markForCheck();

    const filter = this.bookOnly ? this.currentBookId : null;
    this.listSub = this.conversations
      .list(filter, this.page, this.pageSize)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.items = res?.items ?? [];
          this.page = res?.page ?? this.page;
          this.pageSize = res?.pageSize ?? this.pageSize;
          this.totalCount = res?.totalCount ?? this.items.length;
          this.nearCapWarning = res?.nearCapWarning === true;
          this.loading = false;
          // A reload invalidates every per-row gesture: the row that was armed for deletion may not
          // even be on this page any more.
          this.renamingId = null;
          this.confirmingDeleteId = null;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.loadError = true;
          this.cdr.markForCheck();
        },
      });
  }

  setBookOnly(on: boolean): void {
    if (this.bookOnly === on) return;
    this.bookOnly = on;
    this.page = 1;
    this.load();
  }

  newer(): void {
    if (!this.hasNewer) return;
    this.page -= 1;
    this.load();
  }

  older(): void {
    if (!this.hasOlder) return;
    this.page += 1;
    this.load();
  }

  // ── Opening one ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Load the whole transcript and hand it to the drawer.
   *
   * THE WHOLE transcript, not a page of it: the messages endpoint is paged oldest-first while the
   * resend window is the LAST turns, so a partial read would rebuild a transcript missing exactly the
   * turns the next question is composed from. `ConversationService.allMessages` walks the pages.
   *
   * REFUSES the row already on screen (see {@link isCurrent}): re-fetching and re-hydrating a
   * transcript that is already the one displayed is a wasted round trip that, via the parent's own
   * resume handling, would also discard any answer still in flight for no gain.
   */
  open(item: ConversationListItemDto): void {
    if (this.resumingId) return;
    if (this.isCurrent(item)) return;
    this.resumingId = item.id;
    this.resumeError = false;
    this.cdr.markForCheck();

    this.conversations
      .allMessages(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: messages => {
          this.resumingId = null;
          this.cdr.markForCheck();
          this.resume.emit({ id: item.id, messages: messages ?? [] });
        },
        error: () => {
          // The panel STAYS OPEN and says so. Closing onto an unchanged transcript would look like the
          // resume had worked and produced the conversation the author was already looking at.
          this.resumingId = null;
          this.resumeError = true;
          this.cdr.markForCheck();
        },
      });
  }

  // ── Rename ──────────────────────────────────────────────────────────────────────────────────────

  startRename(item: ConversationListItemDto): void {
    this.renamingId = item.id;
    this.renameDraft = item.title ?? '';
    this.renameError = null;
    this.confirmingDeleteId = null;
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.renamingId = null;
    this.renameDraft = '';
    this.renameError = null;
    this.cdr.markForCheck();
  }

  /**
   * Save the author's own title.
   *
   * A blank title is refused HERE as well as by the server's 400, and the two are not redundant: the
   * client's refusal names the problem beside the field the author is looking at, while the server's is
   * what makes the rule true for any caller. A rename that quietly fell back to the auto-derived title
   * would be worse than one that says no.
   *
   * RE-ENTRY IS REFUSED while a save is in flight, the same way {@link open} refuses a second resume.
   * Save is reachable by Enter as well as by the button, so a second press is a keystroke away; two
   * PATCHes of the same title are a wasted round trip whose second answer decides what the row shows.
   * The flag is lowered in BOTH arms, so a failed save can be retried from the editor it leaves open.
   */
  saveRename(item: ConversationListItemDto): void {
    if (this.savingRenameId) return;
    const title = (this.renameDraft ?? '').trim();
    if (!title) {
      this.renameError = 'blank';
      this.cdr.markForCheck();
      return;
    }

    this.savingRenameId = item.id;
    this.cdr.markForCheck();
    this.conversations
      .rename(item.id, title)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.savingRenameId = null;
          this.items = this.items.map(row =>
            row.id === item.id ? { ...row, title: updated?.title ?? title } : row
          );
          this.renamingId = null;
          this.renameDraft = '';
          this.renameError = null;
          this.cdr.markForCheck();
        },
        error: () => {
          // The editor stays OPEN with the author's text in it: losing what they typed on a transport
          // failure would make retrying mean retyping.
          this.savingRenameId = null;
          this.renameError = 'failed';
          this.cdr.markForCheck();
        },
      });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────────────────────────

  requestDelete(item: ConversationListItemDto): void {
    this.confirmingDeleteId = item.id;
    this.renamingId = null;
    this.deleteError = false;
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    this.confirmingDeleteId = null;
    this.cdr.markForCheck();
  }

  /**
   * The second, deliberate click. Only this one removes anything, and it removes it for good.
   *
   * RE-ENTRY IS REFUSED while the DELETE is in flight, the same way {@link open} refuses a second
   * resume. The armed confirmation stays on screen until the response lands, so `confirmingDeleteId`
   * alone lets a double press through; the second DELETE then answers 404 for a row the first one
   * removed successfully, and the panel reports a failure on a delete that worked.
   */
  confirmDelete(item: ConversationListItemDto): void {
    if (this.confirmingDeleteId !== item.id) return;
    if (this.deletingId) return;

    this.deletingId = item.id;
    this.cdr.markForCheck();
    this.conversations
      .delete(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deletingId = null;
          this.items = this.items.filter(row => row.id !== item.id);
          this.totalCount = Math.max(0, this.totalCount - 1);
          this.confirmingDeleteId = null;
          this.cdr.markForCheck();
          // Told even when it was not the current one: the drawer is the only thing that knows whether
          // the id it is threading has just stopped existing.
          this.deleted.emit(item.id);
          // A page that emptied itself is not a page: step back rather than showing "page 3" of a list
          // that now ends at 2. Otherwise, a page that is still non-empty but has a next page to pull
          // from is reloaded too: left alone it would silently show pageSize - 1 rows until something
          // else triggered a load, and the row that should shift up from the next page would be
          // skipped until then. `else if` keeps the two branches from ever both firing.
          if (this.items.length === 0 && this.page > 1) {
            this.page -= 1;
            this.load();
          } else if (this.page * this.pageSize < this.totalCount) {
            this.load();
          }
        },
        error: () => {
          this.deletingId = null;
          this.confirmingDeleteId = null;
          this.deleteError = true;
          this.cdr.markForCheck();
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
