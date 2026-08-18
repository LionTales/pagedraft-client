import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
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
import { BookReviewStatusDto, FindingNavigationTarget } from '../../core/models/book-review';
import { BookSummaryStatusDto } from '../../core/models/book-summary';
import { CHAPTER_SCOPED_KINDS, JobRegistryService } from '../../core/services/job-registry.service';
import { BookSummaryStatusRowComponent } from './book-summary-status-row.component';
import { BookStyleBaselineStatusRowComponent } from './book-style-baseline-status-row.component';
import { BookReviewState, BookReviewStatusRowComponent } from './book-review-status-row.component';
import { BookReviewFindingsComponent } from './book-review-findings.component';
import { BookStoryBibleComponent } from './book-story-bible.component';
import { BookChapterSummariesComponent } from './book-chapter-summaries.component';
import { CharacterRegisterComponent } from './character-register.component';
import { StageActionEvent, StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import { StageGuideLink } from '../../shared/stage-spine/stage-guide';
import { ChapterPassSignal, EXPORT_SURFACE_AVAILABLE, StageSpineSignals, emptyStageSpineSignals } from '../../shared/stage-spine/stage-spine.model';
import {
  FirstRunOrientationComponent,
  OrientationLang,
  orientationString,
} from './first-run-orientation.component';
import { dismissOrientation, orientationDismissed } from './orientation-store';
import {
  BookSurfaceFocusRequest,
  BookSurfaceFocusService,
} from '../../core/services/book-surface-focus.service';
import { TierToggleComponent } from '../../shared/tier-toggle/tier-toggle.component';
import { CollapsibleSectionComponent } from '../../shared/collapsible-section/collapsible-section.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { ShowPointerStringKey, showPointerString } from '../../core/i18n/show-pointer-strings';

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
  // Wave 3 / w7 (Q5): `ask`, `askPlaceholder`, `asking`, `citations`, `askFailed` and `chapter` LIVED
  // HERE. All six belonged to the removed "ask about the book" card - its heading, its input, its
  // in-flight line, its citation strip, its failure message and the word the citation strip used to
  // name a chapter by number. The pointer that replaced the card reads its strings from
  // `core/i18n/show-pointer-strings.ts` instead, where he/en parity is compiler-enforced over a closed
  // key union (this map's `Record<DashboardLabelKey, string>` gives the same guarantee; the pointer
  // shares its strings with the analysis panel, whose own map does not, which is why they live there).
  | 'profileLoadError'
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
  profileLoadError: 'שגיאה בטעינת הפרופיל',
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
  profileLoadError: 'Could not load the profile',
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
    // Wave 3 / w7: `FormsModule` LEFT THIS LIST with the ask card. Its input was this template's only
    // `[(ngModel)]`, so the module became an import that brought in Angular's whole forms machinery for
    // nothing. Re-add it the moment a form control lands here again.
    CommonModule,
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
    FirstRunOrientationComponent,
  ],
  template: `
    <div class="book-dashboard" #dashboardRoot [attr.dir]="bookDir">
      <header class="dashboard-header">
        <h3 class="dashboard-title">{{ label('title') }}: {{ bookTitle }}</h3>
        <div class="header-actions">
          <!-- Wave 3 / w6 (Q10-D): THE RE-OPEN AFFORDANCE for the first-run orientation. Permanent, in
               the header, in every state including long after the panel was dismissed. The brief names
               option C's failure mode explicitly - "undiscoverable when they want it back" - so this is
               deliberately not in a menu, not behind a hover and not inside a collapsible section.
               RTL: MIRRORS with the header row, like the Export button beside it. -->
          <button
            type="button"
            class="pd-btn pd-btn-ghost orientation-reopen-btn"
            data-testid="dashboard-orientation-btn"
            [attr.aria-label]="orientationLabel('reopenAria')"
            (click)="openOrientation()">
            {{ orientationLabel('reopen') }}
          </button>
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
      <!-- Wave 3 / w6 (Q10-D's overlay half). ABOVE the spine, because it points DOWN at the spine and
           the build rows and the pointer reads backwards otherwise. It is an in-flow panel, not a modal:
           nothing behind it is inert, no build is gated on it, and it can be ignored indefinitely.
           Mounted inside the @if so a dashboard that is not offering orientation constructs nothing and
           issues no guides request. -->
      @if (orientationOpen) {
        <app-first-run-orientation
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          [open]="orientationOpen"
          (dismissed)="onOrientationDismissed()"
          (openGuide)="onOpenGuide($event)">
        </app-first-run-orientation>
      }

      <app-stage-spine
        [bookLanguage]="bookLanguage"
        [signals]="spineSignals"
        (stageAction)="onSpineAction($event)"
        (openChapter)="onSpineOpenChapter($event)"
        (openGuide)="onSpineOpenGuide($event)">
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
          [chapterCount]="chapterCount"
          [chaptersWithText]="chaptersWithText"
          (summaryTerminal)="onSummaryTerminal()"
          (statusChange)="onSummaryStatusChange($event)"
          (statusUnreadable)="onSummaryStatusUnreadable($event)"
          (buildingChange)="onSummaryBuildingChange($event)">
        </app-book-summary-status-row>

        <!-- Q8-C + the collapse directive. A long per-chapter list, so it is one of the two sections that
             DEFAULT to collapsed; the explainer sits OUTSIDE the fold, so the relationship it states
             ("these are the inputs") is legible even when the list itself is folded away. -->
        <div class="inputs-to-build" #inputsAnchor [attr.dir]="bookDir" data-testid="inputs-to-this-build">
          <p class="inputs-explainer">{{ label('inputsExplainer') }}</p>
          <app-collapsible-section
            sectionId="inputs"
            [bookId]="bookId"
            [dir]="bookDir"
            [heading]="label('inputsToThisBuild')"
            [openToken]="inputsOpenToken"
            [defaultCollapsed]="true">
            <app-book-chapter-summaries
              [bookId]="bookId"
              [bookLanguage]="bookLanguage"
              [chapters]="chapters"
              [refreshSignal]="summaryDerivedRefresh">
            </app-book-chapter-summaries>
          </app-collapsible-section>
        </div>

        <app-book-review-status-row
          #reviewRow
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          [chapterCount]="chapterCount"
          [chaptersWithText]="chaptersWithText"
          (reviewStateChange)="onReviewStateChange($event)"
          (statusChange)="onReviewStatusChange($event)"
          (statusUnreadable)="onReviewStatusUnreadable($event)"
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
          [chapterCount]="chapterCount"
          [chaptersWithText]="chaptersWithText"
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
        <!-- The four profile cards are the SECOND level the collapse directive asks for: elements
             inside a major part. Each defaults to expanded (the current layout) and each remembers its own
             fold per book. None of them is a build status, a prerequisite warning or a consent prompt, so
             none of them is in the never-collapse class. (The Ask card was a fifth member of this group
             until Wave 3 / w7 removed it; the pointer that replaced it is deliberately not collapsible,
             see the note at it.) -->
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

        <!-- Wave 3 / w7 (Q5): the "ask about the book" CARD stood here, with its own input, its own
             in-flight state and its own answer block. It is gone and Show is the ask surface; what is
             left at its address is a pointer, for one release, so the capability is discoverable where
             the author last saw it.

             TODO(2026-08-14, wave 4): delete this .show-pointer-card section (and, if the analysis
             panel's pointer in analysis-panel.component.html is also retired by then, the shared
             show-pointer-strings.ts map and this component's showPointerLabel/openShow). One release
             of grace was the whole design; nothing here should still be pointing at Show once wave 4
             ships (finding C12 - the "for one release" sentence above had nothing encoding it).

             NOT collapsible, unlike the four profile cards above it: it is three lines with no content
             to hide, and a fold on it would be a second gesture standing between the author and the
             thing that replaced the card. It is also not a modal and blocks nothing - the button opens
             the dock beside the page and leaves the dashboard exactly where it was.

             HEADING LEVEL is h4, a peer of the settings row's .settings-heading further down this
             page, not h3: this section is one card among several on the dashboard, not a second
             page title (finding C9). The BUTTON is the same quiet outline weight the analysis panel's
             copy of this pointer uses (.show-pointer-btn in analysis-panel.component.scss), not a
             filled primary fill: one shared string set must not read as the dashboard's strongest call
             to action in one slot and a quiet aside in the other.

             RTL: a plain stacked block. The heading, the sentence and the button are ordinary flow
             content with logical block margins only, so text alignment and button placement both come
             from the dir the dashboard root already carries; nothing is positioned physically, so
             there is no per-element fixed-vs-mirrored call to make. -->
        <section class="card show-pointer-card">
          <h4 class="show-pointer-title">{{ showPointerLabel('title') }}</h4>
          <p class="show-pointer-body">{{ showPointerLabel('dashboardBody') }}</p>
          <button
            type="button"
            class="show-pointer-btn"
            [attr.aria-label]="showPointerLabel('openAria')"
            (click)="openShow()">
            {{ showPointerLabel('open') }}
          </button>
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
      <section class="card character-register-card" #registerAnchor>
        <app-collapsible-section
          sectionId="character-register"
          [bookId]="bookId"
          [dir]="bookDir"
          [heading]="label('characterRegister')"
          [openToken]="registerOpenToken"
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
      <!-- COLLAPSE VERDICT for the settings section: NEVER COLLAPSE (wave3-spine fixes c08, finding 25).
           It was the one section of the nine with no recorded verdict, and it was wrapped. Two reasons,
           either of which is sufficient:
             1. It CARRIES A SERVER-DRIVEN WARNING. The tier toggle renders its fallback warning ("this is
                set to thinking, but the task is actually running on the fast tier") off a flag that
                arrives on the ai-tier GET with NO user action - so a fold the author performed weeks ago,
                on a different topic, would hide the only place the app admits the book default is not
                what will run. The save error and the consent prompt live in here too. That puts this
                section squarely in the same class as a status row's blocked warning and an open consent
                prompt, which the collapse directive's own qualifier keeps out of the fold.
             2. Folding it SIMPLIFIES NOTHING. The directive's brief is "collapsible WHERE IT SIMPLIFIES";
                the body here is one line (two words and an info affordance), so the fold traded a warning
                surface for roughly one line of scroll.
           A stale settings key may still sit in a reader's stored collapse map from before this verdict;
           it is inert (no section reads it) and the map is best-effort by design, so it is left alone.
           Pinned by book-dashboard.component.spec.ts, "the never-collapse class", which asserts the whole
           class against the rendered DOM rather than trusting this comment. -->
      <section class="card book-tier-default-card">
        <h4 class="settings-heading">{{ label('settings') }}</h4>
        <app-tier-toggle
          scope="book"
          [bookId]="bookId"
          [bookLanguage]="bookLanguage"
          (tierChanged)="onTierChanged()">
        </app-tier-toggle>
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
    /* WRAPS, and that is the 2.6 constraint reaching the header. The row holds a book title plus an
       action cluster, and the cluster does not shrink; in a 300px panel with English labels
       ("How this works" + "Export" = roughly 211px of the 257px available) the two could not share a
       line, so the header overflowed its own container (scrollWidth past clientWidth) by 41px - and
       because the Export button is the row's LAST control, its right edge is the row's own overflow
       edge, so it was drawn the same 41px past the panel. The fix is the same one the spine uses for its
       five names: give the content its own line rather than clipping it. flex-wrap moves the cluster
       below the title exactly when it no longer fits, at any width and in either language, and changes
       nothing on a wide panel. Measured via book-dashboard.component.spec.ts's own 257px repro seam
       (r01); see that file's non-vacuity comment for the coordinates. */
    .dashboard-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: var(--pd-space-3);
    }
    .dashboard-title {
      margin: 0;
      /* Takes the line it is on, and wraps inside it rather than forcing the row wider than the panel. */
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: break-word;
      font-size: var(--pd-text-h5);
      line-height: var(--pd-lh-h5);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text);
    }
    /* The header's action cluster. A plain flex row, so it MIRRORS with the header's [dir] and the two
       buttons keep their reading order in Hebrew without a physical left/right anywhere. It wraps
       INTERNALLY too, so a future third action (or a longer translation) breaks onto a second line
       instead of pushing the last button out of the panel. */
    .header-actions {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--pd-space-2);
      flex: 0 0 auto;
    }
    .export-btn { white-space: nowrap; }
    .orientation-reopen-btn { white-space: nowrap; }
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
    /* Wave 3 / w7: the Show pointer that replaced the ask card. Every value is a --pd-* token, and
       every box property that could have been physical is logical or symmetric, so the block mirrors
       with the dashboard's own [attr.dir] and needs no rtl/ltr branch of its own. */
    .show-pointer-title {
      margin: 0 0 var(--pd-space-2) 0;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body);
      font-weight: var(--pd-weight-medium);
      color: var(--pd-text);
    }
    .show-pointer-body {
      margin: 0 0 var(--pd-space-4) 0;
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body);
      color: var(--pd-text-secondary);
    }
    /* Same quiet outline weight the analysis panel's copy of this pointer uses (finding C9): a
       pointer to a discovery surface must not be the strongest call to action on the page, and one
       shared string set must not carry two visual weights across its two slots. Was filled-primary
       (solid background, border: none) until this fix. */
    .show-pointer-btn {
      padding: var(--pd-space-3) var(--pd-space-5);
      border-radius: var(--pd-radius-sm);
      border: 1px solid var(--pd-primary);
      background: var(--pd-surface);
      color: var(--pd-primary);
      cursor: pointer;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }
    .show-pointer-btn:hover { background: var(--pd-surface-brand); }
    .show-pointer-btn:focus-visible { outline: none; box-shadow: var(--pd-ring); }
  `]
})
export class BookDashboardComponent implements OnInit, OnChanges, OnDestroy, AfterViewChecked {
  @Input() bookId!: string;
  @Input() bookTitle: string = '';
  /** Book language (e.g. 'he', 'en'); drives the book-scoped status rows' localization + status key. */
  @Input() bookLanguage: string | null = null;
  /**
   * Wave 3 / w2. The book's chapters, bound from the host's already-loaded `BookDetailDto.chapters`.
   *
   * The spine's stage 1 (Import) and stage 4 (Chapter editing passes) are derived from these, and from
   * nothing else. TWO numbers come off this list, not one: how many chapters there are and how many of them
   * carry text, which together are `buildInputsFor`'s whole input - `not-started` for Import and `blocked`
   * for everything gated on it, whether the book has no rows OR has rows with nothing written in them.
   * Stage 4 renders the chapters themselves rather than a book-level tick it cannot compute. This
   * is a BINDING of data the host already holds, deliberately not a fetch: the dashboard adding its own
   * chapter request would make the spine's stage 1 disagree with the chapter tree beside it.
   *
   * Null means the host has not loaded the book yet, which the spine renders as "not known", never as
   * "empty" - an empty book is `[]`.
   */
  @Input() chapters: ChapterSummaryDto[] | null = null;

