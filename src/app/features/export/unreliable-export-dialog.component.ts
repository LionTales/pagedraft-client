import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { BookProofreadUnreliableChapter } from '../../core/models/book-proofread';
import {
  applyBackgroundInert, containFocusWithin, focusablesWithin,
} from '../../shared/analysis-run-dialog/modal-a11y';
import { ExportLang } from './export-kinds';
import { UNRELIABLE_EXPORT_COPY, UnreliableChoice, unreliableChapterLabel } from './unreliable-export';

/**
 * c8: "some of these proofread results were flagged unreliable" - asked BEFORE an annotated export that
 * would carry them. Three answers: Export everything (primary, default focus, `?unreliable=include`),
 * Skip those chapters (`?unreliable=skip`), Cancel (nothing is downloaded). Esc and a backdrop click are
 * Cancel.
 *
 * ── Reuses the run dialog's modal primitives, not its component ──────────────────────────────────
 * The app's one modal is `AnalysisRunDialogComponent`, a run-specific state machine near the file-size
 * ceiling. What is reusable about it is `modal-a11y.ts`, and this dialog uses all three of its layers the
 * same way: `applyBackgroundInert` and `containFocusWithin` anchored on the HOST (so the scrim, a sibling
 * of the card inside the host, is never marked inert), and a Tab / Shift+Tab cycle over
 * `focusablesWithin` the card. Release order is the run dialog's: containment first, then inert, then
 * focus goes back to what held it (the download button), only if focus is still ours.
 *
 * The host mounts it with `@if` while the question is open, so engage = `ngAfterViewInit` and release =
 * `ngOnDestroy`: there is no open/closed input to reconcile.
 *
 * ── RTL ───────────────────────────────────────────────────────────────────────────────────────────
 * `[dir]` follows the BOOK language like the rest of the export page. Each chapter line is a `<bdi>`, so
 * a Hebrew title inside an English dialog (or the reverse) cannot reorder the number beside it.
 */
@Component({
  selector: 'app-unreliable-export-dialog',
  standalone: true,
  template: `
    <div class="ued-backdrop" aria-hidden="true" (click)="pick('cancel')"></div>
    <div class="ued-overlay">
      <div
        #card
        class="ued-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ued-title"
        aria-describedby="ued-body"
        [attr.dir]="dir"
        data-testid="unreliable-export-dialog"
        (keydown.escape)="onEscape($event)"
        (keydown.tab)="onTab($event, false)"
        (keydown.shift.tab)="onTab($event, true)">
        <h3 id="ued-title" class="ued-title">{{ copy.title[lang] }}</h3>
        <p id="ued-body" class="ued-body" data-testid="unreliable-export-body">{{ body }}</p>
        <ul class="ued-list" data-testid="unreliable-export-chapters">
          @for (chapter of chapters; track chapter.chapterId) {
            <li><bdi>{{ label(chapter) }}</bdi></li>
          }
        </ul>
        <p class="ued-hint" data-testid="unreliable-export-hint">{{ skipHint }}</p>
        <div class="ued-actions">
          <button
            #primary
            type="button"
            class="pd-btn pd-btn-primary"
            data-testid="unreliable-export-include"
            (click)="pick('include')">{{ copy.exportAll[lang] }}</button>
          <button
            type="button"
            class="pd-btn pd-btn-ghost"
            data-testid="unreliable-export-skip"
            (click)="pick('skip')">{{ skipLabel }}</button>
          <button
            type="button"
            class="pd-btn pd-btn-ghost"
            data-testid="unreliable-export-cancel"
            (click)="pick('cancel')">{{ copy.cancel[lang] }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .ued-backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--pd-z-dialog);
      background: rgba(20, 24, 29, 0.32);
      -webkit-backdrop-filter: blur(3px);
      backdrop-filter: blur(3px);
    }
    @supports not ((backdrop-filter: blur(3px)) or (-webkit-backdrop-filter: blur(3px))) {
      .ued-backdrop { background: rgba(20, 24, 29, 0.58); }
    }
    /* The centring container never eats clicks: the scrim owns "outside", the card owns "inside". */
    .ued-overlay {
      position: fixed;
      inset: 0;
      z-index: calc(var(--pd-z-dialog) + 1);
      display: grid;
      place-items: center;
      padding: var(--pd-space-4);
      box-sizing: border-box;
      pointer-events: none;
    }
    .ued-card {
      pointer-events: auto;
      inline-size: min(480px, 100%);
      max-block-size: calc(100dvh - (2 * var(--pd-space-4)));
      overflow-y: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
      padding: var(--pd-space-5);
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-lg);
      box-shadow: var(--pd-shadow-4);
      font-family: var(--pd-font-ui);
      color: var(--pd-text);
      text-align: start;
    }
    .ued-title { margin: 0; font-size: var(--pd-text-body); font-weight: var(--pd-weight-bold); }
    .ued-body, .ued-hint { margin: 0; font-size: var(--pd-text-body-sm); overflow-wrap: break-word; }
    .ued-hint { color: var(--pd-text-secondary); }
    .ued-list {
      margin: 0;
      padding-inline-start: var(--pd-space-5);
      font-size: var(--pd-text-body-sm);
      font-weight: var(--pd-weight-semibold);
      overflow-wrap: anywhere;
    }
    .ued-actions {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--pd-space-2);
      margin-block-start: var(--pd-space-2);
    }
    .ued-actions .pd-btn { white-space: normal; }
  `],
})
export class UnreliableExportDialogComponent implements AfterViewInit, OnDestroy {
  /** The export page's language (the BOOK language). */
  @Input() lang: ExportLang = 'he';
  /** The flagged chapters this export would carry; never empty when mounted. */
  @Input() chapters: BookProofreadUnreliableChapter[] = [];
  /** The author's answer. Emitted once per click; the host unmounts the dialog on any answer. */
  @Output() choose = new EventEmitter<UnreliableChoice>();

