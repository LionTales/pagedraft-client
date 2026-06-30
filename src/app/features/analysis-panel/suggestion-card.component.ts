import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AnalysisSuggestion, isConsistencySuggestion } from '../../core/models/analysis';
import { getSuggestionDiffFragments, DiffFragment } from '../../core/utils/proofread-diff';

/**
 * Localized labels for the consistency sub-categories (he/en). Hoisted to a module-level const so
 * getCategoryLabel does not rebuild this object literal on every change-detection call (the card is
 * rendered once per suggestion in long lists). Static data, never mutated.
 */
const CONSISTENCY_SUB_LABELS: Record<'he' | 'en', Record<string, string>> = {
  en: {
    'consistency-register': 'Register',
    'consistency-tense': 'Tense',
    'consistency-pov': 'POV'
  },
  he: {
    'consistency-register': 'רישום',
    'consistency-tense': 'זמן דקדוקי',
    'consistency-pov': 'נקודת מבט'
  }
};

@Component({
  selector: 'app-suggestion-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="suggestion-card"
      [class.stale]="stale"
      [class.resolved]="readOnly && status !== undefined && status !== 'pending'"
      [attr.data-sev]="severity"
      (click)="onCardClick($event)">
      <span class="sev-bar" aria-hidden="true"></span>

      <!-- Header: kind chip + severity dot/label + spacer + jump link -->
      <div class="suggestion-header">
        <span
          class="suggestion-category"
          [ngClass]="'suggestion-category category-' + (suggestion.category || '').toLowerCase() + ' kind-' + kindClass"
          *ngIf="suggestion.category">
          {{ getCategoryLabel(suggestion.category) }}
        </span>
        <span class="sev-meta" *ngIf="!navigateOnly && hasChange">
          <span class="sev-dot" aria-hidden="true"></span>
          <span class="sev-label">{{ severityLabel }}</span>
        </span>
        <span class="header-spacer"></span>
        <button
          type="button"
          class="btn-show jump-link"
          [class.btn-show-approx]="!hasOffsets"
          *ngIf="suggestion.original && ((!navigateOnly && hasChange && (hasOffsets || suggestion.id)) || (navigateOnly && hasOffsets))"
          [disabled]="stale"
          [title]="stale ? jumpUnavailableTitle : (hasOffsets ? '' : jumpApproxTitle)"
          (click)="showInDocument.emit(suggestion); $event.stopPropagation()">
          <span class="jump-icon" aria-hidden="true">&#8594;</span>
          <span class="jump-label">{{ showLabel }}<ng-container *ngIf="!hasOffsets"> &#8776;</ng-container></span>
        </button>
      </div>

      <span class="stale-badge" *ngIf="stale">{{ staleLabel }}</span>

      <!-- Diff / text rows -->
      <div class="suggestion-fields">
        <div class="suggestion-navigate-text" *ngIf="navigateOnly && suggestion.original">
          <span class="suggestion-inline">{{ suggestion.original }}</span>
        </div>
        <div class="suggestion-original" *ngIf="!navigateOnly && suggestion.original !== suggestion.suggested && suggestion.original">
          <span class="suggestion-inline">
            @for (f of originalFragments; track f.text + f.type + $index) {
              @switch (f.type) {
                @case ('equal') { <span class="frag-equal">{{ f.text }}</span> }
                @case ('delete') { <span class="frag-delete">{{ f.text }}</span> }
              }
            }
          </span>
        </div>
        <div class="suggestion-suggested" *ngIf="!navigateOnly && suggestion.original !== suggestion.suggested">
          <span class="suggestion-inline">
            @for (f of suggestedFragments; track f.text + f.type + $index) {
              @switch (f.type) {
                @case ('equal') { <span class="frag-equal">{{ f.text }}</span> }
                @case ('insert') { <span class="frag-insert">{{ f.text }}</span> }
              }
            }
          </span>
        </div>
      </div>

      <!-- Rationale: caret toggles a sunken detail box (evidence + suggested action) -->
      <div class="suggestion-rationale" *ngIf="hasRationale">
        <button
          type="button"
          class="rationale-toggle"
          [attr.aria-expanded]="rationaleOpen"
          (click)="toggleRationale(); $event.stopPropagation()">
          <span class="rationale-caret" [class.open]="rationaleOpen" aria-hidden="true">&#9656;</span>
          {{ rationaleToggleLabel }}
        </button>
        <div class="rationale-detail" *ngIf="rationaleOpen">
          <div class="rationale-row" *ngIf="suggestion.reason">
            <span class="rationale-micro-label">{{ evidenceLabel }}</span>
            <span class="rationale-value suggestion-reason">{{ suggestion.reason }}</span>
          </div>
          <div class="rationale-row" *ngIf="suggestion.explanation || (suggestion.id && !suggestion.explanation)">
            <span class="rationale-micro-label">{{ suggestedActionLabel }}</span>
            <span class="rationale-value suggestion-explanation" *ngIf="suggestion.explanation">{{ suggestion.explanation }}</span>
            <span class="suggestion-explain-action" *ngIf="suggestion.id && !suggestion.explanation">
              <button
                type="button"
                class="btn-why"
                *ngIf="!loadingExplanation"
                (click)="explain.emit(suggestion); $event.stopPropagation()">
                {{ whyLabel }}
              </button>
              <span class="explain-loading" *ngIf="loadingExplanation">
                <span class="spinner-sm"></span> {{ explainingLabel }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <!-- Advisory actions (editable mode) -->
      <div class="suggestion-actions" *ngIf="!readOnly">
        <button type="button" class="btn-accept" *ngIf="hasChange && !navigateOnly" [disabled]="stale" (click)="accept.emit(suggestion); $event.stopPropagation()">{{ acceptLabel }}</button>
        <button type="button" class="btn-dismiss" (click)="dismiss.emit(suggestion); $event.stopPropagation()">{{ hasChange && !navigateOnly ? dismissLabel : okLabel }}</button>
      </div>

      <!-- Resolved status + revert (read-only mode) -->
      <div class="suggestion-status" *ngIf="readOnly && status !== undefined">
        <span class="status-badge" [class.accepted]="status === 'accepted'" [class.dismissed]="status === 'dismissed'" [class.reverted]="status === 'reverted'" [class.pending]="status === 'pending'">{{ statusLabel }}</span>
      </div>
    </div>
  `,
  styles: [`
    .suggestion-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-lg);
      padding: var(--pd-space-5);
      padding-inline-start: calc(var(--pd-space-5) + 3px);
      background: var(--pd-surface);
      box-shadow: var(--pd-shadow-1);
      cursor: pointer;
      transition: box-shadow var(--pd-dur-fast) var(--pd-ease);
    }
    .suggestion-card:hover {
      box-shadow: var(--pd-shadow-2);
    }
    /* Inline-start severity bar */
    .sev-bar {
      position: absolute;
      inset-inline-start: 0;
      inset-block: 0;
      width: 3px;
      border-start-start-radius: var(--pd-radius-lg);
      border-end-start-radius: var(--pd-radius-lg);
      background: var(--pd-sev-med);
    }
    .suggestion-card[data-sev='high'] .sev-bar { background: var(--pd-sev-high); }
    .suggestion-card[data-sev='med']  .sev-bar { background: var(--pd-sev-med); }
    .suggestion-card[data-sev='low']  .sev-bar { background: var(--pd-sev-low); }
    .suggestion-card.resolved .sev-bar { background: var(--pd-neutral-300); }

    /* Header */
    .suggestion-header {
      display: flex;
      align-items: center;
      gap: var(--pd-space-3);
      flex-wrap: wrap;
    }
    .header-spacer { flex: 1 1 auto; }

    .suggestion-category {
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-2);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-medium);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-radius: var(--pd-radius-pill);
      padding: 2px var(--pd-space-3);
      background: var(--pd-primary-50);
      color: var(--pd-primary-700);
    }
    .suggestion-category::before {
      content: '';
      display: inline-block;
      width: 0.4rem;
      height: 0.4rem;
      border-radius: var(--pd-radius-pill);
      background: currentColor;
    }
    /* Kind tints: proofread = primary, lineEdit = secondary, linguistic = violet */
    .suggestion-category.kind-proofread {
      background: var(--pd-primary-50);
      color: var(--pd-primary-700);
    }
    .suggestion-category.kind-lineedit {
      background: var(--pd-secondary-50);
      color: var(--pd-secondary-700);
    }
    .suggestion-category.kind-linguistic {
      background: var(--pd-linguistic-bg);
      color: var(--pd-linguistic-ink);
      box-shadow: inset 0 0 0 1px var(--pd-linguistic-border);
    }

    .sev-meta {
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-2);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      color: var(--pd-text-secondary);
    }
    .sev-dot {
      width: 0.45rem;
      height: 0.45rem;
      border-radius: var(--pd-radius-pill);
      background: var(--pd-sev-med);
    }
    .suggestion-card[data-sev='high'] .sev-dot { background: var(--pd-sev-high); }
    .suggestion-card[data-sev='med']  .sev-dot { background: var(--pd-sev-med); }
    .suggestion-card[data-sev='low']  .sev-dot { background: var(--pd-sev-low); }

    /* Jump link */
    .jump-link {
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-2);
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--pd-text-link);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-medium);
    }
    .jump-link:hover { color: var(--pd-primary-500); }
    .jump-link .jump-label { font-family: var(--pd-font-mono); }
    .jump-link.btn-show-approx { opacity: 0.85; }
    .jump-link:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Diff / text rows in the reading serif */
    .suggestion-fields {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-2);
      min-width: 0;
    }
    .suggestion-navigate-text, .suggestion-original, .suggestion-suggested {
      font-family: var(--pd-font-reading);
      font-size: var(--pd-text-body-sm);
      line-height: 1.5;
      border-radius: var(--pd-radius-sm);
      padding: var(--pd-space-2) var(--pd-space-3);
    }
    .suggestion-inline { word-break: break-word; }
    .suggestion-navigate-text {
      background: var(--pd-surface-sunken);
      color: var(--pd-text);
    }
    .suggestion-original {
      background: var(--pd-cut-bg);
    }
    .suggestion-suggested {
      background: var(--pd-keep-bg);
      font-weight: var(--pd-weight-medium);
    }
    .frag-equal { color: var(--pd-text); }
    .frag-delete { color: var(--pd-cut); text-decoration: line-through; }
    .frag-insert { color: var(--pd-keep); font-weight: var(--pd-weight-medium); }

    /* Rationale caret + sunken detail box */
    .suggestion-rationale { display: flex; flex-direction: column; gap: var(--pd-space-3); }
    .rationale-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-2);
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      align-self: flex-start;
      color: var(--pd-text-secondary);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      font-weight: var(--pd-weight-medium);
    }
    .rationale-toggle:hover { color: var(--pd-text); }
    .rationale-caret {
      display: inline-block;
      transition: transform var(--pd-dur-fast) var(--pd-ease);
    }
    .rationale-caret.open { transform: rotate(90deg); }
    :host-context([dir='rtl']) .rationale-caret { transform: rotate(180deg); }
    :host-context([dir='rtl']) .rationale-caret.open { transform: rotate(90deg); }

    .rationale-detail {
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      padding: var(--pd-space-4);
    }
    .rationale-row { display: flex; flex-direction: column; gap: var(--pd-space-1); }
    .rationale-micro-label {
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: var(--pd-weight-bold);
      color: var(--pd-text-muted);
    }
    .rationale-value {
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      line-height: 1.45;
      color: var(--pd-text-secondary);
    }

    .suggestion-explain-action { display: flex; align-items: center; }
    .btn-why {
      padding: var(--pd-space-1) var(--pd-space-3);
      border-radius: var(--pd-radius-sm);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      cursor: pointer;
      border: 1px solid var(--pd-border-strong);
      background: var(--pd-surface);
      color: var(--pd-text-secondary);
      transition: background var(--pd-dur-fast), border-color var(--pd-dur-fast), color var(--pd-dur-fast);
    }
    .btn-why:hover {
      background: var(--pd-primary-50);
      border-color: var(--pd-primary-600);
      color: var(--pd-primary-600);
    }
    .explain-loading {
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      color: var(--pd-text-muted);
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-2);
    }
    .spinner-sm {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--pd-neutral-200);
      border-top-color: var(--pd-primary-600);
      border-radius: 50%;
      animation: spin-why 0.7s linear infinite;
    }
    @keyframes spin-why {
      to { transform: rotate(360deg); }
    }

    /* Advisory actions */
    .suggestion-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-3);
    }
    .btn-accept, .btn-dismiss {
      padding: var(--pd-space-2) var(--pd-space-4);
      border-radius: var(--pd-radius-sm);
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-medium);
      cursor: pointer;
      border: 1px solid transparent;
      transition: background var(--pd-dur-fast), border-color var(--pd-dur-fast), color var(--pd-dur-fast);
    }
    .btn-accept {
      background: var(--pd-primary-600);
      color: var(--pd-on-primary);
      border-color: var(--pd-primary-600);
    }
    .btn-accept:hover { background: var(--pd-primary-500); border-color: var(--pd-primary-500); }
    .btn-dismiss {
      background: transparent;
      color: var(--pd-text-secondary);
      border-color: var(--pd-border-strong);
    }
    .btn-dismiss:hover { background: var(--pd-surface-sunken); color: var(--pd-text); }
    .btn-accept:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Resolved state */
    .suggestion-card.resolved { opacity: 0.66; }
    .suggestion-status {
      display: flex;
      align-items: center;
      gap: var(--pd-space-3);
    }
    .status-badge {
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 2px var(--pd-space-3);
      border-radius: var(--pd-radius-sm);
      font-weight: var(--pd-weight-bold);
    }
    .status-badge.accepted {
      background: var(--pd-keep-bg);
      color: var(--pd-keep);
    }
    .status-badge.dismissed {
      background: var(--pd-neutral-100);
      color: var(--pd-text-secondary);
    }
    .status-badge.pending {
      background: var(--pd-neutral-100);
      color: var(--pd-text-secondary);
    }
    .status-badge.reverted {
      background: var(--pd-info-bg);
      color: var(--pd-info);
    }

    /* Stale */
    .suggestion-card.stale { opacity: 0.5; }
    .stale-badge {
      display: inline-block;
      width: fit-content;
      font-family: var(--pd-font-ui);
      font-size: var(--pd-text-caption);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 2px var(--pd-space-3);
      border-radius: var(--pd-radius-sm);
      background: var(--pd-improve-bg);
      color: var(--pd-improve);
    }
  `]
})
export class SuggestionCardComponent implements OnChanges {
  @Input() suggestion!: AnalysisSuggestion;
  /** Display language for localized labels such as category chips. Defaults to 'en' so all existing usages are unaffected. */
  @Input() lang: 'he' | 'en' = 'en';
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

  /** Rationale detail box open state (presentational only). */
  rationaleOpen = false;

  private _originalFragments: DiffFragment[] = [];
  private _suggestedFragments: DiffFragment[] = [];

  /**
   * Memoized presentational kind/severity derived from `this.suggestion`. Recomputed only when the
   * `suggestion` Input reference changes (the parent replaces the suggestion object on update; the
   * `category` field these read is never mutated in place — verified). severity is computed ONCE here
   * and reused by severityLabel, instead of twice per change-detection pass.
   */
  private _kindClass: 'proofread' | 'lineedit' | 'linguistic' = 'proofread';
  private _severity: 'high' | 'med' | 'low' = 'low';

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
      this._kindClass = isConsistencySuggestion(this.suggestion) ? 'linguistic' : 'proofread';
      this._severity = this.computeSeverity();
    }
  }

  /** Derive severity from the suggestion category. Called once per `suggestion` change (memoized). */
  private computeSeverity(): 'high' | 'med' | 'low' {
    const key = (this.suggestion?.category || '').toLowerCase();
    if (key.startsWith('consistency') || key === 'continuity') return 'high';
    if (key === 'clarity' || key === 'flow' || key === 'word-choice' || key === 'structure' || key === 'redundancy' || key === 'style') return 'med';
    return 'low';
  }

  toggleRationale(): void {
    this.rationaleOpen = !this.rationaleOpen;
  }

  onFieldsClick(): void {
    if (!this.readOnly && !this.stale && this.suggestion.original) {
      const canNavigate = this.navigateOnly
        ? this.hasOffsets
        : this.hasChange && (this.hasOffsets || !!this.suggestion?.id);
      if (canNavigate) {
        this.showInDocument.emit(this.suggestion);
      }
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

  /** True when this is a consistency suggestion with no suggested replacement - navigate-only, nothing to apply. */
  get navigateOnly(): boolean {
    return isConsistencySuggestion(this.suggestion) && !this.suggestion?.suggested;
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

  /** True when there is rationale content (reason, explanation, or an explain-on-demand affordance). */
  get hasRationale(): boolean {
    return !!this.suggestion?.reason || !!this.suggestion?.explanation || !!this.suggestion?.id;
  }

  /**
   * Presentational kind class for the chip tint: linguistic (consistency-*) gets the violet tint;
   * everything else gets the primary (proofread) tint. lineEdit is not separately distinguishable
   * from the suggestion shape alone, so it shares the proofread/primary tint.
   */
  get kindClass(): 'proofread' | 'lineedit' | 'linguistic' {
    return this._kindClass;
  }

  /**
   * Presentational severity for the inline-start bar + dot. Consistency/continuity issues read as
   * high; line-edit clarity/style/flow/word-choice as medium; everything else low. Display-only.
   * Memoized: computed once per `suggestion` change in ngOnChanges (see computeSeverity).
   */
  get severity(): 'high' | 'med' | 'low' {
    return this._severity;
  }

  get severityLabel(): string {
    const en = { high: 'High', med: 'Medium', low: 'Low' } as const;
    const he = { high: 'גבוה', med: 'בינוני', low: 'נמוך' } as const;
    return (this.lang === 'he' ? he : en)[this.severity];
  }

  // ---- Localized button / label strings (he/en parity) --------------------
  get acceptLabel(): string { return this.lang === 'he' ? 'החל' : 'Accept'; }
  get dismissLabel(): string { return this.lang === 'he' ? 'התעלם' : 'Dismiss'; }
  get okLabel(): string { return this.lang === 'he' ? 'אישור' : 'OK'; }
  get showLabel(): string { return this.lang === 'he' ? 'הצג' : 'Show'; }
  get whyLabel(): string { return this.lang === 'he' ? 'למה?' : 'Why?'; }
  get explainingLabel(): string { return this.lang === 'he' ? 'מסביר...' : 'Explaining...'; }
  get staleLabel(): string { return this.lang === 'he' ? 'הטקסט נערך' : 'Text was edited'; }
  get rationaleToggleLabel(): string { return this.lang === 'he' ? 'נימוק' : 'Rationale'; }
  get evidenceLabel(): string { return this.lang === 'he' ? 'ראיה' : 'Evidence'; }
  get suggestedActionLabel(): string { return this.lang === 'he' ? 'פעולה מוצעת' : 'Suggested action'; }
  get jumpUnavailableTitle(): string { return this.lang === 'he' ? 'הטקסט נערך - המיקום אינו זמין' : 'Text was edited - location unavailable'; }
  get jumpApproxTitle(): string { return this.lang === 'he' ? 'מיקום משוער (מבוסס חיפוש)' : 'Approximate location (search-based)'; }

  get statusLabel(): string {
    const en: Record<string, string> = { accepted: 'Accepted', dismissed: 'Dismissed', reverted: 'Reverted', pending: 'Pending' };
    const he: Record<string, string> = { accepted: 'הוחל', dismissed: 'נדחה', reverted: 'בוטל', pending: 'ממתין' };
    const map = this.lang === 'he' ? he : en;
    return map[this.status ?? 'pending'] ?? map['pending'];
  }

  getCategoryLabel(category: string): string {
    const key = (category || '').toLowerCase();

    // Localized labels for the consistency sub-categories (he/en); module-level const (see top of file)
    // so the dictionary is not rebuilt on every call.
    if (key in CONSISTENCY_SUB_LABELS[this.lang]) {
      return CONSISTENCY_SUB_LABELS[this.lang][key];
    }

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

    // Fallback to English mapping or the raw key.
    return enLabels[key] ?? category;
  }
}