  /**
   * How many chapters the EXPORTER could put in a file, straight off the book payload the host already
   * loaded (`BookDetailDto.exportableChapterCount`). Stage 5's whole `ready` test.
   *
   * A SECOND INPUT rather than a count off {@link chapters}, because it is not derivable from a chapter
   * summary: "carries text" is a word count and "can be exported" is whether the stored document holds a
   * renderable block. Deriving it here is precisely the defect w8 / F2 closed - the spine said
   * `Export: Ready` on a book whose export answered 409. Null means the host has not loaded the book yet,
   * or the server did not send the count; both render as "not known", never as "nothing to export".
   */
  @Input() exportableChapterCount: number | null = null;

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
   *
   * d1: the payload is a FindingNavigationTarget - the same ChapterAnchor plus the optional excerpt /
   * finding-id hints the Findings ledger attaches. The Story Bible and the stage spine keep emitting a
   * bare anchor, which is assignable, so only the ledger's clicks carry hints.
   */
  @Output() openChapter = new EventEmitter<FindingNavigationTarget>();

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
   * Wave 3 / w6 (Q13-A): open a served guide in the `/help/:guideId` reader that chatbot phase A.2 built.
   *
   * Raised by BOTH guide entry points on this page - a spine row's "read the guide for this stage" and the
   * orientation panel's "read the whole guide" - for the same reason `openExport` is one output for two
   * entry points: the Router lives on the host, and two outputs would be two places for the destination to
   * drift. The payload carries the language the guide should OPEN IN, which is this book's language: the
   * reader is app-level and Hebrew-default on its own, and `?lang=` is the parameter A.2 built for exactly
   * this, so a link from a book-scoped surface opens the book's language without changing the reader's
   * own rule.
   */
  @Output() openGuide = new EventEmitter<{ guideId: string; lang: 'he' | 'en' }>();

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

