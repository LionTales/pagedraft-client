import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, catchError, map, of, switchMap, takeUntil, timeout } from 'rxjs';

import { GuideContentDto, GuideLanguage } from '../../core/models/guide';
import { GuidesService } from '../../core/services/guides.service';
import { GuideSection, guideIntro, guideSectionAt } from '../../core/utils/guide-sections';
import { guidesString } from '../../core/i18n/guides-strings';
import { OVERVIEW_GUIDE_ID } from '../../shared/stage-spine/stage-guide';
import { MarkdownTextComponent } from '../analysis-panel/markdown-text.component';

/** The two languages this panel renders in. It is BOOK-SCOPED, so it follows the book. */
export type OrientationLang = 'he' | 'en';

/** Every chrome string this panel and its re-open affordance render. Closed union: a typo is a build error. */
export type OrientationStringKey =
  | 'panelTitle'
  | 'reopen'
  | 'reopenAria'
  | 'pointSpine'
  | 'pointRows'
  | 'readWholeGuide'
  | 'dismiss'
  | 'closeAria';

/**
 * Hebrew chrome. Cleared by the owner in the w8 native-speaker sweep (`docs/HEBREW_NATIVE_REVIEW.md`):
 * the panel title, `איך זה עובד`, the dismiss and read-guide labels and the spine-pointing sentence were
 * kept as written, and `pointRows` was replaced with the owner's own wording.
 *
 * These are NAVIGATIONAL strings, not tutorial prose: they name the panel, name the two things on the
 * page it points at, and label its two buttons. The teaching itself is the guide section rendered
 * between them, which is authored content served by the API. That split is what keeps Q13-A's ruling
 * (orientation is a view over the served guides) true rather than nominal - nothing here explains a
 * stage, and nothing here would have to be kept in sync with the assistant's answers.
 */
export const ORIENTATION_STRINGS_HE: Record<OrientationStringKey, string> = {
  panelTitle:     'איך העבודה על הספר הזה מתחילה',
  reopen:         'איך זה עובד',
  reopenAria:     'פתיחת ההסבר על שלבי העבודה',
  pointSpine:     'רשימת השלבים שבראש הדף מראה איפה הספר הזה עומד בכל שלב.',
  pointRows:      'מתחת לרשימה נמצאות הפעולות עצמן. משם מפעילים כל שלב, ושם כתוב מה צריך לעשות קודם.',
  readWholeGuide: 'למדריך המלא',
  dismiss:        'הבנתי, לא להציג שוב',
  closeAria:      'סגירת ההסבר, ולא להציג אותו שוב',
};

export const ORIENTATION_STRINGS_EN: Record<OrientationStringKey, string> = {
  panelTitle:     'How the work on this book starts',
  reopen:         'How this works',
  reopenAria:     'Open the explanation of the workflow stages',
  pointSpine:     'The list of stages at the top of this page shows where this book stands in each one.',
  pointRows:      'The build rows under it are where each stage is started, and they say what is missing first.',
  readWholeGuide: 'Read the whole guide',
  dismiss:        'Got it, do not show this again',
  closeAria:      'Close this explanation and do not show it again',
};

/** Resolve one orientation string in the book's language. */
export function orientationString(lang: OrientationLang, key: OrientationStringKey): string {
  return (lang === 'he' ? ORIENTATION_STRINGS_HE : ORIENTATION_STRINGS_EN)[key];
}

/** One settled read of the overview guide. The failure travels as a VALUE so the pipeline survives it. */
interface OrientationRead {
  guide: GuideContentDto | null;
  error: HttpErrorResponse | null;
}

