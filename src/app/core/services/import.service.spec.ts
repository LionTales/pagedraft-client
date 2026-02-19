import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ImportService } from './import.service';
import { ImportConfirmationRequest } from '../models/book';

describe('ImportService', () => {
  let service: ImportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ImportService],
    });

    service = TestBed.inject(ImportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('should upload for preview', () => {
    const file = new File(['content'], 'test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    service.uploadForPreview('book-1', file).subscribe();

    const req = http.expectOne('/api/document/import/book-1');
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBeTrue();
    req.flush({ bookId: 'book-1', fileName: 'test.docx', fileSize: 7, pageCount: null, chapters: [] });
  });

  it('should send confirmation request', () => {
    const payload: ImportConfirmationRequest = {
      mode: 'append',
      chapters: [],
    };

    service.confirmImport('book-1', payload).subscribe();

    const req = http.expectOne('/api/document/import/book-1/confirm');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.mode).toBe('append');
    req.flush({ bookId: 'book-1', importedCount: 0, skippedCount: 0, totalChapters: 0, chapters: [] });
  });
});

