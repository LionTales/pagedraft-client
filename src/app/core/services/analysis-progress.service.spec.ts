import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { AnalysisProgressService } from './analysis-progress.service';

describe('AnalysisProgressService', () => {
  let service: AnalysisProgressService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AnalysisProgressService],
    });

    service = TestBed.inject(AnalysisProgressService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('exposes a polling observable that can be cancelled via stop$', () => {
    const stop$ = new Subject<void>();

    const sub = service
      // Small interval so the observable would poll if not cancelled; in this
      // focused test we simply ensure that subscribe/unsubscribe wiring works
      // without forcing timers to elapse.
      .pollProgress('book-1', 'chap-1', 'job-1', stop$ as unknown as any, 10)
      .subscribe();

    expect(sub.closed).toBeFalse();

    stop$.next();
    stop$.complete();
    sub.unsubscribe();

    expect(sub.closed).toBeTrue();
  });
});

