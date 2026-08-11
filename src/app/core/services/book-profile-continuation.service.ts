import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, ReplaySubject, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

import { BookService } from './book.service';
import { JobRegistryService } from './job-registry.service';

/**
 * c04 - THE ONE OWNER OF PHASE 2 OF THE FOLDED WHOLE-BOOK BUILD (the book profile refresh).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────────
 *
 * Q4-A folded the retired bare arrow into the Book briefs row as a two-phase build: briefs first, then
 * `POST /api/books/{id}/profile/refresh`, which is the ONLY writer of `BookProfile` in the API (every
 * profile card on the book dashboard renders from it). Phase 2 was chained from exactly ONE observer -
 * the briefs row's own progress poll - so it ran only when a live row happened to be mounted and watching
 * at the moment the briefs build went terminal. Every other way of finishing a briefs build skipped it,
 * and nothing recorded that it was owed: the panel closed, focus mode, the assistant switched to Edit
 * help, a reload mid-build, the dashboard unmounted, and - most commonly of all - the import handoff
 * card's "Start review", which POSTs the briefs build itself and never chained phase 2 at all. On that
 * last path the dashboard's own empty-state hint ("The book profile is built together with the book
 * briefs") was simply false.
 *
 * A side effect with several ARRIVAL PATHS needs the re-attempt on every one of them. So the continuation
 * lives here, once, and the arrival paths call it - none of them re-implements the decision of whether it
 * should run.
 *
 * ── The arrival paths, and how each reaches this service ────────────────────────────────────────────
 *
 * | # | Arrival                                                              | How it gets here                  |
 * |---|----------------------------------------------------------------------|-----------------------------------|
 * | 1 | Briefs row: consented build POST returns a jobId, poll goes SUCCEEDED  | explicit `briefs-succeeded` + the registry watch |
 * | 2 | Briefs row: consented build POST answers `noOp` (briefs already fresh) | explicit `user-requested`         |
 * | 3 | Briefs row: reattach to an `activeBuildJobId` found by its status GET  | registry watch (the row `track`s it) |
 * | 4 | Import handoff card: "Start review" POSTs a build and gets a jobId     | registry watch (the card `track`s it) |
 * | 5 | Import handoff card: "Start review" while a build is already running   | registry watch (the card `track`s it) |
 * | 6 | Import handoff card: "Start review" with briefs already READY          | explicit `briefs-already-fresh`   |
 * | 7 | Import handoff card: build POST answers `noOp`                         | explicit `briefs-already-fresh`   |
 * | 8 | Editor page book load -> `JobRegistryService.reattach` finds a build   | registry watch                    |
 *
 * Paths 1 and 3-5 and 8 all end in one place - a `summary` job in {@link JobRegistryService} reaching
 * `succeeded` - because every one of them calls `track('summary', ...)`. The registry is a ROOT singleton
 * that polls to terminal on its own and survives component unmounts, so watching it is what makes the
 * continuation independent of whether any row, panel or page is still mounted. That is the whole of
 * finding 6: the work no longer depends on somebody watching.
 *
 * Paths 2, 6 and 7 have no job at all (nothing was built), so they cannot be observed; they call
 * {@link ensureAfterBriefs} directly.
 *
 * ── The gate, and why it cannot pay for a rebuild twice ─────────────────────────────────────────────
 *
 * `BuildBookProfileAsync` has NO idempotent fast path (be-c03 measured this): every call re-issues four
 * whole-book model runs, on a single-GPU host. So "an arrival path happened" is NOT a reason to call it.
 * Three gates, in this order, and they live only here:
 *
 *  1. SINGLE FLIGHT per book. A second arrival while a refresh is in flight JOINS it and reports its
 *     outcome; it never issues a second POST. (The server also deduplicates per book since be-c03, so
 *     this is not the only defence - but it keeps the client from queueing work behind itself and it is
 *     what lets a row settle on the real outcome rather than on a premature "skipped".)
 *  2. ONE CONTINUATION PER BRIEFS BUILD, ever, keyed on the briefs jobId. The registry re-emits its whole
 *     job list on every patch and retains completed jobs, and the briefs row ALSO reports the same
 *     terminal explicitly - so the same completion arrives here many times and is honored once.
 *  3. NOTHING-WAS-BUILT arrivals must earn it. `briefs-already-fresh` means no briefs were produced, so
 *     the only thing that justifies four whole-book model runs is that there is no profile at all: the
 *     request is made only if `GET .../profile` answers 404. A book that already has a profile gets
 *     nothing, however many times the user re-enters that path.
 *
 * `user-requested` is the one reason that is not conditional, and deliberately: it is the author pressing
 * Build / Rebuild / Refresh on the briefs row after a consent prompt that names the profile cards and
 * states an estimate. It is also the ONLY way to rebuild a profile whose inputs have not changed. It is
 * still covered by gate 1, so a press during a running refresh costs nothing.
 *
 * Net effect: the number of profile builds is bounded by (briefs builds completed) + (explicit consent
 * presses) + (arrivals on a book that has no profile at all). No observation, remount, reattach, extra
 * tab or re-entry adds one.
 *
 * ── Ownership of the request ────────────────────────────────────────────────────────────────────────
 *
 * This service holds the HTTP subscription itself and hands observers a shared {@link ReplaySubject}.
 * An observer that goes away (a destroyed row, a closed panel) therefore cannot abort the POST. be-c03
 * made the SERVER side of that safe too - the request token no longer governs the work - but a client
 * abort would still lose the answer, and with it the row's ability to report the outcome.
 */
