import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { AnalysisResultDto } from '../../core/models/analysis';
import { LinguisticAnalysis } from '../../core/models/language-engine';

/** Row shown for a single style deviation (scene metric vs chapter baseline). */
export interface LinguisticDeviationRow {
  /** Localized, human-readable metric name (falls back to the raw key). */
  metricLabel: string;
  sceneValue: number;
  chapterBaseline: number;
  note: string;
  /** Friendly plain-language comparison phrase, e.g. "slightly above the chapter's usual". */
  comparison: string;
}

/** Chip shown for a single cross-paragraph consistency issue. */
export interface LinguisticConsistencyChip {
  type: 'register' | 'tense' | 'pov';
  typeLabel: string;
  span: string;
  description: string;
}

/** Localized strings + parsed fields for the linguistic view of a result. */
export interface LinguisticViewModel {
  /** Optional model-provided overview sentence(s). Empty string when absent. */
  summary: string;
  deviations: LinguisticDeviationRow[];
  consistencyIssues: LinguisticConsistencyChip[];
  /** Localized section labels (he default, en when result language is English). */
  labels: {
    deviationsTitle: string;
    consistencyTitle: string;
    noDeviations: string;
    noConsistencyIssues: string;
    /** "{scene} vs chapter {baseline}" template parts (kept for compatibility). */
    vs: string;
    chapterBaselineLabel: string;
    /** Short "vs" separator used in the muted raw-number suffix, e.g. he "לעומת" / en "vs". */
    rawVs: string;
    /** Graceful fallback / raw-toggle strings. */
    couldNotParse: string;
    showRaw: string;
    hideRaw: string;
    noStructuredNote: string;
  };
  /** 'rtl' for Hebrew (default), 'ltr' for English results. */
  dir: 'rtl' | 'ltr';
  /** True when structuredResult was missing or JSON.parse threw — render fallback instead of blocks. */
  parseFailed: boolean;
  /** True when parse succeeded but there is no summary, no deviations and no consistency issues. */
  emptyStructured: boolean;
}

/**
 * Shared structured view for a LinguisticAnalysis result. Used by BOTH the Run tab and the History
 * tab so the run never shows the raw model JSON blob. Renders style deviations + consistency chips
 * when the structuredResult parses, and a graceful "could not parse" fallback with an opt-in raw
 * toggle otherwise. Renders NOTHING for non-LinguisticAnalysis results.
 *
 * Conventions follow SuggestionCardComponent: inline template + styles, standalone, CommonModule.
 */
