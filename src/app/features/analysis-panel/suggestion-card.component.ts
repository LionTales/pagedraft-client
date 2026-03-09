import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AnalysisSuggestion } from '../../core/models/analysis';
import { getSuggestionDiffFragments, DiffFragment } from '../../core/utils/proofread-diff';

@Component({
  selector: 'app-suggestion-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="suggestion-card" (click)="onCardClick($event)">
      <div class="suggestion-fields">
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
        <span class="suggestion-category" *ngIf="suggestion.category">{{ suggestion.category }}</span>
      </div>
      <div class="suggestion-actions" *ngIf="!readOnly">
        <button type="button" class="btn-accept" *ngIf="hasChange" (click)="accept.emit(suggestion); $event.stopPropagation()">Accept</button>
        <button type="button" class="btn-dismiss" (click)="dismiss.emit(suggestion); $event.stopPropagation()">{{ hasChange ? 'Dismiss' : 'OK' }}</button>
        <button
          type="button"
          class="btn-show"
          *ngIf="hasChange && suggestion.startOffset != null && suggestion.endOffset != null"
          (click)="showInDocument.emit(suggestion); $event.stopPropagation()">
          Show
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
      font-size: 0.7rem;
      text-transform: uppercase;
      color: #0078d4;
      margin-top: 0.2rem;
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
  `]
})
export class SuggestionCardComponent {
  @Input() suggestion!: AnalysisSuggestion;
  /** When true, show status badge (Accepted/Dismissed) and hide action buttons. Used in History tab. */
  @Input() readOnly = false;
  /** In read-only mode: 'accepted' | 'dismissed' | 'reverted' | 'pending'. */
  @Input() status?: 'accepted' | 'dismissed' | 'reverted' | 'pending';
  @Output() accept = new EventEmitter<AnalysisSuggestion>();
  @Output() dismiss = new EventEmitter<AnalysisSuggestion>();
  @Output() showInDocument = new EventEmitter<AnalysisSuggestion>();

  onFieldsClick(): void {
    if (!this.readOnly && this.suggestion.startOffset != null && this.suggestion.endOffset != null) {
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

  get originalFragments(): DiffFragment[] {
    if (!this.suggestion || this.suggestion.original === this.suggestion.suggested) return [];
    return getSuggestionDiffFragments(this.suggestion.original, this.suggestion.suggested).originalFragments;
  }

  get suggestedFragments(): DiffFragment[] {
    if (!this.suggestion || this.suggestion.original === this.suggestion.suggested) return [];
    return getSuggestionDiffFragments(this.suggestion.original, this.suggestion.suggested).suggestedFragments;
  }
}
