import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';

import {
  FeedbackAvailabilityDto,
  FeedbackContextDto,
  FeedbackDetailDto,
  FeedbackDto,
  FeedbackListDto,
  FeedbackStatus,
  FeedbackVerdict,
  FeedbackVoteRequest,
} from '../models/feedback';
import { readInstallationId } from './installation-id';
import { AmbientChapterService } from './ambient-chapter.service';
import { BookContextService } from './book-context.service';

/** The filters `GET /api/feedback` accepts. Every one optional; an omitted filter means EVERYTHING. */
export interface FeedbackListFilters {
  area?: string | null;
  status?: string | null;
  verdict?: string | null;
  bookId?: string | null;
}

/**
 * The client half of `/api/feedback` (Show C2): vote, retract, and the owner's triage reads.
 *
 * ── ONE SERVICE, BECAUSE THE WIDGET IS SUPPOSED TO BE ONE LINE ────────────────────────────────────
 * The todo's shape for the widget is "inputs are area/targetType/targetId and it does the rest through
 * one FeedbackService". So the two things a caller would otherwise have to assemble by hand live here:
 * the VOTER IDENTITY ({@link installationId}) and the VOTE-TIME CONTEXT ({@link currentContext}). A host
 * that mounts the widget on a new surface supplies three strings and gets a correctly keyed, correctly
 * contextualized vote; it does not learn what `installationId` is for, and it cannot forget the context.
 *
 * That is why an HTTP client also reads the router and the book context here. It is a seam, and it is a
 * deliberate one: the alternative was every mount site duplicating four lines of context assembly, which
 * is how the `route`/`uiLanguage` fields would quietly start disagreeing between mounts.
 *
 * ── WHAT THIS SERVICE MUST NEVER DO ───────────────────────────────────────────────────────────────
 * Decide anything the server decides. It does not pre-validate a status transition (the graph in
 * `models/feedback.ts` decides which BUTTONS to offer; the server decides what is allowed), it does not
 * cap the note (the widget counts characters and the server answers `400 textTooLong`), and it does not
 * interpret a bodiless `404` from a gated endpoint as anything but a failure - the flag is learned from
 * {@link availability} and nowhere else.
 *
 * Nothing is cached across calls. The triage list is small and read deliberately; the widget's own state
 * is per-target and reconciled from each response.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly books = inject(BookContextService);
  private readonly ambientChapters = inject(AmbientChapterService);

  private readonly url = '/api/feedback';

  /** The server's own default. Mirrored so a pager can show a page size before the first response. */
  static readonly DefaultPageSize = 25;

  /**
   * The per-field bound the server applies inside `ContextJson` (`FeedbackCaps.ContextFieldChars`).
   *
   * TRIMMED HERE RATHER THAN RISKED. `route` is the one context field whose length this client does not
   * control - a deep link can carry arbitrary query parameters - and a `400 contextFieldTooLong` would
   * throw away the whole VOTE over a piece of metadata. So an over-long route is truncated and the vote
   * survives; nothing downstream parses the route, so a shortened one is still exactly as useful as the
   * owner needs it to be.
   */
  static readonly ContextFieldMax = 500;

  // ── The flag ────────────────────────────────────────────────────────────────────────────────────

  /**
   * `GET /api/feedback/availability` - does this deployment serve the triage surface?
   *
   * ALWAYS OPEN, and it has to be. Every gated endpoint answers a bodiless `404` with the flag off, which
   * is indistinguishable from a transport failure, so a route guard that probed one would hide the triage
   * view on any network hiccup and show it on none. This endpoint is the contract for learning the flag.
   */
  availability(): Observable<FeedbackAvailabilityDto> {
    return this.http.get<FeedbackAvailabilityDto>(`${this.url}/availability`);
  }

  // ── The vote half (never gated) ─────────────────────────────────────────────────────────────────

  /**
   * `POST /api/feedback` - cast, flip or revise ONE vote. Always `200` with the stored row, never `201`.
   *
   * CREATE AND UPDATE ARE ONE CALL, which is what lets the widget post without first knowing whether it
   * has voted on this target before. The response is the row as stored, and it is what the widget
   * reconciles its optimistic state against.
   *
   * `text` IS PASSED THROUGH UNTOUCHED, including `undefined`. That is the contract's most dangerous
   * corner and this method deliberately adds no convenience to it: absent means KEEP the stored note (how
   * a verdict flip preserves it), non-null REPLACES, empty-after-trim CLEARS. A helpful `?? ''` here
   * would turn every verdict flip into a note deletion.
   */
  vote(request: FeedbackVoteRequest): Observable<FeedbackDto> {
    return this.http.post<FeedbackDto>(this.url, request);
  }

  /**
   * `DELETE /api/feedback/{id}` - RETRACT. `204`, or `404 feedbackNotFound`.
   *
   * Not gated by the triage flag: this is the voter's own action on their own row, and a widget that
   * could vote but not un-vote would be a trap. A hard delete, per d1 - voting again mints a new row.
   */
  retract(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  // ── The triage half (flag-gated; a bodiless 404 when off) ───────────────────────────────────────

  /** `GET /api/feedback` - newest first. An omitted filter means EVERYTHING, not a default subset. */
  list(
    filters: FeedbackListFilters = {},
    page = 1,
    pageSize = FeedbackService.DefaultPageSize
  ): Observable<FeedbackListDto> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    // Set only what is actually filtered. An empty-string parameter is not the same request as an absent
    // one on a server that trims and compares, and "everything" must travel as absence.
    if (filters.area?.trim()) params = params.set('area', filters.area.trim());
    if (filters.status?.trim()) params = params.set('status', filters.status.trim());
    if (filters.verdict?.trim()) params = params.set('verdict', filters.verdict.trim());
    if (filters.bookId?.trim()) params = params.set('bookId', filters.bookId.trim());
    return this.http.get<FeedbackListDto>(this.url, { params });
  }

  /** `GET /api/feedback/{id}` - the row plus its live-joined evidence, in one request. */
  detail(id: string): Observable<FeedbackDetailDto> {
    return this.http.get<FeedbackDetailDto>(`${this.url}/${id}`);
  }

  /**
   * `PATCH /api/feedback/{id}/status` - the ONLY write path for `Status` anywhere, for the owner's
   * buttons and for C3 alike.
   */
  changeStatus(id: string, status: FeedbackStatus): Observable<FeedbackDto> {
    return this.http.patch<FeedbackDto>(`${this.url}/${id}/status`, { status });
  }

  // ── What a caller would otherwise have to assemble ──────────────────────────────────────────────

  /** This browser's voter id, minted and persisted on first use. Never empty. */
  installationId(): string {
    return readInstallationId();
  }

  /**
   * The vote-time context, gathered from the app as it stands RIGHT NOW.
   *
   * EVERY FIELD IS HERE BECAUSE NO JOIN CAN RECOVER IT (d1 section (2)), which is also why the answer and
   * the grounding refs are not: those are joined from the target at read time.
   *
   * `bookId`/`chapterId` are captured even though the joined message already carries the ASK-time pair,
   * because this copy reflects VOTE time - a reader can move between receiving an answer and voting on
   * it - and because it is the one field guaranteed to exist for a future target type whose entity
   * carries no book of its own.
   *
   * `appBuild` is deliberately absent, not empty: no build stamp exists in this client, and sending an
   * invented one would be worse than sending none.
   *
   * @param uiLanguage the chrome locale the reader is actually looking at, pushed in by the widget
   * rather than read from a global, because no global i18n service exists and each surface still owns
   * its own language.
   */
  currentContext(uiLanguage: string | null): FeedbackContextDto {
    const book = this.books.currentBook;
    const bookId = book?.bookId ?? null;
    // Through `forBook`, never the raw snapshot: the two services move on different ticks during a book
    // switch, and for one frame the ambient state can still hold the PREVIOUS book's chapter. Filing a
    // vote about book B under a chapter of book A is the same wrong-context error the drawer's own
    // ambient guard exists to prevent.
    const chapterId = this.ambientChapters.forBook(bookId)?.openChapter?.id ?? null;

    return {
      route: cap(this.router.url),
      bookId,
      chapterId,
      uiLanguage: cap(uiLanguage),
    };
  }

  /**
   * A ready-to-post vote body for one target: identity and context filled in, verdict and note supplied.
   *
   * The single place the three halves meet, so a second mount cannot assemble a vote that is keyed or
   * contextualized differently from this one.
   */
  buildVote(
    area: string,
    targetType: string,
    targetId: string,
    verdict: FeedbackVerdict,
    uiLanguage: string | null,
    text?: string | null
  ): FeedbackVoteRequest {
    const request: FeedbackVoteRequest = {
      area,
      targetType,
      targetId,
      verdict,
      installationId: this.installationId(),
      context: this.currentContext(uiLanguage),
    };
    // ONLY SET WHEN THE CALLER MEANT TO SAY SOMETHING ABOUT THE NOTE. `undefined` is the "leave it alone"
    // signal, and it has to survive JSON serialization as an ABSENT property rather than a null one - both
    // read the same server-side, but only absence keeps a body that says nothing about the note from
    // carrying a field at all.
    if (text !== undefined) request.text = text;
    return request;
  }
}

/** Trim to the server's per-context-field bound, returning null for an empty value. */
function cap(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > FeedbackService.ContextFieldMax
    ? trimmed.slice(0, FeedbackService.ContextFieldMax)
    : trimmed;
}