/**
 * Wave 3 / w6 (Q10-D's overlay half) - THE FIRST-RUN ORIENTATION PANEL.
 *
 * ── What Q10-D actually asked for ─────────────────────────────────────────────────────────────────
 * "B as the permanent mechanism, plus a first-run overlay that points at it." B is the self-explaining
 * build rows and the stage spine, which w2 and w5 shipped. This is the pointer, and the word POINTS is
 * load-bearing: it TEACHES THE MECHANISM rather than replacing it. There is no wizard here, no step
 * sequence, and no button that starts a build. It says what the two surfaces on this page are for, shows
 * the guide's own account of the five stages, and gets out of the way.
 *
 * ── The four lifecycle rules, and how each is met ─────────────────────────────────────────────────
 * 1. FIRST VISIT ONLY, per book. The host decides (see `BookDashboardComponent.maybeOfferOrientation`):
 *    no stored dismissal for this book AND the book has no builds, judged from status payloads that have
 *    actually LANDED, or from an explicit read-FAILED signal on a row if a payload never lands at all
 *    (w6 fixes c01). An unarrived status is not "no builds", so the panel does not flash on a book that
 *    turns out to be fully built; a status the host could not read resolves the same way - not offered -
 *    rather than leaving the decision open for the life of the mount.
 * 2. DISMISSES PERMANENTLY. Closing writes the flag (`orientation-store.ts`), per book, in localStorage.
 * 3. RE-OPENABLE FROM A VISIBLE AFFORDANCE. The brief names option C's failure mode explicitly -
 *    "undiscoverable when they want it back" - so the re-open control is a permanent button in the
 *    dashboard header, beside Export, present in every state including after dismissal. It is not in a
 *    menu, not behind a hover, and not inside a collapsible section.
 * 4. NEVER BLOCKS, AND SURVIVES NAVIGATE-AWAY. This is an in-flow panel at the top of the dashboard, not
 *    a modal: no backdrop, no focus trap, nothing behind it is inert, and every build row, the spine and
 *    the whole page stay usable with it open. Builds take minutes, so a panel that had to be dealt with
 *    before work could start would be the failure Q10's constraint names. Leaving the page and coming
 *    back costs nothing: the panel holds no state that matters, and the one bit that does (dismissal)
 *    lives in storage rather than in this component.
 *
 * ── Its prose comes from the corpus, not from here ────────────────────────────────────────────────
 * The body is a real section of the shipped `workflow-overview` guide, fetched through the A.2 endpoint
 * and rendered by the app's existing markdown component. Q13 ruled hardcoded tutorial copy out at the
 * session (option C, "the throwaway path"), and the panel is built so that ruling cannot quietly erode:
 * if the corpus cannot be read, this panel says so and offers a retry. It NEVER falls back to a sentence
 * of its own about the stages, because a fallback is how the hardcoded path gets in through the back
 * door, one release at a time. A read that never answers at all is bounded and lands in that same
 * honest state rather than in a permanent spinner (see {@link settle}), so "cannot be read" covers
 * silence as well as errors, and the author always has something to press.
 *
 * ── Show ──────────────────────────────────────────────────────────────────────────────────────────
 * Deliberately not referenced. Chatbot phase B has not shipped, and the todo's rule is that this panel
 * may point at Show for questions ONCE B is there but must not depend on it. Pointing at it now would be
 * a dead affordance for the capability B is meant to provide, which is exactly the class of claim this
 * wave removes. The place for it, when B lands, is one more line beside `pointRows`.
 *
 * ── RTL: what mirrors, and what is physically fixed ───────────────────────────────────────────────
 *   - root `dir`         MIRRORS, following the BOOK language. This is book-scoped chrome (it describes
 *                        one manuscript), the same rule the spine and the build rows on this page obey.
 *   - the panel card     MIRRORS. A block in the dashboard's flow with logical padding only.
 *   - the accent edge    MIRRORS. `border-inline-start`, so it hugs the reading edge in both languages.
 *   - the close control  MIRRORS. It sits at the inline-END of the header row, i.e. physically left in
 *                        Hebrew and right in English. It is NOT an anchored overlay control and has no
 *                        motion toward a corner, so there is nothing here of the class the brief says
 *                        must stay physically pinned.
 *   - the glyph `×`      PHYSICALLY FIXED, and deliberately: it is symmetric, so mirroring it is a no-op.
 *   - the rendered guide MIRRORS, and by its OWN content: `app-markdown-text` carries `dir="auto"`.
 * Nothing in this component is draggable, anchored, or animated toward the activity bell, which are the
 * three element classes in this codebase that must stay put.
 *
 * ── Styling reaches the injected nodes, or it does not exist ──────────────────────────────────────
 * The guide body arrives through `[innerHTML]` inside `app-markdown-text`, and Angular's emulated
 * encapsulation stamps its content attribute only on nodes IT creates - so a descendant rule written
 * HERE against that markup would match nothing and would be dead the day it shipped (this repo has
 * shipped roughly ten such rules once already). This component therefore writes NO rule that reaches
 * inside the rendered markdown. It sizes and spaces its own wrapper, and the markdown component owns
 * everything under it, which is where the fix for that class lives.
 */
