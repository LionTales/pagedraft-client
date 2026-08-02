import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, defer, finalize, from, shareReplay, tap } from 'rxjs';
import { AiTierValue, BookAiTierDto } from '../models/book';

/**
 * Per-book shared state (tier-ux-rework fixes c02). One entry per book that something is currently watching
 * or loading; see {@link AiTierService} for why this exists and {@link AiTierService.evictIfIdle} for why the
 * map cannot grow without bound.
 */
interface BookTierChannel {
  /**
   * The cross-instance publication channel. A plain Subject, not a BehaviorSubject: replaying to whoever
   * happens to subscribe would make "what a watcher sees" depend on subscription order. The last answer is
   * held separately in {@link answer}, where the rule for handing it out is explicit.
   */
  readonly changes: Subject<BookAiTierDto>;
  /**
   * The newest accepted answer for this book, or null before the first one. This is NOT a general-purpose
   * cache with a lifetime of its own: the whole entry is dropped the moment no toggle is mounted for the book
   * (see {@link AiTierService.evictIfIdle}), so an answer can only ever be handed to a toggle mounting
   * ALONGSIDE one that is already displaying it. That is what makes adopting it safe - it shows the reader
   * exactly what the same page is already showing, and can never be a snapshot from an earlier VISIT.
   */
  answer: BookAiTierDto | null;
  /** The stamp {@link answer} came from, so "nothing has been issued since" is decidable. */
  answerStamp: number;
  /** Monotonic stamp handed to every request issued for this book, reads and writes alike. */
  seq: number;
  /** How many WRITE answers have been published. A read issued before one of those is stale by construction. */
  writes: number;
  /** Stamp of the newest write already published, so two overlapping writes cannot land backwards. */
  lastWriteStamp: number;
  /** Requests (reads + writes) still outstanding. The entry must survive while any of them can still answer. */
  pending: number;
  /** The joinable in-flight read, plus the state it was issued against. */
  read$: Observable<BookAiTierDto> | null;
  readStamp: number;
  readWrites: number;
}

/**
 * The model tier, per book AND per task (model-tier-fast-thinking p3-4; per-task storage in tier-ux-rework
 * c1/c2).
 *
 * WHY THIS IS ITS OWN ENDPOINT AND NOT A FIELD ON THE BOOK PUT. Two reasons, both about not lying to the
 * user. First, the answer is more than the stored token: the surface also needs to know whether the tier can
 * route on this server at all, and per task what will ACTUALLY run for THIS book's language (the language
 * rung outranks the tier rung, so an English book's proofreading stays fast whatever the book default says).
 * That is resolved server-side by the same function the AI router resolves through, so the client cannot
 * compute it and must not guess it. Second, PUT /api/books/{id} replaces title/author/language, so flipping a
 * tier through it would risk clobbering fields this control has no business touching.
 *
 * The server also REJECTS setting 'thinking' when the tier cannot route for the addressed task (409), which
 * is what stops a book from advertising a tier it is not on. Consent is a UI step (see
 * {@link BookAiTierDto.consentRequired}); it never softens that 409.
 *
 * NOTHING on this contract names a provider, a model or a version: model identity is internal IP and the
 * server strips it before serializing. Do not add a client-side "which model" read here.
 *
 * ── ONE ANSWER PER BOOK, SHARED BY EVERY MOUNTED TOGGLE (tier-ux-rework fixes c02) ───────────────────────
 *
 * The book dashboard mounts two tier toggles against the same book (the book-default row and the BookReview
 * row) and the analysis panel a third. When each held its own private snapshot and issued its own GET, one
 * toggle's write repainted only itself: flipping the book default to fast left the BookReview toggle above it
 * still showing thinking WITH a now-false fallback warning, even though the write's own response carried that
 * task's new answer. Two identical GETs also fired per dashboard load.
 *
 * So this service owns the answer, not the components. {@link watch} hands out a per-book channel, every read
 * and every write pushes its answer into it, and one write therefore repaints every mounted toggle for that
 * book. A mount either joins a read in flight or adopts what the book's other toggles are already showing
 * ({@link get}), so a dashboard load costs one GET however many toggles it puts on the page. What the service
 * does NOT own is per-instance UI state: a load failure, a save failure, a 409 message and a spinner all stay
 * in the component that issued the call, because they describe THAT control's attempt rather than the book's
 * tier.
 *
 * WHAT "CANCEL" MEANS NOW, since a response no longer feeds one component. Two separable things:
 *   • a component unsubscribing is a DETACH. It stops that instance waiting (and lowers its own spinner); it
 *     does not decide anything for the other instances. The underlying GET is aborted only when the LAST
 *     subscriber detaches, which is what {@link get}'s refCounted share gives.
 *   • whether an answer may repaint anyone is decided HERE, by stamp, and not by who is still listening. A
 *     read publishes only when nothing newer was issued after it AND no write landed while it was in flight
 *     (a read issued before a write completed may have been answered from pre-write state - the server gives
 *     no read-after-write guarantee across an in-flight window). A write always publishes, because its answer
 *     is post-write by construction; only an OLDER write that answers after a newer one is dropped.
 *
 * That is why supersession survives the move to shared state: an abandoned read cannot repaint a book even if
 * some other instance is still holding it open, and a failed write's re-read ({@link refresh}) is still able
 * to supersede everything issued before it.
 */
