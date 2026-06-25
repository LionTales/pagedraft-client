import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BookService } from '../../core/services/book.service';
import {
  BookProfileDto,
  CharacterAnalysisResult,
  StoryAnalysisResult,
  CharacterEntry,
  CharacterRelationship,
  PlotStructure,
  ConflictEntry
} from '../../core/models/book';
import { AnalysisResultDto } from '../../core/models/analysis';
import { ChapterAnchor } from '../../core/models/book-review';
import { BookSummaryStatusRowComponent } from './book-summary-status-row.component';
import { BookReviewState, BookReviewStatusRowComponent } from './book-review-status-row.component';
import { BookReviewFindingsComponent } from './book-review-findings.component';
import { BookStoryBibleComponent } from './book-story-bible.component';
import { BookChapterSummariesComponent } from './book-chapter-summaries.component';

/** Which review tab is active when the review is READY/STALE: the c02 ledger or the c03 Story Bible. */
type ReviewTab = 'findings' | 'bible';

@Component({
  selector: 'app-book-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BookSummaryStatusRowComponent,
    BookReviewStatusRowComponent,
    BookReviewFindingsComponent,
    BookStoryBibleComponent,
    BookChapterSummariesComponent,
  ],
  template: `
    <div class="book-dashboard" dir="rtl">
      <header class="dashboard-header">
        <h3 class="dashboard-title">לוח ספר: {{ bookTitle }}</h3>
        <button
          type="button"
          class="refresh-btn"
          [disabled]="refreshing"
          (click)="onRefresh()"
          title="רענן פרופיל">
          {{ refreshing ? '…' : '⟳' }}
        </button>
      </header>

      <!-- Book-scoped status rows (wb3-c01): summary/briefs + developmental review build + status.
           A finished summary build clears the review's "build briefs first" gate, so its terminal
           event refreshes the review row. -->
      <section class="card book-status-card">
        <app-book-summary-status-row
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (summaryTerminal)="onSummaryTerminal()">
        </app-book-summary-status-row>
        <app-book-review-status-row
          #reviewRow
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (reviewStateChange)="onReviewStateChange($event)">
        </app-book-review-status-row>

        <!-- Review surfaces (wb3-c02 Findings ledger + wb3-c03 Story Bible). Mounted only when the review is
             READY/STALE so the not-built / briefs-missing / building states stay owned by the status row
             above. A lightweight tab toggles between the two views of the same review findings. -->
        @if (showFindings) {
          <div class="review-tabs" role="tablist" [attr.dir]="reviewDir">
            <button
              type="button"
              class="review-tab"
              role="tab"
              [class.active]="reviewTab === 'findings'"
              [attr.aria-selected]="reviewTab === 'findings'"
              data-testid="review-tab-findings"
              (click)="reviewTab = 'findings'">
              {{ reviewTabLabel('findings') }}
            </button>
            <button
              type="button"
              class="review-tab"
              role="tab"
              [class.active]="reviewTab === 'bible'"
              [attr.aria-selected]="reviewTab === 'bible'"
              data-testid="review-tab-bible"
              (click)="reviewTab = 'bible'">
              {{ reviewTabLabel('bible') }}
            </button>
          </div>

          @if (reviewTab === 'findings') {
            <app-book-review-findings
              [bookId]="bookId"
              [bookLanguage]="bookLanguage"
              [refreshToken]="findingsRefreshToken"
              (openChapter)="onOpenChapterFromFinding($event)">
            </app-book-review-findings>
          } @else {
            <app-book-story-bible
              [bookId]="bookId"
              [bookLanguage]="bookLanguage"
              [refreshToken]="findingsRefreshToken"
              (openChapter)="onOpenChapterFromFinding($event)">
            </app-book-story-bible>
          }
        }
      </section>

      <!-- Chapter summaries (wb3-c04): per-chapter user-authoritative summary view + inline edit + the
           explicit "re-derive analysis" offer, so the user's edited summary drives what the whole-book
           review sees. Coexists with the c02 Findings / c03 Story Bible review surfaces above. -->
      <section class="card chapter-summaries-card">
        <app-book-chapter-summaries
          [bookId]="bookId"
          [bookLanguage]="bookLanguage">
        </app-book-chapter-summaries>
      </section>

      @if (loading && !profile) {
        <p class="empty-hint">טוען…</p>
      } @else if (error) {
        <p class="error-hint">{{ error }}</p>
      } @else if (!profile) {
        <p class="empty-hint">לחץ על ⟳ כדי לנתח את הספר (סיכום פרקים ובניית פרופיל).</p>
      } @else {
        <section class="card overview-card">
          <h4>סקירה</h4>
          <div class="overview-grid">
            <div class="overview-item"><span class="label">ז'אנר</span><span class="value">{{ profile.genre ?? '-' }}</span></div>
            <div class="overview-item"><span class="label">תת-ז'אנר</span><span class="value">{{ profile.subGenre ?? '-' }}</span></div>
            <div class="overview-item"><span class="label">קהל יעד</span><span class="value">{{ profile.targetAudience ?? '-' }}</span></div>
            <div class="overview-item"><span class="label">רמת ספרות</span>
              <span class="value level-bar">
                <span class="level-fill" [style.width.%]="(profile.literatureLevel ?? 0) * 10"></span>
                {{ profile.literatureLevel ?? 0 }}/10
              </span>
            </div>
            <div class="overview-item"><span class="label">רישום שפה</span><span class="value">{{ profile.languageRegister ?? '-' }}</span></div>
          </div>
        </section>

        <section class="card synopsis-card">
          <h4>תקציר</h4>
          @if (profile.synopsis) {
            <div class="synopsis-text">
              @if (synopsisExpanded) {
                <span class="synopsis-full">{{ profile.synopsis }}</span>
                <button type="button" class="link-btn" (click)="synopsisExpanded = false">▲ פחות</button>
              } @else {
                <span class="synopsis-preview">{{ synopsisPreview }}</span>
                @if (profile.synopsis.length > 200) {
                  <button type="button" class="link-btn" (click)="synopsisExpanded = true">▼ עוד</button>
                }
              }
            </div>
          } @else {
            <p class="muted">אין תקציר.</p>
          }
        </section>

        <section class="card characters-card">
          <h4>דמויות</h4>
          @if (charactersParsed) {
            <div class="characters-scroll">
              @for (c of charactersParsed.characters; track c.name) {
                <div class="character-card">
                  <div class="char-avatar">{{ initials(c.name) }}</div>
                  <div class="char-name">{{ c.name }}</div>
                  <span class="char-role">{{ c.role || '-' }}</span>
                </div>
              }
            </div>
            @if (charactersParsed.relationships && charactersParsed.relationships.length) {
              <div class="relationships">
                <span class="label">יחסים:</span>
                @for (r of charactersParsed.relationships; track r.character1 + r.character2 + r.relationship) {
                  <div class="rel-line">{{ r.character1 }} ←{{ r.relationship }}→ {{ r.character2 }}</div>
                }
              </div>
            }
          } @else if (profile.charactersJson) {
            <p class="muted">לא ניתן לפרש נתוני דמויות.</p>
          } @else {
            <p class="muted">אין נתוני דמויות.</p>
          }
        </section>

        <section class="card story-card">
          <h4>מבנה עלילה</h4>
          @if (storyParsed) {
            <div class="plot-timeline">
              @if (storyParsed.plotStructure) {
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'setup'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('setup')">הכנה</button>
                  @if (expandedPlotNode === 'setup' && storyParsed.plotStructure.setup) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.setup }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'risingAction'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('risingAction')">עליה</button>
                  @if (expandedPlotNode === 'risingAction' && storyParsed.plotStructure.risingAction) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.risingAction }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'climax'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('climax')">שיא</button>
                  @if (expandedPlotNode === 'climax' && storyParsed.plotStructure.climax) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.climax }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'fallingAction'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('fallingAction')">נפילה</button>
                  @if (expandedPlotNode === 'fallingAction' && storyParsed.plotStructure.fallingAction) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.fallingAction }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'resolution'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('resolution')">התרה</button>
                  @if (expandedPlotNode === 'resolution' && storyParsed.plotStructure.resolution) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.resolution }}</p>
                  }
                </div>
              }
            </div>
            @if (storyParsed.pacing) {
              <p class="pacing"><span class="label">קצב:</span> {{ storyParsed.pacing }}</p>
            }
            @if (storyParsed.conflicts && storyParsed.conflicts.length) {
              <div class="conflicts">
                <span class="label">קונפליקטים:</span>
                <ul>
                  @for (c of storyParsed.conflicts; track c.type + (c.description ?? '')) {
                    <li><span class="conflict-type">{{ c.type }}</span>: {{ c.description ?? '' }} ({{ c.status ?? 'ongoing' }})</li>
                  }
                </ul>
              </div>
            }
          } @else if (profile.storyStructureJson) {
            <p class="muted">לא ניתן לפרש מבנה עלילה.</p>
          } @else {
            <p class="muted">אין נתוני מבנה עלילה.</p>
          }
        </section>

        <section class="card ask-card">
          <h4>שאל על הספר</h4>
          <div class="ask-input-row">
            <input
              type="text"
              class="ask-input"
              placeholder="שאל שאלה על הספר..."
              [(ngModel)]="askQuestion"
              (keydown.enter)="onAsk()">
            <button type="button" class="ask-btn" [disabled]="asking || !(askQuestion && askQuestion.trim())" (click)="onAsk()">▶</button>
          </div>
          @if (asking) {
            <p class="muted">מחפש תשובה…</p>
          } @else if (askError) {
            <p class="error-hint">{{ askError }}</p>
          } @else if (lastAnswer) {
            <div class="answer-block">
              <div class="answer-text">{{ lastAnswer.resultText }}</div>
              @if (citationChapterIds.length) {
                <div class="citations">📖 ציטוט מפרקים: {{ citationChapterIds.join(', ') }}</div>
              }
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .book-dashboard {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 0.25rem 0;
      overflow-y: auto;
      max-height: 100%;
    }
    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }
    .dashboard-title { margin: 0; font-size: 1rem; font-weight: 600; }
    .refresh-btn {
      padding: 0.35rem 0.6rem;
      border: 1px solid #ddd;
      background: #fff;
      cursor: pointer;
      border-radius: 4px;
      font-size: 1.1rem;
    }
    .refresh-btn:hover:not(:disabled) { background: #f5f5f5; }
    .refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .card {
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      background: #fafafa;
    }
    .card h4 { margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #555; }
    .book-status-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .review-tabs {
      display: flex;
      gap: 0.35rem;
      border-bottom: 1px solid #e3e8ef;
      margin-top: 0.25rem;
    }
    .review-tab {
      padding: 0.35rem 0.75rem;
      border: 1px solid transparent;
      border-bottom: none;
      background: none;
      cursor: pointer;
      font-size: 0.85rem;
      color: #666;
      border-radius: 6px 6px 0 0;
    }
    .review-tab:hover:not(.active) { background: #f0f4f9; }
    .review-tab.active {
      color: #0078d4;
      font-weight: 600;
      border-color: #e3e8ef;
      background: #fff;
      margin-bottom: -1px;
    }
    .empty-hint, .error-hint, .muted { font-size: 0.875rem; color: #666; margin: 0; }
    .error-hint { color: #c00; }
    .overview-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem 1rem;
      font-size: 0.85rem;
    }
    .overview-item .label { display: block; color: #666; }
    .overview-item .value { font-weight: 500; }
    .level-bar {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .level-fill {
      display: inline-block;
      height: 6px;
      min-width: 20px;
      max-width: 80px;
      background: #0078d4;
      border-radius: 3px;
    }
    .synopsis-text { font-size: 0.9rem; line-height: 1.5; }
    .synopsis-preview, .synopsis-full { white-space: pre-wrap; }
    .link-btn { background: none; border: none; color: #0078d4; cursor: pointer; font-size: 0.85rem; padding: 0.25rem 0; }
    .characters-scroll {
      display: flex;
      gap: 0.75rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }
    .character-card {
      flex: 0 0 auto;
      width: 100px;
      text-align: center;
      padding: 0.5rem;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      background: #fff;
    }
    .char-avatar {
      width: 36px;
      height: 36px;
      margin: 0 auto 0.35rem;
      border-radius: 50%;
      background: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .char-name { font-weight: 600; font-size: 0.85rem; }
    .char-role { font-size: 0.75rem; color: #666; }
    .relationships { margin-top: 0.75rem; font-size: 0.85rem; }
    .relationships .label { display: block; margin-bottom: 0.25rem; color: #666; }
    .rel-line { margin-bottom: 0.2rem; }
    .plot-timeline { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; }
    .plot-node { border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
    .plot-label {
      padding: 0.35rem 0.6rem;
      background: #fff;
      border: none;
      cursor: pointer;
      font-size: 0.85rem;
      width: 100%;
      text-align: right;
    }
    .plot-label:hover { background: #f5f5f5; }
    .plot-detail { margin: 0.5rem; font-size: 0.8rem; color: #444; white-space: pre-wrap; }
    .pacing, .conflicts { font-size: 0.85rem; margin-top: 0.5rem; }
    .conflicts ul { margin: 0.25rem 0 0 0; padding-right: 1.25rem; }
    .conflict-type { font-weight: 500; }
    .ask-input-row { display: flex; gap: 0.35rem; margin-bottom: 0.5rem; }
    .ask-input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; }
    .ask-btn { padding: 0.5rem 0.75rem; background: #0078d4; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    .ask-btn:hover:not(:disabled) { background: #106ebe; }
    .ask-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .answer-block { margin-top: 0.5rem; padding: 0.5rem; background: #fff; border-radius: 4px; border: 1px solid #eee; }
    .answer-text { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5; }
    .citations { font-size: 0.8rem; color: #666; margin-top: 0.35rem; }
  `]
})
export class BookDashboardComponent implements OnInit, OnChanges {
  @Input() bookId!: string;
  @Input() bookTitle: string = '';
  /** Book language (e.g. 'he', 'en'); drives the book-scoped status rows' localization + status key. */
  @Input() bookLanguage: string | null = null;

