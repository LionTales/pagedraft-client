import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { AnalysisResultDto } from '../../core/models/analysis';
import {
  LiteraryAnalysisResult,
  LiteraryRhetoricalDevice,
  LiteraryTheme,
} from '../../core/models/language-engine';

/** A theme row prepared for display (name + description + localized major/minor badge). */
export interface LiteraryThemeRow {
  name: string;
  description: string;
  /** Localized significance badge text ("Major"/"Minor" or "מרכזית"/"משנית"). Empty when absent. */
  significanceLabel: string;
  /** Normalized significance key driving the badge style: 'major' | 'minor' | ''. */
  significance: 'major' | 'minor' | '';
}

/** A rhetorical-device row prepared for display. */
export interface LiteraryDeviceRow {
  name: string;
  example: string;
  effect: string;
}

/** Localized strings + parsed fields for the literary view of a result. */
export interface LiteraryViewModel {
  summary: string;
  themes: LiteraryThemeRow[];
  tone: string;
  toneDescription: string;
  narrativeVoice: string;
  narrativeVoiceDescription: string;
  devices: LiteraryDeviceRow[];
  moodProgression: string;
  /** Localized section + sub-labels. he default, en when result language is English. */
  labels: LiteraryLabels;
  /** 'rtl' for Hebrew (default), 'ltr' for English results. */
  dir: 'rtl' | 'ltr';
  /** True when resultText was missing or JSON.parse threw / yielded a non-object - render fallback. */
  parseFailed: boolean;
  /**
   * True when parse succeeded but there is NO usable structured content of any kind (no summary, no
   * themes, no tone, no narrative voice, no devices, no mood progression). Drives a graceful note +
   * opt-in raw toggle instead of an empty card.
   */
  emptyStructured: boolean;
}

interface LiteraryLabels {
  summary: string;
  themes: string;
  tone: string;
  narrativeVoice: string;
  rhetoricalDevices: string;
  moodProgression: string;
  example: string;
  effect: string;
  major: string;
  minor: string;
  couldNotParse: string;
  noStructuredNote: string;
  showRaw: string;
  hideRaw: string;
}

/**
 * Structured view for a LiteraryAnalysis result. The backend extracts the model output into a
 * LiteraryAnalysisResult and stores it re-serialized as JSON in resultText, so without a dedicated
 * renderer the Run tab would fall through to the generic block and dump raw JSON at the user. This
 * component parses that JSON defensively and renders a human-readable view: a prominent summary, then
 * themes (with a major/minor badge), tone, narrative voice, rhetorical devices, and mood progression.
 * Empty sections are skipped. On a parse failure (model misbehaved, or an older prose result) it falls
 * back to a "could not parse" note with an opt-in raw toggle - it never throws and never renders blank.
 *
 * Renders NOTHING for non-LiteraryAnalysis results (host section is omitted). Conventions mirror
 * LinguisticResultComponent: standalone, inline template + styles, CommonModule, in-component he/en
 * label maps (this client has no i18n framework). No em-dash in any user-facing string.
 */
