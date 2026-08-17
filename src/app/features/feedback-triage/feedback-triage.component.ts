import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, takeUntil } from 'rxjs';

import { MarkdownTextComponent } from '../analysis-panel/markdown-text.component';
import { FeedbackListFilters, FeedbackService } from '../../core/services/feedback.service';
import {
  FEEDBACK_AREA_CHAT_ANSWER,
  FEEDBACK_STATUSES,
  FEEDBACK_VERDICTS,
  FeedbackDetailDto,
  FeedbackListItemDto,
  FeedbackStatus,
  legalTransitionsFrom,
} from '../../core/models/feedback';
import { ChatChromeLang, artifactChipLabel, guideTitle } from '../../core/i18n/chat-strings';
import {
  FeedbackStringKey,
  evidenceUnavailableLabel,
  feedbackStatusLabel,
  feedbackString,
  feedbackVerdictLabel,
} from '../../core/i18n/feedback-strings';
import { ChatArtifactRef, parseArtifactRefs } from '../../core/models/chat-artifact-ref';
import { TextDirection, dominantDirection } from '../../core/i18n/text-direction';
import { formatRelativeTime } from '../../core/utils/relative-time';

/**
 * THE OWNER'S TRIAGE VIEW (Show C2, c2-client), behind `Feedback:TriageEnabled`.
 *
 * ── DELIBERATELY PLAIN, and that is a decision this file is not free to re-take ───────────────────
 * d1 fixed v1 as "a reading tool, not a product": no bulk status transitions, no charts, no aggregate
 * counts beyond what a paged list already shows. The whole surface is a filtered list, a detail with its
 * joined evidence, and the transition buttons. It is read weekly by one person who owns the code; every
 * hour spent making it pleasant is an hour not spent on the manuscript surfaces an author reads.
 *
 * ── IT REUSES RENDERERS, IT DOES NOT FORK THEM ────────────────────────────────────────────────────
 * The answer goes through `app-markdown-text`, the same component Show's own transcript uses, so a
 * change to how model prose renders reaches both. The grounding refs go through the SAME labelling
 * functions the transcript's citation chips use (`guideTitle`, `artifactChipLabel`, `parseArtifactRefs`),
 * rendered as inert spans rather than links: there is no citation-chip COMPONENT in this codebase to
 * reuse - the chips are inline markup in the transcript's own template - so reuse here means reusing the
 * label logic, which is the part that could drift. Read-only is not a styling choice either: a triage row
 * can point at a deleted conversation and at a guide the answer cited, and a link that navigated the
 * owner away mid-triage would lose the row they were reading.
 *
 * ── THE PRIVACY RULE, WHERE THE PERSON MAINTAINING THIS WILL READ IT ──────────────────────────────
 * The evidence pane is the manuscript-bearing half of this feature. It is composed for THIS read and
 * nothing else: nothing on this surface exports, copies, downloads or forwards it, and C3's tickets will
 * carry ids and summaries rather than this prose. A future "copy to clipboard" or "open a ticket from
 * here" affordance is a violation of the plan's privacy rule, not a missing feature.
 *
 * ── The status buttons offer the LEGAL moves, and the server still decides ────────────────────────
 * The transition graph in `models/feedback.ts` decides which buttons appear; the server decides what is
 * allowed. That duplication is one-directional on purpose (a view that offered all five statuses would
 * put four buttons on screen of which three answer `400`), and when the two ever disagree this surface
 * renders the server's refusal verbatim rather than hiding it.
 *
 * App-level chrome, so Hebrew-default and RTL-first, following the same convention as the drawer and the
 * Activity Center: this route is reachable with no book open, so there is no book language to follow.
 */
