import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { DashboardComponent } from './dashboard.component';
import { BookDto } from '../../core/models/book';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import { STAGE_NAMES } from '../../shared/stage-spine/stage-spine.copy';
import { collapseStorageKey } from '../../shared/collapsible-section/collapse-store';

/**
 * Wave 3 / w3 - the BOOKS LIST as the first place a user is oriented.
 *
 * This surface had NO stage indicator at all, which is exactly where it hurt: the books list is where
 * importing is the next action, so the one stage the product could not compute there was the one the user
 * was standing on. It now renders the COMPACT stage spine per row.
 *
 * THE COST CONTRACT IS THE POINT OF THIS SUITE. A per-book indicator is only worth having if it does not
 * turn one list request into 1 + 4N. `describe('the request budget')` pins that: exactly two HTTP
 * requests for the whole page - `GET /api/books` and the `GET /api/feedback/availability` probe -
 * whatever the row count, and no status request is ever issued for a row. The availability probe is
 * page-level, not per-row: it is read once per session and shared with every later mount. Where a
 * stage cannot be computed from the books payload the row says so ("not known here") rather than
 * fetching, which is the standing rule - show less, never guess and never fan out.
 */

function book(overrides: Partial<BookDto> = {}): BookDto {
  return {
    id: 'book-1',
    title: 'My Book',
    author: null,
    language: 'he',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    aiTier: 'fast',
    chapterCount: 0,
    chaptersWithTextCount: 0,
    ...overrides,
  };
}

function runningJob(bookId: string, kind: 'summary' | 'review'): TrackedJob {
  return {
    id: `${kind}-${bookId}`, kind, bookId, scopeLabel: 'Whole book',
    titleHe: 'בנייה', titleEn: 'Build', status: 'running', percent: 5,
    completedChunks: null, totalChunks: null, chunkClock: EMPTY_CHUNK_CLOCK,
    message: '', startedAt: '', updatedAt: '',
  };
}