  @ViewChild('card') private cardRef?: ElementRef<HTMLElement>;
  @ViewChild('primary') private primaryRef?: ElementRef<HTMLButtonElement>;

  readonly copy = UNRELIABLE_EXPORT_COPY;

  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly doc = inject(DOCUMENT);
  private previouslyFocused: HTMLElement | null = null;
  private releaseInert: (() => void) | null = null;
  private releaseFocusContainment: (() => void) | null = null;

  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  private get one(): boolean {
    return this.chapters.length === 1;
  }

  get body(): string {
    return (this.one ? this.copy.bodyOne : this.copy.bodyMany)[this.lang];
  }

  get skipHint(): string {
    return (this.one ? this.copy.skipHintOne : this.copy.skipHintMany)[this.lang];
  }

  get skipLabel(): string {
    return (this.one ? this.copy.skipOne : this.copy.skipMany)[this.lang];
  }

  label(chapter: BookProofreadUnreliableChapter): string {
    return unreliableChapterLabel(chapter, this.lang);
  }

  pick(choice: UnreliableChoice): void {
    this.choose.emit(choice);
  }

  onEscape(event: Event): void {
    event.preventDefault();
    this.pick('cancel');
  }

  /** Keep Tab inside the card and make it wrap, as the run dialog does. */
  onTab(event: Event, backwards: boolean): void {
    const card = this.cardRef?.nativeElement;
    if (!card) return;
    const focusables = focusablesWithin(card);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.doc.activeElement;
    const inside = active instanceof HTMLElement && card.contains(active);
    if (backwards ? (!inside || active === first) : (!inside || active === last)) {
      event.preventDefault();
      (backwards ? last : first).focus();
    }
  }

  ngAfterViewInit(): void {
    const active = this.doc.activeElement;
    this.previouslyFocused = active instanceof HTMLElement ? active : null;
    const host = this.hostRef.nativeElement as HTMLElement;
    this.releaseInert = applyBackgroundInert(host, this.doc);
    this.releaseFocusContainment = containFocusWithin(host, () => this.primaryRef?.nativeElement ?? null, this.doc);
    // Default focus on the PRIMARY action (Export everything), per the owner's decision.
    this.primaryRef?.nativeElement.focus({ preventScroll: true });
  }

  ngOnDestroy(): void {
    // Containment FIRST, so the restore below is not pulled back by our own listener (modal-a11y.ts).
    this.releaseFocusContainment?.();
    this.releaseFocusContainment = null;
    this.releaseInert?.();
    this.releaseInert = null;
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (!target || !target.isConnected) return;
    const active = this.doc.activeElement;
    const host = this.hostRef.nativeElement as HTMLElement;
    const focusIsOurs = !active || active === this.doc.body || host.contains(active);
    if (focusIsOurs) target.focus({ preventScroll: true });
  }
}
