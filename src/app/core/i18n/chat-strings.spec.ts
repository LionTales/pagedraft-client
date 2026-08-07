/**
 * chat-strings invariants (chatbot phase A, c2).
 *
 * Map-level assertions, and deliberately NOT the whole of c2's coverage: a map can be perfectly
 * localized and never be read by the surface that renders it. The rendered-DOM counterpart lives in
 * `shared/product-chat/product-chat.component.spec.ts`.
 */
import {
  CHAT_STRINGS_EN,
  CHAT_STRINGS_HE,
  ChatStringKey,
  GUIDE_TITLES_EN,
  GUIDE_TITLES_HE,
  chatChromeLang,
  chatString,
  faultMessage,
  guideTitle,
} from './chat-strings';

describe('chat-strings (chatbot phase A)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(CHAT_STRINGS_HE).sort()).toEqual(Object.keys(CHAT_STRINGS_EN).sort());
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(CHAT_STRINGS_HE), ...Object.entries(CHAT_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(CHAT_STRINGS_HE), ...Object.entries(CHAT_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('the Hebrew CHROME strings really ARE Hebrew (no untranslated English left in the map)', () => {
      // Latin letters are the tell. Applied to the chrome map only: GUIDE_TITLES_HE is exempt on
      // purpose, because one guide's own Hebrew H1 contains the product name and the citation must
      // quote the document rather than paraphrase it.
      const untranslated = (Object.keys(CHAT_STRINGS_HE) as ChatStringKey[])
        .filter(k => /[A-Za-z]/.test(CHAT_STRINGS_HE[k]));
      expect(untranslated).toEqual([]);
    });

    it('carries NO string for a phase C feature (history, quota, customization)', () => {
      // The UI must not imply a capability that does not exist. A string is the first place one would
      // appear, so this is asserted where the strings live rather than left to review.
      //
      // A.1/w2 narrowed one term. The bare word "conversation" used to be banned outright, which was a
      // fine proxy while nothing in phase A could name a conversation at all; the reset control now
      // has to name the one being cleared. What is actually forbidden is the PERSISTENCE vocabulary -
      // a previous, saved or listed conversation - and that is what is banned below, so the check
      // still fails on the phase C surfaces and no longer fails on saying "clear this one".
      const forbidden =
        /histor|previous conversation|past conversation|saved conversation|conversation list|list of conversations|quota|token|credit|customi[sz]|settings|preference|היסטורי|שיחות קודמות|שיחות שמורות|רשימת שיחות|מכסה|טוקנ|הגדרות|התאמה אישית/i;
      const offenders = [...Object.entries(CHAT_STRINGS_HE), ...Object.entries(CHAT_STRINGS_EN)]
        .filter(([, v]) => forbidden.test(v))
        .map(([k]) => k);
      expect(offenders).toEqual([]);
    });
  });

  // ── Starting over (A.1, w2) ─────────────────────────────────────────────────────────────────────

  describe('the reset copy', () => {
    const resetKeys: ChatStringKey[] = [
      'newConversation',
      'newConversationBusy',
      'newConversationConfirm',
      'newConversationConfirmYes',
      'newConversationCancel',
    ];

    it('exists in BOTH languages, and the confirmation is not a bare OK', () => {
      // Non-vacuity first: the population these claims are about really is the five strings.
      expect(resetKeys.length).toBe(5);
      for (const k of resetKeys) {
        expect(CHAT_STRINGS_HE[k].trim().length).withContext(`he: ${k}`).toBeGreaterThan(0);
        expect(CHAT_STRINGS_EN[k].trim().length).withContext(`en: ${k}`).toBeGreaterThan(0);
      }
      // The destructive step must say what it does. "OK"/"Yes" alone leaves the author confirming a
      // question they may have stopped reading.
      expect(CHAT_STRINGS_EN['newConversationConfirmYes']).not.toMatch(/^(ok|yes)$/i);
      expect(CHAT_STRINGS_EN['newConversationConfirmYes']).not.toBe(CHAT_STRINGS_EN['newConversationCancel']);
      // And the trigger and the confirmation are different sentences, so the second click is not the
      // first one repeated.
      expect(CHAT_STRINGS_HE['newConversationConfirm']).not.toBe(CHAT_STRINGS_HE['newConversation']);
    });

    it('promises NO persistence: it clears, it never keeps, saves or reopens', () => {
      // The one place "conversation" is allowed to appear must still not imply phase C.
      const persistence = /sav(e|ed|ing)|keep|kept|store|restore|reopen|resume|archive|לשמור|נשמר|שמורה|לשחזר|היסטורי/i;
      for (const k of resetKeys) {
        expect(CHAT_STRINGS_HE[k]).withContext(`he: ${k}`).not.toMatch(persistence);
        expect(CHAT_STRINGS_EN[k]).withContext(`en: ${k}`).not.toMatch(persistence);
      }
    });
  });

  // ── The example chips (c01) ─────────────────────────────────────────────────────────────────────

  describe('the example chips', () => {
    const exampleKeys: ChatStringKey[] = ['example1', 'example2', 'example3'];

    /**
     * WHAT THIS CAN AND CANNOT PROVE. Clicking a chip sends its text verbatim to the server, where
     * `GuideSelector` scores it by whole-token matching against each guide's H1/H2 headings, plus a
     * bounded Hebrew single-affix tolerance on those headings (be-c02) that is worth less than an
     * exact match, so a chip is a retrieval input and its wording decides which guides reach the
     * model. That measurement is C#, it needs the shipped corpus, and it cannot run here.
     *
     * All six chips WERE measured through the real selector against the real corpus (c01, re-measured
     * after be-c02, both recorded in
     * `.cursor/plans/chatbot-phase-a-fixes-2026-08-06.plan.md`); each ranks its answering guide FIRST.
     * What this spec pins is the part reachable from the client: the exact strings that measurement
     * covered, so a reword cannot land without someone re-measuring, and the absence of the retired
     * stage vocabulary that made the measurement necessary in the first place.
     */
    it('are the exact strings c01 measured through the real selector', () => {
      expect(exampleKeys.length).toBe(3);
      expect(CHAT_STRINGS_HE['example1']).toBe('איך מייבאים כתב יד?');
      expect(CHAT_STRINGS_HE['example2']).toBe('מה נדרש כדי להריץ עריכה התפתחותית על הספר?');
      expect(CHAT_STRINGS_HE['example3']).toBe('מהם מעברי העריכה על פרק?');
      expect(CHAT_STRINGS_EN['example1']).toBe('How do I import a manuscript?');
      expect(CHAT_STRINGS_EN['example2']).toBe('What does the developmental review need first?');
      expect(CHAT_STRINGS_EN['example3']).toBe('Which editing passes does a chapter have?');
    });

    /**
     * e1 reconciled the corpus onto a five-stage vocabulary: the whole-book review became the
     * DEVELOPMENTAL review, and `סקירת` left the Hebrew corpus entirely. A chip written in the retired
     * words scores zero against the guide that answers it, which is exactly how `example2` reached its
     * answering guide only by a filename tie-break. Naming the retired words here keeps the chips and
     * the corpus from drifting apart again the way `GUIDE_TITLES_*` already did once.
     */
    it('speak the corpus\'s CURRENT stage vocabulary, not the retired one', () => {
      const retired = /whole-book review|book summar|סקיר/i;
      for (const k of exampleKeys) {
        expect(CHAT_STRINGS_HE[k]).withContext(`he: ${k}`).not.toMatch(retired);
        expect(CHAT_STRINGS_EN[k]).withContext(`en: ${k}`).not.toMatch(retired);
      }
      // Non-vacuity: the pattern really does catch the wording this test exists to keep out.
      expect('What has to run before the whole-book review?').toMatch(retired);
      expect('מה צריך לרוץ לפני סקירת הספר כולו?').toMatch(retired);
    });

    /**
     * A chip is a PROMISE about what the assistant can do, so none of them may name a surface the
     * guides do not cover: a chip whose honest answer is a refusal is worse than no chip. Each of the
     * three names a stage the corpus has a whole guide for (import, the developmental review, the
     * chapter editing passes).
     */
    it('each ask about a stage the shipped corpus actually has a guide for', () => {
      expect(CHAT_STRINGS_EN['example1']).toMatch(/import/i);
      expect(CHAT_STRINGS_EN['example2']).toMatch(/developmental review/i);
      expect(CHAT_STRINGS_EN['example3']).toMatch(/editing passes/i);
      expect(CHAT_STRINGS_HE['example1']).toMatch(/מייבאים/);
      expect(CHAT_STRINGS_HE['example2']).toMatch(/התפתחותית/);
      expect(CHAT_STRINGS_HE['example3']).toMatch(/מעברי העריכה/);
    });
  });

  describe('chatChromeLang', () => {
    it('is English ONLY for an explicitly English tag', () => {
      expect(chatChromeLang('en')).toBe('en');
      expect(chatChromeLang('en-US')).toBe('en');
      expect(chatChromeLang('  EN  ')).toBe('en');
    });

    it('defaults to Hebrew for Hebrew, blank, null, and any other language', () => {
      // App-level chrome is Hebrew-default, mirroring the Activity Center's convention.
      expect(chatChromeLang('he')).toBe('he');
      expect(chatChromeLang('')).toBe('he');
      expect(chatChromeLang(null)).toBe('he');
      expect(chatChromeLang(undefined)).toBe('he');
      expect(chatChromeLang('fr')).toBe('he');
    });
  });

  describe('chatString', () => {
    it('resolves from the requested language map', () => {
      expect(chatString('he', 'send')).toBe(CHAT_STRINGS_HE['send']);
      expect(chatString('en', 'send')).toBe('Send');
    });
  });

  describe('faultMessage', () => {
    const reasons = ['guides-unavailable', 'guides-empty', 'model-unavailable', 'empty-answer', 'network'];

    it('gives every documented reason its OWN sentence, in both languages', () => {
      // The whole point of the faultReason contract is that the reasons are DIFFERENT facts. If two of
      // them ever rendered the same sentence, the contract would be decorative.
      for (const lang of ['he', 'en'] as const) {
        const rendered = reasons.map(r => faultMessage(lang, r));
        // Non-vacuity first: prove the population is non-empty before asserting "no duplicates".
        expect(rendered.length).toBe(5);
        expect(rendered.every(s => s.trim().length > 0)).toBeTrue();
        expect(new Set(rendered).size)
          .withContext(`${lang}: two fault reasons collapsed into the same sentence`)
          .toBe(reasons.length);
      }
    });

    it('falls back to the generic sentence for an UNRECOGNIZED code, not to one of the four', () => {
      // A server that grows a fifth code must degrade to "could not ground it", never be
      // mis-explained as one of the reasons the client already knows.
      const generic = chatString('en', 'faultUnknown');
      expect(faultMessage('en', 'brand-new-code')).toBe(generic);
      expect(faultMessage('en', null)).toBe(generic);
      expect(faultMessage('en', undefined)).toBe(generic);
      for (const r of reasons) {
        expect(faultMessage('en', r)).not.toBe(generic);
      }
    });

    it('never offers an answer or an apology-shaped non-statement', () => {
      // A fail-safe must read as the assistant DECLINING to speak. "Something went wrong" would put
      // every reason in one bucket, which is the exact failure this contract exists to prevent.
      for (const lang of ['he', 'en'] as const) {
        for (const r of reasons) {
          expect(faultMessage(lang, r)).not.toMatch(/something went wrong|משהו השתבש/i);
        }
      }
    });
  });

  describe('guideTitle', () => {
    it('has the same id set in both languages', () => {
      expect(Object.keys(GUIDE_TITLES_HE).sort()).toEqual(Object.keys(GUIDE_TITLES_EN).sort());
    });

    it('covers every guide id the shipped corpus defines', () => {
      // Pinned against the corpus's actual frontmatter ids, so a guide added server-side without a
      // client title shows up here rather than as a raw slug in a citation.
      const shipped = [
        'workflow-overview', 'import', 'book-setup-and-intelligence', 'chapter-editing-passes',
        'whole-book-review', 'export', 'faq', 'guides-index',
      ];
      expect(shipped.length).toBeGreaterThan(0);
      for (const id of shipped) {
        expect(guideTitle('he', id)).withContext(`he: ${id}`).not.toBe(id);
        expect(guideTitle('en', id)).withContext(`en: ${id}`).not.toBe(id);
      }
    });

    it('falls back to the raw id rather than dropping an unknown guide', () => {
      // Dropping it would delete the only provenance the author has for that answer.
      expect(guideTitle('he', 'release-notes')).toBe('release-notes');
      expect(guideTitle('en', 'release-notes')).toBe('release-notes');
    });

    it('matches the H1 each shipped guide file actually carries (pinned, not read live)', () => {
      // GUIDE_TITLES_* claims to mirror the guide corpus's own H1s (see the docstring above the maps
      // in chat-strings.ts). This repo cannot read the API repo's Content/guides/*.md files at test
      // time - the two are separate git repos - so this is a PIN of the reconciled titles as of the
      // last time someone walked all 15 files by hand, not a live comparison. Its job is narrower but
      // still real: a future edit to either map (including a copy-edit that renames a guide's H1, the
      // way e1 renamed whole-book-review's) has to touch this test too, so the drift is a merge-time
      // decision rather than a silent stale citation. The OTHER half of the mirror lives in the API
      // repo, where a rename actually happens, and fails there naming this file:
      // ProductChatCorpusTests.EveryShippedGuidesFirstH1_IsWhatTheClientsCitationTitleMapMirrors.
      // Five of the Hebrew guide files open with a
      // "# DRAFT Hebrew stage vocabulary..." banner INSIDE the frontmatter fence; that banner is not
      // the title, and is not reflected below.
      const expected: Record<string, { he: string; en: string }> = {
        'workflow-overview':           { he: 'איך העבודה מתקדמת',                 en: 'How the work flows' },
        'import':                      { he: 'ייבוא כתב היד',                     en: 'Importing your manuscript' },
        'book-setup-and-intelligence': { he: 'מה PageDraft יודע על הספר שלכם',    en: 'What PageDraft knows about your book' },
        'chapter-editing-passes':      { he: 'מעברי העריכה על פרק',               en: 'The chapter editing passes' },
        'whole-book-review':           { he: 'העריכה ההתפתחותית',                 en: 'The developmental review' },
        'export':                      { he: 'ייצוא הספר',                       en: 'Exporting your book' },
        'faq':                         { he: 'שאלות שהעבודה מעלה',               en: 'Questions the work raises' },
        // guides-index has no dedicated Hebrew guide file (README.md is the sole, English-only
        // source); its Hebrew entry is a client-authored label, not a guide H1, so it is pinned
        // against the map's own current value rather than against a file that does not exist.
        'guides-index':                { he: GUIDE_TITLES_HE['guides-index'],     en: 'PageDraft guides' },
      };

      // Non-vacuity first: the ids checked here really are every id both maps carry.
      expect(Object.keys(expected).sort()).toEqual(Object.keys(GUIDE_TITLES_HE).sort());
      expect(Object.keys(expected).sort()).toEqual(Object.keys(GUIDE_TITLES_EN).sort());

      for (const id of Object.keys(expected)) {
        expect(GUIDE_TITLES_HE[id]).withContext(`he: ${id}`).toBe(expected[id].he);
        expect(GUIDE_TITLES_EN[id]).withContext(`en: ${id}`).toBe(expected[id].en);
      }
    });
  });
});
