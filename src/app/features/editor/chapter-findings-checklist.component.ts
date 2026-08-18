import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { BookFinding, FindingStatus } from '../../core/models/book-review';
import { BookReviewService } from '../../core/services/book-review.service';
import { ReviseContext, ReviseContextService } from '../../core/services/revise-context.service';
import { truncateOneLiner } from '../book-dashboard/book-review-findings.component';

/**
 * rf-f05: ChapterFindingsChecklistComponent — the Edit-mode Assess->Revise loop bridge.
 *
 * Renders two advisory surfaces in the Edit-help panel when a chapter is open:
 *
 *  (A) CONTEXT CHIP: when ReviseContextService.currentlyAddressing$ holds a context that
 *      matches the current chapter, show "Addressing: <one-liner>" with a "back to findings"
 *      link that switches to Review mode and clears the context. NON-BLOCKING: dismissible,
 *      never gates editing.
 *
 *  (B) PER-CHAPTER FINDINGS CHECKLIST: lists developmental findings whose chapterAnchors
 *      include the current chapter id. Each row shows the rationale one-liner + the outcome
 *      status badge (open/acknowledged/dismissed/done) + a link to open the full finding in
 *      Review mode. Status mutation reuses the existing patchFindingStatus lifecycle — NO new
 *      accept-apply, advisory only.
 *
 * he/en parity: follows bookLanguage (book-scoped chrome, like the dashboard). RTL physical
 * layout. No em-dash. New Hebrew strings marked // DRAFT he.
 *
 * Fetch strategy: reuses BookReviewService.getReviewFindings, shared with the findings ledger
 * (no new endpoint). Loaded once per (bookId, bookLanguage, chapterId) combination; a null bookId
 * or no review produces an empty/hidden checklist gracefully.
 */
