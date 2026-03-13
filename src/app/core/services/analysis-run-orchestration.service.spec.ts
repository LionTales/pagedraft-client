import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnalysisRunOrchestrationService } from './analysis-run-orchestration.service';
import { AnalysisService } from './analysis.service';
import { AnalysisProgressService } from './analysis-progress.service';
import { AnalysisProgressDto } from '../models/analysis';

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
      expect(service.shouldUseAsyncJob('Custom', 'a '.repeat(1000))).toBeFalse();
      expect(service.shouldUseAsyncJob('General', 'a '.repeat(1000))).toBeFalse();
    });

    it('returns false when documentText is empty or null', () => {
      expect(service.shouldUseAsyncJob('Proofread', '')).toBeFalse();
      expect(service.shouldUseAsyncJob('Proofread', null as any)).toBeFalse();
    });

    it('returns true for Proofread when word count exceeds 500', () => {
      const longText = Array(501).fill('word').join(' ');
      expect(service.shouldUseAsyncJob('Proofread', longText)).toBeTrue();
    });

    it('returns false for Proofread when word count is 500 or less', () => {
      const shortText = Array(500).fill('word').join(' ');
      expect(service.shouldUseAsyncJob('Proofread', shortText)).toBeFalse();
    });

    it('returns true for LineEdit when word count exceeds 1500', () => {
      const longText = Array(1501).fill('word').join(' ');
      expect(service.shouldUseAsyncJob('LineEdit', longText)).toBeTrue();
    });

    it('returns false for LineEdit when word count is 1500 or less', () => {
      const shortText = Array(1500).fill('word').join(' ');
      expect(service.shouldUseAsyncJob('LineEdit', shortText)).toBeFalse();
    });
  });

  describe('handleProgressUpdate', () => {
    it('builds human-readable status with chunk progress for Proofread', () => {
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
        message: '',
        estimatedCompletionPercent: 40,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.message).toContain('Proofread 2/5');
      expect(result.progressPercent).toBe(40);
    });

    it('uses "Line Edit" label for LineEdit type', () => {
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
        message: '',
        estimatedCompletionPercent: 10,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.message).toContain('Line Edit 1/3');
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
        message: '',
        estimatedCompletionPercent: -1,
      };
      const result = service.handleProgressUpdate(progress);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('failed');
    });
  });

  describe('setLastRunDuration', () => {
    it('returns null when runStartedAt is null', () => {
      expect(service.setLastRunDuration(null)).toBeNull();
    });

    it('returns a seconds label for recent timestamps', () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const label = service.setLastRunDuration(now - 5000);
      expect(label).toMatch(/^\d+s$/);
    });
  });

  describe('emitInitialStatusForRun', () => {
    it('returns a status string including analysis type', () => {
      const status = service.emitInitialStatusForRun('Proofread', 'short text');
      expect(status).toContain('Proofread');
    });

    it('includes streaming indicator when streaming is true', () => {
      const status = service.emitInitialStatusForRun('Custom', 'text', true);
      expect(status).toContain('streaming');
    });
  });
});
