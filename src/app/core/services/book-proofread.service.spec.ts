import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { EMPTY, Subject } from 'rxjs';
import { BookProofreadService } from './book-proofread.service';
import { AnalysisProgressService } from './analysis-progress.service';
import { BookProofreadStatusDto, StartBookProofreadResponse } from '../models/book-proofread';

describe('BookProofreadService (f2)', () => {
  let svc: BookProofreadService;
  let http: HttpTestingController;
  let progress: { pollBookProofreadProgress: jasmine.Spy };

  beforeEach(() => {
    progress = { pollBookProofreadProgress: jasmine.createSpy('pollBookProofreadProgress').and.returnValue(EMPTY) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AnalysisProgressService, useValue: progress },
      ],
    });
    svc = TestBed.inject(BookProofreadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('start POSTs api/books/{id}/proofread with language and force as QUERY params and no body', () => {
    const body: StartBookProofreadResponse = {
      jobId: 'j1', started: true, skippedFresh: 1, plannedChapters: 2, estimatedChunks: 4, estimatedSeconds: 160,
    };
    let got: StartBookProofreadResponse | undefined;
    svc.start('b1', 'he', true).subscribe(r => (got = r));

    const req = http.expectOne(r => r.url === '/api/books/b1/proofread');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('language')).toBe('he');
    expect(req.request.params.get('force')).toBe('true');
    expect(req.request.body).toBeNull();
    req.flush(body);
    expect(got).toEqual(body);
  });

  it('start defaults to language he and force=false', () => {
    svc.start('b1').subscribe();
    const req = http.expectOne(r => r.url === '/api/books/b1/proofread');
    expect(req.request.params.get('language')).toBe('he');
    expect(req.request.params.get('force')).toBe('false');
    req.flush({});
  });

  it('startFailed (c20) POSTs proofread with onlyFailed=true, the language, no force and no body', () => {
    let got: StartBookProofreadResponse | undefined;
    svc.startFailed('b1', 'en').subscribe(r => (got = r));
    const req = http.expectOne(r => r.url === '/api/books/b1/proofread');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('onlyFailed')).toBe('true');
    expect(req.request.params.get('language')).toBe('en');
    expect(req.request.params.has('force')).toBeFalse();
    expect(req.request.body).toBeNull();
    const body: StartBookProofreadResponse = {
      jobId: 'j2', started: true, skippedFresh: 0, plannedChapters: 1, estimatedChunks: 2, estimatedSeconds: 20,
    };
    req.flush(body);
    expect(got).toEqual(body);
  });

  it('startFailed defaults to language he', () => {
    svc.startFailed('b1').subscribe();
    const req = http.expectOne(r => r.url === '/api/books/b1/proofread');
    expect(req.request.params.get('language')).toBe('he');
    req.flush({});
  });

  it('getStatus GETs proofread/status?language= and returns the DTO', () => {
    const dto: BookProofreadStatusDto = {
      activeJobId: 'j9', chaptersWithText: 5, chaptersWithActiveProofread: 3, chaptersStale: 1, lastRunAt: null,
      plannedChapters: 3, estimatedChunks: 6, estimatedSeconds: 240,
      forcePlannedChapters: 5, forceEstimatedChunks: 10, forceEstimatedSeconds: 400,
      unreliableChapters: [{ chapterId: 'c1', title: 'אילון', order: 0 }],
      failedChapters: [{ chapterId: 'c2', title: 'יומנו', order: 1 }],
      failedEstimatedChunks: 2,
      failedEstimatedSeconds: 20,
    };
    let got: BookProofreadStatusDto | undefined;
    svc.getStatus('b1', 'en').subscribe(r => (got = r));
    const req = http.expectOne('/api/books/b1/proofread/status?language=en');
    expect(req.request.method).toBe('GET');
    req.flush(dto);
    expect(got).toEqual(dto);
  });

  it('cancel POSTs proofread/cancel with the job id as a QUERY param and no body', () => {
    svc.cancel('b1', 'job-7').subscribe();
    const req = http.expectOne(r => r.url === '/api/books/b1/proofread/cancel');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('jobId')).toBe('job-7');
    expect(req.request.body).toBeNull();
    req.flush(null);
  });

  it('getProgress delegates to the shared poller with the book and job ids', () => {
    const stop$ = new Subject<void>();
    svc.getProgress('b1', 'job-7', stop$, 1234);
    expect(progress.pollBookProofreadProgress).toHaveBeenCalledWith('b1', 'job-7', stop$, 1234);
  });
});
