/**
 * ONE-LINE MOUNTABILITY (Show C2, c2-client).
 *
 * The todo's shape for this widget is that "mounting elsewhere is one line", and a claim like that is
 * worth exactly as much as the test that drives it. So this file mounts the widget on a DUMMY host with a
 * dummy area, target type and target id - values that exist nowhere in this codebase and that name no
 * conversation, no book and no chapter - and drives a complete vote-then-note-then-retract cycle.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THIS TESTBED IS THE ASSERTION. There is no `ProductChatService`, no
 * `ConversationService`, no chat strings, no overlay service and no chat component anywhere in the module
 * below. If the widget ever reached for anything about its first host, this file would fail with a
 * NullInjector naming the thing it reached for - which is the same failure mode that has bitten this
 * repo's specs before, used here on purpose as a detector rather than suffered as a surprise.
 *
 * The three providers that ARE here are the widget's honest requirements and are stated as such:
 * `HttpClient` (it posts), the router (the vote-time context records which route the reader was on), and
 * nothing else. A future host needs those two in its own TestBed and no more.
 */
import { ChangeDetectorRef, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { FeedbackWidgetComponent } from './feedback-widget.component';
import { FeedbackDto } from '../../core/models/feedback';
import { resetInstallationIdCache } from '../../core/services/installation-id';

/** A target type this codebase has never heard of, on an area it does not ship. That is the point. */
const DUMMY_AREA = 'some-future-surface';
const DUMMY_TARGET_TYPE = 'some-future-thing';
const DUMMY_TARGET_ID = '99999999-9999-9999-9999-999999999999';

/**
 * THE ENTIRE MOUNT. One element, three inputs (plus the language every surface pushes down), and no
 * wiring of any kind: no service injected by the host, no output subscribed, no state kept.
 */
@Component({
  standalone: true,
  imports: [FeedbackWidgetComponent],
  template: `
    <app-feedback-widget
      [area]="area"
      [targetType]="targetType"
      [targetId]="targetId"
      [lang]="'en'" />
  `,
})
class DummyHostComponent {
  area = DUMMY_AREA;
  targetType = DUMMY_TARGET_TYPE;
  targetId: string | null = DUMMY_TARGET_ID;
}

describe('FeedbackWidgetComponent, mounted on a dummy target (Show C2)', () => {
  let fixture: ComponentFixture<DummyHostComponent>;
  let host: DummyHostComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    resetInstallationIdCache();
    await TestBed.configureTestingModule({
      imports: [DummyHostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DummyHostComponent);
    host = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function click(testId: string): void {
    fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).nativeElement.click();
    fixture.detectChanges();
  }

  function el(testId: string): HTMLElement | null {
    return fixture.debugElement.query(By.css(`[data-testid="${testId}"]`))?.nativeElement ?? null;
  }

  function row(over: Partial<FeedbackDto> = {}): FeedbackDto {
    return {
      id: 'fb-dummy',
      area: DUMMY_AREA,
      targetType: DUMMY_TARGET_TYPE,
      targetId: DUMMY_TARGET_ID,
      verdict: 'down',
      text: null,
      status: 'New',
      createdAt: '2026-08-17T09:00:00Z',
      statusChangedAt: '2026-08-17T09:00:00Z',
      targetDeletedAt: null,
      context: null,
      ...over,
    };
  }

  it('mounts and renders with nothing but the three inputs', () => {
    expect(el('fw-up')).toBeTruthy();
    expect(el('fw-down')).toBeTruthy();
  });

  it('drives a whole vote on the dummy target, sending the host\'s OWN area and target type', () => {
    click('fw-down');

    const request = http.expectOne(r => r.method === 'POST' && r.url === '/api/feedback');
    // The widget forwarded exactly what it was given. Nothing about chat leaked into the body, and no
    // default overrode the host's values.
    expect(request.request.body.area).toBe(DUMMY_AREA);
    expect(request.request.body.targetType).toBe(DUMMY_TARGET_TYPE);
    expect(request.request.body.targetId).toBe(DUMMY_TARGET_ID);
    expect(request.request.body.verdict).toBe('down');
    // Assembled by the service, not by the host: this is what "it does the rest" buys a new mount.
    expect(typeof request.request.body.installationId).toBe('string');
    expect(request.request.body.context.uiLanguage).toBe('en');

    request.flush(row());
    fixture.detectChanges();
    expect(el('fw-down')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('writes a note and retracts, all on the dummy target', () => {
    click('fw-down');
    http.expectOne(r => r.method === 'POST').flush(row());
    fixture.detectChanges();

    // The note editor opened on the down-vote, exactly as it does on the chat mount.
    expect(el('fw-note')).toBeTruthy();
    const widget = fixture.debugElement.query(By.directive(FeedbackWidgetComponent))
      .componentInstance as FeedbackWidgetComponent;
    widget.noteDraft = 'this surface is wrong about something';
    // The widget is OnPush and `noteDraft` is not an input, so a bare assignment leaves its view
    // unchecked; without the mark the click below would run against stale DOM.
    fixture.debugElement
      .query(By.directive(FeedbackWidgetComponent))
      .injector.get(ChangeDetectorRef)
      .markForCheck();
    fixture.detectChanges();
    click('fw-note-save');
    http.expectOne(r => r.method === 'POST').flush(
      row({ text: 'this surface is wrong about something' })
    );
    fixture.detectChanges();

    click('fw-down');
    http.expectOne(r => r.method === 'DELETE' && r.url === '/api/feedback/fb-dummy')
      .flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(el('fw-down')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders NOTHING when the host has no id, without the host guarding for it', () => {
    // The host's template carries no `@if`. The rule lives in the widget precisely so a new mount cannot
    // forget it, and this is what proves the rule travels with the component rather than with Show.
    host.targetId = null;
    fixture.detectChanges();
    expect(el('fw-up')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fw')).toBeNull();
  });
});
