import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { ANALYSIS_TYPES, AnalysisResultDto, AnalysisSuggestion, PromptTemplateDto, SuggestionOutcomeDto, AnalysisProgressDto, RunAnalysisRequest } from '../../core/models/analysis';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { DocumentVersionService, DocumentVersionDto } from '../../core/services/document-version.service';
import { ApplyCorrectionEvent } from '../language-engine/issue-panel.component';
import { proofreadDiff } from '../../core/utils/proofread-diff';
import { SuggestionCardComponent } from './suggestion-card.component';

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SuggestionCardComponent],
  template: `
    <div class="analysis-panel">
      <header class="panel-header">
        <h3>Analysis</h3>
      </header>

      <section class="type-picker-section">
        <div class="type-picker" role="group" aria-label="Analysis type">
          <button
            type="button"
            *ngFor="let opt of analysisTypes"
            [class.active]="selectedAnalysisType === opt.value"
            (click)="selectedAnalysisType = opt.value">
            {{ opt.label }}
          </button>
        </div>
      </section>

      <section class="prompt-section" *ngIf="selectedAnalysisType === 'Custom'">
        <label class="prompt-label">Custom prompt</label>
        <textarea
          [(ngModel)]="prompt"
          rows="4"
          class="prompt-input"
          placeholder="Describe what you want the AI to analyze (Hebrew supported)...">
        </textarea>
        <button type="button" class="run-btn secondary" [disabled]="!prompt" (click)="saveAsTemplate()">
          Save as template
        </button>
      </section>

      <section class="actions-section">
        <div class="actions-row">
          <button
            type="button"
            class="run-btn"
            [disabled]="!canRun || isRunning"
            (click)="runAnalysis()">
            {{ isRunning ? 'Running…' : 'Run analysis' }}
          </button>
          <button
            type="button"
            class="run-btn secondary"
            [disabled]="!canRun || isRunning"
            (click)="runStreaming()">
            {{ isRunning ? 'Streaming…' : 'Run with streaming' }}
          </button>
        </div>
        <p class="run-error" *ngIf="runError">{{ runError }}</p>
        <label class="highlight-option" *ngIf="selectedAnalysisType === 'Proofread'">
          <input type="checkbox" [(ngModel)]="highlightSuggestionsInDocument" (ngModelChange)="onHighlightOptionChange()">
          <span>Highlight suggestion words in document</span>
        </label>
      </section>

      <nav class="sub-tabs" aria-label="Run, History, or Versions">
        <button
          type="button"
          class="sub-tab"
          [class.active]="activeSubTab === 'run'"
          (click)="activeSubTab = 'run'">
          Run
        </button>
        <button
          type="button"
          class="sub-tab"
          [class.active]="activeSubTab === 'history'"
          (click)="activeSubTab = 'history'">
          History
        </button>
        <button
          type="button"
          class="sub-tab"
          [class.active]="activeSubTab === 'versions'"
          (click)="activeSubTab = 'versions'; loadVersions()">
          Versions
        </button>
      </nav>

      <!-- Run tab: only current/latest result, no history list -->
      <section class="run-tab-content" *ngIf="activeSubTab === 'run'">
        <!-- Proofread: show suggestion cards from diff (only when type picker is Proofread) -->
        <div class="suggestions-block" *ngIf="selectedAnalysisType === 'Proofread' && proofreadSuggestions.length > 0">
          <h4>Suggestions</h4>
          <p class="run-duration muted" *ngIf="lastRunDurationLabel">Run time: {{ lastRunDurationLabel }}</p>
          <div class="suggestions-list">
            <app-suggestion-card
              *ngFor="let s of proofreadSuggestions"
              [suggestion]="s"
              (accept)="onProofreadAccept(s)"
              (dismiss)="onProofreadDismiss(s)"
              (showInDocument)="onShowInDocument(s)">
            </app-suggestion-card>
          </div>
        </div>
        <!-- Line Edit (Run): same as History — overallFeedback + suggestion cards, no raw JSON -->
        <ng-container *ngIf="latestResult && getLineEdit(latestResult) as lineEdit">
          <article class="result-view">
            <h4>{{ latestResult.analysisType || latestResult.type }} ({{ latestResult.modelName }})</h4>
            <p class="line-edit-overall" *ngIf="lineEdit.overallFeedback">{{ lineEdit.overallFeedback }}</p>
            <div class="line-edit-suggestions">
              <app-suggestion-card
                *ngFor="let s of toAnalysisSuggestions(lineEdit.suggestions, latestResult)"
                [suggestion]="s"
                (accept)="onLineEditAccept(s, latestResult)"
                (dismiss)="onLineEditDismiss(s, latestResult)"
                (showInDocument)="onShowInDocument(s)">
              </app-suggestion-card>
            </div>
          </article>
        </ng-container>
        <article class="result-view" *ngIf="(streamingText || latestResult) && !(latestResult && (latestResult.analysisType || latestResult.type) === 'Proofread' && proofreadSuggestions.length) && !(latestResult && getLineEdit(latestResult)); else emptyRun">
          <h4 *ngIf="streamingText">Live result</h4>
          <h4 *ngIf="!streamingText && latestResult">{{ latestResult.analysisType || latestResult.type }} ({{ latestResult.modelName }})</h4>
          <p class="proofread-length-hint muted" *ngIf="showProofreadLengthHint">
            No changes suggested. The text may be too long for the model, or the result wasn't a proper proofread—try a shorter section (e.g. one scene).
          </p>
          <p class="proofread-all-good" *ngIf="isProofreadWithNoSuggestions && !showProofreadLengthHint">
            No changes suggested—text looks good. All suggestions have been applied to the document.
          </p>
          <ul class="analysis-list" *ngIf="runDisplayText && !isProofreadWithNoSuggestions && analysisItems(runDisplayText).length > 1; else singleRunBlock">
            <li *ngFor="let item of analysisItems(runDisplayText)">{{ item }}</li>
          </ul>
          <ng-template #singleRunBlock>
            <p class="analysis-single" *ngIf="runDisplayText && !isProofreadWithNoSuggestions">{{ runDisplayText }}</p>
          </ng-template>
        </article>
        <ng-template #emptyRun>
          <p class="muted" *ngIf="!proofreadSuggestions.length && !(latestResult && getLineEdit(latestResult))">No analysis run yet for this {{ sceneId ? 'scene' : 'chapter' }}.</p>
        </ng-template>
      </section>

      <!-- History tab: filter chips, full list, selected run's result -->
      <section class="history-tab-content" *ngIf="activeSubTab === 'history'">
        <div class="history-header" *ngIf="history.length || streamingText; else emptyHistory">
          <span class="history-label">History</span>
          <div class="history-filter">
            <button type="button" [class.active]="!historyFilterType" (click)="setHistoryFilter(null)">All</button>
            <button type="button" *ngFor="let opt of analysisTypes" [class.active]="historyFilterType === opt.value"
              (click)="setHistoryFilter(opt.value)">{{ opt.label }}</button>
          </div>
        </div>
        <nav class="tabs" *ngIf="history.length">
          <button
            type="button"
            *ngFor="let item of history; let i = index"
            [class.active]="i === selectedIndex"
            (click)="selectedIndex = i">
            {{ item.analysisType || item.type }} · {{ item.createdAt | date:'short' }}
          </button>
        </nav>
        <article class="result-view" *ngIf="activeSubTab === 'history' && history.length && history[selectedIndex] as current">
          <h4>{{ current.analysisType || current.type }} ({{ current.modelName }})</h4>
          <!-- Proofread (history): read-only list of suggestions with Accepted/Dismissed status -->
          <ng-container *ngIf="(current.analysisType || current.type) === 'Proofread' && proofreadHistoryItemsWithStatus.length > 0">
            <div class="suggestions-block">
              <h4>Suggestions — what happened</h4>
              <div class="history-outcome-filter">
                <button type="button" [class.active]="historySuggestionStatusFilter === 'all'" (click)="historySuggestionStatusFilter = 'all'">All</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'accepted'" (click)="historySuggestionStatusFilter = 'accepted'">Accepted</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'dismissed'" (click)="historySuggestionStatusFilter = 'dismissed'">Dismissed</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'reverted'" (click)="historySuggestionStatusFilter = 'reverted'">Reverted</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'pending'" (click)="historySuggestionStatusFilter = 'pending'">Pending</button>
              </div>
              <div class="suggestions-list">
                <app-suggestion-card
                  *ngFor="let item of filteredProofreadHistoryItemsWithStatus"
                  [suggestion]="item.suggestion"
                  [readOnly]="true"
                  [status]="item.status">
                </app-suggestion-card>
              </div>
            </div>
          </ng-container>
          <!-- Line Edit (history): read-only list with Accepted/Dismissed status -->
          <ng-container *ngIf="getLineEdit(current) as lineEdit">
            <p class="line-edit-overall" *ngIf="lineEdit.overallFeedback">{{ lineEdit.overallFeedback }}</p>
            <div class="line-edit-suggestions" *ngIf="lineEditSuggestionsWithStatus(current).length > 0">
              <h4>Suggestions — what happened</h4>
              <div class="history-outcome-filter">
                <button type="button" [class.active]="historySuggestionStatusFilter === 'all'" (click)="historySuggestionStatusFilter = 'all'">All</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'accepted'" (click)="historySuggestionStatusFilter = 'accepted'">Accepted</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'dismissed'" (click)="historySuggestionStatusFilter = 'dismissed'">Dismissed</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'reverted'" (click)="historySuggestionStatusFilter = 'reverted'">Reverted</button>
                <button type="button" [class.active]="historySuggestionStatusFilter === 'pending'" (click)="historySuggestionStatusFilter = 'pending'">Pending</button>
              </div>
              <app-suggestion-card
                *ngFor="let item of filteredLineEditSuggestionsWithStatus(current)"
                [suggestion]="item.suggestion"
                [readOnly]="true"
                [status]="item.status">
              </app-suggestion-card>
            </div>
          </ng-container>
          <!-- Other structured (metric cards) -->
          <div class="metric-cards" *ngIf="!getLineEdit(current) && (current.analysisType || current.type) !== 'Proofread' && current.structuredResult && metricCards(current.structuredResult).length; else textResult">
            <div class="metric-card" *ngFor="let card of metricCards(current.structuredResult)">
              <span class="metric-label">{{ card.label }}</span>
              <span class="metric-value">{{ card.value }}</span>
            </div>
          </div>
          <ng-template #textResult>
            <!-- For Proofread we show suggestion cards above; only show raw text when no suggestions or not Proofread -->
            <ul class="analysis-list" *ngIf="!getLineEdit(current) && !isProofreadWithSuggestions() && analysisItems(current.resultText).length > 1; else singleHistory">
              <li *ngFor="let item of analysisItems(current.resultText)">{{ item }}</li>
            </ul>
            <ng-template #singleHistory>
              <p class="analysis-single" *ngIf="!getLineEdit(current) && !isProofreadWithSuggestions()">{{ current.resultText }}</p>
            </ng-template>
          </ng-template>
        </article>
        <ng-template #emptyHistory>
          <p class="muted" *ngIf="activeSubTab === 'history'">No analysis history yet for this {{ sceneId ? 'scene' : 'chapter' }}.</p>
        </ng-template>
      </section>

      <!-- Versions tab: saved document snapshots, revert -->
      <section class="versions-tab-content" *ngIf="activeSubTab === 'versions'">
        <p class="muted" *ngIf="!bookId || !chapterId">Select a chapter to see versions.</p>
        <div *ngIf="bookId && chapterId">
          <p class="muted versions-hint">Each accept or save creates a version. Revert to restore the document to that state.</p>
          <div class="versions-list" *ngIf="versions.length; else noVersions">
            <div class="version-item" *ngFor="let v of versions" [class.version-item-reverted]="isVersionReverted(v)">
              <div class="version-info">
                <span class="version-date">{{ v.createdAt | date:'M/d/yy, h:mm:ss a' }}</span>
                <ng-container *ngIf="versionLabelOriginal(v.label) && versionLabelSuggested(v.label); else plainLabel">
                  <span class="version-original">Original: {{ versionLabelOriginal(v.label) }}</span>
                  <span class="version-suggested">Suggested: {{ versionLabelSuggested(v.label) }}</span>
                </ng-container>
                <ng-template #plainLabel>
                  <span class="version-label" *ngIf="v.label">{{ v.label }}</span>
                </ng-template>
              </div>
              <div class="version-actions">
                <button type="button" class="run-btn secondary btn-redo" *ngIf="isVersionReverted(v)" (click)="onRedoVersion(v)">Redo suggestion</button>
                <button type="button" class="run-btn secondary btn-revert" *ngIf="!isVersionReverted(v)" (click)="onRevert(v.id)">Revert</button>
              </div>
            </div>
          </div>
          <ng-template #noVersions>
            <p class="muted">No versions yet for this {{ sceneId ? 'scene' : 'chapter' }}. Accept a suggestion or save to create one.</p>
          </ng-template>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .analysis-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.75rem;
    }
    .panel-header {
      display: flex;
      align-items: center;
      margin-bottom: 0.25rem;
    }
    .type-picker-section {
      margin-bottom: 0.25rem;
    }
    .type-picker {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      overflow-x: auto;
    }
    .type-picker button {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 0.35rem 0.6rem;
      background: #fafafa;
      font-size: 0.8rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .type-picker button.active {
      background: #0078d4;
      border-color: #0078d4;
      color: #fff;
    }
    .prompt-section {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .actions-section {
      margin-bottom: 0.25rem;
    }
    .history-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }
    .history-label { font-size: 0.85rem; color: #555; }
    .history-filter {
      display: flex;
      flex-wrap: wrap;
      gap: 0.2rem;
    }
    .history-filter button {
      border: 1px solid #ddd;
      border-radius: 999px;
      padding: 0.15rem 0.5rem;
      background: #fafafa;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .history-filter button.active {
      background: #e6f0ff;
      border-color: #0078d4;
    }
    .metric-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .metric-card {
      border: 1px solid #eee;
      border-radius: 4px;
      padding: 0.5rem;
      background: #f9f9f9;
    }
    .metric-label { display: block; font-size: 0.75rem; color: #666; }
    .metric-value { font-size: 0.95rem; font-weight: 500; }
    .prompt-label {
      font-size: 0.85rem;
      color: #555;
    }
    .prompt-input {
      resize: vertical;
      min-height: 4rem;
      padding: 0.4rem;
      border-radius: 4px;
      border: 1px solid #ccc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .highlight-option {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      color: #555;
      cursor: pointer;
      margin-top: 0.35rem;
    }
    .highlight-option input { cursor: pointer; }
    .run-btn {
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      border: none;
      background: #0078d4;
      color: #fff;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .run-btn.secondary {
      background: #fff;
      color: #0078d4;
      border: 1px solid #0078d4;
    }
    .history-section,
    .run-tab-content,
    .history-tab-content {
      border-top: 1px solid #eee;
      padding-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      flex: 1;
      min-height: 0;
    }
    .sub-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .sub-tab {
      border: 1px solid #ddd;
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      background: #fafafa;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .sub-tab.active {
      background: #e6f0ff;
      border-color: #0078d4;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .tabs button {
      border: 1px solid #ddd;
      border-radius: 999px;
      padding: 0.2rem 0.6rem;
      background: #fafafa;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .tabs button.active {
      background: #e6f0ff;
      border-color: #0078d4;
    }
    .result-view {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border-radius: 4px;
      border: 1px solid #eee;
      padding: 0.5rem;
      background: #fff;
    }
    .result-view pre {
      white-space: pre-wrap;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.9rem;
      margin: 0;
    }
    .analysis-list {
      margin: 0;
      padding-left: 1.25rem;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .analysis-list li {
      margin-bottom: 0.35rem;
    }
    .analysis-list li:last-child {
      margin-bottom: 0;
    }
    .analysis-single {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .line-edit-overall {
      margin: 0 0 0.75rem 0;
      font-size: 0.9rem;
      color: #333;
      padding: 0.4rem 0;
      border-bottom: 1px solid #eee;
    }
    .line-edit-suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .line-edit-item {
      display: flex;
      gap: 0.5rem;
      border: 1px solid #eee;
      border-radius: 6px;
      padding: 0.5rem;
      background: #fafafa;
    }
    .line-edit-num {
      font-weight: 600;
      color: #0078d4;
      flex-shrink: 0;
    }
    .line-edit-fields {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }
    .line-edit-label {
      font-size: 0.75rem;
      color: #666;
      margin-inline-end: 0.25rem;
    }
    .line-edit-original, .line-edit-suggested, .line-edit-reason {
      font-size: 0.85rem;
      line-height: 1.4;
    }
    .line-edit-original { color: #c00; }
    .line-edit-suggested { color: #060; }
    .line-edit-category {
      font-size: 0.7rem;
      text-transform: uppercase;
      color: #0078d4;
      margin-top: 0.2rem;
    }
    .muted {
      color: #666;
      font-size: 0.85rem;
    }
    .run-error {
      color: #a00;
      font-size: 0.85rem;
      margin: 0.35rem 0 0 0;
    }
    .proofread-all-good {
      color: #2d6a2d;
      font-size: 0.85rem;
    }
    .suggestions-block {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .suggestions-block h4 {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .suggestions-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .history-outcome-filter {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 0.35rem;
    }
    .history-outcome-filter button {
      border: 1px solid #ddd;
      border-radius: 999px;
      padding: 0.15rem 0.5rem;
      background: #fafafa;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .history-outcome-filter button.active {
      background: #e6f0ff;
      border-color: #0078d4;
    }
    .versions-tab-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .versions-hint {
      font-size: 0.8rem;
    }
    .versions-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .version-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.4rem 0.5rem;
      border: 1px solid #eee;
      border-radius: 4px;
      background: #fafafa;
    }
    .version-item.version-item-reverted {
      background: #f0f0f0;
      opacity: 0.85;
    }
    .version-item.version-item-reverted .version-date,
    .version-item.version-item-reverted .version-label,
    .version-item.version-item-reverted .version-original,
    .version-item.version-item-reverted .version-suggested {
      color: #777;
    }
    .version-actions {
      flex-shrink: 0;
    }
    .version-info {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
    }
    .version-date { font-size: 0.85rem; color: #333; }
    .version-label { font-size: 0.75rem; color: #666; }
    .version-original { font-size: 0.8rem; color: #c00; display: block; }
    .version-suggested { font-size: 0.8rem; color: #060; display: block; }
    .btn-revert, .btn-redo { flex-shrink: 0; }
  `]
})
export class AnalysisPanelComponent implements OnChanges {
  @Input() bookId: string | null = null;
  @Input() chapterId: string | null = null;
  @Input() sceneId: string | null = null;
  /** Book language (e.g. 'he', 'en'). Used for analysis and templates. Defaults to 'he' if not set. */
  @Input() bookLanguage: string | null = null;
  /** Current document plain text (from editor). Used for Proofread diff and Line Edit offset mapping. */
  @Input() documentText: string = '';
  /** Chapter/scene the current document belongs to; used to avoid restoring with stale documentText after chapter switch. */
  @Input() documentChapterId: string | null = null;
  @Input() documentSceneId: string | null = null;
  /** If provided, called before run/streaming so the editor can save; must return Promise that resolves when save is done. */
  @Input() saveBeforeRun?: () => Promise<void>;
  @Output() analysisStarted = new EventEmitter<void>();
  @Output() analysisCompleted = new EventEmitter<void>();
  /** Optional human-readable status for the global analysis spinner (e.g. estimated chunks). */
  @Output() analysisStatus = new EventEmitter<string>();
  /** Optional numeric progress (0–100) for the global analysis spinner. */
  @Output() analysisProgressPercent = new EventEmitter<number | null>();
  @Output() applyCorrection = new EventEmitter<ApplyCorrectionEvent>();
  @Output() showInDocument = new EventEmitter<{ startOffset: number; endOffset: number; originalText?: string }>();
  @Output() suggestionRangesChange = new EventEmitter<{ startOffset: number; endOffset: number }[]>();
  @Output() revertToVersion = new EventEmitter<string>();

