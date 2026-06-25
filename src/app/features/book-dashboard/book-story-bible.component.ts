import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  BookFinding,
  BookReviewFindingsDto,
  ChapterAnchor,
  Dimension,
  Verdict,
} from '../../core/models/book-review';
import { BookReviewService } from '../../core/services/book-review.service';

/** The thread-state vocabulary the Threads section groups by (style-sheet ledger). */
export type ThreadState = 'open' | 'resolved' | 'dangling';

/**
 * wb3-c03: the Story Bible / continuity ledger tab (C) for the whole-book developmental review.
 * This is the G3 "chapter-anchored style-sheet ledger" continuity artifact from
 * src/docs/EDITING_COVERAGE_AND_GAPS.md - operationalizing continuity as a persistent, chapter-anchored
 * style sheet (Characters / Threads / Timeline) rather than ephemeral per-suggestion notes.
 *
 * DATA SOURCE (premise-verified): v1 sources the Story Bible from the SAME BookReviewFindingsDto the c02
 * findings panel reads (BookReviewService.getReviewFindings). The richer per-entity brief facts
 * (StructuredChunkSummaryData: CharacterStates / OpenThreads / ThematicMarkers / ToneNotes) live only in
 * the server-internal briefs (ChunkSummary.StructuredJson) - NO controller endpoint exposes them to the FE
 * (grep of Controllers/ for those symbols returns zero), so brief-facts enrichment is a deferred follow-up.
 * Three sections are derived from the findings:
 *   - Characters: character-dimension findings (each chapter-anchored), plus any continuity finding whose
 *     rationale/evidence names a character (kept minimal in v1: character-dimension only - see followups).
 *   - Threads (open/resolved/dangling): from continuity-dimension findings, classified by editorial verdict
 *     (improve -> open/unresolved, keep -> resolved/consistent, cut -> dangling/to-remove).
 *   - Timeline: continuity-dimension findings that carry >=1 chapter anchor are the contradiction entries
 *     (a contradiction is, by definition, traceable to the chapters where the conflicting facts appear).
 *
 * Rendering is GATED by the host (mounted only when the wb3-c01 review status row is READY/STALE), mirroring
 * the c02 findings panel. Chapter anchors are rendered as chips with the SAME clean navigation seam
 * (@Output() openChapter) for wb3-f01 to wire; no navigation path is invented here.
 */
@Component({
  selector: 'app-book-story-bible',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './book-story-bible.component.html',
  styleUrl: './book-story-bible.component.scss',
})
export class BookStoryBibleComponent implements OnChanges, OnDestroy {
  @Input() bookId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Defaults to 'he'. Drives localization, [dir], and the findings key. */
  @Input() bookLanguage: string | null = null;
  /**
   * A monotonic refresh token from the host: bumping it (e.g. after a review build terminal) re-reads the
   * findings without changing book/language. Mirrors the c02 findings panel's refreshToken.
   */
  @Input() refreshToken = 0;

  /**
   * Navigation seam for wb3-f01: emitted when the user clicks a chapter-anchor chip. The host (later)
   * wires this to focus the chapter in the editor. No navigation path is invented in this component.
   */
  @Output() openChapter = new EventEmitter<ChapterAnchor>();

  /** All findings for the current (book, language); the three sections derive from this list. */
  findings: BookFinding[] = [];
  /** True while the findings fetch is in flight (first load / refresh). */
  loading = false;
  /** True when the findings fetch failed (drives the error state; distinct from the empty state). */
  loadError = false;

  /** Ids of entries whose evidence/suggested-action detail is expanded. */
  expandedIds = new Set<string>();

  /** The thread states rendered, in display order. */
  readonly threadStates: ThreadState[] = ['open', 'dangling', 'resolved'];

  /** The latest in-flight GET findings fetch (cancels previous on overlap / context change). */
  private findingsSub: Subscription | null = null;

  constructor(
    private bookReviewService: BookReviewService,
    private cdr: ChangeDetectorRef
  ) {}