@Component({
  selector: 'app-linguistic-result',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      *ngIf="view as ling"
      class="linguistic-view"
      [attr.dir]="ling.dir"
      data-testid="linguistic-view">
      <!-- Graceful fallback: structuredResult missing or unparseable -->
      <ng-container *ngIf="ling.parseFailed; else structured">
        <p class="muted" data-testid="linguistic-parse-error">{{ ling.labels.couldNotParse }}</p>
        <ng-container *ngTemplateOutlet="rawToggle"></ng-container>
      </ng-container>

      <!-- Parsed structured view -->
      <ng-template #structured>
        <p class="linguistic-summary" data-testid="linguistic-summary" *ngIf="ling.summary">{{ ling.summary }}</p>

        <!-- Style deviations (scene metric vs chapter baseline) -->
        <div class="linguistic-block" data-testid="linguistic-deviations">
          <h4 class="linguistic-block-title">{{ ling.labels.deviationsTitle }}</h4>
          <ul class="deviation-list" *ngIf="ling.deviations.length; else noDeviations">
            <li class="deviation-row" *ngFor="let d of ling.deviations" data-testid="deviation-row">
              <span class="deviation-metric">{{ d.metricLabel }}</span>
              <span class="deviation-values">
                {{ d.comparison }}<span class="deviation-values-raw"> ({{ formatNum(d.sceneValue) }} {{ ling.labels.rawVs }} {{ formatNum(d.chapterBaseline) }})</span>
              </span>
              <span class="deviation-note" *ngIf="d.note">{{ d.note }}</span>
            </li>
          </ul>
          <ng-template #noDeviations>
            <p class="muted" data-testid="deviations-empty">{{ ling.labels.noDeviations }}</p>
          </ng-template>
        </div>

        <!-- Consistency issues (typed chips) -->
        <div class="linguistic-block" data-testid="linguistic-consistency">
          <h4 class="linguistic-block-title">{{ ling.labels.consistencyTitle }}</h4>
          <ul class="consistency-list" *ngIf="ling.consistencyIssues.length; else noConsistency">
            <li class="consistency-row" *ngFor="let c of ling.consistencyIssues" data-testid="consistency-row">
              <span class="consistency-type" [ngClass]="'consistency-type-' + c.type" data-testid="consistency-type">{{ c.typeLabel }}</span>
              <span class="consistency-body">
                <span class="consistency-description">{{ c.description }}</span>
                <span class="consistency-span" *ngIf="c.span">“{{ c.span }}”</span>
              </span>
            </li>
          </ul>
          <ng-template #noConsistency>
            <p class="muted" data-testid="consistency-empty">{{ ling.labels.noConsistencyIssues }}</p>
          </ng-template>
        </div>

        <!-- Parsed but empty, and there is non-trivial raw text: offer the raw response. -->
        <ng-container *ngIf="ling.emptyStructured && hasRawText">
          <p class="muted" data-testid="linguistic-empty-note">{{ ling.labels.noStructuredNote }}</p>
          <ng-container *ngTemplateOutlet="rawToggle"></ng-container>
        </ng-container>
      </ng-template>

      <!-- Shared opt-in raw-response toggle (mirrors the LineEdit run-tab pattern). -->
      <ng-template #rawToggle>
        <button
          type="button"
          class="linguistic-raw-toggle"
          data-testid="linguistic-raw-toggle"
          (click)="showRaw = !showRaw">
          {{ showRaw ? ling.labels.hideRaw : ling.labels.showRaw }}
        </button>
        <pre class="linguistic-raw" data-testid="linguistic-raw" *ngIf="showRaw">{{ result?.resultText }}</pre>
      </ng-template>
    </section>
  `,
  styles: [`
    .linguistic-view {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      margin-top: 0.5rem;
    }
    .linguistic-summary {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #333;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid #eee;
    }
    .linguistic-block {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .linguistic-block-title {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .deviation-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .deviation-row {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      border: 1px solid #eee;
      border-inline-start: 3px solid #a8c4e6;
      border-radius: 4px;
      padding: 0.4rem 0.5rem;
      background: #f9fbff;
    }
    .deviation-metric {
      font-size: 0.85rem;
      font-weight: 600;
      color: #333;
    }
    .deviation-values {
      font-size: 0.82rem;
      color: #074799;
    }
    .deviation-values-raw {
      font-size: 0.78rem;
      color: #888;
      font-weight: 400;
    }
    .deviation-note {
      font-size: 0.8rem;
      line-height: 1.4;
      color: #555;
    }
    .consistency-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .consistency-row {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
    }
    .consistency-type {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      border-radius: 999px;
      padding: 0.1rem 0.45rem;
      font-weight: 600;
      background: #e6f0ff;
      color: #074799;
    }
    .consistency-type::before {
      content: '';
      display: inline-block;
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 999px;
      background: currentColor;
    }
    .consistency-type.consistency-type-register {
      background: #fff4e0;
      color: #b45f06;
    }
    .consistency-type.consistency-type-tense {
      background: #e8f0fe;
      color: #1a4fb4;
    }
    .consistency-type.consistency-type-pov {
      background: #f3e5f5;
      color: #6a1b9a;
    }
    .consistency-body {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
    }
    .consistency-description {
      font-size: 0.85rem;
      line-height: 1.4;
      color: #333;
    }
    .consistency-span {
      font-size: 0.8rem;
      color: #666;
      font-style: italic;
      word-break: break-word;
    }
    .muted {
      color: #666;
      font-size: 0.85rem;
    }
    .linguistic-raw-toggle {
      align-self: flex-start;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      cursor: pointer;
      border: 1px solid #ddd;
      background: #fff;
      color: #555;
    }
    .linguistic-raw {
      white-space: pre-wrap;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.85rem;
      line-height: 1.5;
      margin: 0;
      padding: 0.5rem;
      border: 1px solid #eee;
      border-radius: 4px;
      background: #f9f9f9;
    }
  `]
})
export class LinguisticResultComponent implements OnChanges {
  @Input() result: AnalysisResultDto | null = null;

  /** Whether the opt-in raw-response block is currently expanded. */
  showRaw = false;

  /** Cached view model; recomputed only when the cache key (id + language + structuredResult) changes. */
  private _viewCache: LinguisticViewModel | null = null;
  private _viewCacheKey: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result']) {
      // Collapse the raw view whenever the underlying result changes.
      this.showRaw = false;
    }
  }

  /** True when there is non-trivial raw text worth surfacing behind the toggle. */
  get hasRawText(): boolean {
    return (this.result?.resultText?.length ?? 0) > 20;
  }

  /**
   * Cached, localized linguistic view for the current result. Returns null for non-LinguisticAnalysis
   * results (so the host section is not rendered at all). JSON.parse runs at most once per distinct
   * (id + language + structuredResult) triple.
   */
  get view(): LinguisticViewModel | null {
    const result = this.result;
    if (!result) return null;
    if ((result.analysisType || result.type) !== 'LinguisticAnalysis') return null;
    const cacheKey = `${result.id ?? ''}:${result.language ?? ''}:${result.structuredResult ?? ''}`;
    if (this._viewCacheKey !== cacheKey) {
      this._viewCache = this.buildLinguisticView(result);
      this._viewCacheKey = cacheKey;
    }
    return this._viewCache;
  }

  private buildLinguisticView(result: AnalysisResultDto): LinguisticViewModel {
    const isEnglish = (result.language || '').toLowerCase().startsWith('en');
    const lang: 'he' | 'en' = isEnglish ? 'en' : 'he';
    const labels = LINGUISTIC_LABELS[lang];
    const dir: 'rtl' | 'ltr' = isEnglish ? 'ltr' : 'rtl';

    // Missing structuredResult OR JSON.parse throws => graceful fallback.
    if (!result.structuredResult) {
      return { summary: '', deviations: [], consistencyIssues: [], labels, dir, parseFailed: true, emptyStructured: false };
    }
    let parsed: Partial<LinguisticAnalysis> & { summary?: string };
    try {
      parsed = JSON.parse(result.structuredResult) as Partial<LinguisticAnalysis> & { summary?: string };
    } catch {
      return { summary: '', deviations: [], consistencyIssues: [], labels, dir, parseFailed: true, emptyStructured: false };
    }

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

    const rawDeviations = Array.isArray(parsed.deviations) ? parsed.deviations : [];
    const deviations: LinguisticDeviationRow[] = rawDeviations
      .filter(d => d && typeof d === 'object')
      .map(d => {
        const sceneValue = Number(d.sceneValue);
        const chapterBaseline = Number(d.chapterBaseline);
        return {
          metricLabel: this.metricLabel(d.metric, lang),
          sceneValue,
          chapterBaseline,
          note: d.note ?? '',
          comparison: this.deviationComparison(sceneValue, chapterBaseline, lang)
        };
      });

    const rawIssues = Array.isArray(parsed.consistencyIssues) ? parsed.consistencyIssues : [];
    const consistencyIssues: LinguisticConsistencyChip[] = rawIssues
      .filter(i => i && typeof i === 'object' && (i.type === 'register' || i.type === 'tense' || i.type === 'pov'))
      .map(i => ({
        type: i.type,
        typeLabel: CONSISTENCY_TYPE_LABELS[lang][i.type],
        span: i.span ?? '',
        description: i.description ?? ''
      }));

    const emptyStructured = !summary && deviations.length === 0 && consistencyIssues.length === 0;

    return { summary, deviations, consistencyIssues, labels, dir, parseFailed: false, emptyStructured };
  }

  /** Format a number for display: integers as-is, floats to 2 dp (trailing ".00" stripped). */
  formatNum(x: number): string {
    if (!Number.isFinite(x)) return '-';
    if (Number.isInteger(x)) return String(x);
    const fixed = Number(x).toFixed(2);
    return fixed.endsWith('.00') ? String(Math.round(x)) : fixed;
  }

  /** Localized, human-readable label for a metric key (e.g. averageSentenceLength). Falls back to the raw key. */
  private metricLabel(metric: string | undefined, lang: 'he' | 'en'): string {
    const key = metric ?? '';
    return METRIC_LABELS[lang][key] ?? key;
  }

  /** Friendly plain-language comparison phrase for a deviation row. */
  private deviationComparison(sceneValue: number, chapterBaseline: number, lang: 'he' | 'en'): string {
    const rel = chapterBaseline !== 0
      ? Math.abs(sceneValue - chapterBaseline) / Math.abs(chapterBaseline)
      : (sceneValue !== chapterBaseline ? 1 : 0);
    if (rel < 0.01) return DEVIATION_COMPARISON_PHRASES[lang]['same'];
    const direction: 'higher' | 'lower' = sceneValue > chapterBaseline ? 'higher' : 'lower';
    const magnitude: 'slightly' | 'notably' | 'much' = rel < 0.10 ? 'slightly' : (rel <= 0.30 ? 'notably' : 'much');
    return DEVIATION_COMPARISON_PHRASES[lang][`${magnitude}-${direction}`];
  }
}

/**
 * Localized strings for the linguistic view. This client has no i18n framework / translation files,
 * so localization follows the existing in-component label-map pattern (see SuggestionCardComponent
 * getCategoryLabel). Hebrew is the product default; English is used only when the result language is
 * English. he/en kept at strict parity. No em-dash (—) in any user-facing string.
 */
const LINGUISTIC_LABELS: Record<'he' | 'en', LinguisticViewModel['labels']> = {
  he: {
    deviationsTitle: 'חריגות סגנון מהפרק',
    consistencyTitle: 'בעיות עקביות',
    noDeviations: 'לא נמצאו חריגות סגנון משמעותיות.',
    noConsistencyIssues: 'לא נמצאו בעיות עקביות.',
    vs: 'מול',
    chapterBaselineLabel: 'קו בסיס הפרק',
    rawVs: 'לעומת',
    couldNotParse: 'לא ניתן היה לפרסר את תוצאת הניתוח.',
    showRaw: 'הצג תגובה גולמית',
    hideRaw: 'הסתר תגובה גולמית',
    noStructuredNote: 'לא נמצא תוכן מובנה - ייתכן שהמודל החזיר פלט שלא ניתן לפרסר במלואו.'
  },
  en: {
    deviationsTitle: 'Style deviations from chapter',
    consistencyTitle: 'Consistency issues',
    noDeviations: 'No significant style deviations found.',
    noConsistencyIssues: 'No consistency issues found.',
    vs: 'vs',
    chapterBaselineLabel: 'chapter baseline',
    rawVs: 'vs',
    couldNotParse: 'Could not parse the analysis result.',
    showRaw: 'Show raw response',
    hideRaw: 'Hide raw response',
    noStructuredNote: 'No structured content found - the model may have returned output that could not be fully parsed.'
  }
};

/** Localized labels for the three consistency-issue types. he/en parity. */
const CONSISTENCY_TYPE_LABELS: Record<'he' | 'en', Record<'register' | 'tense' | 'pov', string>> = {
  he: {
    register: 'רישום',
    tense: 'זמן דקדוקי',
    pov: 'נקודת מבט'
  },
  en: {
    register: 'Register',
    tense: 'Tense',
    pov: 'POV'
  }
};

/** Localized, human-readable names for the metric keys emitted by the backend. he/en parity. */
const METRIC_LABELS: Record<'he' | 'en', Record<string, string>> = {
  he: {
    averageSentenceLength: 'אורך משפט ממוצע',
    sentenceCount: 'מספר משפטים',
    complexSentences: 'משפטים מורכבים',
    shortestSentence: 'המשפט הקצר ביותר',
    longestSentence: 'המשפט הארוך ביותר',
    wordCount: 'מספר מילים',
    uniqueWords: 'מילים ייחודיות',
    averageWordLength: 'אורך מילה ממוצע',
    lexicalDensity: 'עושר אוצר המילים',
    readability: 'קריאוּת'
  },
  en: {
    averageSentenceLength: 'Average sentence length',
    sentenceCount: 'Sentence count',
    complexSentences: 'Complex sentences',
    shortestSentence: 'Shortest sentence',
    longestSentence: 'Longest sentence',
    wordCount: 'Word count',
    uniqueWords: 'Unique words',
    averageWordLength: 'Average word length',
    lexicalDensity: 'Vocabulary richness',
    readability: 'Readability'
  }
};

/**
 * Friendly plain-language phrases for the comparison of a scene metric against its chapter baseline.
 * Full pre-translated phrases are used (no template concatenation) to keep Hebrew grammar correct.
 * he/en parity. No em-dash in any string.
 */
const DEVIATION_COMPARISON_PHRASES: Record<'he' | 'en', Record<string, string>> = {
  he: {
    'same':            'דומה לרגיל בפרק',
    'slightly-higher': 'מעט גבוה מהרגיל בפרק',
    'notably-higher':  'גבוה משמעותית מהרגיל בפרק',
    'much-higher':     'גבוה בהרבה מהרגיל בפרק',
    'slightly-lower':  'מעט נמוך מהרגיל בפרק',
    'notably-lower':   'נמוך משמעותית מהרגיל בפרק',
    'much-lower':      'נמוך בהרבה מהרגיל בפרק',
  },
  en: {
    'same':            "about the same as the chapter's usual",
    'slightly-higher': "slightly above the chapter's usual",
    'notably-higher':  "notably above the chapter's usual",
    'much-higher':     "much above the chapter's usual",
    'slightly-lower':  "slightly below the chapter's usual",
    'notably-lower':   "notably below the chapter's usual",
    'much-lower':      "much below the chapter's usual",
  }
};
