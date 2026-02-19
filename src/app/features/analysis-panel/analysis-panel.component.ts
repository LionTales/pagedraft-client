import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ANALYSIS_TYPES, AnalysisResultDto, PromptTemplateDto } from '../../core/models/analysis';
import { AnalysisService } from '../../core/services/analysis.service';

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
      </section>

      <section class="history-section" *ngIf="history.length || streamingText; else emptyHistory">
        <article class="result-view" *ngIf="streamingText">
          <h4>Live result</h4>
          <ul class="analysis-list" *ngIf="analysisItems(streamingText).length > 1; else singleBlock">
            <li *ngFor="let item of analysisItems(streamingText)">{{ item }}</li>
          </ul>
          <ng-template #singleBlock>
            <p class="analysis-single">{{ streamingText }}</p>
          </ng-template>
        </article>

        <div class="history-header">
          <span class="history-label">History</span>
          <div class="history-filter">
            <button type="button" [class.active]="!historyFilterType" (click)="setHistoryFilter(null)">All</button>
            <button type="button" *ngFor="let opt of analysisTypes" [class.active]="historyFilterType === opt.value"
              (click)="setHistoryFilter(opt.value)">{{ opt.label }}</button>
          </div>
        </div>
        <nav class="tabs">
          <button
            type="button"
            *ngFor="let item of history; let i = index"
            [class.active]="i === selectedIndex"
            (click)="selectedIndex = i">
            {{ item.analysisType || item.type }} · {{ item.createdAt | date:'short' }}
          </button>
        </nav>
        <article class="result-view" *ngIf="history.length && history[selectedIndex] as current">
          <h4>{{ current.analysisType || current.type }} ({{ current.modelName }})</h4>
          <!-- Line Edit: show suggestions list + overallFeedback -->
          <ng-container *ngIf="getLineEdit(current) as lineEdit">
            <p class="line-edit-overall" *ngIf="lineEdit.overallFeedback">{{ lineEdit.overallFeedback }}</p>
            <div class="line-edit-suggestions">
              <div class="line-edit-item" *ngFor="let s of lineEdit.suggestions; let i = index">
                <span class="line-edit-num">{{ i + 1 }}.</span>
                <div class="line-edit-fields">
                  <div class="line-edit-original" *ngIf="s.original !== s.suggested">
                    <span class="line-edit-label">Original:</span> {{ s.original }}
                  </div>
                  <div class="line-edit-suggested" *ngIf="s.original !== s.suggested">
                    <span class="line-edit-label">Suggested:</span> {{ s.suggested }}
                  </div>
                  <div class="line-edit-reason">
                    <span class="line-edit-label">Reason:</span> {{ s.reason }}
                  </div>
                  <span class="line-edit-category">{{ s.category }}</span>
                </div>
              </div>
            </div>
          </ng-container>
          <!-- Other structured (metric cards) -->
          <div class="metric-cards" *ngIf="!getLineEdit(current) && current.structuredResult && metricCards(current.structuredResult).length; else textResult">
            <div class="metric-card" *ngFor="let card of metricCards(current.structuredResult)">
              <span class="metric-label">{{ card.label }}</span>
              <span class="metric-value">{{ card.value }}</span>
            </div>
          </div>
          <ng-template #textResult>
            <ul class="analysis-list" *ngIf="!getLineEdit(current) && analysisItems(current.resultText).length > 1; else singleHistory">
              <li *ngFor="let item of analysisItems(current.resultText)">{{ item }}</li>
            </ul>
            <ng-template #singleHistory>
              <p class="analysis-single" *ngIf="!getLineEdit(current)">{{ current.resultText }}</p>
            </ng-template>
          </ng-template>
        </article>
      </section>

      <ng-template #emptyHistory>
        <p class="muted">No analysis history yet for this {{ sceneId ? 'scene' : 'chapter' }}.</p>
      </ng-template>
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
    .history-section {
      border-top: 1px solid #eee;
      padding-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      flex: 1;
      min-height: 0;
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
  `]
})
export class AnalysisPanelComponent implements OnChanges {
  @Input() bookId: string | null = null;
  @Input() chapterId: string | null = null;
  @Input() sceneId: string | null = null;
  @Output() analysisStarted = new EventEmitter<void>();
  @Output() analysisCompleted = new EventEmitter<void>();

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

  constructor(private analysisService: AnalysisService) {}

  get canRun(): boolean {
    if (!this.bookId || !this.chapterId) return false;
    if (this.selectedAnalysisType === 'Custom') return !!this.prompt?.trim();
    return true;
  }

  setHistoryFilter(type: string | null): void {
    this.historyFilterType = type;
    this.loadHistory();
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
      if (this.bookId && this.chapterId) {
        this.loadTemplates();
        this.loadHistory();
      }
    }
  }

  private loadTemplates(): void {
    this.analysisService.getTemplates().subscribe({
      next: (items) => {
        this.templates = (items ?? []).filter(t => t.language === 'he');
      },
      error: () => {
        this.templates = [];
      }
    });
  }

  private loadHistory(): void {
    if (!this.bookId || !this.chapterId) return;
    this.analysisService.getHistory(this.bookId, this.chapterId, this.historyFilterType ?? undefined, this.sceneId ?? undefined).subscribe({
      next: (items) => {
        this.history = items ?? [];
        this.selectedIndex = 0;
      },
      error: () => {
        // swallow for now; panel stays empty
      }
    });
  }

  runAnalysis(): void {
    if (!this.bookId || !this.chapterId || !this.canRun) return;
    this.isRunning = true;
    this.streamingText = '';
    this.analysisStarted.emit();

    this.analysisService.run(this.bookId, this.chapterId, {
      analysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || undefined) : undefined,
      language: 'he',
      stream: false
    }, this.sceneId ?? undefined).subscribe({
      next: (result) => {
        this.isRunning = false;
        this.history = [result, ...this.history];
        this.selectedIndex = 0;
        this.analysisCompleted.emit();
      },
      error: () => {
        this.isRunning = false;
        this.analysisCompleted.emit();
      }
    });
  }

  runStreaming(): void {
    if (!this.bookId || !this.chapterId || !this.canRun) return;
    this.isRunning = true;
    this.streamingText = '';
    this.analysisStarted.emit();

    this.analysisService.runStream(this.bookId, this.chapterId, {
      analysisType: this.selectedAnalysisType,
      customPrompt: this.selectedAnalysisType === 'Custom' ? (this.prompt || undefined) : undefined,
      language: 'he',
      stream: true
    }, this.sceneId ?? undefined).subscribe({
      next: (token) => {
        this.streamingText += token;
      },
      error: () => {
        this.isRunning = false;
        this.analysisCompleted.emit();
      },
      complete: () => {
        this.isRunning = false;
        // After a streaming run completes, refresh history so the
        // newly persisted AnalysisResult appears in the tabs.
        this.loadHistory();
        this.analysisCompleted.emit();
      }
    });
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
      language: 'he'
    }).subscribe({
      next: (created) => {
        this.templates = [created, ...this.templates];
      },
      error: () => {}
    });
  }
}