  /**
   * wb3-f01 navigation output: bubbles a chapter-anchor click up to the host (editor-page) so it can
   * call the existing selectChapter path. The host (editor-page) owns the chapter list and the
   * selectChapter logic; the dashboard only emits the anchor.
   */
  @Output() openChapter = new EventEmitter<ChapterAnchor>();

  /** The hosted review row; refreshed when a summary build finishes (clears its "build briefs first" gate). */
  @ViewChild('reviewRow') reviewRow?: BookReviewStatusRowComponent;

  /** Latest derived review state reported by the hosted review row; gates the scorecard/ledger mount. */
  reviewState: BookReviewState = 'unknown';
  /** Monotonic token passed to the findings panel; bumped when a build terminal warrants a re-read. */
  findingsRefreshToken = 0;
  /** Active review tab when the review is READY/STALE: the c02 Findings ledger (default) or c03 Story Bible. */
  reviewTab: ReviewTab = 'findings';

  profile: BookProfileDto | null = null;
  loading = true;
  refreshing = false;
  error: string | null = null;

  synopsisExpanded = false;
  expandedPlotNode: string | null = null;

  charactersParsed: CharacterAnalysisResult | null = null;
  storyParsed: StoryAnalysisResult | null = null;

  askQuestion = '';
  asking = false;
  askError: string | null = null;
  lastAnswer: AnalysisResultDto | null = null;
  citationChapterIds: string[] = [];

