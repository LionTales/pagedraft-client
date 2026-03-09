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
}

@Component({
  selector: 'app-issue-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="issue-panel">
      <header class="panel-header">
        <h3>Language Issues</h3>
        <div class="header-actions">
          <button
            type="button"
            class="btn secondary small"
            [disabled]="isDetecting"
            (click)="detectIssues()">
            {{ isDetecting ? 'Detecting…' : 'Detect Issues' }}
          </button>
          <button
            type="button"
            class="btn secondary small"
            [disabled]="!canRewrite || isRewriting"
            (click)="rewriteText()">
            {{ isRewriting ? 'Rewriting…' : 'Rewrite' }}
          </button>
        </div>
      </header>

      <div class="service-unavailable-banner" *ngIf="serviceUnavailableMessage">
        <span class="banner-icon" aria-hidden="true">ℹ️</span>
        <p class="banner-text">{{ serviceUnavailableMessage }}</p>
      </div>

      <section class="issues-section" *ngIf="issues.length > 0; else noIssues">
        <div class="issues-summary">
          <span class="summary-item error" *ngIf="errorCount > 0">
            {{ errorCount }} error{{ errorCount !== 1 ? 's' : '' }}
          </span>
          <span class="summary-item warning" *ngIf="warningCount > 0">
            {{ warningCount }} warning{{ warningCount !== 1 ? 's' : '' }}
          </span>
          <span class="summary-item info" *ngIf="infoCount > 0">
            {{ infoCount }} info
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
              <span class="suggestions-label">Suggestions:</span>
              <button
                *ngFor="let suggestion of issue.suggestions.slice(0, 10)"
                type="button"
                class="suggestion-btn"
                (click)="applySuggestion(issue, suggestion)">
                {{ suggestion }}
              </button>
              <span class="suggestions-more" *ngIf="issue.suggestions.length > 10">
                + {{ issue.suggestions.length - 10 }} more
              </span>
            </div>
            <div class="issue-actions">
              <button
                type="button"
                class="btn-link"
                (click)="highlightIssue(issue)">
                Highlight
              </button>
              <button
                type="button"
                class="btn-link"
                (click)="dismissIssue(i)">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </section>

      <ng-template #noIssues>
        <div class="no-issues">
          <p class="muted" *ngIf="!hasDetected">Click "Detect Issues" to check for language issues.</p>
          <p class="muted" *ngIf="hasDetected">No issues detected. Great!</p>
        </div>
      </ng-template>

      <section class="rewrite-section" *ngIf="rewrittenText">
        <h4>Rewritten Text</h4>
        <div class="rewrite-preview">{{ rewrittenText }}</div>
        <div class="rewrite-actions">
          <button
            type="button"
            class="btn"
            (click)="applyRewrite()">
            Apply Rewrite
          </button>
          <button
            type="button"
            class="btn secondary"
            (click)="dismissRewrite()">
            Dismiss
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
      gap: 0.75rem;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .panel-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .header-actions {
      display: flex;
      gap: 0.35rem;
    }
    .btn {
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      border: none;
      background: #0078d4;
      color: #fff;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn.secondary {
      background: #fff;
      color: #0078d4;
      border: 1px solid #0078d4;
    }
    .btn.small {
      padding: 0.25rem 0.5rem;
      font-size: 0.8rem;
    }
    .btn-link {
      background: none;
      border: none;
      color: #0078d4;
      cursor: pointer;
      text-decoration: underline;
      font-size: 0.8rem;
      padding: 0;
    }
    .issues-section {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .issues-summary {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      font-size: 0.85rem;
    }
    .summary-item {
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
      font-weight: 500;
    }
    .summary-item.error {
      background: #fee;
      color: #c00;
    }
    .summary-item.warning {
      background: #ffe;
      color: #c80;
    }
    .summary-item.info {
      background: #eef;
      color: #08c;
    }
    .issues-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .issue-item {
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid #ddd;
      background: #fff;
    }
    .issue-item.error {
      border-left: 3px solid #c00;
    }
    .issue-item.warning {
      border-left: 3px solid #c80;
    }
    .issue-item.info {
      border-left: 3px solid #08c;
    }
    .issue-header {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.25rem;
      font-size: 0.8rem;
    }
    .issue-category {
      font-weight: 600;
      text-transform: capitalize;
    }
    .issue-offset {
      color: #666;
      font-family: monospace;
    }
    .issue-confidence {
      color: #999;
      font-size: 0.75rem;
    }
    .issue-message {
      margin-bottom: 0.35rem;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .issue-suggestions {
      margin-bottom: 0.35rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      align-items: center;
    }
    .suggestions-label {
      font-size: 0.8rem;
      color: #666;
      margin-right: 0.25rem;
    }
    .suggestion-btn {
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      border: 1px solid #0078d4;
      background: #fff;
      color: #0078d4;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .suggestion-btn:hover {
      background: #e6f0ff;
    }
    .suggestions-more {
      font-size: 0.8rem;
      color: #666;
      margin-left: 0.25rem;
    }
    .issue-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    .no-issues {
      padding: 1rem;
      text-align: center;
    }
    .muted {
      color: #666;
      font-size: 0.85rem;
    }
    .rewrite-section {
      border-top: 1px solid #eee;
      padding-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .rewrite-section h4 {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .rewrite-preview {
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid #ddd;
      background: #f9f9f9;
      font-size: 0.9rem;
      line-height: 1.5;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .rewrite-actions {
      display: flex;
      gap: 0.35rem;
    }
    .service-unavailable-banner {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      background: #f0f7ff;
      border: 1px solid #b3d9ff;
      font-size: 0.85rem;
    }
    .banner-icon { font-size: 1.1rem; }
    .banner-text {
      margin: 0;
      color: #004578;
      line-height: 1.4;
    }
  `]
})
export class IssuePanelComponent implements OnInit, OnChanges {
  @Input() bookId?: string;
  @Input() chapterId?: string;
  @Output() issueHighlighted = new EventEmitter<LanguageIssue>();
  @Output() rewriteApplied = new EventEmitter<ApplyCorrectionEvent>();

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
          ? (res.languageToolMessage ?? 'The language checker is not available.')
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
          ? (result.metadata?.['languageToolMessage'] ?? 'The language checker is not available.')
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