@Component({
  selector: 'app-first-run-orientation',
  standalone: true,
  imports: [MarkdownTextComponent],
  template: `
    <section
      class="orientation"
      data-testid="first-run-orientation"
      [attr.dir]="dir"
      role="region"
      [attr.aria-label]="label('panelTitle')">
      <header class="orientation-head">
        <h4 class="orientation-title">{{ label('panelTitle') }}</h4>
        <button
          type="button"
          class="orientation-close"
          data-testid="orientation-close"
          [attr.aria-label]="label('closeAria')"
          (click)="close()">
          <span aria-hidden="true">&#215;</span>
        </button>
      </header>

      @if (loading) {
        <p class="orientation-status" role="status" data-testid="orientation-loading">
          {{ guidesLabel('loading') }}
        </p>
      } @else if (failure) {
        <!-- HONEST, and never a fallback paragraph of our own. The two sentences are the two different
             facts the reader page already distinguishes, so one server fault does not get told two
             different ways in two places. -->
        <div class="orientation-failure" role="status" data-testid="orientation-failure">
          <p class="orientation-failure-title">{{ guidesLabel('loadFailedTitle') }}</p>
          <p class="orientation-failure-body">
            {{ failure === 'corpus' ? guidesLabel('corpusUnavailable') : guidesLabel('loadFailedBody') }}
          </p>
          <button
            type="button"
            class="pd-btn pd-btn-ghost"
            data-testid="orientation-retry"
            (click)="reload()">{{ guidesLabel('retry') }}</button>
        </div>
      } @else if (section) {
        <h5 class="orientation-section-title" data-testid="orientation-section-title">{{ section.heading }}</h5>
        <div class="orientation-body">
          <app-markdown-text variant="document" [text]="section.body" data-testid="orientation-guide-body" />
        </div>
      }

      <!-- The POINTERS. This is the half that teaches the mechanism: it names the two permanent surfaces
           on this page and what each is for, so the panel can be dismissed without taking the guidance
           with it. -->
      <ul class="orientation-points" data-testid="orientation-points">
        <li>{{ label('pointSpine') }}</li>
        <li>{{ label('pointRows') }}</li>
      </ul>

      <div class="orientation-actions">
        <button
          type="button"
          class="pd-btn pd-btn-ghost"
          data-testid="orientation-read-guide"
          (click)="readWholeGuide()">{{ label('readWholeGuide') }}</button>
        <button
          type="button"
          class="pd-btn pd-btn-ghost orientation-dismiss"
          data-testid="orientation-dismiss"
          (click)="close()">{{ label('dismiss') }}</button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }

    /* An in-flow card, NOT a modal. No backdrop, no fixed positioning, no z-index war with the dock. */
    .orientation {
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-inline-start: 3px solid var(--pd-primary-600);
      border-radius: var(--pd-radius-md);
      padding: var(--pd-space-4) var(--pd-space-5);
      margin-block-end: var(--pd-space-4);
      font-family: var(--pd-font-ui);
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-3);
    }

    .orientation-head {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--pd-space-3);
    }
    .orientation-title {
      margin: 0;
      font-size: var(--pd-text-body);
      line-height: var(--pd-lh-body);
      font-weight: var(--pd-weight-semibold);
      color: var(--pd-text);
    }
    /* Inline-END of the header row: physically left in Hebrew, right in English. */
    .orientation-close {
      flex: 0 0 auto;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--pd-text-muted);
      font-size: var(--pd-text-body);
      line-height: 1;
      padding: var(--pd-space-1) var(--pd-space-2);
      border-radius: var(--pd-radius-sm);
    }
    .orientation-close:hover { color: var(--pd-text); }
    .orientation-close:focus-visible { outline: none; box-shadow: var(--pd-ring); }

    .orientation-status,
    .orientation-failure-body { margin: 0; color: var(--pd-text-secondary); font-size: var(--pd-text-body-sm); }
    .orientation-failure {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--pd-space-2);
      background: var(--pd-surface-sunken);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-sm);
      padding: var(--pd-space-4);
    }
    .orientation-failure-title {
      margin: 0;
      font-weight: var(--pd-weight-semibold);
      color: var(--pd-text);
      font-size: var(--pd-text-body-sm);
    }

    .orientation-section-title {
      margin: 0;
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
      font-weight: var(--pd-weight-semibold);
      color: var(--pd-text-secondary);
    }
    /* The wrapper only. Everything INSIDE the rendered markdown belongs to app-markdown-text: a
       descendant rule written here would never reach an [innerHTML] node (see the class doc). */
    .orientation-body { max-block-size: 22rem; overflow-y: auto; }

    .orientation-points {
      margin: 0;
      padding-inline-start: var(--pd-space-5);
      display: flex;
      flex-direction: column;
      gap: var(--pd-space-1);
      color: var(--pd-text-secondary);
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
    }

    .orientation-actions {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--pd-space-2);
    }
  `],
})
export class FirstRunOrientationComponent implements OnChanges, OnDestroy {
  private readonly guides = inject(GuidesService);
  private readonly destroy$ = new Subject<void>();