  constructor(private bookService: BookService) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  /**
   * The editor switches books in place: the host updates [bookId] while the @if keeps THIS dashboard
   * instance alive (Angular does not recreate it). The hosted child rows (summary/review/story-bible/
   * chapter-summaries) self-correct via their own OnChanges keyed on bookId, but the dashboard's OWN
   * state (profile card, parsed structured analysis, the Ask answer, and the active review tab) would
   * otherwise carry over from the previous book. On a real bookId change (not the first binding, which
   * ngOnInit already loads), reset that own state and reload the profile so nothing leaks across books.
   * Skipped on firstChange so the initial load runs once via ngOnInit, not twice.
   */
  ngOnChanges(changes: SimpleChanges): void {
    const bookIdChange = changes['bookId'];
    if (bookIdChange && !bookIdChange.firstChange) {
      this.resetOwnState();
      this.loadProfile();
    }
  }

  /**
   * Clear the dashboard-owned transient state that is NOT re-derived from an @Input on its own, so a
   * book switch does not show the previous book's profile/answer/tab. loadProfile() resets profile +
   * parsed structured fields, so this covers the rest: the Ask question/answer, expansion toggles, and
   * the active review tab (back to the default Findings view). reviewState/findingsRefreshToken are
   * owned by the hosted review row's re-emit on its own OnChanges, so they self-correct.
   */
  private resetOwnState(): void {
    this.reviewTab = 'findings';
    this.askQuestion = '';
    this.asking = false;
    this.askError = null;
    this.lastAnswer = null;
    this.citationChapterIds = [];
    this.synopsisExpanded = false;
    this.expandedPlotNode = null;
  }