  /**
   * d1: the Findings ledger, when the Findings tab is selected. `@if`-mounted, so this is undefined
   * whenever the Story Bible tab is showing - {@link drainPendingOpenFinding} waits for it rather than
   * assuming it.
   */
  @ViewChild(BookReviewFindingsComponent) findingsPanel?: BookReviewFindingsComponent;

  /**
   * Chatbot phase B: the two sections a citation chip can deep-link to that are not already anchored.
   * They are the WRAPPER elements, not the collapsible bodies, so the scroll still lands correctly when
   * the section is folded (which is these two sections' default).
   */
  @ViewChild('inputsAnchor') inputsAnchor?: ElementRef<HTMLElement>;
  @ViewChild('registerAnchor') registerAnchor?: ElementRef<HTMLElement>;

  /**
   * THE SCROLL CONTAINER, and the thing whose growth invalidates a deep-link scroll (c01 fixes review
   * finding #4). `.book-dashboard` carries `overflow-y: auto; max-height: 100%`, so it is the element
   * `scrollIntoView` actually scrolls, and its `scrollHeight` is the total height of everything the
   * page's async reads have delivered so far. See {@link focusHold} for what that measurement is for.
   */
  @ViewChild('dashboardRoot') dashboardRoot?: ElementRef<HTMLElement>;

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

