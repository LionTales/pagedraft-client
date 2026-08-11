/**
 * The guides INDEX at `/help` (chatbot phase A.2, c1).
 *
 * The route the assistant's citations, the dock and the books list all lead to. What is pinned here is
 * what an author actually sees: the corpus grouped by stage in the guides' own order, in the language
 * they asked for, with a link per guide - plus the two failure states that must not look like each
 * other ("no guides on this server" is an install fault, not an empty product).
 *
 * NON-VACUITY: every rendering assertion below is preceded by a real COUNT, because an index page is
 * exactly the surface where "no errors" and "nothing rendered" look the same.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { HelpIndexComponent, groupByStage } from './help-index.component';
import { GuideSummaryDto } from '../../core/models/guide';
import { GUIDES_STRINGS_EN, GUIDES_STRINGS_HE, stageLabel } from '../../core/i18n/guides-strings';

function guide(over: Partial<GuideSummaryDto> = {}): GuideSummaryDto {
  return {
    id: 'import',
    stage: 'import',
    audience: 'author',
    language: 'he',
    title: 'ייבוא כתב היד',
    updated: '2026-08-02',
    order: 10,
    ...over,
  };
}

/** A small, realistically-shaped corpus: two stages, one of them with two guides, plus the index doc. */
function corpus(language = 'he'): GuideSummaryDto[] {
  return [
    guide({ id: 'workflow-overview', stage: 'overview', order: 0, language, title: 'איך העבודה מתקדמת' }),
    guide({ id: 'import', stage: 'import', order: 10, language, title: 'ייבוא כתב היד' }),
    guide({ id: 'import-extra', stage: 'import', order: 11, language, title: 'עוד על ייבוא' }),
    guide({ id: 'guides-index', stage: 'index', order: 2147483647, language, title: 'מדריכי PageDraft' }),
  ];
}