describe('DashboardComponent (books list, Wave 3 / w3)', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let httpMock: HttpTestingController;
  let activeJobs$: BehaviorSubject<TrackedJob[]>;

  beforeEach(async () => {
    activeJobs$ = new BehaviorSubject<TrackedJob[]>([]);
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The registry is an in-memory view-model; the stub emits nothing until a test pushes a job, which
        // is the honest default (absence of a tracked job is not evidence that nothing is running).
        { provide: JobRegistryService, useValue: { activeJobs$: activeJobs$.asObservable() } },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * Render the page and answer BOTH of its page-level requests: the books list, and (e2) the feedback
   * availability probe that decides whether the header draws the triage entry. The probe defaults to
   * OFF here so that every pre-existing assertion in this suite sees the header it always saw.
   */
  function load(books: BookDto[], triageEnabled = false): void {
    fixture.detectChanges();
    answerAvailability(triageEnabled);
    httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith('/api/books')).flush(books);
    fixture.detectChanges();
  }

  /** Answer the e2 availability probe. Its own budget claim is asserted in `the request budget` below. */
  function answerAvailability(triageEnabled: boolean): void {
    httpMock
      .expectOne(r => r.method === 'GET' && r.url.endsWith('/api/feedback/availability'))
      .flush({ triageEnabled });
  }

  function compactSpines(): HTMLElement[] {
    return fixture.debugElement
      .queryAll(By.css('[data-testid="stage-spine-compact"]'))
      .map(d => d.nativeElement as HTMLElement);
  }

  function pipState(rowIndex: number, stage: string): string {
    const spine = compactSpines()[rowIndex];
    return (spine.querySelector(`[data-testid="spine-compact-pip-${stage}"]`) as HTMLElement)
      .dataset['state'] ?? '';
  }

  // ── THE REQUEST BUDGET ──────────────────────────────────────────────────────────────────────────

  describe('the request budget', () => {
    /**
     * THE CONTRACT IS PER-ROW COST, and that is what this now says out loud.
     *
     * It used to read "exactly one request for the whole page", which was the same claim while the page
     * made exactly one. e2 added a second PAGE-LEVEL request (the feedback availability probe, one per
     * mount, independent of the row count), so the assertion is written against the thing that actually
     * matters: the set of requests is enumerated and named, and NOTHING in it is per row. A regression
     * that turned one list request into 1 + 4N still fails here, which is the whole point of the suite.
     */
    it('makes only PAGE-LEVEL requests, never one per row, with three books on it', () => {
      fixture.detectChanges();

      const issued = httpMock.match(() => true);
      const urls = issued.map(r => r.request.url).sort();
      expect(urls).toEqual(['/api/books', '/api/feedback/availability']);

      issued.find(r => r.request.url === '/api/feedback/availability')!.flush({ triageEnabled: false });
      issued.find(r => r.request.url === '/api/books')!.flush([
        book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 }),
        book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 }),
        book({ id: 'c', chapterCount: 3, chaptersWithTextCount: 0 }),
      ]);
      fixture.detectChanges();

      // Three rows, three spines - and no further request of any kind. httpMock.verify() in afterEach is
      // the fence: any per-row status/summary/review/chapters call would fail the suite here.
      expect(compactSpines().length).toBe(3);
      httpMock.verify();
    });

    it('issues no per-row status request even when a row has chapters and could have briefs', () => {
      load([book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 })]);
      // The rule: rather than fetch the briefs status per row, the row says it does not know from here.
      expect(pipState(0, 'briefs')).toBe('unknown');
      expect(pipState(0, 'review')).toBe('unknown');
      expect(compactSpines()[0].textContent).toContain('לא ידוע מכאן');
    });
  });

  // ── WHAT THE ROW ACTUALLY COMPUTES ──────────────────────────────────────────────────────────────

  describe('what a row computes from the M1 counts', () => {
    it('an EMPTY book reads not-started on Import and blocked on everything downstream', () => {
      load([book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 })]);
      expect(pipState(0, 'import')).toBe('not-started');
      expect(pipState(0, 'briefs')).toBe('blocked');
      expect(pipState(0, 'review')).toBe('blocked');
      // NOTHING reads done. That defect is the reason this wave exists.
      expect(compactSpines()[0].querySelectorAll('[data-state="ready"]').length).toBe(0);
    });

    it('a book with text reads ready on Import', () => {
      load([book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 })]);
      expect(pipState(0, 'import')).toBe('ready');
    });

    it('chapters with NO text are not an import: the row stays not-started', () => {
      load([book({ id: 'c', chapterCount: 3, chaptersWithTextCount: 0 })]);
      expect(pipState(0, 'import')).toBe('not-started');
    });

    // w4: Export became REAL on this surface for free. It is derived from `chapterCount` alone, which the
    // books-list payload already carries, so the books list needed no new request to stop saying "no
    // export screen" - and it says something different per row, which a constant never could.
    /**
     * w8 / F2 CHANGED THIS ROW'S ANSWER, deliberately. Export readiness is "could the exporter render a
     * document from what is stored", which is a parse of every chapter's SFDT rather than a SQL count, so
     * it is not on the books-list payload and this row may not guess it. It used to be derived from
     * `chaptersWithTextCount` - free, and wrong: a book with word counts and no saved document read
     * `ready` here and answered 409 at the endpoint. "Not known here" is what this density says about the
     * briefs and the review already, and it is what it says about export now.
     */
    it('Export reads NOT KNOWN on a row with chapters: the count that decides it is not on this payload', () => {
      load([book({ id: 'b', chapterCount: 12, chaptersWithTextCount: 12 })]);
      expect(pipState(0, 'export')).toBe('unknown');
      expect(pipState(0, 'export')).not.toBe('ready');
    });

    it('Export reads blocked on an EMPTY book row: there is nothing to put in a file', () => {
      load([book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 })]);
      expect(pipState(0, 'export')).toBe('blocked');
    });

    it('never reads unavailable on any row, whatever the counts say', () => {
      load([
        book({ id: 'a', chapterCount: 0, chaptersWithTextCount: 0 }),
        book({ id: 'b', chapterCount: 3, chaptersWithTextCount: 0 }),
        book({ id: 'c', chapterCount: 9, chaptersWithTextCount: 9 }),
      ]);
      [0, 1, 2].forEach(row => expect(pipState(row, 'export')).not.toBe('unavailable'));
    });
  });

  // ── THE RUNNING SIGNAL, FOR FREE ────────────────────────────────────────────────────────────────

  describe('the running signal', () => {
    it('raises the row whose build the registry is tracking, and only that row, and only that stage', () => {
      load([
        book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 }),
        book({ id: 'b', chapterCount: 4, chaptersWithTextCount: 4 }),
      ]);
      expect(pipState(0, 'briefs')).toBe('unknown');

      activeJobs$.next([runningJob('a', 'summary')]);
      fixture.detectChanges();

      expect(pipState(0, 'briefs')).toBe('running');
      // A briefs build is not a review build.
      expect(pipState(0, 'review')).toBe('unknown');
      // And book b, which has no tracked job, is NOT claimed idle - it is still simply not known.
      expect(pipState(1, 'briefs')).toBe('unknown');
    });

    it('drops back to not-known (never to "done") when the build finishes', () => {
      load([book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 })]);
      activeJobs$.next([runningJob('a', 'review')]);
      fixture.detectChanges();
      expect(pipState(0, 'review')).toBe('running');

      activeJobs$.next([]);
      fixture.detectChanges();
      expect(pipState(0, 'review')).toBe('unknown');
    });
  });

  // ── THE LANGUAGE RULE ───────────────────────────────────────────────────────────────────────────

  describe('the language rule at the compact-to-full transition', () => {
    it('each row speaks ITS OWN BOOK language, so opening the book never flips the spine', () => {
      load([
        book({ id: 'he-book', language: 'he', chapterCount: 0, chaptersWithTextCount: 0 }),
        book({ id: 'en-book', language: 'en', chapterCount: 0, chaptersWithTextCount: 0 }),
      ]);

      const [heSpine, enSpine] = compactSpines();
      expect(heSpine.getAttribute('dir')).toBe('rtl');
      expect(heSpine.textContent).toContain(STAGE_NAMES['import'].he);
      expect(enSpine.getAttribute('dir')).toBe('ltr');
      expect(enSpine.textContent).toContain(STAGE_NAMES['import'].en);
      expect(enSpine.textContent).not.toContain(STAGE_NAMES['import'].he);
    });

    it('the app-level chrome around the rows stays Hebrew-default, unchanged by the per-book rule', () => {
      load([book({ id: 'en-book', language: 'en' })]);
      const page = fixture.nativeElement.querySelector('.dashboard') as HTMLElement;
      expect(page.getAttribute('dir')).toBe('rtl');
      expect(component.label('newBook')).toBe('ספר חדש');
    });
  });

  // ── NITs 52/53: the spine signals object identity is stable across ticks ───────────────────────────

  describe('findings 52/53: signals object identity', () => {
    it('finding 52: the fallback for a book not yet in the map is the SAME shared object every call', () => {
      load([book({ id: 'a' })]);
      const ghost = book({ id: 'ghost' });
      const first = component.spineSignalsFor(ghost);
      const second = component.spineSignalsFor(ghost);
      expect(first).toBe(second);
    });

    it('finding 53: an unrelated row keeps its EXACT signals object when another row\'s job status changes', () => {
      load([
        book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 }),
        book({ id: 'b', chapterCount: 4, chaptersWithTextCount: 4 }),
      ]);
      const beforeA = component.spineSignalsFor(book({ id: 'a' }));

      activeJobs$.next([runningJob('b', 'summary')]);
      fixture.detectChanges();

      // Proves the diff actually scoped to 'b': row a's signals are untouched (same reference)...
      expect(component.spineSignalsFor(book({ id: 'a' }))).toBe(beforeA);
      // ...while row b, the one that changed, really did move.
      expect(pipState(1, 'briefs')).toBe('running');
    });

    it('finding 53: the affected row DOES get a new signals object when its own job status changes', () => {
      load([book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 })]);
      const before = component.spineSignalsFor(book({ id: 'a' }));

      activeJobs$.next([runningJob('a', 'summary')]);
      fixture.detectChanges();

      const after = component.spineSignalsFor(book({ id: 'a' }));
      expect(after).not.toBe(before);
      expect(after.summaryRunning).toBeTrue();
    });

    it('finding 53: a registry emission that changes nothing does not reallocate any row', () => {
      load([book({ id: 'a', chapterCount: 4, chaptersWithTextCount: 4 })]);
      const before = component.spineSignalsFor(book({ id: 'a' }));

      // Same jobs, re-emitted (e.g. an unrelated percent tick this component does not even read).
      activeJobs$.next([]);
      fixture.detectChanges();

      expect(component.spineSignalsFor(book({ id: 'a' }))).toBe(before);
    });
  });

  // ── f02/63: deleting a book clears its collapse-map row ─────────────────────────────────────────────

  describe('deleteBook clears the collapse map (f02/63)', () => {
    beforeEach(() => {
      localStorage.removeItem(collapseStorageKey('doomed'));
      localStorage.removeItem(collapseStorageKey('survivor'));
    });

    afterEach(() => {
      localStorage.removeItem(collapseStorageKey('doomed'));
      localStorage.removeItem(collapseStorageKey('survivor'));
    });

    it('removes the deleted book\'s collapse-store row so it does not linger forever for an id that can never reopen', () => {
      load([book({ id: 'doomed' })]);
      localStorage.setItem(collapseStorageKey('doomed'), JSON.stringify({ chapterBriefs: true }));
      spyOn(window, 'confirm').and.returnValue(true);

      component.deleteBook(book({ id: 'doomed' }));
      httpMock.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/api/books/doomed')).flush(null);

      expect(localStorage.getItem(collapseStorageKey('doomed'))).toBeNull();
    });

    it('leaves other books\' collapse rows untouched', () => {
      load([book({ id: 'doomed' }), book({ id: 'survivor' })]);
      localStorage.setItem(collapseStorageKey('doomed'), JSON.stringify({ chapterBriefs: true }));
      localStorage.setItem(collapseStorageKey('survivor'), JSON.stringify({ chapterBriefs: false }));
      spyOn(window, 'confirm').and.returnValue(true);

      component.deleteBook(book({ id: 'doomed' }));
      httpMock.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/api/books/doomed')).flush(null);

      expect(localStorage.getItem(collapseStorageKey('survivor'))).toBe(JSON.stringify({ chapterBriefs: false }));
    });
  });

  // ── The guides affordance (chatbot phase A.2, c1) ───────────────────────────────────────────────

  describe('the guides link', () => {
    it('is on the books list, where the app lands, and points at /help with the chrome language', () => {
      load([book({ id: 'a' })]);

      const link = fixture.debugElement.query(By.css('.dash-help-link'));
      expect(link)
        .withContext('the guides must be discoverable without opening the assistant first')
        .not.toBeNull();
      const el = link.nativeElement as HTMLAnchorElement;
      // f04: the dock's guides link carries `lang` so a shared link keeps its language; this link
      // is the same affordance and must agree, or the two land on different pages once Hebrew stops
      // being the reader's only default.
      expect(el.getAttribute('href')).toBe('/help?lang=he');
      // f10: transcribed independently from guides-strings.ts (DRAFT he) rather than compared against
      // GUIDES_STRINGS_HE itself - a typo introduced into that constant must turn this spec red, and
      // comparing the constant to itself could never detect that. Keep this literal in lockstep with a
      // deliberate copy change to helpLink/helpLinkAria.
      expect(el.textContent?.trim()).toBe('מדריכים');
      expect(el.getAttribute('aria-label')).toBe('פתיחת מדריכי המערכת');
    });

    it('stays on the page while the create form is open', () => {
      load([]);
      component.showCreateForm = true;
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.dash-help-link'))).not.toBeNull();
    });
  });

  // ── The feedback entry (e2) ─────────────────────────────────────────────────────────────────────
  //
  // Show C2 shipped `/feedback` reachable by TYPED URL ALONE. The entry has to be gated on the SAME
  // signal as the route, because `/feedback` is a `canMatch` route: with the flag off it does not match
  // and the URL falls through the wildcard to `/books`, so an ungated link would be a link that reloads
  // the page the owner is standing on. These two tests are that gate, from the DOM.

  describe('the feedback entry', () => {
    function feedbackLink(): HTMLAnchorElement | null {
      const found = fixture.debugElement.query(By.css('.dash-feedback-link'));
      return found ? (found.nativeElement as HTMLAnchorElement) : null;
    }

    /**
     * The paired positive claim for the two NEGATIVE cells (finding 26).
     *
     * Both of the other two things this header draws are named: the guides link (matched WITHOUT the
     * feedback class, so it can never be satisfied by the very node the negative cell says is absent) and
     * the create-book button, by its rendered Hebrew text rather than by class alone. If the header, the
     * actions group, or the whole template stopped rendering, this fails - which is precisely the
     * alternative explanation an unpaired `toBeNull()` cannot rule out.
     */
    function expectHeaderStillRendered(): void {
      const actions = fixture.nativeElement.querySelector('.dash-header-actions') as HTMLElement | null;
      expect(actions)
        .withContext('the header actions group itself did not render, so "the link is absent" proves nothing')
        .not.toBeNull();
      expect(actions!.querySelector('.dash-help-link:not(.dash-feedback-link)'))
        .withContext('the guides link, which no flag gates, must still be beside the missing entry')
        .not.toBeNull();
      const newBook = actions!.querySelector('.pd-btn-primary') as HTMLElement | null;
      expect(newBook).not.toBeNull();
      expect(newBook!.textContent?.trim()).toBe('ספר חדש');
    }

    it('renders beside the guides link, pointing at /feedback, when the deployment serves triage', () => {
      load([book({ id: 'a' })], true);

      const link = feedbackLink();
      expect(link)
        .withContext('the triage view was reachable only by typed URL before this entry existed')
        .not.toBeNull();
      expect(link!.getAttribute('href')).toBe('/feedback');
      // f10: transcribed independently from feedback-strings.ts (DRAFT he), not compared against
      // FEEDBACK_STRINGS_HE itself - see the guides-link case above for why. Update in lockstep with a
      // deliberate copy change to entryLink/entryLinkAria.
      expect(link!.textContent?.trim()).toBe('משוב');
      expect(link!.getAttribute('aria-label')).toBe('פתיחת רשימת המשוב');
      // Beside the guides link, in the same header actions group, not in place of it.
      const actions = fixture.nativeElement.querySelector('.dash-header-actions') as HTMLElement;
      expect(actions.contains(link)).toBeTrue();
      expect(actions.querySelector('.dash-help-link:not(.dash-feedback-link)')).not.toBeNull();
    });

    it('is ABSENT when the deployment does not serve triage, so it can never point into the wildcard', () => {
      load([book({ id: 'a' })], false);
      expect(feedbackLink()).toBeNull();
      // PAIRED POSITIVE CLAIM (finding 26). "Absent" only means something if the rest of the header is
      // PRESENT: a template that failed to render at all, or a header whose actions group was renamed,
      // would satisfy the null above for the wrong reason. Both siblings of the gated link are named
      // here, so this cell reads "absent while the rest is present" rather than "absent because nothing
      // rendered". The link's own selector could not be proven red before e2 existed (it had no node to
      // match); this is what makes the cell discriminate GOING FORWARD.
      expectHeaderStillRendered();
    });

    it('is absent when the availability read FAILS, which is the fail-closed direction', () => {
      fixture.detectChanges();
      httpMock
        .expectOne(r => r.url.endsWith('/api/feedback/availability'))
        .flush('down', { status: 500, statusText: 'Server Error' });
      httpMock.expectOne(r => r.url.endsWith('/api/books')).flush([book({ id: 'a' })]);
      fixture.detectChanges();

      // A failed read must not draw a link into a surface this deployment may not be serving.
      expect(feedbackLink()).toBeNull();
      // PAIRED POSITIVE CLAIM (finding 26) - and this cell needs it more than the flag-off one, because a
      // FAILED page-level read is exactly the condition under which "the whole header stopped rendering"
      // is a plausible alternative explanation for the null above. It did not: the header is intact and
      // only the gated link is missing.
      expectHeaderStillRendered();
    });

    /**
     * P3 48: `dashboard.component.ts` ngOnInit claims "One read per session, shared with every later mount
     * of this page". That claim was pinned only at SERVICE level (`feedback-availability.service.spec.ts`,
     * `refCount: false` keeps an abandoned in-flight read alive), which proves the mechanism EXISTS but not
     * that this component is wired to it - a component that called `read()` instead of `once()`, or that
     * injected a component-scoped provider, would leave every service spec green and this claim false.
     *
     * So this mounts the dashboard, destroys it the way leaving the books list does, and mounts it again
     * inside the SAME TestBed, where the root-provided `FeedbackAvailabilityService` is one shared
     * instance. Exactly one probe may be issued across both mounts, and the second mount must still draw
     * the link from the replayed answer - a cache that suppressed the request but lost the answer would be
     * a different bug with the same request count.
     */
    it('probes availability ONCE across a destroy-and-remount, and still draws the link on the second mount', () => {
      // ── Mount 1 ──
      fixture.detectChanges();
      const firstMountProbes = httpMock.match(r => r.url.endsWith('/api/feedback/availability'));
      expect(firstMountProbes.length)
        .withContext('the first mount is the one read the session is allowed')
        .toBe(1);
      firstMountProbes[0].flush({ triageEnabled: true });
      httpMock.expectOne(r => r.url.endsWith('/api/books')).flush([book({ id: 'a' })]);
      fixture.detectChanges();
      expect(feedbackLink()).not.toBeNull();

      // Leaving the books list destroys the component; returning to it constructs a NEW one.
      fixture.destroy();

      // ── Mount 2, same TestBed, therefore the same root service instance ──
      const remount = TestBed.createComponent(DashboardComponent);
      remount.detectChanges();

      const secondMountProbes = httpMock.match(r => r.url.endsWith('/api/feedback/availability'));
      expect(secondMountProbes.length)
        .withContext('the remount re-probed, so "one read per session, shared with every later mount of '
          + 'this page" is false: this page pays a request per mount')
        .toBe(0);

      // The books list is NOT cached and is expected to be re-read - naming it here keeps the claim about
      // the availability probe specifically, rather than about mounting being free.
      httpMock.expectOne(r => r.url.endsWith('/api/books')).flush([book({ id: 'a' })]);
      remount.detectChanges();

      // ...and the second mount got the ANSWER, not just the silence: the link is drawn from the replay.
      const remountedLink = remount.debugElement.query(By.css('.dash-feedback-link'));
      expect(remountedLink)
        .withContext('the remount suppressed the request but lost the answer, so the entry vanished')
        .not.toBeNull();
      expect((remountedLink.nativeElement as HTMLAnchorElement).getAttribute('href')).toBe('/feedback');

      remount.destroy();
    });
  });

  // ── THE HEADER AT NARROW WIDTHS (c09 / finding 24) ──────────────────────────────────────────────
  //
  // e2 made this header a THREE-item row beside the title (guides + feedback + the create button), and
  // the row had no wrap and no breakpoint of its own. Measured in the browser at 300px before the fix:
  // Hebrew ran the header 70px past its box and put the create button at x=-46, clipped to "ספר ח" with
  // no way to scroll to it; English ran 96px past. The rule below is the one the guides index header
  // already uses (help-index.component.ts), so both headers restack the same way.
  //
  // These assert the COMPUTED value on the rendered node rather than the presence of a declaration in a
  // string: a component style that never reaches its node is the standing trap here, and only the
  // computed read distinguishes a live rule from a dead one.

  describe('the header at narrow widths', () => {
    function headerNodes(): { header: HTMLElement; actions: HTMLElement } {
      load([book({ id: 'a' })], true);
      return {
        header: fixture.nativeElement.querySelector('.dash-header') as HTMLElement,
        actions: fixture.nativeElement.querySelector('.dash-header-actions') as HTMLElement,
      };
    }

    it('lets the header row WRAP, so a third action can never push the create button off the edge', () => {
      const { header } = headerNodes();

      expect(getComputedStyle(header).flexWrap)
        .withContext('with nowrap, at 300px the create button rendered at x=-46, clipped and unreachable')
        .toBe('wrap');
    });

    it('lets the actions group itself wrap, since on a wrapped header it is alone on its line', () => {
      const { actions } = headerNodes();

      expect(getComputedStyle(actions).flexWrap).toBe('wrap');
    });

    it('keeps a real gap between the title and the actions, so they can never sit flush', () => {
      const { header } = headerNodes();

      // Measured before the fix at 380px: the guides link's right edge and the title's left edge were the
      // same pixel. A gap is what stops space-between from being the only thing holding them apart.
      const gap = parseFloat(getComputedStyle(header).columnGap || '0');
      expect(gap).toBeGreaterThan(0);
    });

    it('carries a narrow breakpoint that starts-aligns the wrapped lines, at the app\'s own 520px', () => {
      const { header } = headerNodes();

      // The media rule cannot be exercised by width from inside the Karma frame, so this reads the
      // component's own compiled stylesheet: the rule must exist, be scoped to THIS header, and use the
      // same breakpoint the guides index header uses rather than a new one invented for this page.
      const mediaRules: CSSMediaRule[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // a cross-origin sheet: not ours
        }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule && rule.cssText.includes('.dash-header')) {
            mediaRules.push(rule);
          }
        }
      }

      const narrow = mediaRules.find(r => r.conditionText.replace(/\s/g, '').includes('max-width:520px'));
      expect(narrow)
        .withContext('the header restack must use the 520px breakpoint help-index.component.ts already uses')
        .toBeDefined();
      expect(narrow!.cssText.replace(/\s/g, '')).toContain('align-items:flex-start');

      // And the header the rule names is the one this component actually rendered.
      expect(header.classList.contains('dash-header')).toBeTrue();
    });
  });
});