  readonly analysisTypes = ANALYSIS_TYPES;
  selectedAnalysisType: string = 'Proofread';
  prompt = '';
  selectedTemplateId: string | null = null;
  isRunning = false;
  streamingText = '';

  templates: PromptTemplateDto[] = [];
  history: AnalysisResultDto[] = [];
  selectedIndex = 0;
  historyFilterType: string | null = null;

  /** When true, emit suggestion ranges so the editor highlights them; when false, emit [] so no highlights are applied. */
  highlightSuggestionsInDocument = true;
  /** Sub-tab: 'run' shows only latest result; 'history' shows filter + list + selected; 'versions' shows saved snapshots. */
  activeSubTab: 'run' | 'history' | 'versions' = 'run';
  /** Error message from last run (e.g. "Proofread text is too long"); cleared on next run or success. */
  runError: string | null = null;
  /** Latest result shown on Run tab (set when run completes or streaming completes). */
  latestResult: AnalysisResultDto | null = null;
  /** Proofread suggestions from diff (original vs resultText); shown on Run tab with Accept/Dismiss. */
  proofreadSuggestions: AnalysisSuggestion[] = [];
  /** True when diff produced too many suggestions (likely model returned unrelated content); show "try shorter section" instead of cards. */
  proofreadSuggestionsUnreliable = false;
  /** Keys of dismissed Line Edit suggestions (so we hide them in History). Key: `${resultId}-${original}-${suggested}` */
  dismissedLineEditKeys = new Set<string>();
  /** Keys of accepted Line Edit suggestions in History (read-only display). */
  acceptedLineEditKeys = new Set<string>();
  /** Keys of dismissed Proofread suggestions in History view. Key: `${resultId}-${original}-${suggested}` */
  dismissedProofreadHistoryKeys = new Set<string>();
  /** Keys of accepted Proofread suggestions in History (read-only display). */
  acceptedProofreadHistoryKeys = new Set<string>();
  /** Original document text at the time of each Proofread run (key = chapterId-sceneId-createdAt). Used so History diff shows all suggestions including accepted. */
  private proofreadOriginalDocumentByRunKey = new Map<string, string>();
  /** True after we've restored proofread suggestions for the current chapter/scene (so we don't re-run diff on every documentText change while user edits). */
  private hasRestoredProofreadForCurrentContext = false;
  /** Versions list for the Versions tab (chapter/scene document snapshots). */
  versions: DocumentVersionDto[] = [];
  /** Suggestion outcomes for the chapter/scene; used to mark reverted versions and enable Redo. */
  suggestionOutcomes: SuggestionOutcomeDto[] = [];
  /** Filter for History "Suggestions — what happened": show All, only Accepted, only Dismissed, or only Pending. */
  historySuggestionStatusFilter: 'all' | 'accepted' | 'dismissed' | 'reverted' | 'pending' = 'all';
  /** Current progress info for a running proofread job (chunked). */
  private currentProgressJobId: string | null = null;
  private progressStop$ = new Subject<void>();
  /** Timestamp when the current run started (for duration display). */
  private runStartedAt: number | null = null;
  /** Human-readable duration label for the last completed run (e.g. "45s", "2m 10s"). */
  lastRunDurationLabel: string | null = null;
  /** Latest estimated completion percent for the current Proofread run (0–100). */
  currentProgressPercent: number | null = null;

