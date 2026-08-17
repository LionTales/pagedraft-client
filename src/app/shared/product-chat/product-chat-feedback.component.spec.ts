/**
 * ProductChatComponent, MOUNT #1 of the feedback widget (Show C2, c2-client).
 *
 * The widget's own states live in `shared/feedback-widget/`. What this file asserts is the MOUNT: which
 * turns get a widget, which do not, and that the id it anchors to is C1's PERSISTED message id rather
 * than the transcript's local counter.
 *
 * Three rules, and the second and third are the ones a reviewer should read hardest:
 *  - Assistant answers only. The author's own turn never gets one.
 *  - No persisted id, no widget. An answer whose persistence write faulted must render NOTHING rather
 *    than a control whose vote could never be stored.
 *  - A FAILED answer that DID persist gets one. That signal is half the point of C2.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ProductChatComponent } from './product-chat.component';
import { FeedbackWidgetComponent } from '../feedback-widget/feedback-widget.component';
import { AppOverlayService } from '../../core/services/app-overlay.service';
import { ProductChatResponseDto } from '../../core/models/product-chat';
import { ConversationMessageDto } from '../../core/models/conversation';
import { resetInstallationIdCache } from '../../core/services/installation-id';

const MESSAGE_ID = '44444444-4444-4444-4444-444444444444';

function answer(over: Partial<ProductChatResponseDto> = {}): ProductChatResponseDto {
  return {
    answer: 'Import accepts a DOCX file and splits it by Heading 1.',
    guideIds: ['import'],
    language: 'en',
    isGrounded: true,
    faultReason: null,
    conversationId: 'conv-1',
    userMessageId: 'msg-user',
    assistantMessageId: MESSAGE_ID,
    ...over,
  };
}

describe('ProductChatComponent, feedback mount (Show C2)', () => {
  let fixture: ComponentFixture<ProductChatComponent>;
  let component: ProductChatComponent;
  let http: HttpTestingController;
  let overlays: AppOverlayService;

  beforeEach(async () => {
    resetInstallationIdCache();
    await TestBed.configureTestingModule({
      imports: [ProductChatComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductChatComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    overlays = TestBed.inject(AppOverlayService);
    fixture.detectChanges();
    overlays.openTab('assistant');
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function ask(question: string): void {
    component.draft = question;
    fixture.detectChanges();
    fixture.debugElement
      .query(By.css('.pc-composer'))
      .triggerEventHandler('submit', new Event('submit'));
    fixture.detectChanges();
  }

  function reply(body: ProductChatResponseDto): void {
    http.expectOne('/api/product-chat').flush(body);
    fixture.detectChanges();
  }

  function widgets(): FeedbackWidgetComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(FeedbackWidgetComponent))
      .map(node => node.componentInstance as FeedbackWidgetComponent);
  }

  /** Thumbs actually RENDERED, which is the difference between a mounted widget and a visible one. */
  function thumbs(): HTMLElement[] {
    return fixture.debugElement.queryAll(By.css('[data-testid="fw-up"]')).map(n => n.nativeElement);
  }

  it('mounts the widget on an answer that PERSISTED, anchored to the stored message id', () => {
    ask('how does import work?');
    reply(answer());

    expect(thumbs().length).toBe(1);
    const widget = widgets()[0];
    // C1's persisted id, NOT the transcript's local `id` counter - the two are different things and only
    // one of them names a row the server has heard of.
    expect(widget.targetId).toBe(MESSAGE_ID);
    expect(widget.area).toBe('chat-answer');
    expect(widget.targetType).toBe('conversation-message');
  });

  it('renders NOTHING on an answer whose persistence write faulted', () => {
    // C1's contract: the answer stands even when its write faults, and `assistantMessageId` is null. A
    // widget here would offer a vote that could never be stored.
    ask('how does import work?');
    reply(answer({ assistantMessageId: null }));

    expect(fixture.nativeElement.querySelector('.pc-answer')).toBeTruthy();
    expect(thumbs().length).toBe(0);
  });

  it('never mounts one on the AUTHOR\'s own turn', () => {
    ask('how does import work?');
    reply(answer());
    const userTurn = fixture.debugElement.query(By.css('.pc-turn--user'));
    expect(userTurn).toBeTruthy();
    expect(userTurn.query(By.css('[data-testid="fw-up"]'))).toBeNull();
  });

  it('DOES mount one on a FAILED answer that persisted, because that signal is half the point', () => {
    ask('what happens in chapter three?');
    reply(
      answer({
        isGrounded: false,
        faultReason: 'model-unavailable',
        guideIds: [],
        assistantMessageId: MESSAGE_ID,
      })
    );

    expect(fixture.nativeElement.querySelector('.pc-fault')).toBeTruthy();
    expect(thumbs().length).toBe(1);
    expect(widgets()[0].targetId).toBe(MESSAGE_ID);
  });

  it('renders nothing on a NETWORK fault, where no row was ever written', () => {
    ask('what happens in chapter three?');
    http.expectOne('/api/product-chat').error(new ProgressEvent('network'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pc-fault')).toBeTruthy();
    expect(thumbs().length).toBe(0);
  });

  it('drives a real vote from the transcript, against the stored id', () => {
    ask('how does import work?');
    reply(answer());

    thumbs()[0].click();
    fixture.detectChanges();

    const request = http.expectOne(r => r.method === 'POST' && r.url === '/api/feedback');
    expect(request.request.body.targetId).toBe(MESSAGE_ID);
    expect(request.request.body.verdict).toBe('up');
    request.flush({
      id: 'fb-1',
      area: 'chat-answer',
      targetType: 'conversation-message',
      targetId: MESSAGE_ID,
      verdict: 'up',
      text: null,
      status: 'New',
      createdAt: '2026-08-17T09:00:00Z',
      statusChangedAt: '2026-08-17T09:00:00Z',
      targetDeletedAt: null,
      context: null,
    });
    fixture.detectChanges();
    expect(thumbs()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('sends no feedback request of its own on mount, so the drawer costs nothing extra to open', () => {
    // The widget deliberately does not read an existing vote back: the only endpoint that could is
    // flag-gated, and the vote half has to work on a deployment where triage is hidden.
    ask('how does import work?');
    reply(answer());
    http.expectNone(r => r.url.startsWith('/api/feedback'));
  });

  it('carries the stored id onto a RESUMED transcript, so an old conversation still takes feedback', () => {
    const messages: ConversationMessageDto[] = [
      {
        id: 'msg-q',
        sequence: 0,
        role: 'user',
        text: 'how does import work?',
        failed: false,
        createdAt: '2026-08-16T09:00:00Z',
        askBookId: null,
        askChapterId: null,
        askChapterOrder: null,
        grounding: null,
      },
      {
        id: MESSAGE_ID,
        sequence: 1,
        role: 'assistant',
        text: 'Import accepts a DOCX file.',
        failed: false,
        createdAt: '2026-08-16T09:00:01Z',
        askBookId: null,
        askChapterId: null,
        askChapterOrder: null,
        grounding: {
          guideIds: ['import'],
          artifactRefs: [],
          bookFaultReason: null,
          needsChapterClarification: false,
          selectionSummary: null,
        },
      },
    ];

    component.resumeConversation({ id: 'conv-old', messages });
    fixture.detectChanges();

    expect(thumbs().length).toBe(1);
    expect(widgets()[0].targetId).toBe(MESSAGE_ID);
  });
});
