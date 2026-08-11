import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subject, catchError, map, of, switchMap, takeUntil } from 'rxjs';

import { GuideListResponseDto, GuideSummaryDto } from '../../core/models/guide';
import { GuidesService } from '../../core/services/guides.service';
import { ChatChromeLang, chatChromeLang } from '../../core/i18n/chat-strings';
import { GuidesStringKey, formatGuideDate, guidesString, stageLabel } from '../../core/i18n/guides-strings';

/** One rendered group: a stage and the guides in it, in the corpus's own order. */
export interface GuideStageGroup {
  stage: string;
  label: string;
  guides: GuideSummaryDto[];
}

/**
 * The stage the corpus uses for its OWN index document (`README.md`, `id: guides-index`).
 *
 * That document is a markdown table of links between `.md` FILES. Rendered in the app those links point
 * at nothing, and the thing it is an index OF is this very page. So the index-stage document is not
 * listed here and the reader redirects to this page instead of rendering it. It is still served by the
 * API and still available to the chatbot, which is where it earns its keep.
 */
export const INDEX_STAGE = 'index';

/**
 * One settled read of the index.
 *
 * The failure travels as a VALUE, not as an error notification: the stream carrying it is long-lived,
 * and an error reaching its subscriber would complete it, leaving the retry button wired to nothing.
 */
interface IndexReadResult {
  list: GuideListResponseDto | null;
  error: HttpErrorResponse | null;
}

/**
 * THE GUIDES INDEX at `/help` (chatbot phase A.2, c1).
 *
 * ── Why this route exists ─────────────────────────────────────────────────────────────────────────
 * The product assistant has been citing guide ids at authors since phase A, at an author with no way to
 * open one. This page, and the reader beside it, are the other half of that citation: the chips now
 * navigate here. It is deliberately GENERAL rather than FAQ-shaped, because Wave 3's first-run
 * orientation is scheduled to read the same endpoint.
 *
 * ── Grouping ──────────────────────────────────────────────────────────────────────────────────────
 * By the frontmatter `stage`, in the order the server sends (the guides' numeric filename prefixes,
 * which ARE the workflow sequence they were authored in). Grouping is presentation only: no stage list
 * is hardcoded, so a guide added to the corpus appears here without a client release, and a stage this
 * build has no label for shows its raw slug rather than vanishing.
 *
 * ── Language ──────────────────────────────────────────────────────────────────────────────────────
 * App-level chrome, so HEBREW-DEFAULT like the dock. The corpus is bilingual and its two sides are
 * separately authored files, so the language is also a CONTENT choice, and it lives in the `lang` query
 * parameter: that makes it deep-linkable, survives a reload, and is carried into the reader by the
 * links below, so a reader who switched to English is not thrown back to Hebrew by opening a guide.
 * There is no global i18n service in this app to read an app language from (every surface hardcodes
 * `'he'`), so this toggle is the only switch, by necessity as well as by design.
 *
 * ── One read at a time ────────────────────────────────────────────────────────────────────────────
 * A language switch asks THIS page the same question twice, so the two answers can come back in either
 * order and `takeUntil(destroy$)` guards none of it: nothing was destroyed. Every fetch therefore goes
 * through `reads$` and a `switchMap`, which cancels the older read when a newer one is asked for, and
 * the language a read was issued for is remembered so a repeated query-parameter emission does not ask
 * the same question a second time in the first place. The reader page does the same.
 *
 * ── Honest failure ────────────────────────────────────────────────────────────────────────────────
 * A server that cannot read its own corpus answers 503 with a fault code, and this page says so
 * ("not present on this server, an install problem") rather than rendering an empty list. An empty
 * index and a missing corpus look identical on screen and are completely different problems; the same
 * distinction the chat's grounding contract rests on.
 */
