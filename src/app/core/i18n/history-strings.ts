/**
 * Every user-facing string of the CONVERSATION HISTORY surface (Show C1, c2).
 *
 * ── Why its own file rather than more keys in `chat-strings.ts` ───────────────────────────────────
 * The same rule that moved the launcher, close and widen strings into `dock-strings.ts` when those
 * controls moved to the dock: STRINGS TRAVEL WITH THE CONTROL THEY NAME. History is its own component
 * (`ConversationHistoryComponent`), it is the only reader of these, and `chat-strings.ts` is already
 * near this repo's ~700-line soft ceiling.
 *
 * ── What C1 changed about the phase-A boundary ────────────────────────────────────────────────────
 * `chat-strings.ts` used to state, and pin, that NO string anywhere may name a previous, saved or
 * listed conversation, because none of that existed and a string would have implied a feature that was
 * not there. C1 built the feature: conversations are persisted, listed, resumable, renameable and
 * deletable. So this file exists and says so plainly. What is still absent, and still must be, is the
 * QUOTA vocabulary - tokens, credits, usage - which needs a metering backend that does not exist.
 *
 * ── Conventions this file inherits ─────────────────────────────────────────────────────────────────
 * Same shape as `chat-strings.ts` and `run-strings.ts`: {@link HistoryStringKey} is a CLOSED union so a
 * typo'd key is a compile error, and both maps are `Record<HistoryStringKey, string>` so a key added to
 * one language fails the build until the other has it too.
 *
 * App-level chrome, so HEBREW-DEFAULT and RTL-first, following the drawer this surface lives inside:
 * it is reachable from every route, including ones where no book is open, so there is no book language
 * to follow.
 *
 * Hebrew here is DRAFT and needs native-speaker review (recorded in
 * `src/docs/HEBREW_NATIVE_REVIEW.md`). No em-dash in any user-facing string; both are pinned by
 * `history-strings.spec.ts`.
 */

import { ChatChromeLang, chatString } from './chat-strings';

/** Every string the history panel can show. Closed on purpose: a typo'd key does not compile. */
export type HistoryStringKey =
  // ── the affordance on Show's own tab ──
  // The control that OPENS the panel, and the one that goes back to the conversation. Two strings
  // rather than one toggling label, because the second is not the negation of the first: leaving
  // history returns you to a specific conversation, and saying so is what tells the author the
  // transcript underneath was not thrown away.
  //
  // There is deliberately NO aria variant of the trigger. One existed and was removed by sweep01: an
  // `aria-label` replaces a button's computed name instead of adding to it, so it discarded the visible
  // label, and in Hebrew the two were not substrings of each other. The visible label names the control.
  | 'historyTrigger'
  | 'historyBack'
  // ── the panel ──
  | 'historyTitle'
  | 'historyLoading'
  | 'historyEmpty'
  | 'historyEmptyBook'
  | 'historyLoadError'
  | 'historyRetry'
  // ── one row ──
  // `historyOpenItem` is the row's own action. `historyCurrent` marks the conversation already on
  // screen, so resuming the one you are reading is visibly not on offer.
  | 'historyOpenItem'
  | 'historyCurrent'
  | 'historyMessages'
  // A book-scoped conversation gets a badge; an app-level one gets none, because "no book" is the
  // ordinary state of a product question and a badge saying so would turn it into a remark. The list
  // endpoint carries book IDS and not titles, so a conversation in a book OTHER than the open one is
  // named generically rather than with a title this surface cannot resolve.
  | 'historyBookBadge'
  // ── the book filter ──
  | 'historyFilterAll'
  | 'historyFilterBook'
  // ── paging (newest first, so "previous" is NEWER) ──
  | 'historyNewer'
  | 'historyOlder'
  | 'historyPage'
  // ── rename ──
  | 'historyRename'
  | 'historyRenameLabel'
  | 'historyRenameSave'
  | 'historyRenameCancel'
  | 'historyRenameBlank'
  | 'historyRenameError'
  // ── delete, two-step like the drawer's own destructive control ──
  | 'historyDelete'
  | 'historyDeleteConfirm'
  | 'historyDeleteYes'
  | 'historyDeleteCancel'
  | 'historyDeleteError'
  // ── the soft cap: informational, enforced nowhere ──
  | 'historyNearCap'
  // ── resuming ──
  | 'historyResuming'
  | 'historyResumeError';

/**
 * Hebrew history chrome. DRAFT he - needs native review.
 *
 * Addressed in the plural ("שאלו", "נסו"), matching the register the rest of this app's Hebrew chrome
 * already uses, and speaking about Show in the first person wherever Show is the one speaking, which is
 * the voice `chat-strings.ts` established.
 */
