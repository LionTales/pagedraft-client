import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';

import { chapterDisplayNumber } from '../../core/utils/chapter-number';
import {
  BEHIND_FALLBACK,
  CHAPTER_RUNNING_LABEL,
  COMPACT_ARIA_LABEL,
  COMPACT_UNKNOWN_LABEL,
  DETAILS_TOGGLE_LABEL,
  PER_CHAPTER_LABEL,
  SPINE_ARIA_LABEL,
  STAGE_EXPLANATION,
  STAGE_NAMES,
  STATE_LABELS,
  SpineLang,
  UNKNOWN_LABEL,
  actionLabel,
  behindMagnitudeLabel,
  behindSentence,
  blockedSentence,
  chapterListToggleLabel,
  compactPipLabel,
  compactSummaryLine,
  exportNothingWrittenDetail,
  findingsProgress,
  importDetail,
  spineLang,
} from './stage-spine.copy';
import {
  ChapterPassSignal,
  SpineStageId,
  StageActionId,
  StageSpineSignals,
  StageStatus,
  deriveStageSpine,
  emptyStageSpineSignals,
  focusStageId,
} from './stage-spine.model';

/**
 * How much of the spine is drawn. ONE component, two densities, one derivation - a second component would
 * be a second place for the state vocabulary to drift, which is the defect this wave removes.
 *
 *  - `full`     the five self-explaining rows. Book surfaces, inside the 300-380px panel.
 *  - `compact`  a five-pip rail plus one line of readable text. App-level surfaces that hold no book
 *               payload beyond a list row, and the editor route whenever the full spine is off screen.
 */
export type SpineDensity = 'full' | 'compact';

/** What the host is being asked to do when a stage row's action is pressed. */
export interface StageActionEvent {
  stage: SpineStageId;
  action: StageActionId;
}