  /** The book this panel is describing. Only used to key the read; the host owns the dismissal flag. */
  @Input() bookId: string | null = null;

  /** The book's language. BOOK-SCOPED chrome, and it also picks which authored FILE is fetched. */
  @Input() bookLanguage: string | null = null;

  /**
   * Whether the host is showing the panel. The read is issued only while it is true, so a dashboard that
   * never offers orientation costs no request.
   */
  @Input() open = false;

  /** The author closed the panel. The HOST persists the dismissal; this component stores nothing. */
  @Output() dismissed = new EventEmitter<void>();

  /** The author asked for the whole guide. The host routes to the reader (`/help/:guideId`). */
  @Output() openGuide = new EventEmitter<string>();

  loading = false;

  /**
   * `corpus` is the server's own 503 (it could not read the guides at all, an install problem);
   * `network` is this client failing to reach it. Two facts, two sentences, and the guides reader page
   * splits the same status code the same way so one fault is never told two different stories.
   */
  failure: 'corpus' | 'network' | null = null;

  /** The guide section being shown, or null when there is none to show. */
  section: GuideSection | null = null;

  /**
   * WHICH SECTION. Index 0 is the overview guide's first authored H2, which is its account of the five
   * stages - the one thing a first-run author needs and the one this panel exists to deliver. Selected by
   * position rather than by heading text on purpose; `guide-sections.ts` states why at length (headings
   * are the assistant's retrieval index and differ per language).
   */
  private static readonly SECTION_INDEX = 0;

  /**
   * How long a read may stay pending before it is treated as unanswered. See {@link settle}. Ten
   * seconds is far past a healthy read of one small authored file and short enough that an author
   * looking at the card is not left guessing whether anything is still happening.
   */
  static readonly READ_TIMEOUT_MS = 10_000;

  /** The (id, language) pair the current view was read for, so a repeated binding does not re-fetch. */
  private lastKey = '';

  /** The inlet of the one pipeline every read goes through, retries included. */
  private readonly reads$ = new Subject<GuideLanguage | null>();

