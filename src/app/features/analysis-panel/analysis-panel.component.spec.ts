import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnalysisPanelComponent } from './analysis-panel.component';
import { AnalysisService } from '../../core/services/analysis.service';
import { AnalysisProgressService } from '../../core/services/analysis-progress.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisResultDto, AnalysisSuggestionDto } from '../../core/models/analysis';

describe('AnalysisPanelComponent (focused logic)', () => {
  let component: AnalysisPanelComponent;
  let fixture: ComponentFixture<AnalysisPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisPanelComponent],
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            getTemplates: () => of([]),
            getHistory: () => of([]),
            updateSuggestionOutcome: () => of(void 0),
            explainSuggestion: () => of({ explanation: 'because' }),
            run: () => of({} as AnalysisResultDto),
            startAsync: () => of({ jobId: 'job-1', analysisType: 'Proofread', scope: 'Chapter' }),
            getByJob: () => of({} as AnalysisResultDto),
            runStream: () => of(''),
            createTemplate: () => of(),
          },
        },
        {
          provide: DocumentVersionService,
          useValue: {
            list: () => of([]),
            create: () => of(),
            get: () => of(),
          },
        },
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => of(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisPanelComponent);
    component = fixture.componentInstance;
    component.bookId = 'book-1';
    component.chapterId = 'chap-1';
    fixture.detectChanges();
  });

  function makeResultWithSuggestions(overrides: Partial<AnalysisResultDto> = {}): AnalysisResultDto {
    const sug: AnalysisSuggestionDto = {
      id: 's-1',
      analysisResultId: 'r-1',
      originalText: 'world',
      suggestedText: 'friend',
      startOffset: 6,
      endOffset: 11,
      reason: 'Proofread',
      category: null,
      explanation: null,
      outcome: null,
      orderIndex: 0,
    };
    return {
      id: 'r-1',
      chapterId: 'chap-1',
      jobId: null,
      type: 'Proofread',
      resultText: 'Hello friend',
      modelName: 'test-model',
      createdAt: new Date().toISOString(),
      scope: 'Chapter',
      analysisType: 'Proofread',
      structuredResult: null,
      sceneId: null,
      bookId: 'book-1',
      language: 'he',
      status: 'Active',
      proofreadNoChangesHint: false,
      suggestions: [sug],
      ...overrides,
    };
  }

  it('mapDtoSuggestions respects adjustOffsets and heuristic filter', () => {
    const result = makeResultWithSuggestions({
      suggestions: [
        {
          id: 's-1',
          analysisResultId: 'r-1',
          originalText: 'a'.repeat(80),
          suggestedText: 'x',
          startOffset: 0,
          endOffset: 80,
          reason: 'Proofread',
          category: null,
          explanation: null,
          outcome: null,
          orderIndex: 0,
        },
      ],
    });

    (component as any).documentText = 'a'.repeat(80);

    const withoutFilter = (component as any).mapDtoSuggestions(result, true, false) as any[];
    const withFilter = (component as any).mapDtoSuggestions(result, true, true) as any[];

    expect(withoutFilter.length).toBe(1);
    expect(withFilter.length).toBe(0);
  });

  it('rebuildHistoryFromAllAnalyses filters by historyFilterType and sorts by createdAt', () => {
    const newer = makeResultWithSuggestions({ id: 'r-new', createdAt: new Date(Date.now() + 1000).toISOString() });
    const older = makeResultWithSuggestions({ id: 'r-old', createdAt: new Date(Date.now() - 1000).toISOString(), analysisType: 'LineEdit' });

    (component as any).allAnalyses = [older, newer];
    component.historyFilterType = null;

    (component as any).rebuildHistoryFromAllAnalyses();

    expect(component['history'].length).toBe(2);
    expect(component['history'][0].id).toBe('r-new');

    component.historyFilterType = 'LineEdit';
    (component as any).rebuildHistoryFromAllAnalyses();
    expect(component['history'].length).toBe(1);
    expect(component['history'][0].id).toBe('r-old');
  });

  it('applyOutcomeToSuggestionDtos updates in-memory DTO across latestResult and allAnalyses', () => {
    const result = makeResultWithSuggestions();
    component['latestResult'] = result;
    (component as any).allAnalyses = [result];

    (component as any).applyOutcomeToSuggestionDtos('s-1', 'Accepted');

    expect(component['latestResult']!.suggestions![0].outcome).toBe('Accepted');
    expect((component as any).allAnalyses[0].suggestions[0].outcome).toBe('Accepted');
  });

  it('applyExplanationToSuggestionDtos caches explanation on DTO', () => {
    const result = makeResultWithSuggestions();
    component['latestResult'] = result;
    (component as any).allAnalyses = [result];

    (component as any).applyExplanationToSuggestionDtos('s-1', 'because');

    expect(component['latestResult']!.suggestions![0].explanation).toBe('because');
  });
});