@Injectable({ providedIn: 'root' })
export class AiTierService {
  /**
   * Keyed STRICTLY by bookId, so a book's answer can only ever reach watchers of that same book: the "late
   * response for the previous book repaints the current one" failure is not a race to be timed here, it is
   * unrepresentable. Bounded, not app-lifetime: see {@link evictIfIdle}.
   */
  private readonly channels = new Map<string, BookTierChannel>();

  constructor(private http: HttpClient) {}

  /**
   * The shared per-book answer stream. Emits every read and write answer the service accepts for `bookId`,
   * whichever component issued it, and NOTHING on subscribe (there is no cached snapshot to replay - see
   * {@link BookTierChannel.changes}), so a subscriber's first emission is always a fresh server answer.
   *
   * Never errors and never completes: a failed request is the caller's own concern, not a fact about the
   * book, and completing the channel would tear down every other toggle's subscription.
   */
  watch(bookId: string): Observable<BookAiTierDto> {
    return new Observable<BookAiTierDto>((subscriber) => {
      const channel = this.channelFor(bookId);
      const inner = channel.changes.subscribe(subscriber);
      return () => {
        inner.unsubscribe();
        this.evictIfIdle(bookId, channel);
      };
    });
  }

  /**
   * The book default plus, per user-facing task, the stored/effective tier and its readiness.
   *
   * This is the MOUNT verb, and it goes to the wire only when it has to. In order:
   *
   *  1. JOIN a read already in flight for this book. Only one that is still the newest thing issued and that
   *     no write has landed on top of - a doomed read (one whose answer this service would drop) would leave
   *     the joiner waiting for an answer that can never paint.
   *  2. ADOPT the answer the book's other mounted toggles are currently displaying, if nothing has been
   *     issued since it arrived. Joining alone does not cover the real dashboard: its two toggles mount about
   *     140ms apart (measured), so the first GET has already finished when the second mounts, and without
   *     this step every page load still costs two identical GETs. Delivered asynchronously so that adopting
   *     has the same shape as answering, and a caller cannot be re-entered inside its own `ngOnChanges`.
   *  3. Otherwise read.
   *
   * Use {@link refresh} when the caller KNOWS the answer in hand is stale; that verb skips both shortcuts.
   */
  get(bookId: string): Observable<BookAiTierDto> {
    const channel = this.channelFor(bookId);
    const joinable =
      !!channel.read$ && channel.readStamp === channel.seq && channel.readWrites === channel.writes;
    if (joinable) return channel.read$!;
    if (channel.answer !== null && channel.answerStamp === channel.seq) {
      const adopted = channel.answer;
      return defer(() => from(Promise.resolve(adopted))).pipe(
        // Republished rather than returned quietly, so that painting keeps going through the ONE channel
        // every toggle already listens on. It is the same object the others hold, so nothing repaints.
        tap(() => {
          if (this.channels.get(bookId) === channel && channel.answer === adopted) {
            channel.changes.next(adopted);
          }
        })
      );
    }
    return this.startRead(bookId, channel);
  }

