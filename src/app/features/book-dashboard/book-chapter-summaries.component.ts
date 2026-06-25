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
 * Self-contained: it fetches the chapter list itself (BookService.getById) and each chapter's summary
 * (ChapterSummaryService), mirroring how the sibling dashboard children own their own data fetch. Full he/en
 * parity + RTL ([dir] follows bookLanguage, not the dashboard chrome).
 */
@Component({
  selector: 'app-book-chapter-summaries',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="chapter-summaries" [attr.dir]="dir" data-testid="chapter-summaries">
      <h4 class="cs-title">{{ label('title') }}</h4>

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
              <div class="cs-row-head">
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
                  <p class="cs-summary-text" data-testid="cs-summary-text">{{ row.view?.summaryText }}</p>
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
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .chapter-summaries { display: flex; flex-direction: column; gap: 0.5rem; }
    .cs-title { margin: 0 0 0.25rem 0; font-size: 0.9rem; color: #555; }
    .cs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .cs-row { border: 1px solid #eee; border-radius: 6px; padding: 0.5rem 0.75rem; background: #fff; }
    .cs-row-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
    .cs-chapter-title { font-weight: 600; font-size: 0.875rem; }
    .cs-badges { display: flex; gap: 0.35rem; }
    .cs-badge { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 10px; white-space: nowrap; }
    .cs-badge-edited { background: #e6f0ff; color: #0050b3; }
    .cs-badge-analysis { background: #f0eaff; color: #531dab; }
    .cs-badge-stale { background: #fff3e0; color: #ad6800; }
    .cs-summary-text { white-space: pre-wrap; font-size: 0.85rem; line-height: 1.5; margin: 0.4rem 0; }
    .cs-summary-analysis { color: #444; }
    .cs-analysis-note { font-size: 0.75rem; color: #531dab; margin: 0.3rem 0 0.1rem 0; font-style: italic; }
    .cs-textarea { width: 100%; box-sizing: border-box; font-size: 0.85rem; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; resize: vertical; }
    .cs-actions { display: flex; gap: 0.35rem; margin-top: 0.4rem; }
    .cs-btn { padding: 0.3rem 0.6rem; border: 1px solid #ddd; background: #fafafa; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
    .cs-btn:hover:not(:disabled) { background: #f0f0f0; }
    .cs-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .cs-btn-primary { background: #0078d4; color: #fff; border-color: #0078d4; }
    .cs-btn-primary:hover:not(:disabled) { background: #106ebe; }
    .cs-muted { font-size: 0.8rem; color: #666; margin: 0.3rem 0; }
    .cs-error { font-size: 0.8rem; color: #c00; margin: 0.3rem 0; }
    .cs-rederive-offer { margin-top: 0.5rem; padding: 0.5rem; background: #f5f9ff; border: 1px solid #d6e4ff; border-radius: 4px; }
    .cs-rederive-prompt { font-size: 0.8rem; color: #333; margin: 0 0 0.3rem 0; }
    .cs-rederive-result { font-size: 0.8rem; color: #237804; margin: 0.4rem 0 0 0; }
  `]
})
export class BookChapterSummariesComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the summary key. */
  @Input() bookLanguage: string | null = null;

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
      this.loadChapterList();
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
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
          this.rows = (detail.chapters ?? [])
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
            }));
          this.loadingList = false;
          this.cdr.detectChanges();
          this.rows.forEach((r) => this.loadRowSummary(r));
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

  private loadRowSummary(row: ChapterSummaryRow): void {
    if (!this.bookId) return;
    const bookId = this.bookId;
    const lang = this.language;
    row.loading = true;
    row.loadError = false;
    this.subs.push(
      this.summaryService.getChapterSummary(bookId, row.chapterId, lang).subscribe({
        next: (view) => {
          if (this.bookId !== bookId || this.language !== lang) return;
          row.view = view;
          row.loading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          if (this.bookId !== bookId || this.language !== lang) return;
          row.loading = false;
          row.loadError = true;
          this.cdr.detectChanges();
        },
      })
    );
  }

  // ── Edit / save ──────────────────────────────────────────────────────────────

  onEdit(row: ChapterSummaryRow): void {
    row.editing = true;
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
          // STAMPS (hasStructuredBrief/structuredBuiltAt/builtWithModel) that isStructuredStale() reads, but
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
              builtWithModel: resp.builtWithModel,
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

  // ── Localization ─────────────────────────────────────────────────────────────

  /** Localized re-derive terminal-result label. */
  rederiveResultLabel(result: 'done' | 'partial' | 'error'): string {
    const he: Record<string, string> = {
      done: 'הניתוח עודכן מהסיכום שלך. בנו מחדש את סקירת הספר כדי לשקף זאת.',
      partial: 'הסיכום נשמר, אך לא ניתן היה לעדכן את הניתוח כעת. נסו שוב מאוחר יותר.',
      error: 'שגיאה בעדכון הניתוח. הסיכום שלכם נשמר.',
    };
    const en: Record<string, string> = {
      done: 'Analysis updated from your summary. Rebuild the book review to reflect it.',
      partial: 'Summary saved, but the analysis could not be updated right now. Try again later.',
      error: 'Error updating the analysis. Your summary was saved.',
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
    };
    const en: Record<string, string> = {
      title: 'Chapter summaries',
      loading: 'Loading...',
      listError: 'Failed to load the chapter list. Try again.',
      rowError: 'Failed to load the summary. Try again.',
      empty: 'No chapters to show.',
      noSummary: 'No summary yet.',
      analysisBadge: 'From analysis',
      analysisNote: 'Summary from the automatic analysis. Edit to create your own.',
      digestPlot: 'Plot events:',
      digestCharacters: 'Characters:',
      digestThemes: 'Themes and motifs:',
      digestTone: 'Tone:',
      digestOpenThreads: 'Open threads:',
      edit: 'Edit',
      add: 'Add summary',
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      editAria: 'Edit the chapter summary',
      editedBadge: 'Manually edited',
      staleBadge: 'Analysis out of date',
      rederivePrompt: 'Summary saved. Update the analysis so the book review reflects your change?',
      rederive: 'Update analysis',
      rederiving: 'Updating...',
      rederiveLater: 'Not now',
      saveError: 'Failed to save the summary. Try again.',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }
}