@Injectable({ providedIn: 'root' })
export class BookProfileContinuationService {
  private readonly jobRegistry = inject(JobRegistryService);
  private readonly bookService = inject(BookService);

  /** App default when a book's own language cannot be read; matches every other caller's fallback. */
  private static readonly DEFAULT_LANGUAGE = 'he';

  /** Per-book continuation state; a book with no entry is `idle`. */
  private readonly states = new BehaviorSubject<ReadonlyMap<string, ProfileContinuationState>>(new Map());

  /** The in-flight refresh per book (gate 1). Present exactly while a POST is outstanding. */
  private readonly inFlight = new Map<string, Observable<ProfileContinuationOutcome>>();

  /** Arrival keys already honored (gate 2), e.g. `book-1|briefs:job-7`. */
  private readonly honoredArrivals = new Set<string>();

  constructor() {
    this.watchBriefsBuilds();
  }

  /**
   * The continuation state for one book, for a surface that wants to say the profile is being rebuilt
   * (the briefs row keeps its build latch raised across it). `failed` persists until the next run starts,
   * so a surface that mounts after the failure still learns about it.
   */
  stateFor$(bookId: string | null | undefined): Observable<ProfileContinuationState> {
    const id = (bookId ?? '').trim();
    return this.states.pipe(
      map(states => (id ? states.get(id) ?? 'idle' : 'idle')),
      distinctUntilChanged(),
    );
  }

