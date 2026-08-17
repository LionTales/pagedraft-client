/**
 * ConversationHistoryComponent: the rendered history list (Show C1, c2).
 *
 * Covers what the todo names for this surface: the list itself (title, relative time, book badge when
 * book-scoped, newest first, paged), the book filter, rename, delete with confirm, and RTL/LTR chrome.
 * The RESUME half is only half-covered here - this file proves the panel loads a whole transcript and
 * emits it; what that transcript then does to the resend window is proved on the wire in
 * `product-chat-history.component.spec.ts`, which is the only place it is observable.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ConversationHistoryComponent, ConversationResume } from './conversation-history.component';
import { ConversationService } from '../../core/services/conversation.service';
import {
  ConversationListDto,
  ConversationListItemDto,
  ConversationMessageDto,
} from '../../core/models/conversation';
import { HISTORY_STRINGS_EN, HISTORY_STRINGS_HE } from '../../core/i18n/history-strings';

const BOOK_A = 'b1e7c0de-0000-4000-8000-00000000000a';
const BOOK_B = 'b1e7c0de-0000-4000-8000-00000000000b';

function row(over: Partial<ConversationListItemDto> = {}): ConversationListItemDto {
  return {
    id: 'c-1',
    title: 'How do I import a manuscript?',
    bookId: null,
    createdAt: '2026-08-16T09:00:00Z',
    updatedAt: new Date().toISOString(),
    messageCount: 4,
    ...over,
  };
}

function list(items: ConversationListItemDto[], over: Partial<ConversationListDto> = {}): ConversationListDto {
  return {
    items,
    page: 1,
    pageSize: ConversationService.ListPageSize,
    totalCount: items.length,
    nearCapWarning: false,
    ...over,
  };
}

function message(sequence: number): ConversationMessageDto {
  return {
    id: `m-${sequence}`,
    sequence,
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    text: `turn-${sequence}`,
    failed: false,
    createdAt: '2026-08-16T10:00:00Z',
    askBookId: null,
    askChapterId: null,
    askChapterOrder: null,
    grounding: null,
  };
}

describe('ConversationHistoryComponent (Show C1)', () => {
  let fixture: ComponentFixture<ConversationHistoryComponent>;
  let component: ConversationHistoryComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ConversationHistoryComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Mount and answer the list read the panel makes on arrival. */
  function open(items: ConversationListItemDto[], over: Partial<ConversationListDto> = {}): void {
    fixture.detectChanges();
    http.expectOne(r => r.url === '/api/conversations').flush(list(items, over));
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function click(testid: string, index = 0): void {
    const nodes = fixture.debugElement.queryAll(By.css(`[data-testid="${testid}"]`));
    (nodes[index].nativeElement as HTMLElement).click();
    fixture.detectChanges();
  }

  // ── The list ────────────────────────────────────────────────────────────────────────────────────

  describe('the list', () => {
    it('reads the list on arrival and renders one row per conversation', () => {
      open([row({ id: 'c-1', title: 'First' }), row({ id: 'c-2', title: 'Second' })]);

      const rows = fixture.debugElement.queryAll(By.css('.ch-item'));
      expect(rows.length).toBe(2);
      expect(text()).toContain('First');
      expect(text()).toContain('Second');
    });

    it('renders the rows in the ORDER the server returned them (newest first is the server\'s job)', () => {
      // The server orders by `updatedAt` descending. Re-sorting here would be a second ordering rule
      // that a paged list cannot even apply correctly, since it only ever sees one page.
      open([row({ id: 'c-1', title: 'Newest' }), row({ id: 'c-2', title: 'Older' })]);
      const titles = fixture.debugElement
        .queryAll(By.css('.ch-item-title'))
        .map(n => (n.nativeElement as HTMLElement).textContent?.trim());
      expect(titles).toEqual(['Newest', 'Older']);
    });

    it('states each row\'s time RELATIVELY, never as a raw ISO timestamp', () => {
      // The page conventions forbid the raw date pipe; the shared timezone-aware helper is what every
      // other surface in this app uses.
      open([row({ updatedAt: new Date().toISOString() })]);
      const time = fixture.debugElement.query(By.css('.ch-item-time')).nativeElement as HTMLElement;
      expect(time.textContent?.trim().length).toBeGreaterThan(0);
      expect(time.textContent).not.toContain('T');
      expect(time.textContent).not.toContain('Z');
    });

    it('states how much is in each conversation, from the cheap projection', () => {
      open([row({ messageCount: 6 })]);
      expect(text()).toContain(HISTORY_STRINGS_HE['historyMessages'].replace('{0}', '6'));
    });

    it('shows the loading state before the list lands, and drops it after', () => {
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="ch-loading"]'))).not.toBeNull();

      http.expectOne(r => r.url === '/api/conversations').flush(list([row()]));
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="ch-loading"]'))).toBeNull();
    });

    it('states an honest failure with a retry, rather than an empty list', () => {
      // An empty list and an unreachable server are different facts, and only one of them means the
      // author has no conversations. Rendering the failure as emptiness would tell them their notebook
      // is gone.
      fixture.detectChanges();
      http.expectOne(r => r.url === '/api/conversations').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('[data-testid="ch-load-error"]'))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('[data-testid="ch-empty"]'))).toBeNull();

      // The retry button inside it re-reads.
      fixture.debugElement.query(By.css('.ch-retry')).nativeElement.click();
      fixture.detectChanges();
      http.expectOne(r => r.url === '/api/conversations').flush(list([row()]));
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('[data-testid="ch-load-error"]'))).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);
    });

    it('says so when there is genuinely nothing stored', () => {
      open([]);
      expect(fixture.debugElement.query(By.css('[data-testid="ch-empty"]'))).not.toBeNull();
      expect(text()).toContain(HISTORY_STRINGS_HE['historyEmpty']);
    });

    it('surfaces the soft cap as a note, never as a threat to delete anything', () => {
      open([row()], { nearCapWarning: true });
      expect(fixture.debugElement.query(By.css('[data-testid="ch-near-cap"]'))).not.toBeNull();
    });
  });

  // ── The row's accessible name ───────────────────────────────────────────────────────────────────

  describe("a row's accessible name", () => {
    /**
     * MECHANISM PROXY: Karma/JSDOM-free ChromeHeadless computes layout but this spec does not compute
     * the browser's real accessible-name algorithm, so it asserts the MECHANISM instead of the
     * announced string - `.ch-open` carries no `aria-label` (an `aria-label` REPLACES the name computed
     * from a button's contents rather than adding to it, which is exactly the defect this pins), and
     * each row's own title text is present inside the button, ahead of the row's own verb span. The
     * real accessible name - that two different rows announce two different names, each containing its
     * title - was read off the live DOM in a browser (Chrome DevTools MCP), not from this suite.
     */
    it('carries no name-replacing aria-label, and each row\'s own title is inside its open button', () => {
      open([row({ id: 'c-1', title: 'First conversation' }), row({ id: 'c-2', title: 'Second conversation' })]);

      const buttons = fixture.debugElement.queryAll(By.css('.ch-open'));
      expect(buttons.length).toBe(2);

      const titles = ['First conversation', 'Second conversation'];
      buttons.forEach((btn, i) => {
        const el = btn.nativeElement as HTMLElement;
        expect(el.getAttribute('aria-label'))
          .withContext('an aria-label on .ch-open replaces its computed accessible name, discarding the title')
          .toBeNull();
        expect(el.textContent).toContain(titles[i]);
      });
    });

    it('places the verb span BEFORE the title, so it precedes rather than replaces it in reading order', () => {
      open([row({ id: 'c-1', title: 'A distinctive title' })]);

      const btn = fixture.debugElement.query(By.css('.ch-open')).nativeElement as HTMLElement;
      const verb = HISTORY_STRINGS_HE['historyOpenItem'];
      const text = btn.textContent ?? '';
      expect(text.indexOf(verb))
        .withContext('the verb must be present')
        .toBeGreaterThan(-1);
      expect(text.indexOf(verb))
        .withContext('the verb must precede the title, not replace it')
        .toBeLessThan(text.indexOf('A distinctive title'));
    });
  });

  // ── The book badge ──────────────────────────────────────────────────────────────────────────────

  describe('the book badge', () => {
    it('names the OPEN book on a conversation held inside it', () => {
      component.currentBookId = BOOK_A;
      component.currentBookTitle = 'A Study in Drafts';
      open([row({ bookId: BOOK_A })]);

      const badge = fixture.debugElement.query(By.css('[data-testid="ch-book-badge"]'));
      expect(badge).not.toBeNull();
      expect((badge.nativeElement as HTMLElement).textContent).toContain('A Study in Drafts');
    });

    it('is ABSENT on an app-level conversation', () => {
      // v1 checks this by hand. A product question asked outside any book is the ordinary state of this
      // assistant, and a badge saying "no book" would turn it into a remark.
      component.currentBookId = BOOK_A;
      component.currentBookTitle = 'A Study in Drafts';
      open([row({ bookId: null })]);
      expect(fixture.debugElement.query(By.css('[data-testid="ch-book-badge"]'))).toBeNull();
    });

    it('uses the generic phrase for a book that is not the open one, never a raw id', () => {
      component.currentBookId = BOOK_A;
      component.currentBookTitle = 'A Study in Drafts';
      open([row({ bookId: BOOK_B })]);

      const badge = fixture.debugElement.query(By.css('[data-testid="ch-book-badge"]'))
        .nativeElement as HTMLElement;
      expect(badge.textContent).toContain(HISTORY_STRINGS_HE['historyBookBadge']);
      expect(badge.textContent).not.toContain(BOOK_B);
    });
  });

  // ── The book filter ─────────────────────────────────────────────────────────────────────────────

  describe('the book filter', () => {
    it('is not offered outside a book: there is nothing to filter to', () => {
      component.currentBookId = null;
      open([row()]);
      expect(fixture.debugElement.query(By.css('[data-testid="ch-filter-book"]'))).toBeNull();
    });

    it('opens on ALL conversations, so nothing is hidden behind a control the author did not set', () => {
      // "My conversations are gone" is the worst first impression a history feature can make, and a
      // pre-set filter is the cheapest way to produce it.
      component.currentBookId = BOOK_A;
      fixture.detectChanges();
      const req = http.expectOne(r => r.url === '/api/conversations');
      expect(req.request.params.has('bookId')).toBeFalse();
      req.flush(list([row()]));
      fixture.detectChanges();
      expect(component.bookOnly).toBeFalse();
    });

    it('re-reads scoped to the book when the filter is turned on, and back when turned off', () => {
      component.currentBookId = BOOK_A;
      open([row({ id: 'c-1' }), row({ id: 'c-2', bookId: BOOK_A })]);

      click('ch-filter-book');
      const scoped = http.expectOne(r => r.url === '/api/conversations');
      expect(scoped.request.params.get('bookId')).toBe(BOOK_A);
      scoped.flush(list([row({ id: 'c-2', bookId: BOOK_A })]));
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);

      click('ch-filter-all');
      const all = http.expectOne(r => r.url === '/api/conversations');
      expect(all.request.params.has('bookId')).toBeFalse();
      all.flush(list([row({ id: 'c-1' }), row({ id: 'c-2', bookId: BOOK_A })]));
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(2);
    });

    it('says something DIFFERENT when the filtered list is empty than when nothing is stored', () => {
      component.currentBookId = BOOK_A;
      open([row()]);

      click('ch-filter-book');
      http.expectOne(r => r.url === '/api/conversations').flush(list([]));
      fixture.detectChanges();

      expect(text()).toContain(HISTORY_STRINGS_HE['historyEmptyBook']);
      expect(text()).not.toContain(HISTORY_STRINGS_HE['historyEmpty']);
    });

    it('does NOT re-read on a book change while the filter is off', () => {
      // With the filter off the list is book-independent, so a reload would be a request that returns
      // the same rows. `http.verify()` in the afterEach is what fails if one was made.
      open([row()]);
      component.currentBookId = BOOK_B;
      component.ngOnChanges({
        currentBookId: { currentValue: BOOK_B, previousValue: null, firstChange: false, isFirstChange: () => false },
      });
      fixture.detectChanges();
    });
  });

  // ── Paging ──────────────────────────────────────────────────────────────────────────────────────

  describe('paging', () => {
    it('offers no pager when everything fits on one page', () => {
      open([row()], { totalCount: 1, pageSize: 20 });
      expect(fixture.debugElement.query(By.css('[data-testid="ch-pager"]'))).toBeNull();
    });

    it('steps to older conversations and back to newer ones', () => {
      open([row({ id: 'c-1' })], { page: 1, pageSize: 1, totalCount: 3 });
      expect(fixture.debugElement.query(By.css('[data-testid="ch-pager"]'))).not.toBeNull();

      click('ch-older');
      const second = http.expectOne(r => r.url === '/api/conversations');
      expect(second.request.params.get('page')).toBe('2');
      second.flush(list([row({ id: 'c-2' })], { page: 2, pageSize: 1, totalCount: 3 }));
      fixture.detectChanges();

      click('ch-newer');
      const first = http.expectOne(r => r.url === '/api/conversations');
      expect(first.request.params.get('page')).toBe('1');
      first.flush(list([row({ id: 'c-1' })], { page: 1, pageSize: 1, totalCount: 3 }));
      fixture.detectChanges();
      expect(component.page).toBe(1);
    });

    /**
     * TWO PAGE STEPS ONE PRESS APART, with the first read deliberately left in flight across the
     * second.
     *
     * The window is held open by NOT flushing: a synchronous `of()` would resolve the first read before
     * the second press exists, which is the one ordering in which the defect cannot happen. `load()`'s
     * handler re-reads `page` out of the response, so an un-superseded first read landing second does
     * not error - it silently rewinds the list to the page the author already left.
     */
    it('a SUPERSEDED page read cannot rewind the list to the page the author stepped off', () => {
      open([row({ id: 'c-1' })], { page: 1, pageSize: 1, totalCount: 3 });

      click('ch-older');
      const slow = http.expectOne(r => r.url === '/api/conversations');
      expect(slow.request.params.get('page')).toBe('2');

      click('ch-older');
      const fast = http.expectOne(r => r.url === '/api/conversations');
      expect(fast.request.params.get('page'))
        .withContext('the second press must have issued its own read, or this case asserts nothing')
        .toBe('3');

      fast.flush(
        list([row({ id: 'c-3', title: 'the page the author asked for' })],
          { page: 3, pageSize: 1, totalCount: 3 })
      );
      fixture.detectChanges();

      // Deliver the superseded answer LAST, which is the ordering the defect needs. A cancelled request
      // refuses delivery outright, which is the fix working rather than a test skipping a step.
      let deliveredLate = false;
      try {
        slow.flush(
          list([row({ id: 'c-2', title: 'the page the author left' })],
            { page: 2, pageSize: 1, totalCount: 3 })
        );
        deliveredLate = true;
      } catch {
        deliveredLate = false;
      }
      fixture.detectChanges();

      expect(component.page)
        .withContext('a superseded list read rewound the page the author had already stepped past')
        .toBe(3);
      expect(text()).toContain('the page the author asked for');
      expect(text()).not.toContain('the page the author left');
      expect(deliveredLate)
        .withContext('the superseded read was still subscribed, so its answer had somewhere to land')
        .toBeFalse();
    });

    it('does not strand the LOADING state on the read it dropped', () => {
      // The latch's one direction: `loading` means a list read is in flight, so a read that is dropped
      // has to lower it rather than leaving the spinner to the handlers of a request that will never
      // run. A restraint case - it passes against the un-superseded code too, and is here as the floor
      // the supersession must not break.
      open([row({ id: 'c-1' })], { page: 1, pageSize: 1, totalCount: 3 });

      click('ch-older');
      http.expectOne(r => r.url === '/api/conversations');
      click('ch-older');
      const surviving = http.expectOne(r => r.url === '/api/conversations');

      expect(component.loading)
        .withContext('a read IS in flight while the surviving request is unanswered')
        .toBeTrue();
      surviving.flush(list([row({ id: 'c-3' })], { page: 3, pageSize: 1, totalCount: 3 }));
      fixture.detectChanges();

      expect(component.loading).toBeFalse();
      expect(fixture.debugElement.query(By.css('[data-testid="ch-loading"]'))).toBeNull();
    });
  });

  // ── Opening one ─────────────────────────────────────────────────────────────────────────────────

  describe('opening a conversation', () => {
    it('loads the WHOLE transcript and emits it with the id', () => {
      let emitted: ConversationResume | undefined;
      component.resume.subscribe(e => (emitted = e));
      open([row({ id: 'c-7' })]);

      click('ch-open');
      http.expectOne(r => r.url === '/api/conversations/c-7/messages')
        .flush({ items: [message(0), message(1)], page: 1, pageSize: 500, totalCount: 2 });
      fixture.detectChanges();

      expect(emitted?.id).toBe('c-7');
      expect(emitted?.messages.length).toBe(2);
    });

    it('STAYS OPEN and says so when the transcript cannot be read', () => {
      // Closing onto an unchanged transcript would look like the resume had worked and produced the
      // conversation the author was already looking at.
      let emitted = false;
      component.resume.subscribe(() => (emitted = true));
      open([row({ id: 'c-7' })]);

      click('ch-open');
      http.expectOne(r => r.url === '/api/conversations/c-7/messages')
        .error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(emitted).toBeFalse();
      expect(fixture.debugElement.query(By.css('[data-testid="ch-resume-error"]'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);
    });

    it('marks the conversation already on screen rather than offering to reopen it silently', () => {
      component.activeConversationId = 'c-1';
      open([row({ id: 'c-1' }), row({ id: 'c-2' })]);
      expect(fixture.debugElement.queryAll(By.css('[data-testid="ch-current-badge"]')).length).toBe(1);
    });

    it('REFUSES to reopen the row already on screen: the button is disabled and the click is a no-op', () => {
      // The badge alone is informational; the current row must also refuse the resume it advertises as
      // "not on offer" - re-fetching and re-hydrating a transcript already on screen is a wasted round
      // trip that would also discard any answer still in flight.
      let emitted = false;
      component.resume.subscribe(() => (emitted = true));
      component.activeConversationId = 'c-1';
      open([row({ id: 'c-1' }), row({ id: 'c-2' })]);

      const buttons = fixture.debugElement.queryAll(By.css('.ch-open'));
      const currentButton = buttons[0].nativeElement as HTMLButtonElement;
      expect(currentButton.disabled)
        .withContext('the current row\'s open button must be disabled, not merely badged')
        .toBeTrue();

      currentButton.click();
      fixture.detectChanges();

      expect(emitted)
        .withContext('opening the row already on screen must not emit a resume')
        .toBeFalse();
      // No /messages request was made either: `http.verify()` in the afterEach fails if one was.
    });
  });

  // ── Rename ──────────────────────────────────────────────────────────────────────────────────────

  describe('rename', () => {
    it('PATCHes the new title and shows it back on the row', () => {
      open([row({ id: 'c-1', title: 'Old name' })]);

      click('ch-rename');
      component.renameDraft = 'The export question';
      fixture.detectChanges();
      click('ch-rename-save');

      const req = http.expectOne('/api/conversations/c-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'The export question' });
      req.flush({
        id: 'c-1', title: 'The export question', bookId: null,
        createdAt: '', updatedAt: '', messageCount: 4,
      });
      fixture.detectChanges();

      expect(text()).toContain('The export question');
      expect(text()).not.toContain('Old name');
      expect(fixture.debugElement.query(By.css('[data-testid="ch-rename-input"]'))).toBeNull();
    });

    it('refuses a blank name at the field, without spending a request on it', () => {
      open([row({ id: 'c-1' })]);
      click('ch-rename');
      component.renameDraft = '   ';
      fixture.detectChanges();
      click('ch-rename-save');

      expect(fixture.debugElement.query(By.css('[data-testid="ch-rename-blank"]'))).not.toBeNull();
      // No request: `http.verify()` in the afterEach fails if one was made.
    });

    it('KEEPS what the author typed when the save fails, so retrying is not retyping', () => {
      open([row({ id: 'c-1' })]);
      click('ch-rename');
      component.renameDraft = 'A name worth keeping';
      fixture.detectChanges();
      click('ch-rename-save');

      http.expectOne('/api/conversations/c-1').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('[data-testid="ch-rename-error"]'))).not.toBeNull();
      expect(component.renameDraft).toBe('A name worth keeping');
      expect(fixture.debugElement.query(By.css('[data-testid="ch-rename-input"]'))).not.toBeNull();
    });

    it('a RE-ENTERED save sends ONE patch, not one per press', () => {
      // Save is reachable by Enter as well as by the button, so a second press is a keystroke away. The
      // PATCH is held unflushed across the second press, which is the only window in which the defect
      // exists.
      open([row({ id: 'c-1', title: 'Old name' })]);
      click('ch-rename');
      component.renameDraft = 'The export question';
      fixture.detectChanges();

      click('ch-rename-save');
      component.saveRename(row({ id: 'c-1' }));
      fixture.detectChanges();

      const sent = http.match('/api/conversations/c-1');
      expect(sent.length)
        .withContext('a re-entered save issued a second PATCH of the same title')
        .toBe(1);
      const save = fixture.debugElement.query(By.css('[data-testid="ch-rename-save"]'))
        .nativeElement as HTMLButtonElement;
      expect(save.disabled)
        .withContext('the save button stayed pressable while its own PATCH was in flight')
        .toBeTrue();

      sent[0].flush({
        id: 'c-1', title: 'The export question', bookId: null,
        createdAt: '', updatedAt: '', messageCount: 4,
      });
      fixture.detectChanges();
      expect(text()).toContain('The export question');
    });

    it('lets the author save AGAIN after a failed save, so the guard is not a lock', () => {
      open([row({ id: 'c-1', title: 'Old name' })]);
      click('ch-rename');
      component.renameDraft = 'A name worth keeping';
      fixture.detectChanges();

      click('ch-rename-save');
      http.expectOne('/api/conversations/c-1').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      click('ch-rename-save');
      const retry = http.expectOne('/api/conversations/c-1');
      expect(retry.request.body).toEqual({ title: 'A name worth keeping' });
      retry.flush({
        id: 'c-1', title: 'A name worth keeping', bookId: null,
        createdAt: '', updatedAt: '', messageCount: 4,
      });
      fixture.detectChanges();
      expect(text()).toContain('A name worth keeping');
    });

    it('cancel leaves the title alone', () => {
      open([row({ id: 'c-1', title: 'Old name' })]);
      click('ch-rename');
      component.renameDraft = 'discarded';
      fixture.detectChanges();
      click('ch-rename-cancel');

      expect(text()).toContain('Old name');
      expect(fixture.debugElement.query(By.css('[data-testid="ch-rename-input"]'))).toBeNull();
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('the FIRST click removes nothing: it arms a confirmation, and cancel stands down', () => {
      open([row({ id: 'c-1' })]);

      click('ch-delete');
      expect(fixture.debugElement.query(By.css('[data-testid="ch-delete-yes"]'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);

      click('ch-delete-no');
      expect(fixture.debugElement.query(By.css('[data-testid="ch-delete-yes"]'))).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);
      // No request was made by either click.
    });

    it('the SECOND click deletes it, drops the row, and tells the drawer which id went', () => {
      const gone: string[] = [];
      component.deleted.subscribe(id => gone.push(id));
      open([row({ id: 'c-1' }), row({ id: 'c-2' })], { totalCount: 2 });

      click('ch-delete');
      click('ch-delete-yes');
      http.expectOne('/api/conversations/c-1').flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);
      expect(gone).toEqual(['c-1']);
    });

    it('arms ONE row at a time, so there is never a second armed delete to mis-click', () => {
      open([row({ id: 'c-1' }), row({ id: 'c-2' })]);
      click('ch-delete', 0);
      click('ch-delete', 0); // the first row is now confirming, so index 0 is the SECOND row's button
      expect(fixture.debugElement.queryAll(By.css('[data-testid="ch-delete-yes"]')).length).toBe(1);
      click('ch-delete-no');
    });

    it('a RE-ENTERED confirm sends ONE delete, so nothing can 404 on a delete that worked', () => {
      // The armed confirmation stays on screen until the response lands, so `confirmingDeleteId` alone
      // lets a double press through. The DELETE is held unflushed across the second press: the second
      // request would answer 404 for a row the first one removed, and the panel would report a failure
      // on a delete that succeeded.
      open([row({ id: 'c-1' }), row({ id: 'c-2' })], { totalCount: 2 });

      click('ch-delete');
      click('ch-delete-yes');
      component.confirmDelete(row({ id: 'c-1' }));
      fixture.detectChanges();

      const sent = http.match('/api/conversations/c-1');
      expect(sent.length)
        .withContext('a re-entered confirm issued a second DELETE for a conversation already going')
        .toBe(1);
      const yes = fixture.debugElement.query(By.css('[data-testid="ch-delete-yes"]'))
        .nativeElement as HTMLButtonElement;
      expect(yes.disabled)
        .withContext('the armed confirm stayed pressable while its own DELETE was in flight')
        .toBeTrue();

      sent[0].flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);
      expect(fixture.debugElement.query(By.css('[data-testid="ch-delete-error"]')))
        .withContext('a delete that removed the row was reported to the author as a failure')
        .toBeNull();
    });

    it('states a failed delete rather than pretending the row went', () => {
      open([row({ id: 'c-1' })]);
      click('ch-delete');
      click('ch-delete-yes');
      http.expectOne('/api/conversations/c-1').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('[data-testid="ch-delete-error"]'))).not.toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(1);

      // And the row can be deleted again: the in-flight guard is lowered on the failure arm too, so a
      // transport failure does not leave the delete permanently refused.
      click('ch-delete');
      click('ch-delete-yes');
      http.expectOne('/api/conversations/c-1').flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(0);
    });

    it('reloads a FULL page that still has a next page to pull from, not just the empty-page step-back', () => {
      // page 1 is FULL (2 rows, pageSize 2) with two more rows waiting past it (totalCount 4, so page 2
      // exists). Deleting one row leaves this page non-empty (1 row) so the step-back branch does not
      // fire - but the row that should shift up from page 2 must still be pulled in: after the
      // decrement totalCount is 3, and page * pageSize (1 * 2 = 2) is still less than that.
      open([row({ id: 'c-1' }), row({ id: 'c-2' })], { page: 1, pageSize: 2, totalCount: 4 });

      click('ch-delete');
      click('ch-delete-yes');
      http.expectOne('/api/conversations/c-1').flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      // A second LIST request was issued to pull in the row that should shift up from page 2 - the
      // panel must not be left showing pageSize - 1 rows until something else triggers a load.
      const reload = http.expectOne(r => r.url === '/api/conversations');
      reload.flush(
        list([row({ id: 'c-2' }), row({ id: 'c-3' })], { page: 1, pageSize: 2, totalCount: 3 })
      );
      fixture.detectChanges();

      expect(fixture.debugElement.queryAll(By.css('.ch-item')).length).toBe(2);
    });
  });

  // ── Direction ───────────────────────────────────────────────────────────────────────────────────

  describe('RTL and LTR', () => {
    it('renders Hebrew chrome by default (app-level chrome convention)', () => {
      open([row()]);
      expect(fixture.debugElement.query(By.css('.ch-title')).nativeElement.textContent.trim())
        .toBe(HISTORY_STRINGS_HE['historyTitle']);
    });

    it('renders English chrome when the drawer pushes English down', () => {
      component.lang = 'en';
      open([row()]);
      expect(fixture.debugElement.query(By.css('.ch-title')).nativeElement.textContent.trim())
        .toBe(HISTORY_STRINGS_EN['historyTitle']);
      expect(text()).toContain(HISTORY_STRINGS_EN['historyRename']);
      expect(text()).toContain(HISTORY_STRINGS_EN['historyDelete']);
    });

    it('names the pager by WORDS, not by an arrow that would mean the opposite in RTL', () => {
      open([row()], { page: 1, pageSize: 1, totalCount: 3 });
      const pager = fixture.debugElement.query(By.css('[data-testid="ch-pager"]')).nativeElement as HTMLElement;
      expect(pager.textContent).toContain(HISTORY_STRINGS_HE['historyOlder']);
      expect(pager.textContent).toContain(HISTORY_STRINGS_HE['historyNewer']);
      expect(pager.textContent).not.toMatch(/[<>←→]/);
    });
  });
});
