/**
 * c04: the shared book-profile continuation - phase 2 of the folded whole-book build.
 *
 * What this spec is for. The continuation used to be chained from exactly ONE observer (the briefs status
 * row's progress poll), so it ran only when that row happened to be mounted and watching at the moment the
 * briefs build went terminal, and the import handoff card - the most common first-run path in the product
 * - never chained it at all. The fix moves the continuation here and gives it ONE gate. Both halves are
 * asserted below: that every arrival reaches it, and that no arrival can pay twice.
 *
 * The gate matters because `BuildBookProfileAsync` has NO idempotent fast path: every call re-issues four
 * whole-book model runs on a single-GPU host. So "how many POSTs" is the load-bearing assertion in almost
 * every case here, not "did it work".
 *
 * Every request is a Subject held OPEN across assertions. A synchronous `of()` would close the in-flight
 * window before a second arrival could reach it, and the single-flight gate - the one that stops two
 * observers of the same build issuing two whole-book model runs - would pass while broken.
 */
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

import {
  BookProfileContinuationService,
  ProfileContinuationOutcome,
} from './book-profile-continuation.service';
import { BookService } from './book.service';
import { JobRegistryService, TrackedJob } from './job-registry.service';
import { EMPTY_CHUNK_CLOCK } from '../utils/chunk-eta';
import { BookDetailDto, BookProfileDto } from '../models/book';

