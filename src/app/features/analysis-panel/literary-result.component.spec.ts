import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LiteraryResultComponent } from './literary-result.component';
import { AnalysisResultDto } from '../../core/models/analysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLiteraryResult(
  resultText: string | null,
  overrides: Partial<AnalysisResultDto> = {}
): AnalysisResultDto {
  return {
    id: 'r-lit',
    chapterId: 'chap-1',
    jobId: null,
    type: 'LiteraryAnalysis',
    analysisType: 'LiteraryAnalysis',
    resultText: resultText ?? '',
    createdAt: new Date().toISOString(),
    scope: 'Chapter',
    structuredResult: null,
    sceneId: null,
    bookId: 'book-1',
    language: 'he',
    status: 'Active',
    proofreadNoChangesHint: false,
    suggestions: [],
    ...overrides,
  };
}

// A full, well-formed LiteraryAnalysisResult JSON (camelCase, matching the backend shape).
const FULL_LITERARY = JSON.stringify({
  themes: [
    { name: 'Isolation', description: 'A pervasive loneliness.', significance: 'major' },
    { name: 'Hope', description: 'Quiet optimism.', significance: 'minor' },
  ],
  tone: 'Melancholic',
  toneDescription: 'A wistful, reflective tone throughout.',
  narrativeVoice: 'First person',
  narrativeVoiceDescription: 'An intimate, confessional narrator.',
  rhetoricalDevices: [
    { name: 'Metaphor', example: 'The city was a beast.', effect: 'Heightens menace.' },
  ],
  moodProgression: 'Starts somber, lifts toward the end.',
  summary: 'A reflective chapter on solitude and faint hope.',
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('LiteraryResultComponent', () => {
  let component: LiteraryResultComponent;
  let fixture: ComponentFixture<LiteraryResultComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiteraryResultComponent],
      providers: [],
    }).compileComponents();

    fixture = TestBed.createComponent(LiteraryResultComponent);
    component = fixture.componentInstance;
  });

  function setResult(result: AnalysisResultDto): void {
    component.result = result;
    fixture.detectChanges();
  }

  // =========================================================================
  // 1. Full structured result renders every section
  // =========================================================================

  describe('full structured result', () => {
    it('renders summary, themes, tone, narrative voice, devices and mood (he)', () => {
      setResult(makeLiteraryResult(FULL_LITERARY));

      expect(fixture.debugElement.query(By.css('[data-testid="literary-summary"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-themes"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-tone"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-narrative-voice"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-devices"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-mood"]'))).not.toBeNull();
    });

    it('renders the summary prose text', () => {
      setResult(makeLiteraryResult(FULL_LITERARY));
      const summary = fixture.debugElement.query(By.css('[data-testid="literary-summary"]'));
      expect((summary.nativeElement as HTMLElement).textContent).toContain('reflective chapter on solitude');
    });

    it('renders one theme row per theme with name and description', () => {
      setResult(makeLiteraryResult(FULL_LITERARY));
      const rows = fixture.debugElement.queryAll(By.css('[data-testid="theme-row"]'));
      expect(rows.length).toBe(2);
      expect((rows[0].nativeElement as HTMLElement).textContent).toContain('Isolation');
      expect((rows[0].nativeElement as HTMLElement).textContent).toContain('A pervasive loneliness.');
    });

    it('renders one device row per rhetorical device with example and effect labels', () => {
      setResult(makeLiteraryResult(FULL_LITERARY));
      const rows = fixture.debugElement.queryAll(By.css('[data-testid="device-row"]'));
      expect(rows.length).toBe(1);
      const text = (rows[0].nativeElement as HTMLElement).textContent || '';
      expect(text).toContain('Metaphor');
      expect(text).toContain('The city was a beast.');
      expect(text).toContain('Heightens menace.');
      // he sub-labels by default.
      expect(text).toContain('דוגמה:');
      expect(text).toContain('אפקט:');
    });

    it('does NOT render the parse-error or empty note for a full result', () => {
      setResult(makeLiteraryResult(FULL_LITERARY));
      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-empty-note"]'))).toBeNull();
    });
  });

  // =========================================================================
  // 2. major/minor badge
  // =========================================================================

  describe('significance badge', () => {
    it('shows a "Major"/"Minor" badge with the matching css class (en)', () => {
      setResult(makeLiteraryResult(FULL_LITERARY, { language: 'en' }));
      const badges = fixture.debugElement.queryAll(By.css('[data-testid="theme-badge"]'));
      expect(badges.length).toBe(2);
      const first = badges[0].nativeElement as HTMLElement;
      const second = badges[1].nativeElement as HTMLElement;
      expect(first.textContent?.trim()).toBe('Major');
      expect(first.classList).toContain('major');
      expect(second.textContent?.trim()).toBe('Minor');
      expect(second.classList).toContain('minor');
    });

    it('shows the Hebrew badge text by default', () => {
      setResult(makeLiteraryResult(FULL_LITERARY, { language: 'he' }));
      const badges = fixture.debugElement.queryAll(By.css('[data-testid="theme-badge"]'));
      expect((badges[0].nativeElement as HTMLElement).textContent?.trim()).toBe('מרכזי');
      expect((badges[1].nativeElement as HTMLElement).textContent?.trim()).toBe('משני');
    });

    it('omits the badge when significance is missing or unrecognized', () => {
      const json = JSON.stringify({
        themes: [
          { name: 'NoSig', description: 'd' },
          { name: 'WeirdSig', description: 'd', significance: 'huge' },
        ],
      });
      setResult(makeLiteraryResult(json));
      const rows = fixture.debugElement.queryAll(By.css('[data-testid="theme-row"]'));
      expect(rows.length).toBe(2);
      expect(fixture.debugElement.queryAll(By.css('[data-testid="theme-badge"]')).length).toBe(0);
    });
  });

  // =========================================================================
  // 3. Skips empty sections
  // =========================================================================

  describe('skips empty sections', () => {
    it('renders only the present sections (tone + summary only)', () => {
      const json = JSON.stringify({ tone: 'Wry', summary: 'A short summary.' });
      setResult(makeLiteraryResult(json));

      expect(fixture.debugElement.query(By.css('[data-testid="literary-summary"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-tone"]'))).not.toBeNull();
      // Absent sections must not render.
      expect(fixture.debugElement.query(By.css('[data-testid="literary-themes"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-narrative-voice"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-devices"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-mood"]'))).toBeNull();
    });

    it('drops fully-empty theme and device rows', () => {
      const json = JSON.stringify({
        themes: [{ name: '', description: '' }, { name: 'Real', description: '' }],
        rhetoricalDevices: [{ name: '', example: '', effect: '' }],
      });
      setResult(makeLiteraryResult(json));

      const themeRows = fixture.debugElement.queryAll(By.css('[data-testid="theme-row"]'));
      expect(themeRows.length).toBe(1);
      expect((themeRows[0].nativeElement as HTMLElement).textContent).toContain('Real');
      // The single empty device row is dropped, so the devices block is absent.
      expect(fixture.debugElement.query(By.css('[data-testid="literary-devices"]'))).toBeNull();
    });
  });

  // =========================================================================
  // 4. he/en label parity
  // =========================================================================

  describe('he/en label parity', () => {
    function blockTitles(): string[] {
      return fixture.debugElement
        .queryAll(By.css('.literary-block-title'))
        .map(d => (d.nativeElement as HTMLElement).textContent?.trim() || '');
    }

    it('uses Hebrew section titles by default', () => {
      setResult(makeLiteraryResult(FULL_LITERARY, { language: 'he' }));
      const titles = blockTitles();
      expect(titles).toContain('מוטיבים');
      expect(titles).toContain('טון');
      expect(titles).toContain('קול מספר');
      expect(titles).toContain('אמצעים רטוריים');
      expect(titles).toContain('התקדמות מצב הרוח');
      const view = fixture.debugElement.query(By.css('[data-testid="literary-view"]'));
      expect((view.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
    });

    it('uses English section titles and LTR when the result language is English', () => {
      setResult(makeLiteraryResult(FULL_LITERARY, { language: 'en' }));
      const titles = blockTitles();
      expect(titles).toContain('Themes');
      expect(titles).toContain('Tone');
      expect(titles).toContain('Narrative voice');
      expect(titles).toContain('Rhetorical devices');
      expect(titles).toContain('Mood progression');
      const view = fixture.debugElement.query(By.css('[data-testid="literary-view"]'));
      expect((view.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
    });
  });

  // =========================================================================
  // 5. Malformed / non-JSON resultText falls back gracefully
  // =========================================================================

  describe('graceful fallback', () => {
    it('renders the parse-error note + raw toggle for invalid JSON (no throw, no blank)', () => {
      expect(() => setResult(makeLiteraryResult('{ not valid json'))).not.toThrow();

      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-raw-toggle"]'))).not.toBeNull();
      // No structured sections rendered.
      expect(fixture.debugElement.query(By.css('[data-testid="literary-themes"]'))).toBeNull();
    });

    it('treats prose (non-JSON) resultText as a parse failure rather than throwing', () => {
      expect(() => setResult(makeLiteraryResult('This is a plain prose literary analysis, not JSON.'))).not.toThrow();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).not.toBeNull();
    });

    for (const payload of ['null', '123', '"just a string"', 'true', '[]']) {
      it(`treats JSON \`${payload}\` as a parse failure without throwing`, () => {
        expect(() => setResult(makeLiteraryResult(payload))).not.toThrow();
        expect(() => component.view).not.toThrow();
        expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).not.toBeNull();
        expect(fixture.debugElement.query(By.css('[data-testid="theme-row"]'))).toBeNull();
      });
    }

    it('shows the raw text after clicking the raw toggle', () => {
      const raw = '{ broken json but readable raw text';
      setResult(makeLiteraryResult(raw));

      // Hidden initially.
      expect(fixture.debugElement.query(By.css('[data-testid="literary-raw"]'))).toBeNull();
      const toggle = fixture.debugElement.query(By.css('[data-testid="literary-raw-toggle"]'));
      (toggle.nativeElement as HTMLButtonElement).click();
      fixture.detectChanges();

      const rawBlock = fixture.debugElement.query(By.css('[data-testid="literary-raw"]'));
      expect(rawBlock).not.toBeNull();
      expect((rawBlock.nativeElement as HTMLElement).textContent).toContain('readable raw text');
    });

    it('renders the empty note (not blank) for a parsed-but-empty object', () => {
      setResult(makeLiteraryResult('{}'));
      expect(fixture.debugElement.query(By.css('[data-testid="literary-empty-note"]'))).not.toBeNull();
      // No section, no parse-error (it parsed fine, just had nothing usable).
      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-summary"]'))).toBeNull();
    });

    it('resolves the empty note in English when language is en', () => {
      setResult(makeLiteraryResult('{}', { language: 'en' }));
      const note = fixture.debugElement.query(By.css('[data-testid="literary-empty-note"]'));
      expect((note.nativeElement as HTMLElement).textContent).toContain('No structured content found');
    });
  });

  // =========================================================================
  // 6. structuredResult fallback + non-LiteraryAnalysis guard
  // =========================================================================

  describe('source + type guards', () => {
    it('parses from structuredResult when present (preferred over resultText)', () => {
      setResult(makeLiteraryResult('ignored raw', {
        structuredResult: JSON.stringify({ summary: 'From structured.' }),
      }));
      const summary = fixture.debugElement.query(By.css('[data-testid="literary-summary"]'));
      expect((summary.nativeElement as HTMLElement).textContent).toContain('From structured.');
    });

    it('falls back to resultText when structuredResult is non-empty but not an object (array)', () => {
      // structuredResult holds valid JSON that is NOT a usable literary object (an array); resultText holds
      // the real LiteraryAnalysisResult. The non-object must not short-circuit into parse-failed.
      setResult(makeLiteraryResult(FULL_LITERARY, { structuredResult: '[]' }));
      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).toBeNull();
      const summary = fixture.debugElement.query(By.css('[data-testid="literary-summary"]'));
      expect((summary.nativeElement as HTMLElement).textContent).toContain('reflective chapter on solitude');
    });

    it('falls back to resultText when structuredResult is non-empty but invalid JSON', () => {
      setResult(makeLiteraryResult(FULL_LITERARY, { structuredResult: '{ not valid json' }));
      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-themes"]'))).not.toBeNull();
    });

    it('still renders parse-failed when BOTH structuredResult and resultText are unusable', () => {
      setResult(makeLiteraryResult('also not json', { structuredResult: '12345' }));
      expect(fixture.debugElement.query(By.css('[data-testid="literary-parse-error"]'))).not.toBeNull();
    });

    it('returns null view and renders nothing for a non-LiteraryAnalysis (Proofread) result', () => {
      const proofread = makeLiteraryResult(FULL_LITERARY, {
        type: 'Proofread',
        analysisType: 'Proofread',
      });
      setResult(proofread);
      expect(component.view).toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="literary-view"]'))).toBeNull();
    });
  });
});