  /**
   * A read that must not join anything: it always issues a fresh GET and, by taking a newer stamp, supersedes
   * every request already in flight for the book. This is the verb for "what I have is known to be stale" -
   * the retry after a load failure, the re-read after a rejected write, and a book-language change (the
   * language changes which tasks can move at all, so an answer computed before it is worthless).
   */
  refresh(bookId: string): Observable<BookAiTierDto> {
    return this.startRead(bookId, this.channelFor(bookId));
  }

  /**
   * Sets ONE task's tier. Opting IN to 'thinking' means this book's chapter text is processed off this
   * machine for that task, so callers must have obtained explicit consent first when the DTO asks for it.
   * Returns the same shape as {@link get}, so the caller re-renders from the server's answer rather than
   * from what it asked for - and so does every other toggle mounted on the book, through {@link watch}.
   *
   * `task` may be an AiTaskType or an AnalysisType name (the server normalizes), but the `tasks[]` array
   * that comes back is always keyed by the normalized AiTaskType name.
   */
  setTask(bookId: string, task: string, tier: AiTierValue): Observable<BookAiTierDto> {
    return this.writeThrough(bookId, () =>
      this.http.put<BookAiTierDto>(`/api/books/${bookId}/ai-tier`, { tier, task })
    );
  }

  /**
   * Sets the BOOK DEFAULT tier: the seed for tasks that have not been decided individually. It deliberately
   * does NOT clear existing per-task overrides - that is {@link clearTask}, an explicit verb - so a default
   * change cannot silently discard a per-task choice the user made on purpose.
   */
  setBookDefault(bookId: string, tier: AiTierValue): Observable<BookAiTierDto> {
    return this.writeThrough(bookId, () =>
      this.http.put<BookAiTierDto>(`/api/books/${bookId}/ai-tier`, { tier })
    );
  }

  /**
   * Clears ONE task's override so it follows the book default again. Idempotent server-side (clearing an
   * override that is not there returns the unchanged state, not a 404).
   */
  clearTask(bookId: string, task: string): Observable<BookAiTierDto> {
    return this.writeThrough(bookId, () =>
      this.http.delete<BookAiTierDto>(`/api/books/${bookId}/ai-tier/${task}`)
    );
  }

  // ── Shared-state plumbing ───────────────────────────────────────────────────

  private channelFor(bookId: string): BookTierChannel {
    let channel = this.channels.get(bookId);
    if (!channel) {
      channel = {
        changes: new Subject<BookAiTierDto>(),
        answer: null,
        answerStamp: 0,
        seq: 0,
        writes: 0,
        lastWriteStamp: 0,
        pending: 0,
        read$: null,
        readStamp: 0,
        readWrites: 0,
      };
      this.channels.set(bookId, channel);
    }
    return channel;
  }

