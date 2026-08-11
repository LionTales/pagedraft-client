/**
 * Wave 3 / w4 - the export WIRE contract, exactly as w1 inventoried it on the server.
 *
 * Both endpoints are SYNCHRONOUS and unmetered: a plain GET that answers with the file itself. There is no
 * job, no progress payload and no polling contract, and none is invented here - the only "in progress" this
 * client can honestly show is "the request is in flight", which is a fact about the request and not a
 * fabricated server-side percentage.
 *
 *   GET /api/document/export/book/{bookId}                -> 200 DOCX | 404 | 409 ExportUnavailableDto
 *   GET /api/document/export/chapter/{bookId}/{chapterId} -> 200 DOCX | 404 | 409 ExportUnavailableDto
 *
 * The 200 carries `Content-Disposition: attachment` with BOTH a plain `filename` and an RFC 5987
 * `filename*=UTF-8''...`; Hebrew titles survive only in the second, which is why this client reads that one
 * first (see {@link fileNameFromContentDisposition}).
 *
 * It also carries {@link EXPORT_SKIPPED_COUNT_HEADER} and, when that is not zero,
 * {@link EXPORT_SKIPPED_CHAPTERS_HEADER}: the export leaves out a chapter with nothing written in it, and
 * an author must be told which ones rather than discovering a gap in their own manuscript. All three
 * headers are in the API's CORS `WithExposedHeaders`; none of them is CORS-safelisted, so a missing entry
 * there makes every read here return null cross-origin while dev, being same-origin, shows nothing.
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

/** The book has no chapter rows at all, so there is nothing to put in a file. The fix is an import. */
export const EXPORT_REASON_NO_CHAPTERS = 'noChapters';

/**
 * There IS something to export in principle, but nothing in it has been written, so the document would be
 * blank. Distinct from {@link EXPORT_REASON_NO_CHAPTERS} because the next action differs: import versus
 * write.
 *
 * Sent by BOTH paths. The chapter path used to answer 200 with a valid empty .docx for this case, which is
 * why the screen needs its own sentence for it on the chapter kind too and not only on the book kind.
 */
export const EXPORT_REASON_NOTHING_WRITTEN = 'nothingWritten';

/**
 * A chapter the downloaded file does NOT contain, as the server named it.
 *
 * `order` is the RAW zero-based `Chapter.Order`; display numbering belongs to the client (the export
 * screen renders `order + 1`, like its chapter picker).
 */
export interface SkippedChapter {
  order: number;
  title: string;
}

/**
 * What a successful export left out, read off the response headers.
 *
 * THE COUNT IS AUTHORITATIVE AND THE LIST IS A COURTESY: the server bounds the named list so a long book
 * cannot blow a proxy's header budget and take `Content-Disposition` down with it, so `chapters` may name
 * FEWER than `count`. Copy that renders both must survive "3 were left out: A, B".
 */
export interface ExportSkipReport {
  count: number;
  chapters: SkippedChapter[];
}

/** How many chapters the file does not contain. Always sent on a 200, `"0"` included. */
export const EXPORT_SKIPPED_COUNT_HEADER = 'X-Export-Skipped-Count';
/** Which ones, percent-encoded JSON. Sent only when the count is not zero. */
export const EXPORT_SKIPPED_CHAPTERS_HEADER = 'X-Export-Skipped-Chapters';

/**
 * Read the skipped-chapter headers off a successful export, or NULL when the server did not say.
 *
 * THE NULL IS THE POINT. The count header is written on every 200, zero included, so its absence means
 * "an old server, or a proxy that stripped it" - which is not the same fact as "nothing was skipped", and
 * defaulting it to 0 would let a client silently promise a complete manuscript it knows nothing about.
 * The two are rendered differently by the screen.
 *
 * The list is best-effort: a count with an unreadable or absent list still yields a report, with an empty
 * `chapters`. That is the same asymmetry the server's bound creates, so it needs no second rule.
 */
export function skipReportFromHeaders(
  countHeader: string | null,
  chaptersHeader: string | null,
): ExportSkipReport | null {
  if (countHeader === null) return null;
  const trimmed = countHeader.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  if (!Number.isSafeInteger(count)) return null;
  return { count, chapters: count > 0 ? parseSkippedChapters(chaptersHeader) : [] };
}

/** `JSON.parse(decodeURIComponent(value))`, defended: a malformed header costs the names, never the count. */
function parseSkippedChapters(header: string | null): SkippedChapter[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is SkippedChapter =>
        !!e && typeof e === 'object'
        && typeof (e as SkippedChapter).order === 'number'
        && typeof (e as SkippedChapter).title === 'string')
      .map(e => ({ order: e.order, title: e.title }));
  } catch {
    return [];
  }
}

/** A downloaded file, before it is handed to the browser. */
export interface ExportedFile {
  blob: Blob;
  /** The server's filename when it sent one, else the caller's fallback. Never empty. */
  fileName: string;
  /**
   * What the file does not contain, or null when the server did not say. Required rather than optional so
   * a new caller has to decide what it does about a partial manuscript instead of inheriting silence - a
   * chapter missing from an exported book is indistinguishable from data loss to an author.
   */
  skipped: ExportSkipReport | null;
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
