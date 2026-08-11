import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import {
  DOCX_CONTENT_TYPE,
  EXPORT_SKIPPED_CHAPTERS_HEADER,
  EXPORT_SKIPPED_COUNT_HEADER,
  ExportFailure,
  ExportedFile,
  fileNameFromContentDisposition,
  skipReportFromHeaders,
} from '../models/export';

/**
 * Wave 3 / w4 - the two DOCX export calls, and the one place the browser is handed a file.
 *
 * ── Why a blob, and not a plain navigation ────────────────────────────────────────────────────────
 * The obvious cheap implementation is `window.location.href = '/api/document/export/book/...'` or an
 * anchor pointing straight at the API. It is rejected here for one measured reason: the endpoints answer
 * 404 and 409 with a JSON body, and a navigation hands those to the BROWSER. The user would see a raw JSON
 * page (or a silent nothing, depending on the browser) instead of the screen's own sentence, in a product
 * whose errors must be bilingual and honest. A navigation also gives the app no way to know the request is
 * in flight, so there could be no in-progress affordance at all.
 *
 * So the file comes back as a blob, the screen renders every outcome itself, and {@link saveAs} is the
 * single place a download is triggered - both document paths go through it, so they cannot drift in how
 * the file reaches the disk.
 *
 * ── The two document paths ────────────────────────────────────────────────────────────────────────
 * Book-level export and single-chapter export are separate paths on the server and have drifted before.
 * They are deliberately expressed here as ONE private {@link request} with two thin callers, so anything
 * about the transfer (the blob observe, the header read, the failure normalization) is written once, and
 * `export.service.spec.ts` asserts BOTH callers against the wire.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly base = '/api/document/export';

  constructor(private http: HttpClient) {}

  /**
   * GET /api/document/export/book/{bookId} - the whole book, chapters in order, one DOCX.
   *
   * The fallback name matches the server's own fallback, so a response with no usable
   * `Content-Disposition` still saves under the name the server would have chosen.
   */
  exportBook(bookId: string): Observable<ExportedFile> {
    return this.request(`${this.base}/book/${bookId}`, 'book.docx');
  }

  /** GET /api/document/export/chapter/{bookId}/{chapterId} - one chapter, named after the chapter. */
  exportChapter(bookId: string, chapterId: string): Observable<ExportedFile> {
    return this.request(`${this.base}/chapter/${bookId}/${chapterId}`, 'chapter.docx');
  }

  /**
   * Hand a downloaded file to the browser.
   *
   * `download` carries the SERVER's filename (Hebrew included, read from `filename*`), which is the whole
   * reason the name is parsed rather than reconstructed here from a book title: the server strips invalid
   * characters and caps the length, and a second naming rule in the client would eventually disagree.
   *
   * The object URL is revoked after the click. Chrome needs the URL to still be alive when the click is
   * dispatched, so the revoke is deferred rather than run on the next line.
   */
  saveAs(file: ExportedFile): void {
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * The one transfer. `observe: 'response'` because the file's NAME and everything the file is MISSING both
   * live in headers rather than in the body - a DOCX has nowhere to put metadata - and
   * `responseType: 'blob'` because the body is a DOCX.
   *
   * Both header reads are done here, once, for the same reason the transfer is: the two document paths have
   * drifted before, and a caller that read the skipped-chapter headers itself would be the drift.
   *
   * The `catchError` here only ever sees a genuine HTTP-layer error (a 4xx/5xx or a transport failure);
   * {@link toExportedFile} runs strictly AFTER it, so a 200 it rejects (an empty body, or a content type
   * that is not a DOCX) surfaces as its own failure rather than being re-processed by `toFailure`, which
   * expects an `HttpErrorResponse`.
   */
  private request(url: string, fallbackName: string): Observable<ExportedFile> {
    return this.http
      .get(url, { observe: 'response', responseType: 'blob' })
      .pipe(
        catchError((err: HttpErrorResponse) => this.toFailure(err)),
        switchMap((res: HttpResponse<Blob>) => this.toExportedFile(res, fallbackName)),
      );
  }

  /**
   * Turn a 200 response into the file this screen can save, or refuse it.
   *
   * TWO THINGS A 200 CAN LIE ABOUT: a bodyless response (`res.body ?? new Blob([])` used to turn that into
   * a 0-byte "successful" download) and a body that is not actually a DOCX - a proxy returning its own HTML
   * error page under a 200 would otherwise be saved to disk with a `.docx` name. Both are refused here
   * rather than silently accepted.
   *
   * The content-type check is PERMISSIVE about a MISSING header (CORS-safelisted, so a real server always
   * sends one, but nothing here should invent a failure out of a test double or a proxy that stripped it) -
   * it only refuses a header that is PRESENT and says something other than {@link DOCX_CONTENT_TYPE}.
   */
  private toExportedFile(res: HttpResponse<Blob>, fallbackName: string): Observable<ExportedFile> {
    const contentType = res.headers.get('Content-Type');
    const wrongType = contentType !== null && contentType.split(';')[0].trim() !== DOCX_CONTENT_TYPE;
    if (res.body === null || wrongType) {
      return throwError((): ExportFailure => ({ status: res.status, reason: null }));
    }
    return of({
      blob: res.body,
      fileName: fileNameFromContentDisposition(res.headers.get('Content-Disposition'), fallbackName),
      // Null when the server said nothing, which is NOT "nothing was skipped" - see
      // `skipReportFromHeaders`. The screen has a different sentence for each.
      skipped: skipReportFromHeaders(
        res.headers.get(EXPORT_SKIPPED_COUNT_HEADER),
        res.headers.get(EXPORT_SKIPPED_CHAPTERS_HEADER),
      ),
    });
  }

  /**
   * Normalize an HTTP error into an {@link ExportFailure}.
   *
   * THE BLOB TRAP: because the request asked for a blob, an ERROR body also arrives as a Blob, so the 409's
   * `{ "reason": "noChapters" }` is not readable as an object the way it would be on a JSON request. Reading
   * it costs one async hop, and skipping that hop is how a screen ends up hardcoding "409 means no chapters"
   * and then saying it for a reason the server has not sent yet. The server has since learned a SECOND
   * reason (`nothingWritten`) on both paths, which is exactly the day that shortcut would have started
   * lying.
   *
   * A body that is missing, empty or unparseable yields `reason: null` rather than a guess; the screen has a
   * truthful sentence for that case.
   */
  private toFailure(err: HttpErrorResponse): Observable<never> {
    const body: unknown = err.error;
    const text$: Observable<string | null> =
      body instanceof Blob
        ? from(body.text()).pipe(catchError(() => of(null)))
        : of(typeof body === 'string' ? body : null);
    return text$.pipe(
      switchMap(text =>
        throwError((): ExportFailure => ({ status: err.status, reason: reasonFrom(text) })),
      ),
    );
  }
}

/** Pull `reason` out of an error body, or null when there is nothing truthful to pull. */
function reasonFrom(text: string | null): string | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    const reason = (parsed as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' && reason.length > 0 ? reason : null;
  } catch {
    return null;
  }
}