  /**
   * Ask for the profile continuation after a briefs arrival. Returns the outcome of THIS arrival - the
   * shared outcome when it joined a running refresh, `skipped` when the gate refused. Never errors: a
   * failed refresh is reported as `failed` so a caller can render it rather than having to catch.
   *
   * Subscribing is not what starts the work, and unsubscribing does not stop it.
   */
  ensureAfterBriefs(request: ProfileContinuationRequest): Observable<ProfileContinuationOutcome> {
    const bookId = (request.bookId ?? '').trim();
    if (!bookId) return of<ProfileContinuationOutcome>('skipped');

    // GATE 1 - single flight. Deliberately BEFORE the arrival-key gate: a caller whose key was already
    // consumed by the registry watch a moment earlier must still be handed the running refresh's real
    // outcome, or it would settle its build latch while the profile is still being written.
    const running = this.inFlight.get(bookId);
    if (running) return running;

    // GATE 2 - one continuation per briefs build, ever.
    const arrivalKey = request.briefsJobId ? `${bookId}|briefs:${request.briefsJobId}` : null;
    if (arrivalKey) {
      if (this.honoredArrivals.has(arrivalKey)) return of<ProfileContinuationOutcome>('skipped');
      this.honoredArrivals.add(arrivalKey);
    }

    // GATE 3 - an arrival that built nothing only earns a refresh when there is no profile to show.
    if (request.reason === 'briefs-already-fresh') {
      return this.startIfProfileMissing(bookId, request.language);
    }

    return this.start(bookId, request.language);
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────────────

  /**
   * The registry watch: every `summary` job that reaches `succeeded`, whoever started or discovered it,
   * is a completed briefs build and therefore an arrival. Registered once, in the constructor, and never
   * torn down - this service is the app-lifetime owner of the continuation, so it must keep listening
   * while no dashboard, panel or row is mounted. That is the whole point.
   *
   * `jobs$` re-emits on every patch and retains completed jobs, so a given terminal is re-offered here
   * many times; gate 2 is what makes it one refresh.
   */
  private watchBriefsBuilds(): void {
    this.jobRegistry.jobs$.subscribe(jobs => {
      for (const job of jobs) {
        if (job.kind !== 'summary' || job.status !== 'succeeded') continue;
        this.ensureAfterBriefs({
          bookId: job.bookId,
          reason: 'briefs-succeeded',
          briefsJobId: job.id,
        }).subscribe();
      }
    });
  }

  /** Gate 3's read: refresh only when the book genuinely has no profile (the endpoint answers 404). */
  private startIfProfileMissing(bookId: string, language: string | null | undefined): Observable<ProfileContinuationOutcome> {
    const out = new ReplaySubject<ProfileContinuationOutcome>(1);
    const settle = (outcome: ProfileContinuationOutcome) => {
      out.next(outcome);
      out.complete();
    };
    this.bookService.getProfile(bookId).subscribe({
      // A profile exists and nothing was rebuilt: four whole-book model runs would buy nothing.
      next: () => settle('skipped'),
      error: (err: { status?: number } | null) => {
        if (err?.status === 404) {
          this.start(bookId, language).subscribe({ next: settle });
          return;
        }
        // Any other failure is a failure to KNOW. Refusing is the cheap side of that uncertainty, and the
        // explicit build action on the briefs row remains available.
        settle('skipped');
      },
    });
    return out.asObservable();
  }

  /**
   * Issue the refresh. Gate 1 already turned a synchronous second arrival away; this re-read is for the
   * one path that resumes ASYNCHRONOUSLY - gate 3's profile probe - during which another arrival can have
   * started a refresh. Same map, same rule; the POST is issued in exactly one place.
   */
  private start(bookId: string, language: string | null | undefined): Observable<ProfileContinuationOutcome> {
    const existing = this.inFlight.get(bookId);
    if (existing) return existing;

    const out = new ReplaySubject<ProfileContinuationOutcome>(1);
    const shared = out.asObservable();
    this.inFlight.set(bookId, shared);
    this.setState(bookId, 'running');

    const settle = (outcome: ProfileContinuationOutcome, state: ProfileContinuationState) => {
      this.inFlight.delete(bookId);
      this.setState(bookId, state);
      out.next(outcome);
      out.complete();
    };

    this.resolveLanguage(bookId, language).subscribe(lang => {
      // This subscription is the service's, not an observer's: a row destroyed mid-refresh must not
      // abort the POST.
      this.bookService.refreshProfile(bookId, lang).subscribe({
        next: () => settle('built', 'idle'),
        // A 503 means the server is shutting down and refused to start a build; it is retryable rather
        // than a failed profile, but from here it is simply "not built now" - the next arrival (a fresh
        // briefs build, or the author pressing the build action) asks again.
        error: () => settle('failed', 'failed'),
      });
    });

    return shared;
  }

  /**
   * The language the profile prose is written in. An arrival that knows it (the briefs row, the import
   * card) passes it; the registry watch does not carry one, so the book's own language is read instead -
   * the same value every one of those callers derives it from. One extra GET against four whole-book
   * model runs is not a cost worth wiring a language field through the job registry for.
   */
  private resolveLanguage(bookId: string, language: string | null | undefined): Observable<string> {
    const explicit = (language ?? '').trim();
    if (explicit) return of(explicit);
    return this.bookService.getById(bookId).pipe(
      map(book => (book?.language ?? '').trim() || BookProfileContinuationService.DEFAULT_LANGUAGE),
      catchError(() => of(BookProfileContinuationService.DEFAULT_LANGUAGE)),
    );
  }

  private setState(bookId: string, state: ProfileContinuationState): void {
    const next = new Map(this.states.value);
    if (state === 'idle') next.delete(bookId);
    else next.set(bookId, state);
    this.states.next(next);
  }
}

/** Why an arrival thinks the profile continuation is owed. The gate reads this; call sites do not gate. */
export type ProfileContinuationReason =
  /** A briefs build finished, so the profile's inputs changed. Always worth one refresh, once per build. */
  | 'briefs-succeeded'
  /** The author pressed the briefs row's build action and confirmed its consent prompt. */
  | 'user-requested'
  /** An arrival where nothing was built (a `noOp` build, or briefs that were already READY). */
  | 'briefs-already-fresh';

/** What one arrival got. `skipped` means the gate refused; nothing was requested and nothing failed. */
export type ProfileContinuationOutcome = 'built' | 'skipped' | 'failed';

/** Per-book continuation state for surfaces that render the phase. */
export type ProfileContinuationState = 'idle' | 'running' | 'failed';

/** One arrival at the continuation. */
export interface ProfileContinuationRequest {
  bookId: string | null;
  reason: ProfileContinuationReason;
  /** The book language, when the caller has it; otherwise the book's own language is read. */
  language?: string | null;
  /** The briefs job whose completion this arrival reports. The per-build dedupe key (gate 2). */
  briefsJobId?: string | null;
}