@Component({
  selector: 'app-feedback-triage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MarkdownTextComponent],
  templateUrl: './feedback-triage.component.html',
  styleUrl: './feedback-triage.component.scss',
})
export class FeedbackTriageComponent implements OnInit, OnDestroy {
  private readonly feedback = inject(FeedbackService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  /**
   * App-level chrome language. Hebrew-default, hardcoded until a global i18n service exists, exactly as
   * `ProductChatComponent.appLang` and `ActivityCenterComponent.appLang` are. Kept private and mirrored
   * on {@link lang} so a spec can flip it the way those specs flip theirs.
   */
  private appLang: ChatChromeLang = 'he';

  /** The filter vocabularies, for the selects. Read off the model so a new status cannot be missed. */
  readonly areas: readonly string[] = [FEEDBACK_AREA_CHAT_ANSWER];
  readonly statuses = FEEDBACK_STATUSES;
  readonly verdicts = FEEDBACK_VERDICTS;

  /**
   * The filters as the controls hold them. `''` means "any", and it is translated to an ABSENT query
   * parameter by the service - an omitted filter means EVERYTHING, which is not the same request as a
   * filter set to the empty string.
   */
  filters: { area: string; status: string; verdict: string; bookId: string } = {
    area: '',
    status: '',
    verdict: '',
    bookId: '',
  };

  items: FeedbackListItemDto[] = [];
  page = 1;
  pageSize = FeedbackService.DefaultPageSize;
  totalCount = 0;
  loading = false;
  loadError = false;

  /** The row being read, with its joined evidence, or null while the list is what is showing. */
  selected: FeedbackDetailDto | null = null;
  /** The id whose detail read is in flight, so the list can mark which row is opening. */
  openingId: string | null = null;
  detailError = false;

  /**
   * The rows whose transition is on the wire, keyed BY ROW ID rather than held as one shared flag.
   *
   * A `PATCH` is a mutation already dispatched, so going back to the list does not recall it and this
   * surface does not pretend otherwise: the request runs to completion and keeps the list honest. What a
   * single flag got wrong was what it MEANT afterwards. Raised for row 1, it disabled row 2's buttons for
   * the length of a request about a row the owner had already left, and lowering it "only while we still
   * own the pane" would have rebuilt the latch the vote widget's `supersede()` just closed: a flag whose
   * only lowering site sits behind a guard that can fail. A set keyed by id has neither problem - every
   * request removes ITS OWN key unconditionally, so no request can strand another and none can strand
   * itself, and there is nothing here for `open()` or `closeDetail()` to reset.
   */
  private readonly savingRowIds = new Set<string>();

  /** Which refusal to show, or null. `notAllowed` is the server disagreeing with our own graph. */
  statusError: 'failed' | 'notAllowed' | null = null;

  /**
   * The cited guides and book artifacts, computed ONCE per opened row rather than on every render pass.
   *
   * Filled by `open()`'s own success arm, the same place that points `selected` at the new row, so the
   * cache can never survive a row change: it is keyed on the same event that owns the detail slot, not on
   * a memo whose key omits the row id. Cleared by `closeDetail()` for the same reason.
   *
   * KEYED ON THE ROW ONLY, but the labels it holds also depend on `appLang` (`guideTitle`/
   * `artifactChipLabel` both take it). That is unreachable today, not a bug that is live: `appLang` is
   * private and hardcoded to `'he'` on this surface, so it cannot change while a row is open. Whoever
   * gives this component a language switch must either recompute this cache when `appLang` changes or
   * close the detail on that change, or a reader who flips the chrome language mid-read keeps a
   * Hebrew-chrome pane with stale English chips.
   */
  private cachedGuideLabels: string[] = [];
  private cachedArtifactLabels: string[] = [];

  /**
   * The most recent list read, held so the next one can cancel it.
   *
   * SUPERSESSION, not de-duplication, the same rule the history panel follows: `load()` is reached from
   * four controls, two of which are one press apart, and left overlapping the responses resolve in
   * whatever order the network hands them back. Since the handler re-reads `page` out of the response,
   * the loser rewinding the list looks like the owner's second press never happened.
   */
  private listSub: Subscription | null = null;

  /** Same rule for the detail read: opening a second row must not be decided by which reply is slower. */
  private detailSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
  }

  /** Direction on the host, so the whole page mirrors with the chrome language. */
  @HostBinding('attr.dir')
  get dir(): 'rtl' | 'ltr' {
    return this.appLang === 'he' ? 'rtl' : 'ltr';
  }

