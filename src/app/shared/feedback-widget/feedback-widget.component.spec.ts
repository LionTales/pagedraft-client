/**
 * FeedbackWidgetComponent: every state the todo names (Show C2, c2-client).
 *
 * unvoted, voted, flipping (with the note preserved), retract, save-failure reconcile, a stale response
 * landing late, no persisted id = no DOM at all, the note editor with its counter, and a newer action
 * cancelling a note save while it is still open.
 *
 * The rendered-DOM counterpart to `core/i18n/feedback-strings.spec.ts`: a map can be perfectly localized
 * and never be read by the surface that renders it.
 *
 * ── ONE THING THIS FILE DELIBERATELY DOES NOT MOUNT ───────────────────────────────────────────────
 * Anything from chat. The widget's independence from its first host is the feature, and
 * `feedback-widget-mountability.spec.ts` is where that is asserted head-on; this file simply never needs
 * a chat service to drive a complete vote, which is the same fact from the other side.
 *
 * ── TWO MECHANICAL RULES THIS FILE FOLLOWS, BECAUSE GETTING THEM WRONG PRODUCES A FALSE GREEN ─────
 *  1. An input is changed through `componentRef.setInput`, never by assigning the field. The component is
 *     `OnPush`, so a bare assignment leaves the view unchecked and the following `detectChanges()` asserts
 *     against stale DOM - which passes or fails for reasons that have nothing to do with the behaviour.
 *     `typeNote()` does the same job for the note field, by dispatching a real `input` event.
 *  2. `HttpTestingController.expectOne` CONSUMES the request it matches, so each request is captured once
 *     and both the assertion and the flush use that one handle.
 */
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { FeedbackWidgetComponent } from './feedback-widget.component';
import { FEEDBACK_STRINGS_EN, FEEDBACK_STRINGS_HE } from '../../core/i18n/feedback-strings';
import { FEEDBACK_TEXT_MAX, FeedbackDto } from '../../core/models/feedback';
import { resetInstallationIdCache } from '../../core/services/installation-id';

const TARGET = '11111111-1111-1111-1111-111111111111';
const OTHER_TARGET = '22222222-2222-2222-2222-222222222222';

/**
 * TWO widgets, side by side, in ONE shared DOM tree - the shape a Show transcript actually mounts (eleven
 * widgets, one per answer). A pair of separately-created, unattached fixtures would each root its own
 * detached subtree, so a duplicate-id collision between them could never manifest and the identity spec
 * below would pass whether or not the fix works. Nesting both under one host is what makes the id space
 * actually shared, the way it is on the page Chrome measured the defect on.
 */
@Component({
  standalone: true,
  imports: [FeedbackWidgetComponent],
  template: `
    <app-feedback-widget [targetId]="targetA"></app-feedback-widget>
    <app-feedback-widget [targetId]="targetB"></app-feedback-widget>
  `,
})
class TwoWidgetsHostComponent {
  targetA = TARGET;
  targetB = OTHER_TARGET;
}

function storedRow(over: Partial<FeedbackDto> = {}): FeedbackDto {
  return {
    id: 'fb-1',
    area: 'chat-answer',
    targetType: 'conversation-message',
    targetId: TARGET,
    verdict: 'up',
    text: null,
    status: 'New',
    createdAt: '2026-08-17T09:00:00Z',
    statusChangedAt: '2026-08-17T09:00:00Z',
    targetDeletedAt: null,
    context: null,
    ...over,
  };
}

