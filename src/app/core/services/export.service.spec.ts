/**
 * Wave 3 / w4 - the export transfer, at the wire.
 *
 * THE TWO DOCUMENT PATHS ARE BOTH ASSERTED HERE, deliberately and side by side. Book-level export and
 * single-chapter export are separate paths on the server and have drifted from each other before (w1 fixed
 * three real bugs in exactly that seam), and this screen is the first surface that exposes both. So every
 * property that matters - the URL, the blob transfer, the filename read, the failure normalization - is
 * asserted for the BOOK call and again for the CHAPTER call, rather than once for whichever was written
 * first.
 *
 * The filename cases include a HEBREW one on purpose: the server sends both `filename` and
 * `filename*=UTF-8''...`, and a client that reads the plain parameter first passes every ASCII test while
 * saving Hebrew books under a mangled name.
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';

import {
  DOCX_CONTENT_TYPE,
  EXPORT_REASON_NO_CHAPTERS,
  ExportFailure,
  ExportedFile,
  fileNameFromContentDisposition,
  isExportFailure,
} from '../models/export';
import { ExportService } from './export.service';

const BOOK_ID = '11111111-1111-1111-1111-111111111111';
const CHAPTER_ID = '22222222-2222-2222-2222-222222222222';
const BOOK_URL = `/api/document/export/book/${BOOK_ID}`;
const CHAPTER_URL = `/api/document/export/chapter/${BOOK_ID}/${CHAPTER_ID}`;

/** A Content-Disposition exactly as the API emits it: the plain parameter AND the RFC 5987 one. */
function disposition(name: string, asciiFallback = 'book.docx'): string {
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function docx(): Blob {
  return new Blob(['PK-not-really-a-docx'], { type: DOCX_CONTENT_TYPE });
}

describe('ExportService (Wave 3 / w4)', () => {
  let svc: ExportService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ExportService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── The two calls, one property at a time, both paths every time ────────────────────────────────

  describe('the request', () => {
    it('GETs the book endpoint as a blob, observing the response so the header is readable', () => {
      svc.exportBook(BOOK_ID).subscribe();
      const req = http.expectOne(BOOK_URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(docx(), { headers: { 'Content-Disposition': disposition('book.docx') } });
    });

    it('GETs the chapter endpoint the same way, book-scoped in the path', () => {
      svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe();
      const req = http.expectOne(CHAPTER_URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(docx(), { headers: { 'Content-Disposition': disposition('chapter.docx') } });
    });

    it('sends no body, no query and no job id: both endpoints are synchronous and take nothing', () => {
      svc.exportBook(BOOK_ID).subscribe();
      const book = http.expectOne(BOOK_URL);
      expect(book.request.body).toBeNull();
      expect(book.request.params.keys().length).toBe(0);
      book.flush(docx(), { headers: { 'Content-Disposition': disposition('b.docx') } });

      svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe();
      const chapter = http.expectOne(CHAPTER_URL);
      expect(chapter.request.body).toBeNull();
      expect(chapter.request.params.keys().length).toBe(0);
      chapter.flush(docx(), { headers: { 'Content-Disposition': disposition('c.docx') } });
    });
  });

  // ── The filename, which is the server's to choose ───────────────────────────────────────────────

  describe('the filename the server chose', () => {
    it('honours a HEBREW book filename from filename*, not the ASCII fallback beside it', () => {
      let got: ExportedFile | undefined;
      svc.exportBook(BOOK_ID).subscribe(f => (got = f));
      http.expectOne(BOOK_URL).flush(docx(), {
        headers: { 'Content-Disposition': disposition('הספר שלי.docx') },
      });
      expect(got!.fileName).toBe('הספר שלי.docx');
    });

    it('honours a HEBREW chapter filename on the chapter path too', () => {
      let got: ExportedFile | undefined;
      svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe(f => (got = f));
      http.expectOne(CHAPTER_URL).flush(docx(), {
        headers: { 'Content-Disposition': disposition('פרק שני.docx', 'chapter.docx') },
      });
      expect(got!.fileName).toBe('פרק שני.docx');
    });

    it('falls back to the server-matching default when the header is missing, per path', () => {
      let book: ExportedFile | undefined;
      svc.exportBook(BOOK_ID).subscribe(f => (book = f));
      http.expectOne(BOOK_URL).flush(docx());
      expect(book!.fileName).toBe('book.docx');

      let chapter: ExportedFile | undefined;
      svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe(f => (chapter = f));
      http.expectOne(CHAPTER_URL).flush(docx());
      expect(chapter!.fileName).toBe('chapter.docx');
    });

    it('carries the response body through as the blob to save', () => {
      let got: ExportedFile | undefined;
      svc.exportBook(BOOK_ID).subscribe(f => (got = f));
      http.expectOne(BOOK_URL).flush(docx(), {
        headers: { 'Content-Disposition': disposition('x.docx') },
      });
      expect(got!.blob.size).toBeGreaterThan(0);
      expect(got!.blob.type).toBe(DOCX_CONTENT_TYPE);
    });
  });

  /** The parser on its own, including the cases a live server will not produce on demand. */
  describe('fileNameFromContentDisposition', () => {
    it('prefers filename* over filename, which is the whole reason Hebrew survives', () => {
      const header = `attachment; filename="book.docx"; filename*=UTF-8''${encodeURIComponent('ספר.docx')}`;
      expect(fileNameFromContentDisposition(header, 'fallback.docx')).toBe('ספר.docx');
    });

    it('reads a quoted plain filename when there is no extended one', () => {
      expect(fileNameFromContentDisposition('attachment; filename="The Book.docx"', 'f.docx'))
        .toBe('The Book.docx');
    });

    it('reads an unquoted plain filename', () => {
      expect(fileNameFromContentDisposition('attachment; filename=book.docx', 'f.docx')).toBe('book.docx');
    });

    it('falls back when the header is absent, empty or names nothing', () => {
      expect(fileNameFromContentDisposition(null, 'f.docx')).toBe('f.docx');
      expect(fileNameFromContentDisposition('attachment', 'f.docx')).toBe('f.docx');
      expect(fileNameFromContentDisposition('attachment; filename=""', 'f.docx')).toBe('f.docx');
    });

    it('falls back rather than throwing when the extended value is not decodable', () => {
      expect(fileNameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'f.docx')).toBe('f.docx');
    });

    it('strips path separators and leading dots: the browser writes this string to disk', () => {
      const header = `attachment; filename*=UTF-8''${encodeURIComponent('../../etc/passwd.docx')}`;
      expect(fileNameFromContentDisposition(header, 'f.docx')).toBe('etcpasswd.docx');
    });
  });

  // ── Failures, normalized ────────────────────────────────────────────────────────────────────────

  describe('failures', () => {
    /**
     * The 409 body arrives as a BLOB, because the request asked for one. Reading the reason token out of it
     * is asynchronous, which is exactly the hop a client is tempted to skip by hardcoding "409 means no
     * chapters" - and then keeps saying it when the server learns a second reason.
     */
    it('reads the reason token out of the 409 blob body on the book path', async () => {
      const failure = await new Promise<ExportFailure>((resolve, reject) => {
        svc.exportBook(BOOK_ID).subscribe({ next: () => reject('unexpected success'), error: e => resolve(e as ExportFailure) });
        http.expectOne(BOOK_URL).flush(
          new Blob([JSON.stringify({ reason: EXPORT_REASON_NO_CHAPTERS })], { type: 'application/json' }),
          { status: 409, statusText: 'Conflict' },
        );
      });
      expect(isExportFailure(failure)).toBeTrue();
      expect(failure.status).toBe(409);
      expect(failure.reason).toBe(EXPORT_REASON_NO_CHAPTERS);
    });

    it('reports a 404 with NO invented reason, on the book path', async () => {
      const failure = await new Promise<ExportFailure>(resolve => {
        svc.exportBook(BOOK_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(BOOK_URL).flush(new Blob([]), { status: 404, statusText: 'Not Found' });
      });
      expect(failure.status).toBe(404);
      expect(failure.reason).toBeNull();
    });

    it('reports a 404 with NO invented reason, on the chapter path', async () => {
      const failure = await new Promise<ExportFailure>(resolve => {
        svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(CHAPTER_URL).flush(new Blob([]), { status: 404, statusText: 'Not Found' });
      });
      expect(failure.status).toBe(404);
      expect(failure.reason).toBeNull();
    });

    it('reports a request that never reached the server as status 0, on both paths', async () => {
      const book = await new Promise<ExportFailure>(resolve => {
        svc.exportBook(BOOK_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(BOOK_URL).error(new ProgressEvent('error'));
      });
      expect(book.status).toBe(0);

      const chapter = await new Promise<ExportFailure>(resolve => {
        svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(CHAPTER_URL).error(new ProgressEvent('error'));
      });
      expect(chapter.status).toBe(0);
    });

    it('reports an unparseable error body as no reason rather than guessing one', async () => {
      const failure = await new Promise<ExportFailure>(resolve => {
        svc.exportBook(BOOK_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(BOOK_URL).flush(new Blob(['<html>gateway</html>']), { status: 502, statusText: 'Bad Gateway' });
      });
      expect(failure.status).toBe(502);
      expect(failure.reason).toBeNull();
    });
  });

  // ── Handing the file to the browser ─────────────────────────────────────────────────────────────

  describe('saveAs', () => {
    it('downloads under the SERVER filename, then releases the object URL', fakeAsync(() => {
      const anchor = document.createElement('a');
      const click = spyOn(anchor, 'click');
      spyOn(document, 'createElement').and.returnValue(anchor);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
      const revoke = spyOn(URL, 'revokeObjectURL');

      svc.saveAs({ blob: docx(), fileName: 'הספר שלי.docx' });

      expect(click).toHaveBeenCalled();
      // The Hebrew name the SERVER chose, not one this client reconstructed from a title.
      expect(anchor.download).toBe('הספר שלי.docx');
      expect(anchor.getAttribute('href')).toBe('blob:fake');
      // The anchor does not stay in the document after the click.
      expect(anchor.isConnected).toBeFalse();

      tick(1);
      expect(revoke).toHaveBeenCalledWith('blob:fake');
    }));
  });
});
