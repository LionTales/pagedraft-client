import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AnalysisService } from './analysis.service';
import { RunAnalysisRequest } from '../models/analysis';

describe('AnalysisService', () => {
  let service: AnalysisService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AnalysisService],
    });

    service = TestBed.inject(AnalysisService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  // Wave 3 / w7: a 'should GET templates' case LIVED HERE, over `getTemplates()`. The method went with
  // the save-as-template button; `/api/templates` is still served, this client just never calls it.

  it('should GET history without filters', () => {
    service.getHistory('book-1', 'chap-1', null, null).subscribe();

    const req = http.expectOne('/api/books/book-1/chapters/chap-1/analyses');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().length).toBe(0);
    req.flush([]);
  });

  it('should GET history with type and sceneId', () => {
    service.getHistory('book-1', 'chap-1', 'Proofread', 'scene-1').subscribe();

    const req = http.expectOne(r =>
      r.url === '/api/books/book-1/chapters/chap-1/analyses' &&
      r.params.get('analysisType') === 'Proofread' &&
      r.params.get('sceneId') === 'scene-1');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('should PATCH suggestion outcome', () => {
    service.updateSuggestionOutcome('book-1', 'chap-1', 'sug-1', 'Accepted').subscribe();

    const req = http.expectOne('/api/books/book-1/chapters/chap-1/suggestions/sug-1/outcome');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.outcome).toBe('Accepted');
    req.flush(null);
  });

  it('should POST explain suggestion', () => {
    service.explainSuggestion('book-1', 'chap-1', 'sug-1').subscribe();

    const req = http.expectOne('/api/books/book-1/chapters/chap-1/suggestions/sug-1/explain');
    expect(req.request.method).toBe('POST');
    req.flush({ explanation: 'because' });
  });

  it('should POST run analysis with optional sceneId', () => {
    const body: RunAnalysisRequest = { analysisType: 'Proofread', language: 'he', stream: false };

    service.run('book-1', 'chap-1', body, 'scene-1').subscribe();

    const req = http.expectOne(r =>
      r.url === '/api/books/book-1/chapters/chap-1/analyze' &&
      r.params.get('sceneId') === 'scene-1');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.analysisType).toBe('Proofread');
    req.flush({});
  });

  it('should POST start async analysis job', () => {
    const body: RunAnalysisRequest = { analysisType: 'Proofread', language: 'he', stream: false };

    service.startAsync('book-1', 'chap-1', body, 'scene-1').subscribe();

    const req = http.expectOne(r =>
      r.url === '/api/books/book-1/chapters/chap-1/analysis-jobs' &&
      r.params.get('sceneId') === 'scene-1');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.analysisType).toBe('Proofread');
    req.flush({ jobId: 'job-1', analysisType: 'Proofread', scope: 'Chapter' });
  });

  it('should GET analysis by job id', () => {
    service.getByJob('book-1', 'chap-1', 'job-1').subscribe();

    const req = http.expectOne('/api/books/book-1/chapters/chap-1/analysis-jobs/job-1');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('should GET chunk thresholds from config endpoint', () => {
    const expected = { proofreadChunkTargetWords: 500, lineEditChunkTargetWords: 1500 };
    let result: any;
    service.getChunkThresholds().subscribe(r => result = r);

    const req = http.expectOne('/api/config/analysis-chunk-thresholds');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('language')).toBeFalse();
    req.flush(expected);
    expect(result).toEqual(expected);
  });

  it('should send the book language so the thresholds match the server chunk sizing', () => {
    const expected = { proofreadChunkTargetWords: 250, lineEditChunkTargetWords: 250 };
    let result: any;
    service.getChunkThresholds('he').subscribe(r => result = r);

    const req = http.expectOne(r => r.url === '/api/config/analysis-chunk-thresholds');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('language')).toBe('he');
    req.flush(expected);
    expect(result).toEqual(expected);
  });

  /**
   * p3-4: the threshold is a function of (language, TIER), because the tier can change which provider a task
   * routes to and therefore which window sizes the chunker. At the shipped values the two tiers return the
   * same numbers, so the analysis panel does not send the tier yet; the parameter exists so wiring it is one
   * argument rather than a refactor the day a tier entry's window drops below the crossover.
   */
  it('sends the tier when one is supplied, and omits both params when neither is', () => {
    service.getChunkThresholds('he', 'thinking').subscribe();
    const withTier = http.expectOne(r => r.url === '/api/config/analysis-chunk-thresholds');
    expect(withTier.request.params.get('language')).toBe('he');
    expect(withTier.request.params.get('tier')).toBe('thinking');
    withTier.flush({ proofreadChunkTargetWords: 250, lineEditChunkTargetWords: 250 });

    service.getChunkThresholds(undefined, '  ').subscribe();
    const bare = http.expectOne('/api/config/analysis-chunk-thresholds');
    expect(bare.request.params.has('tier')).toBeFalse();
    expect(bare.request.params.has('language')).toBeFalse();
    bare.flush({ proofreadChunkTargetWords: 250, lineEditChunkTargetWords: 250 });
  });
});