  // Wave 3 / w7 (Q5): `askQuestion`, `asking`, `askError`, `lastAnswer` and `citationChapterIds` LIVED
  // HERE, and `onAsk()` / `tryParseCitations()` lived down beside `loadProfile`. All of it belonged to
  // the removed ask card. The c02 stale-response contract documented on `loadProfile` had three
  // participants and now has two (loadProfile and the rows' own calls); the ask half of it went with
  // the handler, and `resetOwnState` below no longer settles an `asking` latch because there is none.

  constructor(
    private bookService: BookService,
    /** Read ONLY for the spine's stage-4 running marks; the status rows still own their own builds. */
    private jobRegistry: JobRegistryService,
    /**
     * Chatbot phase B: the assistant's citation chips deep-link into these surfaces. Root-provided, so
     * adding it here does not break a single existing spec of this component with a NullInjector.
     */
    private surfaceFocus: BookSurfaceFocusService,
    /**
     * Wave 3 / w7: the Show pointer's button opens the dock through this. Root-provided with no
     * dependencies of its own (see its own docstring), so like `surfaceFocus` above it costs no
     * existing spec a NullInjector.
     */
    private overlays: AppOverlayService,
  ) {}

  ngOnInit(): void {
    this.loadProfile();
    this.watchRunningChapters();
    this.rebuildSpineSignals();
    this.focusSub = this.surfaceFocus.focus$.subscribe(req => this.onSurfaceFocus(req));
  }

  ngOnDestroy(): void {
    this.runningChaptersSub?.unsubscribe();
    this.runningChaptersSub = null;
    this.focusSub?.unsubscribe();
    this.focusSub = null;
    // c01: a held scroll owns a pending timer and a closure over this view. Both die with the component.
    this.releaseFocusHold();
  }

  // ── Chatbot phase B: bringing a cited surface into view ──────────────────────────────────────────

  private focusSub: Subscription | null = null;

  /**
   * Open tokens for the two sections that default to COLLAPSED. Bumped rather than set, because the
   * request is a gesture; see `CollapsibleSectionComponent.openToken`.
   */
  inputsOpenToken = 0;
  registerOpenToken = 0;

  /**
   * A citation chip asked for one of these surfaces.
   *
   * MAPPED ONTO THE MECHANISMS THAT ALREADY EXIST, exactly as `onSpineAction` is: the same
   * `switchToReview` output, the same review tab field, the same two scroll anchors. A chip must not
   * open a second way of doing something a surface already owns, or the two will drift.
   *
   * `chapter` is deliberately absent from this switch: a chapter's TEXT lives in the editor, not in the
   * dashboard, so the host handles that one before it ever reaches here.
   */
  private onSurfaceFocus(request: BookSurfaceFocusRequest): void {
    switch (request.target) {
      case 'findings':
      case 'story-bible':
        // The ledger and the Story Bible are two tabs of one section, so both need review mode and both
        // land at the same anchor; only the tab differs.
        this.switchToReview.emit();
        this.reviewTab = request.target === 'findings' ? 'findings' : 'bible';
        this.holdFocusScroll(() => this.scrollToFindings());
        return;
      case 'chapter-briefs':
        this.switchToReview.emit();
        this.inputsOpenToken++;
        this.holdFocusScroll(() => this.scrollToInputs());
        return;
      case 'register':
        this.switchToReview.emit();
        this.registerOpenToken++;
        this.holdFocusScroll(() => this.scrollToRegister());
        return;
      case 'status':
        // All three status rows live in ONE card, so the stage does not change the destination. It is
        // still carried on the request rather than collapsed away, because the day one of them moves,
        // the caller's intent will still be on the wire.
        this.switchToReview.emit();
        this.holdFocusScroll(() => this.scrollToStatusRows());
        return;
      default:
        return;
    }
  }

  // ── c01: making the deep-link scroll land on the FIRST (cold) click ──────────────────────────────
  //
  // THE DEFECT, measured live at 900px: a chip clicked while the dashboard was not yet mounted left the
  // findings heading at `top: 1442` (off screen), and the same chip clicked again - with the dashboard
  // already mounted and loaded - left it at `top: 556`. A cold `?focus=register` left the register card
  // at `top: 3691` WITH ITS SECTION CORRECTLY EXPANDED. So the mode switch, the open token and the
  // anchor were all right; the scroll was simply measured against a page that had not been built yet.
  //
  // WHY THE PREVIOUS HOP WAS NOT ENOUGH. The host already learned once that a `setTimeout` "looked like
  // enough and was not" and replaced it with `ngAfterViewChecked`, which proves the dashboard has
  // SUBSCRIBED. Subscribing is not laying out: at that instant this page is a header, a skeleton spine,
  // three unresolved status rows and a one-line loading hint, so `scrollHeight` is barely over
  // `clientHeight` and `scrollIntoView` has almost nothing to scroll. Eight async reads then land -
  // `loadProfile`, the summary / review / style-baseline status GETs, the spine rebuild, the first-run
  // orientation panel and its guides, the findings ledger's own GET, the character register's own GET -
  // and push the anchor down under a scroll position that was correct when it was taken.
  //
  // WHY THIS IS A HEIGHT SIGNAL AND NOT A LONGER TIMER, AND NOT A ResizeObserver.
  //  - A list of "loads that have reported" is unreachable: the two status rows publish `statusChange`
  //    only when the value CHANGES and publish failure on a separate `statusUnreadable` channel, and the
  //    ledger, the Story Bible, the register and the baseline row report nothing to this component at
  //    all. The ledger is the one whose content lands LAST (it only mounts once the review row's state
  //    says ready/stale, and only then issues its own GET) and it is the one sitting directly above the
  //    register anchor, so a window closed on the reads we can see would close before the growth that
  //    matters most.
  //  - A `ResizeObserver` on this root would fire ZERO times for that growth. The root is
  //    `max-height: 100%` with its own scrollbar, so its observed box does not change when its content
  //    does. RO is the obvious first reach here and it is the wrong one; recorded so it is not re-tried.
  //  - The container's `scrollHeight`, sampled in `ngAfterViewChecked`, is complete BECAUSE it measures
  //    the result rather than the cause: every one of the eight arrivals is an HTTP response, so each
  //    lands in a zone task and drives a change-detection pass, and this hook runs after that pass has
  //    been written to the DOM. A child that reports nothing still moves this number.

