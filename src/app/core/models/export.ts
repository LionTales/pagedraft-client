/**
 * Wave 3 / w4 - the export WIRE contract, exactly as w1 inventoried it on the server.
 *
 * Both endpoints are SYNCHRONOUS and unmetered: a plain GET that answers with the file itself. There is no
 * job, no progress payload and no polling contract, and none is invented here - the only "in progress" this
 * client can honestly show is "the request is in flight", which is a fact about the request and not a
 * fabricated server-side percentage.
 *
 *   GET /api/document/export/book/{bookId}                -> 200 DOCX | 404 | 409 ExportUnavailableDto
 *   GET /api/document/export/chapter/{bookId}/{chapterId} -> 200 DOCX | 404
 *
 * The 200 carries `Content-Disposition: attachment` with BOTH a plain `filename` and an RFC 5987
 * `filename*=UTF-8''...`; Hebrew titles survive only in the second, which is why this client reads that one
 * first (see {@link fileNameFromContentDisposition}).
 */

/** The DOCX media type both endpoints answer with. */
export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The 409 body. A reason TOKEN, never a sentence: this client is he/en bilingual and owns the copy, the
 * same split the tier and readiness payloads use.
 */
export interface ExportUnavailableDto {
  reason: string;
}

/** The one reason token the server sends today: the book has no chapters to put in a file. */
export const EXPORT_REASON_NO_CHAPTERS = 'noChapters';

/** A downloaded file, before it is handed to the browser. */
export interface ExportedFile {
  blob: Blob;
  /** The server's filename when it sent one, else the caller's fallback. Never empty. */
  fileName: string;
}

/**
 * A failed export, normalized so the screen can speak about it without re-reading HTTP internals.
 *
 * `reason` is the server's token when the body carried one (the 409 case) and null otherwise - it is never
 * synthesized from the status code, because "409 means noChapters" is a property of today's server and the
 * screen would keep asserting it after the server learned a second reason.
 */
export interface ExportFailure {
  /** The HTTP status. 0 for a request that never reached the server (offline, DNS, aborted). */
  status: number;
  /** The server's reason token from the error body, or null when it sent none. */
  reason: string | null;
}

/** Type guard, so a `catchError` can tell our normalized failure from a programming error. */
export function isExportFailure(e: unknown): e is ExportFailure {
  return !!e && typeof e === 'object'
    && typeof (e as ExportFailure).status === 'number'
    && 'reason' in (e as object);
}

/**
 * The filename to save under, read from `Content-Disposition`.
 *
 * ORDER MATTERS. `filename*=UTF-8''<percent-encoded>` is read FIRST and the plain `filename` only as a
 * fallback: the server emits both, and for a Hebrew book title the plain parameter is the lossy one. A
 * client that reads `filename` first downloads Hebrew books under a mangled name while every test with an
 * ASCII title passes, which is the pass-in-English-fail-in-Hebrew class this codebase has paid for before.
 *
 * Anything that could escape the download folder (path separators, a leading dot) is stripped: the browser
 * writes this string to disk, so the server is not the only layer that has to be careful with it.
 */
export function fileNameFromContentDisposition(header: string | null, fallback: string): string {
  const fromExtended = extendedFileName(header);
  if (fromExtended) return sanitizeFileName(fromExtended, fallback);
  const plain = plainFileName(header);
  if (plain) return sanitizeFileName(plain, fallback);
  return fallback;
}

/** `filename*=UTF-8''%D7%A1...` -> the decoded name, or null when absent or undecodable. */
function extendedFileName(header: string | null): string | null {
  if (!header) return null;
  const m = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (!m) return null;
  const raw = m[1].trim();
  // charset'language'value - only the third part is a name.
  const parts = raw.split("'");
  const value = parts.length >= 3 ? parts.slice(2).join("'") : raw;
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return null;
  }
}

/** `filename="book.docx"` or `filename=book.docx` -> the name, or null when absent. */
function plainFileName(header: string | null): string | null {
  if (!header) return null;
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted) return quoted[1].trim() || null;
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1].trim() || null : null;
}

/**
 * Keep the name a NAME: no control characters, no directories, no leading dot, never empty.
 *
 * The control-character filter is written as a code-point test rather than a regex range on purpose - a
 * regex escape for the range is easy to get wrong in a way that silently matches everything or nothing.
 */
function sanitizeFileName(name: string, fallback: string): string {
  const printable = Array.from(name)
    .filter(ch => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  const cleaned = printable
    // Path separators, both kinds: this becomes a filename on Windows and on POSIX alike.
    .replace(/[\\/]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
}