function job(overrides: Partial<TrackedJob> = {}): TrackedJob {
  return {
    id: 'job-1',
    kind: 'summary',
    bookId: 'book-1',
    scopeLabel: 'whole book',
    titleHe: '', titleEn: '',
    status: 'running',
    percent: null,
    completedChunks: null,
    totalChunks: null,
    chunkClock: EMPTY_CHUNK_CLOCK,
    message: '',
    startedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('BookProfileContinuationService (c04)', () => {
  let jobs$: BehaviorSubject<TrackedJob[]>;
  let service: BookProfileContinuationService;

  /** One entry per refreshProfile POST, in issue order, each answerable on demand. */
  let refreshes: { bookId: string; language: string; subject: Subject<BookProfileDto> }[];
  /** One entry per profile GET, in issue order. */
  let profileReads: { bookId: string; subject: Subject<BookProfileDto> }[];
  /** One entry per book GET (the language resolution). */
  let bookReads: { bookId: string; subject: Subject<BookDetailDto> }[];

  beforeEach(() => {
    jobs$ = new BehaviorSubject<TrackedJob[]>([]);
    refreshes = [];
    profileReads = [];
    bookReads = [];

    TestBed.configureTestingModule({
      providers: [
        { provide: JobRegistryService, useValue: { jobs$: jobs$.asObservable() } },
        {
          provide: BookService,
          useValue: {
            refreshProfile: (bookId: string, language: string): Observable<BookProfileDto> => {
              const subject = new Subject<BookProfileDto>();
              refreshes.push({ bookId, language, subject });
              return subject.asObservable();
            },
            getProfile: (bookId: string): Observable<BookProfileDto> => {
              const subject = new Subject<BookProfileDto>();
              profileReads.push({ bookId, subject });
              return subject.asObservable();
            },
            getById: (bookId: string): Observable<BookDetailDto> => {
              const subject = new Subject<BookDetailDto>();
              bookReads.push({ bookId, subject });
              return subject.asObservable();
            },
          },
        },
      ],
    });
    service = TestBed.inject(BookProfileContinuationService);
  });

  /** The current state of a book, read synchronously. */
  function stateOf(bookId: string): string {
    let seen = '';
    service.stateFor$(bookId).subscribe(s => (seen = s)).unsubscribe();
    return seen;
  }

  function outcomesOf(observable: Observable<ProfileContinuationOutcome>): ProfileContinuationOutcome[] {
    const seen: ProfileContinuationOutcome[] = [];
    observable.subscribe(o => seen.push(o));
    return seen;
  }

  /**
   * Answer the Nth language resolution. It ASSERTS the read was issued before reading it, so a revert that
   * stops arrivals reaching the continuation fails on "the arrival never got here" rather than on a
   * TypeError from a fixture index - the RED has to name the defect.
   */
  function answerLanguage(index: number, language: string): void {
    expect(bookReads.length)
      .withContext(`the arrival must have reached the continuation and asked for the book language (#${index})`)
      .toBeGreaterThan(index);
    bookReads[index].subject.next({ id: bookReads[index].bookId, language } as BookDetailDto);
  }

  /** Answer the Nth profile read (gate 3's "is there a profile at all?"), asserting it was issued. */
  function answerProfileRead(index: number, answer: 'exists' | { status: number }): void {
    expect(profileReads.length)
      .withContext(`gate 3 must ask whether a profile exists before deciding (#${index})`)
      .toBeGreaterThan(index);
    if (answer === 'exists') profileReads[index].subject.next({ bookId: profileReads[index].bookId } as BookProfileDto);
    else profileReads[index].subject.error(answer);
  }

  // ── The arrival paths ───────────────────────────────────────────────────────────────────────────

  describe('every arrival reaches the continuation', () => {
    it('runs off a briefs job the REGISTRY saw succeed, with nothing else mounted or listening', () => {
      jobs$.next([job({ status: 'running' })]);
      expect(refreshes.length)
        .withContext('a running briefs build is not a completed one')
        .toBe(0);

      jobs$.next([job({ status: 'succeeded' })]);
      answerLanguage(0, 'he');

      expect(refreshes.length).toBe(1);
      expect(refreshes[0]).toEqual(jasmine.objectContaining({ bookId: 'book-1', language: 'he' }));
    });

    it('reads the book language for a registry arrival, which carries none', () => {
      jobs$.next([job({ status: 'succeeded' })]);
      expect(bookReads.length).toBe(1);
      answerLanguage(0, 'en');
      expect(refreshes[0].language).toBe('en');
    });

    it('falls back to the app default when the book language cannot be read', () => {
      jobs$.next([job({ status: 'succeeded' })]);
      expect(bookReads.length)
        .withContext('the arrival must have reached the continuation')
        .toBe(1);
      bookReads[0].subject.error({ status: 500 });
      expect(refreshes[0].language).toBe('he');
    });

    it('does NOT run off a failed or canceled briefs build', () => {
      jobs$.next([job({ id: 'j-failed', status: 'failed' }), job({ id: 'j-canceled', status: 'canceled' })]);
      expect(refreshes.length).toBe(0);
      expect(bookReads.length).toBe(0);
    });

    it('does NOT run off a whole-book build of another kind that happens to succeed', () => {
      jobs$.next([job({ id: 'rev-1', kind: 'review', status: 'succeeded' })]);
      expect(refreshes.length).toBe(0);
    });

    it('runs for an explicit user-requested arrival that carries its own language', () => {
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'en' }).subscribe();
      expect(bookReads.length)
        .withContext('an arrival that knows the language must not pay for a book read')
        .toBe(0);
      expect(refreshes[0]).toEqual(jasmine.objectContaining({ bookId: 'book-1', language: 'en' }));
    });
  });

  // ── The gate ────────────────────────────────────────────────────────────────────────────────────

  describe('the gate: no arrival can pay for a second whole-book profile build', () => {
    it('joins an in-flight refresh instead of issuing a second one, and reports its real outcome', () => {
      const first = outcomesOf(service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }));
      // A second observer arrives while the first is still in flight - two reattached tabs, or the import
      // handoff card racing the status row.
      const second = outcomesOf(service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }));

      expect(refreshes.length)
        .withContext('one profile build, not two: this is four whole-book model runs on a single-GPU host')
        .toBe(1);
      expect(second).toEqual([]);

      refreshes[0].subject.next({} as BookProfileDto);
      expect(first).toEqual(['built']);
      expect(second)
        .withContext('a joiner must settle on the real outcome, never on a premature skip')
        .toEqual(['built']);
    });

    it('honors one briefs build exactly once, however many times its terminal is re-offered', () => {
      // The registry re-emits its whole list on every patch and retains completed jobs, and the briefs row
      // reports the same terminal explicitly, so this completion arrives many times.
      jobs$.next([job({ status: 'succeeded' })]);
      answerLanguage(0, 'he');
      expect(refreshes.length).withContext('the registry arrival must run one refresh').toBe(1);
      refreshes[0].subject.next({} as BookProfileDto);

      jobs$.next([job({ status: 'succeeded', updatedAt: 'later' })]);
      jobs$.next([job({ status: 'succeeded' }), job({ id: 'other', kind: 'proofread', status: 'running' })]);
      const rowReport = outcomesOf(service.ensureAfterBriefs({
        bookId: 'book-1', reason: 'briefs-succeeded', language: 'he', briefsJobId: 'job-1',
      }));

      expect(refreshes.length).toBe(1);
      expect(bookReads.length)
        .withContext('a re-offered completion must not even start a second continuation')
        .toBe(1);
      expect(rowReport).toEqual(['skipped']);
    });

    it('lets a LATER briefs build run its own continuation (the guard is per build, not per book)', () => {
      jobs$.next([job({ id: 'build-1', status: 'succeeded' })]);
      answerLanguage(0, 'he');
      expect(refreshes.length).withContext('the first build must run one refresh').toBe(1);
      refreshes[0].subject.next({} as BookProfileDto);

      jobs$.next([job({ id: 'build-1', status: 'succeeded' }), job({ id: 'build-2', status: 'succeeded' })]);
      answerLanguage(1, 'he');

      expect(refreshes.length)
        .withContext('the second build changed the profile inputs again; it earns its own refresh')
        .toBe(2);
    });

    it('refuses a nothing-was-built arrival when the book already HAS a profile', () => {
      const outcomes = outcomesOf(service.ensureAfterBriefs({
        bookId: 'book-1', reason: 'briefs-already-fresh', language: 'he',
      }));

      answerProfileRead(0, 'exists');

      expect(refreshes.length)
        .withContext('nothing was rebuilt and a profile exists: four model runs would buy nothing')
        .toBe(0);
      expect(outcomes).toEqual(['skipped']);
    });

    it('runs a nothing-was-built arrival when the profile is MISSING (the import handoff case)', () => {
      const outcomes = outcomesOf(service.ensureAfterBriefs({
        bookId: 'book-1', reason: 'briefs-already-fresh', language: 'he',
      }));
      answerProfileRead(0, { status: 404 });

      expect(refreshes.length)
        .withContext('a book with no profile at all is exactly what this arrival is for')
        .toBe(1);
      refreshes[0].subject.next({} as BookProfileDto);
      expect(outcomes).toEqual(['built']);
    });

    it('joins rather than doubles when a refresh starts DURING gate 3\'s profile probe', () => {
      // The probe is asynchronous, so a second arrival can start a real refresh inside its window - the
      // import handoff card's READY branch racing the briefs row's consented build, for instance.
      const probing = outcomesOf(service.ensureAfterBriefs({
        bookId: 'book-1', reason: 'briefs-already-fresh', language: 'he',
      }));
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();
      expect(refreshes.length).toBe(1);

      answerProfileRead(0, { status: 404 });

      expect(refreshes.length)
        .withContext('the probe resolved into a refresh that was already running; one POST, not two')
        .toBe(1);
      refreshes[0].subject.next({} as BookProfileDto);
      expect(probing).toEqual(['built']);
    });

    it('refuses a nothing-was-built arrival when the profile read itself failed', () => {
      const outcomes = outcomesOf(service.ensureAfterBriefs({
        bookId: 'book-1', reason: 'briefs-already-fresh', language: 'he',
      }));
      answerProfileRead(0, { status: 500 });

      expect(refreshes.length)
        .withContext('a failure to KNOW is not a reason to spend four whole-book model runs')
        .toBe(0);
      expect(outcomes).toEqual(['skipped']);
    });

    it('re-refuses on every repeat of a nothing-was-built arrival on a book that has a profile', () => {
      for (let i = 0; i < 3; i++) {
        service.ensureAfterBriefs({ bookId: 'book-1', reason: 'briefs-already-fresh', language: 'he' }).subscribe();
        answerProfileRead(i, 'exists');
      }
      expect(refreshes.length).toBe(0);
    });

    it('lets a user-requested build run again after the previous one finished', () => {
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();
      expect(refreshes.length).withContext('the first press must issue a refresh').toBe(1);
      refreshes[0].subject.next({} as BookProfileDto);
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();

      expect(refreshes.length)
        .withContext('this is the ONLY way to rebuild a profile whose inputs did not change')
        .toBe(2);
    });

    it('does not conflate two books', () => {
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();
      service.ensureAfterBriefs({ bookId: 'book-2', reason: 'user-requested', language: 'he' }).subscribe();
      expect(refreshes.map(r => r.bookId)).toEqual(['book-1', 'book-2']);
    });

    it('ignores an arrival with no bookId', () => {
      expect(outcomesOf(service.ensureAfterBriefs({ bookId: null, reason: 'user-requested' }))).toEqual(['skipped']);
      expect(refreshes.length).toBe(0);
    });
  });

  // ── State + request ownership ───────────────────────────────────────────────────────────────────

  describe('state and request ownership', () => {
    it('reports running, then idle, per book', () => {
      expect(stateOf('book-1')).toBe('idle');
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();
      expect(stateOf('book-1')).toBe('running');
      expect(stateOf('book-2')).toBe('idle');
      refreshes[0].subject.next({} as BookProfileDto);
      expect(stateOf('book-1')).toBe('idle');
    });

    it('keeps `failed` visible until the next run starts, so a surface mounted later still learns of it', () => {
      const outcomes = outcomesOf(service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }));
      refreshes[0].subject.error({ status: 500 });

      expect(outcomes).toEqual(['failed']);
      expect(stateOf('book-1')).toBe('failed');

      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();
      expect(stateOf('book-1')).toBe('running');
    });

    it('does not abort the POST when every observer unsubscribes', () => {
      const sub = service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' }).subscribe();
      // The row that reported the arrival is destroyed (panel closed, focus mode, navigation).
      sub.unsubscribe();

      // The service still owns the request, so its answer still lands and still settles the state - the
      // whole point of finding 6, on the client side of the same rule be-c03 fixed on the server side.
      expect(stateOf('book-1')).toBe('running');
      refreshes[0].subject.next({} as BookProfileDto);
      expect(stateOf('book-1')).toBe('idle');
    });

    it('never errors out of ensureAfterBriefs, so a caller does not have to catch', () => {
      let errored = false;
      const outcomes: ProfileContinuationOutcome[] = [];
      service.ensureAfterBriefs({ bookId: 'book-1', reason: 'user-requested', language: 'he' })
        .subscribe({ next: o => outcomes.push(o), error: () => (errored = true) });
      refreshes[0].subject.error({ status: 503 });

      expect(errored).toBeFalse();
      expect(outcomes).toEqual(['failed']);
    });
  });
});
