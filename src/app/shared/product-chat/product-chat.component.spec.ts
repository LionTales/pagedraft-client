/**
 * ProductChatComponent: the rendered surface (chatbot phase A, c2; merged into the dock in A.1, w1).
 *
 * Covers the states the todo names: empty, send/receive, in-flight, citation rendering, the honest
 * failure state per fault reason, and RTL/LTR chrome.
 *
 * What is NOT here any more, because it is not this component's any more: the launcher, the drawer
 * shell, the widen and close controls, Escape, and the edge the drawer is pinned to. All of those moved
 * to `AppDockComponent` when the two app-level overlays were merged into one tabbed drawer, and their
 * coverage moved with them to `shared/app-dock/`. This surface is now a tab BODY, so it is opened by
 * selecting its tab through `AppOverlayService` rather than by clicking a launcher of its own.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ProductChatComponent } from './product-chat.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { ProductChatResponseDto } from '../../core/models/product-chat';
import { CHAT_STRINGS_EN, CHAT_STRINGS_HE, faultMessage } from '../../core/i18n/chat-strings';

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

function groundedAnswer(over: Partial<ProductChatResponseDto> = {}): ProductChatResponseDto {
  return {
    answer: 'Import accepts a DOCX file and splits it by Heading 1.',
    guideIds: ['import'],
    language: 'en',
    isGrounded: true,
    faultReason: null,
    ...over,
  };
}

function failSafe(reason: string): ProductChatResponseDto {
  return {
    answer: 'I cannot reach the guides right now.',
    guideIds: [],
    language: 'he',
    isGrounded: false,
    faultReason: reason,
  };
}

describe('ProductChatComponent (chatbot phase A)', () => {
  let fixture: ComponentFixture<ProductChatComponent>;
  let component: ProductChatComponent;
  let http: HttpTestingController;
  let overlays: AppOverlayService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductChatComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductChatComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    overlays = TestBed.inject(AppOverlayService);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /**
   * Show this tab.
   *
   * Driven through the shared service because that is the only way the surface comes up now: the dock
   * owns the launcher, and this component gates its content on "the assistant tab is showing".
   */
  function openDrawer(): void {
    overlays.openTab('assistant');
    fixture.detectChanges();
  }

  /** Type a question and submit it. */
  function ask(question: string): void {
    component.draft = question;
    fixture.detectChanges();
    fixture.debugElement.query(By.css('.pc-composer')).triggerEventHandler('submit', new Event('submit'));
    fixture.detectChanges();
  }

  /** Flip the chrome to English the way the Activity Center's spec flips its own. */
  function useEnglish(): void {
    (component as unknown as { appLang: 'he' | 'en' }).appLang = 'en';
    fixture.detectChanges();
  }

  // ── Tab body ────────────────────────────────────────────────────────────────────────────────────

  describe('tab body', () => {
    it('renders NOTHING until its tab is showing, and owns no launcher of its own', () => {
      expect(fixture.debugElement.query(By.css('.pc-pane'))).toBeNull();
      // The merge left exactly one launcher, on the dock. A second one here is what the owner saw as
      // two competing affordances.
      expect(fixture.debugElement.query(By.css('.pc-launcher'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-drawer')))
        .withContext('the drawer shell belongs to the dock now')
        .toBeNull();
    });

    it('renders the conversation once its tab is selected, and drops it when the tab is left', () => {
      openDrawer();
      expect(fixture.debugElement.query(By.css('.pc-pane'))).not.toBeNull();

      overlays.selectTab('activity');
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-pane')))
        .withContext('the assistant must not render inside the activity tab')
        .toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-composer'))).toBeNull();
    });

    it('KEEPS the transcript across a tab switch (the component is hidden, never unmounted)', () => {
      openDrawer();
      ask('how do I import?');
      http.expectOne('/api/product-chat').flush(groundedAnswer());
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn--user')).length).toBe(1);

      overlays.selectTab('activity');
      fixture.detectChanges();
      overlays.selectTab('assistant');
      fixture.detectChanges();

      expect(fixture.debugElement.queryAll(By.css('.pc-turn--user')).length)
        .withContext('a tab switch must not throw away the author\'s conversation')
        .toBe(1);
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).not.toBeNull();
    });

    it('close() is scoped to this tab: it cannot dismiss the OTHER tab\'s panel', () => {
      overlays.openTab('activity');
      component.close();
      expect(overlays.isOpen)
        .withContext('a stale close from a hidden tab must not close the dock')
        .toBeTrue();
      expect(overlays.activeTab).toBe('activity');
    });
  });

  // ── Empty state ─────────────────────────────────────────────────────────────────────────────────

  describe('empty state', () => {
    beforeEach(() => openDrawer());

    it('renders the empty state, with no turns and no in-flight row', () => {
      expect(fixture.debugElement.query(By.css('.pc-empty'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(0);
      expect(fixture.debugElement.query(By.css('.pc-pending'))).toBeNull();
    });

    it('states the grounding promise up front (it is why a refusal is not a malfunction)', () => {
      const body = fixture.debugElement.query(By.css('.pc-empty-body')).nativeElement.textContent;
      expect(body.trim()).toBe(CHAT_STRINGS_HE['emptyBody']);
      expect(fixture.debugElement.query(By.css('.pc-grounding-note'))).not.toBeNull();
    });

    it('an example fills the composer instead of sending it, so the author can edit first', () => {
      const example = fixture.debugElement.queryAll(By.css('.pc-example'))[0];
      example.nativeElement.click();
      fixture.detectChanges();

      expect(component.draft).toBe(CHAT_STRINGS_HE['example1']);
      http.expectNone('/api/product-chat');
    });

    it('disappears once there is a turn', () => {
      ask('how do I import?');
      http.expectOne('/api/product-chat').flush(groundedAnswer());
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('.pc-empty'))).toBeNull();
    });

    it('shows NO phase C affordance: no history list, no quota readout, no settings control', () => {
      // Phase A must not imply the phase C surfaces. Asserted on the rendered DOM rather than on the
      // string map alone, because a control can exist without a localized label.
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toMatch(/quota|token|histor|previous conversation|customi[sz]/i);
      expect(fixture.debugElement.queryAll(By.css('.pc-pane button')).length)
        .withContext('3 examples + send = 4 controls, nothing more (the shell\'s own controls are the dock\'s)')
        .toBe(4);
    });
  });

  // ── Send / receive ──────────────────────────────────────────────────────────────────────────────

  describe('send and receive', () => {
    beforeEach(() => openDrawer());

    it('renders the author\'s turn and the assistant\'s answer DISTINCTLY', () => {
      ask('how do I import?');
      http.expectOne('/api/product-chat').flush(groundedAnswer());
      fixture.detectChanges();

      const user = fixture.debugElement.queryAll(By.css('.pc-turn--user'));
      const assistant = fixture.debugElement.queryAll(By.css('.pc-turn--assistant'));
      expect(user.length).toBe(1);
      expect(assistant.length).toBe(1);

      expect(user[0].query(By.css('.pc-bubble--user')).nativeElement.textContent)
        .toContain('how do I import?');
      expect(assistant[0].query(By.css('.pc-bubble--assistant')).nativeElement.textContent)
        .toContain('Import accepts a DOCX file');

      // Distinct is not only a class name: the two bubbles must not share a background.
      const userBg = getComputedStyle(user[0].query(By.css('.pc-bubble')).nativeElement).backgroundColor;
      const botBg = getComputedStyle(assistant[0].query(By.css('.pc-bubble')).nativeElement).backgroundColor;
      expect(userBg).not.toBe(botBg);
    });

    it('clears the composer and refuses to send a blank question', () => {
      ask('   ');
      http.expectNone('/api/product-chat');

      ask('a real question');
      expect(component.draft).toBe('');
      http.expectOne('/api/product-chat').flush(groundedAnswer());
    });

    it('sends prior turns as history, oldest first', () => {
      ask('first');
      http.expectOne('/api/product-chat').flush(groundedAnswer({ answer: 'first answer' }));
      fixture.detectChanges();

      ask('second');
      const req = http.expectOne('/api/product-chat');
      expect(req.request.body.question).toBe('second');
      expect(req.request.body.history).toEqual([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first answer' },
      ]);
      req.flush(groundedAnswer());
    });

    it('NEVER replays a fail-safe as an assistant turn in the history', () => {
      // A fail-safe is the assistant declining to speak. Feeding it back would condition the next
      // answer on words the assistant never said.
      ask('first');
      http.expectOne('/api/product-chat').flush(failSafe('model-unavailable'));
      fixture.detectChanges();

      ask('second');
      const req = http.expectOne('/api/product-chat');
      expect(req.request.body.history).toEqual([{ role: 'user', content: 'first' }]);
      expect(JSON.stringify(req.request.body.history)).not.toContain('assistant');
      req.flush(groundedAnswer());
    });

    it('sets the message direction from the SERVER\'s answer language, not the chrome language', () => {
      ask('שאלה');
      http.expectOne('/api/product-chat').flush(groundedAnswer({ language: 'en' }));
      fixture.detectChanges();

      const answer = fixture.debugElement.query(By.css('.pc-answer')).nativeElement as HTMLElement;
      expect(answer.getAttribute('dir'))
        .withContext('an English answer reads LTR even inside Hebrew chrome')
        .toBe('ltr');

      // ...and the direction is scoped to the ANSWER. The citation is chrome in the app language, so
      // it must not inherit the answer's direction (an English citation laid out RTL under a Hebrew
      // answer is what this scoping fixed).
      const bubble = fixture.debugElement.query(By.css('.pc-bubble--assistant')).nativeElement as HTMLElement;
      expect(bubble.hasAttribute('dir'))
        .withContext('the bubble stays in chrome direction; only .pc-answer carries the answer dir')
        .toBeFalse();
      expect(fixture.debugElement.query(By.css('.pc-citation'))?.nativeElement.hasAttribute('dir'))
        .toBeFalse();
    });
  });

  // ── In-flight ───────────────────────────────────────────────────────────────────────────────────

  describe('in-flight', () => {
    beforeEach(() => openDrawer());

    it('shows the in-flight row and disables sending until the answer lands', async () => {
      ask('how do I import?');

      const pending = fixture.debugElement.query(By.css('.pc-pending'));
      expect(pending).not.toBeNull();
      expect(pending.nativeElement.textContent).toContain(CHAT_STRINGS_HE['inFlight']);

      const send = fixture.debugElement.query(By.css('.pc-send')).nativeElement as HTMLButtonElement;
      expect(send.disabled).toBeTrue();

      // NgModel applies a `[disabled]` binding in a microtask, so the textarea's state is only settled
      // after the zone drains. Asserted anyway: an editable composer during a request is how a second
      // question gets typed into a drawer that cannot send it.
      await fixture.whenStable();
      fixture.detectChanges();
      expect((fixture.debugElement.query(By.css('.pc-input')).nativeElement as HTMLTextAreaElement).disabled)
        .toBeTrue();

      http.expectOne('/api/product-chat').flush(groundedAnswer());
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-pending'))).toBeNull();
      expect((fixture.debugElement.query(By.css('.pc-input')).nativeElement as HTMLTextAreaElement).disabled)
        .toBeFalse();
    });

    it('does not start a second request while one is in flight', () => {
      ask('first');
      component.draft = 'second';
      component.submit();
      http.expectOne('/api/product-chat').flush(groundedAnswer());
    });

    it('the in-flight row is NOT an assistant answer: it carries no citation', () => {
      ask('how do I import?');
      expect(fixture.debugElement.query(By.css('.pc-citation'))).toBeNull();
      http.expectOne('/api/product-chat').flush(groundedAnswer());
    });
  });

  // ── Citation ────────────────────────────────────────────────────────────────────────────────────

  describe('citation', () => {
    beforeEach(() => openDrawer());

    it('names the guide an answer came from, by TITLE, inside the answer card', () => {
      ask('how do I import?');
      http.expectOne('/api/product-chat').flush(groundedAnswer({ guideIds: ['import'] }));
      fixture.detectChanges();

      const citation = fixture.debugElement.query(By.css('.pc-citation'));
      expect(citation).not.toBeNull();
      // Inside the answer bubble, not appended to the transcript as a separate footnote.
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant .pc-citation'))).not.toBeNull();

      const chips = citation.queryAll(By.css('.pc-citation-chip'));
      expect(chips.length).toBe(1);
      expect(chips[0].nativeElement.textContent.trim()).toBe('ייבוא כתב היד');
      expect(citation.query(By.css('.pc-citation-label')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['citationOne']);
    });

    it('renders EVERY cited guide, and uses the plural label for more than one', () => {
      ask('what runs before the review?');
      http.expectOne('/api/product-chat')
        .flush(groundedAnswer({ guideIds: ['whole-book-review', 'book-setup-and-intelligence'] }));
      fixture.detectChanges();

      const chips = fixture.debugElement.queryAll(By.css('.pc-citation-chip'));
      expect(chips.length).toBe(2);
      expect(chips.map(c => c.nativeElement.textContent.trim()))
        .toEqual(['העריכה ההתפתחותית', 'מה PageDraft יודע על הספר שלכם']);
      expect(fixture.debugElement.query(By.css('.pc-citation-label')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['citationMany']);
    });

    it('shows an UNKNOWN guide id rather than dropping it from the citation', () => {
      ask('q');
      http.expectOne('/api/product-chat').flush(groundedAnswer({ guideIds: ['release-notes'] }));
      fixture.detectChanges();

      const chips = fixture.debugElement.queryAll(By.css('.pc-citation-chip'));
      expect(chips.length).toBe(1);
      expect(chips[0].nativeElement.textContent.trim()).toBe('release-notes');
    });

    it('renders no citation block when the answer cites nothing', () => {
      ask('q');
      http.expectOne('/api/product-chat').flush(groundedAnswer({ guideIds: [] }));
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('.pc-citation'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).not.toBeNull();
    });
  });

  // ── Honest failure ──────────────────────────────────────────────────────────────────────────────

  describe('fail-safe (isGrounded === false)', () => {
    beforeEach(() => openDrawer());

    it('renders a FAILURE block, not an assistant turn', () => {
      // The load-bearing assertion of this whole feature. If the refusal renders as an assistant
      // message, the refusal has been undone.
      ask('does PageDraft have a dark mode toggle?');
      http.expectOne('/api/product-chat').flush(failSafe('guides-unavailable'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-fault'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn--assistant')).length).toBe(0);
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).toBeNull();
      // And it must not be attributed to the assistant by a role label either.
      expect(fixture.debugElement.query(By.css('.pc-fault .pc-role'))).toBeNull();
    });

    it('does NOT render the server\'s fail-safe prose as if it were the answer', () => {
      ask('q');
      http.expectOne('/api/product-chat').flush(failSafe('guides-unavailable'));
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('I cannot reach the guides right now.');
      expect(text).toContain(faultMessage('he', 'guides-unavailable'));
    });

    it('gives each fault reason its OWN sentence', () => {
      const reasons = ['guides-unavailable', 'guides-empty', 'model-unavailable', 'empty-answer'];
      const rendered: string[] = [];

      for (const reason of reasons) {
        ask('q');
        http.expectOne('/api/product-chat').flush(failSafe(reason));
        fixture.detectChanges();

        const nodes = fixture.debugElement.queryAll(By.css('.pc-fault-reason'));
        rendered.push(nodes[nodes.length - 1].nativeElement.textContent.trim());
      }

      expect(rendered.length).toBe(reasons.length);   // non-vacuity before the uniqueness claim
      expect(rendered.every(s => s.length > 0)).toBeTrue();
      expect(new Set(rendered).size).toBe(reasons.length);
      for (let i = 0; i < reasons.length; i++) {
        expect(rendered[i]).toBe(faultMessage('he', reasons[i]));
      }
    });

    it('falls back to the generic sentence for an unrecognized code', () => {
      ask('q');
      http.expectOne('/api/product-chat').flush(failSafe('a-code-from-the-future'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-fault-reason')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['faultUnknown']);
    });

    it('renders a TRANSPORT failure as its own distinct honest state', () => {
      ask('q');
      http.expectOne('/api/product-chat').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-fault'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-fault-reason')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['faultNetwork']);
      // Never a bubble: a dead connection is not something the assistant said either.
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).toBeNull();
      // And the surface recovers: the composer is usable again.
      expect((fixture.debugElement.query(By.css('.pc-input')).nativeElement as HTMLTextAreaElement).disabled)
        .toBeFalse();
    });

    it('retry re-asks the SAME question through the ordinary send path, without duplicating the turn', () => {
      ask('how do I export?');
      http.expectOne('/api/product-chat').flush(failSafe('model-unavailable'));
      fixture.detectChanges();

      fixture.debugElement.query(By.css('.pc-retry')).nativeElement.click();
      fixture.detectChanges();

      const req = http.expectOne('/api/product-chat');
      expect(req.request.body.question).toBe('how do I export?');
      expect(req.request.body.history).toEqual([]);
      req.flush(groundedAnswer());
      fixture.detectChanges();

      expect(fixture.debugElement.queryAll(By.css('.pc-turn--user')).length).toBe(1);
      expect(fixture.debugElement.query(By.css('.pc-fault'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).not.toBeNull();
    });
  });

  // ── Starting over ───────────────────────────────────────────────────────────────────────────────

  describe('new conversation (A.1, w2)', () => {
    beforeEach(() => openDrawer());

    /** Run one complete exchange, so there is a transcript to reset. */
    function exchange(question: string, answer: string): void {
      ask(question);
      http.expectOne('/api/product-chat').flush(groundedAnswer({ answer }));
      fixture.detectChanges();
    }

    it('offers NO reset control until there is a conversation to clear', () => {
      // The cheapest footgun guard: in the empty state the control does not exist to be mis-clicked.
      expect(fixture.debugElement.query(By.css('.pc-conversation-bar'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-new'))).toBeNull();

      exchange('how do I import?', 'answer one');
      expect(fixture.debugElement.query(By.css('.pc-new'))).not.toBeNull();
    });

    it('the first click DESTROYS NOTHING: it only arms a confirmation, and cancel stands down', () => {
      exchange('how do I import?', 'answer one');
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(2);

      fixture.debugElement.query(By.css('.pc-new')).nativeElement.click();
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-reset-confirm'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length)
        .withContext('arming must not clear anything')
        .toBe(2);

      fixture.debugElement.query(By.css('.pc-reset-no')).nativeElement.click();
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.pc-reset-confirm'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-new'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(2);
    });

    it('the SECOND click clears the transcript and brings the empty state back', () => {
      exchange('how do I import?', 'answer one');
      expect(fixture.debugElement.query(By.css('.pc-empty'))).toBeNull();

      fixture.debugElement.query(By.css('.pc-new')).nativeElement.click();
      fixture.detectChanges();
      fixture.debugElement.query(By.css('.pc-reset-yes')).nativeElement.click();
      fixture.detectChanges();

      expect(component.entries.length).toBe(0);
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length).toBe(0);
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant'))).toBeNull();

      // The empty state that returns is the WHOLE one: the grounding promise and the example chips,
      // not a blank panel.
      expect(fixture.debugElement.query(By.css('.pc-empty'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-empty-body')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_HE['emptyBody']);
      expect(fixture.debugElement.queryAll(By.css('.pc-example')).length).toBe(3);
      expect(fixture.debugElement.query(By.css('.pc-grounding-note'))).not.toBeNull();

      // ...and the bar itself is gone again, because there is nothing left to clear.
      expect(fixture.debugElement.query(By.css('.pc-conversation-bar'))).toBeNull();
    });

    it('the NEXT request goes up with an EMPTY history', () => {
      // This is the property the whole control exists for: the drift the owner hit came from prior
      // turns still sitting in the window.
      exchange('first', 'first answer');
      ask('second');
      const carried = http.expectOne('/api/product-chat');
      // Non-vacuity: prove history was really being carried before asserting that it stops.
      expect(carried.request.body.history.length).toBeGreaterThan(0);
      carried.flush(groundedAnswer({ answer: 'second answer' }));
      fixture.detectChanges();

      component.startNewConversation();
      fixture.detectChanges();

      ask('after the reset');
      const fresh = http.expectOne('/api/product-chat');
      expect(fresh.request.body.question).toBe('after the reset');
      expect(fresh.request.body.history)
        .withContext('a reset conversation must be asked clean')
        .toEqual([]);
      fresh.flush(groundedAnswer());
    });

    it('is DISABLED while a request is in flight, and cannot be armed behind it', () => {
      exchange('first', 'first answer');
      ask('second');

      const button = fixture.debugElement.query(By.css('.pc-new')).nativeElement as HTMLButtonElement;
      expect(button.disabled).toBeTrue();
      expect(button.getAttribute('title')).toBe(CHAT_STRINGS_HE['newConversationBusy']);

      // The DOM refuses the click; the handler refuses it too, so a caller that is not a click cannot
      // arm a confirmation that would be waiting when the answer lands.
      component.requestReset();
      fixture.detectChanges();
      expect(component.confirmingReset).toBeFalse();
      expect(fixture.debugElement.query(By.css('.pc-reset-confirm'))).toBeNull();

      http.expectOne('/api/product-chat').flush(groundedAnswer());
      fixture.detectChanges();
      expect((fixture.debugElement.query(By.css('.pc-new')).nativeElement as HTMLButtonElement).disabled)
        .toBeFalse();
    });

    it('a reset that lands MID-FLIGHT cancels the request, so its answer can never join the fresh transcript', () => {
      // The mechanism, asserted rather than described: the request is unsubscribed, which both cancels
      // it and removes every path by which `next`/`error` could still append an entry.
      ask('a question whose answer will be too late');
      const req = http.expectOne('/api/product-chat');

      component.startNewConversation();
      fixture.detectChanges();

      expect(req.cancelled)
        .withContext('the discarded conversation\'s request must be cancelled, not left to land')
        .toBeTrue();
      expect(component.pending).toBeFalse();
      expect(fixture.debugElement.query(By.css('.pc-pending'))).toBeNull();

      // The server answering anyway cannot reach the transcript: there is no live subscriber left.
      expect(() => req.flush(groundedAnswer({ answer: 'the late answer' })))
        .toThrowError(/cancel/i);

      fixture.detectChanges();
      expect(component.entries.length).toBe(0);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('the late answer');
      expect(fixture.debugElement.query(By.css('.pc-empty'))).not.toBeNull();
    });

    it('a reset mid-flight leaves the surface usable, and the next answer lands normally', () => {
      ask('interrupted');
      http.expectOne('/api/product-chat');
      component.startNewConversation();
      fixture.detectChanges();

      ask('a fresh question');
      const req = http.expectOne('/api/product-chat');
      expect(req.request.body.history).toEqual([]);
      req.flush(groundedAnswer({ answer: 'a fresh answer' }));
      fixture.detectChanges();

      expect(fixture.debugElement.queryAll(By.css('.pc-turn--user')).length).toBe(1);
      expect(fixture.debugElement.query(By.css('.pc-bubble--assistant')).nativeElement.textContent)
        .toContain('a fresh answer');
    });

    it('an armed confirmation stands down when the author leaves the tab', () => {
      // Otherwise it would sit armed behind a closed drawer, and be completed later by a click the
      // author no longer connects to the question.
      exchange('first', 'first answer');
      fixture.debugElement.query(By.css('.pc-new')).nativeElement.click();
      fixture.detectChanges();
      expect(component.confirmingReset).toBeTrue();

      overlays.selectTab('activity');
      fixture.detectChanges();
      overlays.selectTab('assistant');
      fixture.detectChanges();

      expect(component.confirmingReset).toBeFalse();
      expect(fixture.debugElement.query(By.css('.pc-reset-confirm'))).toBeNull();
      expect(fixture.debugElement.query(By.css('.pc-new'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.pc-turn')).length)
        .withContext('leaving the tab disarms the reset, it does not perform it')
        .toBe(2);
    });

    it('sending a new question also disarms it', () => {
      exchange('first', 'first answer');
      fixture.debugElement.query(By.css('.pc-new')).nativeElement.click();
      fixture.detectChanges();
      expect(component.confirmingReset).toBeTrue();

      ask('second');
      expect(component.confirmingReset).toBeFalse();
      http.expectOne('/api/product-chat').flush(groundedAnswer());
    });

    it('renders the reset copy in Hebrew chrome, and implies no saved history', () => {
      exchange('first', 'first answer');
      expect(fixture.debugElement.query(By.css('.pc-new')).nativeElement.textContent.trim())
        .toContain(CHAT_STRINGS_HE['newConversation']);

      fixture.debugElement.query(By.css('.pc-new')).nativeElement.click();
      fixture.detectChanges();

      const bar = fixture.debugElement.query(By.css('.pc-conversation-bar')).nativeElement as HTMLElement;
      expect(bar.textContent).toContain(CHAT_STRINGS_HE['newConversationConfirm']);
      expect(bar.textContent).toContain(CHAT_STRINGS_HE['newConversationConfirmYes']);
      expect(bar.textContent).toContain(CHAT_STRINGS_HE['newConversationCancel']);
      // Still no phase C: the bar clears a conversation, it never offers to keep or reopen one.
      expect(bar.innerHTML).not.toMatch(/quota|token|histor|previous conversation|sav(e|ed)|customi[sz]/i);
    });

    it('renders the same control in ENGLISH chrome (he/en parity on the rendered surface)', () => {
      useEnglish();
      exchange('first', 'first answer');

      expect(fixture.debugElement.query(By.css('.pc-new')).nativeElement.textContent.trim())
        .toContain(CHAT_STRINGS_EN['newConversation']);

      fixture.debugElement.query(By.css('.pc-new')).nativeElement.click();
      fixture.detectChanges();

      const bar = fixture.debugElement.query(By.css('.pc-conversation-bar')).nativeElement as HTMLElement;
      expect(bar.textContent).toContain(CHAT_STRINGS_EN['newConversationConfirm']);
      expect(bar.textContent).toContain(CHAT_STRINGS_EN['newConversationConfirmYes']);
    });
  });

  // ── Direction ───────────────────────────────────────────────────────────────────────────────────

  describe('RTL and LTR', () => {
    it('is Hebrew and RTL by default (app-level chrome convention)', () => {
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('rtl');
      expect(component.label('drawerTitle')).toBe(CHAT_STRINGS_HE['drawerTitle']);
    });

    it('renders English chrome LTR when the app language is English', () => {
      useEnglish();
      expect((fixture.nativeElement as HTMLElement).getAttribute('dir')).toBe('ltr');
      openDrawer();
      expect(fixture.debugElement.query(By.css('.pc-empty-title')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_EN['emptyTitle']);
      expect(fixture.debugElement.query(By.css('.pc-grounding-note')).nativeElement.textContent.trim())
        .toBe(CHAT_STRINGS_EN['groundingNote']);
    });

    // Which physical edge the drawer lands on is no longer decided here: the dock owns the edge, and
    // `shared/app-dock/dock-layout.spec.ts` measures it in both directions.
  });
});
