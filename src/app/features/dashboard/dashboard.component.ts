import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BookService } from '../../core/services/book.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { BookDto } from '../../core/models/book';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { guidesString } from '../../core/i18n/guides-strings';
import { feedbackString } from '../../core/i18n/feedback-strings';
import { FeedbackAvailabilityService } from '../../core/services/feedback-availability.service';
import { StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import { EXPORT_SURFACE_AVAILABLE, StageSpineSignals, emptyStageSpineSignals } from '../../shared/stage-spine/stage-spine.model';
import { clearCollapseState } from '../../shared/collapsible-section/collapse-store';
import { clearOrientationState } from '../book-dashboard/orientation-store';

/**
 * NIT 52. `spineSignalsFor`'s fallback runs on every change-detection tick for any row not yet in the
 * map (the brief race between the list rendering and `rebuildSpineSignals` landing). Calling the factory
 * there handed the spine a NEW object identity on every such tick, which re-runs `deriveStageSpine`
 * continuously for no reason - exactly the class of waste `rebuildSpineSignals`'s own doc comment already
 * calls out for the map itself. One frozen instance, read-only, shared across every row that needs it.
 */
const EMPTY_SPINE_SIGNALS: Readonly<StageSpineSignals> = Object.freeze(emptyStageSpineSignals());

/**
 * NIT 53. Every bookId whose membership differs between two snapshots of a running-job set, added into
 * `into` (a shared accumulator, so the briefs diff and the review diff land in one set together).
 */
function collectChangedIds(previous: ReadonlySet<string>, next: ReadonlySet<string>, into: Set<string>): void {
  for (const id of previous) if (!next.has(id)) into.add(id);
  for (const id of next) if (!previous.has(id)) into.add(id);
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, FormsModule, StageSpineComponent],
  template: `
    <div class="dashboard" [attr.dir]="dir">
      <header class="dash-header">
        <h1>Pagedraft</h1>
        <div class="dash-header-actions">
          <!-- Chatbot phase A.2 / c1: the guides are a real page now, so the books list - the route the
               app lands on - says so out loud rather than leaving them to be discovered through the
               assistant's citations. The dock carries the same link on every other route. -->
          <a class="dash-help-link" routerLink="/help" [queryParams]="{ lang: langKey }" [attr.aria-label]="helpAria">{{ helpLabel }}</a>
          <!-- e2: the OWNER's triage view. Rendered only when the deployment actually serves it, because
               the route is gated by the same flag and an ungated link would fall through the wildcard
               back to this very page - a link that silently does nothing. No lang query parameter,
               unlike the guides link beside it: the triage view has no language toggle to carry. -->
          @if (feedbackAvailable) {
            <a class="dash-help-link dash-feedback-link" routerLink="/feedback" [attr.aria-label]="feedbackAria">{{ feedbackLabel }}</a>
          }
          @if (!showCreateForm) {
            <button class="pd-btn pd-btn-primary" (click)="showCreateForm = true">{{ label('newBook') }}</button>
          }
        </div>
      </header>
      @if (showCreateForm) {
        <div class="create-form">
          <h2>{{ label('newBook') }}</h2>
          <div class="field">
            <label for="new-book-title">{{ label('titleField') }}</label>
            <input id="new-book-title" type="text" [(ngModel)]="newBookTitle" [placeholder]="label('untitled')" />
          </div>
          <div class="field">
            <label for="new-book-language">{{ label('languageField') }}</label>
            <select id="new-book-language" [(ngModel)]="newBookLanguage">
              <option value="he">{{ label('optionHebrew') }}</option>
              <option value="en">{{ label('optionEnglish') }}</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="pd-btn pd-btn-ghost" (click)="cancelCreate()">{{ label('cancel') }}</button>
            <button type="button" class="pd-btn pd-btn-primary" (click)="submitCreate()" [disabled]="creating">{{ creating ? label('creating') : label('create') }}</button>
          </div>
        </div>
      }
      <ul class="book-list">
        @for (b of books; track b.id) {
          <li>
            <div class="book-main">
              <a [routerLink]="['/books', b.id]">{{ b.title }}</a>
              <span class="meta">{{ b.author || label('noAuthor') }} &middot; {{ relativeTime(b.updatedAt, b.language) }}</span>
            </div>
            <!-- Wave 3 / w3: the COMPACT spine, one per book. Everything it renders comes from the single
                 books-list response this page already made plus the in-memory job registry; there is no
                 per-row request, and where a stage cannot be computed from that it says so rather than
                 fetching. Language follows THE BOOK, exactly as the title and timestamp above it do. -->
            <app-stage-spine
              density="compact"
              [bookLanguage]="b.language"
              [signals]="spineSignalsFor(b)">
            </app-stage-spine>
            <div class="book-actions">
              <button type="button" class="pd-btn pd-btn-ghost" (click)="openBook(b.id)">{{ label('open') }}</button>
              <button type="button" class="pd-btn pd-btn-ghost" (click)="goToImport(b.id)">{{ label('importDocx') }}</button>
              <button type="button" class="pd-btn pd-btn-ghost btn-delete" (click)="deleteBook(b)" [disabled]="deletingId === b.id">{{ label('delete') }}</button>
            </div>
          </li>
        } @empty {
          <li class="pd-empty">{{ label('empty') }}</li>
        }
      </ul>
    </div>
  `,
  styles: [`
    .dashboard {
      padding: var(--pd-space-7);
      max-inline-size: 800px;
      margin-inline: auto;
    }
    .dash-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-block-end: var(--pd-space-7);
    }
    .dash-header h1 {
      margin: 0;
      font-size: var(--pd-text-h3);
      color: var(--pd-neutral-900);
    }
    .dash-header-actions {
      display: flex;
      align-items: center;
      gap: var(--pd-space-5);
    }
    .dash-help-link {
      color: var(--pd-text-link);
      text-decoration: none;
      font-size: var(--pd-text-body-sm);
    }
    .dash-help-link:hover { text-decoration: underline; }
    .dash-help-link:focus-visible {
      outline: none;
      box-shadow: var(--pd-ring);
      border-radius: var(--pd-radius-sm);
    }
    .book-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .book-list li {
      padding: var(--pd-space-4) var(--pd-space-3);
      border-block-end: 1px solid var(--pd-divider);
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-2);
    }
    .book-main a {
      font-weight: var(--pd-weight-medium);
      text-decoration: none;
      color: var(--pd-text);
    }
    .book-main a:hover { text-decoration: underline; }
    .meta {
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text-secondary);
      display: block;
      margin-block-start: var(--pd-space-1);
    }
    .book-actions {
      display: flex;
      gap: var(--pd-space-3);
      flex-wrap: wrap;
    }
    /* The compact spine is advisory chrome inside the row: it never competes with the row's own actions
       for width, and it carries its own [dir] because it follows the BOOK rather than this page. */
    .book-list li app-stage-spine {
      display: block;
      max-inline-size: 100%;
    }
    .btn-delete {
      color: var(--pd-cut);
      border-color: var(--pd-cut-border);
    }
    .btn-delete:hover:not(:disabled) {
      background: var(--pd-cut-bg);
    }
    .create-form {
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-lg);
      padding: var(--pd-space-6);
      margin-block-end: var(--pd-space-7);
      max-inline-size: 400px;
    }
    .create-form h2 {
      margin: 0 0 var(--pd-space-5) 0;
      font-size: var(--pd-text-h5);
    }
    .create-form .field {
      margin-block-end: var(--pd-space-4);
    }
    .create-form label {
      display: block;
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      margin-block-end: var(--pd-space-2);
      color: var(--pd-text);
    }
    .create-form input,
    .create-form select {
      width: 100%;
      padding: var(--pd-space-3) var(--pd-space-4);
      border: 1px solid var(--pd-border-strong);
      border-radius: var(--pd-radius-md);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body);
      color: var(--pd-text);
      background: var(--pd-surface);
    }
    .create-form select { cursor: pointer; }
    .create-form .form-actions {
      display: flex;
      gap: var(--pd-space-3);
      margin-block-start: var(--pd-space-5);
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  books: BookDto[] = [];
  showCreateForm = false;
  newBookTitle = '';
  newBookLanguage = 'he';
  creating = false;
  deletingId: string | null = null;

  // ── Localization (app-level surface: no book language; defaults to Hebrew-first) ──

  /**
   * Dashboard chrome is always Hebrew-first; no per-book language applies here. Not private: the
   * template reads it directly on the guides link so that link's URL names the same language its
   * label is drawn in, matching the dock's `[queryParams]="{ lang: lang }"`.
   */
  get langKey(): 'he' | 'en' {
    return 'he';
  }

  get dir(): 'rtl' | 'ltr' {
    return this.langKey === 'he' ? 'rtl' : 'ltr';
  }

  /** Localized static chrome label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  label(key: string): string {
    const he: Record<string, string> = {
      newBook: 'ספר חדש',
      titleField: 'כותרת',
      untitled: 'ללא כותרת',
      languageField: 'שפה',
      optionHebrew: 'עברית',
      optionEnglish: 'אנגלית',
      cancel: 'ביטול',
      create: 'יצירה',
      creating: 'יוצר...',
      noAuthor: 'ללא מחבר',
      open: 'פתיחה',
      importDocx: 'ייבוא DOCX',
      delete: 'מחיקה',
      empty: 'אין ספרים. צרו ספר חדש כדי להתחיל.',
    };
    const en: Record<string, string> = {
      newBook: 'New book',
      titleField: 'Title',
      untitled: 'Untitled',
      languageField: 'Language',
      optionHebrew: 'Hebrew',
      optionEnglish: 'English',
      cancel: 'Cancel',
      create: 'Create',
      creating: 'Creating...',
      noAuthor: 'No author',
      open: 'Open',
      importDocx: 'Import DOCX',
      delete: 'Delete',
      empty: 'No books. Create one to get started.',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }

  /** Localized delete confirm message (includes the book title). */
  private deleteConfirmMessage(title: string): string {
    if (this.langKey === 'he') {
      return `למחוק את "${title}"? פעולה זו אינה הפיכה.`;
    }
    return `Delete "${title}"? This cannot be undone.`;
  }

  relativeTime(iso: string | null | undefined, lang?: string): string {
    return formatRelativeTime(iso, lang === 'he' ? 'he' : 'en');
  }

  /**
   * The guides link's text and accessible name (A.2, c1), read from `guides-strings` rather than added
   * to this component's own label map: the affordance is named by the surface it opens, so the books
   * list and the dock cannot end up calling the same page two different things.
   */
  get helpLabel(): string {
    return guidesString(this.langKey, 'helpLink');
  }

  get helpAria(): string {
    return guidesString(this.langKey, 'helpLinkAria');
  }

  // ── The feedback entry (e2) ─────────────────────────────────────────────────────────────────────
  //
  // Show C2 shipped the triage view reachable by TYPED URL ALONE: nothing in this client linked to
  // `/feedback`. This is that link, and the reason it is guarded rather than always drawn is the route
  // table itself - `/feedback` is a `canMatch` route, so with the flag off it does not match and the URL
  // falls through the wildcard to `/books`. An unconditional link would therefore be a link that
  // reloads the page the owner is already on. Both this flag and the guard's come from
  // `FeedbackAvailabilityService`, so they cannot disagree; see that service for why this one is the
  // CACHED read and the guard's is live.

  /** Whether this deployment serves the triage view. False until the read lands, so nothing flashes. */
  feedbackAvailable = false;

  /** Named by the surface it opens, from the feedback strings rather than this component's label map. */
  get feedbackLabel(): string {
    return feedbackString(this.langKey, 'entryLink');
  }

  get feedbackAria(): string {
    return feedbackString(this.langKey, 'entryLinkAria');
  }

  // ── Wave 3 / w3: the compact stage spine, one per book row ────────────────────────────────────
  //
  // WHAT COMPACT SHOWS HERE, AND WHY IT IS NOT MORE. The books list makes exactly ONE request
  // (`GET /api/books`) and this todo did not add a second. That payload carries `chapterCount` and
  // `chaptersWithTextCount` (Wave 3 / M1), which is the whole of stage 1 and, when a book has no
  // chapters, the honest `blocked` on the three stages that need one. It carries nothing about the
  // briefs or the review, and asking would cost one status request PER ROW - so those stages render a
  // hollow pip that says "not known here". Showing less is the rule; guessing and fetching are both
  // ruled out.
  //
  // The one thing that legitimately upgrades a row past that is the JOB REGISTRY, which is an in-memory
  // view-model of builds this client already knows about and costs no request at all. It can only ever
  // say "running", never "not running": a book with no tracked job stays at "not known here" rather
  // than being claimed idle. `reattach` is deliberately NOT called from this page - it would fan out
  // four reads per book, which is exactly the N-per-row cost this design exists to avoid.

  /** Signals per book id, rebuilt only when the list or the set of running jobs changes. */
  private spineSignals = new Map<string, StageSpineSignals>();
  /**
   * Book ids with a build in flight right now, PER KIND. Two sets rather than one "something is running"
   * flag on purpose: a briefs build and a review build are different stages, and lighting both from one
   * flag would claim a stage is running that is not.
   */
  private runningBriefs = new Set<string>();
  private runningReview = new Set<string>();
  private jobsSub: Subscription | null = null;
  private availabilitySub: Subscription | null = null;

  constructor(
    private bookService: BookService,
    private router: Router,
    private jobRegistry: JobRegistryService,
    private feedbackAvailability: FeedbackAvailabilityService,
  ) {}

  ngOnInit(): void {
    // One read per session, shared with every later mount of this page (e2). It cannot fail open: the
    // service answers false for a failed read, so a link the deployment does not serve is never drawn.
    this.availabilitySub = this.feedbackAvailability.once().subscribe(available => {
      this.feedbackAvailable = available;
    });
    this.bookService.getAll().subscribe(list => {
      this.books = list;
      // The list itself changed (rows added/removed/reordered): every row's signals are candidates.
      this.rebuildSpineSignals();
    });
    // No request: activeJobs$ is the registry's in-memory view-model of jobs already being tracked.
    this.jobsSub = this.jobRegistry.activeJobs$.subscribe(jobs => {
      const briefs = new Set<string>();
      const review = new Set<string>();
      for (const job of jobs) {
        if (job.kind === 'summary') briefs.add(job.bookId);
        if (job.kind === 'review') review.add(job.bookId);
      }
      // NIT 53: a registry emission fires on every job tick, not only when a book's OWN running flag
      // flips - most emissions change nothing for most books. Diff the two running sets against their
      // previous values and rebuild only the bookIds whose membership actually moved, so an unrelated
      // book's spine keeps the exact same signals object (and does not re-derive) on every unrelated tick.
      const affected = new Set<string>();
      collectChangedIds(this.runningBriefs, briefs, affected);
      collectChangedIds(this.runningReview, review, affected);
      this.runningBriefs = briefs;
      this.runningReview = review;
      if (affected.size > 0) this.rebuildSpineSignals(affected);
    });
  }

  ngOnDestroy(): void {
    this.jobsSub?.unsubscribe();
    this.jobsSub = null;
    // Unsubscribing does NOT cancel the availability request: the cache holds it with `refCount: false`
    // precisely so a page destroyed mid-read does not make the next mount ask again.
    this.availabilitySub?.unsubscribe();
    this.availabilitySub = null;
  }

  /**
   * Rebuild the given rows' signals (every row when `bookIds` is omitted, which is right for a books-list
   * change). Held in a MAP rather than assembled in the template getter, so a row hands the spine a STABLE
   * object identity across change-detection ticks instead of a fresh one that would re-run the derivation
   * continuously - and, per NIT 53, an untouched row keeps its EXISTING object reference rather than being
   * reallocated alongside whichever row actually changed.
   *
   * A SCOPED rebuild carries the previous map forward (that is the point); a FULL one starts empty, so a
   * book that has left the list - deleted, or absent from a reloaded list - takes its entry with it rather
   * than being retained for an id that can never be rendered again.
   */
  private rebuildSpineSignals(bookIds?: ReadonlySet<string>): void {
    const next = bookIds
      ? new Map<string, StageSpineSignals>(this.spineSignals)
      : new Map<string, StageSpineSignals>();
    const ids = bookIds ?? new Set(this.books.map(b => b.id));
    for (const id of ids) {
      const b = this.books.find(x => x.id === id);
      if (!b) {
        next.delete(id);
        continue;
      }
      next.set(b.id, {
        // No chapter list on this surface, and none is fetched: stage 4 makes no claim at all.
        chapters: null,
        chapterCount: b.chapterCount,
        chaptersWithText: b.chaptersWithTextCount,
        // STAGE 5 IS NOT KNOWN HERE, and that is a decision rather than an omission (w8 / F2). Export
        // readiness is "could the exporter render a document", which is a parse of every chapter's stored
        // SFDT - not a SQL count like the two M1 numbers above, and putting it on this payload would turn
        // one metadata query into a full read of every manuscript in the list. So the count is on the
        // BOOK payload only (`BookDetailDto.exportableChapterCount`) and this row says "not known here",
        // exactly as it already does for the briefs and the review.
        //
        // It used to be derived here from `chaptersWithTextCount`, which was free and wrong: a book with
        // word counts and no saved document read `ready` in this list and answered 409 at the endpoint.
        // A cheap wrong answer on a list is still the class of claim this wave removes.
        chaptersExportable: null,
        // The two book-level statuses are not on this payload and are not worth a request per row.
        summary: null,
        review: null,
        // The registry can only raise these, never lower them: see the note above.
        summaryRunning: this.runningBriefs.has(b.id),
        reviewRunning: this.runningReview.has(b.id),
        exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE,
      });
    }
    this.spineSignals = next;
  }

  /** This row's spine signals. Never null once the list has landed; an empty fallback keeps a race safe. */
  spineSignalsFor(book: BookDto): StageSpineSignals {
    // NIT 52: the SHARED frozen instance, not a call to the factory - a fresh object here on every
    // change-detection tick is how a race-window row re-derives its spine continuously for no reason.
    return this.spineSignals.get(book.id) ?? EMPTY_SPINE_SIGNALS;
  }

  cancelCreate(): void {
    this.showCreateForm = false;
    this.newBookTitle = '';
    this.newBookLanguage = 'he';
  }

  submitCreate(): void {
    const title = (this.newBookTitle?.trim()) || this.label('untitled');
    this.creating = true;
    this.bookService.create(title, null, this.newBookLanguage).subscribe({
      next: b => {
        this.creating = false;
        this.cancelCreate();
        this.router.navigate(['/books', b.id]);
      },
      error: () => { this.creating = false; }
    });
  }

  openBook(bookId: string): void {
    this.router.navigate(['/books', bookId]);
  }

  goToImport(bookId: string): void {
    this.router.navigate(['/books', bookId, 'import']);
  }

  deleteBook(book: BookDto): void {
    if (!confirm(this.deleteConfirmMessage(book.title))) return;
    this.deletingId = book.id;
    this.bookService.delete(book.id).subscribe({
      next: () => {
        this.books = this.books.filter(b => b.id !== book.id);
        this.rebuildSpineSignals();
        this.deletingId = null;
        // f02/63: the collapse map is keyed per book id and nothing else ever removes a row, so a
        // deleted book's row would otherwise linger in localStorage forever for an id that can never
        // be reopened.
        clearCollapseState(book.id);
        // w6: the first-run orientation flag is keyed the same way and has the same problem.
        clearOrientationState(book.id);
      },
      error: () => { this.deletingId = null; }
    });
  }
}
