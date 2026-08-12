import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { BookService } from '../../core/services/book.service';
import { ChapterSummaryService } from '../../core/services/chapter-summary.service';
import { ChapterSummaryViewDto } from '../../core/models/chapter-summary';
import { StructuredChunkSummaryData } from '../../core/models/analysis-context';
import { ChapterSummaryDto } from '../../core/models/book';

/**
 * One chapter row in the summaries list: the chapter identity (id + title) plus its loaded dual-surface
 * summary view and the transient per-row UI state (editing buffer, in-flight flags, re-derive offer/result).
 */
interface ChapterSummaryRow {
  chapterId: string;
  title: string;
  order: number;
  /** The loaded server view (flat + structured surfaces, stamps, flags); null until loaded. */
  view: ChapterSummaryViewDto | null;
  /** True while this row's summary GET is in flight. */
  loading: boolean;
  /** True when this row's summary GET failed. */
  loadError: boolean;
  /** True while this row is in inline-edit mode. */
  editing: boolean;
  /** The edit buffer (bound to the textarea while editing). */
  draft: string;
  /** True while a PUT save is in flight for this row. */
  saving: boolean;
  /** True when the PUT save failed (the summary was NOT saved). Cleared on retry (onEdit / onSave). */
  saveError: boolean;
  /** True after a successful save, until the user acts on the re-derive offer (the "offer" gate). */
  offerRederive: boolean;
  /** True while a re-derive POST is in flight for this row. */
  rederiving: boolean;
  /** Terminal re-derive outcome message to surface (localized at render via the response text), or null. */
  rederiveResult: 'done' | 'partial' | 'error' | null;
  /**
   * When true the row body (summary text + edit area + actions) is hidden; only the header (title + badges)
   * is visible. Default: true (collapsed) so the list is compact on large books. A row that is mid-edit is
   * kept expanded regardless of this flag (see template guard).
   */
  collapsed: boolean;
  /**
   * The in-flight summary-GET subscription for THIS row (supersession slot). A fresh load for the same row
   * cancels+replaces it BEFORE issuing the new request, so a slow older response can never land after (and
   * overwrite) a newer one — both pass the same bookId/language stale-guard, so last-write-wins would be
   * wrong. Cleared on the load's terminal (next OR error). Torn down in ngOnDestroy.
   */
  loadSub?: Subscription;
}

/**
 * wb3-c04: the "Chapter summaries" surface for the book dashboard. Lists every chapter with its flat,
 * USER-AUTHORITATIVE summary (the user's own understanding of the chapter, distinct from the AI structured
 * brief the whole-book review reads). Each row is inline-editable; saving sets the clobber-guard flag so a
 * later automatic re-summary will not overwrite the edit.
 *
 * After a save, the row OFFERS (asks - never silent) the explicit "re-derive analysis" action that rebuilds
 * the structured brief SEEDED with the edited summary, so the whole-book review reflects the change. The
 * re-derive is synchronous (one chapter, one model call); its running + terminal state is reflected per row.
 *
 * Fetches each chapter's summary itself (ChapterSummaryService) - that per-row read has no other source.
 * The CHAPTER LIST is different: wave3-spine-fixes f05 found this surface re-fetching the same book detail
 * (BookService.getById) the host already holds and passes down as far as `book-dashboard`'s own `chapters`
 * @Input, one of the "GET /api/books/{id} fires twice" duplicates measured live. `chapters` below is that
 * same host-supplied list, forwarded one level further; when it is present at FIRST mount this component
 * builds its rows from it instead of re-fetching. A LATER context switch (a book swap while this dashboard
 * instance stays open) keeps the original self-contained fetch: the host clears `chapters` to null while
 * its own reload for the new book is in flight, so there is nothing fresh to adopt at that moment, and folding
 * that path in too was judged out of scope for the trigger this fix targets. A caller that never binds
 * `chapters` at all (every existing spec) sees `this.chapters` stay `null` and the original fetch, unchanged.
 */
