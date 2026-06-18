import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnalysisRunOrchestrationService, AnalysisRunContext } from './analysis-run-orchestration.service';
import { AnalysisService } from './analysis.service';
import { AnalysisProgressService } from './analysis-progress.service';
import { AnalysisProgressDto } from '../models/analysis';

function ctx(overrides: Partial<AnalysisRunContext>): AnalysisRunContext {
  return {
    bookId: 'b',
    chapterId: 'c',
    sceneId: null,
    selectedAnalysisType: 'Proofread',
    customPrompt: null,
    language: 'en',
    documentText: '',
    ...overrides,
  };
}

describe('AnalysisRunOrchestrationService', () => {
  let service: AnalysisRunOrchestrationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AnalysisService,
          useValue: {
            run: () => of({}),
            startAsync: () => of({ jobId: 'j-1' }),
            getByJob: () => of({}),
            runStream: () => of(''),
          },
        },
        {
          provide: AnalysisProgressService,
          useValue: {
            pollProgress: () => of(),
          },
        },
      ],
    });
    service = TestBed.inject(AnalysisRunOrchestrationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('shouldUseAsyncJob', () => {
    it('returns false for non-Proofread/LineEdit types', () => {
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Custom', documentText: 'a '.repeat(1000) }))).toBeFalse();
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'General', documentText: 'a '.repeat(1000) }))).toBeFalse();
    });

    it('returns false when documentText is empty or null', () => {
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: '' }))).toBeFalse();
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: null! }))).toBeFalse();
    });

    it('returns true for Proofread when word count exceeds threshold (default 500)', () => {
      const longText = Array(501).fill('word').join(' ');
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: longText }))).toBeTrue();
    });

    it('returns false for Proofread when word count is at or below threshold', () => {
      const shortText = Array(500).fill('word').join(' ');
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'Proofread', documentText: shortText }))).toBeFalse();
    });

    it('returns true for LineEdit when word count exceeds threshold (default 1500)', () => {
      const longText = Array(1501).fill('word').join(' ');
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'LineEdit', documentText: longText }))).toBeTrue();
    });

    it('returns false for LineEdit when word count is at or below threshold', () => {
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'LineEdit', documentText: 'one' }))).toBeFalse();
      expect(service.shouldUseAsyncJob(ctx({ selectedAnalysisType: 'LineEdit', documentText: Array(1500).fill('word').join(' ') }))).toBeFalse();
    });

    it('uses custom proofreadChunkTargetWords / lineEditChunkTargetWords from context', () => {
      // LineEdit with server threshold 500: 600 words → async
      expect(service.shouldUseAsyncJob(ctx({
        selectedAnalysisType: 'LineEdit',
        documentText: Array(600).fill('w').join(' '),
        lineEditChunkTargetWords: 500,
      }))).toBeTrue();
      // LineEdit with server threshold 500: 400 words → sync
      expect(service.shouldUseAsyncJob(ctx({
        selectedAnalysisType: 'LineEdit',
        documentText: Array(400).fill('w').join(' '),
        lineEditChunkTargetWords: 500,
      }))).toBeFalse();
    });
  });

  describe('handleProgressUpdate', () => {
    it('builds human-readable status with completedChunks for Proofread', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'running',
        currentChunk: 2,
        totalChunks: 5,
        completedChunks: 2,
        message: '',
        estimatedCompletionPercent: 40,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.message).toContain('Proofread');
      expect(result.message).toContain('2 of 5 completed');
      expect(result.progressPercent).toBe(40);
    });

    it('shows "analyzing…" when completedChunks is 0', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'running',
        currentChunk: 1,
        totalChunks: 3,
        completedChunks: 0,
        message: '',
        estimatedCompletionPercent: 0,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.message).toContain('Proofread');
      expect(result.message).toContain('analyzing…');
      expect(result.progressPercent).toBe(0);
    });

    it('uses "Line Edit" label and server estimatedCompletionPercent', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'LineEdit',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'running',
        currentChunk: 1,
        totalChunks: 3,
        completedChunks: 1,
        message: '',
        estimatedCompletionPercent: 33,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.message).toContain('Line Edit');
      expect(result.message).toContain('1 of 3 completed');
      expect(result.progressPercent).toBe(33);
    });

    it('reports failed status', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'failed',
        currentChunk: 0,
        totalChunks: 0,
        completedChunks: 0,
        message: '',
        estimatedCompletionPercent: -1,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('failed');
    });

    it('returns 100% when status is succeeded', () => {
      const progress: AnalysisProgressDto = {
        jobId: 'j-1',
        analysisType: 'Proofread',
        scope: 'Chapter',
        bookId: 'b-1',
        chapterId: 'c-1',
        sceneId: null,
        status: 'succeeded',
        currentChunk: 3,
        totalChunks: 3,
        completedChunks: 3,
        message: '',
        estimatedCompletionPercent: 100,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.progressPercent).toBe(100);
    });
  });

  describe('formatRunDuration', () => {
    it('returns null when runStartedAt is null', () => {
      expect(service.formatRunDuration(null)).toBeNull();
    });

    it('returns a seconds label for recent timestamps', () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const label = service.formatRunDuration(now - 5000, now);
      expect(label).toMatch(/^\d+s$/);
    });
  });

  describe('emitInitialStatusForRun', () => {
    it('returns a status string including analysis type', () => {
      const status = service.emitInitialStatusForRun(ctx({ selectedAnalysisType: 'Proofread', documentText: 'short text' }));
      expect(status).toContain('Proofread');
    });

    it('includes streaming indicator when streaming is true', () => {
      const status = service.emitInitialStatusForRun(ctx({ selectedAnalysisType: 'Custom', documentText: 'text' }), true);
      expect(status).toContain('streaming');
    });
  });

  describe('doRunStreaming', () => {
    it('stamps the synthetic streaming-complete result with the run language', () => {
      const events: any[] = [];
      service
        .doRunStreaming(ctx({ selectedAnalysisType: 'LinguisticAnalysis', language: 'en' }))
        .subscribe(e => events.push(e));

      const complete = events.find(e => e.kind === 'streaming-complete');
      expect(complete).withContext('a streaming-complete event should be emitted').toBeTruthy();
      // Without the language stamp, LinguisticResultComponent defaults to Hebrew (RTL + Hebrew labels),
      // so an English run would render with the wrong direction/labels.
      expect(complete.latestResult.language).toBe('en');
      expect(complete.latestResult.analysisType).toBe('LinguisticAnalysis');
    });
  });
});