  /**
   * EVERY CALLER OF {@link get} / {@link refresh} MUST SUBSCRIBE TO WHAT IT GETS BACK (final-r04). The stamp
   * and the pending count are taken HERE, when the read is issued, not when it is subscribed - deliberately,
   * because `reload()` orders a fresh read against the one it just detached from and that ordering has to be
   * decided at call time. The price is that an observable which is never subscribed leaves `pending` above
   * zero forever, which pins the entry past {@link evictIfIdle} and lets its held answer outlive the visit.
   * Both production call sites subscribe on the next line; keep it that way rather than adding a timeout.
   */
  private startRead(bookId: string, channel: BookTierChannel): Observable<BookAiTierDto> {
    const stamp = ++channel.seq;
    const writesAtIssue = channel.writes;
    channel.pending++;
    let shared$: Observable<BookAiTierDto>;
    shared$ = this.http.get<BookAiTierDto>(`/api/books/${bookId}/ai-tier`).pipe(
      tap((dto) => this.publishRead(bookId, channel, stamp, writesAtIssue, dto)),
      // Runs exactly once per shared execution (it is upstream of the share), on completion, on error, and on
      // the teardown that the LAST detaching subscriber triggers - so the joinable slot and the pending count
      // are released down every one of those paths.
      finalize(() => {
        if (channel.read$ === shared$) channel.read$ = null;
        this.settle(bookId, channel);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    channel.read$ = shared$;
    channel.readStamp = stamp;
    channel.readWrites = writesAtIssue;
    return shared$;
  }

  /**
   * Wraps a mutation so its answer becomes the book's answer for every mounted toggle. The request factory is
   * called inside a `defer` so the stamp is taken when the caller actually subscribes, not when the method
   * was called: a stamp handed out earlier would order this write against requests that were really issued
   * after it.
   */
  private writeThrough(
    bookId: string,
    request: () => Observable<BookAiTierDto>
  ): Observable<BookAiTierDto> {
    return defer(() => {
      const channel = this.channelFor(bookId);
      const stamp = ++channel.seq;
      channel.pending++;
      return request().pipe(
        tap((dto) => this.publishWrite(bookId, channel, stamp, dto)),
        finalize(() => this.settle(bookId, channel))
      );
    });
  }

  /**
   * A read may repaint the book only if it is still the newest request issued for it AND no write landed
   * while it was in flight. The second clause is the one that matters across instances: instance A's write
   * answer supersedes a read instance B is still holding open, exactly as it does for the writer itself.
   */
  private publishRead(
    bookId: string,
    channel: BookTierChannel,
    stamp: number,
    writesAtIssue: number,
    dto: BookAiTierDto
  ): void {
    if (this.channels.get(bookId) !== channel) return; // this entry was evicted; its answer belongs to nobody
    if (stamp !== channel.seq) return; // superseded by a newer request
    if (channel.writes !== writesAtIssue) return; // a write landed under it: it may carry pre-write state
    this.accept(channel, stamp, dto);
  }

  /** A write answer is post-write by construction, so it always publishes - unless a NEWER write beat it. */
  private publishWrite(
    bookId: string,
    channel: BookTierChannel,
    stamp: number,
    dto: BookAiTierDto
  ): void {
    if (this.channels.get(bookId) !== channel) return;
    if (stamp < channel.lastWriteStamp) return;
    channel.lastWriteStamp = stamp;
    channel.writes++;
    this.accept(channel, stamp, dto);
  }

  /** Records an accepted answer as the book's current one and hands it to every mounted toggle. */
  private accept(channel: BookTierChannel, stamp: number, dto: BookAiTierDto): void {
    channel.answer = dto;
    channel.answerStamp = stamp;
    channel.changes.next(dto);
  }

  private settle(bookId: string, channel: BookTierChannel): void {
    channel.pending = Math.max(0, channel.pending - 1);
    this.evictIfIdle(bookId, channel);
  }

  /**
   * WHY THE MAP IS BOUNDED even though the service is `providedIn: 'root'`. An entry is dropped as soon as it
   * is idle: no toggle watching the book and no request outstanding. So the map holds at most the books with
   * a mounted toggle (in practice one, at most a handful) plus whatever is momentarily in flight, not every
   * book the session has ever opened.
   *
   * It is also what bounds the STALENESS of {@link BookTierChannel.answer}. The held answer dies with the
   * entry, so it can only ever be adopted by a toggle mounting while another one is displaying it, and a
   * later visit to the same book always reads again. There is no cache to invalidate on a book switch,
   * because a book nobody is looking at has no entry at all.
   *
   * The identity check in {@link publishRead}/{@link publishWrite} covers the seam: if a request outlives its
   * entry somehow, the stamps of a freshly created entry can never be mistaken for the old one's.
   */
  private evictIfIdle(bookId: string, channel: BookTierChannel): void {
    if (channel.pending > 0 || channel.changes.observed) return;
    if (this.channels.get(bookId) === channel) this.channels.delete(bookId);
  }
}