/**
 * Wave 3 / w2 - THE STAGE SPINE. Replaces FunnelStepperComponent outright.
 *
 * ── What it is ────────────────────────────────────────────────────────────────────────────────────
 * Five stages in canonical order (Import, Book briefs, Developmental review, Chapter editing passes,
 * Export), ONE state vocabulary, every state computed from a real payload field. It is the same surface
 * as the guided experience: each row explains itself, names its prerequisite when it is blocked, and
 * offers the next action (Q10-D's permanent half). There is no second "guide me" component.
 *
 * ── Fully presentational ──────────────────────────────────────────────────────────────────────────
 * No services, no HTTP, no polling. The host assembles {@link StageSpineSignals} from payloads it
 * already holds and binds them in. That keeps the derivation unit-testable seeded-signal by
 * seeded-signal, and it means mounting this component anywhere (w3 mounts it in app chrome too) costs
 * no new requests and adds no constructor dependency to anybody's TestBed.
 *
 * ── THE FORM, and why it is a vertical list ───────────────────────────────────────────────────────
 * The panel this lives in is 300 to 380 pixels wide. The four-label horizontal strip that shipped here
 * ALREADY clipped its own names at the 380 default, in both languages (`Structure` rendered "Struc...",
 * `ליטוש` rendered "לי..."). The reconciled model has FIVE stages and three of the five names are two or
 * more words long in both languages, so a five-column strip in that panel is not a viable form, and the
 * brief forbids solving it with truncation or a tooltip: a stage name the user cannot read orients
 * nobody, which is the whole point of the spine.
 *
 * So the spine is a VERTICAL STACKED LIST. Each row gets the full panel width for its name, names wrap
 * instead of being clipped (`white-space: normal`, no `text-overflow`), and nothing in this component
 * carries a `title` attribute. `stage-spine.component.spec.ts` pins that as a layout CONTRACT at a
 * 300px host width, in Hebrew with all five names and again in English.
 *
 * ── RTL: what mirrors, and what is physically fixed ───────────────────────────────────────────────
 * Everything in this component mirrors, and that is a deliberate finding rather than a default: the
 * spine has no draggable edge, no anchored overlay and no motion toward a corner, which are the three
 * element classes in this codebase that must stay physically pinned. Per element:
 *   - root `dir`            MIRRORS, following the BOOK language (book-scoped chrome).
 *   - stage marker circle   MIRRORS. Inline-start of the row, so physically right in Hebrew.
 *   - connector rail        MIRRORS. Positioned with `inset-inline-start` so it stays under the markers
 *                           rather than jumping to the other side of the row in Hebrew.
 *   - expand chevron        MIRRORS. Inline-end of the row. Its glyph is vertical, so it needs no
 *                           direction-aware swap the way a left/right arrow would.
 *   - state chip            MIRRORS. It follows the name in reading order.
 *   - the `behind` accent   MIRRORS. `border-inline-start`, so it hugs the reading edge.
 *   - action button         MIRRORS (full row width). The LABEL is `text-align: center` (`.stage-action`),
 *                           not `start` - deliberate, matching every other full-width primary button in
 *                           this app - and center alignment is symmetric under mirroring, so there is
 *                           nothing to physically fix or preserve reading order for here.
 *   - numerals              PHYSICALLY FIXED, and deliberately: digits are LTR glyphs. The marker number,
 *                           the chapter order and the behind-magnitude badge are separate elements with
 *                           `unicode-bidi: isolate` in the styles below. A count EMBEDDED inside a
 *                           sentence has no element of its own to put that CSS on - stage 1's import
 *                           detail, stage 3's findings progress and stage 4's chapter-toggle count get the
 *                           same isolation at the string level instead (`isolateDigits`,
 *                           `stage-spine.copy.ts`), wrapping each digit run in `<span class="iso">`
 *                           and rendered via `[innerHTML]` (Angular's default sanitizer; no
 *                           `bypassSecurityTrust*`). Stage 5's "nothing written" sentence
 *                           (`exportNothingWrittenDetail`) is the one remaining sentence-embedded count
 *                           NOT yet isolated - named here on purpose rather than silently, since a
 *                           per-element list that misstates its own members is the defect this comment
 *                           exists to stop repeating.
 *   - the running spinner   PHYSICALLY FIXED. A rotation has no reading direction.
 *
 * ── RTL in the COMPACT density (w3), same discipline, per element ──────────────────────────────────
 *   - root `dir`            MIRRORS, following the BOOK this spine describes (see {@link bookLanguage}).
 *                           The rail therefore starts at the reading edge: stage 1 is physically
 *                           rightmost in Hebrew and leftmost in English.
 *   - the pip rail          MIRRORS. A plain inline flex row, so it reverses with `dir` and the canonical
 *                           order survives as READING order rather than as a fixed left-to-right one.
 *   - the pip numbers       PHYSICALLY FIXED (`unicode-bidi: isolate`): digits are LTR glyphs and must not
 *                           reorder inside a Hebrew run.
 *   - the summary line      MIRRORS. `text-align: start`.
 * Nothing in this density is draggable, anchored or animated toward a corner, so nothing needs pinning.
 *
 * ── The two hard rules ────────────────────────────────────────────────────────────────────────────
 * 1. Nothing is presented as done unless the app computed it. Stage 1 is derived from the chapters (the
 *    old `Structure` was the literal string 'done'), stage 4 makes no book-level claim at all, and
 *    stage 5 reads the chapters too - `blocked` when there are none, which is the server's own 409.
 * 2. Tokens only (`--pd-*`), no em-dash or en-dash in any user-facing string, no model or provider
 *    identity anywhere including in the `behind` reasons, and Syncfusion is not touched.
 */
