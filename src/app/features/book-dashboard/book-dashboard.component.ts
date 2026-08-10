import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BookService } from '../../core/services/book.service';
import {
  BookProfileDto,
  ChapterSummaryDto,
  CharacterAnalysisResult,
  StoryAnalysisResult,
  CharacterEntry,
  CharacterRelationship,
  PlotStructure,
  ConflictEntry
} from '../../core/models/book';
import { AnalysisResultDto } from '../../core/models/analysis';
import { BookReviewStatusDto, ChapterAnchor } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { JobRegistryService } from '../../core/services/job-registry.service';
import { BookSummaryStatusRowComponent } from './book-summary-status-row.component';
import { BookStyleBaselineStatusRowComponent } from './book-style-baseline-status-row.component';
import { BookReviewState, BookReviewStatusRowComponent } from './book-review-status-row.component';
import { BookReviewFindingsComponent } from './book-review-findings.component';
import { BookStoryBibleComponent } from './book-story-bible.component';
import { BookChapterSummariesComponent } from './book-chapter-summaries.component';
import { CharacterRegisterComponent } from './character-register.component';
import { StageActionEvent, StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import { ChapterPassSignal, EXPORT_SURFACE_AVAILABLE, StageSpineSignals, emptyStageSpineSignals } from '../../shared/stage-spine/stage-spine.model';
import { TierToggleComponent } from '../../shared/tier-toggle/tier-toggle.component';
import { CollapsibleSectionComponent } from '../../shared/collapsible-section/collapsible-section.component';

/** Which review tab is active when the review is READY/STALE: the c02 ledger or the c03 Story Bible. */
type ReviewTab = 'findings' | 'bible';

/**
 * Dashboard chrome strings, keyed for label(). This card region was originally Hebrew-only (the container
 * was hardcoded dir="rtl" and every string was a literal), which broke the book-scoped chrome rule: chrome
 * inside a book follows the BOOK language, so an English book must render English chrome. The child
 * components on this page (the stage spine, status rows, chapter summaries, Story Bible) always honored that
 * via [bookLanguage]; only this component's own profile card did not, so an English book rendered a
 * half-Hebrew page. Hoisted to module scope rather than rebuilt per call because the template resolves
 * roughly 30 labels on every change-detection tick.
 *
 * DRAFT Hebrew is inherited verbatim from the previous literals, so this carries no new translation risk.
 *
 * The type and both maps are exported so the spec can derive its key list from the real Hebrew map instead
 * of restating it, and can assert at runtime that the two maps hold the same key set.
 */
export type DashboardLabelKey =
  | 'title' | 'loading' | 'emptyHint'
  | 'overview' | 'genre' | 'subGenre' | 'targetAudience' | 'literatureLevel' | 'languageRegister'
  | 'synopsis' | 'less' | 'more' | 'noSynopsis'
  | 'characters' | 'relationships' | 'charactersUnparseable' | 'noCharacters'
  | 'plotStructure' | 'setup' | 'risingAction' | 'climax' | 'fallingAction' | 'resolution'
  | 'pacing' | 'conflicts' | 'storyUnparseable' | 'noStory'
  | 'ask' | 'askPlaceholder' | 'asking' | 'citations'
  | 'profileLoadError' | 'askFailed' | 'chapter'
  | 'export'
  // Wave 3 / w5: the stage-2 row group (Q8-C) and the collapse directive's section headings.
  | 'inputsToThisBuild' | 'inputsExplainer' | 'reviewSection' | 'characterRegister' | 'settings';

export const DASHBOARD_LABELS_HE: Record<DashboardLabelKey, string> = {
  title: 'לוח ספר',
  loading: 'טוען…',
  // Q4-A: the bare arrow is gone, so this hint points at the one build row that now produces the profile.
  emptyHint: 'פרופיל הספר ייבנה יחד עם תקצירי הספר. השתמשו בכפתור הבנייה בשורת "תקצירי ספר" שלמעלה.',
  overview: 'סקירה',
  genre: 'ז\'אנר',
  subGenre: 'תת-ז\'אנר',
  targetAudience: 'קהל יעד',
  literatureLevel: 'רמת ספרות',
  languageRegister: 'רישום שפה',
  synopsis: 'תקציר',
  less: 'פחות',
  more: 'עוד',
  noSynopsis: 'אין תקציר.',
  characters: 'דמויות',
  relationships: 'יחסים:',
  charactersUnparseable: 'לא ניתן לפרש נתוני דמויות.',
  noCharacters: 'אין נתוני דמויות.',
  plotStructure: 'מבנה עלילה',
  setup: 'הכנה',
  risingAction: 'עליה',
  climax: 'שיא',
  fallingAction: 'נפילה',
  resolution: 'התרה',
  pacing: 'קצב:',
  conflicts: 'קונפליקטים:',
  storyUnparseable: 'לא ניתן לפרש מבנה עלילה.',
  noStory: 'אין נתוני מבנה עלילה.',
  ask: 'שאל על הספר',
  askPlaceholder: 'שאל שאלה על הספר…',
  asking: 'מחפש תשובה…',
  citations: 'ציטוט מפרקים:',
  profileLoadError: 'שגיאה בטעינת הפרופיל',
  askFailed: 'שגיאה בשאלה',
  chapter: 'פרק',
  export: 'ייצוא',
  // Wave 3 / w5. DRAFT Hebrew - w8 native sweep.
  inputsToThisBuild: 'הקלט לבנייה הזו',
  inputsExplainer: 'תקציר הפרק הוא הקלט שממנו נבנים תקצירי הספר והסקירה ההתפתחותית. עריכה ידנית כאן משנה את מה שהבנייה קוראת.',
  reviewSection: 'ממצאי הסקירה',
  characterRegister: 'מרשם הדמויות',
  settings: 'הגדרות',
};

export const DASHBOARD_LABELS_EN: Record<DashboardLabelKey, string> = {
  title: 'Book dashboard',
  loading: 'Loading…',
  emptyHint: 'The book profile is built together with the book briefs. Use the build action on the "Book briefs" row above.',
  overview: 'Overview',
  genre: 'Genre',
  subGenre: 'Sub-genre',
  targetAudience: 'Target audience',
  literatureLevel: 'Literature level',
  languageRegister: 'Language register',
  synopsis: 'Synopsis',
  less: 'Less',
  more: 'More',
  noSynopsis: 'No synopsis.',
  characters: 'Characters',
  relationships: 'Relationships:',
  charactersUnparseable: 'Character data could not be read.',
  noCharacters: 'No character data.',
  plotStructure: 'Plot structure',
  setup: 'Setup',
  risingAction: 'Rising action',
  climax: 'Climax',
  fallingAction: 'Falling action',
  resolution: 'Resolution',
  pacing: 'Pacing:',
  conflicts: 'Conflicts:',
  storyUnparseable: 'Plot structure could not be read.',
  noStory: 'No plot structure data.',
  ask: 'Ask about the book',
  askPlaceholder: 'Ask a question about the book…',
  asking: 'Looking for an answer…',
  citations: 'Cited from chapters:',
  profileLoadError: 'Could not load the profile',
  askFailed: 'Could not answer the question',
  chapter: 'Chapter',
  export: 'Export',
  inputsToThisBuild: 'The inputs to this build',
  inputsExplainer: 'A chapter brief is the input the book briefs and the developmental review are built from. Editing one by hand changes what the build reads.',
  reviewSection: 'Review findings',
  characterRegister: 'Character register',
  settings: 'Settings',
};

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
    CharacterRegisterComponent,
    StageSpineComponent,
    TierToggleComponent,
    BookStyleBaselineStatusRowComponent,
    CollapsibleSectionComponent,
  ],
  template: `
    <div class="book-dashboard" [attr.dir]="bookDir">
      <header class="dashboard-header">
        <h3 class="dashboard-title">{{ label('title') }}: {{ bookTitle }}</h3>
        <div class="header-actions">
          <!-- Wave 3 / w4: the second way to reach export, beside the spine's own stage-5 action. It
               raises the SAME output, so both land on /books/:bookId/export. Always enabled: the export
               screen states the no-chapters case itself, and a disabled button here would need a reason
               tooltip to be honest, which the 2.6 constraint rules out. -->
          <button
            type="button"
            class="pd-btn pd-btn-ghost export-btn"
            data-testid="dashboard-export-btn"
            (click)="openExport.emit()">
            {{ label('export') }}
          </button>
          <!-- Wave 3 / w5 (Q4-A): the bare circular-arrow refresh USED TO SIT HERE. It triggered an
               expensive whole-book run with no status, no consent, no estimate and no activity entry. It
               is folded into the Book briefs row below, which now runs the profile build as its second
               phase under one consent and one status. Do not reintroduce an icon-only build here. -->
        </div>
      </header>

      <!-- Wave 3 / w2: THE STAGE SPINE, replacing the four-step funnel stepper outright. Five stages,
           one state vocabulary, every state computed from a real payload the rows below already fetch
           (no new polls). It is also the guided surface: each row explains itself, names its
           prerequisite when blocked, and offers the next action.
           NON-BLOCKING: advisory only; it never gates the rest of the UI.
           The [dir] inside the spine follows bookLanguage (book-scoped chrome). -->
      <app-stage-spine
        [bookLanguage]="bookLanguage"
        [signals]="spineSignals"
        (stageAction)="onSpineAction($event)"
        (openChapter)="onSpineOpenChapter($event)">
      </app-stage-spine>

      <!-- Book-scoped status rows (wb3-c01): summary/briefs + developmental review build + status.
           A finished summary build clears the review's "build briefs first" gate, so its terminal
           event refreshes the review row. -->
      <!-- Anchor for the spine's build-briefs action scroll-to. -->
      <div #statusRowsAnchor></div>
      <section class="card book-status-card">
        <!-- STAGE 2's ROW GROUP. Q8-C: the per-chapter brief editing card is not a chapter surface that
             wandered into the book tab set, it is THE INPUT to this build, so it lives inside this build's
             group and says so. That framing is the whole cost the owner accepted with option C: the copy
             has to carry the explanation, which is why the group heading and the explainer below are not
             decoration and must not be trimmed to a title. -->
        <app-book-summary-status-row
          #summaryRow
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (summaryTerminal)="onSummaryTerminal()"
          (statusChange)="onSummaryStatusChange($event)"
          (buildingChange)="onSummaryBuildingChange($event)">
        </app-book-summary-status-row>

        <!-- Q8-C + the collapse directive. A long per-chapter list, so it is one of the two sections that
             DEFAULT to collapsed; the explainer sits OUTSIDE the fold, so the relationship it states
             ("these are the inputs") is legible even when the list itself is folded away. -->
        <div class="inputs-to-build" [attr.dir]="bookDir" data-testid="inputs-to-this-build">
          <p class="inputs-explainer">{{ label('inputsExplainer') }}</p>
          <app-collapsible-section
            sectionId="inputs"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('inputsToThisBuild')"
            [defaultCollapsed]="true">
            <app-book-chapter-summaries
              [bookId]="bookId"
              [bookLanguage]="bookLanguage"
              [refreshSignal]="summaryDerivedRefresh">
            </app-book-chapter-summaries>
          </app-collapsible-section>
        </div>

        <app-book-review-status-row
          #reviewRow
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (reviewStateChange)="onReviewStateChange($event)"
          (statusChange)="onReviewStatusChange($event)"
          (tierChanged)="onTierChanged()">
        </app-book-review-status-row>

        <!-- rf-f04: anchor for the Revise CTA scroll-to (always present, outside the showFindings guard). -->
        <div #findingsAnchor></div>
        <!-- Review surfaces (wb3-c02 Findings ledger + wb3-c03 Story Bible). Mounted only when the review is
             READY/STALE so the not-built / briefs-missing / building states stay owned by the status row
             above. A lightweight tab toggles between the two views of the same review findings. -->
        @if (showFindings) {
          <!-- Collapsible, DEFAULT EXPANDED: this is content the author already sees today and the wave's
               rule for defaults is "the current layout". The status ROW above stays outside the fold, so a
               blocked / stale / building review can never be hidden by a collapse. -->
          <app-collapsible-section
            sectionId="review-findings"
            [bookId]="bookId"
            [dir]="reviewDir"
            [heading]="label('reviewSection')">
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
          </app-collapsible-section>
        }

        <!-- Wave 3 / w5 (MOVE-1 + MOVE-2, Q6-A): the book-wide writing-style build, moved out of the
             per-chapter analysis Run tab to sit BESIDE the other whole-book builds, with the same row
             anatomy they have. It is a status row, so like its two neighbours it is never wrapped in a
             collapsible: a build that needs attention must not be foldable out of sight. -->
        <app-book-style-baseline-status-row
          #baselineRow
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          [focusToken]="focusBaselineToken">
        </app-book-style-baseline-status-row>
      </section>

      @if (loading && !profile) {
        <p class="empty-hint">{{ label('loading') }}</p>
      } @else if (error) {
        <p class="error-hint">{{ error }}</p>
      } @else if (!profile) {
        <p class="empty-hint">{{ label('emptyHint') }}</p>
      } @else {
        <!-- The four profile cards + Ask are the SECOND level the collapse directive asks for: elements
             inside a major part. Each defaults to expanded (the current layout) and each remembers its own
             fold per book. None of them is a build status, a prerequisite warning or a consent prompt, so
             none of them is in the never-collapse class. -->
        <section class="card overview-card">
          <app-collapsible-section
            sectionId="overview"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('overview')">
          <div class="overview-grid">
            <div class="overview-item"><span class="label">{{ label('genre') }}</span><span class="value">{{ profile.genre ?? '-' }}</span></div>
            <div class="overview-item"><span class="label">{{ label('subGenre') }}</span><span class="value">{{ profile.subGenre ?? '-' }}</span></div>
            <div class="overview-item"><span class="label">{{ label('targetAudience') }}</span><span class="value">{{ profile.targetAudience ?? '-' }}</span></div>
            <div class="overview-item"><span class="label">{{ label('literatureLevel') }}</span>
              <span class="value level-bar">
                <span class="level-fill" [style.width.%]="(profile.literatureLevel ?? 0) * 10"></span>
                {{ profile.literatureLevel ?? 0 }}/10
              </span>
            </div>
            <div class="overview-item"><span class="label">{{ label('languageRegister') }}</span><span class="value">{{ profile.languageRegister ?? '-' }}</span></div>
          </div>
          </app-collapsible-section>
        </section>

        <section class="card synopsis-card">
          <app-collapsible-section
            sectionId="synopsis"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('synopsis')">
          @if (profile.synopsis) {
            <div class="synopsis-text">
              @if (synopsisExpanded) {
                <span class="synopsis-full">{{ profile.synopsis }}</span>
                <button type="button" class="link-btn" (click)="synopsisExpanded = false">▲ {{ label('less') }}</button>
              } @else {
                <span class="synopsis-preview">{{ synopsisPreview }}</span>
                @if (profile.synopsis.length > 200) {
                  <button type="button" class="link-btn" (click)="synopsisExpanded = true">▼ {{ label('more') }}</button>
                }
              }
            </div>
          } @else {
            <p class="muted">{{ label('noSynopsis') }}</p>
          }
          </app-collapsible-section>
        </section>

        <section class="card characters-card">
          <app-collapsible-section
            sectionId="characters"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('characters')">
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
                <span class="label">{{ label('relationships') }}</span>
                @for (r of charactersParsed.relationships; track r.character1 + r.character2 + r.relationship) {
                  <div class="rel-line">{{ r.character1 }} ←{{ r.relationship }}→ {{ r.character2 }}</div>
                }
              </div>
            }
          } @else if (profile.charactersJson) {
            <p class="muted">{{ label('charactersUnparseable') }}</p>
          } @else {
            <p class="muted">{{ label('noCharacters') }}</p>
          }
          </app-collapsible-section>
        </section>

        <section class="card story-card">
          <app-collapsible-section
            sectionId="plot"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('plotStructure')">
          @if (storyParsed) {
            <div class="plot-timeline">
              @if (storyParsed.plotStructure) {
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'setup'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('setup')">{{ label('setup') }}</button>
                  @if (expandedPlotNode === 'setup' && storyParsed.plotStructure.setup) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.setup }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'risingAction'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('risingAction')">{{ label('risingAction') }}</button>
                  @if (expandedPlotNode === 'risingAction' && storyParsed.plotStructure.risingAction) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.risingAction }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'climax'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('climax')">{{ label('climax') }}</button>
                  @if (expandedPlotNode === 'climax' && storyParsed.plotStructure.climax) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.climax }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'fallingAction'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('fallingAction')">{{ label('fallingAction') }}</button>
                  @if (expandedPlotNode === 'fallingAction' && storyParsed.plotStructure.fallingAction) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.fallingAction }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'resolution'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('resolution')">{{ label('resolution') }}</button>
                  @if (expandedPlotNode === 'resolution' && storyParsed.plotStructure.resolution) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.resolution }}</p>
                  }
                </div>
              }
            </div>
            @if (storyParsed.pacing) {
              <p class="pacing"><span class="label">{{ label('pacing') }}</span> {{ storyParsed.pacing }}</p>
            }
            @if (storyParsed.conflicts && storyParsed.conflicts.length) {
              <div class="conflicts">
                <span class="label">{{ label('conflicts') }}</span>
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
            <p class="muted">{{ label('storyUnparseable') }}</p>
          } @else {
            <p class="muted">{{ label('noStory') }}</p>
          }
          </app-collapsible-section>
        </section>

        <section class="card ask-card">
          <app-collapsible-section
            sectionId="ask"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('ask')">
          <div class="ask-input-row">
            <input
              type="text"
              class="ask-input"
              [placeholder]="label('askPlaceholder')"
              [(ngModel)]="askQuestion"
              (keydown.enter)="onAsk()">
            <button type="button" class="ask-btn" [disabled]="asking || !(askQuestion && askQuestion.trim())" (click)="onAsk()">▶</button>
          </div>
          @if (asking) {
            <p class="muted">{{ label('asking') }}</p>
          } @else if (askError) {
            <p class="error-hint">{{ askError }}</p>
          } @else if (lastAnswer) {
            <div class="answer-block">
              <div class="answer-text">{{ lastAnswer.resultText }}</div>
              @if (citationChapterIds.length) {
                <div class="citations">📖 {{ label('citations') }} {{ citationChapterIds.join(', ') }}</div>
              }
            </div>
          }
          </app-collapsible-section>
        </section>
      }

      <!-- character-register-editing c2: the author's EDITABLE character register.
           Mounted here, on the book dashboard, rather than in the per-chapter editor because the register
           is BOOK-scoped: one register per book, read by every chapter's analysis, so a per-chapter mount
           would imply a per-chapter thing and force the author to pick an arbitrary chapter to correct a
           book-level fact. This page is already the book-level intelligence + settings area (profile,
           summaries, review, book-default tier), and this section sits directly after the READ-ONLY
           profile "Characters" card, which shows the same domain from the other side (what the profile
           extracted) - adjacency is the point: what you can read is followed by what you can correct.
           Deliberately OUTSIDE the profile guard above: the register exists independently of the book
           profile, so it must still render (including its never-built empty state) for a book that has no
           profile yet. -->
      <!-- The second long content list, so it is the other section that DEFAULTS to collapsed. -->
      <section class="card character-register-card">
        <app-collapsible-section
          sectionId="character-register"
          [bookId]="bookId"
          [dir]="bookDir"
          [heading]="label('characterRegister')"
          [defaultCollapsed]="true">
          <app-character-register
            [bookId]="bookId"
            [bookLanguage]="bookLanguage">
          </app-character-register>
        </app-collapsible-section>
      </section>

      <!-- tier-ux-rework c3: the BOOK DEFAULT tier, demoted from the dashboard hero position to a small
           settings row at the foot of the page. The decision that matters is now per edit type, made on the
           run surface that spends the tokens; this only seeds the types nobody has decided individually, so
           it must not be the first thing the page says. It writes the book default and deliberately does NOT
           clear per-task overrides (the toggle's own "follow the book default" link does that, per task).
           There is no book-settings page in this client yet; when one lands this row moves there unchanged.
           book-tier-default-card carries no CSS of its own (.card alone styles it, same as the predecessor
           .book-ai-tier-card) - it exists as a spec selector hook to identify this section as the foot-of-page
           tier row, so keep it even though it looks unstyled. -->
      <section class="card book-tier-default-card">
        <app-collapsible-section
          sectionId="settings"
          [bookId]="bookId"
          [dir]="bookDir"
          [heading]="label('settings')">
          <app-tier-toggle
            scope="book"
            [bookId]="bookId"
            [bookLanguage]="bookLanguage"
            (tierChanged)="onTierChanged()">
          </app-tier-toggle>
        </app-collapsible-section>
      </section>
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
    /* The header's action cluster. A plain flex row, so it MIRRORS with the header's [dir] and the two
       buttons keep their reading order in Hebrew without a physical left/right anywhere. */
    .header-actions {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: var(--pd-space-2);
      flex: 0 0 auto;
    }
    .export-btn { white-space: nowrap; }
    /* Q8-C: the inputs-to-this-build group. It is INDENTED from the build row above it with a start-side
       rule, which is an INLINE (logical) border, so it mirrors with the book language rather than sitting
       physically left in Hebrew. */
    .inputs-to-build {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
      padding-inline-start: var(--pd-space-4);
      border-inline-start: 2px solid var(--pd-divider);
    }
    .inputs-explainer {
      margin: 0;
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
    }
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
export class BookDashboardComponent implements OnInit, OnChanges, OnDestroy {
  @Input() bookId!: string;
  @Input() bookTitle: string = '';
  /** Book language (e.g. 'he', 'en'); drives the book-scoped status rows' localization + status key. */
  @Input() bookLanguage: string | null = null;
  /**
   * Wave 3 / w2. The book's chapters, bound from the host's already-loaded `BookDetailDto.chapters`.
   *
   * The spine's stage 1 (Import) and stage 4 (Chapter editing passes) are derived from these, and from
   * nothing else: `chapterCount === 0` is `not-started` for Import and `blocked` for everything gated on
   * it, and stage 4 renders the chapters themselves rather than a book-level tick it cannot compute. This
   * is a BINDING of data the host already holds, deliberately not a fetch: the dashboard adding its own
   * chapter request would make the spine's stage 1 disagree with the chapter tree beside it.
   *
   * Null means the host has not loaded the book yet, which the spine renders as "not known", never as
   * "empty" - an empty book is `[]`.
   */
  @Input() chapters: ChapterSummaryDto[] | null = null;

  /**
   * Wave 3 / w5. Bumped by the host when a per-chapter surface asked to be sent to the relocated
   * writing-style row (the Linguistic result's "deviations need the baseline" hint, which the audit keeps
   * in place and only RETARGETS at the artifact's new home). Passed straight through to the row, which
   * owns the scroll: the dashboard does not know where inside that row the pointer should land.
   */
  @Input() focusBaselineToken = 0;

  /**
   * wb3-f01 navigation output: bubbles a chapter-anchor click up to the host (editor-page) so it can
   * call the existing selectChapter path. The host (editor-page) owns the chapter list and the
   * selectChapter logic; the dashboard only emits the anchor.
   */
  @Output() openChapter = new EventEmitter<ChapterAnchor>();

  /**
   * Emitted when a spine stage's action needs the review surfaces in view. The host (editor-page)
   * handles it by switching to Review mode (onReviewModeChange('review')); the dashboard itself does not
   * own the mode-switch, that lives in the editor's SegmentedControl, so it delegates upward via this
   * output and reuses the EXISTING onReviewModeChange path with no new coupling.
   */
  @Output() switchToReview = new EventEmitter<void>();

  /**
   * Wave 3 / w2: the spine's Import stage asked to go to the import screen. Routing lives on the host
   * (editor-page owns the Router and already has `goToImport()`); the dashboard only names the intent.
   */
  @Output() openImport = new EventEmitter<void>();

  /**
   * Wave 3 / w4: go to the export screen. Raised by the spine's Export stage AND by the header button, for
   * the same reason `openImport` exists: the Router lives on the host, and the dashboard only names intent.
   * One output for both entry points, so the two cannot drift to different destinations.
   */
  @Output() openExport = new EventEmitter<void>();

  /**
   * rf-c02: the "review running" affordance is NO LONGER emitted from here. It is now derived by the editor
   * directly from the single job registry ({@link JobRegistryService.anyRunningForBook$}), which the status
   * rows publish to via track() on build start and which survives this dashboard being @if-destroyed (close
   * panel / focus mode). The dashboard keeps tracking reviewState + summaryBuilding below for its OWN concerns
   * (findings/bible gating + the summary-build-complete fan-out) — it just no longer owns the host affordance.
   */

  /** The hosted review row; refreshed when a summary build finishes (clears its "build briefs first" gate). */
  @ViewChild('reviewRow') reviewRow?: BookReviewStatusRowComponent;

  /** The hosted summary row; refreshed when a tier change moves the active model (tier-ux-rework fixes c04). */
  @ViewChild('summaryRow') summaryRow?: BookSummaryStatusRowComponent;

  /**
   * The relocated writing-style row (w5 / MOVE-1). Refreshed on a tier change for the same reason its two
   * neighbours are: its `builtWithDifferentModel` flag is computed against the ACTIVE model, so a tier
   * write on this page makes it stale the moment it lands.
   */
  @ViewChild('baselineRow') baselineRow?: BookStyleBaselineStatusRowComponent;

  /** Anchor at the top of the status-rows section; scrolled to when a spine build action is pressed. */
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

  constructor(
    private bookService: BookService,
    /** Read ONLY for the spine's stage-4 running marks; the status rows still own their own builds. */
    private jobRegistry: JobRegistryService,
  ) {}

  ngOnInit(): void {
    this.loadProfile();
    this.watchRunningChapters();
    this.rebuildSpineSignals();
  }

  ngOnDestroy(): void {
    this.runningChaptersSub?.unsubscribe();
    this.runningChaptersSub = null;
  }

  /**
   * The editor switches books in place: the host updates [bookId] while the @if keeps THIS dashboard
   * instance alive (Angular does not recreate it). The hosted child rows (summary/review/story-bible/
   * chapter-summaries) self-correct via their own OnChanges keyed on bookId, but the dashboard's OWN
   * state (profile card, parsed structured analysis, the Ask answer, and the active review tab) would
   * otherwise carry over from the previous book. On a real bookId change (not the first binding, which
   * ngOnInit already loads), reset that own state and reload the profile so nothing leaks across books.
   * Skipped on firstChange so the initial load runs once via ngOnInit, not twice.
   *
   * c02: a bookLanguage change is the SAME kind of context switch and is handled identically, matching the
   * sibling chapter-summaries component (which already keys on bookId || bookLanguage). The book language is
   * mutable in-session: BookService.update() writes it and the editor binds [bookLanguage]="book.language"
   * off that same record, so this input really does change under a live dashboard. Everything this component
   * renders from the language is either a pure getter (labels, direction, which re-render on their own) or
   * SERVER content that was generated in the previous language: the profile card is built by a language-keyed
   * refresh, and the Ask answer was answered in the old language. Without this branch the chrome flipped to
   * the new language while the profile card kept the old language's content and no reload was ever issued.
   */
  ngOnChanges(changes: SimpleChanges): void {
    const bookIdChange = changes['bookId'];
    const languageChange = changes['bookLanguage'];
    const contextChanged =
      (!!bookIdChange && !bookIdChange.firstChange) ||
      (!!languageChange && !languageChange.firstChange);
    // One reset + one reload even when both inputs change in the same tick (the editor can rebind both).
    if (contextChanged) {
      this.resetOwnState();
      this.loadProfile();
      // The registry watch is filtered by the CURRENT bookId, so a book switch must re-scope it or the
      // previous book's in-flight chapter runs would keep marking rows in the new book's stage 4.
      this.watchRunningChapters();
    }
    // The chapter list drives stages 1 and 4 directly, so any rebinding of it (including the host's
    // in-place mutations after a create/delete/reorder, which arrive as a new array) refreshes the spine.
    if (contextChanged || changes['chapters']) {
      this.rebuildSpineSignals();
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
   *
   * c02: THIS is where the three request latches (loading / refreshing / asking) are settled for a context
   * switch, and it is the only place that may settle them on behalf of a request that is being abandoned. A
   * request in flight when the switch happens belongs to the OLD context, so its handlers bail without
   * touching any latch (see the guards below); if this reset did not clear them, an abandoned refresh or ask
   * would leave its button permanently disabled. loading is cleared here for the same reason and is then
   * re-raised immediately by the loadProfile() that every switch issues, so the card never flickers; clearing
   * it also leaves a correct idle state in the one path where no reload follows (no bookId).
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
    this.loading = false;
    // The two spine payloads belong to the PREVIOUS book: drop them so the spine renders "not known"
    // until the rows answer for the new one, rather than describing book A's briefs on book B's page.
    this.summaryStatus = null;
    this.reviewStatus = null;
    this.runningChapterIds = new Set<string>();
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
   * A tier toggle on this page committed a tier change (tier-ux-rework fixes c04). Changing a tier changes
   * the ACTIVE MODEL, and `builtWithDifferentModel` on BOTH book-scoped statuses is computed against it - so
   * the summary row's and the review row's cross-model staleness warnings are stale the moment the write
   * lands, and used to stay stale until the page was reloaded.
   *
   * ONE handler for BOTH toggles on the page: the book-default row at the foot and the BookReview row's own
   * (which reaches here through that row's pass-through `tierChanged`). Either can move the active model for
   * a task the other's status depends on, so a per-toggle branch would have to duplicate this fan-out - and a
   * dispatch whose branches diverge is how this codebase already shipped one refresh twice.
   *
   * Both re-reads go through the rows' OWN public loaders, which each cancel their previous in-flight status
   * GET and re-check (book, language) before applying an answer. That is the same seam `onSummaryTerminal`
   * uses; adding a fetch of our own beside it would race the row's rather than supersede it.
   */
  onTierChanged(): void {
    this.summaryRow?.loadBookSummaryStatus();
    this.reviewRow?.loadBookReviewStatus();
    // w5: the relocated writing-style row is the THIRD model-dependent status on this page now. It joined
    // the same fan-out rather than getting a branch of its own, for the reason stated above: a dispatch
    // whose branches diverge is how this codebase already shipped one refresh twice.
    this.baselineRow?.onTierChanged();
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
    // The spine reads 'building' as stage 3's `running`, so it has to move with this too.
    this.rebuildSpineSignals();
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
    // The spine reads this as stage 2's `running` the instant the build POST returns, rather than waiting
    // a poll interval for `activeBuildJobId` to appear in the next status read.
    this.rebuildSpineSignals();
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

  // ── Wave 3 / w2: the stage spine ────────────────────────────────────────────

  /**
   * The signals the spine renders from. Held as a FIELD and rebuilt only when one of its inputs really
   * changes, rather than assembled in a getter: a getter would hand the spine a fresh object identity on
   * every change-detection tick, which re-runs its derivation continuously for no reason.
   */
  spineSignals: StageSpineSignals = emptyStageSpineSignals();

  /** Latest raw briefs status from the hosted summary row. The spine's whole stage 2. */
  private summaryStatus: BookSummaryStatusDto | null = null;
  /** Latest raw review status from the hosted review row. The spine's whole stage 3. */
  private reviewStatus: BookReviewStatusDto | null = null;
  /** Chapter ids with an analysis job in flight right now; the one thing stage 4 CAN know book-wide. */
  private runningChapterIds = new Set<string>();
  /** The job-registry subscription behind {@link runningChapterIds}. */
  private runningChaptersSub: Subscription | null = null;

  /**
   * Rebuild {@link spineSignals}. Every field is a payload this page already has: the chapter list bound
   * from the host, the two status DTOs the rows fetch, and the registry's in-flight chapter jobs. Nothing
   * here is synthesized, and nothing is fetched a second time.
   *
   * `exportSurfaceAvailable` is the shared build fact ({@link EXPORT_SURFACE_AVAILABLE}), true since w4
   * built `/books/:bookId/export`. Stage 5 is therefore computed from this page's chapter list like every
   * other stage: `blocked` by Import with no chapters (the server's own 409), `ready` otherwise.
   */
  private rebuildSpineSignals(): void {
    const chapters: ChapterPassSignal[] | null = this.chapters
      ? this.chapters
          .slice()
          .sort((a, b) => a.order - b.order)
          .map(c => ({
            chapterId: c.id,
            title: c.title,
            order: c.order,
            running: this.runningChapterIds.has(c.id),
          }))
      : null;
    this.spineSignals = {
      chapters,
      chapterCount: this.chapters ? this.chapters.length : null,
      chaptersWithText: this.chapters ? this.chapters.filter(c => c.wordCount > 0).length : null,
      summary: this.summaryStatus,
      review: this.reviewStatus,
      summaryRunning: this.summaryBuilding,
      reviewRunning: this.reviewState === 'building',
      exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE,
    };
  }

  /**
   * Track which chapters have an analysis pass in flight, so stage 4's per-chapter breakdown can mark
   * them. `activeJobs$` is already filtered to non-terminal jobs; the chapter-scoped kinds are the ones
   * that carry a `chapterId`, and the book filter keeps another book's run out of this book's spine.
   */
  private watchRunningChapters(): void {
    this.runningChaptersSub?.unsubscribe();
    this.runningChaptersSub = this.jobRegistry.activeJobs$.subscribe(jobs => {
      const next = new Set<string>();
      for (const job of jobs) {
        if (job.bookId === this.bookId && job.chapterId) next.add(job.chapterId);
      }
      this.runningChapterIds = next;
      this.rebuildSpineSignals();
    });
  }

  /** The hosted summary row published a new briefs status payload. */
  onSummaryStatusChange(status: BookSummaryStatusDto | null): void {
    this.summaryStatus = status;
    this.rebuildSpineSignals();
  }

  /** The hosted review row published a new review status payload. */
  onReviewStatusChange(status: BookReviewStatusDto | null): void {
    this.reviewStatus = status;
    this.rebuildSpineSignals();
  }

  /**
   * A spine stage's action was pressed. The spine names the INTENT; this maps it onto the mechanisms the
   * page already has, so no action opens a second way of doing something the status rows own.
   *
   *  - `open-import`    leaves the page, so it goes up to the host, which owns the Router.
   *  - `build-briefs`   scrolls to the briefs row, which owns the build, its consent and its estimate.
   *                     This is also the FIX offered by a `blocked` review stage, which is the point:
   *                     the blocked row names the prerequisite AND hands the user the way to clear it.
   *  - `build-review`   scrolls to the same status block, where the review row's build lives.
   *  - `open-findings`  selects the Findings tab and scrolls to the ledger.
   *  - `open-export`    leaves the page for `/books/:bookId/export`, so like `open-import` it goes up to the
   *                     host, which owns the Router. The spine and the header button raise the SAME output,
   *                     so the two ways to reach export cannot land in different places.
   */
  onSpineAction(event: StageActionEvent): void {
    switch (event.action) {
      case 'open-import':
        this.openImport.emit();
        return;
      case 'build-briefs':
      case 'build-review':
        this.switchToReview.emit();
        this.scrollToStatusRows();
        return;
      case 'open-findings':
        this.switchToReview.emit();
        this.reviewTab = 'findings';
        this.scrollToFindings();
        return;
      case 'open-export':
        this.openExport.emit();
        return;
    }
  }

  /** A chapter was picked out of stage 4's per-chapter breakdown: open it, via the existing seam. */
  onSpineOpenChapter(chapter: ChapterPassSignal): void {
    this.openChapter.emit({ chapterId: chapter.chapterId, order: chapter.order, title: chapter.title });
  }

  /**
   * Scroll the status-rows anchor into view so the user sees the summary/review rows after
   * pressing a spine build action. Uses the #statusRowsAnchor template ref.
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
   * The effective book language for BOTH the server calls and the chrome, matching the contract the sibling
   * chapter-summaries component already uses: the bound bookLanguage when it carries a value, otherwise the
   * app-wide Hebrew default. This is not display-only: refreshProfile/ask stamp it onto the language-keyed
   * ChunkSummary and BookProfile rows, so an unthreaded call makes an English book build Hebrew briefs and
   * mislabels the cache the briefs and style-baseline paths later read.
   */
  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  /** True when the book language is English. Single source for every language branch on this component. */
  private get isEn(): boolean {
    return this.language.toLowerCase().startsWith('en');
  }

  /**
   * Direction for the whole dashboard, driving [attr.dir] on the root container. Follows bookLanguage
   * because this is book-scoped chrome: an English book renders an ltr dashboard, a Hebrew book rtl.
   * Previously the root was hardcoded dir="rtl" and reviewDir carved out the review tabs as the lone
   * exception, which left an English book with an rtl page full of Hebrew literals.
   */
  get bookDir(): 'rtl' | 'ltr' {
    return this.isEn ? 'ltr' : 'rtl';
  }

  /**
   * Direction for the review-tab bar and review surfaces. Same derivation as bookDir; kept as its own
   * member because the review-tabs template binds it by name and specs assert on it.
   */
  get reviewDir(): 'rtl' | 'ltr' {
    return this.bookDir;
  }

  /**
   * Localized dashboard chrome string. Follows bookLanguage (book-scoped chrome), matching the
   * he/en Record idiom the sibling status rows use. DRAFT Hebrew - flag for native-speaker review.
   */
  label(key: DashboardLabelKey): string {
    return (this.isEn ? DASHBOARD_LABELS_EN : DASHBOARD_LABELS_HE)[key];
  }

  /**
   * c03: the user-facing message for a failed request, and the single place the three handlers derive it.
   *
   * The message is ALWAYS the localized label, in whichever language the book is in. It deliberately does
   * NOT consult `err.message`.
   * BookService wraps nothing in catchError and the app registers no HttpInterceptor (provideHttpClient() is
   * called bare in app.config.ts), so every error that reaches these handlers is an HttpErrorResponse whose
   * `message` Angular ALWAYS generates non-empty: "Http failure response for <url>: 500 Internal Server
   * Error". The old `err.message || this.label(...)` therefore never reached its right operand, which made
   * all three localized labels unreachable in BOTH maps and painted that raw English transport string into a
   * Hebrew right-to-left card.
   *
   * It does NOT consult the response body either, and that is deliberate rather than an oversight. This API
   * has no error body a user may be shown. Its deliberate error bodies are all shaped `{ error: "..." }`
   * (BooksController 152/410/569/728/1134, AnalysisController 71/75/79/273/280, LanguageEngine 34/56/95/135)
   * or a bare string (`BadRequest("Question is required.")`, BooksController:997); nothing anywhere writes a
   * `message` field, so the `err.error?.message` term the ask handler used to carry never once matched. An
   * unhandled 500 has no mapped body at all: the only exception middleware registered is
   * `app.UseDeveloperExceptionPage()` (Program.cs), so outside Development the body is empty and inside it is
   * an HTML stack-trace page that Angular hands over as a parse-failure wrapper. And every one of those
   * server strings is English-only internal text (`ex.Message`, "Server is shutting down; cannot start new
   * build.") written without reference to the request language, so painting one into this card would
   * reintroduce, from the other side, the exact untranslated-string-in-a-Hebrew-card defect this method
   * exists to remove. A server-sourced user-facing message becomes possible only once the API emits a
   * localized one; until then the label is the whole contract.
   *
   * The raw error is not dropped: it is logged here with the caller's context, body included. That string was
   * the only place the failed call's status and URL were visible to anyone, and it belongs on the developer
   * surface rather than in the card.
   */
  private failureMessage(err: any, key: DashboardLabelKey, context: string): string {
    console.error(`[book-dashboard] ${context} failed`, err);
    return this.label(key);
  }

  /**
   * Localized label for a review tab. Follows bookLanguage, the same source that drives the dashboard's
   * own direction, so the review tabs and the dashboard chrome share one derivation and he/en parity is
   * preserved. DRAFT Hebrew - flag for native-speaker review before sign-off.
   */
  reviewTabLabel(tab: ReviewTab): string {
    const he: Record<ReviewTab, string> = { findings: 'ממצאים', bible: 'ספר הסיפור' };
    const en: Record<ReviewTab, string> = { findings: 'Findings', bible: 'Story Bible' };
    return (this.isEn ? en : he)[tab];
  }

  get synopsisPreview(): string {
    if (!this.profile?.synopsis) return '';
    return this.profile.synopsis.length <= 200
      ? this.profile.synopsis
      : this.profile.synopsis.slice(0, 200) + '…';
  }

  /**
   * c02 stale-response contract, shared by this method, onRefresh and onAsk.
   *
   * Each capture the (bookId, language) they were issued under and re-check BOTH in the next AND the error
   * handler, the same guard the sibling chapter-summaries component applies to every one of its requests.
   * The language belongs in the key because the profile is language-keyed server content: a load issued for
   * a Hebrew book must not paint a dashboard that has since switched to English.
   *
   * ORDERING INVARIANT, in the direction that actually holds: the guard runs before EVERY write in the
   * handler, latch clears included, so a response from a superseded context writes nothing at all. It does
   * not need to write anything: the latch it would have cleared was already settled for it by the
   * resetOwnState() that ran on the switch. The reverse order (clear the latch, then bail) is the live bug,
   * because by the time a stale response lands the latch it clears is no longer its own: it belongs to the
   * request the NEW context started, which would then be left with its spinner off while still in flight.
   */
  private loadProfile(): void {
    if (!this.bookId) return;
    const bookId = this.bookId;
    const lang = this.language;
    this.loading = true;
    this.error = null;
    this.bookService.getProfile(bookId).subscribe({
      next: (p) => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.profile = p;
        this.parseStructured();
        this.loading = false;
      },
      error: (err) => {
        if (this.bookId !== bookId || this.language !== lang) return;
        if (err.status === 404) {
          this.profile = null;
          this.error = null;
        } else {
          this.error = this.failureMessage(err, 'profileLoadError', 'profile load');
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

  // Wave 3 / w5 (Q4-A): `onRefresh()` LIVED HERE. It was the bare circular arrow's handler, and it was
  // the only whole-book build in the product with no status row, no consent, no cost estimate and no
  // activity entry. Its work (re-summarize stale chapters, then rebuild the book profile) did not
  // disappear with it: the Book briefs row runs it as the second phase of its own consented build, so the
  // profile cards on this page still have exactly one writer and now have a ceremony. This page re-reads
  // the rebuilt profile through the summary row's completion fan-out (`onSummaryBuildingChange`), which is
  // why there is no refreshProfile call left on this component.

  /** Ask the book a question in the CURRENT language. Guarded per the stale-response contract on loadProfile. */
  onAsk(): void {
    const q = this.askQuestion.trim();
    if (!this.bookId || !q || this.asking) return;
    const bookId = this.bookId;
    const lang = this.language;
    this.asking = true;
    this.askError = null;
    this.bookService.ask(bookId, q, lang).subscribe({
      next: (result) => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.lastAnswer = result;
        this.citationChapterIds = this.tryParseCitations(result.structuredResult);
        this.asking = false;
      },
      error: (err) => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.askError = this.failureMessage(err, 'askFailed', 'ask');
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
        return citations.map(c => c.chapterTitle ?? `${this.label('chapter')} ${c.chapterNumber ?? '?'}`).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }
}
