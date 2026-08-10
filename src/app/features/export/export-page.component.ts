import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, Subject, merge } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { BookDetailDto, ChapterSummaryDto } from '../../core/models/book';
import {
  EXPORT_REASON_NOTHING_WRITTEN,
  EXPORT_REASON_NO_CHAPTERS,
  ExportFailure,
  ExportSkipReport,
  ExportedFile,
  isExportFailure,
} from '../../core/models/export';
import { BookService } from '../../core/services/book.service';
import { ExportService } from '../../core/services/export.service';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { chapterDisplayNumber } from '../../core/utils/chapter-number';
import { StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import {
  EXPORT_SURFACE_AVAILABLE,
  StageSpineSignals,
  emptyStageSpineSignals,
} from '../../shared/stage-spine/stage-spine.model';
import {
  EXPORT_COPY,
  EXPORT_ERRORS,
  EXPORT_KINDS,
  ExportKind,
  ExportKindId,
  ExportLang,
  SKIPPED_UNKNOWN,
  exportLang,
  skippedNotice,
} from './export-kinds';

/**
 * Wave 3 / w4 - THE EXPORT SCREEN. Stage 5 of the spine stops being an honest grey box and gets a
 * destination.
 *
 * ── Why a ROUTE and not a dialog ──────────────────────────────────────────────────────────────────
 * `/books/:bookId/export`, a sibling of `/books/:bookId/import`, for three reasons:
 *   1. the spine's Export stage needs a real destination it can send the user to, and "open a dialog on
 *      whatever screen you happen to be on" is not one - the spine is mounted on four surfaces now;
 *   2. the guides are user-visible runtime content and w6 links stages to guide sections, so export has to
 *      be a URL that a guide can name; a dialog has no address;
 *   3. import, the stage at the other end of the same workflow, is already a route. One shape for the two
 *      book-level file operations beats two.
 * The cost is one navigation away from the book, which is why the screen carries an explicit way back and
 * stays deliberately short.
 *
 * ── What this screen is NOT ───────────────────────────────────────────────────────────────────────
 * Not a formatting studio. There are no options, no page setup, no font choices and no scope pickers
 * beyond "which chapter", because the endpoints take no parameters: they are two plain GETs. Inventing
 * controls the server cannot honour would be the same class of lie the wave exists to remove.
 *
 * ── RTL, per element (mirror or fixed) ────────────────────────────────────────────────────────────
 *   - root `dir`          MIRRORS, following the BOOK language (book-scoped surface).
 *   - header + back link  MIRROR. The link sits at the inline end of the header.
 *   - kind rows           MIRROR. `text-align: start`, the format badge at the inline start.
 *   - the chapter select  MIRRORS with its label; the native control follows the inherited `dir`.
 *   - status/error lines  MIRROR, with a `border-inline-start` accent hugging the reading edge.
 *   - numerals (chapter   PHYSICALLY FIXED with `unicode-bidi: isolate`: digits are LTR glyphs and must
 *     order, sizes)       not reorder inside a Hebrew run.
 *   - the busy spinner    PHYSICALLY FIXED. A rotation has no reading direction.
 * Nothing here is draggable, anchored or animated toward a corner, so nothing else needs pinning.
 */
@Component({
  selector: 'app-export-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StageSpineComponent],
  template: `
    <div class="export-page" [attr.dir]="dir" data-testid="export-page">
      <header class="export-header">
        <div>
          <h2>{{ t(COPY.title) }}</h2>
          <p class="subtitle">{{ t(COPY.subtitle) }}</p>
        </div>
        <a class="pd-btn pd-btn-ghost" [routerLink]="['/books', bookId]" data-testid="export-back">
          {{ t(COPY.backToBook) }}
        </a>
      </header>

      <!-- The compact spine, for the same reason the import screen carries one: this is a screen where a
           stage actually HAPPENS, and it reads its signals from the single book request this page already
           makes for its own language. It costs no extra call, and stage 5 now reads real. -->
      <app-stage-spine
        class="export-spine"
        density="compact"
        [bookLanguage]="bookLanguage"
        [signals]="spineSignals">
      </app-stage-spine>

      @if (loading) {
        <p class="export-note" data-testid="export-loading">{{ t(COPY.loading) }}</p>
      }

      @if (bookLoadFailed) {
        <p class="export-note export-note--bad" data-testid="export-book-failed">
          {{ t(COPY.bookLoadFailed) }}
        </p>
      }

      <!-- The book-level precondition, stated ONCE at the top rather than repeated on every row. It is
           derived from the loaded chapter list, which is why it can be said before anything is pressed;
           the server's own 409 is still handled below, because the book can empty out under this screen. -->
      @if (noChapters) {
        <div class="export-note export-note--bad" data-testid="export-no-chapters">
          <p>{{ t(COPY.noChapters) }}</p>
          <a class="pd-btn pd-btn-ghost" [routerLink]="['/books', bookId, 'import']" data-testid="export-goto-import">
            {{ t(COPY.goToImport) }}
          </a>
        </div>
      }

      <!-- THE LIST OF KINDS. Two today; a third joins by adding one entry to EXPORT_KINDS. -->
      <ul class="kind-list" data-testid="export-kinds">
        @for (kind of kinds; track kind.id) {
          <li class="kind" [attr.data-testid]="'export-kind-' + kind.id">
            <div class="kind-head">
              <span class="kind-format" aria-hidden="true">{{ kind.format }}</span>
              <div class="kind-text">
                <h3 class="kind-name">{{ t(kind.name) }}</h3>
                <p class="kind-description">{{ t(kind.description) }}</p>
              </div>
            </div>

            <!-- A kind that is listed but not buildable says WHY. Never a bare grey row. -->
            @if (unavailableReason(kind); as reason) {
              <p class="kind-unavailable" [attr.data-testid]="'export-unavailable-' + kind.id">{{ reason }}</p>
            } @else {
              <div class="kind-controls">
                @if (kind.scope === 'chapter') {
                  <label class="chapter-picker">
                    <span class="chapter-picker__label">{{ t(COPY.chooseChapter) }}</span>
                    <select
                      class="chapter-select"
                      data-testid="export-chapter-select"
                      [disabled]="!chapters.length"
                      [(ngModel)]="selectedChapterId">
                      @for (chapter of chapters; track chapter.id) {
                        <option [value]="chapter.id">{{ chapterOptionLabel(chapter) }}</option>
                      }
                    </select>
                  </label>
                }

                <button
                  type="button"
                  class="pd-btn pd-btn-primary kind-download"
                  [attr.data-testid]="'export-download-' + kind.id"
                  [disabled]="!canRun(kind)"
                  (click)="startExport(kind)">
                  {{ buttonLabel(kind) }}
                </button>
              </div>

              <!-- IN PROGRESS. It says the request is being prepared, which is the only thing true here:
                   these endpoints carry no job and no progress, so no percentage is shown or implied. -->
              @if (busyKindId === kind.id) {
                <p
                  class="kind-busy"
                  role="status"
                  [attr.aria-label]="t(COPY.preparingAria)"
                  [attr.data-testid]="'export-busy-' + kind.id">
                  <span class="kind-spinner" aria-hidden="true"></span>
                  {{ t(COPY.preparing) }}
                </p>
              }

              <!-- The honest failure, in this book's language, naming what to do next. -->
              @if (errorFor(kind); as message) {
                <p
                  class="kind-error"
                  role="alert"
                  [attr.data-testid]="'export-error-' + kind.id">{{ message }}</p>
              }

              <!-- What actually landed, under the name the SERVER chose. -->
              @if (downloadedFor(kind); as fileName) {
                <p class="kind-done" [attr.data-testid]="'export-done-' + kind.id">
                  {{ t(COPY.downloaded) }} <span class="file-name">{{ fileName }}</span>
                </p>
              }

              <!-- ...and what it does NOT contain, from the server's own headers. A chapter missing from an
                   exported manuscript with no word said about it is indistinguishable from data loss. -->
              @if (skippedNoticeFor(kind); as notice) {
                <p class="kind-skipped" [attr.data-testid]="'export-skipped-' + kind.id">{{ notice }}</p>
              }
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: [`
    .export-page {
      padding: var(--pd-space-6);
      font-family: var(--pd-font-ui);
      color: var(--pd-text);
    }

    .export-header {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--pd-space-4);
      flex-wrap: wrap;
      margin-block-end: var(--pd-space-5);
    }
    .export-header h2 {
      margin: 0;
      font-size: var(--pd-text-h2);
      font-weight: var(--pd-weight-semibold);
    }
    .subtitle {
      margin: var(--pd-space-2) 0 0;
      color: var(--pd-text-secondary);
      font-size: var(--pd-text-body-sm);
    }

    .export-spine {
      display: block;
      padding: var(--pd-space-3) var(--pd-space-4);
      margin-block-end: var(--pd-space-5);
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
    }

    .export-note {
      margin: 0 0 var(--pd-space-5);
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text-secondary);
    }
    .export-note--bad {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--pd-space-3);
      padding: var(--pd-space-3) var(--pd-space-4);
      background: var(--pd-improve-bg);
      border: 1px solid var(--pd-improve-border);
      /* Hugs the READING edge, so it mirrors. */
      border-inline-start: 3px solid var(--pd-improve);
      border-radius: var(--pd-radius-sm);
      color: var(--pd-text);
    }
    .export-note--bad p { margin: 0; }

    .kind-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-4);
    }

    .kind {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
      padding: var(--pd-space-4);
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      text-align: start;
    }

    .kind-head {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: var(--pd-space-3);
    }
    .kind-format {
      flex: 0 0 auto;
      font-family: var(--pd-font-mono);
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-secondary);
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-pill);
      padding: 1px var(--pd-space-3);
      /* Latin letters inside a Hebrew run: isolate so the badge cannot reorder its neighbours. */
      unicode-bidi: isolate;
    }
    .kind-text { flex: 1 1 auto; min-width: 0; }
    .kind-name {
      margin: 0;
      font-size: var(--pd-text-body);
      font-weight: var(--pd-weight-semibold);
    }
    .kind-description {
      margin: var(--pd-space-1) 0 0;
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text-secondary);
      white-space: normal;
      overflow-wrap: break-word;
    }

    .kind-controls {
      display: flex;
      flex-direction: row;
      align-items: flex-end;
      gap: var(--pd-space-3);
      flex-wrap: wrap;
    }
    .chapter-picker {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
      font-size: var(--pd-text-caption);
      color: var(--pd-text-secondary);
    }
    .chapter-select {
      min-inline-size: 220px;
      max-inline-size: 100%;
      padding: var(--pd-space-2) var(--pd-space-3);
      font-family: inherit;
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text);
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-sm);
    }
    .chapter-select:focus-visible { outline: none; box-shadow: var(--pd-ring); }

    .kind-download { white-space: normal; }

    .kind-busy,
    .kind-error,
    .kind-done,
    .kind-unavailable {
      margin: 0;
      font-size: var(--pd-text-body-sm);
    }
    .kind-busy {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: var(--pd-space-2);
      color: var(--pd-info);
    }
    .kind-spinner {
      inline-size: 12px;
      block-size: 12px;
      border: 2px solid color-mix(in srgb, var(--pd-info) 30%, transparent);
      border-top-color: var(--pd-info);
      border-radius: 50%;
      animation: export-spin 0.8s linear infinite;
    }
    @keyframes export-spin { to { transform: rotate(360deg); } }

    .kind-error { color: var(--pd-cut); }
    .kind-done { color: var(--pd-keep); }
    /* Not an error (the file did land) and not a success either. It hugs the reading edge, so it mirrors. */
    .kind-skipped {
      padding: var(--pd-space-2) var(--pd-space-3);
      background: var(--pd-improve-bg);
      border-inline-start: 3px solid var(--pd-improve);
      border-radius: var(--pd-radius-sm);
      color: var(--pd-text);
    }
    .kind-unavailable { color: var(--pd-text-muted); }
    .file-name { unicode-bidi: isolate; font-family: var(--pd-font-mono); }
  `],
})
export class ExportPageComponent implements OnInit, OnDestroy {
  /** The book being exported, from the route. */
  bookId: string | null = null;

  /** The book language. This surface is book-scoped chrome, so every string follows it. */
  bookLanguage: string | null = null;

  /** The chapters, in order. Empty until the book lands; {@link loading} tells the two apart. */
  chapters: ChapterSummaryDto[] = [];

  /** Which chapter the single-chapter kind will export. Seeded to the first chapter. */
  selectedChapterId: string | null = null;

  loading = true;
  bookLoadFailed = false;

  /** The kind whose request is in flight, or null. One at a time: the button is disabled while it runs. */
  busyKindId: ExportKindId | null = null;

  /** The last failure per kind, already localized. Cleared when that kind is retried. */
  private errors = new Map<ExportKindId, string>();
  /** The last filename handed to the browser per kind, as the SERVER named it. */
  private downloaded = new Map<ExportKindId, string>();
  /**
   * What the last download per kind LEFT OUT, straight off the response headers.
   *
   * Three distinct values, and the screen says something different for each: no entry (nothing has been
   * downloaded for this kind), `null` (it downloaded, and the server did not say - an old server or a
   * proxy that stripped the header), or a report (it downloaded and this is what is missing, `count: 0`
   * included). The absent-header case may never collapse into "nothing was skipped".
   */
  private skipped = new Map<ExportKindId, ExportSkipReport | null>();

  /** The compact spine's signals, assembled from the same book payload this page already loads. */
  spineSignals: StageSpineSignals = emptyStageSpineSignals();
  private chaptersKnown = false;
  private briefsRunning = false;
  private reviewRunning = false;

  /** Component lifetime. Everything subscribed in {@link ngOnInit} is torn down here, once. */
  private readonly destroy$ = new Subject<void>();
  /**
   * Fires on every bookId change, INCLUDING the first. A subscription scoped to "this book" - the book
   * load itself, and any export in flight when the route changes - is piped through
   * `takeUntil(merge(destroy$, bookChange$))` so it cannot write into this component's state after that
   * state has moved on to a different book.
   *
   * Finding 15: `bookId` used to be read once from `route.snapshot` with no `params` subscription, so a
   * same-route param change (`/books/A/export` -> `/books/B/export`) left `chapters`, `bookLanguage`,
   * `errors`, `downloaded` and `skipped` on the previous book - book B's screen exported book A's
   * manuscript under book A's name. `bookChange$` is what {@link loadForBook} fires to close that window.
   */
  private readonly bookChange$ = new Subject<void>();

  readonly kinds = EXPORT_KINDS;
  readonly COPY = EXPORT_COPY;

  constructor(
    private route: ActivatedRoute,
    private bookService: BookService,
    private exportService: ExportService,
    private jobRegistry: JobRegistryService,
  ) {}

  ngOnInit(): void {
    // A subscription, not a one-time `route.snapshot` read: this route can receive a same-route param
    // change (`/books/A/export` -> `/books/B/export`, reachable via history and the guide's deep link),
    // and a snapshot read would never see it.
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.loadForBook((params['bookId'] as string | undefined) ?? null);
    });
    this.jobRegistry.activeJobs$.pipe(takeUntil(this.destroy$)).subscribe(jobs => {
      this.briefsRunning = jobs.some(j => j.bookId === this.bookId && j.kind === 'summary');
      this.reviewRunning = jobs.some(j => j.bookId === this.bookId && j.kind === 'review');
      this.rebuildSpineSignals();
    });
  }

  ngOnDestroy(): void {
    this.bookChange$.next();
    this.bookChange$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Load (or reload) the whole screen for one book. Runs on the FIRST params emission and again on every
   * same-route bookId change.
   *
   * `bookChange$.next()` fires BEFORE the fields below are reset, so the previous book's load and any
   * export still in flight for it are torn down first and cannot land a response into the fields this
   * method is about to overwrite (Finding 15). Every field this screen holds about "the current book" is
   * reset here, not just `bookId` - a partial reset is the same bug with fewer symptoms.
   */
  private loadForBook(bookId: string | null): void {
    this.bookChange$.next();

    this.bookId = bookId;
    this.bookLanguage = null;
    this.chapters = [];
    this.selectedChapterId = null;
    this.chaptersKnown = false;
    this.loading = true;
    this.bookLoadFailed = false;
    this.busyKindId = null;
    this.errors.clear();
    this.downloaded.clear();
    this.skipped.clear();
    this.briefsRunning = false;
    this.reviewRunning = false;
    this.spineSignals = emptyStageSpineSignals();

    if (!this.bookId) {
      this.loading = false;
      this.bookLoadFailed = true;
      return;
    }

    this.bookService.getById(this.bookId)
      .pipe(takeUntil(merge(this.destroy$, this.bookChange$)))
      .subscribe({
        next: (book: BookDetailDto) => {
          this.bookLanguage = book.language ?? 'he';
          this.chapters = (book.chapters ?? []).slice().sort((a, b) => a.order - b.order);
          this.selectedChapterId = this.chapters.length ? this.chapters[0].id : null;
          this.chaptersKnown = true;
          this.loading = false;
          this.rebuildSpineSignals();
        },
        error: () => {
          // The chapters are UNKNOWN, not empty: the screen says it could not read the book rather than
          // telling the author their book is empty, which would be a claim it cannot make.
          this.bookLanguage = 'he';
          this.chaptersKnown = false;
          this.loading = false;
          this.bookLoadFailed = true;
          this.rebuildSpineSignals();
        },
      });
  }

  /**
   * The spine's signals. The chapter list is real here (this page loads it); the two book-level statuses
   * are not on that payload and are not fetched for a widget, so those stages read the compact density's
   * honest "not known here" unless a tracked job raises one to `running`.
   */
  private rebuildSpineSignals(): void {
    const known = this.chaptersKnown;
    this.spineSignals = {
      chapters: known
        ? this.chapters.map(c => ({ chapterId: c.id, title: c.title, order: c.order, running: false }))
        : null,
      chapterCount: known ? this.chapters.length : null,
      chaptersWithText: known ? this.chapters.filter(c => c.wordCount > 0).length : null,
      summary: null,
      review: null,
      summaryRunning: this.briefsRunning,
      reviewRunning: this.reviewRunning,
      exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE,
    };
  }

  // ── Language ────────────────────────────────────────────────────────────────────────────────────

  get lang(): ExportLang {
    return exportLang(this.bookLanguage);
  }

  /** MIRRORS with the book language. */
  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  t(bi: Record<ExportLang, string>): string {
    return bi[this.lang];
  }

  // ── Row state ───────────────────────────────────────────────────────────────────────────────────

  /**
   * True once the book has landed AND it genuinely has no chapters. Never true while loading.
   *
   * There is deliberately NO companion precondition for "chapters exist but none has text", even though
   * this page holds the word counts to compute one and the spine's stage 5 renders exactly that state. The
   * spine is a READOUT and may warn from its own signal; this screen is the place a request is spent, and
   * the exporter's definition of an empty chapter (no renderable block) is not the word count. Disabling
   * the button on a client-side guess would refuse a download the server would have honoured. The server's
   * `nothingWritten` 409 is handled in {@link failureMessage} instead, which is the answer from the one
   * authority that knows.
   */
  get noChapters(): boolean {
    return this.chaptersKnown && this.chapters.length === 0;
  }

  /** The reason a kind cannot run, or null when it can. Null means the controls render. */
  unavailableReason(kind: ExportKind): string | null {
    return kind.availability.available ? null : this.t(kind.availability.reason);
  }

  /**
   * Whether the download button is live. Disabled, never hidden: a kind that exists should stay visible
   * with a visible reason beside it (the no-chapters note above, or the picker's own empty state).
   */
  canRun(kind: ExportKind): boolean {
    if (!kind.availability.available) return false;
    if (!this.bookId || this.loading || this.busyKindId !== null) return false;
    if (this.noChapters || !this.chaptersKnown) return false;
    if (kind.scope === 'chapter') return !!this.selectedChapterId;
    return true;
  }

  /** The button's label. It says what it is doing while it runs rather than going blank or spinning mute. */
  buttonLabel(kind: ExportKind): string {
    return this.busyKindId === kind.id ? this.t(this.COPY.preparing) : this.t(this.COPY.download);
  }

  errorFor(kind: ExportKind): string | null {
    return this.errors.get(kind.id) ?? null;
  }

  downloadedFor(kind: ExportKind): string | null {
    return this.downloaded.get(kind.id) ?? null;
  }

  /**
   * What the last download for this kind left out, as a sentence, or null when there is nothing to say
   * (nothing downloaded yet, or the server reported a complete file).
   *
   * The count and the names come from the SERVER. Nothing here derives a skip from the chapter list this
   * page already holds: the exporter's test for an empty chapter is not this client's, and a prediction
   * would name the wrong chapters with total confidence.
   */
  skippedNoticeFor(kind: ExportKind): string | null {
    if (!this.downloaded.has(kind.id)) return null;
    if (!this.skipped.has(kind.id)) return null;
    const report = this.skipped.get(kind.id) ?? null;
    if (report === null) return this.t(SKIPPED_UNKNOWN);
    if (report.count <= 0) return null;
    const names = report.chapters.map(c => `${this.chapterNumber(c.order)}. ${c.title}`);
    return skippedNotice(report.count, names, this.lang);
  }

  /** "3. The Long Night" - the order the author sees, one-based, isolated from the surrounding script. */
  chapterOptionLabel(chapter: ChapterSummaryDto): string {
    return `${this.chapterNumber(chapter.order)}. ${chapter.title}`;
  }

  /**
   * The number the author sees for a chapter, from the raw zero-based `Chapter.Order` the wire carries -
   * both in the picker and in the skipped-chapter notice, so this screen cannot call one chapter two
   * different numbers on the same page.
   *
   * c07: this used to be a private stopgap (`order + 1`) so a third numbering convention could not form
   * before the cross-surface decision landed. It now delegates to the shared {@link chapterDisplayNumber},
   * the same function `stage-spine.component.ts`, `book-review-findings.component.ts` and
   * `book-story-bible.component.ts` call - one convention, one place it is computed.
   */
  private chapterNumber(order: number): number {
    return chapterDisplayNumber(order);
  }

  // ── Running an export ───────────────────────────────────────────────────────────────────────────

  /**
   * THE DISPATCH, and the reason a third kind is one entry rather than a rework.
   *
   * The switch is over the kind's ID, not over its scope: a future book-scoped kind (the editor report is
   * exactly that) must not silently fall into the whole-book DOCX call. The `never` assignment at the end
   * makes an id with no case a COMPILE error, so the catalog and the dispatch cannot drift apart.
   */
  startExport(kind: ExportKind): void {
    if (!this.canRun(kind) || !this.bookId) return;
    this.errors.delete(kind.id);
    this.downloaded.delete(kind.id);
    this.skipped.delete(kind.id);
    this.busyKindId = kind.id;

    switch (kind.id) {
      case 'book-docx':
        this.run(kind, this.exportService.exportBook(this.bookId));
        return;
      case 'chapter-docx': {
        const chapterId = this.selectedChapterId;
        if (!chapterId) {
          this.busyKindId = null;
          return;
        }
        this.run(kind, this.exportService.exportChapter(this.bookId, chapterId));
        return;
      }
      default: {
        const unreachable: never = kind.id;
        void unreachable;
        this.busyKindId = null;
      }
    }
  }

  /**
   * One subscription shape for every kind, so the two document paths cannot behave differently here.
   *
   * `takeUntil(merge(destroy$, bookChange$))` (Finding 14): without it, a response landing after this
   * component is destroyed - or after the route moved on to a different book - called `saveAs` from a
   * dead component and dropped a file onto whatever screen the user had since navigated to.
   */
  private run(kind: ExportKind, call: Observable<ExportedFile>): void {
    call.pipe(takeUntil(merge(this.destroy$, this.bookChange$))).subscribe({
      next: (file: ExportedFile) => {
        this.busyKindId = null;
        // saveAs FIRST (Finding 37): `downloaded` must never say a file landed before the browser actually
        // has it. A throw here is treated the same as a transport failure - the user sees a truthful error,
        // not "Downloaded: X" naming a file that never reached disk.
        try {
          this.exportService.saveAs(file);
        } catch (err) {
          this.errors.set(kind.id, this.failureMessage(kind, err));
          return;
        }
        this.downloaded.set(kind.id, file.fileName);
        // Recorded even when it is null: "the server did not say" is a state this screen renders.
        this.skipped.set(kind.id, file.skipped);
      },
      error: (err: unknown) => {
        this.busyKindId = null;
        this.errors.set(kind.id, this.failureMessage(kind, err));
      },
    });
  }

  /**
   * Turn a failure into this book's language. Every branch is a thing the wire can actually produce, and an
   * unrecognized failure gets the generic sentence rather than an invented cause.
   *
   * The 409 is keyed on the server's REASON TOKEN, not on the status: the day the server added a second 409
   * reason, this kept saying a truthful sentence instead of confidently saying the wrong one. That day has
   * now come (`nothingWritten`), and the second token gets its own sentence PER KIND, because the next
   * action genuinely differs: the whole book can be filled by an import, a single chapter cannot.
   */
  private failureMessage(kind: ExportKind, err: unknown): string {
    if (!isExportFailure(err)) return this.t(EXPORT_ERRORS.generic);
    const failure: ExportFailure = err;
    if (failure.reason === EXPORT_REASON_NO_CHAPTERS) return this.t(EXPORT_ERRORS.noChapters);
    if (failure.reason === EXPORT_REASON_NOTHING_WRITTEN) {
      return kind.scope === 'chapter'
        ? this.t(EXPORT_ERRORS.nothingWrittenChapter)
        : this.t(EXPORT_ERRORS.nothingWrittenBook);
    }
    if (failure.status === 404) {
      return kind.scope === 'chapter'
        ? this.t(EXPORT_ERRORS.chapterNotFound)
        : this.t(EXPORT_ERRORS.bookNotFound);
    }
    if (failure.status === 0) return this.t(EXPORT_ERRORS.offline);
    return this.t(EXPORT_ERRORS.generic);
  }
}
