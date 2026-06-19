import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { AnalysisResultDto, isConsistencySuggestion } from '../../core/models/analysis';
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

/** Localized strings + parsed fields for the linguistic view of a result. */
export interface LinguisticViewModel {
  /** Optional model-provided overview sentence(s). Empty string when absent. */
  summary: string;
  deviations: LinguisticDeviationRow[];
  /** Localized section labels (he default, en when result language is English). */
  labels: {
    deviationsTitle: string;
    noDeviations: string;
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
  /** True when structuredResult was missing or JSON.parse threw - render fallback instead of blocks. */
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

        <!-- Consistency issues are now rendered as navigable + dismissable suggestion cards by the
             Run/History tabs (sourced from result.suggestions, category consistency-*), so they no
             longer appear here. Only style deviations + summary live in this shared view. -->

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
   * (id + language + structuredResult + resultText) tuple.
   */
  get view(): LinguisticViewModel | null {
    const result = this.result;
    if (!result) return null;
    if ((result.analysisType || result.type) !== 'LinguisticAnalysis') return null;
    const cacheKey = `${result.id ?? ''}:${result.language ?? ''}:${result.structuredResult ?? ''}:${result.resultText ?? ''}`;
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

    // Prefer structuredResult, but fall back to resultText: some LinguisticAnalysis results store the
    // JSON only in resultText (as LineEditParserService also handles), and the History tab no longer
    // renders the raw resultText blob, so without this fallback valid output would show a false
    // "could not parse" state. parseFailed only when neither source yields valid JSON.
    const rawJson = result.structuredResult?.trim()
      ? result.structuredResult
      : (result.resultText?.trim() ? result.resultText : '');
    if (!rawJson) {
      return { summary: '', deviations: [], labels, dir, parseFailed: true, emptyStructured: false };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return { summary: '', deviations: [], labels, dir, parseFailed: true, emptyStructured: false };
    }

    // JSON.parse returns non-object primitives for valid JSON like `null`, `123` or `"text"`. Reading
    // fields off those (e.g. `parsed.summary` when parsed is null) throws during change detection and
    // breaks the Run/History tab, so treat anything that is not a plain object as a parse failure.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { summary: '', deviations: [], labels, dir, parseFailed: true, emptyStructured: false };
    }
    const obj = parsed as Partial<LinguisticAnalysis> & { summary?: string };

    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

    const rawDeviations = Array.isArray(obj.deviations) ? obj.deviations : [];
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

    // Consistency issues are NOT parsed here anymore: they are rendered as navigable suggestion cards
    // by the Run/History tabs from result.suggestions (category consistency-*). emptyStructured keys off
    // summary + deviations only - but also treat any consistency suggestion as non-empty so we don't
    // show a confusing "no structured content" note when the Run/History tabs are already rendering
    // consistency cards for this result.
    const hasConsistency = result.suggestions?.some(s => isConsistencySuggestion(s)) ?? false;
    const emptyStructured = !summary && deviations.length === 0 && !hasConsistency;

    return { summary, deviations, labels, dir, parseFailed: false, emptyStructured };
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
 * English. he/en kept at strict parity. No em-dash in any user-facing string.
 */
const LINGUISTIC_LABELS: Record<'he' | 'en', LinguisticViewModel['labels']> = {
  he: {
    deviationsTitle: 'חריגות סגנון מהפרק',
    noDeviations: 'לא נמצאו חריגות סגנון משמעותיות.',
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
    noDeviations: 'No significant style deviations found.',
    vs: 'vs',
    chapterBaselineLabel: 'chapter baseline',
    rawVs: 'vs',
    couldNotParse: 'Could not parse the analysis result.',
    showRaw: 'Show raw response',
    hideRaw: 'Hide raw response',
    noStructuredNote: 'No structured content found - the model may have returned output that could not be fully parsed.'
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
