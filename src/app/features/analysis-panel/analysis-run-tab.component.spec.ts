import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AnalysisRunTabComponent } from './analysis-run-tab.component';
import { LineEditParserService } from '../../core/services/line-edit-parser.service';
import { AnalysisResultDto } from '../../core/models/analysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLinguisticResult(
  structuredResult: string | null,
  overrides: Partial<AnalysisResultDto> = {}
): AnalysisResultDto {
  return {
    id: 'r-ling',
    chapterId: 'chap-1',
    jobId: null,
    type: 'LinguisticAnalysis',
    analysisType: 'LinguisticAnalysis',
    resultText: '',
    modelName: 'test-model',
    createdAt: new Date().toISOString(),
    scope: 'Chapter',
    structuredResult,
    sceneId: null,
    bookId: 'book-1',
    language: 'he',
    status: 'Active',
    proofreadNoChangesHint: false,
    suggestions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AnalysisRunTabComponent', () => {
  let component: AnalysisRunTabComponent;
  let fixture: ComponentFixture<AnalysisRunTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisRunTabComponent],
      // Linguistic results never parse as Line Edit; stub keeps the test isolated.
      providers: [{ provide: LineEditParserService, useValue: { getLineEdit: () => null } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisRunTabComponent);
    component = fixture.componentInstance;
  });

  function query(selector: string) {
    return fixture.debugElement.query(By.css(selector));
  }

  // =========================================================================
  // Regression: a completed LinguisticAnalysis must not also show "no run yet"
  // =========================================================================

  describe('completed LinguisticAnalysis run', () => {
    const structured = JSON.stringify({
      deviations: [{ metric: 'sentenceCount', sceneValue: 11, chapterBaseline: 9, note: '' }],
      consistencyIssues: [],
    });

    it('renders the dedicated linguistic view and NOT the "no analysis run yet" message', () => {
      component.latestResult = makeLinguisticResult(structured);
      component.streamingText = '';
      fixture.detectChanges();

      // Dedicated linguistic block renders, with the parsed deviation chip (not the raw stream).
      expect(query('[data-testid="linguistic-view"]')).not.toBeNull();
      expect(query('[data-testid="deviation-row"]')).not.toBeNull();
      // The generic empty-state must NOT contradict it.
      expect(query('[data-testid="no-run-yet"]')).toBeNull();
    });
  });

  // =========================================================================
  // The empty state still shows when nothing has run
  // =========================================================================

  describe('no run yet', () => {
    it('shows the "no analysis run yet" message when there is no result or stream', () => {
      component.latestResult = null;
      component.streamingText = '';
      component.proofreadSuggestions = [];
      component.lineEditRunSuggestions = [];
      fixture.detectChanges();

      expect(query('[data-testid="no-run-yet"]')).not.toBeNull();
      expect(query('[data-testid="linguistic-view"]')).toBeNull();
    });
  });

  // =========================================================================
  // While a linguistic run is still streaming, neither the dedicated block
  // nor the empty-state message should appear (live text owns the view).
  // =========================================================================

  describe('streaming linguistic run', () => {
    it('does not show the dedicated linguistic view or the "no run yet" message mid-stream', () => {
      component.latestResult = null;
      component.streamingText = 'partial tokens streaming in...';
      fixture.detectChanges();

      expect(query('[data-testid="linguistic-view"]')).toBeNull();
      expect(query('[data-testid="no-run-yet"]')).toBeNull();
    });
  });
});