  constructor(
    private analysisService: AnalysisService,
    private documentVersionService: DocumentVersionService,
    private cdr: ChangeDetectorRef,
    private analysisProgressService: AnalysisProgressService
  ) {}

  /** Text to show in Run tab: streaming if in progress, else latestResult.resultText. */
  get runDisplayText(): string {
    if (this.streamingText) return this.streamingText;
    if (this.latestResult?.resultText) return this.latestResult.resultText;
    return '';
  }

  /** True when Proofread ran but returned no suggestions and result is likely unchanged (API hint or client-side similarity). Show "text may be too long" hint. */
  get showProofreadLengthHint(): boolean {
    const r = this.latestResult;
    if (!r || (r.analysisType || r.type) !== 'Proofread' || this.proofreadSuggestions.length > 0) return false;
    return !!r.proofreadNoChangesHint || this.proofreadSuggestionsUnreliable;
  }

  /** True when Proofread has no suggestions (user accepted/dismissed all, or model returned no changes). Use to hide raw response text. */
  get isProofreadWithNoSuggestions(): boolean {
    const r = this.latestResult;
    return !!r && (r.analysisType || r.type) === 'Proofread' && this.proofreadSuggestions.length === 0;
  }

  /** Proofread suggestions for the currently selected history item (from diff of original doc vs resultText). Uses stored original document text when available so accepted suggestions still appear. */
  get proofreadSuggestionsForHistory(): AnalysisSuggestion[] {
    const current = this.history[this.selectedIndex];
    if (!current || (current.analysisType || current.type) !== 'Proofread' || !current.resultText)
      return [];
    const runKey = this.proofreadRunKeyForResult(current);
    const originalText = this.proofreadOriginalDocumentByRunKey.get(runKey) ?? this.documentText;
    if (!originalText) return [];
    return proofreadDiff(originalText, current.resultText);
  }

  /** Stable key for a Proofread run (chapterId, sceneId, createdAt). Used to store/retrieve original document text and for suggestion keys. */
  private proofreadRunKeyForResult(r: AnalysisResultDto): string {
    return `${r.chapterId}-${r.sceneId ?? ''}-${r.createdAt}`;
  }

  /** Stable key for a Proofread run + suggestion (chapterId, sceneId, createdAt, original, suggested). Use so Accepted/Dismissed match for same run whether from API or streaming. */
  private proofreadRunKey(r: AnalysisResultDto, s: { original: string; suggested: string }): string {
    const o = this.normalizeKeyText(s.original);
    const g = this.normalizeKeyText(s.suggested);
    return `${this.proofreadRunKeyForResult(r)}-${o}-${g}`;
  }