  /**
   * A hosted book-summary build reached a terminal/error state (or a no-op confirmed a fresh summary):
   * re-read the review status so the review row clears its "build briefs first" gate and any existing
   * review reflects the new briefs (e.g. goes STALE). Preserves the Phase-2 "summary-terminal also
   * refreshes review status" behavior across the wb3-c01 component split.
   */
  onSummaryTerminal(): void {
    this.reviewRow?.loadBookReviewStatus();
  }

  /**
   * True when the scorecard/ledger should mount: only when the review row reports READY or STALE. STALE
   * still has persisted findings (an older view of the book), so the ledger is meaningful; not-built /
   * needs-summary / building / unknown render nothing here (the status row owns those states).
   */
  get showFindings(): boolean {
    return this.reviewState === 'ready' || this.reviewState === 'stale';
  }

  /**
   * The hosted review row reported a new derived state. When it transitions INTO ready/stale (e.g. a build
   * just finished), bump the findings refresh token so the ledger re-reads the freshly built findings.
   */
  onReviewStateChange(state: BookReviewState): void {
    const wasShowing = this.showFindings;
    this.reviewState = state;
    if (this.showFindings && !wasShowing) {
      // Transitioned into a findings-bearing state: force a re-read (covers the build-just-finished case;
      // a fresh mount loads on its own ngOnChanges, but a token bump is harmless and covers re-entry).
      this.findingsRefreshToken++;
    }
  }