describe('FeedbackWidgetComponent (Show C2)', () => {
  let fixture: ComponentFixture<FeedbackWidgetComponent>;
  let component: FeedbackWidgetComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    resetInstallationIdCache();
    await TestBed.configureTestingModule({
      imports: [FeedbackWidgetComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackWidgetComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('targetId', TARGET);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

  function click(testId: string): void {
    fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).nativeElement.click();
    fixture.detectChanges();
  }

  function el(testId: string): HTMLElement | null {
    return fixture.debugElement.query(By.css(`[data-testid="${testId}"]`))?.nativeElement ?? null;
  }

  function pressed(testId: string): string | null {
    return el(testId)?.getAttribute('aria-pressed') ?? null;
  }

  /** Change an input the way a host would, so the OnPush view is actually marked dirty. */
  function setInput(name: string, value: unknown): void {
    fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  /**
   * Type into the note editor the way a reader does.
   *
   * Through the TEXTAREA rather than by assigning `noteDraft`: the component is `OnPush`, and a bare
   * field assignment leaves its view unchecked, so the counter and the disabled rule would be asserted
   * against stale DOM. An `input` event marks the view dirty exactly as a keystroke does.
   */
  function typeNote(text: string): void {
    const input = fixture.debugElement.query(By.css('.fw-note-input')).nativeElement as HTMLTextAreaElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** The one open POST, captured once. */
  function pendingVote(): TestRequest {
    return http.expectOne(r => r.method === 'POST' && r.url === '/api/feedback');
  }

  // ── Unvoted ──────────────────────────────────────────────────────────────────────────────────────

  describe('unvoted', () => {
    it('renders both thumbs, neither pressed, and offers NO note', () => {
      expect(el('fw-up')).toBeTruthy();
      expect(el('fw-down')).toBeTruthy();
      expect(pressed('fw-up')).toBe('false');
      expect(pressed('fw-down')).toBe('false');
      // A note is posted WITH a verdict; there is no note-only write path, so the affordance cannot be
      // offered before there is a vote to attach it to.
      expect(el('fw-note-open')).toBeNull();
      expect(component.verdict).toBeNull();
    });

    it('sends NO request until the reader presses something', () => {
      // The widget deliberately does not read an existing vote back on mount: the only endpoint that
      // could is flag-gated, and the vote half must work where triage is hidden. See the class doc.
      http.expectNone(() => true);
    });
  });

  // ── Voted ────────────────────────────────────────────────────────────────────────────────────────

  describe('voting', () => {
    it('shows the vote OPTIMISTICALLY, before the server has answered', () => {
      click('fw-up');
      expect(pressed('fw-up')).toBe('true');
      // The request is still open at this point, which is what makes the assertion above about optimism
      // rather than about a fast response.
      const request = pendingVote();
      expect(request.request.body.verdict).toBe('up');
      request.flush(storedRow());
      fixture.detectChanges();
      expect(pressed('fw-up')).toBe('true');
      expect(el('fw-thanks')).toBeTruthy();
    });

    it('sends the area, the target and a NON-EMPTY installation id', () => {
      click('fw-down');
      const request = pendingVote();
      const body = request.request.body;
      expect(body.area).toBe('chat-answer');
      expect(body.targetType).toBe('conversation-message');
      expect(body.targetId).toBe(TARGET);
      // The server answers `400 voterIdentityRequired` without this: with no auth anywhere, it IS the
      // one-vote key.
      expect(typeof body.installationId).toBe('string');
      expect(body.installationId.length).toBeGreaterThan(10);
      request.flush(storedRow({ verdict: 'down' }));
    });

    it('carries the vote-time context, which no join can recover later', () => {
      click('fw-up');
      const request = pendingVote();
      const body = request.request.body;
      expect(body.context).toBeTruthy();
      expect(body.context.uiLanguage).toBe('he');
      expect(typeof body.context.route).toBe('string');
      // RESERVED, and deliberately not invented: no build stamp exists in this client.
      expect(body.context.appBuild).toBeUndefined();
      request.flush(storedRow());
    });

    it('a DOWN-vote opens the note straight away, so the reason is written while it is fresh', () => {
      click('fw-down');
      expect(el('fw-note')).toBeTruthy();
      pendingVote().flush(storedRow({ verdict: 'down' }));
    });
  });

  // ── Flipping ─────────────────────────────────────────────────────────────────────────────────────

  describe('flipping', () => {
    it('sends NO text at all, which is how the stored note survives the flip', () => {
      // d1's rule expressed on the wire: `text` absent means LEAVE THE NOTE ALONE. Sending the field at
      // all - even as the note we happen to be holding - would make a verdict flip a note write.
      click('fw-down');
      pendingVote().flush(storedRow({ verdict: 'down', text: 'too thin' }));
      fixture.detectChanges();
      component.cancelNote();
      fixture.detectChanges();

      click('fw-up');
      const flip = pendingVote();
      expect(Object.prototype.hasOwnProperty.call(flip.request.body, 'text'))
        .withContext('a flip must not carry a text field in any form')
        .toBeFalse();
      expect(flip.request.body.verdict).toBe('up');

      flip.flush(storedRow({ verdict: 'up', text: 'too thin' }));
      fixture.detectChanges();
      expect(pressed('fw-up')).toBe('true');
      expect(pressed('fw-down')).toBe('false');
      // The server kept the note, so the affordance now offers to EDIT rather than to add.
      expect(el('fw-note-open')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['noteEdit']);
    });
  });

  // ── Retract ──────────────────────────────────────────────────────────────────────────────────────

  describe('retract', () => {
    it('pressing the LIT thumb deletes the row and leaves the widget unvoted', () => {
      click('fw-up');
      pendingVote().flush(storedRow({ id: 'fb-9' }));
      fixture.detectChanges();
      expect(pressed('fw-up')).toBe('true');

      click('fw-up');
      // Optimistically unvoted before the server answers.
      expect(pressed('fw-up')).toBe('false');
      http.expectOne(r => r.method === 'DELETE' && r.url === '/api/feedback/fb-9')
        .flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      expect(pressed('fw-up')).toBe('false');
      expect(component.verdict).toBeNull();
      expect(component.saved).toBeNull();
    });

    it('reverts to the stored vote when the delete fails', () => {
      click('fw-down');
      pendingVote().flush(storedRow({ id: 'fb-9', verdict: 'down' }));
      fixture.detectChanges();
      component.cancelNote();
      fixture.detectChanges();

      click('fw-down');
      http.expectOne(r => r.method === 'DELETE')
        .flush('boom', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      // The server still holds the row, so the widget shows it. Anything else would be the widget and the
      // server disagreeing about what exists.
      expect(pressed('fw-down')).toBe('true');
      expect(el('fw-failure')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['retractFailed']);
    });

    it('is a NO-OP while the vote that would create the row is still in flight', () => {
      // There is no id to delete by yet. Clearing the thumb optimistically would be undone the instant
      // that vote's own response landed and set `saved`, which is the widget arguing with itself.
      click('fw-up');
      const vote = pendingVote();
      click('fw-up');
      http.expectNone(r => r.method === 'DELETE');
      expect(pressed('fw-up')).toBe('true');
      vote.flush(storedRow());
    });
  });

  // ── The save-failure reconcile ────────────────────────────────────────────────────────────────────

  describe('save-failure reconcile', () => {
    it('leaves NO phantom vote on screen when the server refuses (400)', () => {
      click('fw-up');
      expect(pressed('fw-up')).toBe('true');

      pendingVote().flush({ error: 'targetNotFound' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(pressed('fw-up'))
        .withContext('the optimistic vote must not survive a refusal')
        .toBe('false');
      expect(component.verdict).toBeNull();
      expect(component.saved).toBeNull();
      expect(el('fw-failure')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['voteFailed']);
      // NON-BLOCKING: the control is live, and nothing retried on its own.
      expect((el('fw-up') as HTMLButtonElement).disabled).toBeFalse();
    });

    it('reverts to the PREVIOUSLY STORED vote when a flip fails, not to nothing', () => {
      click('fw-up');
      pendingVote().flush(storedRow({ verdict: 'up' }));
      fixture.detectChanges();

      click('fw-down');
      expect(pressed('fw-down')).toBe('true');
      pendingVote().flush('boom', { status: 0, statusText: 'Unknown Error' });
      fixture.detectChanges();

      // Converging on the SERVER's answer, which is still the up-vote. Reverting to "unvoted" would be a
      // second wrong state rather than a correction.
      expect(pressed('fw-up')).toBe('true');
      expect(pressed('fw-down')).toBe('false');
      expect(el('fw-failure')).toBeTruthy();
      // The down-vote's popover is closed again: there is no down-vote for a note to belong to.
      expect(el('fw-note')).toBeNull();
    });
  });

  // ── The stale landing ─────────────────────────────────────────────────────────────────────────────

  describe('a stale response landing after a newer action', () => {
    it('is DROPPED, so the older verdict cannot overwrite the newer one', () => {
      // Both requests SUCCEED, which is what makes the generation counter necessary: `pending`/`saved`
      // alone cannot tell two successes apart, and the slow one would win by arriving last.
      click('fw-up');
      click('fw-down');

      const requests = http.match(r => r.method === 'POST' && r.url === '/api/feedback');
      expect(requests.length)
        .withContext('the thumbs stay live during a vote, which is what makes this race reachable')
        .toBe(2);
      expect(requests[0].request.body.verdict).toBe('up');
      expect(requests[1].request.body.verdict).toBe('down');

      // The NEWER one lands first, then the older one lands late.
      requests[1].flush(storedRow({ id: 'fb-down', verdict: 'down' }));
      fixture.detectChanges();
      requests[0].flush(storedRow({ id: 'fb-up', verdict: 'up' }));
      fixture.detectChanges();

      expect(component.verdict)
        .withContext('the late up-vote must not resurrect itself over the down-vote')
        .toBe('down');
      expect(component.saved?.id).toBe('fb-down');
      expect(pressed('fw-down')).toBe('true');
      expect(pressed('fw-up')).toBe('false');
    });

    it('drops a response belonging to the PREVIOUS target', () => {
      // The widget is recycled when a host's `track` identity holds while the bound id changes. A vote
      // for the old answer landing afterwards must not light a thumb on the new one.
      click('fw-up');
      const stale = pendingVote();
      setInput('targetId', '33333333-3333-3333-3333-333333333333');

      stale.flush(storedRow({ id: 'fb-old' }));
      fixture.detectChanges();

      expect(component.verdict).toBeNull();
      expect(component.saved).toBeNull();
      expect(pressed('fw-up')).toBe('false');
    });
  });

  // ── No id, and the failed-answer mirror ───────────────────────────────────────────────────────────

  describe('no persisted id', () => {
    it('renders NOTHING at all', () => {
      setInput('targetId', null);
      // Not "renders a disabled control": no DOM. A widget on an answer whose persistence write faulted
      // would offer a vote that could never be stored.
      expect(fixture.nativeElement.querySelector('.fw')).toBeNull();
      expect(el('fw-up')).toBeNull();
    });

    it('treats a BLANK id as no id', () => {
      setInput('targetId', '   ');
      expect(el('fw-up')).toBeNull();
    });

    it('renders for ANY non-empty id, because a FAILED answer that persisted takes feedback', () => {
      // The mirror case, and half the reason C2 exists: nothing here looks at whether the target
      // SUCCEEDED. A thumbs-down on a refusal is signal.
      setInput('targetId', '22222222-2222-2222-2222-222222222222');
      expect(el('fw-down')).toBeTruthy();
    });

    it('forgets the previous target when the id changes under it', () => {
      click('fw-up');
      pendingVote().flush(storedRow());
      fixture.detectChanges();
      expect(component.verdict).toBe('up');

      setInput('targetId', '33333333-3333-3333-3333-333333333333');

      expect(component.verdict).toBeNull();
      expect(component.saved).toBeNull();
      expect(pressed('fw-up')).toBe('false');
    });
  });

  // ── The note ──────────────────────────────────────────────────────────────────────────────────────

  /**
   * THE PHANTOM VOTE, found by Bugbot on `pagedraft-client#45` and the one window where the widget's own
   * promise ("no phantom vote survives a refusal") could be broken.
   *
   * A down-vote opens the note editor WHILE its own vote request is still on the wire - that is the
   * deliberate design, since the thumbs are never disabled during a request. So a reader who types fast and
   * saves supersedes their own in-flight vote, which makes that vote's arms no-ops. `pending` was assigned
   * by the superseded request and only its arms cleared it, so a failing note save left the thumb LIT for a
   * vote the server never accepted - with `saved` still null, which also made retract a no-op, so the
   * reader could not take the phantom back.
   *
   * This block does NOT reuse the note describe's setup below, and that is the whole point: that one flushes
   * the first vote before opening the editor, so `saved` is populated and the phantom cannot form. The
   * defect needs the first vote UNRESOLVED.
   */
  describe('a note save that fails while the first vote is still in flight', () => {
    const REASON = 'the answer named the wrong chapter';

    it('leaves NO lit thumb, because nothing was ever stored', async () => {
      click('fw-down');
      // Captured before the second POST exists, since expectOne refuses to choose between two matches.
      const firstVote = pendingVote();
      await fixture.whenStable();
      fixture.detectChanges();

      typeNote(REASON);
      click('fw-note-save');
      const noteSave = pendingVote();

      // NON-VACUITY: the optimistic vote really is showing at this moment, so the assertions below are
      // measuring a value that was there to be cleared rather than one that never got set. Asserted through
      // the PUBLIC surface the reader sees - `verdict` and the rendered `aria-pressed` - because `pending`
      // is private and a test reaching past the getter would pass on a field the thumb no longer reads.
      expect(component.verdict)
        .withContext('the optimistic down-vote must be on screen before the save fails')
        .toBe('down');
      expect(pressed('fw-down')).toBe('true');

      noteSave.flush('boom', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(component.saved)
        .withContext('nothing was ever stored, so there is no row and retract has no id to use')
        .toBeNull();
      expect(component.verdict).toBeNull();
      expect(pressed('fw-down'))
        .withContext('a lit thumb here is a vote the server never accepted')
        .toBe('false');
      expect(pressed('fw-up')).toBe('false');

      // And the superseded vote landing late cannot resurrect it.
      firstVote.flush(storedRow({ id: 'fb-n', verdict: 'down' }));
      fixture.detectChanges();
      expect(component.verdict).toBeNull();
      expect(pressed('fw-down')).toBe('false');
    });
  });

  describe('the note', () => {
    beforeEach(() => {
      click('fw-down');
      pendingVote().flush(storedRow({ id: 'fb-n', verdict: 'down' }));
      fixture.detectChanges();
    });

    it('counts characters against the SERVER cap and refuses a save that would be rejected', () => {
      typeNote('x'.repeat(FEEDBACK_TEXT_MAX + 1));

      expect(el('fw-note-counter')?.textContent).toContain(String(FEEDBACK_TEXT_MAX + 1));
      expect(el('fw-note-counter')?.textContent).toContain(String(FEEDBACK_TEXT_MAX));
      expect((el('fw-note-save') as HTMLButtonElement).disabled)
        .withContext('the cap is a 400 server-side, not a truncation')
        .toBeTrue();
      expect(el('fw-note-error')).toBeTruthy();
      // The refusal is local, so nothing went out.
      http.expectNone(r => r.method === 'POST');
    });

    it('posts the note WITH the current verdict, on the same one-vote key', () => {
      typeNote('the answer named the wrong chapter');
      click('fw-note-save');

      const save = pendingVote();
      expect(save.request.body.text).toBe('the answer named the wrong chapter');
      expect(save.request.body.verdict).toBe('down');
      expect(save.request.body.targetId).toBe(TARGET);

      save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: 'the answer named the wrong chapter' }));
      fixture.detectChanges();
      expect(el('fw-note')).toBeNull();
      expect(component.saved?.text).toBe('the answer named the wrong chapter');
    });

    it('sends an EMPTY string to clear, because a reader who deleted their words meant to', () => {
      typeNote('');
      click('fw-note-save');
      const save = pendingVote();
      // Empty-after-trim CLEARS server-side; withholding the field would have meant "keep it", which is
      // the opposite of what the reader just did.
      expect(save.request.body.text).toBe('');
      save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: null }));
    });

    it('keeps the editor OPEN with the text in it when the save fails', () => {
      typeNote('a paragraph the reader does not want to retype');
      click('fw-note-save');
      pendingVote().flush('boom', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(el('fw-note')).toBeTruthy();
      expect(component.noteDraft).toBe('a paragraph the reader does not want to retype');
      expect(el('fw-failure')).toBeTruthy();
    });

    it('cancel leaves the STORED note untouched and sends nothing', () => {
      typeNote('discard me');
      click('fw-note-cancel');
      expect(el('fw-note')).toBeNull();
      http.expectNone(r => r.method === 'POST');
      expect(component.saved?.text ?? null).toBeNull();
    });

    it('keeps a typed draft across a failed vote that reopens the note', async () => {
      // This describe's beforeEach already voted down and stored a row. Retract it first so the widget
      // is genuinely UNVOTED, which is the shape the bug needs: a second down-press must go through
      // vote() again (not retract()) for openNote() to run a second time.
      component.cancelNote();
      fixture.detectChanges();
      click('fw-down');
      http.expectOne(r => r.method === 'DELETE')
        .flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();
      expect(component.verdict).toBeNull();

      // First down-press: the note opens automatically, empty, then the vote fails.
      click('fw-down');
      typeNote('a paragraph the reader does not want to retype');
      pendingVote().flush('boom', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      // Second down-press: still unvoted, so this runs vote() (not retract()) and openNote() a second
      // time. The draft has to survive it - the request is left open on purpose, the same way the rest
      // of this file holds a request open to type or assert against it mid-flight.
      click('fw-down');
      // The textarea is FRESH (the previous one was torn down with the closed editor), and NgModel's
      // first write to a newly created control lands on a microtask rather than inside this same
      // `detectChanges()`, so the assertion has to wait one tick for the DOM to catch up with the field.
      await fixture.whenStable();
      fixture.detectChanges();
      const textarea = fixture.debugElement.query(By.css('.fw-note-input')).nativeElement as HTMLTextAreaElement;
      expect(textarea.value).toBe('a paragraph the reader does not want to retype');

      pendingVote().flush(
        storedRow({ id: 'fb-n2', verdict: 'down', text: 'a paragraph the reader does not want to retype' }),
      );
    });

    it('still prefills from the stored note when there is no live draft to protect', async () => {
      typeNote('first thoughts');
      click('fw-note-save');
      pendingVote().flush(storedRow({ id: 'fb-n', verdict: 'down', text: 'first thoughts' }));
      fixture.detectChanges();

      // Discard explicitly - the only way a draft is meant to go away - so the next open has none to
      // protect and must fall back to the stored text.
      component.cancelNote();
      fixture.detectChanges();

      click('fw-note-open');
      // Same fresh-control microtask as above.
      await fixture.whenStable();
      fixture.detectChanges();
      const textarea = fixture.debugElement.query(By.css('.fw-note-input')).nativeElement as HTMLTextAreaElement;
      expect(textarea.value).toBe('first thoughts');
    });

    // ── A newer action landing on top of an in-flight note save ─────────────────────────────────────

    /**
     * THE WINDOW IS THE TEST. Every case below holds the note save's request OPEN across the assertions
     * that follow it, because the defect only exists while that request is unanswered: `savingNote` is
     * raised beside it and lowered only inside its own arms, and a newer action makes both arms return
     * above their lowering line. A synchronous `of()`/`throwError()` double answers inside the very
     * `click()` that starts the save, so the flag is already down before the superseding press and every
     * assertion here passes against the bug. `TestRequest` answers only on `flush`, which is the same
     * open window a Subject gives and is the shape the rest of this file already uses.
     *
     * All three superseding paths are exercised - a thumb press, a retract, and a target change - because
     * a fix wired into two of the three is the same defect wearing a hat.
     */
    describe('a newer action while the note is saving', () => {
      const REASON = 'the answer named the wrong chapter';

      function textarea(): HTMLTextAreaElement {
        return fixture.debugElement.query(By.css('.fw-note-input')).nativeElement as HTMLTextAreaElement;
      }

      beforeEach(async () => {
        // LET THE FRESH CONTROL SETTLE BEFORE TYPING INTO IT. The outer beforeEach opened this editor one
        // statement ago, and NgModel's first write to a newly created control lands on a microtask (the
        // same timing the two specs above wait on). Typing before it flushes leaves that write queued with
        // the control's ORIGINAL empty value, and it then blanks the textarea mid-test while `noteDraft`
        // keeps the text - a harness artifact with nothing to do with the latch, and one that would read
        // exactly like a lost draft.
        await fixture.whenStable();
        fixture.detectChanges();
      });

      it('a thumb press FREES the editor rather than stranding it on "saving"', async () => {
        typeNote(REASON);
        click('fw-note-save');
        const save = pendingVote();

        // The lock is real while the save can still answer: that is the state the widget is meant to have.
        // NgModel intercepts the `[disabled]` binding and applies it on a MICROTASK rather than inside the
        // `detectChanges()` above, so the textarea's own attribute is asserted one tick later. The save
        // request stays open across the wait, which is what keeps the window open.
        await fixture.whenStable();
        fixture.detectChanges();
        expect(textarea().disabled).toBeTrue();
        expect((el('fw-note-cancel') as HTMLButtonElement).disabled).toBeTrue();
        expect(el('fw-note-save')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['noteSaving']);

        // The thumbs stay live during a request by design, so this press supersedes the save mid-flight.
        click('fw-up');
        const flip = pendingVote();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.savingNote)
          .withContext('the save was cancelled, so the flag it raised has to come down')
          .toBeFalse();
        expect(textarea().disabled).toBeFalse();
        expect((el('fw-note-cancel') as HTMLButtonElement).disabled).toBeFalse();
        expect((el('fw-note-save') as HTMLButtonElement).disabled).toBeFalse();
        expect(el('fw-note-save')?.textContent?.trim()).toBe(FEEDBACK_STRINGS_HE['noteSave']);
        // The recorded decision: the superseding ACTION owns the editor, and a thumb press leaves it open
        // with the reader's paragraph in it. A flip keeps the stored note, so the words they were saving
        // still belong to the vote they now hold.
        expect(el('fw-note')).toBeTruthy();
        expect(component.noteDraft).toBe(REASON);
        expect(textarea().value).toBe(REASON);

        // The cancelled save lands LATE and is dropped, so it cannot re-lock a form it no longer owns.
        save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: REASON }));
        fixture.detectChanges();
        expect(component.savingNote).toBeFalse();
        expect(component.verdict).toBe('up');
        expect(el('fw-note')).toBeTruthy();

        flip.flush(storedRow({ id: 'fb-n', verdict: 'up', text: REASON }));
        fixture.detectChanges();
      });

      it('Cancel CLOSES the editor afterwards, which the stranded flag refused outright', () => {
        typeNote(REASON);
        click('fw-note-save');
        const save = pendingVote();

        click('fw-up');
        const flip = pendingVote();

        // cancelNote()'s early return is a reader of the flag that no disabled-attribute assertion
        // reaches: the button can be live and the handler still refuse.
        click('fw-note-cancel');
        expect(component.savingNote)
          .withContext('Cancel is refused while savingNote is stranded true, so name the flag first')
          .toBeFalse();
        expect(el('fw-note')).toBeNull();
        expect(component.noteDraft).toBe('');

        save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: REASON }));
        flip.flush(storedRow({ id: 'fb-n', verdict: 'up', text: REASON }));
        fixture.detectChanges();
      });

      it('Save is REACHABLE again, and carries the verdict now in force', () => {
        typeNote(REASON);
        click('fw-note-save');
        const save = pendingVote();

        click('fw-up');
        const flip = pendingVote();

        expect(component.savingNote)
          .withContext('a stranded savingNote makes saveNote() swallow the press below, sending nothing')
          .toBeFalse();
        click('fw-note-save');
        // saveNote()'s own `savingNote` guard would have swallowed this press while the flag was stranded,
        // so the existence of this request is the assertion.
        const resave = pendingVote();
        expect(resave.request.body.text).toBe(REASON);
        expect(resave.request.body.verdict)
          .withContext('the note travels with the verdict, and the thumb press just changed it')
          .toBe('up');

        save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: REASON }));
        flip.flush(storedRow({ id: 'fb-n', verdict: 'up', text: REASON }));
        resave.flush(storedRow({ id: 'fb-n', verdict: 'up', text: REASON }));
        fixture.detectChanges();

        expect(el('fw-note')).toBeNull();
        expect(component.saved?.text).toBe(REASON);
      });

      it('a RETRACT closes the editor, and closed is not the same as locked', () => {
        typeNote(REASON);
        click('fw-note-save');
        const save = pendingVote();

        // Pressing the LIT thumb retracts: the second superseding path, and the one whose own rule closes
        // the editor - a note belongs to a vote and this removes the vote. What must not survive either
        // way is the lock, which would otherwise reappear the moment the reader voted again.
        click('fw-down');
        const del = http.expectOne(r => r.method === 'DELETE');
        expect(component.savingNote)
          .withContext('retract cancelled the save, so its flag must not outlive the vote it belonged to')
          .toBeFalse();
        expect(el('fw-note')).toBeNull();

        save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: REASON }));
        fixture.detectChanges();
        expect(component.savingNote).toBeFalse();
        expect(component.verdict).toBeNull();

        del.flush(null, { status: 204, statusText: 'No Content' });
        fixture.detectChanges();
        expect(el('fw-note')).toBeNull();
      });

      it('a TARGET change leaves no lock behind on the next answer', () => {
        typeNote(REASON);
        click('fw-note-save');
        const save = pendingVote();

        // The third superseding path. A recycled widget is a different answer's widget: editor closed and
        // draft gone, and above all not locked by a save that belonged to the previous id.
        setInput('targetId', '33333333-3333-3333-3333-333333333333');
        expect(component.savingNote).toBeFalse();
        expect(component.noteDraft).toBe('');
        expect(el('fw-note')).toBeNull();

        save.flush(storedRow({ id: 'fb-n', verdict: 'down', text: REASON }));
        fixture.detectChanges();
        expect(component.saved).toBeNull();
      });
    });
  });

  // ── Chrome ────────────────────────────────────────────────────────────────────────────────────────

  describe('chrome and direction', () => {
    it('is Hebrew-default and carries its OWN dir', () => {
      // Its own, not inherited: the widget is mounted beside content whose direction comes from the
      // SERVER's answer language, so inheriting would place the note popover off the wrong edge for a
      // Hebrew reader looking at an English answer.
      expect(fixture.nativeElement.getAttribute('dir')).toBe('rtl');
      expect(el('fw-up')?.getAttribute('aria-label')).toBe(FEEDBACK_STRINGS_HE['voteUpAria']);
    });

    it('flips to LTR with the language, and the labels flip with it', () => {
      setInput('lang', 'en');
      expect(fixture.nativeElement.getAttribute('dir')).toBe('ltr');
      expect(el('fw-down')?.getAttribute('aria-label')).toBe(FEEDBACK_STRINGS_EN['voteDownAria']);
    });

    it('renames the lit thumb to UNDO, because pressing it retracts', () => {
      click('fw-up');
      pendingVote().flush(storedRow());
      fixture.detectChanges();
      // A control whose meaning changed has to say so rather than keep announcing what it no longer does.
      expect(el('fw-up')?.getAttribute('aria-label')).toBe(FEEDBACK_STRINGS_HE['voteRetractAria']);
      expect(el('fw-down')?.getAttribute('aria-label')).toBe(FEEDBACK_STRINGS_HE['voteDownAria']);
    });
  });

  // ── Note input identity (D2, closing render gate) ───────────────────────────────────────────────────

  describe('note input identity', () => {
    it('gives two mounted widgets distinct ids, and keeps each label pointed at its OWN textarea', () => {
      const host = TestBed.createComponent(TwoWidgetsHostComponent);
      host.detectChanges();

      const widgets = host.debugElement.queryAll(By.directive(FeedbackWidgetComponent));
      expect(widgets.length).toBe(2);

      // A down-vote opens the note editor immediately, before the round trip - see "voting" above - so
      // neither request needs to resolve for the note DOM to exist.
      widgets[0].query(By.css('[data-testid="fw-down"]')).nativeElement.click();
      widgets[1].query(By.css('[data-testid="fw-down"]')).nativeElement.click();
      host.detectChanges();

      const textarea1 = widgets[0].query(By.css('.fw-note-input')).nativeElement as HTMLTextAreaElement;
      const textarea2 = widgets[1].query(By.css('.fw-note-input')).nativeElement as HTMLTextAreaElement;
      const label1 = widgets[0].query(By.css('.fw-note-title')).nativeElement as HTMLLabelElement;
      const label2 = widgets[1].query(By.css('.fw-note-title')).nativeElement as HTMLLabelElement;

      expect(textarea1.id).toBeTruthy();
      expect(textarea2.id).toBeTruthy();
      expect(textarea1.id)
        .withContext('the measured defect: two widgets on one page shared this literal string')
        .not.toBe(textarea2.id);

      // RESOLUTION, not string difference. `HTMLLabelElement.control` is the browser's own answer to
      // "which control does this label activate", the same resolution a click on the label performs - a
      // distinct id whose label still points elsewhere would pass an id-string assertion and still be the
      // same defect (measured: focusLandedOn = widget[0] textarea).
      expect(label1.control)
        .withContext("widget 0's label must resolve to widget 0's own textarea")
        .toBe(textarea1);
      expect(label2.control)
        .withContext("widget 1's label must resolve to widget 1's own textarea")
        .toBe(textarea2);
      expect(label1.control).not.toBe(textarea2);
      expect(label2.control).not.toBe(textarea1);

      http.expectOne(r => r.method === 'POST' && r.url === '/api/feedback' && r.body.targetId === TARGET)
        .flush(storedRow({ verdict: 'down' }));
      http
        .expectOne(r => r.method === 'POST' && r.url === '/api/feedback' && r.body.targetId === OTHER_TARGET)
        .flush(storedRow({ verdict: 'down', targetId: OTHER_TARGET }));
    });
  });
});