  /** Key for a Proofread suggestion outcome. Uses id when available (persisted run) so it matches API-stored outcomes; otherwise run key for streaming. */
  private proofreadSuggestionKey(r: AnalysisResultDto, s: { original: string; suggested: string }): string {
    const o = this.normalizeKeyText(s.original);
    const g = this.normalizeKeyText(s.suggested);
    return r.id ? `${(r.id || '').toLowerCase()}-${o}-${g}` : this.proofreadRunKey(r, s);
  }

  /** Normalize text for key matching (NFC) so API and diff produce the same key. */
  private normalizeKeyText(t: string): string {
    return (t ?? '').normalize('NFC');
  }

  /** Order for History suggestion list: pending first, then accepted, then reverted, then dismissed. */
  private static suggestionStatusOrder(s: 'accepted' | 'dismissed' | 'reverted' | 'pending'): number {
    return s === 'pending' ? 0 : s === 'accepted' ? 1 : s === 'reverted' ? 2 : 3;
  }

  /** For History tab: each Proofread suggestion with its outcome (accepted/dismissed/pending). Uses embedded suggestionOutcomes when present so status matches API. Merges diff-based suggestions with outcomes: diff suggestions get status from matching outcome; outcomes that don't match any diff suggestion are added as synthetic suggestions (so Accepted/Dismissed still appear after document changed). In-memory keys (dismissed/accepted in this session) take precedence over embedded so they are not lost after Run analysis. */
  get proofreadHistoryItemsWithStatus(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const current = this.history[this.selectedIndex];
    if (!current) return [];
    const suggestions = this.proofreadSuggestionsForHistory;
    const embedded = current.suggestionOutcomes;
    const result: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] = [];
    const matchedOutcomeKeys = new Set<string>();