  /**
   * wb3-f01 navigation seam: a finding's chapter-anchor chip was clicked. Bubble the anchor up to the
   * host (editor-page) via @Output() openChapter so the host can call its existing selectChapter path.
   * The dashboard does NOT know about the chapter list or the editor — the host owns both.
   */
  onOpenChapterFromFinding(anchor: ChapterAnchor): void {
    this.openChapter.emit(anchor);
  }

  /**
   * Direction for the review-tab bar and review surfaces: follows bookLanguage so an English book renders
   * ltr tabs while the Hebrew-only dashboard chrome stays rtl. Drives [attr.dir] on review-tabs.
   */
  get reviewDir(): 'rtl' | 'ltr' {
    return (this.bookLanguage ?? '').toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  /**
   * Localized label for a review tab. Follows bookLanguage (not the RTL dashboard chrome) so he/en parity
   * is preserved. DRAFT Hebrew - flag for native-speaker review before sign-off.
   */
  reviewTabLabel(tab: ReviewTab): string {
    const isEn = (this.bookLanguage ?? '').toLowerCase().startsWith('en');
    const he: Record<ReviewTab, string> = { findings: 'ממצאים', bible: 'ספר הסיפור' };
    const en: Record<ReviewTab, string> = { findings: 'Findings', bible: 'Story Bible' };
    return (isEn ? en : he)[tab];
  }

  get synopsisPreview(): string {
    if (!this.profile?.synopsis) return '';
    return this.profile.synopsis.length <= 200
      ? this.profile.synopsis
      : this.profile.synopsis.slice(0, 200) + '…';
  }

  private loadProfile(): void {
    if (!this.bookId) return;
    this.loading = true;
    this.error = null;
    this.bookService.getProfile(this.bookId).subscribe({
      next: (p) => {
        this.profile = p;
        this.parseStructured();
        this.loading = false;
      },
      error: (err) => {
        if (err.status === 404) {
          this.profile = null;
          this.error = null;
        } else {
          this.error = err.message || 'שגיאה בטעינת הפרופיל';
        }
        this.loading = false;
      }
    });
  }

  private parseStructured(): void {
    this.charactersParsed = null;
    this.storyParsed = null;
    if (!this.profile) return;
    try {
      if (this.profile.charactersJson) {
        this.charactersParsed = JSON.parse(this.profile.charactersJson) as CharacterAnalysisResult;
      }
    } catch {
      this.charactersParsed = null;
    }
    try {
      if (this.profile.storyStructureJson) {
        this.storyParsed = JSON.parse(this.profile.storyStructureJson) as StoryAnalysisResult;
      }
    } catch {
      this.storyParsed = null;
    }
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (name[0] ?? '?').toUpperCase();
  }

  togglePlotNode(node: string): void {
    this.expandedPlotNode = this.expandedPlotNode === node ? null : node;
  }

  onRefresh(): void {
    if (!this.bookId || this.refreshing) return;
    this.refreshing = true;
    this.error = null;
    this.bookService.refreshProfile(this.bookId).subscribe({
      next: (p) => {
        this.profile = p;
        this.parseStructured();
        this.refreshing = false;
      },
      error: (err) => {
        this.error = err.message || 'שגיאה ברענון הפרופיל';
        this.refreshing = false;
      }
    });
  }

  onAsk(): void {
    const q = this.askQuestion.trim();
    if (!this.bookId || !q || this.asking) return;
    this.asking = true;
    this.askError = null;
    this.bookService.ask(this.bookId, q).subscribe({
      next: (result) => {
        this.lastAnswer = result;
        this.citationChapterIds = this.tryParseCitations(result.structuredResult);
        this.asking = false;
      },
      error: (err) => {
        this.askError = err.error?.message || err.message || 'שגיאה בשאלה';
        this.asking = false;
      }
    });
  }

  private tryParseCitations(structuredResult: string | null | undefined): string[] {
    if (!structuredResult) return [];
    try {
      const obj = JSON.parse(structuredResult);
      const citations = obj?.citations as Array<{ chapterNumber?: number; chapterTitle?: string }> | undefined;
      if (Array.isArray(citations)) {
        return citations.map(c => c.chapterTitle ?? `פרק ${c.chapterNumber ?? '?'}`).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }
}
