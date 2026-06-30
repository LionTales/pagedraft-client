import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
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
          <button
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
          <p *ngIf="!hasDetected">{{ emptyPromptLabel }}</p>
          <p *ngIf="hasDetected">{{ emptyCleanLabel }}</p>
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
    .banner-icon { font-size: var(--pd-text-body); }
    .banner-text {
      margin: 0;
      color: var(--pd-primary-900);
      line-height: var(--pd-lh-body-sm);
    }
  `]
})
export class IssuePanelComponent implements OnInit, OnChanges {
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

  // ---- Localized chrome strings (he/en parity). -----------------------------
  // DRAFT Hebrew - flag for native-speaker review before sign-off.
  get titleLabel(): string { return this.langKey === 'he' ? 'בעיות שפה' : 'Language Issues'; }
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

  issues: LanguageIssue[] = [];
  rewrittenText?: string;
  isDetecting = false;
  isRewriting = false;
  hasDetected = false;
  /** Shown when the language checker (e.g. LanguageTool) is unavailable. */
  serviceUnavailableMessage: string | null = null;

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

  constructor(private languageEngineService: LanguageEngineService) {}

  ngOnInit(): void {
    if (this.bookId && this.chapterId) {
      this.loadIssues();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['chapterId']) {
      this.issues = [];
      this.rewrittenText = undefined;
      this.hasDetected = false;
      this.serviceUnavailableMessage = null;
      if (this.bookId && this.chapterId) {
        this.loadIssues();
      }
    }
  }

  loadIssues(): void {
    if (!this.bookId || !this.chapterId) return;

    this.languageEngineService.getIssues(this.bookId, this.chapterId).subscribe({
      next: (res) => {
        this.issues = res.issues;
        this.hasDetected = true;
        this.serviceUnavailableMessage = res.languageToolUnavailable
          ? (res.languageToolMessage ?? this.serviceUnavailableFallback)
          : null;
      },
      error: (err) => {
        console.error('Failed to load issues', err);
      }
    });
  }

  detectIssues(): void {
    if (!this.bookId || !this.chapterId || this.isDetecting) return;

    this.isDetecting = true;
    this.languageEngineService.detectIssues(this.bookId, this.chapterId).subscribe({
      next: (result) => {
        this.issues = result.issues;
        this.hasDetected = true;
        this.isDetecting = false;
        this.serviceUnavailableMessage = result.metadata?.['languageToolUnavailable']
          ? (result.metadata?.['languageToolMessage'] ?? this.serviceUnavailableFallback)
          : null;
      },
      error: (err) => {
        console.error('Failed to detect issues', err);
        this.isDetecting = false;
      }
    });
  }

  rewriteText(): void {
    if (!this.bookId || !this.chapterId || this.isRewriting || !this.canRewrite) return;

    this.isRewriting = true;
    this.languageEngineService.rewriteText(this.bookId, this.chapterId).subscribe({
      next: (result) => {
        this.rewrittenText = result.rewrittenText;
        this.isRewriting = false;
      },
      error: (err) => {
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
