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
  EXPORT_REASON_NOTHING_WRITTEN,
  EXPORT_REASON_NO_CHAPTERS,
  EXPORT_SKIPPED_CHAPTERS_HEADER,
  EXPORT_SKIPPED_COUNT_HEADER,
  ExportFailure,
  ExportedFile,
  fileNameFromContentDisposition,
  isExportFailure,
  skipReportFromHeaders,
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

  // ── What the file does NOT contain (be-c02) ─────────────────────────────────────────────────────
  //
  // A chapter with nothing written in it is left out of the assembled document. Silently, that is
  // indistinguishable from data loss, so the server names the gap on two response headers and this service
  // is the one place they are read. Both document paths are asserted, as everything else here is.

  describe('the skipped-chapter headers', () => {
    /** Percent-encoded JSON, exactly as the API writes it. */
    function skippedHeader(entries: { order: number; title: string }[]): string {
      return encodeURIComponent(JSON.stringify(entries));
    }

    it('reports a complete file as a report of zero, not as an absence, on the book path', () => {
      let got: ExportedFile | undefined;
      svc.exportBook(BOOK_ID).subscribe(f => (got = f));
      http.expectOne(BOOK_URL).flush(docx(), {
        headers: { 'Content-Disposition': disposition('b.docx'), [EXPORT_SKIPPED_COUNT_HEADER]: '0' },
      });
      expect(got!.skipped).toEqual({ count: 0, chapters: [] });
    });

    it('reads the count AND the named chapters, with the raw zero-based order the wire carries', () => {
      let got: ExportedFile | undefined;
      svc.exportBook(BOOK_ID).subscribe(f => (got = f));
      http.expectOne(BOOK_URL).flush(docx(), {
        headers: {
          'Content-Disposition': disposition('b.docx'),
          [EXPORT_SKIPPED_COUNT_HEADER]: '2',
          [EXPORT_SKIPPED_CHAPTERS_HEADER]: skippedHeader([
            { order: 1, title: 'הסופה' },
            { order: 4, title: 'The Long Night' },
          ]),
        },
      });
      expect(got!.skipped).toEqual({
        count: 2,
        chapters: [{ order: 1, title: 'הסופה' }, { order: 4, title: 'The Long Night' }],
      });
    });

    it('reads the same headers on the CHAPTER path, where the count is zero by construction', () => {
      let got: ExportedFile | undefined;
      svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe(f => (got = f));
      http.expectOne(CHAPTER_URL).flush(docx(), {
        headers: { 'Content-Disposition': disposition('c.docx'), [EXPORT_SKIPPED_COUNT_HEADER]: '0' },
      });
      expect(got!.skipped).toEqual({ count: 0, chapters: [] });
    });

    /**
     * THE ONE THAT MATTERS. The count is written on every 200, zero included, so its ABSENCE means an old
     * server or a proxy that stripped it. A client that defaults that to 0 silently promises the author a
     * complete manuscript it knows nothing about.
     */
    it('reports NOT KNOWN, not zero, when the server sent no count header at all', () => {
      let got: ExportedFile | undefined;
      svc.exportBook(BOOK_ID).subscribe(f => (got = f));
      http.expectOne(BOOK_URL).flush(docx(), {
        headers: { 'Content-Disposition': disposition('b.docx') },
      });
      expect(got!.skipped).toBeNull();
    });

    it('keeps the authoritative count when the list is unreadable, bounded or absent', () => {
      // The server bounds the list so a long book cannot blow a proxy's header budget, so it may name
      // FEWER chapters than it counted. A count with no list is a valid answer, not a broken one.
      expect(skipReportFromHeaders('7', null)).toEqual({ count: 7, chapters: [] });
      expect(skipReportFromHeaders('7', encodeURIComponent(JSON.stringify([{ order: 0, title: 'A' }]))))
        .toEqual({ count: 7, chapters: [{ order: 0, title: 'A' }] });
      expect(skipReportFromHeaders('3', 'not%20json')).toEqual({ count: 3, chapters: [] });
      expect(skipReportFromHeaders('3', '%E0%A4%A')).toEqual({ count: 3, chapters: [] });
      expect(skipReportFromHeaders('3', encodeURIComponent(JSON.stringify({ order: 1 }))))
        .toEqual({ count: 3, chapters: [] });
      // Entries that are not a chapter shape are dropped; the count still stands.
      expect(skipReportFromHeaders('2', encodeURIComponent(JSON.stringify([{ order: 'x', title: 'A' }, 3]))))
        .toEqual({ count: 2, chapters: [] });
    });

    it('reports NOT KNOWN for a count header that is not a decimal integer', () => {
      expect(skipReportFromHeaders(null, null)).toBeNull();
      expect(skipReportFromHeaders('', null)).toBeNull();
      expect(skipReportFromHeaders('two', null)).toBeNull();
      expect(skipReportFromHeaders('-1', null)).toBeNull();
      expect(skipReportFromHeaders('1.5', null)).toBeNull();
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

    /**
     * The SECOND 409 token, and the case that used to be a 200 with a valid empty file on the chapter path.
     * It is asserted on both paths because both now send it.
     */
    it('reads the nothingWritten token out of the 409 blob body, on both paths', async () => {
      const book = await new Promise<ExportFailure>(resolve => {
        svc.exportBook(BOOK_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(BOOK_URL).flush(
          new Blob([JSON.stringify({ reason: EXPORT_REASON_NOTHING_WRITTEN })], { type: 'application/json' }),
          { status: 409, statusText: 'Conflict' },
        );
      });
      expect(book.reason).toBe(EXPORT_REASON_NOTHING_WRITTEN);

      const chapter = await new Promise<ExportFailure>(resolve => {
        svc.exportChapter(BOOK_ID, CHAPTER_ID).subscribe({ error: e => resolve(e as ExportFailure) });
        http.expectOne(CHAPTER_URL).flush(
          new Blob([JSON.stringify({ reason: EXPORT_REASON_NOTHING_WRITTEN })], { type: 'application/json' }),
          { status: 409, statusText: 'Conflict' },
        );
      });
      expect(chapter.status).toBe(409);
      expect(chapter.reason).toBe(EXPORT_REASON_NOTHING_WRITTEN);
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

      svc.saveAs({ blob: docx(), fileName: 'הספר שלי.docx', skipped: null });

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