  constructor() {
    // Subscribed in the constructor rather than in ngOnInit: the host mounts this component inside an
    // @if that is already true, so its first ngOnChanges can arrive before ngOnInit would have run.
    this.reads$
      .pipe(
        switchMap(lang => (lang ? this.settle(lang) : of<OrientationRead | null>(null))),
        takeUntil(this.destroy$),
      )
      .subscribe(result => {
        if (!result) return;
        if (result.error) this.applyFailure(result.error);
        else this.applyGuide(result.guide);
      });
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (!this.open) {
      // Drop anything in flight: an answer landing after the panel closed has nothing to paint on.
      this.reads$.next(null);
      this.lastKey = '';
      return;
    }
    const key = `${this.bookId ?? ''}|${this.lang}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** he unless the BOOK is English. Same resolution the spine and the status rows on this page use. */
  get lang(): OrientationLang {
    return (this.bookLanguage ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'he';
  }

  /** Direction follows the book language: this is book-scoped chrome. MIRRORS. */
  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  label(key: OrientationStringKey): string {
    return orientationString(this.lang, key);
  }

  /**
   * The guides reader's own strings, in the book's language. Reused rather than re-authored: "I could
   * not load the guides" and "the guides are not present on this server" are the same two facts the
   * `/help` pages report, and a second wording of them is a second story about one server fault.
   */
  guidesLabel(key: 'loading' | 'loadFailedTitle' | 'loadFailedBody' | 'corpusUnavailable' | 'retry'): string {
    return guidesString(this.lang, key);
  }

  reload(): void {
    this.load();
  }

  close(): void {
    this.dismissed.emit();
  }

  readWholeGuide(): void {
    this.openGuide.emit(OVERVIEW_GUIDE_ID);
  }

  private load(): void {
    this.loading = true;
    this.failure = null;
    this.section = null;
    this.reads$.next(this.lang);
  }

  /**
   * One read, resolved to a value either way, so a failure cannot tear the long-lived pipeline down.
   *
   * ── Why the pending state is BOUNDED, and why it resolves to the NETWORK failure ─────────────────
   * An errored read already resolves: `catchError` turns it into a value and the retry appears. A read
   * that never emits did not, and that is a reachable state rather than a theoretical one (the host's
   * own spec stubs `GuidesService.get` with `NEVER`), so before this bound the panel could sit on its
   * loading line forever with nothing to press. Of the two honest shapes, this is (b): after
   * {@link READ_TIMEOUT_MS} the read resolves INTO the existing failure state rather than growing a
   * second, timeout-only affordance beside it. The argument is that a request that never answered is
   * the same FACT the reader is already told about ("I could not reach the server. Check the
   * connection and try again."), told once, with the retry that sentence already promises; a separate
   * "still loading, try again" control would be a third wording of one server fault, which is exactly
   * what `guidesLabel` exists to prevent. It is stamped status 0, so `applyFailure` classifies it
   * NETWORK: a read that hung is this client failing to get an answer, never the server's own 503
   * saying the corpus is not installed. Nothing here invents prose about the stages; the sentence and
   * the button both come from the guides string map.
   *
   * The bound lives INSIDE the observable `switchMap` subscribes to, which is what makes its cleanup
   * structural rather than bookkeeping: a new `load()` switches away and unsubscribes this inner
   * observable (tearing the timer down with it), and `takeUntil(destroy$)` does the same on destroy.
   * A timer armed for an earlier read therefore cannot survive to resolve a later one - there is no
   * shared handle for it to fire onto. `timeout`'s `with` replaces the timeout with a VALUE, so no
   * error escapes to the pipeline; the trailing `catchError` still handles real HTTP failures.
   */
  private settle(lang: GuideLanguage): Observable<OrientationRead> {
    return this.guides.get(OVERVIEW_GUIDE_ID, lang).pipe(
      map(guide => ({ guide, error: null }) as OrientationRead),
      timeout({
        first: FirstRunOrientationComponent.READ_TIMEOUT_MS,
        with: () => of<OrientationRead>({
          guide: null,
          error: new HttpErrorResponse({ status: 0, statusText: 'Read timed out' }),
        }),
      }),
      catchError((error: HttpErrorResponse) => of<OrientationRead>({ guide: null, error })),
    );
  }

  private applyGuide(guide: GuideContentDto | null): void {
    this.loading = false;
    // The intro is the fallback ONLY in the sense that it is other prose FROM THE SAME DOCUMENT - the
    // paragraph under its H1. If the served guide has neither an H2 nor an intro there is nothing
    // authored to show, and the panel shows its pointers alone rather than inventing a paragraph.
    const section = guideSectionAt(guide?.body, FirstRunOrientationComponent.SECTION_INDEX);
    if (section) {
      this.section = section;
      return;
    }
    const intro = guideIntro(guide?.body);
    this.section = intro ? { heading: guide?.title ?? '', body: intro } : null;
  }

  private applyFailure(err: HttpErrorResponse): void {
    this.loading = false;
    this.section = null;
    // 404 lands here too: the overview guide missing from the corpus is a corpus problem from this
    // panel's point of view, not a wrong URL the author can act on. It gets the install sentence, which
    // is the true one, rather than a "that guide does not exist" the author never asked for by name.
    this.failure = err.status === 503 || err.status === 404 ? 'corpus' : 'network';
  }
}
