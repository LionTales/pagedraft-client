import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, Subject, catchError, combineLatest, map, of, switchMap, takeUntil } from 'rxjs';

import { MarkdownTextComponent } from '../analysis-panel/markdown-text.component';
import { GuideContentDto } from '../../core/models/guide';
import { GuidesService } from '../../core/services/guides.service';
import { ChatChromeLang, chatChromeLang } from '../../core/i18n/chat-strings';
import { GuidesStringKey, formatGuideDate, guidesString } from '../../core/i18n/guides-strings';
import { INDEX_STAGE } from './help-index.component';

/** The corpus's own index document. See {@link GuideReaderComponent} for why it is redirected. */
export const INDEX_GUIDE_ID = 'guides-index';

/** One read the reader has asked for: an (id, language) pair, which is what identifies a guide FILE. */
interface GuideRead {
  id: string;
  lang: ChatChromeLang;
}

/**
 * A read that has settled, one way or the other.
 *
 * The failure travels as a VALUE rather than as an error notification because the pipeline that carries
 * it is long-lived: an error reaching `switchMap`'s output would complete the subscription and the page
 * would never load again, retry button or not.
 */
interface GuideReadResult {
  guide: GuideContentDto | null;
  error: HttpErrorResponse | null;
}

/**
 * THE SINGLE-GUIDE READER at `/help/:guideId` (chatbot phase A.2, c1).
 *
 * ── What it renders, and with what ────────────────────────────────────────────────────────────────
 * The guide's markdown body, through the app's EXISTING markdown component in its `document` variant.
 * A second renderer was not written: the guides use headings, bullet and numbered lists, bold and
 * inline code, and every one of those was already parsed by `app-markdown-text`. What the authored
 * files added over model output was hard wrapping (a wrapped line is not a line break, and a wrapped
 * list item is not a new paragraph) and real page-level heading sizes, so the component gained a
 * variant for those three differences rather than a fork. See `MarkdownVariant`.
 *
 * ── Language ──────────────────────────────────────────────────────────────────────────────────────
 * The `lang` query parameter, Hebrew-default like all app-level chrome, and it is a CONTENT choice as
 * much as a chrome one: an en/he pair are two separately authored FILES sharing one id, so switching
 * re-fetches the sibling. Nothing here translates anything. `dir` follows the same value, so a Hebrew
 * guide reads right-to-left with its chrome, and the language survives a reload and a shared link.
 *
 * ── The index document is redirected, not rendered ────────────────────────────────────────────────
 * `guides-index` (the corpus's `README.md`) is a table of links between markdown FILES. Those links go
 * nowhere in the app, and the thing it indexes is `/help` itself, which renders the same information as
 * working navigation. So this route sends it there instead of rendering a table of dead links. The
 * document is still served by the API and still reachable by the chatbot; it simply is not a page.
 *
 * ── One read at a time ────────────────────────────────────────────────────────────────────────────
 * Every fetch goes through `reads$` and a `switchMap`, so asking a new question cancels the old one.
 * That matters here more than in most places: a language switch asks the SAME component the same
 * question twice, so `takeUntil(destroy$)` protects nothing (the component is very much alive) and the
 * two answers can land in either order. Without supersession the slower Hebrew body would render under
 * English chrome, and a failure on the language the reader has already left would put its banner over
 * the language they are now reading. Cancelling the read closes both, and closes them in one place
 * rather than asking the success handler and the failure handler to each remember a guard.
 *
 * ── Honest failure ────────────────────────────────────────────────────────────────────────────────
 * Four distinct states, because they are four different facts and only one of them is the author's to
 * act on: the guide does not exist; the guide exists but not in this language (the reader then offers
 * the language it DOES exist in, rather than a dead end); the server answered 503, its own fault code
 * for a corpus it could not read at all, which is an install problem and not a missing guide; or the
 * server could not be reached at all. See `HelpIndexComponent` for the same 503-vs-network split on the
 * index page; the two surfaces must not tell an author two different stories about one server fault.
 */
