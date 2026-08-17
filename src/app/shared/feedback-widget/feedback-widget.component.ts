import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostBinding,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { FeedbackService } from '../../core/services/feedback.service';
import {
  FEEDBACK_AREA_CHAT_ANSWER,
  FEEDBACK_TARGET_CONVERSATION_MESSAGE,
  FEEDBACK_TEXT_MAX,
  FeedbackDto,
  FeedbackVerdict,
} from '../../core/models/feedback';
import { ChatChromeLang } from '../../core/i18n/chat-strings';
import {
  FeedbackStringKey,
  feedbackString,
  noteCounterLabel,
} from '../../core/i18n/feedback-strings';

/**
 * THE VOTE WIDGET (Show C2, c2-client): a thumbs pair with an optional note, mounted first on Show's
 * answers and built so the second mount is one line.
 *
 * ── WHAT "ONE LINE" MEANS, CONCRETELY ─────────────────────────────────────────────────────────────
 * A host supplies {@link area}, {@link targetType} and {@link targetId} and nothing else that matters.
 * Everything a vote needs beyond those three - the voter identity, the route, the open book and chapter,
 * the UI locale - is assembled by {@link FeedbackService}, which is this component's ONLY collaborator.
 * There is deliberately no chat vocabulary anywhere in this file: it does not know what a conversation
 * is, and `feedback-widget-mountability.spec.ts` proves that by driving a full vote on a dummy target
 * with no chat services in the TestBed at all.
 *
 * ── IT RENDERS NOTHING WITHOUT A TARGET, AND THAT IS THE CONTRACT ─────────────────────────────────
 * A null/blank {@link targetId} produces no DOM. That is C1's contract reaching this surface: a Show
 * answer whose persistence write faulted has no message id, and a vote on it could never be stored, so
 * the widget must be ABSENT rather than present-and-dead. The guard lives HERE rather than in each host's
 * template, because a host that forgot it would ship a button that silently fails, and the whole point of
 * the widget is that a host has nothing to remember.
 *
 * The mirror case matters just as much: a FAILED answer that DID persist gets the widget. A thumbs-down
 * on a refusal is signal and not noise - it is half the reason this feature exists - so nothing here
 * looks at whether the target succeeded.
 *
 * ── OPTIMISTIC, BUT IT CONVERGES TO THE SERVER ────────────────────────────────────────────────────
 * The recorded FE defect class on this repo is an optimistic update that keeps a state the server
 * rejected. Three rules close it, and each is testable:
 *
 *  1. {@link pending} holds the optimistic value and {@link saved} holds THE SERVER'S ANSWER. What
 *     renders is `pending ?? saved`, so REVERTING is a single assignment (`pending = undefined`) that
 *     cannot leave a partial state behind. There is no third field a revert could forget.
 *  2. Every failure arm reverts and raises a NON-BLOCKING notice. Nothing is retried automatically and
 *     nothing is left on screen that the server does not hold.
 *  3. A GENERATION COUNTER guards stale landings, the same way Show C1 guarded them. Every action takes
 *     `gen = supersede()` and every callback drops out when `gen !== generation`. That bump is the point
 *     at which older requests are CANCELLED, so it is also where anything a cancelled request can no
 *     longer lower gets lowered - see {@link supersede}. Without it, a slow
 *     up-vote landing after a fast down-vote would write the OLD verdict over the new one and the widget
 *     would settle on a state the reader had already changed. `pending`/`saved` alone cannot catch that:
 *     both responses are successes.
 *
 * `undefined` versus `null` on {@link pending} is load-bearing rather than sloppy: `undefined` means "no
 * optimistic value in force, show what the server holds", `null` means "optimistically show NO vote",
 * which is what an in-flight retract has to render. Collapsing them would make a retract indistinguishable
 * from having no opinion about the optimistic state.
 *
 * THE THUMBS ARE NEVER DISABLED WHILE A VOTE IS IN FLIGHT, and that is what makes rule 3 reachable rather
 * than decorative. Locking them for the round trip would take back exactly what the optimistic update just
 * gave: the reader would watch their vote register instantly and then find the control dead for as long as
 * the network takes. So a second press supersedes, two requests can be open at once, and the generation
 * counter is the single mechanism that settles the widget on the NEWEST action rather than on the slowest
 * response. A lock PLUS a counter would have been belt and braces with the braces unreachable, which is
 * the shape this repo has already ruled against once in the drawer's own reset. The note editor IS locked
 * while its save is in flight ({@link savingNote}): it is a deliberate form rather than a toggle, and a
 * double-pressed save is a wasted round trip whose second answer would decide what the field shows. That
 * lock belongs to the SAVE and not to the widget, so anything that supersedes the save releases it - the
 * live thumbs mean a save can be cancelled by a press it does not control, and a lock whose only lowering
 * site sits inside the cancelled request is a lock nobody can lift.
 *
 * The one thing that costs: with no stored row yet, pressing the lit thumb cannot retract (there is no id
 * to delete by), so that press is a no-op for the length of one round trip. Faking it would be worse - the
 * in-flight vote's own response would put the thumb straight back.
 *
 * ── WHAT THIS WIDGET CANNOT DO, STATED RATHER THAN PAPERED OVER ───────────────────────────────────
 * IT DOES NOT READ AN EXISTING VOTE BACK ON MOUNT, so a reload shows an unvoted widget even where a vote
 * is stored. That is not an oversight and it is not fixable from here: the only endpoint that can return
 * a stored row is the FLAG-GATED triage list, which has no per-target filter and which the widget must
 * not depend on (the vote half works on deployments where triage is hidden - that is the entire reason
 * `POST`/`DELETE` are ungated). Voting again after a reload is a plain upsert on the same key, so the
 * one-vote rule still holds and nothing duplicates; what is lost is only the visual memory. Closing it
 * needs an ungated read endpoint keyed on (target, voter), which is an API change and out of C2's scope.
 *
 * ── DIRECTION ─────────────────────────────────────────────────────────────────────────────────────
 * The host carries its OWN `dir`, taken from {@link lang}, so the note popover is placed against the
 * widget's chrome direction rather than against whatever content direction it happens to be nested in.
 * On Show that difference is real and daily: the answer bubble sets `dir` from the SERVER's answer
 * language, so a Hebrew reader looking at an English answer sits inside an `ltr` subtree, and a popover
 * placed by inheritance would open off the wrong edge. The placement itself is written with logical
 * inline properties, which then resolve against this host's own direction.
 */
