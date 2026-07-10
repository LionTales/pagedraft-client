import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
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
import { FunnelStepperComponent } from './funnel-stepper.component';

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
    FunnelStepperComponent,
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

      <!-- rf-f02: funnel stepper — the visible "editing journey" spine pinned above the status rows.
           Fully presentational: all inputs derived from existing dashboard state so no new polls.
           NON-BLOCKING: advisory only; never gates the rest of the UI.
           The [dir] on the stepper itself follows bookLanguage (book-scoped chrome). -->
      <app-funnel-stepper
        [bookLanguage]="bookLanguage"
        [summaryRunning]="stepperSummaryRunning"
        [reviewRunning]="stepperReviewRunning"
        [summaryReady]="stepperSummaryReady"
        [reviewReady]="stepperReviewReady"
        [hasBriefs]="stepperHasBriefs"
        (assessRequested)="onStepperAssessRequested()"
        (reviseRequested)="onStepperReviseRequested()">
      </app-funnel-stepper>

      <!-- Book-scoped status rows (wb3-c01): summary/briefs + developmental review build + status.
           A finished summary build clears the review's "build briefs first" gate, so its terminal
           event refreshes the review row. -->
      <!-- rf-f02: anchor for the stepper CTA scroll-to. -->
      <div #statusRowsAnchor></div>
      <section class="card book-status-card">
        <app-book-summary-status-row
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (summaryTerminal)="onSummaryTerminal()"
          (buildingChange)="onSummaryBuildingChange($event)">
        </app-book-summary-status-row>
        <app-book-review-status-row
          #reviewRow
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (reviewStateChange)="onReviewStateChange($event)">
        </app-book-review-status-row>

        <!-- rf-f04: anchor for the Revise CTA scroll-to (always present, outside the showFindings guard). -->
        <div #findingsAnchor></div>
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
              [refreshSignal]="summaryDerivedRefresh"
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
          [bookLanguage]="bookLanguage"
          [refreshSignal]="summaryDerivedRefresh">
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
                  <!-- track by $index intentionally: a content track using ?? (e.g. c.type + (c.description ?? ''))
                       hits an Angular control-flow compiler bug that emits an undeclared temp (tmp_N_0) in the
                       generated @for track fn, throwing "tmp_N_0 is not defined" on every CD tick and aborting the
                       whole dashboard's change detection. Do NOT reintroduce ?? into this (or any) track expression. -->
                  @for (c of storyParsed.conflicts; track $index) {
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
      gap: var(--pd-space-5);
      padding: var(--pd-space-2) 0;
      overflow-y: auto;
      max-height: 100%;
      font-family: var(--pd-font-ui);
    }
    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--pd-space-3);
    }
    .dashboard-title {
      margin: 0;
      font-size: var(--pd-text-h5);
      line-height: var(--pd-lh-h5);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text);
    }
    .refresh-btn {
      padding: var(--pd-space-2) var(--pd-space-4);
      border: 1px solid var(--pd-border);
      background: var(--pd-surface);
      cursor: pointer;
      border-radius: var(--pd-radius-sm);
      font-size: var(--pd-text-body);
      color: var(--pd-text-secondary);
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }
    .refresh-btn:hover:not(:disabled) { background: var(--pd-surface-sunken); }
    .refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .card {
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-lg);
      padding: var(--pd-space-5);
      box-shadow: var(--pd-shadow-1);
    }
    .card h4 {
      margin: 0 0 var(--pd-space-4) 0;
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .book-status-card {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-4);
    }
    .review-tabs {
      display: flex;
      gap: var(--pd-space-2);
      border-bottom: 1px solid var(--pd-divider);
      margin-top: var(--pd-space-3);
    }
    .review-tab {
      padding: var(--pd-space-3) var(--pd-space-5);
      border: 1px solid transparent;
      border-bottom: none;
      background: none;
      cursor: pointer;
      font-size: var(--pd-text-body-sm);
      font-family: var(--pd-font-ui);
      color: var(--pd-text-secondary);
      border-radius: var(--pd-radius-sm) var(--pd-radius-sm) 0 0;
      transition: background var(--pd-dur-fast) var(--pd-ease), color var(--pd-dur-fast) var(--pd-ease);
    }
    .review-tab:hover:not(.active) { background: var(--pd-surface-sunken); }
    .review-tab.active {
      color: var(--pd-primary-700);
      font-weight: var(--pd-weight-bold);
      border-color: var(--pd-divider);
      background: var(--pd-surface);
      margin-bottom: -1px;
    }
    .empty-hint, .muted { font-size: var(--pd-text-body-sm); color: var(--pd-text-muted); margin: 0; }
    .error-hint { font-size: var(--pd-text-body-sm); color: var(--pd-cut); margin: 0; }
    .overview-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--pd-space-4) var(--pd-space-7);
      font-size: var(--pd-text-body-sm);
    }
    .overview-item .label {
      display: block;
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
      margin-bottom: var(--pd-space-1);
    }
    .overview-item .value { font-weight: var(--pd-weight-medium); color: var(--pd-text); }
    .level-bar {
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-3);
    }
    .level-fill {
      display: inline-block;
      height: 6px;
      min-width: 20px;
      max-width: 80px;
      background: var(--pd-primary-600);
      border-radius: var(--pd-radius-pill);
    }
    .synopsis-text {
      font-family: var(--pd-font-reading);
      font-size: var(--pd-text-body);
      line-height: var(--pd-lh-body);
      color: var(--pd-text);
    }
    .synopsis-preview, .synopsis-full { white-space: pre-wrap; }
    .link-btn {
      background: none;
      border: none;
      color: var(--pd-text-link);
      cursor: pointer;
      font-size: var(--pd-text-body-sm);
      font-family: var(--pd-font-ui);
      padding: var(--pd-space-2) 0;
    }
    .link-btn:hover { text-decoration: underline; }
    .characters-scroll {
      display: flex;
      gap: var(--pd-space-4);
      overflow-x: auto;
      padding-bottom: var(--pd-space-3);
    }
    .character-card {
      flex: 0 0 auto;
      width: 100px;
      text-align: center;
      padding: var(--pd-space-4);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      background: var(--pd-surface);
    }
    .char-avatar {
      width: 36px;
      height: 36px;
      margin: 0 auto var(--pd-space-3);
      border-radius: 50%;
      background: var(--pd-neutral-100);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-secondary);
    }
    .char-name { font-weight: var(--pd-weight-bold); font-size: var(--pd-text-body-sm); color: var(--pd-text); }
    .char-role { font-size: var(--pd-text-caption); color: var(--pd-text-muted); }
    .relationships { margin-top: var(--pd-space-5); font-size: var(--pd-text-body-sm); }
    .relationships .label {
      display: block;
      margin-bottom: var(--pd-space-2);
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
    }
    .rel-line { margin-bottom: var(--pd-space-2); color: var(--pd-text); }
    .plot-timeline { display: flex; flex-wrap: wrap; gap: var(--pd-space-3); margin-bottom: var(--pd-space-4); }
    .plot-node {
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      overflow: hidden;
    }
    .plot-label {
      padding: var(--pd-space-3) var(--pd-space-4);
      background: var(--pd-surface);
      border: none;
      cursor: pointer;
      font-size: var(--pd-text-body-sm);
      font-family: var(--pd-font-ui);
      color: var(--pd-text);
      width: 100%;
      text-align: inherit;
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }
    .plot-label:hover { background: var(--pd-surface-sunken); }
    .plot-detail {
      margin: var(--pd-space-4);
      font-size: var(--pd-text-caption);
      color: var(--pd-text-secondary);
      white-space: pre-wrap;
      font-family: var(--pd-font-reading);
      line-height: var(--pd-lh-body);
    }
    .pacing, .conflicts { font-size: var(--pd-text-body-sm); margin-top: var(--pd-space-4); }
    .conflicts ul { margin: var(--pd-space-2) 0 0 0; padding-inline-end: var(--pd-space-6); }
    .conflict-type { font-weight: var(--pd-weight-medium); }
    .ask-input-row { display: flex; gap: var(--pd-space-3); margin-bottom: var(--pd-space-4); }
    .ask-input {
      flex: 1;
      padding: var(--pd-space-3) var(--pd-space-4);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-sm);
      font-size: var(--pd-text-body-sm);
      font-family: var(--pd-font-ui);
      color: var(--pd-text);
      background: var(--pd-surface);
    }
    .ask-input:focus {
      outline: none;
      box-shadow: var(--pd-ring);
      border-color: var(--pd-primary-600);
    }
    .ask-btn {
      padding: var(--pd-space-3) var(--pd-space-5);
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
      border: none;
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }
    .ask-btn:hover:not(:disabled) { background: var(--pd-primary-hover); }
    .ask-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .answer-block {
      margin-top: var(--pd-space-4);
      padding: var(--pd-space-4) var(--pd-space-5);
      background: var(--pd-surface-sunken);
      border-radius: var(--pd-radius-md);
      border: 1px solid var(--pd-border);
    }
    .answer-text {
      white-space: pre-wrap;
      font-family: var(--pd-font-reading);
      font-size: var(--pd-text-body);
      line-height: var(--pd-lh-body);
      color: var(--pd-text);
    }
    .citations { font-size: var(--pd-text-caption); color: var(--pd-text-muted); margin-top: var(--pd-space-3); }
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

  /**
   * rf-f02: emitted when the funnel stepper's Assess (or Revise) CTA is clicked. The host
   * (editor-page) handles it by switching to Review mode (onReviewModeChange('review')) and
   * scrolling to the status rows anchor. The dashboard itself does not own the mode-switch —
   * that lives in the editor's SegmentedControl — so it delegates upward via this output,
   * reusing the EXISTING onReviewModeChange path with no new coupling.
   */
  @Output() switchToReview = new EventEmitter<void>();

  /**
   * rf-c02: the "review running" affordance is NO LONGER emitted from here. It is now derived by the editor
   * directly from the single job registry ({@link JobRegistryService.anyRunningForBook$}), which the status
   * rows publish to via track() on build start and which survives this dashboard being @if-destroyed (close
   * panel / focus mode). The dashboard keeps tracking reviewState + summaryBuilding below for its OWN concerns
   * (findings/bible gating + the summary-build-complete fan-out) — it just no longer owns the host affordance.
   */

  /** The hosted review row; refreshed when a summary build finishes (clears its "build briefs first" gate). */
  @ViewChild('reviewRow') reviewRow?: BookReviewStatusRowComponent;

  /** rf-f02: anchor element at the top of the status-rows section; scrolled to when a stepper CTA is clicked. */
  @ViewChild('statusRowsAnchor') statusRowsAnchor?: ElementRef<HTMLElement>;

  /** rf-f04: anchor element just above the findings/bible tabs; scrolled to when the Revise CTA is clicked. */
  @ViewChild('findingsAnchor') findingsAnchor?: ElementRef<HTMLElement>;

  /** Latest derived review state reported by the hosted review row; gates the scorecard/ledger mount. */
  reviewState: BookReviewState = 'unknown';
  /** Latest "summary build in flight" flag from the hosted summary row (its buildingChange output). */
  private summaryBuilding = false;
  /**
   * Bumped on each summary-build COMPLETION (buildingChange true->false) and fanned out to EVERY
   * summary-derived surface so each re-fetches the newly built briefs in place: the chapter-summaries list
   * ([refreshSignal]) AND the Story Bible ([refreshSignal]). The dashboard-owned profile card is re-fetched
   * directly (loadProfile()) on the same completion, since it has no child @Input to bind. The status row owns
   * the build; these surfaces have no other completion signal, so without the fan-out they show a stale "no
   * summary yet" (or a stale profile / Story Bible) for briefs that finish after they mounted while the panel
   * stays mounted (rf-f04 / build-complete fan-out).
   */
  summaryDerivedRefresh = 0;
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
   * the active review tab (back to the default Findings view). findingsRefreshToken is owned by the
   * hosted review row's re-emit on its own OnChanges, so it self-corrects.
   *
   * The cached whole-book-build inputs (reviewState + summaryBuilding) are reset HERE rather than left to
   * self-correct: the child rows reset synchronously, but the review row only RE-EMITS its real state after
   * its status HTTP returns. Until then a stale reviewState==='building' from the previous book would keep
   * the dashboard's OWN showFindings gate on the previous book's state. Reset both to a not-running baseline;
   * the rows re-emit the new book's true state when their requests return. (rf-c02: the host "review running"
   * affordance no longer flows through here - it is registry-derived and re-scoped per book by the editor.)
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
    this.reviewState = 'unknown';
    this.summaryBuilding = false;
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
   * The hosted summary row reported whether its briefs build is in flight (its buildingChange output).
   * Record it (drives the dashboard's own summary-build-complete fan-out below).
   */
  onSummaryBuildingChange(building: boolean): void {
    const wasBuilding = this.summaryBuilding;
    this.summaryBuilding = building;
    // Build just COMPLETED (true -> false): fan out to EVERY summary-derived surface so none shows stale
    // "no summary yet" for briefs that finished after it mounted (rf-f04). The bump drives the child surfaces
    // that expose a refreshSignal @Input (chapter-summaries + Story Bible) to re-fetch in place; the
    // dashboard-owned profile card has no such @Input, so reload it directly. loadProfile() keeps the current
    // profile visible until the new one resolves (it only reassigns this.profile in its next handler), so the
    // reload is in place with no flash - matching the child surfaces' silent-refresh behavior.
    if (wasBuilding && !building) {
      this.summaryDerivedRefresh++;
      this.loadProfile();
    }
  }

  /**
   * True when ANY whole-book build is in flight: the briefs/summary build (from the summary row's
   * buildingChange output) OR the developmental review build (reviewState === 'building').
   *
   * rf-c02: this is now a dashboard-INTERNAL derived flag only. The host "review running" affordance is
   * derived by the editor from the job registry ({@link JobRegistryService.anyRunningForBook$}), NOT from
   * this getter - the status rows publish their build to the registry via track() on start. Kept as a
   * truthful accessor of the dashboard's own aggregate state and as the assertion target for the
   * rf-c02 spec suite (book-dashboard.component.spec.ts describe 'rf-c02').
   */
  get buildRunning(): boolean {
    return this.summaryBuilding || this.reviewState === 'building';
  }

  // ── rf-f02: funnel stepper inputs (derived from existing dashboard state) ─────

  /**
   * True when the book has usable chapter briefs (hasBriefs). Derived from reviewState:
   * 'needs-summary' and 'unknown' mean no briefs; all other states mean briefs exist.
   * The stepper uses this to show the right CTA label on the Assess step.
   */
  get stepperHasBriefs(): boolean {
    return this.reviewState !== 'needs-summary' && this.reviewState !== 'unknown';
  }

  /**
   * True when the book summary (briefs) is complete enough for the review to be built.
   * Derived from reviewState: 'needs-summary' means no summary; 'unknown' = loading.
   * For the stepper, summaryReady = briefs are present (reviewState not needs-summary or unknown).
   */
  get stepperSummaryReady(): boolean {
    return this.stepperHasBriefs;
  }

  /**
   * True when the whole-book review is ready (reviewState === 'ready').
   * Drives Assess step: done => Revise becomes the lit next-step.
   */
  get stepperReviewReady(): boolean {
    return this.reviewState === 'ready';
  }

  /**
   * True while a summary job is running (from the summary row's buildingChange output).
   * The registry also tracks it but the dashboard already has the flag directly.
   */
  get stepperSummaryRunning(): boolean {
    return this.summaryBuilding;
  }

  /**
   * True while a review job is running (reviewState === 'building').
   */
  get stepperReviewRunning(): boolean {
    return this.reviewState === 'building';
  }

  /**
   * rf-f02: the funnel stepper's Assess (or Revise) CTA was clicked. Bubble up to the host
   * (editor-page) via @Output() switchToReview so the editor can call onReviewModeChange('review')
   * and scroll to the status rows. The dashboard is already in review mode when this component is
   * mounted, so the primary effect is the scroll; the editor's mode-switch is a no-op if already
   * in review mode but is safe to re-emit.
   */
  onStepperAssessRequested(): void {
    this.switchToReview.emit();
    this.scrollToStatusRows();
  }

  /**
   * rf-f04: Revise CTA clicked — select the Findings sub-tab and scroll to the findings ledger anchor.
   * This honors the CTA label ("Go to findings" / "עבור לממצאים") rather than just scrolling to the
   * status-rows header like the Assess CTA does.
   */
  onStepperReviseRequested(): void {
    this.switchToReview.emit();
    this.reviewTab = 'findings';
    this.scrollToFindings();
  }

  /**
   * Scroll the status-rows anchor into view so the user sees the summary/review rows after
   * clicking the stepper CTA. Uses the #statusRowsAnchor template ref.
   */
  private scrollToStatusRows(): void {
    this.statusRowsAnchor?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * rf-f04: Scroll the findings anchor into view so the user lands at the findings/bible tabs section
   * after clicking the Revise CTA. Uses the #findingsAnchor template ref.
   */
  private scrollToFindings(): void {
    this.findingsAnchor?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