  /** Effective book language for findings calls (defaults to 'he'). */
  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      this.resetView();
      this.loadFindings();
    } else if (changes['refreshToken'] && !changes['refreshToken'].firstChange) {
      this.loadFindings();
    }
  }

  ngOnDestroy(): void {
    this.findingsSub?.unsubscribe();
  }

  // ── Load ─────────────────────────────────────────────────────────────────────

  /** Fetch findings for the current (book, language). Drops a response after a context switch. */
  loadFindings(): void {
    if (!this.bookId) {
      this.findings = [];
      return;
    }
    const bookId = this.bookId;
    const lang = this.language;
    this.loading = true;
    this.loadError = false;
    this.findingsSub?.unsubscribe();
    this.findingsSub = this.bookReviewService.getReviewFindings(bookId, lang).subscribe({
      next: (dto: BookReviewFindingsDto) => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.findings = (dto.findings ?? []).map((f) => ({ ...f }));
        this.loading = false;
        this.loadError = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.loading = false;
        this.loadError = true;
        this.cdr.detectChanges();
      },
    });
  }

  private resetView(): void {
    this.expandedIds.clear();
    this.findings = [];
    this.loadError = false;
    this.findingsSub?.unsubscribe();
  }

  // ── Section derivations ──────────────────────────────────────────────────────

  /** Findings of a given dimension (preserves input order). */
  private byDimension(dimension: Dimension): BookFinding[] {
    return this.findings.filter((f) => f.dimension === dimension);
  }

  /**
   * Characters section: character-dimension findings, each chapter-anchored. v1 keeps this to the
   * character dimension only; pulling the named-character continuity findings (and the richer per-entity
   * CharacterStates facts) into per-character cards is the deferred brief-facts enrichment follow-up.
   */
  get characterEntries(): BookFinding[] {
    return this.byDimension('character');
  }

  /** All continuity-dimension findings - the substrate for both Threads and Timeline. */
  get continuityFindings(): BookFinding[] {
    return this.byDimension('continuity');
  }

  /**
   * Map a continuity finding's editorial verdict onto the style-sheet thread vocabulary:
   *   improve -> open (an unresolved/loose thread to address),
   *   keep    -> resolved (a consistent/closed thread),
   *   cut     -> dangling (a thread that should be removed/does not pay off).
   */
  threadStateOf(verdict: Verdict): ThreadState {
    switch (verdict) {
      case 'improve':
        return 'open';
      case 'keep':
        return 'resolved';
      case 'cut':
        return 'dangling';
    }
  }

  /** Continuity findings for a given thread state (derived from their verdict). */
  threadsFor(state: ThreadState): BookFinding[] {
    return this.continuityFindings.filter((f) => this.threadStateOf(f.verdict) === state);
  }

  /**
   * Timeline section: continuity findings that carry at least one chapter anchor are the contradiction
   * entries - a continuity contradiction is, by definition, traceable to the chapter(s) where the
   * conflicting facts appear. Continuity findings with no anchor are NOT timeline contradictions (they
   * still appear under Threads).
   */
  get timelineEntries(): BookFinding[] {
    return this.continuityFindings.filter((f) => (f.chapterAnchors?.length ?? 0) > 0);
  }

  // ── Empty-state predicates ───────────────────────────────────────────────────

  /** True when the review loaded with zero findings of ANY dimension (the whole-bible empty state). */
  get isEmpty(): boolean {
    return !this.loading && !this.loadError && this.findings.length === 0;
  }

  get hasCharacters(): boolean {
    return this.characterEntries.length > 0;
  }
  get hasThreads(): boolean {
    return this.continuityFindings.length > 0;
  }
  get hasTimeline(): boolean {
    return this.timelineEntries.length > 0;
  }

  // ── Interactions ─────────────────────────────────────────────────────────────

  toggleExpand(id: string): void {
    if (this.expandedIds.has(id)) this.expandedIds.delete(id);
    else this.expandedIds.add(id);
  }

  isExpanded(id: string): boolean {
    return this.expandedIds.has(id);
  }

  /** Emit the navigation seam for wb3-f01 (no navigation invented here). */
  onAnchorClick(anchor: ChapterAnchor): void {
    this.openChapter.emit(anchor);
  }

  // ── Localization ─────────────────────────────────────────────────────────────

  /** 'rtl' for Hebrew (default), 'ltr' for English. Drives [dir] on the panel. */
  get bibleDir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  private get langKey(): 'he' | 'en' {
    return this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  /** Localized verdict label (mirrors the c02 findings map; kept local so the bible stands alone). */
  verdictLabel(verdict: Verdict): string {
    const he: Record<Verdict, string> = {
      keep: 'לשמר',
      improve: 'לשפר',
      cut: 'להסיר',
    };
    const en: Record<Verdict, string> = {
      keep: 'Keep',
      improve: 'Improve',
      cut: 'Cut',
    };
    return (this.langKey === 'he' ? he : en)[verdict] ?? verdict;
  }

  /** Verdict glyph used as the entry icon (decorative; the label carries the meaning for a11y). */
  verdictIcon(verdict: Verdict): string {
    switch (verdict) {
      case 'keep':
        return '✓';
      case 'improve':
        return '◑';
      case 'cut':
        return '✕';
    }
  }

  /** Localized thread-state label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  threadStateLabel(state: ThreadState): string {
    const he: Record<ThreadState, string> = {
      open: 'פתוח',
      resolved: 'נסגר',
      dangling: 'תלוי',
    };
    const en: Record<ThreadState, string> = {
      open: 'Open',
      resolved: 'Resolved',
      dangling: 'Dangling',
    };
    return (this.langKey === 'he' ? he : en)[state] ?? state;
  }

  /** Localized static chrome label. DRAFT Hebrew - flag for native-speaker review before sign-off. */
  label(key: string): string {
    const he: Record<string, string> = {
      charactersTitle: 'דמויות',
      threadsTitle: 'קווי עלילה',
      timelineTitle: 'ציר זמן',
      charactersEmpty: 'אין ממצאי דמויות.',
      threadsEmpty: 'אין קווי עלילה.',
      timelineEmpty: 'אין סתירות בציר הזמן.',
      empty: 'אין נתונים ל"ספר הסיפור" עדיין.',
      loadError: 'שגיאה בטעינת ספר הסיפור. נסו שוב.',
      loading: 'טוען את ספר הסיפור...',
      chapters: 'פרקים',
      evidence: 'ראיות',
      suggestedAction: 'פעולה מומלצת',
      more: 'עוד',
      less: 'פחות',
    };
    const en: Record<string, string> = {
      charactersTitle: 'Characters',
      threadsTitle: 'Threads',
      timelineTitle: 'Timeline',
      charactersEmpty: 'No character findings.',
      threadsEmpty: 'No continuity threads.',
      timelineEmpty: 'No timeline contradictions.',
      empty: 'No Story Bible data yet.',
      loadError: 'Failed to load the Story Bible. Try again.',
      loading: 'Loading the Story Bible...',
      chapters: 'Chapters',
      evidence: 'Evidence',
      suggestedAction: 'Suggested action',
      more: 'More',
      less: 'Less',
    };
    const map = this.langKey === 'he' ? he : en;
    return map[key] ?? key;
  }
}