    if (embedded?.length) {
      for (const s of suggestions) {
        const orig = this.normalizeKeyText(s.original);
        const sugg = this.normalizeKeyText(s.suggested);
        const key = this.proofreadSuggestionKey(current, s);
        // Prefer in-memory outcome so dismiss/accept in this session are not lost (e.g. after Run analysis without reload)
        if (this.acceptedProofreadHistoryKeys.has(key)) {
          result.push({ suggestion: s, status: 'accepted' as const });
          matchedOutcomeKeys.add(`${orig}|${sugg}`);
          continue;
        }
        if (this.dismissedProofreadHistoryKeys.has(key)) {
          result.push({ suggestion: s, status: 'dismissed' as const });
          matchedOutcomeKeys.add(`${orig}|${sugg}`);
          continue;
        }
        const o = embedded.find(
          e => this.normalizeKeyText(e.originalText) === orig && this.normalizeKeyText(e.suggestedText) === sugg
        );
        const status = o?.outcome === 'Accepted' ? 'accepted' as const : o?.outcome === 'Dismissed' ? 'dismissed' as const : o?.outcome === 'Reverted' ? 'reverted' as const : 'pending' as const;
        result.push({ suggestion: s, status });
        if (o) matchedOutcomeKeys.add(`${orig}|${sugg}`);
      }
      for (const o of embedded) {
        const orig = this.normalizeKeyText(o.originalText);
        const sugg = this.normalizeKeyText(o.suggestedText);
        if (matchedOutcomeKeys.has(`${orig}|${sugg}`)) continue;
        const status = o.outcome === 'Accepted' ? 'accepted' as const : o.outcome === 'Dismissed' ? 'dismissed' as const : o.outcome === 'Reverted' ? 'reverted' as const : 'pending' as const;
        result.push({
          suggestion: { original: o.originalText, suggested: o.suggestedText, reason: 'Proofread' },
          status
        });
      }
      return result.sort((a, b) => AnalysisPanelComponent.suggestionStatusOrder(a.status) - AnalysisPanelComponent.suggestionStatusOrder(b.status));
    }
    const keyBased = suggestions.map(s => {
      const key = this.proofreadSuggestionKey(current, s);
      if (this.acceptedProofreadHistoryKeys.has(key)) return { suggestion: s, status: 'accepted' as const };
      if (this.dismissedProofreadHistoryKeys.has(key)) return { suggestion: s, status: 'dismissed' as const };
      return { suggestion: s, status: 'pending' as const };
    });
    return keyBased.sort((a, b) => AnalysisPanelComponent.suggestionStatusOrder(a.status) - AnalysisPanelComponent.suggestionStatusOrder(b.status));
  }

  /** Filtered by historySuggestionStatusFilter for Proofread history. */
  get filteredProofreadHistoryItemsWithStatus(): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const list = this.proofreadHistoryItemsWithStatus;
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  /** True when the selected history item is Proofread and has at least one suggestion to show (diff or synthetic from outcomes), so we show cards instead of raw resultText. */
  isProofreadWithSuggestions(): boolean {
    const current = this.history[this.selectedIndex];
    return !!current && (current.analysisType || current.type) === 'Proofread' && this.proofreadHistoryItemsWithStatus.length > 0;
  }

  get canRun(): boolean {
    if (!this.bookId || !this.chapterId) return false;
    if (this.selectedAnalysisType === 'Custom') return !!this.prompt?.trim();
    return true;
  }

  setHistoryFilter(type: string | null): void {
    this.historyFilterType = type;
    this.loadHistory();
  }

  /** Call after Revert (or other outcome change) so History tab shows updated suggestion statuses (e.g. Reverted). */
  refreshHistory(): void {
    this.loadHistory();
  }

  /** Reload versions list and outcomes so Versions tab updates (e.g. Revert → Redo button, or after Redo). */
  refreshVersions(): void {
    this.loadVersions();
  }

  loadVersions(): void {
    if (!this.bookId || !this.chapterId) return;
    this.analysisService.getSuggestionOutcomes(this.bookId, this.chapterId, this.sceneId ?? undefined).subscribe({
      next: (outcomes) => {
        this.suggestionOutcomes = outcomes ?? [];
        this.cdr.detectChanges();
      },
      error: () => {
        this.suggestionOutcomes = [];
        this.cdr.detectChanges();
      }
    });
    this.documentVersionService.list(this.bookId, this.chapterId, this.sceneId ?? undefined).subscribe({
      next: (list) => {
        this.versions = list ?? [];
        this.cdr.detectChanges();
      },
      error: () => {
        this.versions = [];
        this.cdr.detectChanges();
      }
    });
  }

  onRevert(versionId: string): void {
    this.revertToVersion.emit(versionId);
  }

  /** True when this version's suggestion has a Reverted outcome (so we grey it out and show Redo). */
  isVersionReverted(v: DocumentVersionDto): boolean {
    const aid = (v.analysisResultId ?? v.analysisId) ?? '';
    if (!aid || v.originalText == null || v.suggestedText == null) return false;
    const orig = this.normalizeKeyText(v.originalText);
    const sugg = this.normalizeKeyText(v.suggestedText);
    const aidLower = aid.toLowerCase();
    return this.suggestionOutcomes.some(
      o => (o.analysisResultId || '').toLowerCase() === aidLower &&
           this.normalizeKeyText(o.originalText) === orig &&
           this.normalizeKeyText(o.suggestedText) === sugg &&
           (o.outcome || '').toLowerCase() === 'reverted'
    );
  }

  /** Re-apply the suggestion (replace original with suggested), set outcome to Accepted, refresh versions and history. */
  onRedoVersion(v: DocumentVersionDto): void {
    const analysisId = v.analysisResultId ?? v.analysisId;
    if (!analysisId || v.originalText == null || v.suggestedText == null || !this.bookId || !this.chapterId) return;
    this.applyCorrection.emit({
      text: v.suggestedText,
      originalText: v.originalText,
      analysisId,
      skipCreatingVersion: true
    });
    this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, analysisId, v.originalText, v.suggestedText, 'Accepted').subscribe({
      next: () => {
        this.loadVersions();
        this.refreshHistory();
      },
      error: () => {}
    });
  }

  /** Parse version label "Original: X → Suggested: Y" for display. */
  versionLabelOriginal(label: string | null | undefined): string | null {
    if (!label || !label.includes(' → Suggested: ')) return null;
    const prefix = 'Original: ';
    const idx = label.indexOf(prefix);
    if (idx === -1) return null;
    const start = idx + prefix.length;
    const end = label.indexOf(' → Suggested: ', start);
    return end === -1 ? null : label.slice(start, end).trim();
  }

  versionLabelSuggested(label: string | null | undefined): string | null {
    if (!label) return null;
    const sep = ' → Suggested: ';
    const idx = label.indexOf(sep);
    return idx === -1 ? null : label.slice(idx + sep.length).trim();
  }

  /** Parse Line Edit structuredResult into suggestions + overallFeedback for display. */
  getLineEdit(current: AnalysisResultDto): { suggestions: Array<{ original: string; suggested: string; reason: string; category: string }>; overallFeedback: string } | null {
    if ((current.analysisType || current.type) !== 'LineEdit') return null;
    try {
      const data = JSON.parse(current.structuredResult || '{}') as Record<string, unknown>;
      const suggestions = data['suggestions'];
      if (!Array.isArray(suggestions)) return null;
      return {
        suggestions: suggestions.map((s: Record<string, unknown>) => ({
          original: String(s?.['original'] ?? ''),
          suggested: String(s?.['suggested'] ?? ''),
          reason: String(s?.['reason'] ?? ''),
          category: String(s?.['category'] ?? '')
        })),
        overallFeedback: String(data['overallFeedback'] ?? '')
      };
    } catch {
      return null;
    }
  }

  /** Map Line Edit suggestion shape to AnalysisSuggestion; filter dismissed and accepted (so they hide on Run tab); add startOffset/endOffset from documentText when available. */
  toAnalysisSuggestions(
    suggestions: Array<{ original: string; suggested: string; reason: string; category: string }>,
    current?: AnalysisResultDto
  ): AnalysisSuggestion[] {
    if (!current) return suggestions.map(s => ({ ...s }));
    const id = (current.id || '').toLowerCase();
    const keyPrefix = `${id}-`;
    return suggestions
      .filter(s => {
        const orig = this.normalizeKeyText(s.original);
        const sugg = this.normalizeKeyText(s.suggested);
        const key = `${keyPrefix}${orig}-${sugg}`;
        return !this.dismissedLineEditKeys.has(key) && !this.acceptedLineEditKeys.has(key);
      })
      .map(s => {
        const suggestion: AnalysisSuggestion = { ...s };
        if (this.documentText) {
          const idx = this.documentText.indexOf(s.original);
          if (idx >= 0) {
            suggestion.startOffset = idx;
            suggestion.endOffset = idx + s.original.length;
          }
        }
        return suggestion;
      });
  }

  /** For History tab: all Line Edit suggestions for the given result with status (accepted/dismissed/reverted/pending). Uses embedded suggestionOutcomes when present. Outcomes that don't match any structuredResult suggestion are added as synthetic suggestions so Accepted/Dismissed/Reverted still appear. In-memory keys take precedence over embedded so dismiss/accept in this session are not lost after Run analysis. */
  lineEditSuggestionsWithStatus(current: AnalysisResultDto): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const lineEdit = this.getLineEdit(current);
    if (!lineEdit) return [];
    const suggestions = this.toLineEditSuggestionsWithOffsets(lineEdit.suggestions, current);
    const embedded = current.suggestionOutcomes;
    const result: { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] = [];
    const matchedOutcomeKeys = new Set<string>();

    if (embedded?.length) {
      const id = (current.id || '').toLowerCase();
      const keyPrefix = `${id}-`;
      for (const s of suggestions) {
        const orig = this.normalizeKeyText(s.original);
        const sugg = this.normalizeKeyText(s.suggested);
        const key = `${keyPrefix}${orig}-${sugg}`;
        if (this.acceptedLineEditKeys.has(key)) {
          result.push({ suggestion: s, status: 'accepted' as const });
          matchedOutcomeKeys.add(`${orig}|${sugg}`);
          continue;
        }
        if (this.dismissedLineEditKeys.has(key)) {
          result.push({ suggestion: s, status: 'dismissed' as const });
          matchedOutcomeKeys.add(`${orig}|${sugg}`);
          continue;
        }
        const o = embedded.find(
          e => this.normalizeKeyText(e.originalText) === orig && this.normalizeKeyText(e.suggestedText) === sugg
        );
        const status = o?.outcome === 'Accepted' ? 'accepted' as const : o?.outcome === 'Dismissed' ? 'dismissed' as const : o?.outcome === 'Reverted' ? 'reverted' as const : 'pending' as const;
        result.push({ suggestion: s, status });
        if (o) matchedOutcomeKeys.add(`${orig}|${sugg}`);
      }
      for (const o of embedded) {
        const orig = this.normalizeKeyText(o.originalText);
        const sugg = this.normalizeKeyText(o.suggestedText);
        if (matchedOutcomeKeys.has(`${orig}|${sugg}`)) continue;
        const status = o.outcome === 'Accepted' ? 'accepted' as const : o.outcome === 'Dismissed' ? 'dismissed' as const : o.outcome === 'Reverted' ? 'reverted' as const : 'pending' as const;
        result.push({
          suggestion: { original: o.originalText, suggested: o.suggestedText, reason: 'Line Edit' },
          status
        });
      }
      return result.sort((a, b) => AnalysisPanelComponent.suggestionStatusOrder(a.status) - AnalysisPanelComponent.suggestionStatusOrder(b.status));
    }
    const id = (current.id || '').toLowerCase();
    const keyPrefix = `${id}-`;
    const keyBased = suggestions.map(s => {
      const orig = this.normalizeKeyText(s.original);
      const sugg = this.normalizeKeyText(s.suggested);
      const key = `${keyPrefix}${orig}-${sugg}`;
      if (this.acceptedLineEditKeys.has(key)) return { suggestion: s, status: 'accepted' as const };
      if (this.dismissedLineEditKeys.has(key)) return { suggestion: s, status: 'dismissed' as const };
      return { suggestion: s, status: 'pending' as const };
    });
    return keyBased.sort((a, b) => AnalysisPanelComponent.suggestionStatusOrder(a.status) - AnalysisPanelComponent.suggestionStatusOrder(b.status));
  }

  /** Filtered by historySuggestionStatusFilter for Line Edit history. */
  filteredLineEditSuggestionsWithStatus(current: AnalysisResultDto): { suggestion: AnalysisSuggestion; status: 'accepted' | 'dismissed' | 'reverted' | 'pending' }[] {
    const list = this.lineEditSuggestionsWithStatus(current);
    if (this.historySuggestionStatusFilter === 'all') return list;
    return list.filter(item => item.status === this.historySuggestionStatusFilter);
  }

  private toLineEditSuggestionsWithOffsets(
    suggestions: Array<{ original: string; suggested: string; reason: string; category: string }>,
    current: AnalysisResultDto
  ): AnalysisSuggestion[] {
    return suggestions.map(s => {
      const suggestion: AnalysisSuggestion = { ...s };
      if (this.documentText) {
        const idx = this.documentText.indexOf(s.original);
        if (idx >= 0) {
          suggestion.startOffset = idx;
          suggestion.endOffset = idx + s.original.length;
        }
      }
      return suggestion;
    });
  }

  onLineEditAccept(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    const startOffset = suggestion.startOffset;
    const endOffset = suggestion.endOffset;
    if (startOffset != null && endOffset != null) {
      this.applyCorrection.emit({
        text: suggestion.suggested,
        startOffset,
        endOffset,
        originalText: suggestion.original
      });
    } else {
      this.applyCorrection.emit({ text: suggestion.suggested, originalText: suggestion.original });
    }
    const id = (current.id || '').toLowerCase();
    const orig = this.normalizeKeyText(suggestion.original);
    const sugg = this.normalizeKeyText(suggestion.suggested);
    this.acceptedLineEditKeys.add(`${id}-${orig}-${sugg}`);
    if (this.bookId && this.chapterId && current.id) {
      this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, current.id, suggestion.original, suggestion.suggested, 'Accepted').subscribe({ error: () => {} });
    }
  }

  onLineEditDismiss(suggestion: AnalysisSuggestion, current: AnalysisResultDto): void {
    const id = (current.id || '').toLowerCase();
    const orig = this.normalizeKeyText(suggestion.original);
    const sugg = this.normalizeKeyText(suggestion.suggested);
    this.dismissedLineEditKeys.add(`${id}-${orig}-${sugg}`);
    if (this.bookId && this.chapterId && current.id) {
      this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, current.id, suggestion.original, suggestion.suggested, 'Dismissed').subscribe({ error: () => {} });
    }
  }

  onShowInDocument(s: AnalysisSuggestion): void {
    if (s.startOffset != null && s.endOffset != null) {
      this.showInDocument.emit({
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original || undefined
      });
    }
  }

  /** Auto-select the first suggestion's range in the editor so the user immediately sees what changed. */
  private autoShowFirstSuggestion(): void {
    if (!this.proofreadSuggestions.length) return;
    const first = this.proofreadSuggestions[0];
    if (first.startOffset != null && first.endOffset != null) {
      this.showInDocument.emit({
        startOffset: first.startOffset,
        endOffset: first.endOffset,
        originalText: first.original || undefined
      });
    }
  }

  onProofreadAccept(s: AnalysisSuggestion): void {
    if (s.startOffset != null && s.endOffset != null) {
      this.applyCorrection.emit({
        text: s.suggested,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original,
        analysisId: this.latestResult?.id ?? undefined
      });
    } else {
      this.applyCorrection.emit({ text: s.suggested, originalText: s.original, analysisId: this.latestResult?.id ?? undefined });
    }
    this.proofreadSuggestions = this.proofreadSuggestions.filter(x => x !== s);
    if (this.latestResult) {
      const key = this.proofreadSuggestionKey(this.latestResult, s);
      this.acceptedProofreadHistoryKeys.add(key);
      if (this.bookId && this.chapterId && this.latestResult.id) {
        this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, this.latestResult.id, s.original, s.suggested, 'Accepted').subscribe({ error: () => {} });
      }
    }
    this.emitSuggestionRanges();
    this.cdr.detectChanges();
  }

  onProofreadDismiss(s: AnalysisSuggestion): void {
    this.proofreadSuggestions = this.proofreadSuggestions.filter(x => x !== s);
    if (this.latestResult) {
      const key = this.proofreadSuggestionKey(this.latestResult, s);
      this.dismissedProofreadHistoryKeys.add(key);
      if (this.bookId && this.chapterId && this.latestResult.id) {
        this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, this.latestResult.id, s.original, s.suggested, 'Dismissed').subscribe({ error: () => {} });
      }
    }
    this.emitSuggestionRanges();
    this.cdr.detectChanges();
  }

  onProofreadHistoryAccept(s: AnalysisSuggestion, current: AnalysisResultDto): void {
    if (s.startOffset != null && s.endOffset != null) {
      this.applyCorrection.emit({
        text: s.suggested,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        originalText: s.original,
        analysisId: current.id
      });
    } else {
      this.applyCorrection.emit({ text: s.suggested, originalText: s.original, analysisId: current.id });
    }
    const key = this.proofreadSuggestionKey(current, s);
    this.acceptedProofreadHistoryKeys.add(key);
    if (this.bookId && this.chapterId && current.id) {
      this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, current.id, s.original, s.suggested, 'Accepted').subscribe({ error: () => {} });
    }
  }

  onProofreadHistoryDismiss(s: AnalysisSuggestion, current: AnalysisResultDto): void {
    const key = this.proofreadSuggestionKey(current, s);
    this.dismissedProofreadHistoryKeys.add(key);
    if (this.bookId && this.chapterId && current.id) {
      this.analysisService.saveSuggestionOutcome(this.bookId, this.chapterId, current.id, s.original, s.suggested, 'Dismissed').subscribe({ error: () => {} });
    }
  }

  /** Emit current proofread suggestion ranges so the editor can show highlights. When highlightSuggestionsInDocument is false, emits []. */
  private emitSuggestionRanges(): void {
    if (!this.highlightSuggestionsInDocument) {
      this.suggestionRangesChange.emit([]);
      return;
    }
    const ranges = this.proofreadSuggestions
      .filter(s => s.startOffset != null && s.endOffset != null)
      .map(s => ({ startOffset: s.startOffset!, endOffset: s.endOffset! }));
    this.suggestionRangesChange.emit(ranges);
  }

  /** Called when the user toggles "Highlight suggestion words in document"; re-emit so editor updates. */
  onHighlightOptionChange(): void {
    this.emitSuggestionRanges();
  }

  /** Parse structuredResult JSON into label/value pairs for metric cards. */
  metricCards(structuredResult: string): { label: string; value: string }[] {
    try {
      const data = JSON.parse(structuredResult) as Record<string, unknown>;
      const cards: { label: string; value: string }[] = [];
      const g = data['grammaticalityScore'];
      if (typeof g === 'number')
        cards.push({ label: 'Grammaticality', value: `${g.toFixed(2)} / 1.0` });
      const w = data['wordCount'];
      if (typeof w === 'number')
        cards.push({ label: 'Words', value: String(w) });
      const u = data['uniqueWordCount'];
      if (typeof u === 'number')
        cards.push({ label: 'Unique words', value: String(u) });
      const r = data['readabilityScore'];
      if (typeof r === 'number')
        cards.push({ label: 'Readability', value: `${r.toFixed(1)} / 10` });
      const themes = data['themes'];
      if (themes && Array.isArray(themes))
        cards.push({ label: 'Themes', value: String(themes.length) });
      const suggestions = data['suggestions'];
      if (suggestions && Array.isArray(suggestions))
        cards.push({ label: 'Suggestions', value: String(suggestions.length) });
      return cards;
    } catch {
      return [];
    }
  }

  /**
   * Splits analysis result text into list items (numbered "1. ... 2. ..." from the model)
   * or returns a single element for "no errors" / plain message.
   */
  analysisItems(text: string): string[] {
    if (!text?.trim()) return [];
    const trimmed = text.trim();
    if (!/\d+\.\s/.test(trimmed)) return [trimmed];
    const parts = trimmed.split(/\s*\d+\.\s*/).map(s => s.trim()).filter(Boolean);
    return parts.length ? parts : [trimmed];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['chapterId'] || changes['sceneId']) {
      // Clear run state so we don't show another chapter's suggestions; history load will restore if available
      this.latestResult = null;
      this.proofreadSuggestions = [];
      this.proofreadSuggestionsUnreliable = false;
      this.dismissedProofreadHistoryKeys.clear();
      this.acceptedProofreadHistoryKeys.clear();
      this.dismissedLineEditKeys.clear();
      this.acceptedLineEditKeys.clear();
      this.streamingText = '';
      this.hasRestoredProofreadForCurrentContext = false;
      // Reset history filter so we load all types for the new chapter and can restore Proofread state
      this.historyFilterType = null;
      if (this.bookId && this.chapterId) {
        this.loadTemplates();
        this.loadHistory();
      }
    }
    if (changes['bookLanguage'] && this.bookId && this.chapterId) {
      this.loadTemplates();
    }
    if (changes['documentText']) {
      // Only restore when we have no suggestions yet and document text is for the current chapter,
      // and we haven't already restored for this context (avoids re-diffing on every edit).
      if (
        !this.hasRestoredProofreadForCurrentContext &&
        this.proofreadSuggestions.length === 0 &&
        this.documentMatchesCurrentContext
      ) {
        this.restoreProofreadStateFromLatestResult();
      }
    }
  }

  /**
   * When we have a Proofread latestResult and document text for the current chapter,
   * recompute proofread suggestions and emit ranges so highlights show.
   * Filters out suggestions that are already accepted or dismissed so they don't reappear on Run tab after navigating back.
   */
  private restoreProofreadStateFromLatestResult(): void {
    if (!this.documentText || !this.latestResult) return;
    const type = this.latestResult.analysisType || this.latestResult.type;
    if (type !== 'Proofread' || !this.latestResult.resultText) return;
    const all = proofreadDiff(this.documentText, this.latestResult.resultText);
    this.proofreadSuggestions = all.filter(s => {
      const key = this.proofreadSuggestionKey(this.latestResult!, s);
      return !this.acceptedProofreadHistoryKeys.has(key) && !this.dismissedProofreadHistoryKeys.has(key);
    });
    this.hasRestoredProofreadForCurrentContext = true;
    this.emitSuggestionRanges();
  }

  /** True when documentText is known to be for the current chapter/scene (so safe to restore from latestResult). */
  private get documentMatchesCurrentContext(): boolean {
    if (this.documentChapterId !== this.chapterId) return false;
    return (this.documentSceneId ?? null) === (this.sceneId ?? null);
  }

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  private loadTemplates(): void {
    this.analysisService.getTemplates().subscribe({
      next: (items) => {
        this.templates = (items ?? []).filter(t => !t.language || t.language === this.language);
      },
      error: () => {
        this.templates = [];
      }
    });
  }

  private loadHistory(mergeWithExisting = false): void {
    if (!this.bookId || !this.chapterId) return;
    const loadingChapterId = this.chapterId;
    const loadingSceneId = this.sceneId ?? undefined;
    const existingHistory = mergeWithExisting ? this.history : [];
    this.analysisService.getHistory(this.bookId, this.chapterId, this.historyFilterType ?? undefined, this.sceneId ?? undefined).subscribe({
      next: (items) => {
        // Ignore if user switched chapter/scene before this response
        if (this.chapterId !== loadingChapterId || (this.sceneId ?? undefined) !== loadingSceneId) return;
        const fromApi = items ?? [];
        this.history = mergeWithExisting ? this.mergeHistoryWithExisting(fromApi, existingHistory) : fromApi;
        this.selectedIndex = 0;
        // Prepend streaming run (no id) so it appears in History and Accepted/Dismissed keys match
        if (this.latestResult && !this.latestResult.id) {
          this.history = [this.latestResult, ...this.history];
        }
        // Full reload: clear outcome key sets so displayed state is exactly what the API returned (avoids stale Reverted/Accepted and duplicate display).
        if (!mergeWithExisting) {
          this.acceptedProofreadHistoryKeys.clear();
          this.dismissedProofreadHistoryKeys.clear();
          this.acceptedLineEditKeys.clear();
          this.dismissedLineEditKeys.clear();
        }
        // Populate Accepted/Dismissed key Sets from API *before* restoring Run tab so we filter correctly
        this.applyEmbeddedSuggestionOutcomes();
        const first = this.history[0];
        if (first && (first.analysisType || first.type) === 'Proofread') {
          this.latestResult = first;
          if (this.documentMatchesCurrentContext && this.documentText) {
            this.restoreProofreadStateFromLatestResult();
          }
        }
        this.cdr.detectChanges();
      },
      error: () => {
        // swallow for now; panel stays empty
      }
    });
  }

  /** Stable key for an analysis result (for deduplication when merging API + existing). */
  private historyItemKey(r: AnalysisResultDto): string {
    return (r.id && r.id.trim()) ? r.id.toLowerCase() : `${r.chapterId}-${r.sceneId ?? ''}-${r.createdAt}`;
  }

  /** Merge API history with existing in-memory history; existing items not in API are kept (archived). */
  private mergeHistoryWithExisting(fromApi: AnalysisResultDto[], existing: AnalysisResultDto[]): AnalysisResultDto[] {
    const apiKeys = new Set(fromApi.map(r => this.historyItemKey(r)));
    const merged = [...fromApi];
    for (const item of existing) {
      if (!apiKeys.has(this.historyItemKey(item))) {
        merged.push(item);
        apiKeys.add(this.historyItemKey(item));
      }
    }
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return merged;
  }

  /** Populate Accepted/Dismissed key Sets from suggestionOutcomes embedded in each history item (from GET analyses).
   * Only add Accepted and Dismissed; Reverted and Pending stay out of key sets so status comes from embedded outcome. */
  private applyEmbeddedSuggestionOutcomes(): void {
    for (const item of this.history) {
      const outcomes = item.suggestionOutcomes;
      if (!outcomes?.length) continue;
      const type = (item.analysisType || item.type) || '';
      const id = (item.id || '').toLowerCase();
      for (const o of outcomes) {
        const outcome = (o.outcome || '').trim();
        if (outcome !== 'Accepted' && outcome !== 'Dismissed') continue;
        const orig = this.normalizeKeyText(o.originalText);
        const sugg = this.normalizeKeyText(o.suggestedText);
        const key = `${id}-${orig}-${sugg}`;
        if (type === 'Proofread') {
          if (outcome === 'Accepted') this.acceptedProofreadHistoryKeys.add(key);
          else this.dismissedProofreadHistoryKeys.add(key);
        } else if (type === 'LineEdit') {
          if (outcome === 'Accepted') this.acceptedLineEditKeys.add(key);
          else this.dismissedLineEditKeys.add(key);
        }
      }
    }
  }

  runAnalysis(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunning) return;
    this.isRunning = true;
    this.runAnalysisAfterSave();
  }

  private runAnalysisAfterSave(): void {
    const run = () => {
      // Cancel any previous progress polling before starting a new run
      this.progressStop$.next();
      this.analysisStarted.emit();
      this.emitInitialStatusForRun();
      this.runStartedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.lastRunDurationLabel = null;
       this.currentProgressPercent = null;
       this.analysisProgressPercent.emit(null);
      setTimeout(() => this.doRunAnalysis(), 0);
    };
    if (this.saveBeforeRun) {
      this.saveBeforeRun()
        .then(run)
        .catch(() => {
          this.isRunning = false;
          this.analysisCompleted.emit();
        });
    } else {
      run();
    }
  }

  private doRunAnalysis(): void {
    // Decide between async job-based Proofread (for long-running chunked runs) and the existing synchronous path.
    if (this.shouldUseAsyncProofreadJob()) {
      this.doRunAnalysisAsyncJob();
      return;
    }
    this.doRunAnalysisSync();
  }

  /** Heuristic: use async job flow for Proofread when the document is long enough that the backend will likely chunk it. */
  private shouldUseAsyncProofreadJob(): boolean {
    if (this.selectedAnalysisType !== 'Proofread') return false;
    if (!this.documentText?.trim()) return false;
    // Same default chunk target as backend AiOptions.ProofreadChunkTargetWords (500 words).
    const words = this.documentText.trim().split(/\s+/).filter(Boolean).length;
    return words > 500;
  }

  /** Legacy synchronous /analyze path (kept for short texts and non-Proofread types, and as a fallback). */
  private doRunAnalysisSync(): void {
    if (!this.bookId || !this.chapterId || !this.canRun) return;
    this.isRunning = true;
    this.runError = null;
    this.streamingText = '';
    this.proofreadSuggestions = [];
    this.proofreadSuggestionsUnreliable = false;
    this.emitSuggestionRanges();

    this.analysisService.run(this.bookId, this.chapterId, {
      analysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || undefined) : undefined,
      language: this.language,
      stream: false
    }, this.sceneId ?? undefined).subscribe({
      next: (result) => {
        this.isRunning = false;
        this.runError = null;
        this.history = [result, ...this.history];
        this.selectedIndex = 0;
        this.latestResult = result;
        this.activeSubTab = 'run';
        if ((result.analysisType || result.type) === 'Proofread' && this.documentText != null && result.resultText) {
          this.proofreadOriginalDocumentByRunKey.set(this.proofreadRunKeyForResult(result), this.documentText);
          const raw = proofreadDiff(this.documentText, result.resultText);
          this.proofreadSuggestions = raw;
          this.proofreadSuggestionsUnreliable = false;
          this.hasRestoredProofreadForCurrentContext = true;
          this.emitSuggestionRanges();
          this.autoShowFirstSuggestion();
        }
        this.startProgressPollingIfNeeded(result);
        this.setLastRunDuration();
        this.analysisCompleted.emit();
      },
      error: (err) => {
        this.isRunning = false;
        this.runError = err?.error?.error ?? err?.message ?? 'Analysis failed.';
        this.progressStop$.next();
        this.setLastRunDuration();
        this.analysisCompleted.emit();
      }
    });
  }

  /** Async job-based Proofread flow: start analysis-jobs, poll progress immediately, and fetch final result by jobId. */
  private doRunAnalysisAsyncJob(): void {
    if (!this.bookId || !this.chapterId || !this.canRun) return;
    this.isRunning = true;
    this.runError = null;
    this.streamingText = '';
    this.proofreadSuggestions = [];
    this.proofreadSuggestionsUnreliable = false;
    this.emitSuggestionRanges();

    const requestBody = {
      analysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || undefined) : undefined,
      language: this.language,
      stream: false
    } as RunAnalysisRequest;

    this.analysisService.startAsync(this.bookId, this.chapterId, requestBody, this.sceneId ?? undefined).subscribe({
      next: (res) => {
        if (!res?.jobId) {
          // Fallback to sync path if backend did not return a jobId.
          this.doRunAnalysisSync();
          return;
        }
        this.currentProgressJobId = res.jobId;
        this.startProgressPollingForJob(res.jobId);
      },
      error: (err) => {
        // If async endpoint is not available or rejects (e.g. non-proofread), fall back to sync path.
        this.doRunAnalysisSync();
      }
    });
  }

  runStreaming(): void {
    if (!this.bookId || !this.chapterId || !this.canRun || this.isRunning) return;
    const run = () => {
      this.isRunning = true;
      this.analysisStarted.emit();
      this.emitInitialStatusForRun(true);
      this.runStartedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.lastRunDurationLabel = null;
      this.currentProgressPercent = null;
      this.analysisProgressPercent.emit(null);
      setTimeout(() => this.doRunStreaming(), 0);
    };
    if (this.saveBeforeRun) {
      this.saveBeforeRun()
        .then(run)
        .catch(() => {
          this.isRunning = false;
          this.analysisCompleted.emit();
        });
    } else {
      run();
    }
  }

  private doRunStreaming(): void {
    if (!this.bookId || !this.chapterId || !this.canRun) return;
    this.isRunning = true;
    this.runError = null;
    this.streamingText = '';
    this.proofreadSuggestions = [];
    this.proofreadSuggestionsUnreliable = false;
    this.emitSuggestionRanges();

    this.analysisService.runStream(this.bookId, this.chapterId, {
      analysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || undefined) : undefined,
      language: this.language,
      stream: true
    }, this.sceneId ?? undefined).subscribe({
      next: (token) => {
        this.streamingText += token;
      },
      error: (err) => {
        this.isRunning = false;
        this.runError = err?.error?.error ?? err?.message ?? 'Analysis failed.';
        this.analysisCompleted.emit();
      },
      complete: () => {
        this.isRunning = false;
        this.latestResult = {
          id: '',
          chapterId: this.chapterId!,
          type: this.selectedAnalysisType,
          resultText: this.streamingText,
          modelName: '',
          createdAt: new Date().toISOString(),
          analysisType: this.selectedAnalysisType
        };
        this.activeSubTab = 'run';
        if (this.selectedAnalysisType === 'Proofread' && this.documentText != null && this.streamingText) {
          this.proofreadOriginalDocumentByRunKey.set(this.proofreadRunKeyForResult(this.latestResult), this.documentText);
          const raw = proofreadDiff(this.documentText, this.streamingText);
          this.proofreadSuggestions = raw;
          this.proofreadSuggestionsUnreliable = false;
          this.hasRestoredProofreadForCurrentContext = true;
          this.emitSuggestionRanges();
          this.autoShowFirstSuggestion();
        }
        this.loadHistory(true);
        this.setLastRunDuration();
        this.analysisCompleted.emit();
      }
    });
  }

  /** Emit an initial human-readable status for the editor's global spinner. */
  private emitInitialStatusForRun(isStreaming: boolean = false): void {
    const type = this.selectedAnalysisType || 'Analysis';
    // For Proofread we can estimate how many 500-word chunks the backend will use (same default as AiOptions.ProofreadChunkTargetWords).
    if (type === 'Proofread' && this.documentText?.trim()) {
      const words = this.documentText.trim().split(/\s+/).filter(Boolean).length;
      const chunkSize = 500;
      const chunks = Math.max(1, Math.ceil(words / chunkSize));
      if (chunks > 1) {
        const mode = isStreaming ? 'streaming' : 'chunked';
        this.analysisStatus.emit(`Proofread ${mode} · about ${chunks} parts (~${chunkSize} words each)`);
        return;
      }
    }
    const label = type === 'Custom' ? 'Custom analysis' : `${type} analysis`;
    const suffix = isStreaming ? ' (streaming)…' : '…';
    this.analysisStatus.emit(`Running ${label}${suffix}`);
  }

  /** Emit a human-readable status + numeric progress for a given progress snapshot. Returns the normalized status. */
  private handleProgressUpdate(p: AnalysisProgressDto): string {
    const status = (p.status || '').toLowerCase();
    const current = p.currentChunk;
    const total = p.totalChunks || 0;
    let phase: string;
    if (status === 'failed') {
      phase = 'failed – see error message';
    } else if (status === 'canceled') {
      phase = 'canceled';
    } else if (total > 0 && current === 1) {
      phase = 'analyzing first part…';
    } else if (total > 0 && current === total) {
      phase = 'final part…';
    } else if (total > 0 && current > 1) {
      phase = 'analyzing middle sections…';
    } else if (status === 'pending') {
      phase = 'preparing chunks…';
    } else {
      phase = 'running…';
    }

    const prefix = total > 0 && current > 0
      ? `Proofread ${current}/${total}`
      : total > 0
        ? `Proofread 0/${total}`
        : 'Proofread';

    const message = `${prefix} – ${phase}`;
    this.analysisStatus.emit(message);

    if (typeof p.estimatedCompletionPercent === 'number' && p.estimatedCompletionPercent >= 0) {
      this.currentProgressPercent = Math.max(0, Math.min(100, p.estimatedCompletionPercent));
      this.analysisProgressPercent.emit(this.currentProgressPercent);
    }

    return status;
  }

  /** Start polling backend analysis progress for a chunked Proofread run, emitting status updates for the editor overlay. */
  private startProgressPollingIfNeeded(result: AnalysisResultDto): void {
    const type = result.analysisType || result.type;
    if (type !== 'Proofread' || !this.bookId || !this.chapterId || !result.jobId) {
      return;
    }
    this.currentProgressJobId = result.jobId;
    // Stop any previous polling and use a shared stop signal for this component
    this.progressStop$.next();
    this.analysisProgressService
      .pollProgress(this.bookId, this.chapterId, result.jobId, this.progressStop$)
      .subscribe({
        next: (p: AnalysisProgressDto) => {
          if (!p) return;
          const status = this.handleProgressUpdate(p);
          if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
            this.progressStop$.next();
            if (status === 'succeeded') {
              this.currentProgressPercent = 100;
            }
            this.analysisProgressPercent.emit(this.currentProgressPercent);
          }
        },
        error: () => {
          // Stop polling on error and fall back to a generic message while the run completes
          this.progressStop$.next();
          if (this.isRunning) {
            this.analysisStatus.emit('Running Proofread analysis…');
          }
        }
      });
  }

  /**
   * Start polling progress for an async Proofread job that was started via analysis-jobs.
   * When the job reaches a terminal state, fetch the final result by jobId and update the panel.
   */
  private startProgressPollingForJob(jobId: string): void {
    if (!this.bookId || !this.chapterId) return;
    this.currentProgressJobId = jobId;
    this.progressStop$.next();
    this.analysisProgressService
      .pollProgress(this.bookId, this.chapterId, jobId, this.progressStop$)
      .subscribe({
        next: (p: AnalysisProgressDto) => {
          if (!p) return;
          const status = this.handleProgressUpdate(p);

          if (status === 'succeeded') {
            this.progressStop$.next();
            this.loadFinalResultForJob(jobId);
          } else if (status === 'failed' || status === 'canceled') {
            this.progressStop$.next();
            this.isRunning = false;
            if (status === 'failed') {
              this.runError = 'Proofread failed – see error message.';
            }
            this.analysisCompleted.emit();
          }
        },
        error: () => {
          // Stop polling on error and fall back to a generic message while the run completes
          this.progressStop$.next();
          if (this.isRunning) {
            this.analysisStatus.emit('Running Proofread analysis…');
          }
        }
      });
  }

  /** After an async job succeeds, resolve the final AnalysisResult by jobId and update history + Run tab. */
  private loadFinalResultForJob(jobId: string): void {
    if (!this.bookId || !this.chapterId) return;
    this.analysisService.getByJob(this.bookId, this.chapterId, jobId).subscribe({
      next: (result) => {
        this.isRunning = false;
        this.runError = null;
        this.setLastRunDuration();
        // Prepend to history and select as latest
        this.history = [result, ...this.history];
        this.selectedIndex = 0;
        this.latestResult = result;
        this.activeSubTab = 'run';
        if ((result.analysisType || result.type) === 'Proofread' && this.documentText != null && result.resultText) {
          this.proofreadOriginalDocumentByRunKey.set(this.proofreadRunKeyForResult(result), this.documentText);
          const raw = proofreadDiff(this.documentText, result.resultText);
          this.proofreadSuggestions = raw;
          this.proofreadSuggestionsUnreliable = false;
          this.hasRestoredProofreadForCurrentContext = true;
          this.emitSuggestionRanges();
          this.autoShowFirstSuggestion();
        }
        this.analysisCompleted.emit();
      },
      error: () => {
        // If we can't resolve by job id (e.g. slight delay), fall back to reloading history.
        this.isRunning = false;
        this.setLastRunDuration();
        this.loadHistory(true);
        this.analysisCompleted.emit();
      }
    });
  }

  /** Compute and store a human-readable duration label for the last run. */
  private setLastRunDuration(): void {
    if (this.runStartedAt == null) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const ms = Math.max(0, now - this.runStartedAt);
    const seconds = Math.round(ms / 1000);
    let label: string;
    if (seconds < 60) {
      label = `${seconds}s`;
    } else {
      const mins = Math.floor(seconds / 60);
      const rem = seconds % 60;
      label = rem ? `${mins}m ${rem}s` : `${mins}m`;
    }
    this.lastRunDurationLabel = label;
  }

  saveAsTemplate(): void {
    const trimmed = (this.prompt || '').trim();
    if (!trimmed) return;

    const name = prompt('Template name (for re-use later):', '')?.trim();
    if (!name) return;

    const templateText = `${trimmed}\n\n---\nטקסט הפרק:\n{chapter_text}`;

    this.analysisService.createTemplate({
      name,
      type: this.selectedAnalysisType === 'Custom' ? 'Custom' : this.selectedAnalysisType,
      templateText,
      language: this.language
    }).subscribe({
      next: (created) => {
        this.templates = [created, ...this.templates];
      },
      error: () => {}
    });
  }
}