  /**
   * How long corrections keep being applied after a focus request.
   *
   * THIS IS A CEILING, NOT A DELAY, and the distinction is the whole reason it is allowed to exist in a
   * file that has already been burnt by a timer. Nothing waits for it: the scroll lands off the height
   * signal, at whatever moment the content actually arrives, so changing this number cannot change
   * whether the chip works. It bounds only how long the page keeps re-asserting, which matters for one
   * reason - a layout change minutes later (the author unfolding a section) must not yank them back to
   * a surface they asked for in another context.
   */
  private static readonly FOCUS_SETTLE_CEILING_MS = 2500;

  /**
   * The live focus request, held across the window in which the page is still assembling itself.
   *
   * `scroll` is the anchor's own helper rather than the anchor, so each anchor keeps exactly one caller.
   * `contentHeight` is the last `scrollHeight` a scroll was asserted against; a difference is the signal
   * that later content has arrived and the assert must be repeated. `asserted` distinguishes the FIRST
   * pass, which always scrolls, from the later ones, which scroll only on movement.
   */
  private focusHold: {
    scroll: () => void;
    contentHeight: number;
    asserted: boolean;
    ceiling: ReturnType<typeof setTimeout> | null;
  } | null = null;

  /**
   * Start (or replace) the hold for a focus request. Deliberately does NOT scroll here.
   *
   * THE FIRST SCROLL IS ORDERED AFTER THE NEXT CHANGE-DETECTION PASS, which is the pass that applies the
   * `openToken` bump the two collapsed targets just made. That ordering is the second half of finding
   * #4: `chapter-briefs` and `register` were strictly worse than `findings` precisely because their
   * section unfolded AFTER the scroll had already been measured, and an unfolded section is what gives
   * the container the extra scrollable height the anchor needs. Deferring the first assert also covers
   * the case a height-triggered assert alone would miss - a section the author already had open, where
   * the token bump changes no height at all.
   */
  private holdFocusScroll(scroll: () => void): void {
    this.releaseFocusHold();
    this.focusHold = {
      scroll,
      contentHeight: this.focusContentHeight(),
      asserted: false,
      ceiling: setTimeout(
        () => this.releaseFocusHold(),
        BookDashboardComponent.FOCUS_SETTLE_CEILING_MS,
      ),
    };
  }

  /** Total height of everything currently rendered into the scroll container; 0 before it exists. */
  private focusContentHeight(): number {
    return this.dashboardRoot?.nativeElement?.scrollHeight ?? 0;
  }

  /**
   * Assert the held scroll once per change-detection pass in which it can still be wrong.
   *
   * Runs after the view has been checked, so the DOM already carries whatever that pass rendered - the
   * unfolded section, the status row that just got its payload, the profile cards that just replaced the
   * loading hint. `scrollIntoView` is idempotent, so a repeat that finds nothing moved costs nothing.
   */
  ngAfterViewChecked(): void {
    this.drainPendingOpenFinding();
    const hold = this.focusHold;
    if (!hold) return;
    const height = this.focusContentHeight();
    if (hold.asserted && height === hold.contentHeight) return;
    hold.asserted = true;
    hold.contentHeight = height;
    hold.scroll();
  }

  /**
   * d1: hand a held open-finding request to the ledger as soon as it has mounted.
   *
   * Published on a timer rather than inline, for the reason the host's equivalent drain records: honouring
   * it mutates the LEDGER's own view state (its expanded set) and doing that inside the change-detection
   * pass that just checked it is the classic ExpressionChangedAfterItHasBeenChecked. The tab is re-checked
   * here rather than trusted, so a reader who switched to the Story Bible before the ledger mounted does
   * not get yanked back.
   */
  private drainPendingOpenFinding(): void {
    const id = this.pendingOpenFindingId;
    if (!id) return;
    if (this.reviewTab !== 'findings') {
      this.pendingOpenFindingId = null;
      return;
    }
    const panel = this.findingsPanel;
    if (!panel) return;
    this.pendingOpenFindingId = null;
    setTimeout(() => panel.openFinding(id));
  }

  /**
   * End the correction window. Called by the ceiling, by the next request, by a context switch and by
   * teardown - a focus is a gesture about ONE book, so a book or language change discards it outright
   * rather than letting it re-aim at the next book's page.
   */
  private releaseFocusHold(): void {
    if (this.focusHold?.ceiling) clearTimeout(this.focusHold.ceiling);
    this.focusHold = null;
  }