@Component({
  selector: 'app-stage-spine',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (density === 'compact') {
      <!-- ── COMPACT ─────────────────────────────────────────────────────────────────────────────────
           A five-pip rail and ONE line of text. Deliberately non-interactive: it renders inside rows and
           bars that already own their click targets (the books list row, the editor status bar), and
           nesting a second set of controls in them would be an a11y trap rather than a feature. The way
           to "expand" it is the surface's own affordance - open the book, and the full spine is there. -->
      <div
        class="spine-compact"
        data-testid="stage-spine-compact"
        [attr.dir]="dir"
        role="group"
        [attr.aria-label]="text(COMPACT_ARIA_LABEL)">
        <ol class="compact-rail">
          @for (stage of stages; track stage.id; let i = $index) {
            <li
              class="compact-pip"
              [attr.data-testid]="'spine-compact-pip-' + stage.id"
              [attr.data-state]="dataState(stage)">
              <!-- The number is the only glyph. It is aria-hidden and the full name + state travel in the
                   visually-hidden span beside it, so nothing is ever abbreviated for a screen reader. -->
              <span class="compact-pip__num" aria-hidden="true">{{ i + 1 }}</span>
              <span class="pd-visually-hidden">{{ pipLabel(stage) }}</span>
            </li>
          }
        </ol>
        <p class="compact-summary" data-testid="spine-compact-summary">{{ compactSummary }}</p>
      </div>
    } @else {
    <nav
      class="stage-spine"
      data-testid="stage-spine"
      [attr.dir]="dir"
      [attr.aria-label]="text(SPINE_ARIA_LABEL)">
      <ol class="spine-list">
        @for (stage of stages; track stage.id; let i = $index) {
          <li
            class="spine-stage"
            [class.spine-stage--blocked]="stage.state === 'blocked'"
            [class.spine-stage--behind]="stage.state === 'behind'"
            [class.spine-stage--running]="stage.state === 'running'"
            [class.spine-stage--ready]="stage.state === 'ready'"
            [class.spine-stage--unavailable]="stage.state === 'unavailable'"
            [class.spine-stage--open]="isExpanded(stage.id)"
            [attr.data-testid]="'spine-stage-' + stage.id"
            [attr.data-state]="dataState(stage)">
            <button
              type="button"
              class="stage-head"
              [attr.data-testid]="'spine-stage-head-' + stage.id"
              [attr.aria-expanded]="isExpanded(stage.id)"
              [attr.aria-controls]="'spine-body-' + stage.id"
              [attr.aria-label]="stageName(stage.id) + ', ' + stateText(stage) + ', ' + text(DETAILS_TOGGLE_LABEL)"
              (click)="toggle(stage.id)">
              <span class="stage-marker" aria-hidden="true">
                @if (stage.state === 'running') {
                  <span class="stage-spinner"></span>
                } @else {
                  <span class="stage-marker__num">{{ i + 1 }}</span>
                }
              </span>
              <span class="stage-headline">
                <!-- The stage NAME. Wraps, never truncates, never carries a title tooltip: this is the
                     2.6 constraint that killed the strip this component replaces. -->
                <span class="stage-name" [attr.data-testid]="'spine-stage-name-' + stage.id">{{ stageName(stage.id) }}</span>
                <span
                  class="stage-state"
                  [class]="'state--' + dataState(stage)"
                  [attr.data-testid]="'spine-stage-state-' + stage.id">{{ stateText(stage) }}</span>
              </span>
              <span class="stage-chevron" aria-hidden="true">{{ isExpanded(stage.id) ? '▴' : '▾' }}</span>
            </button>

            @if (isExpanded(stage.id)) {
              <div
                class="stage-body"
                [id]="'spine-body-' + stage.id"
                [attr.data-testid]="'spine-stage-body-' + stage.id">
                <!-- What this stage IS. Present on every row, in every state. -->
                <p class="stage-line stage-line--explain">{{ explanation(stage.id) }}</p>

                <!-- blocked: NAME the prerequisite, then offer the fix as the action below. -->
                @if (stage.state === 'blocked' && stage.blockedBy) {
                  <p
                    class="stage-line stage-line--blocked"
                    [attr.data-testid]="'spine-blocked-' + stage.id">{{ blockedText(stage) }}</p>
                }

                <!-- behind: magnitude as its own badge, then every reason the payload actually carries. -->
                @if (stage.state === 'behind') {
                  <div class="behind-block" [attr.data-testid]="'spine-behind-' + stage.id">
                    @if (stage.behindMagnitude !== null) {
                      <span
                        class="behind-magnitude"
                        [attr.data-testid]="'spine-behind-magnitude-' + stage.id">{{ magnitudeText(stage) }}</span>
                    }
                    @for (line of behindLines(stage); track line) {
                      <p class="stage-line stage-line--behind">{{ line }}</p>
                    }
                  </div>
                }

                <!-- Stage 1's honest detail: chapters exist but none has text yet, or the coverage. The
                     count is isolated ([innerHTML], Angular's default sanitizer, no bypassSecurityTrust*
                     - see stage-spine.copy.ts's isolateDigits) so it cannot reorder inside the Hebrew
                     sentence around it. -->
                @if (importDetailText(stage); as detail) {
                  <p class="stage-line" data-testid="spine-import-detail" [innerHTML]="detail"></p>
                }

                <!-- Stage 5's honest detail: the chapters are there, the words are not, so the file would
                     be empty. Without it, a blocked row naming Import on a book that HAS chapters reads
                     as the spine being wrong rather than as the book being unwritten. -->
                @if (exportDetailText(stage); as detail) {
                  <p class="stage-line" data-testid="spine-export-detail">{{ detail }}</p>
                }

                <!-- Stage 3's working-through progress, straight off the two counts (isolated digits, see
                     above). -->
                @if (progressText(stage); as progress) {
                  <p class="stage-line" data-testid="spine-progress-review" [innerHTML]="progress"></p>
                }

                <!-- Stage 4: the ENTRY POINT into the per-chapter breakdown. Never a book-level tick. -->
                @if (stage.perChapter && stage.chapters?.length) {
                  <button
                    type="button"
                    class="chapter-toggle"
                    data-testid="spine-chapters-toggle"
                    [attr.aria-expanded]="chaptersOpen"
                    aria-controls="spine-chapter-list"
                    (click)="chaptersOpen = !chaptersOpen"
                    [innerHTML]="chapterToggleText(stage)">
                  </button>
                  @if (chaptersOpen) {
                    <ul class="chapter-list" id="spine-chapter-list" data-testid="spine-chapters">
                      @for (chapter of stage.chapters; track chapter.chapterId) {
                        <li class="chapter-item">
                          <button
                            type="button"
                            class="chapter-btn"
                            [attr.data-testid]="'spine-chapter-' + chapter.chapterId"
                            (click)="onChapterClick(chapter)">
                            <span class="chapter-order">{{ chapterNumber(chapter.order) }}</span>
                            <span class="chapter-title">{{ chapter.title }}</span>
                            @if (chapter.running) {
                              <span class="chapter-running">{{ text(CHAPTER_RUNNING_LABEL) }}</span>
                            }
                          </button>
                        </li>
                      }
                    </ul>
                  }
                }

                <!-- The next action. Absent rather than disabled when there is nothing honest to offer. -->
                @if (stage.action) {
                  <button
                    type="button"
                    class="stage-action"
                    [attr.data-testid]="'spine-action-' + stage.id"
                    (click)="onAction(stage)">
                    {{ actionText(stage) }}
                  </button>
                }
              </div>
            }
          </li>
        }
      </ol>
    </nav>
    }
  `,
  styles: [`
    :host { display: block; }

    .stage-spine {
      display: block;
      padding: var(--pd-space-4) var(--pd-space-4);
      background: var(--pd-surface-sunken);
      border-bottom: 1px solid var(--pd-divider);
      font-family: var(--pd-font-ui);
    }

    /* VERTICAL STACK. Each row owns the full width, which is the whole answer to the 300px constraint:
       five names of two or three words cannot share one row's width, and they do not have to. */
    .spine-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
    }

    .spine-stage {
      position: relative;
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      transition: border-color var(--pd-dur-fast) var(--pd-ease),
                  background var(--pd-dur-fast) var(--pd-ease);
    }

    /* Connector rail between markers. inset-inline-start so it MIRRORS with the markers it joins. */
    .spine-stage:not(:last-child)::after {
      content: '';
      position: absolute;
      inset-inline-start: calc(var(--pd-space-4) + 12px);
      top: 100%;
      width: 2px;
      height: var(--pd-space-3);
      background: var(--pd-divider);
    }

    /* ── Row head ── */
    .stage-head {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: var(--pd-space-3);
      width: 100%;
      box-sizing: border-box;
      padding: var(--pd-space-3) var(--pd-space-4);
      background: none;
      border: none;
      cursor: pointer;
      text-align: start;
      font-family: inherit;
      color: inherit;
    }
    .stage-head:focus-visible { outline: none; box-shadow: var(--pd-ring); border-radius: var(--pd-radius-md); }

    .stage-marker {
      flex: 0 0 auto;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--pd-border-strong);
      background: var(--pd-surface);
      /* Digits are LTR glyphs: isolate so the number never reorders inside a Hebrew run. */
      unicode-bidi: isolate;
    }
    .stage-marker__num {
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-secondary);
      line-height: 1;
    }
    .spine-stage--ready .stage-marker { border-color: var(--pd-keep); }
    .spine-stage--behind .stage-marker { border-color: var(--pd-improve); }
    .spine-stage--running .stage-marker { border-color: var(--pd-info); }
    .spine-stage--unavailable .stage-marker { border-color: var(--pd-neutral-300); }

    .stage-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid color-mix(in srgb, var(--pd-info) 30%, transparent);
      border-top-color: var(--pd-info);
      border-radius: 50%;
      animation: spine-spin 0.8s linear infinite;
    }
    @keyframes spine-spin { to { transform: rotate(360deg); } }

    .stage-headline {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--pd-space-1);
    }

    /* THE NAME. Wraps; never clipped, never ellipsised, never a tooltip. */
    .stage-name {
      max-width: 100%;
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
      font-weight: var(--pd-weight-semibold);
      color: var(--pd-text);
      white-space: normal;
      overflow-wrap: break-word;
      overflow: visible;
    }
    .spine-stage--unavailable .stage-name { color: var(--pd-text-secondary); }

    .stage-state {
      max-width: 100%;
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
      font-weight: var(--pd-weight-medium);
      padding: 1px var(--pd-space-2);
      border-radius: var(--pd-radius-pill);
      border: 1px solid transparent;
      white-space: normal;
      overflow-wrap: break-word;
    }
    .state--ready { color: var(--pd-keep); background: var(--pd-keep-bg); border-color: var(--pd-keep-border); }
    .state--behind { color: var(--pd-improve); background: var(--pd-improve-bg); border-color: var(--pd-improve-border); }
    .state--running { color: var(--pd-info); background: var(--pd-info-bg); border-color: var(--pd-info); }
    .state--blocked { color: var(--pd-secondary-700); background: var(--pd-secondary-50); border-color: var(--pd-secondary-300); }
    .state--not-started { color: var(--pd-primary-700); background: var(--pd-primary-50); border-color: var(--pd-primary-200); }
    .state--unavailable,
    .state--unknown,
    .state--per-chapter { color: var(--pd-text-muted); background: var(--pd-neutral-100); border-color: var(--pd-neutral-300); }

    .stage-chevron {
      flex: 0 0 auto;
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
      line-height: 1.6;
    }

    /* The behind state is the one users hit most and the one the old strip could not say at all, so it
       gets a real treatment: an amber reading-edge accent and a tinted card.
       Amber, never red: nothing failed here, the book simply moved. */
    .spine-stage--behind {
      background: var(--pd-improve-bg);
      border-color: var(--pd-improve-border);
      border-inline-start-width: 3px;
      border-inline-start-color: var(--pd-improve);
    }
    .spine-stage--blocked { border-color: var(--pd-secondary-300); }
    .spine-stage--unavailable { background: var(--pd-neutral-50); }

    /* ── Row body ── */
    .stage-body {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--pd-space-2);
      padding: 0 var(--pd-space-4) var(--pd-space-4);
    }

    .stage-line {
      margin: 0;
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
      color: var(--pd-text-secondary);
    }
    .stage-line--explain { color: var(--pd-text-secondary); }
    .stage-line--blocked { color: var(--pd-secondary-700); font-weight: var(--pd-weight-medium); }
    .stage-line--behind { color: var(--pd-text); }

    /* Sentence-embedded count (isolateDigits, stage-spine.copy.ts): same isolation as the spans below. */
    .iso { unicode-bidi: isolate; }

    .behind-block {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--pd-space-2);
    }
    .behind-magnitude {
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-bold);
      color: var(--pd-improve);
      background: var(--pd-surface);
      border: 1px solid var(--pd-improve-border);
      border-radius: var(--pd-radius-pill);
      padding: 1px var(--pd-space-3);
      unicode-bidi: isolate;
    }

    /* ── Stage 4 chapter breakdown ── */
    .chapter-toggle {
      align-self: flex-start;
      background: none;
      border: none;
      padding: var(--pd-space-1) 0;
      cursor: pointer;
      color: var(--pd-text-link);
      font-family: inherit;
      font-size: var(--pd-text-caption);
      text-align: start;
    }
    .chapter-toggle:hover { text-decoration: underline; }
    .chapter-toggle:focus-visible { outline: none; box-shadow: var(--pd-ring); }

    .chapter-list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 190px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
    }
    .chapter-btn {
      display: flex;
      flex-direction: row;
      align-items: baseline;
      gap: var(--pd-space-2);
      width: 100%;
      box-sizing: border-box;
      padding: var(--pd-space-2) var(--pd-space-3);
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      text-align: start;
      font-family: inherit;
      font-size: var(--pd-text-caption);
      color: var(--pd-text);
    }
    .chapter-btn:hover { border-color: var(--pd-primary-600); }
    .chapter-btn:focus-visible { outline: none; box-shadow: var(--pd-ring); }
    .chapter-order {
      flex: 0 0 auto;
      font-family: var(--pd-font-mono);
      color: var(--pd-text-muted);
      unicode-bidi: isolate;
    }
    .chapter-title {
      flex: 1 1 auto;
      min-width: 0;
      white-space: normal;
      overflow-wrap: break-word;
    }
    .chapter-running {
      flex: 0 0 auto;
      font-size: var(--pd-text-caption);
      color: var(--pd-info);
      background: var(--pd-info-bg);
      border-radius: var(--pd-radius-pill);
      padding: 0 var(--pd-space-2);
    }

    /* ── The next action ── */
    .stage-action {
      width: 100%;
      box-sizing: border-box;
      padding: var(--pd-space-3) var(--pd-space-4);
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
      border: none;
      border-radius: var(--pd-radius-sm);
      cursor: pointer;
      font-family: inherit;
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      text-align: center;
      white-space: normal;
    }
    .stage-action:hover { background: var(--pd-primary-hover); }
    .stage-action:focus-visible { outline: none; box-shadow: var(--pd-ring); }
    .spine-stage--behind .stage-action { background: var(--pd-improve); color: var(--pd-neutral-900); }

    /* ── COMPACT density. Its per-element mirror-or-fixed calls are in the class doc above. ── */
    .spine-compact {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: var(--pd-space-3);
      flex-wrap: wrap;
      font-family: var(--pd-font-ui);
    }

    .compact-rail {
      list-style: none;
      margin: 0;
      padding: 0;
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      gap: var(--pd-space-1);
      flex: 0 0 auto;
    }

    .compact-pip {
      inline-size: 16px;
      block-size: 16px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--pd-border-strong);
      background: var(--pd-surface);
      color: var(--pd-text-muted);
    }
    .compact-pip__num {
      font-size: 9px;
      line-height: 1;
      font-weight: var(--pd-weight-bold);
      color: inherit;
      unicode-bidi: isolate;
    }

    /* The one state vocabulary, in colour. Same tokens the full rows use, so the two densities cannot
       disagree about what "behind" looks like. The last group - unavailable, per-chapter and the honest
       "not known here" - all read as ABSENCE of a claim and are drawn as one hollow pip; what tells them
       apart is the pip's accessible name. */
    .compact-pip[data-state='ready'] { color: var(--pd-keep); border-color: currentColor; background: var(--pd-keep-bg); }
    .compact-pip[data-state='behind'] { color: var(--pd-improve); border-color: currentColor; background: var(--pd-improve-bg); }
    .compact-pip[data-state='running'] { color: var(--pd-info); border-color: currentColor; background: var(--pd-info-bg); }
    .compact-pip[data-state='blocked'] { color: var(--pd-secondary-700); border-color: var(--pd-secondary-300); background: var(--pd-secondary-50); }
    .compact-pip[data-state='not-started'] { color: var(--pd-primary-700); border-color: var(--pd-primary-200); background: var(--pd-primary-50); }
    .compact-pip[data-state='unavailable'],
    .compact-pip[data-state='per-chapter'],
    .compact-pip[data-state='unknown'] { border-style: dashed; border-color: var(--pd-neutral-300); background: transparent; }

    .compact-summary {
      margin: 0;
      flex: 1 1 auto;
      min-inline-size: 0;
      text-align: start;
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
      color: var(--pd-text-secondary);
      /* Compact never truncates either. It says less instead: exactly one stage name, in full. */
      white-space: normal;
      overflow-wrap: break-word;
    }

    /* Visually hidden but present for assistive technology. Local to this component so the compact spine
       carries its own full names wherever it is mounted. */
    .pd-visually-hidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
  `],
})
export class StageSpineComponent implements OnInit, OnChanges {
  /**
   * The book language. BOOK-SCOPED IN BOTH DENSITIES, which is the w3 language decision stated in one
   * place: the spine always speaks the language of the BOOK IT DESCRIBES, never the language of the
   * surface it is mounted on.
   *
   * The brief warns about a rule switch here - app-level chrome is Hebrew-default while the full spine is
   * book-scoped - and this is how that switch is resolved so a user never sees the spine flip languages
   * while navigating: the app-level Hebrew default governs the surface AROUND the compact spine (the books
   * list header, its buttons, its empty state, all unchanged), and the compact spine itself, which never
   * renders without a book, keeps following that book. A row for an English book therefore reads English
   * on the list and English again inside the book. The books list already does exactly this for the two
   * other per-book strings it renders - the title and the relative timestamp, which is passed `b.language`
   * today - so the compact spine is joining an established rule rather than inventing one.
   *
   * Null falls back to Hebrew, the primary language.
   */
  @Input() bookLanguage: string | null = null;

  /** Which density to draw. See {@link SpineDensity}. */
  @Input() density: SpineDensity = 'full';

  /**
   * Everything the spine renders from. Replaced wholesale by the host on every change.
   *
   * The default is the SHARED empty-signals factory rather than a literal: a local literal is how a copy of
   * this object eventually drifts from the real one (it already lacked `chapterCount`, and it pinned the
   * export build flag to a stale `false`).
   */
  @Input() signals: StageSpineSignals = emptyStageSpineSignals();

  /** A stage row's action was pressed. The host owns what each action actually does. */
  @Output() stageAction = new EventEmitter<StageActionEvent>();

  /** A chapter was picked out of stage 4's breakdown. The host opens it. */
  @Output() openChapter = new EventEmitter<ChapterPassSignal>();

  /** The derived stages, recomputed whenever the signals change. */
  stages: StageStatus[] = [];

  /** Whether stage 4's chapter list is expanded. */
  chaptersOpen = false;

  /**
   * The row the user explicitly opened or closed. `null` means "follow the focus stage", so a spine the
   * user has not touched always opens the row that wants something from them, and a spine the user HAS
   * touched stops moving under their hands when a status poll lands.
   */
  private userExpanded: SpineStageId | 'none' | null = null;

  /** The stage that opens by default: the first one in canonical order that wants something. */
  private focus: SpineStageId = 'import';

  // Template-visible copy constants (Angular templates cannot import).
  readonly SPINE_ARIA_LABEL = SPINE_ARIA_LABEL;
  readonly COMPACT_ARIA_LABEL = COMPACT_ARIA_LABEL;
  readonly DETAILS_TOGGLE_LABEL = DETAILS_TOGGLE_LABEL;
  readonly CHAPTER_RUNNING_LABEL = CHAPTER_RUNNING_LABEL;

  /**
   * Derived in BOTH lifecycle hooks on purpose. `ngOnChanges` covers every real binding, and `ngOnInit`
   * covers a host (or a spec) that assigned `signals` as a plain property before the first render, which
   * would otherwise leave the spine rendering five empty rows with no error.
   */
  ngOnInit(): void {
    this.recompute();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.recompute();
  }

  private recompute(): void {
    this.stages = deriveStageSpine(this.signals);
    this.focus = focusStageId(this.stages);
  }

  /** he unless the BOOK is English. */
  get lang(): SpineLang {
    return spineLang(this.bookLanguage);
  }

  /** Direction follows the book language: this is book-scoped chrome. MIRRORS. */
  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  /** Resolve a bilingual constant in the current book language. */
  text(bi: Record<SpineLang, string>): string {
    return bi[this.lang];
  }

  stageName(id: SpineStageId): string {
    return STAGE_NAMES[id][this.lang];
  }

  explanation(id: SpineStageId): string {
    return STAGE_EXPLANATION[id][this.lang];
  }

  /**
   * The row's `data-state`, which is BOTH the styling hook and what the specs assert on. It keeps the
   * two honest non-states distinct from the six real ones rather than flattening them into a token:
   * `unknown` (signals have not arrived) and `per-chapter` (stage 4 makes no book-level claim).
   */
  dataState(stage: StageStatus): string {
    if (stage.state) return stage.state;
    if (stage.unknown) return 'unknown';
    if (stage.perChapter) return 'per-chapter';
    return 'unknown';
  }

  /** The text in the state slot. Never invents a state for a stage that does not have one. */
  stateText(stage: StageStatus): string {
    if (stage.state) return STATE_LABELS[stage.state][this.lang];
    if (stage.perChapter) return PER_CHAPTER_LABEL[this.lang];
    return UNKNOWN_LABEL[this.lang];
  }

  blockedText(stage: StageStatus): string {
    return stage.blockedBy ? blockedSentence(stage.blockedBy, this.lang) : '';
  }

  /** Every `behind` reason the payload actually carries, or one truthful fallback when it names none. */
  behindLines(stage: StageStatus): string[] {
    if (!stage.behindReasons.length) return [BEHIND_FALLBACK[this.lang]];
    return stage.behindReasons.map(r => behindSentence(r, stage.behindMagnitude, this.lang));
  }

  magnitudeText(stage: StageStatus): string {
    return stage.behindMagnitude === null ? '' : behindMagnitudeLabel(stage.behindMagnitude, this.lang);
  }

  /**
   * Stage 1's detail line. `chaptersWithText` is passed THROUGH, null and all: a null is "not known yet"
   * and the copy layer answers it with no sentence. It used to be coalesced to 0 here, which rendered
   * "12 chapters exist, but none of them has any text yet" from a payload that had not said so.
   */
  importDetailText(stage: StageStatus): string | null {
    if (stage.id !== 'import' || stage.chapterCount === null) return null;
    return importDetail(stage.chapterCount, stage.chaptersWithText, this.lang);
  }

  /** Stage 5's detail line: chapters exist, but a file made from them right now would be empty. */
  exportDetailText(stage: StageStatus): string | null {
    if (stage.id !== 'export') return null;
    return exportNothingWrittenDetail(stage.chapterCount, stage.chaptersWithText, this.lang);
  }

  progressText(stage: StageStatus): string | null {
    return stage.id === 'review' ? findingsProgress(stage, this.lang) : null;
  }

  chapterToggleText(stage: StageStatus): string {
    return chapterListToggleLabel(stage.chapters?.length ?? 0, this.lang);
  }

  /** c07: the shared chapter-numbering convention. See {@link chapterDisplayNumber}. */
  chapterNumber(order: number): number {
    return chapterDisplayNumber(order);
  }

  actionText(stage: StageStatus): string {
    return actionLabel(stage, this.lang);
  }

  /** Which row is open: the user's explicit choice when there is one, else the focus stage. */
  isExpanded(id: SpineStageId): boolean {
    if (this.userExpanded === 'none') return false;
    return (this.userExpanded ?? this.focus) === id;
  }

  /** Open a row, or close it if it was already the open one. */
  toggle(id: SpineStageId): void {
    this.userExpanded = this.isExpanded(id) ? 'none' : id;
  }

  onAction(stage: StageStatus): void {
    if (!stage.action) return;
    this.stageAction.emit({ stage: stage.id, action: stage.action });
  }

  onChapterClick(chapter: ChapterPassSignal): void {
    this.openChapter.emit(chapter);
  }

  // ── COMPACT density ──────────────────────────────────────────────────────────────────────────────

  /**
   * The state word a pip announces. The `data-state` hook is shared with the full spine ({@link dataState}),
   * but what `unknown` MEANS differs by density and only the WORD may differ: in the full spine the signals
   * are still on their way, while the compact spine is mounted on surfaces where they are never coming, so
   * it says "not known here" rather than "loading". Neither ever guesses a state.
   */
  compactStateText(stage: StageStatus): string {
    if (stage.state) return STATE_LABELS[stage.state][this.lang];
    if (stage.perChapter) return PER_CHAPTER_LABEL[this.lang];
    return COMPACT_UNKNOWN_LABEL[this.lang];
  }

  /** One pip's accessible name: the stage's FULL name plus its state. Nothing is abbreviated here. */
  pipLabel(stage: StageStatus): string {
    return compactPipLabel(this.stageName(stage.id), this.compactStateText(stage));
  }

  /**
   * The compact spine's single line of visible text. A running stage wins, because carrying the running
   * signal on every route is this density's job (the two chrome dots retired into it); otherwise it is the
   * focus stage. Empty only before the first derivation, which cannot happen in a rendered view.
   */
  get compactSummary(): string {
    if (!this.stages.length) return '';
    const running = this.stages.find(s => s.state === 'running');
    const stage = running ?? this.stages.find(s => s.id === this.focus) ?? this.stages[0];
    return compactSummaryLine(
      this.stageName(stage.id),
      this.compactStateText(stage),
      stage.state === 'running',
      this.lang,
    );
  }
}