@Component({
  selector: 'app-literary-result',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      *ngIf="view as lit"
      class="literary-view"
      [attr.dir]="lit.dir"
      data-testid="literary-view">
      <!-- Graceful fallback: resultText missing or unparseable. -->
      <ng-container *ngIf="lit.parseFailed; else structured">
        <p class="muted" data-testid="literary-parse-error">{{ lit.labels.couldNotParse }}</p>
        <ng-container *ngTemplateOutlet="rawToggle"></ng-container>
      </ng-container>

      <ng-template #structured>
        <!-- Parsed but empty: a short note + opt-in raw, so the card is never blank. -->
        <ng-container *ngIf="lit.emptyStructured">
          <p class="muted" data-testid="literary-empty-note">{{ lit.labels.noStructuredNote }}</p>
          <ng-container *ngTemplateOutlet="rawToggle"></ng-container>
        </ng-container>

        <ng-container *ngIf="!lit.emptyStructured">
          <!-- Summary (prominent prose). -->
          <p class="literary-summary" data-testid="literary-summary" *ngIf="lit.summary">{{ lit.summary }}</p>

          <!-- Themes. -->
          <div class="literary-block" data-testid="literary-themes" *ngIf="lit.themes.length">
            <h4 class="literary-block-title">{{ lit.labels.themes }}</h4>
            <ul class="theme-list">
              <li class="theme-row" *ngFor="let t of lit.themes" data-testid="theme-row">
                <span class="theme-head">
                  <span class="theme-name">{{ t.name }}</span>
                  <span
                    class="theme-badge"
                    *ngIf="t.significanceLabel"
                    [class.major]="t.significance === 'major'"
                    [class.minor]="t.significance === 'minor'"
                    data-testid="theme-badge">{{ t.significanceLabel }}</span>
                </span>
                <span class="theme-desc" *ngIf="t.description">{{ t.description }}</span>
              </li>
            </ul>
          </div>

          <!-- Tone. -->
          <div class="literary-block" data-testid="literary-tone" *ngIf="lit.tone || lit.toneDescription">
            <h4 class="literary-block-title">{{ lit.labels.tone }}</h4>
            <p class="literary-field-value" *ngIf="lit.tone">{{ lit.tone }}</p>
            <p class="literary-field-desc" *ngIf="lit.toneDescription">{{ lit.toneDescription }}</p>
          </div>

          <!-- Narrative voice. -->
          <div
            class="literary-block"
            data-testid="literary-narrative-voice"
            *ngIf="lit.narrativeVoice || lit.narrativeVoiceDescription">
            <h4 class="literary-block-title">{{ lit.labels.narrativeVoice }}</h4>
            <p class="literary-field-value" *ngIf="lit.narrativeVoice">{{ lit.narrativeVoice }}</p>
            <p class="literary-field-desc" *ngIf="lit.narrativeVoiceDescription">{{ lit.narrativeVoiceDescription }}</p>
          </div>

          <!-- Rhetorical devices. -->
          <div class="literary-block" data-testid="literary-devices" *ngIf="lit.devices.length">
            <h4 class="literary-block-title">{{ lit.labels.rhetoricalDevices }}</h4>
            <ul class="device-list">
              <li class="device-row" *ngFor="let d of lit.devices" data-testid="device-row">
                <span class="device-name">{{ d.name }}</span>
                <span class="device-line" *ngIf="d.example">
                  <span class="device-sub-label">{{ lit.labels.example }}</span> {{ d.example }}
                </span>
                <span class="device-line" *ngIf="d.effect">
                  <span class="device-sub-label">{{ lit.labels.effect }}</span> {{ d.effect }}
                </span>
              </li>
            </ul>
          </div>

          <!-- Mood progression. -->
          <div class="literary-block" data-testid="literary-mood" *ngIf="lit.moodProgression">
            <h4 class="literary-block-title">{{ lit.labels.moodProgression }}</h4>
            <p class="literary-field-desc">{{ lit.moodProgression }}</p>
          </div>
        </ng-container>
      </ng-template>

      <!-- Shared opt-in raw-response toggle (mirrors the linguistic view pattern). -->
      <ng-template #rawToggle>
        <button
          type="button"
          class="literary-raw-toggle"
          data-testid="literary-raw-toggle"
          (click)="showRaw = !showRaw">
          {{ showRaw ? lit.labels.hideRaw : lit.labels.showRaw }}
        </button>
        <pre class="literary-raw" data-testid="literary-raw" *ngIf="showRaw">{{ result?.resultText }}</pre>
      </ng-template>
    </section>
  `,
  styles: [`
    .literary-view {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      margin-top: 0.5rem;
    }
    .literary-summary {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #333;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid #eee;
    }
    .literary-block {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .literary-block-title {
      margin: 0;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .literary-field-value {
      margin: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: #333;
    }
    .literary-field-desc {
      margin: 0;
      font-size: 0.83rem;
      line-height: 1.45;
      color: #555;
    }
    .theme-list,
    .device-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .theme-row,
    .device-row {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      border: 1px solid #eee;
      border-inline-start: 3px solid #a8c4e6;
      border-radius: 4px;
      padding: 0.4rem 0.5rem;
      background: #f9fbff;
    }
    .theme-head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .theme-name,
    .device-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: #333;
    }
    .theme-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      border: 1px solid #ccc;
      color: #555;
      background: #fff;
    }
    .theme-badge.major {
      color: #074799;
      border-color: #a8c4e6;
      background: #eef4fc;
    }
    .theme-badge.minor {
      color: #666;
      border-color: #ddd;
      background: #f3f3f3;
    }
    .theme-desc,
    .device-line {
      font-size: 0.83rem;
      line-height: 1.45;
      color: #555;
    }
    .device-sub-label {
      font-weight: 600;
      color: #444;
    }
    .muted {
      color: #666;
      font-size: 0.85rem;
    }
    .literary-raw-toggle {
      align-self: flex-start;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      cursor: pointer;
      border: 1px solid #ddd;
      background: #fff;
      color: #555;
    }
    .literary-raw {
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
export class LiteraryResultComponent implements OnChanges {
  @Input() result: AnalysisResultDto | null = null;

  /** Whether the opt-in raw-response block is currently expanded. */
  showRaw = false;

  private _viewCache: LiteraryViewModel | null = null;
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
   * Cached, localized literary view. Returns null for non-LiteraryAnalysis results (host section not
   * rendered). JSON.parse runs at most once per distinct (id + language + structuredResult + resultText).
   */
  get view(): LiteraryViewModel | null {
    const result = this.result;
    if (!result) return null;
    if ((result.analysisType || result.type) !== 'LiteraryAnalysis') return null;
    const cacheKey = `${result.id ?? ''}:${result.analysisType ?? result.type ?? ''}:${result.language ?? ''}:${result.structuredResult ?? ''}:${result.resultText ?? ''}`;
    if (this._viewCacheKey !== cacheKey) {
      this._viewCache = this.buildView(result);
      this._viewCacheKey = cacheKey;
    }
    return this._viewCache;
  }

  private buildView(result: AnalysisResultDto): LiteraryViewModel {
    const isEnglish = (result.language || '').toLowerCase().startsWith('en');
    const lang: 'he' | 'en' = isEnglish ? 'en' : 'he';
    const labels = LITERARY_LABELS[lang];
    const dir: 'rtl' | 'ltr' = isEnglish ? 'ltr' : 'rtl';

    const parseFailed: LiteraryViewModel = {
      summary: '', themes: [], tone: '', toneDescription: '', narrativeVoice: '',
      narrativeVoiceDescription: '', devices: [], moodProgression: '',
      labels, dir, parseFailed: true, emptyStructured: false,
    };

    // Prefer structuredResult, fall back to resultText. The backend stores the re-serialized JSON in
    // resultText, but a future path may move it to structuredResult; reading both keeps this robust.
    // A non-empty structuredResult that does NOT yield a usable object (parse error, or a non-object
    // primitive/array) must NOT short-circuit the fallback: resultText may still hold valid
    // LiteraryAnalysisResult JSON. So try each candidate in order and use the first that parses into an
    // object; only when neither does do we render the parse-failed fallback.
    const obj = this.firstUsableObject([result.structuredResult, result.resultText]);
    if (!obj) return parseFailed;

    const summary = this.str(obj.summary);
    const tone = this.str(obj.tone);
    const toneDescription = this.str(obj.toneDescription);
    const narrativeVoice = this.str(obj.narrativeVoice);
    const narrativeVoiceDescription = this.str(obj.narrativeVoiceDescription);
    const moodProgression = this.str(obj.moodProgression);

    const themes = this.buildThemes(obj.themes, labels);
    const devices = this.buildDevices(obj.rhetoricalDevices);

    const emptyStructured =
      !summary && themes.length === 0 && !tone && !toneDescription &&
      !narrativeVoice && !narrativeVoiceDescription && devices.length === 0 && !moodProgression;

    return {
      summary, themes, tone, toneDescription, narrativeVoice, narrativeVoiceDescription,
      devices, moodProgression, labels, dir, parseFailed: false, emptyStructured,
    };
  }

  /**
   * Returns the first candidate string that parses into a JSON OBJECT (the shape a LiteraryAnalysisResult
   * takes), or null when none does. Non-object primitives (null, number, string, array) are skipped, not
   * treated as terminal failures, so a structuredResult holding e.g. a bare string or `[]` still lets a
   * valid resultText be tried. Blank/whitespace candidates are skipped.
   */
  private firstUsableObject(candidates: (string | null | undefined)[]): LiteraryAnalysisResult | null {
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      return parsed as LiteraryAnalysisResult;
    }
    return null;
  }

  private buildThemes(raw: LiteraryTheme[] | undefined, labels: LiteraryLabels): LiteraryThemeRow[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(t => t && typeof t === 'object')
      .map(t => {
        const sig = (this.str(t.significance) || '').toLowerCase();
        const significance: 'major' | 'minor' | '' =
          sig === 'major' ? 'major' : sig === 'minor' ? 'minor' : '';
        const significanceLabel =
          significance === 'major' ? labels.major : significance === 'minor' ? labels.minor : '';
        return {
          name: this.str(t.name),
          description: this.str(t.description),
          significance,
          significanceLabel,
        };
      })
      // Drop rows with no name AND no description: a fully-empty theme adds nothing.
      .filter(t => t.name || t.description);
  }

  private buildDevices(raw: LiteraryRhetoricalDevice[] | undefined): LiteraryDeviceRow[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(d => d && typeof d === 'object')
      .map(d => ({
        name: this.str(d.name),
        example: this.str(d.example),
        effect: this.str(d.effect),
      }))
      // Drop rows that carry no usable text at all.
      .filter(d => d.name || d.example || d.effect);
  }

  /** Coerce a possibly-undefined/non-string field to a trimmed string. */
  private str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }
}

/**
 * Localized strings for the literary view. This client has no i18n framework / translation files, so
 * localization follows the existing in-component label-map pattern (see LinguisticResultComponent).
 * Hebrew is the product default; English is used only when the result language is English. he/en kept
 * at strict parity. No em-dash in any user-facing string.
 *
 * DRAFT: the Hebrew literary-term wording (e.g. "קול מספר", "אמצעים רטוריים", "התקדמות מצב הרוח")
 * should be validated with a native speaker before sign-off.
 */
const LITERARY_LABELS: Record<'he' | 'en', LiteraryLabels> = {
  he: {
    summary: 'תקציר',
    themes: 'מוטיבים',
    tone: 'טון',
    narrativeVoice: 'קול מספר',
    rhetoricalDevices: 'אמצעים רטוריים',
    moodProgression: 'התקדמות מצב הרוח',
    example: 'דוגמה:',
    effect: 'אפקט:',
    major: 'מרכזי',
    minor: 'משני',
    couldNotParse: 'לא ניתן היה לפרסר את תוצאת הניתוח.',
    noStructuredNote: 'לא נמצא תוכן מובנה - ייתכן שהמודל החזיר פלט שלא ניתן לפרסר במלואו.',
    showRaw: 'הצג תגובה גולמית',
    hideRaw: 'הסתר תגובה גולמית',
  },
  en: {
    summary: 'Summary',
    themes: 'Themes',
    tone: 'Tone',
    narrativeVoice: 'Narrative voice',
    rhetoricalDevices: 'Rhetorical devices',
    moodProgression: 'Mood progression',
    example: 'Example:',
    effect: 'Effect:',
    major: 'Major',
    minor: 'Minor',
    couldNotParse: 'Could not parse the analysis result.',
    noStructuredNote: 'No structured content found - the model may have returned output that could not be fully parsed.',
    showRaw: 'Show raw response',
    hideRaw: 'Hide raw response',
  },
};