  private scrollToInputs(): void {
    this.inputsAnchor?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private scrollToRegister(): void {
    this.registerAnchor?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    //
    // D14: `exportableChapterCount` is listed for the same reason and is NOT covered by `chapters`. Both
    // of today's hosts rebind the two off one refreshed `book` object, so the omission was latent - but a
    // host that re-asks the server only for the count (the count and the chapter list can move
    // independently: a chapter's stored document becomes renderable without the list changing at all)
    // would leave stage 5 rendering the previous answer with no way to notice.
    if (contextChanged || changes['chapters'] || changes['exportableChapterCount']) {
      this.rebuildSpineSignals();
    }
  }

  /**
   * Clear the dashboard-owned transient state that is NOT re-derived from an @Input on its own, so a
   * book switch does not show the previous book's profile/answer/tab. `loadProfile()` only ASSIGNS
   * `this.profile` from its `next` handler (or nulls it on a 404) - it never nulls the field up front,
   * because the OTHER caller (`onSummaryBuildingChange`, a same-book refresh after a briefs build
   * completes) deliberately relies on that to keep the current profile visible with no flash while the
   * new one loads. A book switch has the opposite requirement, so `profile` and the fields parsed from
   * it are nulled HERE instead: the Ask question/answer, expansion toggles, and the active review tab
   * (back to the default Findings view) are cleared the same way. findingsRefreshToken is owned by the
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
    // d1: a held open-finding request is about the PREVIOUS book's ledger. Drop it with the rest.
    this.pendingOpenFindingId = null;
    this.synopsisExpanded = false;
    this.expandedPlotNode = null;
    this.reviewState = 'unknown';
    this.summaryBuilding = false;
    this.loading = false;
    // Drop the previous book's profile card (and anything parsed from it) so it cannot keep rendering
    // under the new book's title while the switch's loadProfile() GET is still in flight.
    this.profile = null;
    this.charactersParsed = null;
    this.storyParsed = null;
    // The two spine payloads belong to the PREVIOUS book: drop them so the spine renders "not known"
    // until the rows answer for the new one, rather than describing book A's briefs on book B's page.
    this.summaryStatus = null;
    this.reviewStatus = null;
    // A read failure belonged to the previous book's rows too. The rows clear their own latches on the
    // same context change, but the host must not sit on a stale "unreadable" in the window before those
    // publishes drain, or the new book's decision could resolve on the old book's fault.
    this.summaryStatusUnreadable = false;
    this.reviewStatusUnreadable = false;
    this.runningChapterIds = new Set<string>();
    // w6: the orientation decision belonged to the PREVIOUS book. Back to undecided (not to closed), so
    // the new book gets its own first run judged from its own statuses and its own stored dismissal - a
    // second book is a second first run, which is the whole reason the flag is keyed per book.
    this.orientationOpenState = null;
    this.orientationDecidedOnUnreadableStatus = false;
    // c01: a deep-link scroll is a gesture about the book that was on screen when the chip was clicked.
    // The whole page is about to be rebuilt from another book's payloads, and every one of those
    // arrivals is a height change this hold would answer by scrolling - to an anchor whose contents are
    // now a different book's. Drop it here, with the rest of the previous book's transient state.
    this.releaseFocusHold();
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

  /**
   * How many chapters this book has, or `null` while the chapter list has not arrived. ONE authority, read
   * by the spine's stage-1 signal AND by the three build rows' import precondition, because those two are
   * required to agree: the live defect this closes was a spine rendering `blocked` by Import while the
   * build buttons 200px below it stayed enabled and offered to analyse the chapters of a book with none.
   * Two independently computed copies of "how many chapters" is how that comes back.
   */
  get chapterCount(): number | null {
    return this.chapters ? this.chapters.length : null;
  }

  /**
   * How many of those chapters carry any text, or `null` while the chapter list has not arrived. THE OTHER
   * HALF OF THE SAME AUTHORITY, for the same reason (final-r02): `chapterCount` alone answered only the
   * empty book, so a book with three chapters created empty rendered a spine saying "there are 3 chapters
   * but nothing has been written in them, so a file made now would be empty" while the three build rows a
   * couple of hundred pixels below it stayed enabled and offered to spend a real model run on them.
   *
   * Read by BOTH the spine's stage-1/2/3/5 derivation and the three rows' `blockedByImport`, through the
   * one shared predicate (`buildInputsFor`). The `wordCount > 0` test is the server's own `has text`
   * definition (`BooksController`'s `chaptersWithTextCount`), which is what the books list feeds the same
   * spine from - so this page and that one answer the same question the same way.
   */
  get chaptersWithText(): number | null {
    return this.chapters ? this.chapters.filter(c => c.wordCount > 0).length : null;
  }

  /** Latest raw briefs status from the hosted summary row. The spine's whole stage 2. */
  private summaryStatus: BookSummaryStatusDto | null = null;
  /** Latest raw review status from the hosted review row. The spine's whole stage 3. */
  private reviewStatus: BookReviewStatusDto | null = null;
  /**
   * The briefs row's status READ FAILED, as opposed to not having answered yet. Read only by
   * {@link maybeOfferOrientation}; the spine deliberately keeps treating an unread status as unknown,
   * because "we could not read it" is not a stage state and inventing one would put a fault in a row
   * whose whole job is to describe the book.
   */
  private summaryStatusUnreadable = false;
  /** The review row's status READ FAILED, under the same rule as {@link summaryStatusUnreadable}. */
  private reviewStatusUnreadable = false;
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
   * other stage, off BOTH counts: `blocked` by Import with no chapters and, since c01, `blocked` again when
   * the chapters exist but carry no text - the server's own two 409 answers (`noChapters`,
   * `nothingWritten`) - and `ready` only when a file made now would hold something.
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
      chapterCount: this.chapterCount,
      chaptersWithText: this.chaptersWithText,
      chaptersExportable: this.chapters ? this.exportableChapterCount : null,
      summary: this.summaryStatus,
      review: this.reviewStatus,
      summaryRunning: this.summaryBuilding,
      reviewRunning: this.reviewState === 'building',
      exportSurfaceAvailable: EXPORT_SURFACE_AVAILABLE,
    };
  }

  /**
   * Track which chapters have an analysis pass in flight, so stage 4's per-chapter breakdown can mark
   * them. `activeJobs$` is already filtered to non-terminal jobs; {@link CHAPTER_SCOPED_KINDS} is the
   * explicit allowlist of kinds that can carry a `chapterId` (the `WHOLE_BOOK_BUILD_KINDS` idiom, applied
   * to the chapter-scoped side), and the book filter keeps another book's run out of this book's spine.
   */
  private watchRunningChapters(): void {
    this.runningChaptersSub?.unsubscribe();
    this.runningChaptersSub = this.jobRegistry.activeJobs$.subscribe(jobs => {
      const next = new Set<string>();
      for (const job of jobs) {
        if (job.bookId === this.bookId && CHAPTER_SCOPED_KINDS.has(job.kind) && job.chapterId) next.add(job.chapterId);
      }
      this.runningChapterIds = next;
      this.rebuildSpineSignals();
    });
  }

  /** The hosted summary row published a new briefs status payload. */
  onSummaryStatusChange(status: BookSummaryStatusDto | null): void {
    this.summaryStatus = status;
    this.rebuildSpineSignals();
    this.maybeOfferOrientation();
  }

  /** The hosted review row published a new review status payload. */
  onReviewStatusChange(status: BookReviewStatusDto | null): void {
    this.reviewStatus = status;
    this.rebuildSpineSignals();
    this.maybeOfferOrientation();
  }

  /**
   * The hosted briefs row reported whether its status read has FAILED (w6 fixes c01).
   *
   * The spine is not rebuilt from this: an unreadable status is still an unknown one as far as a stage
   * is concerned. The one consumer is the first-run decision, which needs to tell a fetch that is over
   * and failed from one still in flight.
   */
  onSummaryStatusUnreadable(unreadable: boolean): void {
    this.summaryStatusUnreadable = unreadable;
    this.maybeOfferOrientation();
  }

  /** The hosted review row reported the same thing about its own status read. */
  onReviewStatusUnreadable(unreadable: boolean): void {
    this.reviewStatusUnreadable = unreadable;
    this.maybeOfferOrientation();
  }

  /**
   * A spine stage's action was pressed. The spine names the INTENT; this maps it onto the mechanisms the
   * page already has, so no action opens a second way of doing something the status rows own.
   *
   *  - `open-import`    leaves the page, so it goes up to the host, which owns the Router. It is also what
   *                     every blocked stage offers on a book with NO chapters, because it is the only
   *                     action the author can actually walk from there.
   *  - `build-briefs`   scrolls to the briefs row, which owns the build, its consent and its estimate.
   *                     This is the FIX offered by a review stage blocked on MISSING BRIEFS - the case
   *                     where chapters exist and the briefs row can genuinely build.
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

  // ── Wave 3 / w6: the guide pointers and the first-run orientation panel ──────────────────────────

  /** A spine row asked for the guide that answers its stage. */
  onSpineOpenGuide(link: StageGuideLink): void {
    this.onOpenGuide(link.guideId);
  }

  /** Open one guide in the reader, in THIS BOOK's language. Routing belongs to the host. */
  onOpenGuide(guideId: string): void {
    this.openGuide.emit({ guideId, lang: this.orientationLang });
  }

  /**
   * Whether the orientation panel is on screen.
   *
   * `null` means the host has not decided yet, which is not the same as "no": the decision needs status
   * payloads that have LANDED, and a page that guessed `false` would never offer orientation on the one
   * book it exists for, while a page that guessed `true` would flash the panel over a fully built book.
   * {@link maybeOfferOrientation} resolves it to a boolean the moment there is a fact to resolve it with,
   * and {@link openOrientation} sets it directly when the author asks.
   */
  private orientationOpenState: boolean | null = null;

  /**
   * The current answer was reached only because one of the two statuses could NOT BE READ, so it is
   * provisional: see {@link maybeOfferOrientation}. False whenever the answer came from real payloads,
   * from the stored dismissal, or from the author's own open.
   */
  private orientationDecidedOnUnreadableStatus = false;

  /** Template hook. Null (undecided) renders exactly like closed: nothing on screen, nothing fetched. */
  get orientationOpen(): boolean {
    return this.orientationOpenState === true;
  }

  /**
   * Whether the first-run question has an answer at all yet.
   *
   * Undecided and decided-closed render IDENTICALLY (both are "no panel"), which is exactly why a
   * decision that never resolved could sit there unnoticed. This getter is the only place the two are
   * distinguishable, and it is what the regression test asserts on.
   */
  get orientationDecided(): boolean {
    return this.orientationOpenState !== null;
  }

  /** The book's language, for the panel's chrome and for the language a guide link opens in. */
  private get orientationLang(): OrientationLang {
    return (this.bookLanguage ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  /** The re-open button's own strings, from the panel's map so the two cannot drift. */
  orientationLabel(key: 'reopen' | 'reopenAria'): string {
    return orientationString(this.orientationLang, key);
  }

  /**
   * THE FIRST-RUN TRIGGER: first visit to a book with no builds.
   *
   * Both halves are required, and both are read from facts rather than from absence:
   *  - NOT DISMISSED for this book (`orientation-store.ts`, per book, fails open to "not dismissed").
   *  - NO BUILDS, judged from the two status payloads THIS PAGE ALREADY FETCHES. A payload that has not
   *    arrived is `null`, and a null is not "no builds" - it is the absence of an answer - so this
   *    declines to decide until both have landed. That is the same rule the spine derives its stages by,
   *    and it is what keeps the panel off a book whose briefs turn out to be built.
   *
   * Once decided the answer STICKS for this mount: the panel does not vanish under the author because a
   * build they started while reading it finished. A book switch re-opens the question, and so does the
   * one provisional answer described below.
   *
   * ── w6 fixes c01: A READ THAT FAILED IS NOT A READ THAT HAS NOT ANSWERED ─────────────────────────
   *
   * The rule above is about a payload that has not ARRIVED. A row whose status GET FAILED is in a
   * different state, and it used to be indistinguishable here: neither row published anything on a
   * status error, so the host's payload stayed `null` for the life of the mount and this method deferred
   * forever, on the one book the panel exists for, in a state that renders identically to closed. Both
   * rows now publish `statusUnreadable`, so a half is UNKNOWN only while it is neither answered nor
   * known-unreadable.
   *
   * DOES AN UNREADABLE BOOK COUNT AS A FIRST RUN? NO, deliberately. A failed read is not evidence that
   * nothing is built; it is a stronger absence than an unarrived one, since the fetch is over and it
   * told us nothing. Offering the panel there would be the same failure the null rule exists to prevent
   * (flashing it over a book that turns out to be built) and would spend the author's one first run on
   * it. So an unreadable half resolves the question to NOT OFFERED. What changes is that it RESOLVES.
   *
   * That particular answer is PROVISIONAL, and it is the one case where "the answer sticks" bends. An
   * answer taken from two real payloads must not be re-taken, or the panel could vanish under an author
   * mid-sentence. An answer taken because a payload could not be READ was taken under a fault, and that
   * fault is retryable (the briefs row's own retry control, and this page's `onSummaryTerminal` /
   * `onTierChanged` re-reads). So when the missing status finally lands, the question is re-taken from
   * the facts, which is the behaviour this page already had before the fault could be seen at all. The
   * re-take can only turn a not-offered into an offered for a book that really is untouched, and both
   * author-driven answers ({@link openOrientation}, {@link onOrientationDismissed}) clear the flag, so
   * nothing the author did can be overwritten by a late payload.
   */
  private maybeOfferOrientation(): void {
    if (this.orientationOpenState !== null && !this.orientationDecidedOnUnreadableStatus) return;
    if (!this.bookId) return;
    if (orientationDismissed(this.bookId)) {
      this.orientationOpenState = false;
      this.orientationDecidedOnUnreadableStatus = false;
      return;
    }
    const summary = this.summaryStatus;
    const review = this.reviewStatus;
    // Not known yet = no answer AND no failure. A read still in flight decides nothing, as before.
    if (!summary && !this.summaryStatusUnreadable) return;
    if (!review && !this.reviewStatusUnreadable) return;
    if (!summary || !review) {
      // One half is known-unreadable: this book cannot be shown to be a first run, so it is not offered.
      this.orientationOpenState = false;
      this.orientationDecidedOnUnreadableStatus = true;
      return;
    }
    this.orientationOpenState = !summary.hasSummary && !review.hasReview;
    this.orientationDecidedOnUnreadableStatus = false;
  }

  /** The re-open affordance. Always available, including after a permanent dismissal. */
  openOrientation(): void {
    this.orientationOpenState = true;
    // The author asked for it, so this is no longer a provisional answer a late status may re-take.
    this.orientationDecidedOnUnreadableStatus = false;
  }

  /**
   * The author closed the panel. The dismissal is PERMANENT for this book and is written here rather
   * than inside the panel: the panel renders and fetches, the page owns what the author has seen.
   *
   * Only a real close writes the flag. A panel that failed to load its guide and was never actually read
   * still has to be closed by hand to count, so a broken corpus cannot silently spend the author's one
   * first run.
   */
  onOrientationDismissed(): void {
    this.orientationOpenState = false;
    // A dismissal is the author's own answer and is final for this book, so no late status re-takes it.
    this.orientationDecidedOnUnreadableStatus = false;
    dismissOrientation(this.bookId);
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
  onOpenChapterFromFinding(anchor: FindingNavigationTarget): void {
    this.openChapter.emit(anchor);
  }

  /**
   * d1: open one named finding in the ledger, on behalf of the editor host (the per-chapter checklist's
   * "הצג" button). Selects the Findings tab and forwards to the ledger.
   *
   * HELD RATHER THAN CALLED INLINE, for the reason the host records at its own hold site: the ledger is
   * `@if`-mounted behind the tab this method is in the middle of selecting, so at the moment of the call
   * the ViewChild is very often still undefined. {@link ngAfterViewChecked} publishes it once the ledger
   * is actually there, which is a fact rather than a guess about ordering. The ledger then does its own
   * holding for the case where its rows have not been fetched yet.
   */
  openFinding(findingId: string): void {
    if (!findingId) return;
    this.reviewTab = 'findings';
    this.pendingOpenFindingId = findingId;
  }

  /** A finding waiting for the ledger to exist. Null when nothing is waiting. */
  private pendingOpenFindingId: string | null = null;

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
   * c02 stale-response contract. `onRefresh` and `onAsk` used to share it too, before w5 and w7 retired
   * them; `loadProfile` is now the only participant left in this component (the rows' own status GETs
   * apply the same pattern independently, each guarded by its own capture).
   *
   * It captures the (bookId, language) it was issued under and re-checks BOTH in the next AND the error
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

  // Wave 3 / w7 (Q5): `onAsk()` and `tryParseCitations()` LIVED HERE. Their card is gone and Show is
  // the ask surface, so the two methods went with it rather than being left callable from nowhere. The
  // API endpoint they used, `POST /api/books/{id}/ask`, is untouched and still serves `AnalysisType.QA`.

  /**
   * Localized string for the Show pointer that stands where the ask card stood.
   *
   * Follows the BOOK language, like the rest of this page's chrome, via the same `isEn` derivation
   * every other label on this component uses. The assistant it opens is app-level and Hebrew-default;
   * see the language note in `show-pointer-strings.ts` for why that mismatch is the app's rule rather
   * than this pointer's bug.
   */
  showPointerLabel(key: ShowPointerStringKey): string {
    return showPointerString(this.isEn ? 'en' : 'he', key);
  }

  /**
   * Open Show, on the dock's assistant tab.
   *
   * `AppOverlayService` is the dock's own state owner and this is the same call the dock's launcher
   * makes, so the pointer opens the real surface rather than describing it. The service is a
   * `providedIn: 'root'` singleton with no dependencies of its own, so field-injecting it here adds no
   * transitive provider an existing TestBed has to learn about (the NullInjector-across-the-suite trap
   * that a new CONSTRUCTOR dependency sets off).
   *
   * The dock is a side drawer, not a modal: opening it leaves this page mounted, scrolled where it was
   * and fully usable, which is the requirement the pointer was written under.
   */
  openShow(): void {
    this.overlays.openTab('assistant');
  }
}