@Component({
  selector: 'app-guide-reader',
  standalone: true,
  imports: [RouterLink, MarkdownTextComponent],
  template: `
    <div class="reader" [attr.dir]="dir">
      <nav class="reader-bar">
        <a class="reader-back" [routerLink]="['/help']" [queryParams]="{ lang: lang }">
          <span class="reader-back-icon" aria-hidden="true">←</span>{{ label('backToIndex') }}
        </a>

        <div class="reader-lang" role="group" [attr.aria-label]="label('languageToggleLabel')">
          <button
            type="button"
            class="reader-lang-btn"
            [class.reader-lang-btn--active]="lang === 'he'"
            [attr.aria-pressed]="lang === 'he'"
            (click)="switchTo('he')">{{ label('readInHebrew') }}</button>
          <button
            type="button"
            class="reader-lang-btn"
            [class.reader-lang-btn--active]="lang === 'en'"
            [attr.aria-pressed]="lang === 'en'"
            (click)="switchTo('en')">{{ label('readInEnglish') }}</button>
        </div>
      </nav>

      @if (loading) {
        <p class="reader-status" role="status">{{ label('loading') }}</p>
      } @else if (failure) {
        <div class="reader-failure" role="status">
          @if (failure === 'language') {
            <p class="reader-failure-title">{{ label('guideLanguageUnavailableTitle') }}</p>
            <p class="reader-failure-body">{{ label('guideLanguageUnavailableBody') }}</p>
            @if (otherLanguage; as other) {
              <button type="button" class="pd-btn pd-btn-ghost" (click)="switchTo(other)">
                {{ other === 'he' ? label('readInHebrew') : label('readInEnglish') }}
              </button>
            }
          } @else if (failure === 'missing') {
            <p class="reader-failure-title">{{ label('guideNotFoundTitle') }}</p>
            <p class="reader-failure-body">{{ label('guideNotFoundBody') }}</p>
            <a class="pd-btn pd-btn-ghost" [routerLink]="['/help']" [queryParams]="{ lang: lang }">
              {{ label('backToIndex') }}
            </a>
          } @else if (failure === 'corpus') {
            <!-- The server's own fault code (503): it could not read its OWN corpus, which is an install
                 problem rather than missing content. A redeployed server does recover, so retry stays. -->
            <p class="reader-failure-title">{{ label('loadFailedTitle') }}</p>
            <p class="reader-failure-body">{{ label('corpusUnavailable') }}</p>
            <button type="button" class="pd-btn pd-btn-ghost" (click)="reload()">{{ label('retry') }}</button>
          } @else {
            <p class="reader-failure-title">{{ label('loadFailedTitle') }}</p>
            <p class="reader-failure-body">{{ label('loadFailedBody') }}</p>
            <button type="button" class="pd-btn pd-btn-ghost" (click)="reload()">{{ label('retry') }}</button>
          }
        </div>
      } @else if (guide) {
        <article class="reader-doc">
          @if (updatedOn; as stamp) {
            <p class="reader-stamp">{{ label('updatedPrefix') }} {{ stamp }}</p>
          }
          <!-- The document's own H1 is the page heading: the file is the source of truth for what it is
               called, so repeating a title above it would be two places to keep in step. -->
          <app-markdown-text variant="document" [text]="guide.body" />
        </article>
      }
    </div>
  `,
  styles: [`
    .reader {
      padding: var(--pd-space-7);
      max-inline-size: var(--pd-reading-measure);
      margin-inline: auto;
    }
    .reader-bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-4);
      align-items: center;
      justify-content: space-between;
      margin-block-end: var(--pd-space-6);
      padding-block-end: var(--pd-space-4);
      border-block-end: 1px solid var(--pd-divider);
    }
    .reader-back {
      color: var(--pd-text-link);
      text-decoration: none;
      font-size: var(--pd-text-body-sm);
      display: inline-flex;
      align-items: center;
      gap: var(--pd-space-2);
    }
    .reader-back:hover { text-decoration: underline; }
    .reader-back:focus-visible { outline: none; box-shadow: var(--pd-ring); border-radius: var(--pd-radius-sm); }
    /* The arrow is a PHYSICAL glyph, so it is mirrored by layout direction rather than by content. */
    :host-context([dir='rtl']) .reader-back-icon,
    .reader[dir='rtl'] .reader-back-icon { transform: scaleX(-1); }
    .reader-lang {
      display: flex;
      gap: var(--pd-space-1);
      background: var(--pd-neutral-100);
      border-radius: var(--pd-radius-pill);
      padding: var(--pd-space-1);
    }
    .reader-lang-btn {
      border: 0;
      background: transparent;
      color: var(--pd-text-secondary);
      font: inherit;
      font-size: var(--pd-text-body-sm);
      padding: var(--pd-space-2) var(--pd-space-4);
      border-radius: var(--pd-radius-pill);
      cursor: pointer;
      min-block-size: 32px;
    }
    .reader-lang-btn:hover { color: var(--pd-text); }
    .reader-lang-btn:focus-visible { outline: none; box-shadow: var(--pd-ring); }
    .reader-lang-btn--active {
      background: var(--pd-surface);
      color: var(--pd-primary);
      font-weight: var(--pd-weight-semibold);
      box-shadow: var(--pd-shadow-1);
    }
    .reader-status { color: var(--pd-text-secondary); }
    .reader-failure {
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      padding: var(--pd-space-5);
      background: var(--pd-surface-sunken);
    }
    .reader-failure-title {
      margin: 0 0 var(--pd-space-2);
      font-weight: var(--pd-weight-semibold);
      color: var(--pd-neutral-900);
    }
    .reader-failure-body {
      margin: 0 0 var(--pd-space-4);
      color: var(--pd-text-secondary);
    }
    .reader-stamp {
      margin: 0 0 var(--pd-space-5);
      color: var(--pd-text-muted);
      font-size: var(--pd-text-caption);
    }
    @media (max-width: 520px) {
      .reader { padding: var(--pd-space-5); }
    }
  `],
})
export class GuideReaderComponent implements OnInit, OnDestroy {
  private readonly guides = inject(GuidesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  /** Chrome AND document language. Hebrew-default; carried in the URL so a link keeps it. */
  lang: ChatChromeLang = 'he';

  /** The guide id from the route. Held so a retry does not need the URL re-read. */
  guideId = '';

  loading = true;
  guide: GuideContentDto | null = null;

  /**
   * `missing` = no such guide; `language` = the guide exists but not in the language asked for;
   * `corpus` = the server answered 503, its own fault code for a corpus it could not read at all;
   * `network` = this client could not reach the server. Four sentences because they are four facts.
   */
  failure: 'missing' | 'language' | 'corpus' | 'network' | null = null;

  /** For the `language` failure: the language this guide DOES ship in, so the reader can offer it. */
  otherLanguage: ChatChromeLang | null = null;

  /**
   * The (id, language) pair the current view was fetched for.
   *
   * The route's id and its `lang` query parameter are read from ONE combined stream and de-duplicated
   * through this key, so an in-place navigation that changes only one of them issues exactly one
   * request. Two independent subscriptions would have fired two on first render, which is the shape of
   * duplicate-load bug this repo has fixed before.
   */
  private lastKey = '';

  /**
   * The inlet of the one pipeline every fetch goes through, retries included. `null` means "abandon
   * whatever is in flight and ask nothing", which is what the two early returns in `load()` need.
   */
  private readonly reads$ = new Subject<GuideRead | null>();

  ngOnInit(): void {
    // Subscribed BEFORE the route stream, which emits synchronously the moment it is subscribed: the
    // first navigation has to find this pipeline already listening or its read goes nowhere.
    this.reads$
      .pipe(
        switchMap(read => (read ? this.settle(read) : EMPTY)),
        takeUntil(this.destroy$),
      )
      .subscribe(result => {
        // Only the NEWEST read can reach here, so `this.lang` below is still the language that asked.
        if (result.error) this.applyFailure(result.error);
        else this.applyGuide(result.guide);
      });

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([params, query]) => {
        const id = params.get('guideId') ?? '';
        const lang = chatChromeLang(query.get('lang'));
        const key = `${id}|${lang}`;
        if (key === this.lastKey) return;
        this.lastKey = key;
        this.guideId = id;
        this.lang = lang;
        this.load();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  label(key: GuidesStringKey): string {
    return guidesString(this.lang, key);
  }

  get updatedOn(): string {
    return formatGuideDate(this.guide?.updated, this.lang);
  }

  /** Move the language in the URL; the subscription is what re-fetches the sibling file. */
  switchTo(lang: ChatChromeLang): void {
    if (lang === this.lang) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { lang },
      queryParamsHandling: 'merge',
    });
  }

  reload(): void {
    this.load();
  }

  private load(): void {
    if (!this.guideId) {
      // No guide was named, so none can be shown. Reuses `missing` rather than a fifth failure
      // value: the reader's honest state, not a distinct fact from "the guide does not exist".
      // The null read drops anything still in flight, and `loading` is lowered right here because
      // dropping the read also drops the handler that would otherwise have lowered it.
      this.reads$.next(null);
      this.loading = false;
      this.failure = 'missing';
      return;
    }

    // The corpus's own index document is this page's index, rendered properly. See the class doc.
    if (this.guideId === INDEX_GUIDE_ID) {
      // Same drop: a read this page has walked away from must not paint on the way out. `loading`
      // stays raised on purpose, because the navigation is what this page is now waiting for.
      this.reads$.next(null);
      void this.router.navigate(['/help'], { queryParams: { lang: this.lang }, replaceUrl: true });
      return;
    }

    this.loading = true;
    this.failure = null;
    this.otherLanguage = null;

    // The newest read wins by construction: the `switchMap` above unsubscribes the previous one, so a
    // slower answer for the language we just left has nothing left to land on. `loading` needs no
    // separate reset on this path, because the read that supersedes raises it and then settles it.
    this.reads$.next({ id: this.guideId, lang: this.lang });
  }

  /** One read, resolved to a value either way, so a failure cannot tear the long-lived pipeline down. */
  private settle(read: GuideRead): Observable<GuideReadResult> {
    return this.guides.get(read.id, read.lang).pipe(
      map(guide => ({ guide, error: null })),
      catchError((error: HttpErrorResponse) => of({ guide: null, error })),
    );
  }

  private applyGuide(guide: GuideContentDto | null): void {
    // Belt and braces for a corpus that grows another index-stage document later: it is still not
    // a page, and the redirect must not depend on one hardcoded id.
    if (guide?.stage === INDEX_STAGE) {
      void this.router.navigate(['/help'], { queryParams: { lang: this.lang }, replaceUrl: true });
      return;
    }
    this.guide = guide;
    this.loading = false;
  }

  private applyFailure(err: HttpErrorResponse): void {
    this.guide = null;
    this.loading = false;
    if (err.status === 404) {
      const available: string[] = err.error?.availableLanguages ?? [];
      const other = available.find(l => l !== this.lang);
      if (err.error?.error === 'guideLanguageUnavailable' && other) {
        this.failure = 'language';
        this.otherLanguage = other === 'en' ? 'en' : 'he';
      } else {
        this.failure = 'missing';
      }
      return;
    }
    // The server's own fault code for a corpus it could not read at all (see GuidesController):
    // an install problem, not a transport one, so it gets its own sentence and not "check your
    // connection". Mirrors HelpIndexComponent's split on the same status code.
    if (err.status === 503) {
      this.failure = 'corpus';
      return;
    }
    this.failure = 'network';
  }
}