describe('HelpIndexComponent (chatbot phase A.2, c1)', () => {
  let fixture: ComponentFixture<HelpIndexComponent>;
  let component: HelpIndexComponent;
  let http: HttpTestingController;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function setLang(lang: string | null): void {
    queryParams.next(convertToParamMap(lang === null ? {} : { lang }));
  }

  function flushIndex(guides: GuideSummaryDto[], language = 'he'): void {
    const req = http.expectOne(r => r.url === '/api/guides' && r.params.get('language') === language);
    req.flush({ guides, count: guides.length, fault: null });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({}));

    await TestBed.configureTestingModule({
      imports: [HelpIndexComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpIndexComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  // ── The index itself ────────────────────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('groups the corpus by stage, in the order the server sent, with one link per guide', () => {
      flushIndex(corpus());

      const groups = fixture.debugElement.queryAll(By.css('.help-group'));
      expect(groups.length)
        .withContext('two stages should render (the index-stage document is not one)')
        .toBe(2);

      expect(groups[0].query(By.css('.help-group-title')).nativeElement.textContent.trim())
        .toBe(stageLabel('he', 'overview'));
      expect(groups[1].query(By.css('.help-group-title')).nativeElement.textContent.trim())
        .toBe(stageLabel('he', 'import'));

      // The stage with two guides keeps both, in the server's order.
      const second = groups[1].queryAll(By.css('.help-item-link'));
      expect(second.length).toBe(2);
      expect(second.map(a => a.nativeElement.textContent.trim()))
        .toEqual(['ייבוא כתב היד', 'עוד על ייבוא']);

      // NON-VACUITY: the page really rendered the whole corpus, not a subset that happened to group.
      const all = fixture.debugElement.queryAll(By.css('.help-item-link'));
      expect(all.length).toBe(3);
    });

    it('links each guide to its reader page, carrying the current language', () => {
      flushIndex(corpus());

      const first = fixture.debugElement.query(By.css('.help-item-link')).nativeElement as HTMLAnchorElement;
      expect(first.getAttribute('href')).toBe('/help/workflow-overview?lang=he');
    });

    it('shows each guide\'s own updated stamp, formatted rather than raw', () => {
      flushIndex(corpus());

      const meta = fixture.debugElement.queryAll(By.css('.help-item-meta'));
      expect(meta.length).toBe(3);
      // Not the raw ISO string from the frontmatter.
      expect(meta[0].nativeElement.textContent).not.toContain('2026-08-02');
      expect(meta[0].nativeElement.textContent).toContain(GUIDES_STRINGS_HE['updatedPrefix']);
    });

    it('does NOT list the corpus\'s own index document: this page IS that index', () => {
      flushIndex(corpus());

      const titles = fixture.debugElement.queryAll(By.css('.help-item-link'))
        .map(a => a.nativeElement.textContent.trim());
      expect(titles).not.toContain('מדריכי PageDraft');
    });

    it('says so when the corpus really is empty', () => {
      flushIndex([]);

      expect(fixture.debugElement.queryAll(By.css('.help-item-link')).length).toBe(0);
      expect(fixture.debugElement.query(By.css('.help-status')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['indexEmpty']);
    });
  });

  // ── Language ────────────────────────────────────────────────────────────────────────────────────

  describe('language', () => {
    it('defaults to Hebrew and lays out RTL', () => {
      flushIndex(corpus());

      expect(component.lang).toBe('he');
      expect(fixture.debugElement.query(By.css('.help')).nativeElement.getAttribute('dir')).toBe('rtl');
      expect(fixture.debugElement.query(By.css('.help-title')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['indexTitle']);
    });

    it('follows the lang query parameter: English chrome, LTR, and the English side of the corpus', () => {
      flushIndex(corpus());
      setLang('en');
      fixture.detectChanges();
      flushIndex(corpus('en'), 'en');

      expect(component.lang).toBe('en');
      expect(fixture.debugElement.query(By.css('.help')).nativeElement.getAttribute('dir')).toBe('ltr');
      expect(fixture.debugElement.query(By.css('.help-title')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_EN['indexTitle']);
      expect(fixture.debugElement.queryAll(By.css('.help-group-title'))[0].nativeElement.textContent.trim())
        .toBe(stageLabel('en', 'overview'));
    });

    it('the toggle moves the language through the URL, so a link keeps it', () => {
      flushIndex(corpus());
      const router = TestBed.inject(Router);
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);

      const buttons = fixture.debugElement.queryAll(By.css('.help-lang-btn'));
      expect(buttons.length).toBe(2);
      buttons[1].nativeElement.click();

      expect(navigate).toHaveBeenCalled();
      expect(navigate.calls.mostRecent().args[1]?.queryParams).toEqual({ lang: 'en' });
    });

    it('marks the language being read as pressed', () => {
      flushIndex(corpus());

      const buttons = fixture.debugElement.queryAll(By.css('.help-lang-btn'));
      expect(buttons[0].nativeElement.getAttribute('aria-pressed')).toBe('true');
      expect(buttons[1].nativeElement.getAttribute('aria-pressed')).toBe('false');
    });
  });

  // ── Two answers to one question ─────────────────────────────────────────────────────────────────
  //
  // The first read is still in flight when each of these starts (the shared `beforeEach` mounts the page
  // and deliberately does not flush), because the in-flight window IS the defect. Flushing first would
  // close it, and the specs would then pass against a page that supersedes nothing.

  describe('a superseded read', () => {
    it('does not ask again for the language it is already loading', () => {
      // A query-parameter emission for the SAME language is the same question. Angular re-emits on any
      // merged navigation, and asking twice is how two answers for one language end up racing at all.
      setLang(null);
      fixture.detectChanges();

      const pending = http.match(r => r.url === '/api/guides');
      expect(pending.length).withContext('one language, one read').toBe(1);

      pending[0].flush({ guides: corpus(), count: 4, fault: null });
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('.help-item-link')).length).toBe(3);
    });

    it('keeps the language now being read when the abandoned one answers LAST', () => {
      setLang('en');
      fixture.detectChanges();

      const pending = http.match(r => r.url === '/api/guides');
      expect(pending.length).withContext('both reads should be open before either answers').toBe(2);
      const [stale, fresh] = pending;
      expect(stale.request.params.get('language')).toBe('he');
      expect(fresh.request.params.get('language')).toBe('en');

      fresh.flush({ guides: corpus('en'), count: 4, fault: null });
      fixture.detectChanges();

      // A superseded read is cancelled, and a cancelled request can be neither flushed nor errored, so
      // the abandoned read answers only when the page left it open. That is the case worth pinning: its
      // failure belongs to a language nobody is reading any more.
      if (!stale.cancelled) {
        stale.error(new ProgressEvent('network error'));
        fixture.detectChanges();
      }

      expect(component.failure)
        .withContext('a banner for the language the page has already left')
        .toBeNull();
      expect(fixture.debugElement.query(By.css('.help-failure'))).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.help-item-link')).length).toBe(3);
      expect(component.loading).toBeFalse();
    });
  });

  // ── Honest failure ──────────────────────────────────────────────────────────────────────────────

  describe('failure', () => {
    it('a 503 says the guides are MISSING FROM THE SERVER, not that there are none', () => {
      http.expectOne(r => r.url === '/api/guides')
        .flush({ guides: [], count: 0, fault: 'guides-unavailable' },
               { status: 503, statusText: 'Service Unavailable' });
      fixture.detectChanges();

      expect(component.failure).toBe('corpus');
      expect(fixture.debugElement.query(By.css('.help-failure-body')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['corpusUnavailable']);
      // Emphatically NOT the empty-corpus sentence: those are different problems.
      expect(fixture.nativeElement.textContent).not.toContain(GUIDES_STRINGS_HE['indexEmpty']);
    });

    it('a transport failure says so separately, and retry asks again', () => {
      http.expectOne(r => r.url === '/api/guides').error(new ProgressEvent('network error'));
      fixture.detectChanges();

      expect(component.failure).toBe('network');
      expect(fixture.debugElement.query(By.css('.help-failure-body')).nativeElement.textContent.trim())
        .toBe(GUIDES_STRINGS_HE['loadFailedBody']);

      fixture.debugElement.query(By.css('.help-failure button')).nativeElement.click();
      flushIndex(corpus());

      expect(component.failure).toBeNull();
      expect(fixture.debugElement.queryAll(By.css('.help-item-link')).length).toBe(3);
    });
  });

});

// ── The grouping, without a DOM ───────────────────────────────────────────────────────────────────
//
// Its own top-level suite: it needs no TestBed, and mounting the component for a pure-function test
// would leave an unflushed request behind for the shared http.verify().

describe('groupByStage (chatbot phase A.2, c1)', () => {
  it('preserves the incoming order both between and within groups', () => {
    const groups = groupByStage(corpus(), 'he');

    expect(groups.map(g => g.stage)).toEqual(['overview', 'import']);
    expect(groups[1].guides.map(g => g.id)).toEqual(['import', 'import-extra']);
  });

  it('drops the corpus\'s own index document, which this page replaces', () => {
    expect(groupByStage(corpus(), 'he').some(g => g.stage === 'index')).toBeFalse();
  });

  it('labels a stage it has never heard of with the raw slug rather than dropping the guide', () => {
    const groups = groupByStage([guide({ id: 'x', stage: 'release-notes' })], 'en');

    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe('release-notes');
    expect(groups[0].guides.length).toBe(1);
  });
});