  /** The chrome language, for the template and for specs. */
  get lang(): ChatChromeLang {
    return this.appLang;
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────────

  label(key: FeedbackStringKey): string {
    return feedbackString(this.appLang, key);
  }

  verdictLabel(verdict: string | null | undefined): string {
    return feedbackVerdictLabel(this.appLang, verdict);
  }

  statusLabel(status: string | null | undefined): string {
    return feedbackStatusLabel(this.appLang, status);
  }

  /** Timezone-aware and relative. Never a raw date pipe, per the page conventions. */
  when(iso: string | null | undefined): string {
    return formatRelativeTime(iso, this.appLang);
  }

  countLabel(): string {
    return this.label('listCount').replace('{0}', String(this.totalCount));
  }

  pageLabel(): string {
    return this.label('pageLabel').replace('{0}', String(this.page));
  }

  get hasNewer(): boolean {
    return this.page > 1;
  }

  get hasOlder(): boolean {
    return this.page * this.pageSize < this.totalCount;
  }

  get anyFilter(): boolean {
    return !!(this.filters.area || this.filters.status || this.filters.verdict || this.filters.bookId);
  }

  // ── The list ────────────────────────────────────────────────────────────────────────────────────

  private currentFilters(): FeedbackListFilters {
    return {
      area: this.filters.area || null,
      status: this.filters.status || null,
      verdict: this.filters.verdict || null,
      bookId: this.filters.bookId || null,
    };
  }

  load(): void {
    this.listSub?.unsubscribe();
    this.loading = true;
    this.loadError = false;
    // A FAILED DETAIL READ MUST NOT OUTLIVE THE LIST IT WAS REPORTED OVER. `detailError` renders in this
    // region, above the rows, so without this line the owner filters or pages, the list comes back
    // perfectly, and "could not load that row" still sits on top of it referring to a row they are no
    // longer looking at. Cleared HERE rather than in each caller because every path that changes the list
    // funnels through this method - init, the filter change, paging, clearFilters and the retry button -
    // so the seam owns the decision and a sixth caller added later inherits it.
    this.detailError = false;
    this.cdr.markForCheck();

    this.listSub = this.feedback
      .list(this.currentFilters(), this.page, this.pageSize)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.items = res?.items ?? [];
          this.page = res?.page ?? this.page;
          this.pageSize = res?.pageSize ?? this.pageSize;
          this.totalCount = res?.totalCount ?? this.items.length;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.loadError = true;
          this.cdr.markForCheck();
        },
      });
  }

  /** A filter changed. Always back to page 1: page 3 of the previous filter names nothing here. */
  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.filters = { area: '', status: '', verdict: '', bookId: '' };
    this.applyFilters();
  }

  newer(): void {
    if (!this.hasNewer) return;
    this.page -= 1;
    this.load();
  }

  older(): void {
    if (!this.hasOlder) return;
    this.page += 1;
    this.load();
  }

  // ── The detail ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Open one row, evidence and all, in ONE request.
   *
   * The detail endpoint composes the feedback row and its live join server-side, so this surface never
   * reconstructs a join client-side - which is what keeps "evidence is joined, never copied" true on
   * this half of the wire as well.
   */
  open(item: FeedbackListItemDto): void {
    if (!item?.id) return;
    this.detailSub?.unsubscribe();
    this.openingId = item.id;
    this.detailError = false;
    this.statusError = null;
    this.cdr.markForCheck();

    this.detailSub = this.feedback
      .detail(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: detail => {
          this.openingId = null;
          this.selected = detail ?? null;
          this.cachedGuideLabels = this.computeGuideLabels();
          this.cachedArtifactLabels = this.computeArtifactLabels();
          this.cdr.markForCheck();
        },
        error: () => {
          // The LIST stays on screen. Swapping to an empty detail pane would look like a row with no
          // evidence, which is a real and different state (`available: false`) this must not imitate.
          this.openingId = null;
          this.detailError = true;
          this.cdr.markForCheck();
        },
      });
  }

  /** Back to the list. The list was never unloaded, so this costs no request. */
  closeDetail(): void {
    this.detailSub?.unsubscribe();
    this.selected = null;
    this.openingId = null;
    this.statusError = null;
    this.cachedGuideLabels = [];
    this.cachedArtifactLabels = [];
    this.cdr.markForCheck();
  }

  /** The moves offered for the open row: our graph's answer, which the server then adjudicates. */
  get transitions(): readonly FeedbackStatus[] {
    return legalTransitionsFrom(this.selected?.feedback?.status);
  }

  /**
   * A transition is in flight FOR THE ROW ON SCREEN - which is what the disabled buttons and the "saving"
   * line under them are about. Another row's transition may be open at the same time and says nothing
   * here: the two are separate mutations on separate rows, and blocking the second on the first would
   * make the owner wait on a request about a row they are no longer reading.
   */
  get statusSaving(): boolean {
    const id = this.selected?.feedback?.id;
    return !!id && this.savingRowIds.has(id);
  }

  /**
   * THE OWNERSHIP RULE FOR EVERY ASYNC COMPLETION ON THIS SURFACE. A new handler added here inherits it
   * by calling this method; that is the whole reason it exists rather than being an inline comparison.
   *
   * `selected` and `statusError` are SINGLE SHARED SLOTS: one detail pane and one refusal line, both
   * describing whatever row the owner is looking at NOW. A request captures the row it was issued for at
   * dispatch, and by the time it lands the owner may have gone back to the list and opened another row -
   * nothing cancels a `PATCH`, because a mutation on the wire cannot be recalled. So a handler may write
   * a shared slot only while that slot STILL HOLDS ITS OWN ROW, which is what this returns: the detail,
   * or null once it belongs to somebody else.
   *
   * State keyed BY ROW ID is the opposite case and needs no guard at all: the list `map` below and
   * {@link savingRowIds} are correct for a row nobody is looking at, so guarding them would be the bug
   * rather than the fix. The test for which kind a piece of state is: could two rows hold it at once?
   */
  private detailStillShowing(rowId: string): FeedbackDetailDto | null {
    return this.selected?.feedback?.id === rowId ? this.selected : null;
  }

  /**
   * Move the open row's status.
   *
   * NO OPTIMISTIC UPDATE HERE, unlike the widget, and the asymmetry is deliberate: the widget serves an
   * author mid-read for whom a round trip is an interruption, while this serves the owner doing
   * deliberate triage, where showing a status the server did not accept would be worse than a moment's
   * wait. The response IS the new row, so there is nothing to reconcile.
   */
  changeStatus(status: FeedbackStatus): void {
    const rowId = this.selected?.feedback?.id;
    if (!rowId || this.statusSaving) return;

    this.savingRowIds.add(rowId);
    this.statusError = null;
    this.cdr.markForCheck();

    this.feedback
      .changeStatus(rowId, status)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updated => {
          this.savingRowIds.delete(rowId);
          if (updated) {
            // Keyed by id, so it stays right for a row the owner has navigated away from - and going back
            // must not show the status the row used to hold. Deliberately unguarded, per the rule above.
            this.items = this.items.map(item =>
              item.id === updated.id
                ? { ...item, status: updated.status, statusChangedAt: updated.statusChangedAt }
                : item
            );
            // The pane is shared, so it takes the new row only while it is still this row's pane.
            const shown = this.detailStillShowing(rowId);
            if (shown) this.selected = { ...shown, feedback: updated };
          }
          this.cdr.markForCheck();
        },
        error: err => {
          this.savingRowIds.delete(rowId);
          // The server's own refusal, rendered rather than hidden. `statusTransitionNotAllowed` means our
          // graph and the server's disagree, which is a fact the owner should see instead of a generic
          // failure that would send them looking at the network.
          //
          // Shown under ANOTHER row it would say the opposite of the truth - that this row refused a move
          // nobody made on it - so once the owner has moved on the refusal is dropped rather than
          // relocated. Nothing is lost that the surface cannot say again: the row did not move, the list
          // still carries the status it had, and re-opening it and pressing the same button reproduces
          // the same refusal.
          if (this.detailStillShowing(rowId)) {
            this.statusError =
              err?.error?.error === 'statusTransitionNotAllowed' ? 'notAllowed' : 'failed';
          }
          this.cdr.markForCheck();
        },
      });
  }

  // ── The evidence pane ───────────────────────────────────────────────────────────────────────────

  /**
   * Which direction the joined ANSWER runs in.
   *
   * There is no language column on a stored message, so this reads the same fact the server's own
   * detector reads: the script the answer is mostly written in. Majority-based rather than `dir="auto"`,
   * for the reason `text-direction.ts` gives - a Hebrew answer opening with "PageDraft" must not flip
   * whole. It decides `dir` and feeds `blockDirBase`, and nothing else depends on it.
   */
  answerDir(): TextDirection {
    return dominantDirection(this.selected?.evidence?.answer) ?? (this.appLang === 'he' ? 'rtl' : 'ltr');
  }

  /** The evidence's own "why not" sentence, worded per reason. */
  unavailableText(): string {
    return evidenceUnavailableLabel(this.appLang, this.selected?.evidence?.unavailableReason);
  }

  /** The cited guides, named the way the transcript's own chips name them. Reads the per-row cache. */
  guideLabels(): string[] {
    return this.cachedGuideLabels;
  }

  /** The cited book artifacts, parsed and labelled by the transcript's own helpers. Reads the per-row cache. */
  artifactLabels(): string[] {
    return this.cachedArtifactLabels;
  }

  get hasGrounding(): boolean {
    return this.guideLabels().length > 0 || this.artifactLabels().length > 0;
  }

  /** The guide-label computation. Called once, from `open()`'s success arm - not from a getter. */
  private computeGuideLabels(): string[] {
    return (this.selected?.evidence?.grounding?.guideIds ?? []).map(id => guideTitle(this.appLang, id));
  }

  /** The artifact-label computation. Called once, from `open()`'s success arm - not from a getter. */
  private computeArtifactLabels(): string[] {
    const refs: ChatArtifactRef[] = parseArtifactRefs(
      this.selected?.evidence?.grounding?.artifactRefs
    );
    return refs.map(ref => artifactChipLabel(this.appLang, ref));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
