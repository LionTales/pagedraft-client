import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AnalysisSuggestion } from '../../core/models/analysis';
import { getSuggestionDiffFragments, DiffFragment } from '../../core/utils/proofread-diff';

@Component({
  selector: 'app-suggestion-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="suggestion-card" [class.stale]="stale" (click)="onCardClick($event)">
      <div class="suggestion-fields">
        <span class="stale-badge" *ngIf="stale">Text was edited</span>
        <span
          class="suggestion-category"
          [ngClass]="'suggestion-category category-' + (suggestion.category || '').toLowerCase()"
          *ngIf="suggestion.category">
          {{ getCategoryLabel(suggestion.category) }}
        </span>
        <div class="suggestion-original" *ngIf="suggestion.original !== suggestion.suggested && suggestion.original">
          <span class="suggestion-label">Original:</span>
          <span class="suggestion-inline">
            @for (f of originalFragments; track f.text + f.type + $index) {
              @switch (f.type) {
                @case ('equal') { <span class="frag-equal">{{ f.text }}</span> }
                @case ('delete') { <span class="frag-delete">{{ f.text }}</span> }
              }
            }
          </span>
        </div>
        <div class="suggestion-suggested" *ngIf="suggestion.original !== suggestion.suggested">
          <span class="suggestion-label">Suggested:</span>
          <span class="suggestion-inline">
            @for (f of suggestedFragments; track f.text + f.type + $index) {
              @switch (f.type) {
                @case ('equal') { <span class="frag-equal">{{ f.text }}</span> }
                @case ('insert') { <span class="frag-insert">{{ f.text }}</span> }
              }
            }
          </span>
        </div>
        <div class="suggestion-reason" *ngIf="suggestion.reason">
          <span class="suggestion-label">Reason:</span> {{ suggestion.reason }}
        </div>
      </div>
      <div class="suggestion-explanation" *ngIf="suggestion.explanation">
        {{ suggestion.explanation }}
      </div>
      <div class="suggestion-explain-action" *ngIf="suggestion.id && !suggestion.explanation">
        <button
          type="button"
          class="btn-why"
          *ngIf="!loadingExplanation"
          (click)="explain.emit(suggestion); $event.stopPropagation()">
          Why?
        </button>
        <span class="explain-loading" *ngIf="loadingExplanation">
          <span class="spinner-sm"></span> Explaining…
        </span>
      </div>
      <div class="suggestion-actions" *ngIf="!readOnly">
        <button type="button" class="btn-accept" *ngIf="hasChange" [disabled]="stale" (click)="accept.emit(suggestion); $event.stopPropagation()">Accept</button>
        <button type="button" class="btn-dismiss" (click)="dismiss.emit(suggestion); $event.stopPropagation()">{{ hasChange ? 'Dismiss' : 'OK' }}</button>
        <button
          type="button"
          class="btn-show"
          [class.btn-show-approx]="!hasOffsets"
          *ngIf="hasChange && suggestion.original"
          [disabled]="stale"
          [title]="stale ? 'Text was edited — location unavailable' : (hasOffsets ? '' : 'Approximate location (search-based)')"
          (click)="showInDocument.emit(suggestion); $event.stopPropagation()">
          Show{{ hasOffsets ? '' : ' ≈' }}
        </button>
      </div>
      <div class="suggestion-status" *ngIf="readOnly && status !== undefined">
        <span class="status-badge" [class.accepted]="status === 'accepted'" [class.dismissed]="status === 'dismissed'" [class.reverted]="status === 'reverted'" [class.pending]="status === 'pending'">{{ status === 'accepted' ? 'Accepted' : status === 'dismissed' ? 'Dismissed' : status === 'reverted' ? 'Reverted' : 'Pending' }}</span>
      </div>
    </div>
  `,
  styles: [`
    .suggestion-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      border: 1px solid #eee;
      border-radius: 6px;
      padding: 0.5rem;
      background: #fafafa;
      cursor: pointer;
    }
    .suggestion-card:hover {
      background: #f5f5f5;
    }
    .suggestion-fields {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
      cursor: pointer;
    }
    .suggestion-fields:hover {
      background: #f0f4fa;
      border-radius: 4px;
    }
    .suggestion-label {
      font-size: 0.75rem;
      color: #666;
      margin-inline-end: 0.25rem;
    }
    .suggestion-original, .suggestion-suggested, .suggestion-reason {
      font-size: 0.85rem;
      line-height: 1.4;
    }
    .suggestion-inline {
      word-break: break-word;
    }
    .frag-equal { color: #333; }
    .frag-delete { color: #c00; text-decoration: line-through; }
    .frag-insert { color: #060; font-weight: 500; }
    .suggestion-category {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      border-radius: 999px;
      padding: 0.1rem 0.4rem;
      margin-bottom: 0.2rem;
      background: #e6f0ff;
      color: #074799;
    }
    .suggestion-category::before {
      content: '';
      display: inline-block;
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 999px;
      background: currentColor;
    }
    .suggestion-category.category-consistency {
      background: #fff4e0;
      color: #b45f06;
    }
    .suggestion-category.category-continuity {
      background: #ffe9e5;
      color: #c0392b;
    }
    .suggestion-category.category-clarity {
      background: #e6f4ff;
      color: #1565c0;
    }
    .suggestion-category.category-flow {
      background: #e5f6ff;
      color: #0277bd;
    }
    .suggestion-category.category-word-choice {
      background: #e8f0fe;
      color: #1a73e8;
    }
    .suggestion-category.category-structure {
      background: #e3f2fd;
      color: #0d47a1;
    }
    .suggestion-category.category-redundancy {
      background: #f3e5f5;
      color: #6a1b9a;
    }
    .suggestion-category.category-style {
      background: #e0f2f1;
      color: #00695c;
    }
    .suggestion-explanation {
      font-size: 0.8rem;
      line-height: 1.45;
      color: #3b5575;
      background: #f0f5fb;
      border-inline-start: 3px solid #a8c4e6;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
    }
    .suggestion-explain-action {
      display: flex;
      align-items: center;
    }
    .btn-why {
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      border: 1px solid #c8c8c8;
      background: #fff;
      color: #555;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .btn-why:hover {
      background: #f0f5fb;
      border-color: #0078d4;
      color: #0078d4;
    }
    .explain-loading {
      font-size: 0.75rem;
      color: #888;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .spinner-sm {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid #ddd;
      border-top-color: #0078d4;
      border-radius: 50%;
      animation: spin-why 0.7s linear infinite;
    }
    @keyframes spin-why {
      to { transform: rotate(360deg); }
    }
    .suggestion-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .btn-accept, .btn-dismiss {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .btn-accept {
      background: #0078d4;
      color: #fff;
      border-color: #0078d4;
    }
    .btn-dismiss {
      background: #fff;
      color: #555;
      border-color: #ddd;
    }
    .btn-show {
      background: #fff;
      color: #0078d4;
      border-color: #0078d4;
    }
    .btn-show.btn-show-approx {
      border-style: dashed;
      opacity: 0.8;
    }
    .suggestion-status {
      margin-top: 0.25rem;
    }
    .status-badge {
      font-size: 0.7rem;
      text-transform: uppercase;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-weight: 600;
    }
    .status-badge.accepted {
      background: #e6f4ea;
      color: #1e7e34;
    }
    .status-badge.dismissed {
      background: #fef7e0;
      color: #996a00;
    }
    .status-badge.pending {
      background: #f0f0f0;
      color: #666;
    }
    .status-badge.reverted {
      background: #e8f4fd;
      color: #0d6efd;
    }
    .suggestion-card.stale {
      opacity: 0.5;
    }
    .stale-badge {
      display: inline-block;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      background: #f0ebe0;
      color: #8a7340;
      margin-bottom: 0.15rem;
      width: fit-content;
    }
    .btn-accept:disabled, .btn-show:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `]
})
export class SuggestionCardComponent implements OnChanges {
  @Input() suggestion!: AnalysisSuggestion;
  /** When true, show status badge (Accepted/Dismissed) and hide action buttons. Used in History tab. */
  @Input() readOnly = false;
  /** In read-only mode: 'accepted' | 'dismissed' | 'reverted' | 'pending'. */
  @Input() status?: 'accepted' | 'dismissed' | 'reverted' | 'pending';
  /** True while the parent is fetching an explanation for this suggestion from the API. */
  @Input() loadingExplanation = false;
  /** True when the suggestion's original text can no longer be found in the document after user edits. */
  @Input() stale = false;
  @Output() accept = new EventEmitter<AnalysisSuggestion>();
  @Output() dismiss = new EventEmitter<AnalysisSuggestion>();
  @Output() showInDocument = new EventEmitter<AnalysisSuggestion>();
  @Output() explain = new EventEmitter<AnalysisSuggestion>();

  private _originalFragments: DiffFragment[] = [];
  private _suggestedFragments: DiffFragment[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['suggestion']) {
      if (!this.suggestion || this.suggestion.original === this.suggestion.suggested) {
        this._originalFragments = [];
        this._suggestedFragments = [];
      } else {
        const diff = getSuggestionDiffFragments(this.suggestion.original, this.suggestion.suggested);
        this._originalFragments = diff.originalFragments;
        this._suggestedFragments = diff.suggestedFragments;
      }
    }
  }

  onFieldsClick(): void {
    if (!this.readOnly && !this.stale && this.hasChange && this.suggestion.original) {
      this.showInDocument.emit(this.suggestion);
    }
  }

  /** Click anywhere on the card (except action buttons) moves cursor to the suggestion in the document. */
  onCardClick(event: MouseEvent): void {
    if ((event.target as HTMLElement)?.closest?.('button')) return;
    this.onFieldsClick();
  }

  /** True when there is an actual text change (original !== suggested). */
  get hasChange(): boolean {
    return !!this.suggestion && this.suggestion.original !== this.suggestion.suggested;
  }

  /** True when both startOffset and endOffset are populated (precise navigation available). */
  get hasOffsets(): boolean {
    return this.suggestion?.startOffset != null && this.suggestion?.endOffset != null;
  }

  get originalFragments(): DiffFragment[] {
    return this._originalFragments;
  }

  get suggestedFragments(): DiffFragment[] {
    return this._suggestedFragments;
  }

  getCategoryLabel(category: string): string {
    const key = (category || '').toLowerCase();

    const enLabels: Record<string, string> = {
      consistency: 'Consistency',
      continuity: 'Continuity',
      clarity: 'Clarity',
      flow: 'Flow',
      'word-choice': 'Word choice',
      structure: 'Structure',
      redundancy: 'Redundancy',
      style: 'Style'
    };

    // Suggestion-level language is not available here; the caller should supply
    // localized category keys. Fallback to English mapping or the raw key.
    return enLabels[key] ?? category;
  }
}
