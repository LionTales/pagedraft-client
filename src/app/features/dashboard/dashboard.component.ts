import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BookService } from '../../core/services/book.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { BookDto } from '../../core/models/book';
import { formatRelativeTime } from '../../core/utils/relative-time';
import { StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import { StageSpineSignals } from '../../shared/stage-spine/stage-spine.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, FormsModule, StageSpineComponent],
  template: `
    <div class="dashboard" [attr.dir]="dir">
      <header class="dash-header">
        <h1>Pagedraft</h1>
        @if (!showCreateForm) {
          <button class="pd-btn pd-btn-primary" (click)="showCreateForm = true">{{ label('newBook') }}</button>
        }
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

  /** Dashboard chrome is always Hebrew-first; no per-book language applies here. */
  private get langKey(): 'he' | 'en' {
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

  constructor(
    private bookService: BookService,
    private router: Router,
    private jobRegistry: JobRegistryService,
  ) {}

  ngOnInit(): void {
    this.bookService.getAll().subscribe(list => {
      this.books = list;
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
      this.runningBriefs = briefs;
      this.runningReview = review;
      this.rebuildSpineSignals();
    });
  }

  ngOnDestroy(): void {
    this.jobsSub?.unsubscribe();
    this.jobsSub = null;
  }

  /**
   * Rebuild every row's signals. Held in a MAP rather than assembled in the template getter, so a row
   * hands the spine a stable object identity across change-detection ticks instead of a fresh one that
   * would re-run the derivation continuously.
   */
  private rebuildSpineSignals(): void {
    const next = new Map<string, StageSpineSignals>();
    for (const b of this.books) {
      next.set(b.id, {
        // No chapter list on this surface, and none is fetched: stage 4 makes no claim at all.
        chapters: null,
        chapterCount: b.chapterCount,
        chaptersWithText: b.chaptersWithTextCount,
        // The two book-level statuses are not on this payload and are not worth a request per row.
        summary: null,
        review: null,
        // The registry can only raise these, never lower them: see the note above.
        summaryRunning: this.runningBriefs.has(b.id),
        reviewRunning: this.runningReview.has(b.id),
        // No export screen in this build of the client (w4 builds it).
        exportSurfaceAvailable: false,
      });
    }
    this.spineSignals = next;
  }

  /** This row's spine signals. Never null once the list has landed; an empty fallback keeps a race safe. */
  spineSignalsFor(book: BookDto): StageSpineSignals {
    return this.spineSignals.get(book.id) ?? {
      chapters: null,
      chapterCount: null,
      chaptersWithText: null,
      summary: null,
      review: null,
      summaryRunning: false,
      reviewRunning: false,
      exportSurfaceAvailable: false,
    };
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
      },
      error: () => { this.deletingId = null; }
    });
  }
}