@Component({
  selector: 'app-book-chapter-summaries',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="chapter-summaries" [attr.dir]="dir" data-testid="chapter-summaries">
      <div class="cs-title-row">
        <h4 class="cs-title">{{ label('title') }}</h4>
        @if (rows.length > 0) {
          <button
            type="button"
            class="cs-btn cs-btn-collapse-all"
            data-testid="cs-collapse-all-toggle"
            (click)="toggleCollapseAll()">
            {{ allCollapsed ? label('expandAll') : label('collapseAll') }}
          </button>
        }
      </div>

      @if (loadingList) {
        <p class="cs-muted" data-testid="cs-list-loading">{{ label('loading') }}</p>
      } @else if (listError) {
        <p class="cs-error" data-testid="cs-list-error">{{ label('listError') }}</p>
      } @else if (rows.length === 0) {
        <p class="cs-muted" data-testid="cs-empty">{{ label('empty') }}</p>
      } @else {
        <ul class="cs-list">
          @for (row of rows; track row.chapterId) {
            <li class="cs-row" [attr.data-testid]="'cs-row-' + row.chapterId">
              <!-- Row header: always visible. The chevron button toggles collapse state.
                   A row that is mid-edit stays expanded regardless (collapsing is disabled while editing). -->
              <div class="cs-row-head">
                <button
                  type="button"
                  class="cs-row-toggle"
                  [class.cs-row-toggle--expanded]="!isCollapsed(row)"
                  [attr.aria-expanded]="!isCollapsed(row)"
                  [attr.aria-label]="label('expandRow') + ' ' + row.title"
                  [attr.data-testid]="'cs-row-toggle-' + row.chapterId"
                  (click)="toggleRow(row)">
                  <svg class="cs-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <span class="cs-chapter-title">{{ row.title }}</span>
                <div class="cs-badges">
                  @if (row.view?.summaryUserEdited) {
                    <span class="cs-badge cs-badge-edited" data-testid="cs-badge-edited">
                      {{ label('editedBadge') }}
                    </span>
                  }
                  @if (showStructuredFallback(row)) {
                    <span class="cs-badge cs-badge-analysis" data-testid="cs-badge-analysis">
                      {{ label('analysisBadge') }}
                    </span>
                  }
                  @if (isStructuredStale(row)) {
                    <span class="cs-badge cs-badge-stale" data-testid="cs-badge-stale">
                      {{ label('staleBadge') }}
                    </span>
                  }
                </div>
              </div>

              <!-- Row body: hidden while collapsed (unless mid-edit, which forces the row open). -->
              @if (!isCollapsed(row)) {
                <div class="cs-row-body" [attr.data-testid]="'cs-row-body-' + row.chapterId">
                  @if (row.loading) {
                    <p class="cs-muted" data-testid="cs-row-loading">{{ label('loading') }}</p>
                  } @else if (row.loadError) {
                    <p class="cs-error" data-testid="cs-row-error">{{ label('rowError') }}</p>
                  } @else if (row.editing) {
                    <textarea
                      class="cs-textarea"
                      rows="4"
                      [(ngModel)]="row.draft"
                      [attr.data-testid]="'cs-textarea-' + row.chapterId"
                      [disabled]="row.saving"
                      [attr.aria-label]="label('editAria')">
                    </textarea>
                    <div class="cs-actions">
                      <button
                        type="button"
                        class="cs-btn cs-btn-primary"
                        [disabled]="row.saving || !isDirty(row)"
                        data-testid="cs-save"
                        (click)="onSave(row)">
                        {{ row.saving ? label('saving') : label('save') }}
                      </button>
                      <button
                        type="button"
                        class="cs-btn"
                        [disabled]="row.saving"
                        data-testid="cs-cancel"
                        (click)="onCancel(row)">
                        {{ label('cancel') }}
                      </button>
                    </div>
                    @if (row.saveError) {
                      <p class="cs-error" data-testid="cs-save-error">{{ label('saveError') }}</p>
                    }
                  } @else {
                    @if (row.view?.hasSummary) {
                      <p class="cs-summary-text" data-testid="cs-summary-text">{{ row.view!.summaryText }}</p>
                    } @else if (showStructuredFallback(row)) {
                      <!-- AI structured-brief fallback (READ-only): a human-readable digest of the analysis, NOT
                           the user's own summary. Clicking Edit pre-fills the editor with this digest. -->
                      <p class="cs-analysis-note" data-testid="cs-analysis-note">{{ label('analysisNote') }}</p>
                      <p class="cs-summary-text cs-summary-analysis" data-testid="cs-structured-fallback">{{ structuredDigest(row) }}</p>
                    } @else {
                      <p class="cs-muted" data-testid="cs-no-summary">{{ label('noSummary') }}</p>
                    }
                    <div class="cs-actions">
                      <button
                        type="button"
                        class="cs-btn"
                        data-testid="cs-edit"
                        (click)="onEdit(row)">
                        {{ editButtonLabel(row) }}
                      </button>
                    </div>
                  }

                  <!-- Re-derive OFFER: shown after a successful save (asks the user; never silent). -->
                  @if (row.offerRederive && !row.editing) {
                    <div class="cs-rederive-offer" data-testid="cs-rederive-offer">
                      <p class="cs-rederive-prompt">{{ label('rederivePrompt') }}</p>
                      <div class="cs-actions">
                        <button
                          type="button"
                          class="cs-btn cs-btn-primary"
                          [disabled]="row.rederiving"
                          data-testid="cs-rederive"
                          (click)="onRederive(row)">
                          {{ row.rederiving ? label('rederiving') : label('rederive') }}
                        </button>
                        <button
                          type="button"
                          class="cs-btn"
                          [disabled]="row.rederiving"
                          data-testid="cs-rederive-dismiss"
                          (click)="onDismissRederive(row)">
                          {{ label('rederiveLater') }}
                        </button>
                      </div>
                    </div>
                  }

                  @if (row.rederiveResult) {
                    <p
                      class="cs-rederive-result"
                      [class.cs-error]="row.rederiveResult === 'error'"
                      data-testid="cs-rederive-result">
                      {{ rederiveResultLabel(row.rederiveResult) }}
                    </p>
                  }
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .chapter-summaries {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-4);
      font-family: var(--pd-font-ui);
    }
    .cs-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pd-space-3);
      margin-bottom: var(--pd-space-2);
    }
    .cs-title {
      margin: 0;
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cs-btn-collapse-all {
      font-size: var(--pd-text-caption);
      padding: var(--pd-space-1) var(--pd-space-3);
      color: var(--pd-text-secondary);
      border-color: var(--pd-border);
    }
    .cs-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-4);
    }
    .cs-row {
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      padding: var(--pd-space-4) var(--pd-space-5);
      box-shadow: var(--pd-shadow-1);
    }
    .cs-row-head {
      display: flex;
      align-items: center;
      gap: var(--pd-space-3);
    }
    /* Chevron toggle button: borderless, tight, rotates when expanded. */
    .cs-row-toggle {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      background: transparent;
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      color: var(--pd-text-secondary);
      transition: color var(--pd-dur-fast) var(--pd-ease);
    }
    .cs-row-toggle:hover { color: var(--pd-text); }
    .cs-row-toggle:focus-visible {
      outline: 2px solid var(--pd-primary-600);
      outline-offset: 1px;
    }
    .cs-chevron {
      width: 16px;
      height: 16px;
      /* Collapsed = chevron points down (path draws down-chevron natively);
         Expanded  = rotate 180deg so it points up. Physical rotation is the same in RTL. */
      transform: rotate(0deg);
      transition: transform var(--pd-dur-fast) var(--pd-ease);
    }
    .cs-row-toggle--expanded .cs-chevron {
      transform: rotate(180deg);
    }
    /* The title takes available space; badges stay at the end. */
    .cs-chapter-title {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: var(--pd-weight-bold);
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text);
    }
    .cs-row-body {
      margin-top: var(--pd-space-3);
    }
    .cs-badges { display: flex; gap: var(--pd-space-2); flex-wrap: wrap; }
    .cs-badge {
      font-size: var(--pd-text-caption);
      padding: var(--pd-space-1) var(--pd-space-3);
      border-radius: var(--pd-radius-pill);
      white-space: nowrap;
      font-weight: var(--pd-weight-medium);
      background: var(--pd-neutral-100);
      color: var(--pd-text-secondary);
    }
    .cs-badge-edited {
      background: var(--pd-primary-50);
      color: var(--pd-primary-700);
    }
    .cs-badge-analysis {
      background: var(--pd-linguistic-bg);
      color: var(--pd-linguistic-ink);
    }
    .cs-badge-stale {
      background: var(--pd-improve-bg);
      color: var(--pd-improve);
    }
    .cs-summary-text {
      white-space: pre-wrap;
      font-family: var(--pd-font-reading);
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body);
      color: var(--pd-text);
      margin: var(--pd-space-3) 0;
    }
    .cs-summary-analysis { color: var(--pd-text-secondary); }
    .cs-analysis-note {
      font-size: var(--pd-text-caption);
      color: var(--pd-linguistic-ink);
      margin: var(--pd-space-3) 0 var(--pd-space-2) 0;
      font-style: italic;
    }
    .cs-textarea {
      width: 100%;
      box-sizing: border-box;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body);
      padding: var(--pd-space-3) var(--pd-space-4);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-sm);
      resize: vertical;
      color: var(--pd-text);
      background: var(--pd-surface);
    }
    .cs-textarea:focus {
      outline: none;
      box-shadow: var(--pd-ring);
      border-color: var(--pd-primary-600);
    }
    .cs-actions { display: flex; gap: var(--pd-space-3); margin-top: var(--pd-space-3); flex-wrap: wrap; }
    .cs-btn {
      padding: var(--pd-space-2) var(--pd-space-4);
      border: 1px solid var(--pd-border);
      background: var(--pd-surface);
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      font-size: var(--pd-text-body-sm);
      font-family: var(--pd-font-ui);
      color: var(--pd-text-secondary);
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }
    .cs-btn:hover:not(:disabled) { background: var(--pd-surface-sunken); }
    .cs-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .cs-btn-primary {
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
      border-color: var(--pd-primary-600);
    }
    .cs-btn-primary:hover:not(:disabled) { background: var(--pd-primary-hover); }
    .cs-muted { font-size: var(--pd-text-body-sm); color: var(--pd-text-muted); margin: var(--pd-space-2) 0; }
    .cs-error { font-size: var(--pd-text-body-sm); color: var(--pd-cut); margin: var(--pd-space-2) 0; }
    .cs-rederive-offer {
      margin-top: var(--pd-space-4);
      padding: var(--pd-space-4);
      background: var(--pd-info-bg);
      border: 1px solid var(--pd-primary-100);
      border-radius: var(--pd-radius-md);
    }
    .cs-rederive-prompt {
      font-size: var(--pd-text-body-sm);
      color: var(--pd-text);
      margin: 0 0 var(--pd-space-3) 0;
    }
    .cs-rederive-result {
      font-size: var(--pd-text-body-sm);
      color: var(--pd-keep);
      margin: var(--pd-space-3) 0 0 0;
    }
  `]
})
export class BookChapterSummariesComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the summary key. */
  @Input() bookLanguage: string | null = null;
  /**
   * Bumped by the host (dashboard) when the book-summary build COMPLETES, so this surface re-fetches the
   * newly built briefs. Without it the list fetches once at mount and shows a stale "no summary yet" for
   * chapters whose briefs finished after mount (see plan rf-f04 / build-complete fan-out).
   */
  @Input() refreshSignal = 0;
  /**
   * wave3-spine-fixes f05. The host's already-loaded chapter list (book-dashboard's own `chapters` @Input,
   * bound straight through). Optional and display-scoped only: used to skip this component's OWN
   * `BookService.getById` on first mount when present (see the class docstring). Left `null` by every
   * caller that does not bind it, which preserves the original self-contained fetch for them exactly.
   */
  @Input() chapters: ChapterSummaryDto[] | null = null;

  rows: ChapterSummaryRow[] = [];
  loadingList = false;
  listError = false;
  /** The chapterId of the row whose PUT save is currently in flight, or null when idle. */
  savingRowId: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private bookService: BookService,
    private summaryService: ChapterSummaryService,
    private cdr: ChangeDetectorRef
  ) {}

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  get dir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  private get langKey(): 'he' | 'en' {
    return this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      const bookIdChange = changes['bookId'];
      // f05: first mount with the host's chapter list already in hand (see the class docstring) - build
      // straight from it instead of re-fetching the same book detail the host already holds. Angular sets
      // every bound @Input before calling ngOnChanges once with all of them, so `this.chapters` already
      // holds the host's array here if it was bound at all. `isFirstChange()` keeps this to the mount only;
      // a later book switch (this dashboard instance stays open) falls through to the unchanged fetch below.
      if (bookIdChange?.isFirstChange() && this.bookId && this.chapters) {
        this.buildRowsFromChapters(this.chapters);
        return;
      }
      this.loadChapterList();
      return;
    }
    // Host bumped refreshSignal (a book-summary build completed): re-fetch summaries in place. Full reload
    // only if the list never loaded; otherwise refresh each row without clearing or flashing the list.
    const refresh = changes['refreshSignal'];
    if (refresh && !refresh.firstChange) {
      // A chapter-list load already in flight will populate the rows and fetch their (now-built) summaries
      // itself, so bail rather than start a duplicate getById. (rows is empty for the whole in-flight window,
      // so the rows.length === 0 branch would otherwise re-enter loadChapterList mid-load — the same reason
      // refreshSummaries guards on loadingList.)
      if (this.loadingList) return;
      if (this.rows.length === 0) {
        this.loadChapterList();
      } else {
        this.refreshSummaries();
      }
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    // Per-row summary loads live in their own supersession slot (loadRowSummary), not this.subs — tear those
    // down too so no in-flight summary GET survives destruction.
    this.rows.forEach((r) => r.loadSub?.unsubscribe());
  }

  // ── Load ─────────────────────────────────────────────────────────────────────

  /** Fetch the chapter list, then load each chapter's summary. Drops responses after a context switch. */
  loadChapterList(): void {
    if (!this.bookId) {
      this.rows = [];
      return;
    }
    const bookId = this.bookId;
    this.loadingList = true;
    this.listError = false;
    this.rows = [];
    this.savingRowId = null;
    this.subs.push(
      this.bookService.getById(bookId).subscribe({
        next: (detail) => {
          if (this.bookId !== bookId) return;
          this.buildRowsFromChapters(detail.chapters ?? []);
        },
        error: () => {
          if (this.bookId !== bookId) return;
          this.loadingList = false;
          this.listError = true;
          this.cdr.detectChanges();
        },
      })
    );
  }

  /**
   * f05: build `rows` directly from an already-known chapter list (either the host-supplied `chapters`
   * @Input at first mount, or `detail.chapters` from this component's own `loadChapterList` fetch) and
   * kick off each row's own summary load - the one part no chapter list, host-supplied or fetched, carries.
   * Extracted so both sources share exactly one row-shape and one "then load every summary" step.
   */
  private buildRowsFromChapters(chapters: ChapterSummaryDto[]): void {
    this.rows = chapters
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        chapterId: c.id,
        title: c.title,
        order: c.order,
        view: null,
        loading: false,
        loadError: false,
        editing: false,
        draft: '',
        saving: false,
        saveError: false,
        offerRederive: false,
        rederiving: false,
        rederiveResult: null,
        collapsed: true,
      }));
    this.loadingList = false;
    this.listError = false;
    this.cdr.detectChanges();
    this.rows.forEach((r) => this.loadRowSummary(r));
  }

  /**
   * Re-fetch every row's summary IN PLACE (no list reset, no loading flash), skipping rows the user is
   * actively editing/saving/re-deriving. Called when the host signals a book-summary build completed, so
   * chapters whose briefs finished after this surface mounted stop showing the stale "no summary" state.
   */
  refreshSummaries(): void {
    if (!this.bookId || this.loadingList) return;
    this.rows.forEach((r) => {
      if (r.editing || r.saving || r.rederiving) return;
      this.loadRowSummary(r, true);
    });
  }

  private loadRowSummary(row: ChapterSummaryRow, silent = false): void {
    if (!this.bookId) return;
    const bookId = this.bookId;
    const lang = this.language;
    // Supersession: cancel any prior in-flight load for THIS row before issuing a new one. A refresh that
    // races an older load for the same chapter would otherwise let whichever HTTP response lands LAST win —
    // both pass the bookId/language stale-guard, so an older response could overwrite a newer one. Cancelling
    // the prior subscription guarantees it can never emit into this row again.
    row.loadSub?.unsubscribe();
    // On a silent refresh keep the current content visible (no loading flash) until the new view arrives.
    if (!silent) row.loading = true;
    row.loadError = false;
    row.loadSub = this.summaryService.getChapterSummary(bookId, row.chapterId, lang).subscribe({
      next: (view) => {
        row.loadSub = undefined;
        if (this.bookId !== bookId || this.language !== lang) return;
        row.view = view;
        row.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        row.loadSub = undefined;
        if (this.bookId !== bookId || this.language !== lang) return;
        row.loading = false;
        // On a silent refresh a transient error must NOT degrade a previously-good row to error state —
        // leave the existing content intact and stay invisible to the user.
        if (!silent) row.loadError = true;
        this.cdr.detectChanges();
      },
    });
  }

  // ── Edit / save ──────────────────────────────────────────────────────────────

  onEdit(row: ChapterSummaryRow): void {
    row.editing = true;
    row.collapsed = false; // entering edit expands the row so it stays open after save/cancel
    row.saveError = false;
    // Pre-fill from the user's own flat summary when they have one; otherwise, if an AI structured brief
    // exists, seed the editor with its human-readable digest as a STARTING POINT (the user then edits to
    // create their authoritative flat override). Empty when there is neither.
    if (row.view?.hasSummary) {
      row.draft = row.view.summaryText ?? '';
    } else if (this.showStructuredFallback(row)) {
      row.draft = this.structuredDigest(row);
    } else {
      row.draft = '';
    }
    // Re-entering edit clears a stale re-derive offer/result from the previous save.
    row.offerRederive = false;
    row.rederiveResult = null;
  }

  onCancel(row: ChapterSummaryRow): void {
    row.editing = false;
    row.draft = '';
  }

  /** A draft differs from the saved text (whitespace-trimmed) - gates the Save button. */
  isDirty(row: ChapterSummaryRow): boolean {
    return row.draft.trim() !== (row.view?.summaryText ?? '').trim();
  }

  onSave(row: ChapterSummaryRow): void {
    if (!this.bookId || row.saving || !this.isDirty(row)) return;
    // One-save-in-flight guard: refuse to start a second PUT while another row's save is in flight.
    if (this.savingRowId !== null && this.savingRowId !== row.chapterId) return;
    const bookId = this.bookId;
    const lang = this.language;
    row.saving = true;
    row.saveError = false;
    this.savingRowId = row.chapterId;
    this.subs.push(
      this.summaryService.updateChapterSummary(bookId, row.chapterId, row.draft.trim(), lang).subscribe({
        next: (view) => {
          if (this.bookId !== bookId || this.language !== lang) return;
          row.view = view;
          row.editing = false;
          row.saving = false;
          this.savingRowId = null;
          row.draft = '';
          // OFFER the re-derive (ask the user; never auto-run). A prior result is cleared so the offer is fresh.
          row.offerRederive = true;
          row.rederiveResult = null;
          this.cdr.detectChanges();
        },
        error: () => {
          if (this.bookId !== bookId || this.language !== lang) return;
          row.saving = false;
          this.savingRowId = null;
          row.saveError = true;
          // row.editing stays true; row.draft is preserved so the user can retry.
          this.cdr.detectChanges();
        },
      })
    );
  }

  // ── Re-derive ────────────────────────────────────────────────────────────────

  onRederive(row: ChapterSummaryRow): void {
    if (!this.bookId || row.rederiving) return;
    const bookId = this.bookId;
    const lang = this.language;
    row.rederiving = true;
    row.rederiveResult = null;
    this.subs.push(
      this.summaryService.rederiveChapterSummary(bookId, row.chapterId, lang).subscribe({
        next: (resp) => {
          if (this.bookId !== bookId || this.language !== lang) return;
          row.rederiving = false;
          row.offerRederive = false;
          row.rederiveResult = resp.rederived ? 'done' : 'partial';
          // Reflect the freshly built structured surface so the stale badge updates. We adopt the structured
          // STAMPS (hasStructuredBrief/structuredBuiltAt) that isStructuredStale() reads, but
          // deliberately do NOT re-fetch/adopt the parsed `structuredBrief` digest here (P3-14). The digest's
          // only render surface is showStructuredFallback(), which requires an EMPTY flat summary
          // (!view.hasSummary). A re-derive is only ever offered AFTER a successful save of a NON-blank flat
          // summary (offerRederive is set solely in onSave's next handler), and the BE 409s a re-derive when
          // the flat summary is blank - so a just-re-derived row always has hasSummary === true and the
          // fallback digest cannot render for it. Adopting structuredBrief would refresh a field with no
          // reachable surface in this state, so a re-GET would be wasted work. (See plan ## Investigation
          // findings - c03.)
          if (row.view) {
            row.view = {
              ...row.view,
              hasStructuredBrief: resp.hasStructuredBrief,
              structuredBuiltAt: resp.structuredBuiltAt,
            };
          }
          this.cdr.detectChanges();
        },
        error: () => {
          if (this.bookId !== bookId || this.language !== lang) return;
          row.rederiving = false;
          row.rederiveResult = 'error';
          this.cdr.detectChanges();
        },
      })
    );
  }

  onDismissRederive(row: ChapterSummaryRow): void {
    row.offerRederive = false;
  }

  // ── Stale / badge logic ────────────────────────────────────────────────────────

  /**
   * The structured brief is STALE relative to the user's edit when the user edited the flat summary AFTER the
   * structured brief was last built (or the brief was never built). This is exactly the condition the
   * re-derive resolves: it signals the whole-book review is not yet reflecting the edit.
   */
  isStructuredStale(row: ChapterSummaryRow): boolean {
    const v = row.view;
    if (!v || !v.summaryUserEdited) return false;
    if (!v.hasStructuredBrief || !v.structuredBuiltAt) return true;
    if (!v.summaryUserEditedAt) return false;
    return new Date(v.summaryUserEditedAt).getTime() > new Date(v.structuredBuiltAt).getTime();
  }

  // ── Structured-brief fallback (empty flat + AI brief present) ───────────────────────────────────

  /**
   * Show the AI structured-brief digest as a READ-ONLY fallback when the user has NO flat summary of their own
   * but a parseable structured brief exists. This is the "show the AI brief, edit to override" state — clearly
   * distinct from the user's own summary (which keeps its existing rendering + edited badge).
   */
  showStructuredFallback(row: ChapterSummaryRow): boolean {
    const v = row.view;
    return !!v && !v.hasSummary && this.hasStructuredContent(v.structuredBrief);
  }

  /** True when the parsed structured brief carries at least one non-empty fact section. */
  private hasStructuredContent(brief: StructuredChunkSummaryData | null | undefined): boolean {
    if (!brief) return false;
    return (
      (brief.plotEvents?.length ?? 0) > 0 ||
      (brief.characterStates?.length ?? 0) > 0 ||
      (brief.thematicMarkers?.length ?? 0) > 0 ||
      (brief.openThreads?.length ?? 0) > 0 ||
      !!brief.toneNotes?.trim()
    );
  }

  /**
   * Compose the human-readable digest from the structured facts in the row's locale: a short labeled section
   * per non-empty fact group (plot events, characters + their state/arc, themes, tone, open threads). Empty
   * sections are skipped. Used both for the read-only display and as the Edit pre-fill starting point.
   */
  structuredDigest(row: ChapterSummaryRow): string {
    const brief = row.view?.structuredBrief;
    if (!brief) return '';
    const sections: string[] = [];

    if (brief.plotEvents?.length) {
      sections.push(`${this.label('digestPlot')}\n` + brief.plotEvents.map((e) => `• ${e}`).join('\n'));
    }
    if (brief.characterStates?.length) {
      const lines = brief.characterStates.map((c) => {
        const detail = [c.state?.trim(), c.emotionalArc?.trim()].filter((x) => !!x).join(' / ');
        return detail ? `• ${c.name}: ${detail}` : `• ${c.name}`;
      });
      sections.push(`${this.label('digestCharacters')}\n` + lines.join('\n'));
    }
    if (brief.thematicMarkers?.length) {
      sections.push(`${this.label('digestThemes')}\n` + brief.thematicMarkers.map((t) => `• ${t}`).join('\n'));
    }
    if (brief.toneNotes?.trim()) {
      sections.push(`${this.label('digestTone')}\n${brief.toneNotes.trim()}`);
    }
    if (brief.openThreads?.length) {
      sections.push(`${this.label('digestOpenThreads')}\n` + brief.openThreads.map((t) => `• ${t}`).join('\n'));
    }

    return sections.join('\n\n');
  }

  /** Edit/Add button label: "Add summary" when there is nothing of the user's own (even if an AI fallback shows). */
  editButtonLabel(row: ChapterSummaryRow): string {
    return row.view?.hasSummary ? this.label('edit') : this.label('add');
  }

  // ── Collapse ─────────────────────────────────────────────────────────────────

  /**
   * True when a row has a live re-derive offer waiting for the user's response, or a terminal
   * re-derive result that has not yet been dismissed. These are surfaced inside the row body, so
   * collapsing the row would silently hide them.
   */
  hasLiveRederive(row: ChapterSummaryRow): boolean {
    return row.offerRederive || row.rederiveResult !== null;
  }

  /**
   * A row is visually collapsed when its `collapsed` flag is true AND it is NOT currently being
   * edited AND it does NOT have a live re-derive offer or result. Mid-edit rows and rows with a
   * pending re-derive interaction are always shown expanded.
   */
  isCollapsed(row: ChapterSummaryRow): boolean {
    return row.collapsed && !row.editing && !this.hasLiveRederive(row);
  }

  /**
   * Toggle one row's collapsed state. Does nothing while the row is mid-edit (stays forced-open)
   * or while a live re-derive offer/result is active (collapsing would hide it silently).
   */
  toggleRow(row: ChapterSummaryRow): void {
    if (row.editing) return; // mid-edit rows must stay expanded
    if (this.hasLiveRederive(row)) return; // live re-derive offer/result must stay visible
    row.collapsed = !row.collapsed;
    this.cdr.detectChanges();
  }

  /**
   * True when every row is currently collapsed (or there are no rows).
   * Drives the collapse-all / expand-all button label.
   */
  get allCollapsed(): boolean {
    return this.rows.length === 0 || this.rows.every((r) => this.isCollapsed(r));
  }

  /**
   * If all (non-editing) rows are collapsed, expand them all.
   * Otherwise collapse all non-editing rows. Rows with a live re-derive offer or result are
   * skipped on the collapse pass so the active interaction stays visible.
   */
  toggleCollapseAll(): void {
    const expandAll = this.allCollapsed;
    this.rows.forEach((r) => {
      if (r.editing) return; // never touch mid-edit rows
      if (!expandAll && this.hasLiveRederive(r)) return; // skip live re-derive rows on collapse
      r.collapsed = !expandAll;
    });
    this.cdr.detectChanges();
  }

  // ── Localization ─────────────────────────────────────────────────────────────

  /** Localized re-derive terminal-result label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  rederiveResultLabel(result: 'done' | 'partial' | 'error'): string {
    // DRAFT he - needs native review
    const he: Record<string, string> = {
      done: 'הניתוח עודכן מהתקציר שלך. בנו מחדש את סקירת הספר כדי לשקף זאת.',
      partial: 'התקציר נשמר, אך לא ניתן היה לעדכן את הניתוח כעת. נסו שוב מאוחר יותר.',
      error: 'שגיאה בעדכון הניתוח. התקציר שלכם נשמר.',
    };
    const en: Record<string, string> = {
      done: 'Analysis updated from your brief. Rebuild the book review to reflect it.',
      partial: 'Brief saved, but the analysis could not be updated right now. Try again later.',
      error: 'Error updating the analysis. Your brief was saved.',
    };
    return (this.langKey === 'he' ? he : en)[result] ?? result;
  }

  /** Localized static chrome label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  label(key: string): string {
    const he: Record<string, string> = {
      title: 'תקצירי פרקים',
      loading: 'טוען...',
      listError: 'שגיאה בטעינת רשימת הפרקים. נסו שוב.',
      rowError: 'שגיאה בטעינת התקציר. נסו שוב.',
      empty: 'אין פרקים להצגה.',
      noSummary: 'אין תקציר עדיין.',
      analysisBadge: 'מהניתוח',
      analysisNote: 'תקציר מתוך הניתוח האוטומטי. ערכו כדי ליצור תקציר משלכם.',
      digestPlot: 'אירועי עלילה:',
      digestCharacters: 'דמויות:',
      digestThemes: 'מוטיבים ונושאים:',
      digestTone: 'נימה:',
      digestOpenThreads: 'קצוות פתוחים:',
      edit: 'ערוך',
      add: 'הוסף תקציר',
      save: 'שמור',
      saving: 'שומר...',
      cancel: 'בטל',
      editAria: 'ערוך את תקציר הפרק',
      editedBadge: 'נערך ידנית',
      staleBadge: 'הניתוח לא מעודכן',
      rederivePrompt: 'התקציר נשמר. לעדכן את הניתוח כך שסקירת הספר תשקף את השינוי?',
      rederive: 'עדכן ניתוח',
      rederiving: 'מעדכן...',
      rederiveLater: 'לא עכשיו',
      saveError: 'שמירת התקציר נכשלה. נסו שוב.',
      // DRAFT he - needs native review
      collapseAll: 'כווץ הכל',
      // DRAFT he - needs native review
      expandAll: 'הרחב הכל',
      // DRAFT he - needs native review
      expandRow: 'הצג/הסתר פרק',
    };
    const en: Record<string, string> = {
      title: 'Chapter briefs',
      loading: 'Loading...',
      listError: 'Failed to load the chapter list. Try again.',
      rowError: 'Failed to load the brief. Try again.',
      empty: 'No chapters to show.',
      noSummary: 'No brief yet.',
      analysisBadge: 'From analysis',
      analysisNote: 'Brief from the automatic analysis. Edit to create your own.',
      digestPlot: 'Plot events:',
      digestCharacters: 'Characters:',
      digestThemes: 'Themes and motifs:',
      digestTone: 'Tone:',
      digestOpenThreads: 'Open threads:',
      edit: 'Edit',
      add: 'Add brief',
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      editAria: 'Edit the chapter brief',
      editedBadge: 'Manually edited',
      staleBadge: 'Analysis out of date',
      rederivePrompt: 'Brief saved. Update the analysis so the book review reflects your change?',
      rederive: 'Update analysis',
      rederiving: 'Updating...',
      rederiveLater: 'Not now',
      saveError: 'Failed to save the brief. Try again.',
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
      expandRow: 'Toggle chapter',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }
}
