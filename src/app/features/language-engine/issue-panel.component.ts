import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LanguageEngineService } from '../../core/services/language-engine.service';
import { LanguageIssue } from '../../core/models/language-engine';

/** Emitted when user applies a suggestion (range) or full rewrite. Editor uses this to replace content. */
export interface ApplyCorrectionEvent {
  text: string;
  startOffset?: number;
  endOffset?: number;
  /** Optional: original text that was replaced (for version label / display). */
  originalText?: string;
  /** Optional: analysis result id when applying a proofread suggestion (for version history / revert outcome). */
  analysisId?: string;
  /** When true, do not create a new document version (e.g. Redo re-applies an existing suggestion without adding another revert snapshot). */
  skipCreatingVersion?: boolean;
  /** Optional: stable id of the AnalysisSuggestion row that produced this correction (for linking document versions). */
  suggestionId?: string;
}

@Component({
  selector: 'app-issue-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="issue-panel">
      <header class="panel-header">
        <h3>{{ titleLabel }}</h3>
        <div class="header-actions">
          <!-- b2: the checker cannot work on Hebrew (LanguageToolEngine returns Issues=[] on its Hebrew
               branch by design), so a Hebrew book gets the note below instead of a button that does
               nothing and then explains itself. -->
          <button
            *ngIf="canDetect"
            type="button"
            class="pd-btn pd-btn-ghost"
            [disabled]="isDetecting"
            (click)="detectIssues()">
            {{ isDetecting ? detectingLabel : detectLabel }}
          </button>
          <button
            type="button"
            class="pd-btn pd-btn-ghost"
            [disabled]="!canRewrite || isRewriting"
            (click)="rewriteText()">
            {{ isRewriting ? rewritingLabel : rewriteLabel }}
          </button>
        </div>
      </header>

      <div class="service-unavailable-banner" *ngIf="serviceUnavailableMessage">
        <span class="banner-icon" aria-hidden="true">ℹ️</span>
        <p class="banner-text">{{ serviceUnavailableMessage }}</p>
      </div>

      <!-- b2: an HTTP failure used to be a console line only, so a 500 rendered exactly like
           "no issues found". It gets its own banner, distinct from the checker-unavailable one. -->
      <div class="request-error-banner" *ngIf="requestErrorMessage" role="alert">
        <span class="banner-icon" aria-hidden="true">⚠️</span>
        <p class="banner-text">{{ requestErrorMessage }}</p>
      </div>

      <section class="issues-section" *ngIf="issues.length > 0; else noIssues">
        <div class="issues-summary">
          <span class="pd-chip pd-chip-error" *ngIf="errorCount > 0">
            {{ errorChipLabel }}
          </span>
          <span class="pd-chip pd-chip-warn" *ngIf="warningCount > 0">
            {{ warningChipLabel }}
          </span>
          <span class="pd-chip" *ngIf="infoCount > 0">
            {{ infoChipLabel }}
          </span>
        </div>

        <div class="issues-list">
          <div
            *ngFor="let issue of issues; let i = index"
            class="issue-item"
            [class.error]="issue.severity === 'error'"
            [class.warning]="issue.severity === 'warning'"
            [class.info]="issue.severity === 'info'">
            <div class="issue-header">
              <span class="issue-category">{{ issue.category }}</span>
              <span class="issue-offset">[{{ issue.startOffset }}-{{ issue.endOffset }}]</span>
              <span class="issue-confidence" *ngIf="issue.confidence < 0.9">
                {{ (issue.confidence * 100).toFixed(0) }}% confidence
              </span>
            </div>
            <div class="issue-message">{{ issue.message }}</div>
            <div class="issue-suggestions" *ngIf="issue.suggestions.length > 0">
              <span class="suggestions-label">{{ suggestionsLabel }}</span>
              <button
                *ngFor="let suggestion of issue.suggestions.slice(0, 10)"
                type="button"
                class="suggestion-btn"
                (click)="applySuggestion(issue, suggestion)">
                {{ suggestion }}
              </button>
              <span class="suggestions-more" *ngIf="issue.suggestions.length > 10">
                {{ moreLabel(issue.suggestions.length - 10) }}
              </span>
            </div>
            <div class="issue-actions">
              <button
                type="button"
                class="pd-btn pd-btn-link"
                (click)="highlightIssue(issue)">
                {{ highlightLabel }}
              </button>
              <button
                type="button"
                class="pd-btn pd-btn-link"
                (click)="dismissIssue(i)">
                {{ dismissLabel }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <ng-template #noIssues>
        <div class="no-issues pd-empty">
          <!-- f01: AT MOST ONE line renders, and WHICH one is decided in ONE place
               ({@link emptyStateLine}) rather than by three independent *ngIf conjunctions. Three
               conjunctions are how the previous partial fix shipped: the clean line was gated against
               the unavailable banner and NOT against the request-error banner, so an English chapter
               that had already loaded clean and then failed a Detect said "No issues detected. Great!"
               directly under "The language check failed". A getter with a total order cannot leave a
               cell of that cross product open. -->
          <p *ngIf="emptyStateLine === 'unsupported'" class="detect-unsupported-note">{{ detectUnsupportedNote }}</p>
          <p *ngIf="emptyStateLine === 'prompt'" class="detect-prompt">{{ emptyPromptLabel }}</p>
          <p *ngIf="emptyStateLine === 'clean'" class="no-issues-clean">{{ emptyCleanLabel }}</p>
        </div>
      </ng-template>

      <section class="rewrite-section" *ngIf="rewrittenText">
        <h4>{{ rewrittenTextLabel }}</h4>
        <div class="rewrite-preview">{{ rewrittenText }}</div>
        <div class="rewrite-actions">
          <button
            type="button"
            class="pd-btn pd-btn-primary"
            (click)="applyRewrite()">
            {{ applyRewriteLabel }}
          </button>
          <button
            type="button"
            class="pd-btn pd-btn-ghost"
            (click)="dismissRewrite()">
            {{ dismissLabel }}
          </button>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .issue-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: var(--pd-space-4);
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pd-space-3);
      margin-block-end: var(--pd-space-2);
    }
    .panel-header h3 {
      margin: 0;
      font-size: var(--pd-text-h5);
      font-weight: var(--pd-weight-bold);
    }
    .header-actions {
      display: flex;
      gap: var(--pd-space-2);
    }
    .issues-section {
      flex: 1;
      min-block-size: 0;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
    }
    .issues-summary {
      display: flex;
      gap: var(--pd-space-3);
      flex-wrap: wrap;
    }
    .issues-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
    }
    .issue-item {
      padding: var(--pd-space-3);
      border-radius: var(--pd-radius-md);
      border: 1px solid var(--pd-border);
      background: var(--pd-surface);
    }
    .issue-item.error {
      border-inline-start: 3px solid var(--pd-sev-high);
    }
    .issue-item.warning {
      border-inline-start: 3px solid var(--pd-sev-med);
    }
    .issue-item.info {
      border-inline-start: 3px solid var(--pd-primary-400);
    }
    .issue-header {
      display: flex;
      gap: var(--pd-space-3);
      align-items: center;
      margin-block-end: var(--pd-space-2);
      font-size: var(--pd-text-caption);
    }
    .issue-category {
      font-weight: var(--pd-weight-bold);
      text-transform: capitalize;
    }
    .issue-offset {
      color: var(--pd-text-secondary);
      font-family: var(--pd-font-mono);
    }
    .issue-confidence {
      color: var(--pd-text-muted);
      font-size: var(--pd-text-caption);
    }
    .issue-message {
      margin-block-end: var(--pd-space-2);
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
    }
    .issue-suggestions {
      margin-block-end: var(--pd-space-2);
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-2);
      align-items: center;
    }
    .suggestions-label {
      font-size: var(--pd-text-caption);
      color: var(--pd-text-secondary);
    }
    .suggestion-btn {
      padding: var(--pd-space-1) var(--pd-space-3);
      border-radius: var(--pd-radius-sm);
      border: 1px solid var(--pd-primary-300);
      background: var(--pd-surface);
      color: var(--pd-primary-600);
      cursor: pointer;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      transition: background var(--pd-dur-fast) var(--pd-ease);
    }
    .suggestion-btn:hover {
      background: var(--pd-primary-50);
    }
    .suggestions-more {
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
    }
    .issue-actions {
      display: flex;
      gap: var(--pd-space-3);
      margin-block-start: var(--pd-space-2);
    }
    .no-issues {
      padding: var(--pd-space-5);
      text-align: center;
    }
    .rewrite-section {
      border-block-start: 1px solid var(--pd-divider);
      padding-block-start: var(--pd-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
    }
    .rewrite-section h4 {
      margin: 0;
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-bold);
    }
    .rewrite-preview {
      padding: var(--pd-space-3);
      border-radius: var(--pd-radius-md);
      border: 1px solid var(--pd-border);
      background: var(--pd-surface-sunken);
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
      max-block-size: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .rewrite-actions {
      display: flex;
      gap: var(--pd-space-3);
    }
    .service-unavailable-banner {
      display: flex;
      align-items: flex-start;
      gap: var(--pd-space-3);
      padding: var(--pd-space-3) var(--pd-space-4);
      border-radius: var(--pd-radius-md);
      background: var(--pd-info-bg);
      border: 1px solid var(--pd-primary-100);
      font-size: var(--pd-text-body-sm);
    }
    .request-error-banner {
      display: flex;
      align-items: flex-start;
      gap: var(--pd-space-3);
      padding: var(--pd-space-3) var(--pd-space-4);
      border-radius: var(--pd-radius-md);
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-sev-high);
      font-size: var(--pd-text-body-sm);
    }
    .banner-icon { font-size: var(--pd-text-body); }
    .banner-text {
      margin: 0;
      color: var(--pd-primary-900);
      line-height: var(--pd-lh-body-sm);
    }
    .request-error-banner .banner-text { color: var(--pd-text); }
    .detect-unsupported-note {
      margin: 0;
      line-height: var(--pd-lh-body-sm);
    }
  `]
})
export class IssuePanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() bookId?: string;
  @Input() chapterId?: string;
  /** Book-scoped chrome language: Hebrew default, English only for an English book. */
  @Input() bookLanguage: string | null = null;
  @Output() issueHighlighted = new EventEmitter<LanguageIssue>();
  @Output() rewriteApplied = new EventEmitter<ApplyCorrectionEvent>();

  /** Chrome language: 'he' default, 'en' only for an English book (mirrors analysis-panel/history idiom). */
  get langKey(): 'he' | 'en' {
    return (this.bookLanguage?.trim().toLowerCase() || 'he').startsWith('en') ? 'en' : 'he';
  }

  /**
   * b2: whether the "Detect issues" affordance is offered at all.
   *
   * FALSE for a Hebrew book, because the feature cannot work there: `LanguageToolEngine`'s Hebrew branch
   * returns `Issues = []` with a service-unavailable reason BY DESIGN (no Hebrew LanguageTool server is
   * deployed), so the button ran, found nothing, and then explained itself in the server's English. The
   * note that replaces it says the same thing once, in the reader's language.
   *
   * NOTE THE AXIS: this is the BOOK's language (the `bookLanguage` @Input the editor binds from
   * `book.language`), not the chapter's detected text language. An English book whose chapter happens to
   * hold Hebrew still gets the button, and the server's `hebrew-unsupported` code then explains the empty
   * result through the map below.
   */
  get canDetect(): boolean {
    return this.langKey !== 'he';
  }

  // ---- Localized chrome strings (he/en parity). -----------------------------
  // DRAFT Hebrew - flag for native-speaker review before sign-off.
  get titleLabel(): string { return this.langKey === 'he' ? 'בעיות שפה' : 'Language Issues'; }
  /**
   * b2 KEPT DELIBERATELY, THOUGH THE HEBREW HALF IS CURRENTLY UNREACHABLE. `canDetect` is false for a
   * Hebrew book, so `detectLabel` / `detectingLabel` / `emptyPromptLabel` / `emptyCleanLabel` only ever
   * render their `en` arm today. The gate is a fact about the deployed checker, not about the product:
   * the day a Hebrew LanguageTool server exists, `canDetect` flips and these strings render again.
   * Deleting the Hebrew arms now would turn that flip into a silent English regression.
   */
  get detectLabel(): string { return this.langKey === 'he' ? 'אתר בעיות' : 'Detect Issues'; }
  get detectingLabel(): string { return this.langKey === 'he' ? 'מאתר...' : 'Detecting...'; }
  get rewriteLabel(): string { return this.langKey === 'he' ? 'שכתב' : 'Rewrite'; }
  get rewritingLabel(): string { return this.langKey === 'he' ? 'משכתב...' : 'Rewriting...'; }
  get suggestionsLabel(): string { return this.langKey === 'he' ? 'הצעות:' : 'Suggestions:'; }
  get highlightLabel(): string { return this.langKey === 'he' ? 'הדגש' : 'Highlight'; }
  get dismissLabel(): string { return this.langKey === 'he' ? 'התעלם' : 'Dismiss'; }
  get rewrittenTextLabel(): string { return this.langKey === 'he' ? 'טקסט משוכתב' : 'Rewritten Text'; }
  get applyRewriteLabel(): string { return this.langKey === 'he' ? 'החל שכתוב' : 'Apply Rewrite'; }
  get emptyPromptLabel(): string {
    return this.langKey === 'he'
      ? 'לחצו על "אתר בעיות" כדי לבדוק בעיות שפה.'
      : 'Click "Detect Issues" to check for language issues.';
  }
  get emptyCleanLabel(): string {
    return this.langKey === 'he' ? 'לא נמצאו בעיות. מצוין!' : 'No issues detected. Great!';
  }

  /** Count chips: natural Hebrew plural (no trailing English 's'); Hebrew has no singular/plural noun form switch here. */
  get errorChipLabel(): string {
    return this.langKey === 'he'
      ? `${this.errorCount} שגיאות`
      : `${this.errorCount} error${this.errorCount !== 1 ? 's' : ''}`;
  }
  get warningChipLabel(): string {
    return this.langKey === 'he'
      ? `${this.warningCount} אזהרות`
      : `${this.warningCount} warning${this.warningCount !== 1 ? 's' : ''}`;
  }
  get infoChipLabel(): string {
    return this.langKey === 'he' ? `${this.infoCount} מידע` : `${this.infoCount} info`;
  }

  /** "+ N more" suggestions overflow. */
  moreLabel(n: number): string {
    return this.langKey === 'he' ? `+ ${n} נוספות` : `+ ${n} more`;
  }

  /** Fallback copy when the language checker (e.g. LanguageTool) is unavailable. */
  get serviceUnavailableFallback(): string {
    return this.langKey === 'he' ? 'בודק השפה אינו זמין.' : 'The language checker is not available.';
  }

  /**
   * The note that stands in for the detect button on a Hebrew book. DRAFT he - needs native review.
   * It points at the pass that DOES handle Hebrew rather than leaving the reader with a dead end.
   */
  get detectUnsupportedNote(): string {
    return this.langKey === 'he'
      ? 'בודק השפה האוטומטי אינו תומך בעברית, ולכן איתור בעיות אינו זמין בספר הזה. להגהה בעברית אפשר להריץ את מעבר "הגהה" בלשונית "ניתוח".'
      : 'The automatic language checker does not support Hebrew, so issue detection is not available for this book. For Hebrew, run the Proofread pass in the Analysis tab.';
  }

  /** Localized banner for an HTTP failure (a 500 used to be indistinguishable from "no issues found"). */
  get requestFailedLabel(): string {
    return this.langKey === 'he'
      ? 'בדיקת השפה נכשלה. אפשר לנסות שוב.' // DRAFT he - needs native review
      : 'The language check failed. Please try again.';
  }

  /**
   * b2: code -> localized sentence, keyed on `LanguageToolEngine.ServiceUnavailableCode`.
   *
   * The four keys are the API's whole vocabulary (`hebrew-unsupported`, `disabled`, `unavailable`,
   * `timeout`). ANY other value - and a legacy payload that carries only the English
   * `languageToolMessage` and no code at all - falls back to {@link serviceUnavailableFallback}, which is
   * why this ships whether or not the API half is deployed. The server's own sentence is never rendered:
   * it is English, and this panel is Hebrew by default.
   * DRAFT he on all four - needs native review.
   */
  private static readonly UNAVAILABLE_COPY: Readonly<Record<string, { he: string; en: string }>> = {
    'hebrew-unsupported': {
      he: 'בודק השפה אינו תומך בעברית, ולכן הטקסט הזה לא נבדק.',
      en: 'The language checker does not support Hebrew, so this text was not checked.',
    },
    disabled: {
      he: 'בודק השפה כבוי בהגדרות השרת.',
      en: 'The language checker is turned off in the server settings.',
    },
    unavailable: {
      he: 'בודק השפה אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.',
      en: 'The language checker is not available right now. Please try again later.',
    },
    timeout: {
      he: 'בודק השפה לא הגיב בזמן. אפשר לנסות שוב.',
      en: 'The language checker did not respond in time. Please try again.',
    },
  };

  /** Resolve an unavailable reason to localized copy, falling back for an unknown or absent code. */
  unavailableCopyFor(code: string | null | undefined): string {
    const entry = code ? IssuePanelComponent.UNAVAILABLE_COPY[code] : undefined;
    return entry ? entry[this.langKey] : this.serviceUnavailableFallback;
  }

  issues: LanguageIssue[] = [];
  rewrittenText?: string;
  isDetecting = false;
  isRewriting = false;
  hasDetected = false;
  /** Shown when the language checker (e.g. LanguageTool) is unavailable. */
  serviceUnavailableMessage: string | null = null;
  /** Shown when the request itself failed (network / 5xx), distinct from a checker that answered. */
  requestErrorMessage: string | null = null;

  /**
   * f01: WHICH empty-state line renders, as ONE total function of the panel's state.
   *
   * The empty state is a cross product of {he, en} x {not-yet-detected, detected-clean,
   * detected-with-issues} x {no banner, unavailable banner, request-error banner}, and the previous
   * three-*ngIf form left one of its cells rendering two contradictory statements at once. Deciding it
   * here makes "exactly one line, or none" a property of the code instead of an invariant three
   * separate conjunctions have to agree on. The order below IS the rule:
   *
   *  1. `unsupported` - the checker cannot work on this book at all, so the capability note stands in
   *     for the button that is not there. This outranks everything else because it is a fact about the
   *     deployment, not a claim about the text or about one request.
   *  2. `none` - A BANNER IS SPEAKING, and a banner is the only statement in its cell. Both banners say
   *     the text was NOT checked (the checker was unavailable, or the request never answered), so no
   *     line about the text may sit under either one - neither the clean claim ("No issues detected")
   *     nor the prompt, which would invite a second press while the failure is still on screen.
   *  3. `clean` / `prompt` - the ordinary two states: the checker ran and found nothing, or it has not
   *     run yet.
   *
   * `detected-with-issues` never reaches here at all: the template renders the issue list instead of
   * this block whenever `issues.length > 0`.
   */
  get emptyStateLine(): 'unsupported' | 'prompt' | 'clean' | 'none' {
    if (!this.canDetect) return 'unsupported';
    if (this.requestErrorMessage || this.serviceUnavailableMessage) return 'none';
    return this.hasDetected ? 'clean' : 'prompt';
  }

  get errorCount(): number {
    return this.issues.filter(i => i.severity === 'error').length;
  }

  get warningCount(): number {
    return this.issues.filter(i => i.severity === 'warning').length;
  }

  get infoCount(): number {
    return this.issues.filter(i => i.severity === 'info').length;
  }

  get canRewrite(): boolean {
    return this.issues.length > 0 && !this.isDetecting;
  }

  /**
   * c03: the (bookId, chapterId) tuple a request was issued FOR, captured at issue time.
   *
   * Every response handler compares this against the panel's live tuple before touching anything. The
   * offsets in an issue are indexes into ONE chapter's text, and `applySuggestion` emits them straight
   * to the editor, so a response that lands after the reader has moved on must not be allowed to set
   * `issues` - the editor would apply chapter A's range into chapter B's document.
   */
  private requestKeyFor(bookId?: string, chapterId?: string): string {
    return `${bookId ?? ''}||${chapterId ?? ''}`;
  }

  private get currentRequestKey(): string {
    return this.requestKeyFor(this.bookId, this.chapterId);
  }

  /**
   * c03: THE ONE in-flight issue fetch, GET or detect.
   *
   * Both kinds write the same three fields (`issues`, `hasDetected`, the banners), so a second fetch of
   * EITHER kind supersedes the first rather than racing it: the stale-context guard alone cannot settle
   * two requests for the SAME key resolving out of order, and there the older, slower one wins.
   */
  private inFlightFetch?: Subscription;
  /** c03: same rule for the rewrite call, which owns `rewrittenText` and the `isRewriting` latch. */
  private inFlightRewrite?: Subscription;

  /**
   * c03: drop the in-flight fetch AND LOWER ITS LATCH IN THE SAME PLACE.
   *
   * Unsubscribing destroys the handlers that would have lowered `isDetecting`, and a stranded
   * `isDetecting` disables the Detect button for the rest of the panel's life. So the cancel point owns
   * the latch: whoever cancels leaves the spinner down, and a caller that is about to issue its own
   * request raises it again immediately afterwards.
   */
  private cancelInFlightFetch(): void {
    this.inFlightFetch?.unsubscribe();
    this.inFlightFetch = undefined;
    this.isDetecting = false;
  }

  /** c03: the rewrite counterpart, with its own latch lowered at the same cancel point. */
  private cancelInFlightRewrite(): void {
    this.inFlightRewrite?.unsubscribe();
    this.inFlightRewrite = undefined;
    this.isRewriting = false;
  }

  constructor(private languageEngineService: LanguageEngineService) {}

  ngOnInit(): void {
    if (this.bookId && this.chapterId) {
      this.loadIssues();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['chapterId']) {
      // c03: cancel BEFORE resetting, so the abandoned request cannot write into the new context even
      // if its handler had already been queued. Both cancels lower their own latch, which is what keeps
      // a chapter switch during a detect from stranding the button at "Detecting...".
      this.cancelInFlightFetch();
      this.cancelInFlightRewrite();
      this.issues = [];
      this.rewrittenText = undefined;
      this.hasDetected = false;
      this.serviceUnavailableMessage = null;
      this.requestErrorMessage = null;
      if (this.bookId && this.chapterId) {
        this.loadIssues();
      }
    }
  }

  /** c03: a panel torn down mid-request must not keep a live subscription writing into a dead view. */
  ngOnDestroy(): void {
    this.cancelInFlightFetch();
    this.cancelInFlightRewrite();
  }

  /**
   * Set (or clear) the checker-unavailable banner from a response.
   *
   * SUPPRESSED ENTIRELY FOR A HEBREW BOOK: there, "the checker produced nothing" is the expected,
   * permanent state that {@link detectUnsupportedNote} already states once, and an expected absence is
   * not an outage to banner about.
   */
  private applyUnavailable(unavailable: unknown, code: unknown): void {
    if (!unavailable || !this.canDetect) {
      this.serviceUnavailableMessage = null;
      return;
    }
    this.serviceUnavailableMessage = this.unavailableCopyFor(typeof code === 'string' ? code : null);
  }

  /**
   * f02: THE RULE FOR A FAILED FETCH, and it is one rule for BOTH fetch paths.
   *
   * A failure CLEARS THE PREVIOUS RESULT and leaves the failure banner as the only statement:
   *
   *  - `issues` goes empty, because a list the panel cannot refresh is still rendered as though it
   *     described the text now in the editor, and `applySuggestion` emits its `startOffset`/`endOffset`
   *     straight to the editor. A suggestion list whose offsets may no longer match the document is a
   *     shape this workspace has already paid for; the failure is the moment to drop it.
   *  - `hasDetected` goes false, because it is the panel's "the checker has answered for this text"
   *     flag and a failed request is not an answer.
   *  - `serviceUnavailableMessage` is cleared, because otherwise a previous unavailable banner STACKS
   *     with this one and the panel says "the checker is unavailable" and "the check failed" at once.
   *     Exactly one banner describes the last thing that happened.
   *
   * Both error handlers call THIS, so they cannot drift apart: the two-error-handler pair is the sibling
   * shape where fixing one and leaving the other is the recorded failure.
   */
  private applyRequestFailure(): void {
    this.issues = [];
    this.hasDetected = false;
    this.serviceUnavailableMessage = null;
    // b2: was a console line, which left a 5xx looking exactly like "no issues found".
    this.requestErrorMessage = this.requestFailedLabel;
  }

  loadIssues(): void {
    if (!this.bookId || !this.chapterId) return;

    const key = this.currentRequestKey;
    this.cancelInFlightFetch();
    this.requestErrorMessage = null;
    this.inFlightFetch = this.languageEngineService.getIssues(this.bookId, this.chapterId).subscribe({
      next: (res) => {
        // c03: THE GUARD RUNS FIRST, before any flag is set or cleared. A stale response must be a
        // complete no-op, not a partial write.
        if (key !== this.currentRequestKey) return;
        this.issues = res.issues;
        this.hasDetected = true;
        this.applyUnavailable(res.languageToolUnavailable, res.languageToolCode);
      },
      error: () => {
        // c03: guard first here TOO - a stale failure must not banner over the current chapter, which
        // is fine to leave as it is. The latch is already down (this path never raised it, and a
        // context change lowered whatever was up at `cancelInFlightFetch`).
        if (key !== this.currentRequestKey) return;
        this.applyRequestFailure();
      }
    });
  }

  detectIssues(): void {
    if (!this.bookId || !this.chapterId || this.isDetecting || !this.canDetect) return;

    const key = this.currentRequestKey;
    // c03: supersede any fetch already running for this chapter (an auto GET from mount can still be
    // open when the reader presses Detect, and it writes the same fields). This lowers `isDetecting`,
    // so raise it AFTER the cancel, never before.
    this.cancelInFlightFetch();
    this.isDetecting = true;
    this.requestErrorMessage = null;
    this.inFlightFetch = this.languageEngineService.detectIssues(this.bookId, this.chapterId).subscribe({
      next: (result) => {
        if (key !== this.currentRequestKey) return;
        this.issues = result.issues;
        this.hasDetected = true;
        this.isDetecting = false;
        this.applyUnavailable(
          result.metadata?.['languageToolUnavailable'],
          result.metadata?.['languageToolCode']
        );
      },
      error: () => {
        // c03: guard first, THEN lower the latch. The early return does not strand it: the only way to
        // get here stale is a context change, and `ngOnChanges` lowered it at the cancel point.
        if (key !== this.currentRequestKey) return;
        this.isDetecting = false;
        this.applyRequestFailure();
      }
    });
  }

  /**
   * c03 EXTENDS TO REWRITE, which is the same defect in the same file: `rewrittenText` is offered to the
   * reader as a replacement for the chapter now open, and `applyRewrite` emits it as a full-text
   * correction, so chapter A's rewrite landing after a switch to B would offer to overwrite B.
   */
  rewriteText(): void {
    if (!this.bookId || !this.chapterId || this.isRewriting || !this.canRewrite) return;

    const key = this.currentRequestKey;
    this.cancelInFlightRewrite();
    this.isRewriting = true;
    this.inFlightRewrite = this.languageEngineService.rewriteText(this.bookId, this.chapterId).subscribe({
      next: (result) => {
        if (key !== this.currentRequestKey) return;
        this.rewrittenText = result.rewrittenText;
        this.isRewriting = false;
      },
      error: (err) => {
        if (key !== this.currentRequestKey) return;
        console.error('Failed to rewrite text', err);
        this.isRewriting = false;
      }
    });
  }

  applySuggestion(issue: LanguageIssue, suggestion: string): void {
    this.rewriteApplied.emit({
      text: suggestion,
      startOffset: issue.startOffset,
      endOffset: issue.endOffset
    });
  }

  highlightIssue(issue: LanguageIssue): void {
    this.issueHighlighted.emit(issue);
  }

  dismissIssue(index: number): void {
    this.issues = this.issues.filter((_, i) => i !== index);
  }

  applyRewrite(): void {
    if (this.rewrittenText) {
      this.rewriteApplied.emit({ text: this.rewrittenText });
      this.rewrittenText = undefined;
    }
  }

  dismissRewrite(): void {
    this.rewrittenText = undefined;
  }
}
