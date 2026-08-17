/**
 * history-strings invariants (Show C1, c2).
 *
 * Map-level assertions, on the same pattern as `chat-strings.spec.ts` and for the same reason: a map
 * can be perfectly localized and never be read by the surface that renders it, so the rendered-DOM
 * counterpart lives in `shared/product-chat/conversation-history.component.spec.ts`.
 */
import {
  HISTORY_STRINGS_EN,
  HISTORY_STRINGS_HE,
  HistoryStringKey,
  conversationBookBadge,
  historyString,
} from './history-strings';
import { CHAT_STRINGS_HE } from './chat-strings';

describe('history-strings (Show C1)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(HISTORY_STRINGS_HE).sort()).toEqual(Object.keys(HISTORY_STRINGS_EN).sort());
      // Non-vacuity: an empty pair of maps would satisfy every claim in this describe.
      expect(Object.keys(HISTORY_STRINGS_HE).length).toBeGreaterThan(20);
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(HISTORY_STRINGS_HE), ...Object.entries(HISTORY_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(HISTORY_STRINGS_HE), ...Object.entries(HISTORY_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('the Hebrew strings really ARE Hebrew (no untranslated English left in the map)', () => {
      const untranslated = (Object.keys(HISTORY_STRINGS_HE) as HistoryStringKey[])
        .filter(k => /[A-Za-z]/.test(HISTORY_STRINGS_HE[k]));
      expect(untranslated).toEqual([]);
    });

    it('carries NO string for a capability that still does not exist (quota, customization)', () => {
      // C1 shipped history, so the persistence vocabulary is now true and is no longer banned anywhere.
      // A token/quota readout still needs a usage-metering backend that does not exist, and a string
      // here would imply it.
      const forbidden = /quota|token|credit|customi[sz]|מכסה|טוקנ|התאמה אישית/i;
      const offenders = [...Object.entries(HISTORY_STRINGS_HE), ...Object.entries(HISTORY_STRINGS_EN)]
        .filter(([, v]) => forbidden.test(v))
        .map(([k]) => k);
      expect(offenders).toEqual([]);
      expect('4,000 tokens left').toMatch(forbidden);
    });
  });

  describe('the destructive copy', () => {
    it('labels the second click with what it DOES, never a bare OK', () => {
      // Delete is a HARD delete with no undo, so the confirmation must not be a question the author can
      // dismiss without reading. Same rule the drawer's own two-step control follows.
      for (const map of [HISTORY_STRINGS_HE, HISTORY_STRINGS_EN]) {
        expect(map['historyDeleteYes']).not.toMatch(/^(ok|yes|כן)$/i);
        expect(map['historyDeleteYes']).not.toBe(map['historyDeleteCancel']);
        expect(map['historyDeleteConfirm']).not.toBe(map['historyDelete']);
      }
      expect(HISTORY_STRINGS_EN['historyDeleteYes']).toMatch(/delete/i);
      expect(HISTORY_STRINGS_HE['historyDeleteYes']).toMatch(/למחוק/);
    });

    it('says the delete is FINAL, because it is (no soft delete, no undo)', () => {
      expect(HISTORY_STRINGS_EN['historyDeleteConfirm']).toMatch(/for good|permanent/i);
      expect(HISTORY_STRINGS_HE['historyDeleteConfirm']).toMatch(/לצמיתות/);
    });
  });

  describe('the soft cap', () => {
    it('promises that nothing is deleted automatically, because nothing is', () => {
      // The cap is informational and enforced nowhere: authors keep notebooks, and this feature does
      // not get to decide which of an author's conversations stop mattering. Copy that read as a
      // warning about impending deletion would make the author tidy up under a threat that is not real.
      expect(HISTORY_STRINGS_EN['historyNearCap']).toMatch(/never (is )?deleted|nothing is ever deleted/i);
      expect(HISTORY_STRINGS_HE['historyNearCap']).toMatch(/לא נמחק/);
    });
  });

  describe('historyString', () => {
    it('resolves from the requested language map, Hebrew by default elsewhere', () => {
      expect(historyString('he', 'historyTitle')).toBe(HISTORY_STRINGS_HE['historyTitle']);
      expect(historyString('en', 'historyTitle')).toBe('Previous conversations');
    });
  });

  describe('conversationBookBadge', () => {
    const BOOK_A = 'book-a';
    const BOOK_B = 'book-b';

    it('is NULL for an app-level conversation', () => {
      // The case v1 checks by hand. A product question asked outside any book is the ordinary state of
      // this assistant, so its row carries no badge rather than one saying "no book".
      expect(conversationBookBadge('he', null, BOOK_A, 'A Study in Drafts')).toBeNull();
      expect(conversationBookBadge('en', null, null, null)).toBeNull();
    });

    it('NAMES the book when it is the one currently open', () => {
      expect(conversationBookBadge('en', BOOK_A, BOOK_A, 'A Study in Drafts')).toBe('A Study in Drafts');
    });

    it('falls back to the chat surface\'s own "this book" when the open book has no title yet', () => {
      // One fallback for the whole surface, so the badge and the context line above it cannot name the
      // same untitled book two different ways.
      expect(conversationBookBadge('he', BOOK_A, BOOK_A, null)).toBe(CHAT_STRINGS_HE['bookContextUnnamed']);
      expect(conversationBookBadge('he', BOOK_A, BOOK_A, '   ')).toBe(CHAT_STRINGS_HE['bookContextUnnamed']);
    });

    it('uses the GENERIC phrase for any other book, never a raw id', () => {
      // The list endpoint carries book ids and not titles, deliberately: it is the cheap projection
      // that never touches another table. A Guid in front of an author is worse than an honest general
      // label, which is the same rule the citation chips follow.
      const badge = conversationBookBadge('en', BOOK_B, BOOK_A, 'A Study in Drafts');
      expect(badge).toBe(HISTORY_STRINGS_EN['historyBookBadge']);
      expect(badge).not.toContain(BOOK_B);
    });
  });
});