export const HISTORY_STRINGS_HE: Record<HistoryStringKey, string> = {
  historyTrigger:      'שיחות קודמות',
  historyBack:         'חזרה לשיחה',

  historyTitle:        'שיחות קודמות',
  historyLoading:      'טוען את השיחות...',
  historyEmpty:        'עוד אין כאן שיחות. כל שיחה נשמרת מרגע השאלה הראשונה, ואפשר לחזור אליה מכאן.',
  historyEmptyBook:    'עוד אין שיחות על הספר הזה. אפשר לעבור לכל השיחות ולראות את השאר.',
  historyLoadError:    'לא הצלחתי לטעון את השיחות. נסו שוב בעוד רגע.',
  historyRetry:        'ניסיון חוזר',

  historyOpenItem:     'פתיחת השיחה',
  historyCurrent:      'פתוחה עכשיו',
  historyMessages:     '{0} הודעות',
  historyBookBadge:    'שיחה על ספר',

  historyFilterAll:    'כל השיחות',
  historyFilterBook:   'רק הספר הזה',

  historyNewer:        'חדשות יותר',
  historyOlder:        'ישנות יותר',
  historyPage:         'עמוד {0}',

  historyRename:       'שינוי שם',
  historyRenameLabel:  'שם השיחה',
  historyRenameSave:   'שמירת השם',
  historyRenameCancel: 'ביטול',
  historyRenameBlank:  'צריך שם כדי לשמור.',
  historyRenameError:  'לא הצלחתי לשנות את השם. נסו שוב בעוד רגע.',

  historyDelete:       'מחיקה',
  historyDeleteConfirm: 'למחוק את השיחה הזו לצמיתות?',
  historyDeleteYes:    'כן, למחוק',
  historyDeleteCancel: 'ביטול',
  historyDeleteError:  'לא הצלחתי למחוק את השיחה. נסו שוב בעוד רגע.',

  historyNearCap:      'הצטברו כאן הרבה שיחות. שום דבר לא נמחק מעצמו, אבל אולי תרצו לסדר.',

  historyResuming:     'פותח את השיחה...',
  historyResumeError:  'לא הצלחתי לפתוח את השיחה. השיחה שעל המסך נשארה כמו שהיא.',
};

export const HISTORY_STRINGS_EN: Record<HistoryStringKey, string> = {
  historyTrigger:      'Previous conversations',
  historyBack:         'Back to the conversation',

  historyTitle:        'Previous conversations',
  historyLoading:      'Loading your conversations...',
  historyEmpty:        'Nothing here yet. A conversation is kept from your first question onward, and you can come back to it here.',
  historyEmptyBook:    'No conversations about this book yet. Switch to all conversations to see the rest.',
  historyLoadError:    'I could not load your conversations. Try again in a moment.',
  historyRetry:        'Try again',

  historyOpenItem:     'Open this conversation',
  historyCurrent:      'Open now',
  historyMessages:     '{0} messages',
  historyBookBadge:    'A book conversation',

  historyFilterAll:    'All conversations',
  historyFilterBook:   'This book only',

  historyNewer:        'Newer',
  historyOlder:        'Older',
  historyPage:         'Page {0}',

  historyRename:       'Rename',
  historyRenameLabel:  'Conversation name',
  historyRenameSave:   'Save the name',
  historyRenameCancel: 'Cancel',
  historyRenameBlank:  'A name is needed to save.',
  historyRenameError:  'I could not rename it. Try again in a moment.',

  historyDelete:       'Delete',
  historyDeleteConfirm: 'Delete this conversation for good?',
  historyDeleteYes:    'Yes, delete it',
  historyDeleteCancel: 'Cancel',
  historyDeleteError:  'I could not delete it. Try again in a moment.',

  historyNearCap:      'A lot of conversations have built up here. Nothing is ever deleted on its own, but you may want to tidy up.',

  historyResuming:     'Opening the conversation...',
  historyResumeError:  'I could not open that conversation. The one on screen is untouched.',
};

/** Resolve one history string in the given chrome language. */
export function historyString(lang: ChatChromeLang, key: HistoryStringKey): string {
  return (lang === 'he' ? HISTORY_STRINGS_HE : HISTORY_STRINGS_EN)[key];
}

/**
 * A row's badge, or null when the conversation is app-level.
 *
 * NULL IS THE POINT, and it is the case v1 checks by hand: a product question asked outside any book is
 * the ordinary state of this assistant, so its row carries no badge at all rather than one saying "no
 * book", which would turn a normal condition into a remark.
 *
 * The badge NAMES the book only when it is the one currently open, because that is the only title this
 * surface can resolve: the list endpoint carries book ids, deliberately (it is the cheap projection
 * that never touches another table). Any other book gets the generic phrase rather than a Guid, on the
 * same rule the citation chips follow - a raw identifier in front of an author is worse than an honest
 * general label.
 */
export function conversationBookBadge(
  lang: ChatChromeLang,
  bookId: string | null,
  currentBookId: string | null,
  currentBookTitle: string | null
): string | null {
  if (!bookId) return null;
  if (bookId === currentBookId) {
    return currentBookTitle?.trim() || chatString(lang, 'bookContextUnnamed');
  }
  return historyString(lang, 'historyBookBadge');
}