@Component({
  selector: 'app-help-index',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="help" [attr.dir]="dir">
      <header class="help-header">
        <h1 class="help-title">{{ label('indexTitle') }}</h1>

        <!-- The language toggle is a real pair of buttons rather than a select: two options, both
             worth showing, and the pressed state says which one you are reading. -->
        <div class="help-lang" role="group" [attr.aria-label]="label('languageToggleLabel')">
          <button
            type="button"
            class="help-lang-btn"
            [class.help-lang-btn--active]="lang === 'he'"
            [attr.aria-pressed]="lang === 'he'"
            (click)="switchTo('he')">{{ label('readInHebrew') }}</button>
          <button
            type="button"
            class="help-lang-btn"
            [class.help-lang-btn--active]="lang === 'en'"
            [attr.aria-pressed]="lang === 'en'"
            (click)="switchTo('en')">{{ label('readInEnglish') }}</button>
        </div>
      </header>

      <p class="help-intro">{{ label('indexIntro') }}</p>

      @if (loading) {
        <p class="help-status" role="status">{{ label('loading') }}</p>
      } @else if (failure) {
        <div class="help-failure" role="status">
          <p class="help-failure-title">{{ label('loadFailedTitle') }}</p>
          <p class="help-failure-body">
            {{ failure === 'corpus' ? label('corpusUnavailable') : label('loadFailedBody') }}
          </p>
          <button type="button" class="pd-btn pd-btn-ghost" (click)="reload()">{{ label('retry') }}</button>
        </div>
      } @else if (groups.length === 0) {
        <p class="help-status">{{ label('indexEmpty') }}</p>
      } @else {
        @for (group of groups; track group.stage) {
          <section class="help-group">
            <h2 class="help-group-title">{{ group.label }}</h2>
            <ul class="help-list">
              @for (guide of group.guides; track guide.id) {
                <li class="help-item">
                  <a
                    class="help-item-link"
                    [routerLink]="['/help', guide.id]"
                    [queryParams]="{ lang: lang }">{{ guide.title }}</a>
                  @if (updatedOn(guide); as stamp) {
                    <span class="help-item-meta">{{ label('updatedPrefix') }} {{ stamp }}</span>
                  }
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .help {
      padding: var(--pd-space-7);
      max-inline-size: var(--pd-reading-measure);
      margin-inline: auto;
    }
    .help-header {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-4);
      justify-content: space-between;
      align-items: center;
      margin-block-end: var(--pd-space-4);
    }
    .help-title {
      margin: 0;
      font-size: var(--pd-text-h3);
      line-height: var(--pd-lh-h3);
      color: var(--pd-neutral-900);
    }
    .help-lang {
      display: flex;
      gap: var(--pd-space-1);
      background: var(--pd-neutral-100);
      border-radius: var(--pd-radius-pill);
      padding: var(--pd-space-1);
    }
    .help-lang-btn {
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
    .help-lang-btn:hover { color: var(--pd-text); }
    .help-lang-btn:focus-visible { outline: none; box-shadow: var(--pd-ring); }
    .help-lang-btn--active {
      background: var(--pd-surface);
      color: var(--pd-primary);
      font-weight: var(--pd-weight-semibold);
      box-shadow: var(--pd-shadow-1);
    }
    .help-intro {
      margin: 0 0 var(--pd-space-7);
      color: var(--pd-text-secondary);
      font-size: var(--pd-text-body-sm);
      line-height: var(--pd-lh-body-sm);
    }
    .help-status {
      color: var(--pd-text-secondary);
    }
    .help-failure {
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius-md);
      padding: var(--pd-space-5);
      background: var(--pd-surface-sunken);
    }
    .help-failure-title {
      margin: 0 0 var(--pd-space-2);
      font-weight: var(--pd-weight-semibold);
      color: var(--pd-neutral-900);
    }
    .help-failure-body {
      margin: 0 0 var(--pd-space-4);
      color: var(--pd-text-secondary);
    }
    .help-group {
      margin-block-end: var(--pd-space-8);
    }
    .help-group-title {
      margin: 0 0 var(--pd-space-3);
      font-size: var(--pd-text-caption);
      line-height: var(--pd-lh-caption);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--pd-text-secondary);
    }
    .help-list {
      list-style: none;
      margin: 0;
      padding: 0;
      border-block-start: 1px solid var(--pd-divider);
    }
    .help-item {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-2) var(--pd-space-4);
      align-items: baseline;
      justify-content: space-between;
      padding: var(--pd-space-4) var(--pd-space-2);
      border-block-end: 1px solid var(--pd-divider);
    }
    .help-item-link {
      color: var(--pd-text-link);
      text-decoration: none;
      font-size: var(--pd-text-body);
      font-weight: var(--pd-weight-medium);
    }
    .help-item-link:hover { text-decoration: underline; }
    .help-item-link:focus-visible { outline: none; box-shadow: var(--pd-ring); border-radius: var(--pd-radius-sm); }
    .help-item-meta {
      color: var(--pd-text-muted);
      font-size: var(--pd-text-caption);
    }

    /* Narrow viewport: the title and the toggle stop competing for one row, and a guide's stamp drops
       below its title instead of squeezing it. */
    @media (max-width: 520px) {
      .help { padding: var(--pd-space-5); }
      .help-header { align-items: flex-start; }
      .help-item { flex-direction: column; align-items: flex-start; gap: var(--pd-space-1); }
    }
  `],
})
export class HelpIndexComponent implements OnInit, OnDestroy {
  private readonly guides = inject(GuidesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  /** The chrome AND content language. Hebrew-default; moved by the toggle through the URL. */
  lang: ChatChromeLang = 'he';

  loading = true;

  /**
   * Why the page has nothing to show, or null. `corpus` is the server saying it could not read the
   * guides at all (503); `network` is this client failing to reach it. Different facts, different
   * sentences, and only one of them is worth retrying immediately.
   */
  failure: 'corpus' | 'network' | null = null;

  groups: GuideStageGroup[] = [];

  /** The inlet of the one pipeline every fetch goes through, the retry button included. */
  private readonly reads$ = new Subject<ChatChromeLang>();

  /**
   * The language the newest read was ISSUED for, null before the first one.
   *
   * Keyed on what was asked rather than on what is on screen, and null rather than `'he'` at the start,
   * so the first emission is a real load while a repeat emission of a language already being fetched is
   * not. The predicate this replaced (`next !== this.lang || this.loading`) got that backwards: it fired
   * a SECOND request for the same language precisely when one was already in flight.
   */
  private requestedLang: ChatChromeLang | null = null;

  ngOnInit(): void {
    // Subscribed BEFORE the route stream, which emits synchronously on subscription: the first
    // navigation has to find this pipeline already listening or its read goes nowhere.
    this.reads$
      .pipe(
        switchMap(lang => this.settle(lang)),
        takeUntil(this.destroy$),
      )
      .subscribe(result => {
        // Only the NEWEST read reaches here, so `this.lang` is still the language that asked for it.
        if (result.error) {
          // A 503 is the server's own fault code (the corpus did not ship); anything else is transport.
          this.failure = result.error.status === 503 ? 'corpus' : 'network';
          this.groups = [];
        } else {
          this.groups = groupByStage(result.list?.guides ?? [], this.lang);
        }
        this.loading = false;
      });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const next = chatChromeLang(params.get('lang'));
      this.lang = next;
      if (next !== this.requestedLang) this.load();
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

  /** The guide's frontmatter stamp, formatted; empty string when it has none. */
  updatedOn(guide: GuideSummaryDto): string {
    return formatGuideDate(guide.updated, this.lang);
  }

  /** Put the chosen language in the URL. The subscription above is what actually reloads. */
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
    this.loading = true;
    this.failure = null;
    this.requestedLang = this.lang;
    // The newest read wins by construction: the `switchMap` in ngOnInit drops the previous one, so an
    // answer for the language we just left has nothing to land on, neither a list nor a banner.
    this.reads$.next(this.lang);
  }

  /** One read, resolved to a value either way, so a failure cannot tear the long-lived pipeline down. */
  private settle(lang: ChatChromeLang): Observable<IndexReadResult> {
    return this.guides.list(lang).pipe(
      map(list => ({ list, error: null })),
      catchError((error: HttpErrorResponse) => of({ list: null, error })),
    );
  }
}

/**
 * Group an already-ordered index by stage, preserving the server's order both between groups (first
 * appearance) and within them. The index document's stage is dropped - see {@link INDEX_STAGE}.
 *
 * Exported for the spec: the grouping is the page's only real logic and is worth pinning without a
 * DOM.
 */
export function groupByStage(
  guides: readonly GuideSummaryDto[],
  lang: ChatChromeLang,
): GuideStageGroup[] {
  const groups: GuideStageGroup[] = [];
  const byStage = new Map<string, GuideStageGroup>();

  for (const guide of guides) {
    if (guide.stage === INDEX_STAGE) continue;
    const stage = guide.stage || '';
    let group = byStage.get(stage);
    if (!group) {
      group = { stage, label: stageLabel(lang, stage), guides: [] };
      byStage.set(stage, group);
      groups.push(group);
    }
    group.guides.push(guide);
  }

  return groups;
}
