import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * rf-f05: Revise-context service — carries the "currently addressing" finding identity from a
 * finding's "go to chapter" click (in BookReviewFindingsComponent) into the Edit-mode panel
 * (ChapterFindingsChecklistComponent) so the context chip can render "Addressing: <one-liner>".
 *
 * Design rationale (shared service over router state / extended payload):
 *   - The dashboard + editor are co-mounted in the SAME editor-page @if block. Both have direct
 *     access to root-provided services, making a BehaviorSubject the cleanest and most testable
 *     mechanism — no router state pollution, no payload shape change to threaten the Story-Bible
 *     openChapter path.
 *   - Clean teardown: the chip component clears the context on "back to findings"; the findings
 *     component sets it immediately before emitting openChapter.
 */
export interface ReviseContext {
  /** The BookFinding.id being addressed. */
  findingId: string;
  /** Short rationale text used as the chip label (truncated by the chip if long). */
  oneLiner: string;
  /** The chapter the user navigated to, used to match the current chapter in Edit mode. */
  chapterId: string;
}

@Injectable({ providedIn: 'root' })
export class ReviseContextService {
  /**
   * The finding currently being addressed in the Edit panel. Null when no finding navigation
   * is active (chip is hidden). Set by BookReviewFindingsComponent.onAnchorClick; cleared by
   * the context chip's "back to findings" action.
   */
  private readonly _currentlyAddressing$ = new BehaviorSubject<ReviseContext | null>(null);
  readonly currentlyAddressing$ = this._currentlyAddressing$.asObservable();

  /** Set when the user clicks a finding's "go to chapter" anchor. */
  set(context: ReviseContext): void {
    this._currentlyAddressing$.next(context);
  }

  /** Clear the addressing context (called by the "back to findings" link). */
  clear(): void {
    this._currentlyAddressing$.next(null);
  }

  /** Snapshot read for synchronous use in templates (prefer the Observable for reactive pipes). */
  get snapshot(): ReviseContext | null {
    return this._currentlyAddressing$.value;
  }
}