@Component({
  selector: 'app-feedback-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './feedback-widget.component.html',
  styleUrl: './feedback-widget.component.scss',
})
export class FeedbackWidgetComponent implements OnChanges, OnDestroy {
  private readonly feedback = inject(FeedbackService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  /**
   * A process-wide counter, read exactly ONCE per instance - inside {@link instanceId}'s own field
   * initializer, which runs at construction and never again. Nothing downstream re-reads this counter on
   * a change-detection pass; the DERIVED, already-stringified ids below are the only things the template
   * ever sees, so two widgets ticking it in whatever order Angular constructs them in cannot make either
   * one's id drift across a render.
   */
  private static nextInstanceId = 0;

  /**
   * This widget's own identity, minted ONCE at construction and stable for the life of the instance.
   *
   * A Show transcript mounts many widgets side by side (one per answer), and the note editor's
   * `<label for>` has to keep resolving to ITS OWN textarea. A hardcoded id collides the moment a second
   * widget mounts: the browser resolves a `for` to the FIRST element in the document carrying that id,
   * not to the one physically beside the label, so the second widget's label silently focuses the first
   * widget's textarea. Minting the id here rather than in the template is what keeps it from being
   * recomputed - and therefore from potentially disagreeing with itself - on every change-detection pass.
   */
  private readonly instanceId = FeedbackWidgetComponent.nextInstanceId++;

  /** Stable per-instance id for the note textarea, paired with the label's `for` in the template. */
  readonly noteInputId = `fw-note-input-${this.instanceId}`;

  /** Stable per-instance `name` for the note's ngModel control, for the same reason as {@link noteInputId}. */
  readonly noteInputName = `feedbackNote-${this.instanceId}`;

  /** What part of the product this vote is about. Defaulted to mount #1's value for the common case. */
  @Input() area: string = FEEDBACK_AREA_CHAT_ANSWER;

  /** What {@link targetId} points at. Defaulted to mount #1's value for the same reason. */
  @Input() targetType: string = FEEDBACK_TARGET_CONVERSATION_MESSAGE;

  /**
   * The thing being voted on. NULL OR BLANK RENDERS NOTHING - see the class doc.
   *
   * Not defaulted, deliberately: area and target type have a sensible mount-#1 default, an id never does.
   */
  @Input() targetId: string | null = null;

  /** The chrome language, pushed down by the host so the two can never disagree. */
  @Input() lang: ChatChromeLang = 'he';

  /** The row as the SERVER holds it, or null when the server holds none. */
  saved: FeedbackDto | null = null;

  /**
   * The optimistic verdict in force, or `undefined` when there is none.
   *
   * `null` is a real value here and means "optimistically showing no vote" (a retract in flight). See the
   * class doc for why the two are not collapsed.
   */
  private pending: FeedbackVerdict | null | undefined = undefined;

  /** Which failure to announce, or null. Non-blocking: the widget has already reverted. */
  failure: 'vote' | 'retract' | null = null;

  /** A vote landed. Cleared by the next action, so it reads as a confirmation and not as a state. */
  thanks = false;

  /** The note editor is open. */
  noteOpen = false;

  /**
   * The note being written. Prefilled from the stored note when the editor opens WITH NO LIVE DRAFT
   * already in it - see {@link openNote}. A draft the reader has typed and not yet discarded outranks
   * the stored note on reopen.
   */
  noteDraft = '';

  /**
   * A note save is in flight, which is a different control state from a vote in flight.
   *
   * Read by three template bindings (the textarea, Save and Cancel) and by {@link cancelNote}'s guard, so
   * it locks the whole form. Lowered by the save's own arms AND by {@link supersede}, which is the only
   * thing that can lower it once a newer action has cancelled that save. TRUE means a save is in flight;
   * false does not mean none is, only that none can still decide what this form shows.
   */
  savingNote = false;

  /**
   * The action sequence. Every request captures it and every callback checks it.
   *
   * MONOTONIC AND NEVER RESET WHILE THE COMPONENT LIVES, including across a {@link targetId} change, so a
   * response belonging to the previous target can never be mistaken for a response to the current one.
   */
  private generation = 0;

  /** The note's cap, for the template's counter and its disabled rule. */
  readonly textMax = FEEDBACK_TEXT_MAX;

  /**
   * Direction on the host, from this widget's OWN chrome language.
   *
   * The one line that makes the popover's placement independent of the content it is mounted beside. See
   * the class doc's direction note for the case on Show where inheritance gets it wrong.
   */
  @HostBinding('attr.dir')
  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  /** No target, no widget. The template's single outermost condition. */
  @HostBinding('class.fw-empty')
  get isEmpty(): boolean {
    return !this.hasTarget;
  }

  get hasTarget(): boolean {
    return !!this.targetId?.trim();
  }

  // ── Superseding ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Begin a new action, and CANCEL every response still in flight.
   *
   * ONE DOOR, AND IT IS THE POINT THAT CANCELS. Bumping {@link generation} is what cancels: it makes
   * every open request's `gen !== this.generation` guard fire. So anything a cancelled request would
   * otherwise have lowered has to be lowered HERE and not inside that request's own handlers, because
   * those handlers return ABOVE their own lowering line - on the very check this bump makes fail.
   *
   * {@link savingNote} is the only such flag today, and it was stranded true for the life of the
   * component. The thumbs stay live during a request by design (see the class doc), so a thumb press
   * during a note save superseded it, both of the save's arms dropped out before lowering the flag, and
   * the template's three disabled bindings plus {@link cancelNote}'s guard left a dead form reading
   * "saving" until the target id changed or the page reloaded.
   *
   * ONE DIRECTION ONLY: `savingNote` true means a note save is in flight, so cancelling that save makes
   * it false. The converse is NOT claimed and is not true - a false flag says nothing about whether a
   * request is still open on the wire, and just after a supersede one usually is. That costs nothing:
   * its response is dropped by the same guard, and a second Save is a fresh request rather than a
   * duplicate answer, since the first can no longer decide what the field shows.
   *
   * WHAT A SUPERSEDED SAVE LEAVES ON SCREEN: the flag is all this method owns. The editor's open/closed
   * state and the draft belong to the ACTION THAT SUPERSEDED, not to the save it cancelled, and each of
   * the three callers already carries a rule that the reader can be held to:
   *  - {@link vote} leaves the editor OPEN with the paragraph still in it. The reader typed it and has
   *    not discarded it, which is the same rule {@link openNote} enforces on reopen, and a flip keeps
   *    the stored note anyway, so the note they were saving still belongs to the vote they now hold.
   *  - {@link retract} CLOSES it (its own line, unchanged): a note belongs to a vote and there is no
   *    longer one. The draft survives the close and its success arm clears it.
   *  - {@link ngOnChanges} resets both, because this is a different target's widget now.
   */
  private supersede(): number {
    this.savingNote = false;
    return ++this.generation;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['targetId'] || changes['targetId'].firstChange) return;
    if (changes['targetId'].currentValue === changes['targetId'].previousValue) return;
    // A RECYCLED WIDGET MUST NOT SHOW ANOTHER TARGET'S VOTE. Angular reuses a component instance whenever
    // a host's `track` identity holds while the bound id changes, and without this the reader would see
    // the previous answer's thumb lit on a different answer. Superseding is the other half: a response
    // still in flight for the OLD target must not land on the new one's state, and a note save open
    // against the old id must not leave its lock behind on the new one.
    this.supersede();
    this.resetState();
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────────

  label(key: FeedbackStringKey): string {
    return feedbackString(this.lang, key);
  }

  /** The counter under the note editor, already filled in. */
  get counterLabel(): string {
    return noteCounterLabel(this.lang, this.noteDraft.length);
  }

  /** What the widget is CURRENTLY showing: the optimistic value if there is one, else the server's. */
  get verdict(): FeedbackVerdict | null {
    if (this.pending !== undefined) return this.pending;
    const stored = this.saved?.verdict;
    return stored === 'up' || stored === 'down' ? stored : null;
  }

  /** Whether the note affordance is on offer: a note belongs to a vote, and a vote has to exist first. */
  get canWriteNote(): boolean {
    return this.verdict !== null;
  }

  /** Whether a note is already stored, which changes the affordance from "add" to "edit". */
  get hasNote(): boolean {
    return !!this.saved?.text?.trim();
  }

  get noteTooLong(): boolean {
    return this.noteDraft.length > this.textMax;
  }

  // ── Voting ──────────────────────────────────────────────────────────────────────────────────────

  /**
   * Cast, flip, or RETRACT.
   *
   * PRESSING THE THUMB THAT IS ALREADY LIT RETRACTS, which is the only gesture in the widget that
   * removes anything and is why retract needs no separate control in a message-bubble footer. Pressing
   * the other thumb FLIPS, and a flip deliberately sends NO `text` at all - absent means "leave the note
   * alone" on the wire, which is how d1's "a verdict flip keeps the note" rule is expressed without a
   * second endpoint. Sending the draft here would silently overwrite the reader's stored note with
   * whatever happened to be in an editor they had not saved.
   */
  vote(verdict: FeedbackVerdict): void {
    if (!this.hasTarget) return;
    if (this.verdict === verdict) {
      this.retract();
      return;
    }

    this.pending = verdict;
    this.failure = null;
    this.thanks = false;
    // A DOWN-VOTE OPENS THE NOTE IMMEDIATELY, before the round trip, because the reader's reason is
    // freshest in the instant they press it and making them wait for a network hop to start typing is
    // how a note goes unwritten. The failure arm below closes the editor but leaves the draft untouched,
    // and openNote() itself refuses to overwrite a live draft on reopen, so a vote that did not land
    // costs a second press rather than a retyped paragraph.
    if (verdict === 'down' && !this.noteOpen) this.openNote();

    // This press may be superseding a note save, and supersede() is what frees that editor: the save's
    // own arms cannot, once this bump has cancelled them. The editor stays OPEN with the draft in it,
    // which is the decision recorded on supersede().
    const gen = this.supersede();
    this.cdr.markForCheck();

    this.feedback
      .vote(this.feedback.buildVote(this.area, this.targetType, this.targetId!, verdict, this.lang))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: dto => {
          if (gen !== this.generation) return;
          this.saved = dto ?? null;
          this.pending = undefined;
          this.thanks = true;
          this.cdr.markForCheck();
        },
        error: () => {
          if (gen !== this.generation) return;
          // REVERT: dropping the optimistic value falls straight back to whatever the server holds, which
          // is nothing at all on a first vote. No phantom vote survives a refusal.
          this.pending = undefined;
          this.failure = 'vote';
          this.noteOpen = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Take the vote back. A hard delete server-side, per d1: voting again mints a new row.
   *
   * Reached only by pressing the lit thumb, so it is always preceded by a deliberate act on the exact
   * control that shows the state being removed.
   */
  retract(): void {
    if (!this.hasTarget) return;
    const row = this.saved;
    // NO STORED ROW MEANS NOTHING TO DELETE AND NO ID TO DELETE IT BY - the vote that would create it is
    // still in flight. Refused rather than faked: optimistically clearing the thumb here would be undone
    // the moment that vote's own response landed and set `saved`, which is a widget arguing with itself.
    // The press is a no-op for the length of one round trip, which is the honest cost of not locking the
    // thumbs (see the `pending` doc). It returns ABOVE supersede(), so it cancels nothing either: a note
    // save open at that moment keeps its lock and is lowered by its own arms, which still run.
    if (!row?.id) return;

    this.pending = null;
    this.failure = null;
    this.thanks = false;
    // CLOSED, and that is retract's own rule rather than the latch's: a note belongs to a vote and this
    // removes the vote. A note save superseded by this press is cancelled by supersede() below; the draft
    // outlives the close and the success arm clears it.
    this.noteOpen = false;

    const gen = this.supersede();
    this.cdr.markForCheck();

    this.feedback
      .retract(row.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (gen !== this.generation) return;
          this.saved = null;
          this.pending = undefined;
          this.noteDraft = '';
          // A terminal arm owns `thanks`: vote() and saveNote() set it true because a vote landed to
          // confirm; retract() removed one, so there is nothing to confirm and it stays false explicitly.
          this.thanks = false;
          this.cdr.markForCheck();
        },
        error: () => {
          if (gen !== this.generation) return;
          // Reverts to the stored row, note and all: the server still holds it.
          this.pending = undefined;
          this.failure = 'retract';
          this.cdr.markForCheck();
        },
      });
  }

  // ── The note ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Open the editor, prefilled from the STORED note so editing is editing and not retyping.
   *
   * ONLY WHEN THERE IS NO LIVE DRAFT. A blank {@link noteDraft} is the sole signal that there is nothing
   * to preserve - cancelNote() sets it that way on an explicit discard, and that is the only way a draft
   * is meant to be thrown away. Without this guard, the automatic reopen after a failed vote (see the
   * failure arm in vote()) would call openNote() a second time and wipe the paragraph the reader just
   * typed with the same gesture that is supposed to save them from retyping it.
   */
  openNote(): void {
    if (!this.hasTarget) return;
    this.noteOpen = true;
    if (!this.noteDraft) this.noteDraft = this.saved?.text ?? '';
    this.failure = null;
    this.cdr.markForCheck();
  }

  /** Close without sending. The stored note is untouched, which is what "cancel" has to mean. */
  cancelNote(): void {
    // Refused mid-save, so the reader cannot close a form whose own answer is about to land in it. Only
    // while that answer can still land: supersede() lowers the flag the instant it no longer can, which
    // is what keeps this guard from being the thing that traps them.
    if (this.savingNote) return;
    this.noteOpen = false;
    this.noteDraft = '';
    this.cdr.markForCheck();
  }

  /**
   * Save the note, as another POST on the same one-vote key.
   *
   * ONE ENDPOINT FOR BOTH HALVES: the note travels with the verdict it belongs to, so this re-sends the
   * CURRENT verdict rather than inventing a note-only write path. An empty draft is sent as an empty
   * string, not withheld, because empty-after-trim CLEARS the note server-side and a reader who deleted
   * their own words means to delete them.
   */
  saveNote(): void {
    const verdict = this.verdict;
    if (!this.hasTarget || !verdict || this.savingNote || this.noteTooLong) return;

    // SUPERSEDE FIRST, THEN RAISE THE FLAG. The guard above means there is no note save of ours to
    // cancel, but every action goes through the one door, so the next flag added to it is lowered here
    // for this caller too and not only for the other three.
    const gen = this.supersede();
    this.savingNote = true;
    this.failure = null;
    this.cdr.markForCheck();

    const text = this.noteDraft;
    this.feedback
      .vote(this.feedback.buildVote(this.area, this.targetType, this.targetId!, verdict, this.lang, text))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: dto => {
          if (gen !== this.generation) return;
          this.saved = dto ?? null;
          this.pending = undefined;
          this.savingNote = false;
          this.noteOpen = false;
          this.thanks = true;
          this.cdr.markForCheck();
        },
        error: () => {
          if (gen !== this.generation) return;
          // REVERT, for the same reason vote()'s failure arm does it, and this arm has to be the one that
          // does: a down-vote opens the note editor while its own vote request is still on the wire, so a
          // reader who types and saves fast SUPERSEDES that vote - which makes its arms no-ops and leaves
          // `pending` set by a request that can no longer clear it. Without this line a failed note save
          // left the thumb lit for a vote the server never accepted, with `saved` still null, so retract
          // was a no-op too (no row id to delete) and the reader could not even take the phantom back.
          //
          // `supersede()` CANNOT own this. vote() assigns `pending` and then supersedes, so a supersede
          // that cleared it would erase the optimistic value one line after it was set. The field belongs
          // to the arms, which is why all six of them now clear it.
          this.pending = undefined;
          // The editor STAYS OPEN with the reader's text in it: losing what they wrote on a transport
          // failure would make retrying mean rewriting.
          this.savingNote = false;
          this.failure = 'vote';
          this.cdr.markForCheck();
        },
      });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────

  private resetState(): void {
    this.saved = null;
    this.pending = undefined;
    this.failure = null;
    this.thanks = false;
    this.noteOpen = false;
    this.noteDraft = '';
    this.savingNote = false;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
