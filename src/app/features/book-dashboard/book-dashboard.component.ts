import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BookService } from '../../core/services/book.service';
import {
  BookProfileDto,
  CharacterAnalysisResult,
  StoryAnalysisResult,
  CharacterEntry,
  CharacterRelationship,
  PlotStructure,
  ConflictEntry
} from '../../core/models/book';
import { AnalysisResultDto } from '../../core/models/analysis';

@Component({
  selector: 'app-book-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="book-dashboard" dir="rtl">
      <header class="dashboard-header">
        <h3 class="dashboard-title">לוח ספר: {{ bookTitle }}</h3>
        <button
          type="button"
          class="refresh-btn"
          [disabled]="refreshing"
          (click)="onRefresh()"
          title="רענן פרופיל">
          {{ refreshing ? '…' : '⟳' }}
        </button>
      </header>

      @if (loading && !profile) {
        <p class="empty-hint">טוען…</p>
      } @else if (error) {
        <p class="error-hint">{{ error }}</p>
      } @else if (!profile) {
        <p class="empty-hint">לחץ על ⟳ כדי לנתח את הספר (סיכום פרקים ובניית פרופיל).</p>
      } @else {
        <section class="card overview-card">
          <h4>סקירה</h4>
          <div class="overview-grid">
            <div class="overview-item"><span class="label">ז'אנר</span><span class="value">{{ profile.genre ?? '—' }}</span></div>
            <div class="overview-item"><span class="label">תת-ז'אנר</span><span class="value">{{ profile.subGenre ?? '—' }}</span></div>
            <div class="overview-item"><span class="label">קהל יעד</span><span class="value">{{ profile.targetAudience ?? '—' }}</span></div>
            <div class="overview-item"><span class="label">רמת ספרות</span>
              <span class="value level-bar">
                <span class="level-fill" [style.width.%]="(profile.literatureLevel ?? 0) * 10"></span>
                {{ profile.literatureLevel ?? 0 }}/10
              </span>
            </div>
            <div class="overview-item"><span class="label">רישום שפה</span><span class="value">{{ profile.languageRegister ?? '—' }}</span></div>
          </div>
        </section>

        <section class="card synopsis-card">
          <h4>תקציר</h4>
          @if (profile.synopsis) {
            <div class="synopsis-text">
              @if (synopsisExpanded) {
                <span class="synopsis-full">{{ profile.synopsis }}</span>
                <button type="button" class="link-btn" (click)="synopsisExpanded = false">▲ פחות</button>
              } @else {
                <span class="synopsis-preview">{{ synopsisPreview }}</span>
                @if (profile.synopsis.length > 200) {
                  <button type="button" class="link-btn" (click)="synopsisExpanded = true">▼ עוד</button>
                }
              }
            </div>
          } @else {
            <p class="muted">אין תקציר.</p>
          }
        </section>

        <section class="card characters-card">
          <h4>דמויות</h4>
          @if (charactersParsed) {
            <div class="characters-scroll">
              @for (c of charactersParsed.characters; track c.name) {
                <div class="character-card">
                  <div class="char-avatar">{{ initials(c.name) }}</div>
                  <div class="char-name">{{ c.name }}</div>
                  <span class="char-role">{{ c.role || '—' }}</span>
                </div>
              }
            </div>
            @if (charactersParsed.relationships && charactersParsed.relationships.length) {
              <div class="relationships">
                <span class="label">יחסים:</span>
                @for (r of charactersParsed.relationships; track r.character1 + r.character2 + r.relationship) {
                  <div class="rel-line">{{ r.character1 }} ←{{ r.relationship }}→ {{ r.character2 }}</div>
                }
              </div>
            }
          } @else if (profile.charactersJson) {
            <p class="muted">לא ניתן לפרש נתוני דמויות.</p>
          } @else {
            <p class="muted">אין נתוני דמויות.</p>
          }
        </section>

        <section class="card story-card">
          <h4>מבנה עלילה</h4>
          @if (storyParsed) {
            <div class="plot-timeline">
              @if (storyParsed.plotStructure) {
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'setup'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('setup')">הכנה</button>
                  @if (expandedPlotNode === 'setup' && storyParsed.plotStructure.setup) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.setup }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'risingAction'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('risingAction')">עליה</button>
                  @if (expandedPlotNode === 'risingAction' && storyParsed.plotStructure.risingAction) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.risingAction }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'climax'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('climax')">שיא</button>
                  @if (expandedPlotNode === 'climax' && storyParsed.plotStructure.climax) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.climax }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'fallingAction'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('fallingAction')">נפילה</button>
                  @if (expandedPlotNode === 'fallingAction' && storyParsed.plotStructure.fallingAction) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.fallingAction }}</p>
                  }
                </div>
                <div class="plot-node" [class.expanded]="expandedPlotNode === 'resolution'">
                  <button type="button" class="plot-label" (click)="togglePlotNode('resolution')">התרה</button>
                  @if (expandedPlotNode === 'resolution' && storyParsed.plotStructure.resolution) {
                    <p class="plot-detail">{{ storyParsed.plotStructure.resolution }}</p>
                  }
                </div>
              }
            </div>
            @if (storyParsed.pacing) {
              <p class="pacing"><span class="label">קצב:</span> {{ storyParsed.pacing }}</p>
            }
            @if (storyParsed.conflicts && storyParsed.conflicts.length) {
              <div class="conflicts">
                <span class="label">קונפליקטים:</span>
                <ul>
                  @for (c of storyParsed.conflicts; track c.type + (c.description ?? '')) {
                    <li><span class="conflict-type">{{ c.type }}</span> — {{ c.description ?? '' }} ({{ c.status ?? 'ongoing' }})</li>
                  }
                </ul>
              </div>
            }
          } @else if (profile.storyStructureJson) {
            <p class="muted">לא ניתן לפרש מבנה עלילה.</p>
          } @else {
            <p class="muted">אין נתוני מבנה עלילה.</p>
          }
        </section>

        <section class="card ask-card">
          <h4>שאל על הספר</h4>
          <div class="ask-input-row">
            <input
              type="text"
              class="ask-input"
              placeholder="שאל שאלה על הספר..."
              [(ngModel)]="askQuestion"
              (keydown.enter)="onAsk()">
            <button type="button" class="ask-btn" [disabled]="asking || !(askQuestion && askQuestion.trim())" (click)="onAsk()">▶</button>
          </div>
          @if (asking) {
            <p class="muted">מחפש תשובה…</p>
          } @else if (askError) {
            <p class="error-hint">{{ askError }}</p>
          } @else if (lastAnswer) {
            <div class="answer-block">
              <div class="answer-text">{{ lastAnswer.resultText }}</div>
              @if (citationChapterIds.length) {
                <div class="citations">📖 ציטוט מפרקים: {{ citationChapterIds.join(', ') }}</div>
              }
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .book-dashboard {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 0.25rem 0;
      overflow-y: auto;
      max-height: 100%;
    }
    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }
    .dashboard-title { margin: 0; font-size: 1rem; font-weight: 600; }
    .refresh-btn {
      padding: 0.35rem 0.6rem;
      border: 1px solid #ddd;
      background: #fff;
      cursor: pointer;
      border-radius: 4px;
      font-size: 1.1rem;
    }
    .refresh-btn:hover:not(:disabled) { background: #f5f5f5; }
    .refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .card {
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      background: #fafafa;
    }
    .card h4 { margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #555; }
    .empty-hint, .error-hint, .muted { font-size: 0.875rem; color: #666; margin: 0; }
    .error-hint { color: #c00; }
    .overview-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem 1rem;
      font-size: 0.85rem;
    }
    .overview-item .label { display: block; color: #666; }
    .overview-item .value { font-weight: 500; }
    .level-bar {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .level-fill {
      display: inline-block;
      height: 6px;
      min-width: 20px;
      max-width: 80px;
      background: #0078d4;
      border-radius: 3px;
    }
    .synopsis-text { font-size: 0.9rem; line-height: 1.5; }
    .synopsis-preview, .synopsis-full { white-space: pre-wrap; }
    .link-btn { background: none; border: none; color: #0078d4; cursor: pointer; font-size: 0.85rem; padding: 0.25rem 0; }
    .characters-scroll {
      display: flex;
      gap: 0.75rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }
    .character-card {
      flex: 0 0 auto;
      width: 100px;
      text-align: center;
      padding: 0.5rem;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      background: #fff;
    }
    .char-avatar {
      width: 36px;
      height: 36px;
      margin: 0 auto 0.35rem;
      border-radius: 50%;
      background: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .char-name { font-weight: 600; font-size: 0.85rem; }
    .char-role { font-size: 0.75rem; color: #666; }
    .relationships { margin-top: 0.75rem; font-size: 0.85rem; }
    .relationships .label { display: block; margin-bottom: 0.25rem; color: #666; }
    .rel-line { margin-bottom: 0.2rem; }
    .plot-timeline { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; }
    .plot-node { border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
    .plot-label {
      padding: 0.35rem 0.6rem;
      background: #fff;
      border: none;
      cursor: pointer;
      font-size: 0.85rem;
      width: 100%;
      text-align: right;
    }
    .plot-label:hover { background: #f5f5f5; }
    .plot-detail { margin: 0.5rem; font-size: 0.8rem; color: #444; white-space: pre-wrap; }
    .pacing, .conflicts { font-size: 0.85rem; margin-top: 0.5rem; }
    .conflicts ul { margin: 0.25rem 0 0 0; padding-right: 1.25rem; }
    .conflict-type { font-weight: 500; }
    .ask-input-row { display: flex; gap: 0.35rem; margin-bottom: 0.5rem; }
    .ask-input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; }
    .ask-btn { padding: 0.5rem 0.75rem; background: #0078d4; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    .ask-btn:hover:not(:disabled) { background: #106ebe; }
    .ask-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .answer-block { margin-top: 0.5rem; padding: 0.5rem; background: #fff; border-radius: 4px; border: 1px solid #eee; }
    .answer-text { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5; }
    .citations { font-size: 0.8rem; color: #666; margin-top: 0.35rem; }
  `]
})
export class BookDashboardComponent implements OnInit {
  @Input() bookId!: string;
  @Input() bookTitle: string = '';

  profile: BookProfileDto | null = null;
  loading = true;
  refreshing = false;
  error: string | null = null;

  synopsisExpanded = false;
  expandedPlotNode: string | null = null;

  charactersParsed: CharacterAnalysisResult | null = null;
  storyParsed: StoryAnalysisResult | null = null;

  askQuestion = '';
  asking = false;
  askError: string | null = null;
  lastAnswer: AnalysisResultDto | null = null;
  citationChapterIds: string[] = [];

  constructor(private bookService: BookService) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  get synopsisPreview(): string {
    if (!this.profile?.synopsis) return '';
    return this.profile.synopsis.length <= 200
      ? this.profile.synopsis
      : this.profile.synopsis.slice(0, 200) + '…';
  }

  private loadProfile(): void {
    if (!this.bookId) return;
    this.loading = true;
    this.error = null;
    this.bookService.getProfile(this.bookId).subscribe({
      next: (p) => {
        this.profile = p;
        this.parseStructured();
        this.loading = false;
      },
      error: (err) => {
        if (err.status === 404) {
          this.profile = null;
          this.error = null;
        } else {
          this.error = err.message || 'שגיאה בטעינת הפרופיל';
        }
        this.loading = false;
      }
    });
  }

  private parseStructured(): void {
    this.charactersParsed = null;
    this.storyParsed = null;
    if (!this.profile) return;
    try {
      if (this.profile.charactersJson) {
        this.charactersParsed = JSON.parse(this.profile.charactersJson) as CharacterAnalysisResult;
      }
    } catch {
      this.charactersParsed = null;
    }
    try {
      if (this.profile.storyStructureJson) {
        this.storyParsed = JSON.parse(this.profile.storyStructureJson) as StoryAnalysisResult;
      }
    } catch {
      this.storyParsed = null;
    }
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (name[0] ?? '?').toUpperCase();
  }

  togglePlotNode(node: string): void {
    this.expandedPlotNode = this.expandedPlotNode === node ? null : node;
  }

  onRefresh(): void {
    if (!this.bookId || this.refreshing) return;
    this.refreshing = true;
    this.error = null;
    this.bookService.refreshProfile(this.bookId).subscribe({
      next: (p) => {
        this.profile = p;
        this.parseStructured();
        this.refreshing = false;
      },
      error: (err) => {
        this.error = err.message || 'שגיאה ברענון הפרופיל';
        this.refreshing = false;
      }
    });
  }

  onAsk(): void {
    const q = this.askQuestion.trim();
    if (!this.bookId || !q || this.asking) return;
    this.asking = true;
    this.askError = null;
    this.bookService.ask(this.bookId, q).subscribe({
      next: (result) => {
        this.lastAnswer = result;
        this.citationChapterIds = this.tryParseCitations(result.structuredResult);
        this.asking = false;
      },
      error: (err) => {
        this.askError = err.error?.message || err.message || 'שגיאה בשאלה';
        this.asking = false;
      }
    });
  }

  private tryParseCitations(structuredResult: string | null | undefined): string[] {
    if (!structuredResult) return [];
    try {
      const obj = JSON.parse(structuredResult);
      const citations = obj?.citations as Array<{ chapterNumber?: number; chapterTitle?: string }> | undefined;
      if (Array.isArray(citations)) {
        return citations.map(c => c.chapterTitle ?? `פרק ${c.chapterNumber ?? '?'}`).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }
}