@Component({
  selector: 'app-chapter-findings-checklist',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div
  class="chapter-findings-root"
  [attr.dir]="dir"
  data-testid="chapter-findings-checklist">

  <!-- (A) Context chip: "Addressing: <one-liner>" + back-to-findings link -->
  @if (addressingCtx && addressingCtx.chapterId === chapterId) {
    <div class="addressing-chip" data-testid="addressing-chip" role="status">
      <span class="addressing-label">{{ label('addressing') }}: </span>
      <span class="addressing-oneliner" data-testid="addressing-oneliner">{{ addressingCtx.oneLiner }}</span>
      <button
        type="button"
        class="back-to-findings-btn link-btn"
        data-testid="back-to-findings"
        (click)="onBackToFindings()">
        {{ label('backToFindings') }}
      </button>
    </div>
  }

  <!-- (B) Per-chapter findings checklist -->
  @if (bookId && chapterId) {
    <section class="chapter-checklist" data-testid="chapter-checklist">
      <h5 class="checklist-title">{{ label('checklistTitle') }}</h5>

      @if (loading) {
        <p class="checklist-loading muted" data-testid="checklist-loading">{{ label('loading') }}</p>
      } @else if (chapterFindings.length === 0) {
        <p class="checklist-empty muted" data-testid="checklist-empty">{{ label('empty') }}</p>
      } @else {
        <ul class="checklist-list" data-testid="checklist-list">
          @for (f of chapterFindings; track f.id) {
            <li
              class="checklist-item"
              [attr.data-finding-id]="f.id"
              [attr.data-status]="f.status"
              [attr.data-testid]="'checklist-item-' + f.id">
              <!-- Status badge -->
              <span
                class="checklist-status-badge"
                [attr.data-status]="f.status"
                [attr.data-testid]="'checklist-status-' + f.id">
                {{ statusLabel(f.status) }}
              </span>
              <!-- One-liner text -->
              <span class="checklist-oneliner">{{ oneLiner(f) }}</span>
              <!-- Open finding link (switch to Review/Findings) -->
              <button
                type="button"
                class="open-finding-btn link-btn"
                [attr.data-testid]="'checklist-open-' + f.id"
                (click)="onOpenFinding(f)">
                {{ label('viewFinding') }}
              </button>
              <!-- Quick lifecycle actions: reuse patchFindingStatus -->
              <span class="checklist-actions">
                @if (f.status === 'open') {
                  <button
                    type="button"
                    class="checklist-action-btn"
                    [disabled]="f['patching']"
                    [attr.data-testid]="'checklist-acknowledge-' + f.id"
                    (click)="onStatusAction(f, 'acknowledge')">
                    {{ label('acknowledge') }}
                  </button>
                }
                @if (f.status !== 'done') {
                  <button
                    type="button"
                    class="checklist-action-btn"
                    [disabled]="f['patching']"
                    [attr.data-testid]="'checklist-done-' + f.id"
                    (click)="onStatusAction(f, 'done')">
                    {{ label('done') }}
                  </button>
                }
                @if (f.status === 'open' || f.status === 'acknowledged') {
                  <button
                    type="button"
                    class="checklist-action-btn"
                    [disabled]="f['patching']"
                    [attr.data-testid]="'checklist-dismiss-' + f.id"
                    (click)="onStatusAction(f, 'dismiss')">
                    {{ label('dismiss') }}
                  </button>
                }
                @if (f.status !== 'open') {
                  <button
                    type="button"
                    class="checklist-action-btn"
                    [disabled]="f['patching']"
                    [attr.data-testid]="'checklist-reopen-' + f.id"
                    (click)="onStatusAction(f, 'open')">
                    {{ label('reopen') }}
                  </button>
                }
              </span>
            </li>
          }
        </ul>
      }
    </section>
  }
</div>
  `,
  styles: [`
    .chapter-findings-root { font-size: var(--pd-text-body, 0.875rem); }

    /* (A) Context chip */
    .addressing-chip {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--pd-space-2, 4px);
      padding: var(--pd-space-3, 8px) var(--pd-space-4, 12px);
      margin-bottom: var(--pd-space-3, 8px);
      background: var(--pd-surface-raised, #f0f4ff);
      border: 1px solid var(--pd-border, #c8d0e0);
      border-radius: var(--pd-radius-md, 6px);
      color: var(--pd-text, #1a1a2e);
    }
    .addressing-label {
      font-weight: 600;
      white-space: nowrap;
      color: var(--pd-accent, #2563eb);
    }
    .addressing-oneliner {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--pd-text, #1a1a2e);
    }
    .back-to-findings-btn {
      white-space: nowrap;
      font-size: var(--pd-text-caption, 0.75rem);
      color: var(--pd-text-muted, #6b7280);
    }

    /* (B) Checklist */
    .checklist-title {
      font-size: var(--pd-text-caption, 0.75rem);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--pd-text-muted, #6b7280);
      margin: var(--pd-space-4, 12px) 0 var(--pd-space-2, 4px);
    }
    .checklist-loading, .checklist-empty {
      color: var(--pd-text-muted, #6b7280);
      font-size: var(--pd-text-caption, 0.75rem);
      margin: var(--pd-space-2, 4px) 0;
    }
    .checklist-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-2, 4px);
    }
    .checklist-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--pd-space-2, 4px);
      padding: var(--pd-space-2, 4px) var(--pd-space-3, 8px);
      background: var(--pd-surface, #fff);
      border: 1px solid var(--pd-border, #c8d0e0);
      border-radius: var(--pd-radius-sm, 4px);
      font-size: var(--pd-text-caption, 0.75rem);
    }
    .checklist-item[data-status='done'],
    .checklist-item[data-status='dismissed'] {
      opacity: 0.6;
    }
    .checklist-status-badge {
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: var(--pd-radius-sm, 4px);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      background: var(--pd-surface-sunken, #f5f6fa);
      color: var(--pd-text-muted, #6b7280);
    }
    .checklist-status-badge[data-status='open'] { background: var(--pd-verdict-improve-bg, #fef3c7); color: var(--pd-verdict-improve, #92400e); }
    .checklist-status-badge[data-status='acknowledged'] { background: var(--pd-accent-bg, #dbeafe); color: var(--pd-accent, #1d4ed8); }
    .checklist-status-badge[data-status='done'] { background: var(--pd-verdict-keep-bg, #d1fae5); color: var(--pd-verdict-keep, #065f46); }
    .checklist-status-badge[data-status='dismissed'] { background: var(--pd-surface-sunken, #f5f6fa); color: var(--pd-text-muted, #9ca3af); }

    .checklist-oneliner {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .open-finding-btn {
      flex-shrink: 0;
      font-size: 0.7rem;
    }
    .checklist-actions {
      display: flex;
      gap: var(--pd-space-1, 2px);
      flex-shrink: 0;
    }
    .checklist-action-btn {
      font-size: 0.7rem;
      padding: 1px 6px;
      background: none;
      border: 1px solid var(--pd-border, #c8d0e0);
      border-radius: var(--pd-radius-sm, 4px);
      cursor: pointer;
      color: var(--pd-text-muted, #6b7280);
    }
    .checklist-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .link-btn { background: none; border: none; cursor: pointer; color: var(--pd-accent, #2563eb); text-decoration: underline; padding: 0; }
    .muted { color: var(--pd-text-muted, #6b7280); }
  `],
})
export class ChapterFindingsChecklistComponent implements OnInit, OnChanges, OnDestroy {
  /** The book the current chapter belongs to. Null = no checklist (hidden gracefully). */
  @Input() bookId: string | null = null;
  /** Book language ('he' | 'en') for localization. Defaults to 'he'. */
  @Input() bookLanguage: string | null = null;
  /** The chapter currently open in the editor. Used to filter findings by chapterAnchors. */
  @Input() chapterId: string | null = null;

  /**
   * Emitted when the user clicks "back to findings" (context chip) or "view finding" (checklist row).
   * The editor-page handles it by calling onReviewModeChange('review') which switches the panel.
   *
   * d1: the payload is the finding to open in the ledger, or null for the plain "back to findings"
   * gesture, which is about the LIST rather than about one row. Both are best-effort: an id the ledger
   * cannot find leaves the reader on the Findings tab, which is exactly where the bare emit put them.
   */
  @Output() switchToReview = new EventEmitter<string | null>();

  /** All findings for the current book, fetched from BookReviewService. */
  private allFindings: (BookFinding & { patching?: boolean })[] = [];
  loading = false;

  /** The currently-addressing context from the shared service (drives the chip). */
  addressingCtx: ReviseContext | null = null;

  private contextSub: Subscription | null = null;
  private findingsSub: Subscription | null = null;
  private patchSubs = new Map<string, Subscription>();

  constructor(
    private bookReviewService: BookReviewService,
    private reviseContext: ReviseContextService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.contextSub = this.reviseContext.currentlyAddressing$.subscribe(ctx => {
      this.addressingCtx = ctx;
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['bookId'] || changes['bookLanguage']) {
      this.allFindings = [];
      this.loadFindings();
    }

    // Phase 4d-10c: the revise-context is a root singleton set when the user clicks a finding's "go to
    // chapter" anchor (BookReviewFindingsComponent). The chip is only HIDDEN (not cleared) on a
    // non-matching chapter by the template guard, so navigating away from the anchored chapter and back
    // would re-show a STALE chip. Reset the context the moment the OPEN chapter moves off the context's
    // anchored chapter. Key on the chapterId VALUE change (not the component instance being recreated for
    // the SAME chapter+finding), so a fresh mount on the anchored chapter keeps the just-set context.
    const chapterChange = changes['chapterId'];
    if (chapterChange && !chapterChange.firstChange) {
      const ctx = this.reviseContext.snapshot;
      if (ctx && ctx.chapterId !== this.chapterId) {
        this.reviseContext.clear();
      }
    }
    // chapterId change otherwise needs no refetch: we filter client-side from allFindings.
  }

  ngOnDestroy(): void {
    this.contextSub?.unsubscribe();
    this.findingsSub?.unsubscribe();
    for (const sub of this.patchSubs.values()) sub.unsubscribe();
    this.patchSubs.clear();
  }

  // ── Data ─────────────────────────────────────────────────────────────────────

  private get language(): string {
    return (this.bookLanguage?.trim()) || 'he';
  }

  private loadFindings(): void {
    if (!this.bookId) {
      this.allFindings = [];
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }
    const bookId = this.bookId;
    const lang = this.language;
    this.loading = true;
    this.findingsSub?.unsubscribe();
    this.findingsSub = this.bookReviewService.getReviewFindings(bookId, lang).subscribe({
      next: dto => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.allFindings = (dto.findings ?? []).map(f => ({ ...f }));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (this.bookId !== bookId || this.language !== lang) return;
        this.allFindings = [];
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** Findings whose chapterAnchors include the current chapterId. */
  get chapterFindings(): (BookFinding & { patching?: boolean })[] {
    if (!this.chapterId) return [];
    const id = this.chapterId;
    return this.allFindings.filter(f =>
      f.chapterAnchors?.some(a => a.chapterId === id)
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  onBackToFindings(): void {
    this.reviseContext.clear();
    // No finding id: this gesture is "show me the list again", not "show me this row".
    this.switchToReview.emit(null);
  }

  /**
   * d1: switch to Review/Findings AND name the finding the reader clicked. This used to discard its
   * argument and emit a bare switch, which landed on the Findings tab scrolled wherever it happened to
   * be - on a ledger of dozens of rows, the row the reader asked for was frequently off-screen and
   * collapsed. The id travels to BookReviewFindingsComponent.openFinding via the editor host.
   */
  onOpenFinding(f: BookFinding): void {
    this.switchToReview.emit(f?.id ?? null);
  }

  /**
   * Optimistic status lifecycle — mirrors BookReviewFindingsComponent.onStatusAction.
   * Reuses BookReviewService.patchFindingStatus (the SAME mutation; no new endpoint).
   */
  onStatusAction(finding: BookFinding & { patching?: boolean }, verb: 'acknowledge' | 'dismiss' | 'done' | 'open'): void {
    if (!this.bookId || finding.patching) return;
    const bookId = this.bookId;
    const lang = this.language;
    const targetStatus = this.statusForVerb(verb);
    if (finding.status === targetStatus) return;

    const priorStatus = finding.status;
    finding.status = targetStatus;
    finding.patching = true;
    this.cdr.markForCheck();

    const sub = this.bookReviewService.patchFindingStatus(bookId, finding.id, verb).subscribe({
      next: updated => {
        this.patchSubs.delete(finding.id);
        if (this.bookId !== bookId || this.language !== lang) return;
        // Reconcile to server state (mirrors the findings ledger pattern).
        const local = this.allFindings.find(f => f.id === finding.id);
        if (local) {
          local.status = updated.status;
          if (updated.updatedAt) local.updatedAt = updated.updatedAt;
          local.patching = false;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.patchSubs.delete(finding.id);
        if (this.bookId !== bookId || this.language !== lang) return;
        // Revert.
        const local = this.allFindings.find(f => f.id === finding.id);
        if (local) {
          local.status = priorStatus;
          local.patching = false;
        }
        this.cdr.markForCheck();
      },
    });
    this.patchSubs.set(finding.id, sub);
  }

  private statusForVerb(verb: 'acknowledge' | 'dismiss' | 'done' | 'open'): FindingStatus {
    switch (verb) {
      case 'acknowledge': return 'acknowledged';
      case 'dismiss': return 'dismissed';
      case 'done': return 'done';
      case 'open': return 'open';
    }
  }

  // ── Localization ─────────────────────────────────────────────────────────────

  get dir(): 'rtl' | 'ltr' {
    return this.language.toLowerCase().startsWith('en') ? 'ltr' : 'rtl';
  }

  private get langKey(): 'he' | 'en' {
    return this.language.toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  oneLiner(f: BookFinding): string {
    return truncateOneLiner(f.rationale);
  }

  statusLabel(status: FindingStatus): string {
    const he: Record<FindingStatus, string> = {
      open: 'פתוח',
      acknowledged: 'נצפה',
      dismissed: 'נדחה',
      done: 'טופל',
    };
    const en: Record<FindingStatus, string> = {
      open: 'Open',
      acknowledged: 'Acknowledged',
      dismissed: 'Dismissed',
      done: 'Done',
    };
    return (this.langKey === 'he' ? he : en)[status] ?? status;
  }

  label(key: string): string {
    const he: Record<string, string> = {
      addressing: 'מטפל ב',                       // DRAFT he - needs native review
      backToFindings: 'חזרה לממצאים',              // DRAFT he - needs native review
      checklistTitle: 'ממצאים לפרק זה',            // DRAFT he - needs native review
      loading: 'טוען ממצאים...',                   // DRAFT he - needs native review
      empty: 'אין ממצאים התפתחותיים לפרק זה.',     // DRAFT he - needs native review
      viewFinding: 'הצג',                           // DRAFT he - needs native review
      acknowledge: 'סמן כנצפה',                    // DRAFT he - needs native review
      dismiss: 'דחה',                              // DRAFT he - needs native review
      done: 'סמן כטופל',                           // DRAFT he - needs native review
      reopen: 'פתח מחדש',                          // DRAFT he - needs native review
    };
    const en: Record<string, string> = {
      addressing: 'Addressing',
      backToFindings: 'Back to findings',
      checklistTitle: 'Findings for this chapter',
      loading: 'Loading findings...',
      empty: 'No developmental findings for this chapter.',
      viewFinding: 'View',
      acknowledge: 'Acknowledge',
      dismiss: 'Dismiss',
      done: 'Mark done',
      reopen: 'Reopen',
    };
    return (this.langKey === 'he' ? he : en)[key] ?? key;
  }
}
