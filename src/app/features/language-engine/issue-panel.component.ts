import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LanguageEngineService } from '../../core/services/language-engine.service';
import { LanguageIssue } from '../../core/models/language-engine';
import { resolveCardLang } from '../analysis-panel/card-lang';

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
          <!-- b2: on the deployment that exists, the checker cannot work on Hebrew, so a Hebrew book
               gets the note below instead of a button that does nothing and then explains itself.
               be-c02 CORRECTED THE REASON: this used to say "LanguageToolEngine returns Issues=[] on its
               Hebrew branch by design", which the engine does not do. It has FOUR Hebrew outcomes, and
               only two are empty - see {@link canDetect} for the list and for why the hidden button
               stays keyed on the book's language anyway. -->
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

  /**
   * Chrome language: 'he' default, 'en' only for an English book.
   *
   * P3-36: routed through the shared `resolveCardLang` (card-lang.ts) instead of a local
   * re-implementation of the same startsWith('en') rule, so this panel cannot drift from every other
   * card-lang consumer (analysis-panel's suggestion cards). No result DTO exists at this call site, so
   * only the book language is passed. `resolveCardLang` itself was missing the `.trim()` this local
   * getter had (only `.toLowerCase()`), so a padded tag like ' En-US ' would have landed in the Hebrew
   * branch with no hint anything was wrong - exactly the failure mode this nit was written to close.
   * Fixed at the shared function (card-lang.ts) rather than worked around here, so every consumer gets
   * the fix, not just this one; caught by this file's own existing padded-tag spec.
   */
  get langKey(): 'he' | 'en' {
    return resolveCardLang(null, this.bookLanguage);
  }

  /**
   * b2: whether the "Detect issues" affordance is offered at all.
   *
   * FALSE for a Hebrew book, because the feature cannot work on THE DEPLOYMENT THAT EXISTS: the button
   * ran, found nothing, and then explained itself in the server's English. The note that replaces it says
   * the same thing once, in the reader's language.
   *
   * be-c02 CORRECTED THE REASON THIS GIVES. It used to say `LanguageToolEngine`'s Hebrew branch "returns
   * `Issues = []` with a service-unavailable reason BY DESIGN", and the engine does no such thing. A
   * Hebrew chapter has FOUR outcomes and only two are empty: a server that ACCEPTS `language=he` returns
   * real issues with no unavailability at all; a `400` whose `language=auto` retry SUCCEEDS returns that
   * run's real matches WITH `unavailable: true` and no code; a `400` whose retry fails returns `[]` with
   * `hebrew-unsupported`; and the checker being off / unreachable / timed out returns `[]` with its own
   * code. So "cannot work on Hebrew" is a fact about which LanguageTool server is deployed, not about the
   * language.
   *
   * IT IS STILL KEYED ON THE BOOK LANGUAGE ON PURPOSE, and be-c02 is where that was decided rather than
   * assumed (investigation in `.cursor/plans/post-chatbot-fixes-fixes-2026-08-18.plan.md`): upstream
   * LanguageTool ships no Hebrew module, no image or compose file in either repo starts one, and
   * `appsettings.Production.json` carries no `LanguageEngine` section at all, so no Hebrew-capable server
   * exists to be detected. Keying this on the server's own answer instead (the `languageToolCode` the GET
   * already returns) is cheap and needs NO new endpoint or config key - it is the change to make in the
   * same commit that first stands such a server up, and it was deliberately not made before then, because
   * until then it is neither observable nor verifiable.
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
   * b2 KEPT DELIBERATELY, AND NOTHING IN THE DEPLOYMENT WILL EVER MAKE THEM RENDER.
   *
   * `canDetect` is false for a Hebrew book, so `detectLabel` / `detectingLabel` / `emptyPromptLabel` /
   * `emptyCleanLabel` only ever render their `en` arm today.
   *
   * c13 CORRECTED THE REASON GIVEN HERE. This note used to say "the day a Hebrew LanguageTool server
   * exists, `canDetect` flips and these strings render again". IT DOES NOT AND CANNOT: {@link canDetect}
   * is `langKey !== 'he'` and nothing else, and `langKey` reads the BOOK's language. No server
   * capability, no config flag and no response field reaches this getter, so standing a Hebrew
   * LanguageTool server up would change nothing here - the strings would stay dark and this note would
   * go on reading as a plan that was already true. What WOULD make them render is a CODE change to
   * {@link canDetect}: keying it on a capability the server reports (a `hebrew-unsupported` code
   * arriving, or its absence) instead of on the book's language. `be-c02` is the todo that owns that
   * decision, because it may replace this whole `canDetect`-off-`langKey` design outright. Deleting the
   * Hebrew arms before then would turn that change into a silent English regression, which is why they
   * stay - but they stay as CODE FOR A FUTURE DESIGN, not as strings waiting on an ops task.
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
   * These four keys (`hebrew-unsupported`, `disabled`, `unavailable`, `timeout`) are NOT the API's whole
   * vocabulary, the same correction f08 made to `languageToolCode`'s doc in `core/models/language-engine.ts`:
   * `LanguageToolEngine.cs` has a FIFTH `ServiceUnavailable = true` path (the `he` auto-retry-SUCCESS
   * branch) that carries no code at all. ANY other value - that fifth path included, and a legacy payload
   * that carries only the English `languageToolMessage` and no code at all - falls back to
   * {@link serviceUnavailableFallback}, which is why this ships whether or not the API half is deployed.
   * The server's own sentence is never rendered: it is English, and this panel is Hebrew by default.
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

  /** The one code that names the EXPECTED absence on a Hebrew book. Mirrors `LanguageToolEngine.Codes.HebrewUnsupported`. */
  private static readonly HEBREW_UNSUPPORTED_CODE = 'hebrew-unsupported';

  /**
   * c13: the LEGACY (code-less) spelling of that same expected absence.
   *
   * An API build that predates `languageToolCode` sends only the English `languageToolMessage`, and on
   * the Hebrew branch that sentence is "The language checker doesn't support Hebrew. Use a LanguageTool
   * server with Hebrew support ...". This matches a NEGATED "support Hebrew" and nothing else, because
   * the whole point of the scoping is that a message which does not say that is a REAL outage and must
   * banner. Deliberately narrow: the three other legacy sentences ("is turned off in settings", "isn't
   * available right now", "took too long to respond") must all fall through to the banner, and so must
   * the API's fifth ServiceUnavailable path ("Checked using auto-detected language (requested language
   * isn't supported by this server).") - that one names no language, the check actually RAN, and telling
   * it apart from an outage is `be-c02`'s job, not a substring's.
   */
  private static readonly LEGACY_HEBREW_UNSUPPORTED_MESSAGE =
    /(?:does\s+not|doesn.?t|cannot|can\s*not|can.?t|no)\s+support\s+hebrew/i;

  /**
   * c13: is this absence the EXPECTED one on this book, i.e. the one {@link detectUnsupportedNote}
   * already states permanently?
   *
   * THIS IS THE WHOLE SCOPING RULE, and it replaces a bare `!canDetect`. Keying suppression on the book
   * language alone swallowed all four codes and the code-less case, so a Hebrew book whose checker was
   * switched off, unreachable or timing out said only "the automatic language checker does not support
   * Hebrew" - a confident, WRONG explanation of a real outage, with the outage itself invisible. The
   * asymmetry was the tell: the identical response put a banner on an English book and nothing at all on
   * a Hebrew one.
   *
   * Three clauses, in order:
   *  1. `canDetect` true (an English book) - NOTHING is expected there. That book carries no standing
   *     note, so every reason it gets, including `hebrew-unsupported` for an English book whose chapter
   *     holds Hebrew text, is news and banners.
   *  2. A code that is present and is NOT `hebrew-unsupported` - a real, named reason. Banner it, in the
   *     reader's language.
   *  3. No code at all - fall back to the message, and ONLY the legacy Hebrew-unsupported sentence
   *     counts. Anything else (including a message that is absent entirely) is treated as an outage,
   *     which is the safe direction: an over-reported outage is visible and correctable, a swallowed one
   *     is not.
   */
  private isExpectedAbsence(code: unknown, message: unknown): boolean {
    if (this.canDetect) return false;
    if (typeof code === 'string' && code.length > 0) {
      return code === IssuePanelComponent.HEBREW_UNSUPPORTED_CODE;
    }
    return typeof message === 'string'
      && IssuePanelComponent.LEGACY_HEBREW_UNSUPPORTED_MESSAGE.test(message);
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
   *  1. `none` - A BANNER IS SPEAKING, and a banner is the only statement in its cell. Both banners say
   *     the text was NOT checked (the checker was unavailable, or the request never answered), so no
   *     line about the text may sit under either one - neither the clean claim ("No issues detected")
   *     nor the prompt, which would invite a second press while the failure is still on screen, nor the
   *     capability note.
   *  2. `unsupported` - the checker cannot work on this book at all, so the capability note stands in
   *     for the button that is not there.
   *  3. `clean` / `prompt` - the ordinary two states: the checker ran and found nothing, or it has not
   *     run yet.
   *
   * final-r03: 1 AND 2 WERE THE OTHER WAY ROUND, AND c13 IS WHAT MADE THAT WRONG. The `unsupported` arm
   * outranked the banners on the stated ground that it "is a fact about the deployment, not a claim
   * about one request" - true while `!canDetect` meant the checker had nothing to say about this book,
   * which is what it meant before c13. c13 scoped the Hebrew suppression to the EXPECTED absence so a
   * genuine outage (`timeout` / `disabled` / `unavailable`) now reaches a Hebrew book as a banner, and
   * `!canDetect` is still true for that book - so the standing "does not support Hebrew" note printed
   * underneath the outage banner and told the reader the failure was expected and not worth retrying.
   * Two statements in one cell, which is the exact defect this getter was written to make impossible,
   * arriving through c13's own fix. The banner outranks the note: an outage is a fact about THIS request
   * and it is the one the reader can act on. The `hebrew-unsupported` cell is unaffected, because c13
   * leaves it with no banner at all, so it still falls through to the note.
   *
   * `detected-with-issues` never reaches here at all: the template renders the issue list instead of
   * this block whenever `issues.length > 0`.
   */
  get emptyStateLine(): 'unsupported' | 'prompt' | 'clean' | 'none' {
    if (this.requestErrorMessage || this.serviceUnavailableMessage) return 'none';
    if (!this.canDetect) return 'unsupported';
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
   * SUPPRESSED FOR THE EXPECTED ABSENCE, NOT FOR A WHOLE LANGUAGE. On a Hebrew book "the checker does
   * not support Hebrew" is the permanent state {@link detectUnsupportedNote} already states once, so
   * repeating it in a banner would be the panel saying one thing twice. Every OTHER reason - switched
   * off, unreachable, timed out, or a reason this build does not recognize - is an event, it is news to
   * the reader, and it banners in the reader's language. {@link isExpectedAbsence} is the rule.
   *
   * The `message` argument exists only for the code-less legacy payload; it is never rendered (it is the
   * server's English, which is what bug 3 was), it is only READ, to tell the legacy spelling of the
   * expected absence apart from the legacy spelling of an outage.
   */
  private applyUnavailable(unavailable: unknown, code: unknown, message: unknown): void {
    if (!unavailable || this.isExpectedAbsence(code, message)) {
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

  /**
   * P3-37 (deliberately LEFT UNGATED - do not gate without re-reading this note): unlike
   * {@link detectIssues}, this GET runs on every mount/chapter switch regardless of {@link canDetect},
   * so a Hebrew book (canDetect false) still asks the server to normalize+detect for a feature the UI
   * hides. Gating it on `canDetect` looks like the obvious follow-up to b2, but it would strand the ONE
   * path that can put a real Hebrew {@link requestFailedLabel} on screen at all: `detectIssues` already
   * refuses to run when `!canDetect`, and `emptyStateLine` forces the 'unsupported' note over any
   * `hasDetected`/prompt line, but NEITHER banner in the template is gated by `canDetect` - so this GET
   * is the only request a Hebrew book ever issues, and therefore the only way a Hebrew reader learns
   * that anything is wrong with the checker at all. Gating it would silence that, trading a real outage
   * signal for the pipeline savings.
   *
   * c13 LANDED AND MADE THAT SIGNAL WORTH KEEPING. Its rescoping of {@link isExpectedAbsence} means this
   * GET now carries TWO kinds of news to a Hebrew reader, not one: the `requestErrorMessage` banner when
   * the request itself fails, and the `serviceUnavailableMessage` banner when the request succeeds and
   * the server reports the checker off / unreachable / timed out. Before c13 the second was swallowed
   * whole, so gating this GET would have cost only the first. It now costs both. `be-c02` may still
   * replace the whole `canDetect`-off-`langKey` design; gate this only after it lands and re-confirms
   * where the outage signal should live.
   */
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
        this.applyUnavailable(res.languageToolUnavailable, res.languageToolCode, res.languageToolMessage);
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
          result.metadata?.['languageToolCode'],
          result.metadata?.['languageToolMessage']
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
