/**
 * Every user-facing string the product-chat drawer can put on screen (chatbot phase A, c2).
 *
 * ── Conventions this file inherits ─────────────────────────────────────────────────────────────────
 * Same shape as `run-strings.ts`, deliberately: {@link ChatStringKey} is a CLOSED union so a typo'd
 * key is a compile error rather than user-facing chrome, and both maps are `Record<ChatStringKey,
 * string>` so a key added to one language fails the build until the other has it too.
 *
 * The chatbot is APP-LEVEL chrome, not book-scoped, so it follows the Activity Center's convention
 * rather than the analysis surfaces': the language is the app language and the app language is
 * HEBREW-DEFAULT. A book's own language does not move it, because the drawer is reachable from every
 * route including ones where no book is open.
 *
 * Hebrew here is DRAFT and needs native-speaker review. No em-dash in any user-facing string; both
 * are pinned by `chat-strings.spec.ts`.
 *
 * ── What is deliberately absent ────────────────────────────────────────────────────────────────────
 * There is no string for a SAVED or PREVIOUS conversation, a conversation list or title, or a token or
 * quota count, or a "customize the assistant" affordance. Those are phase C, and the quota one
 * additionally needs a usage-metering backend that does not exist. A string here would imply the
 * feature exists, so none is written.
 *
 * The reset strings added in A.1 (w2) are the one place the word "conversation" appears, and they say
 * only that the CURRENT one is being cleared. Nothing in them offers to keep, name, list or reopen it,
 * because none of that exists; `chat-strings.spec.ts` pins that distinction rather than banning the
 * word outright.
 */

import { ProductChatFaultReason, isKnownFaultReason } from '../models/product-chat';

/** The two languages the chat chrome renders in. */
export type ChatChromeLang = 'he' | 'en';

/**
 * Normalize a language tag to the chat chrome's language.
 *
 * Hebrew is the default: only an explicitly English tag gets English chrome. Same rule as
 * `runChromeLang`, restated for this surface rather than imported, because the two answer different
 * questions - `runChromeLang` normalizes a BOOK's language, this one normalizes the APP's - and
 * collapsing them would make a future per-book chrome change silently move app-level chrome too.
 *
 * NO PRODUCTION CALLER YET: both `ProductChatComponent` and `AppDockComponent` currently hardcode
 * `appLang = 'he'` rather than deriving it, because there is no global i18n service to derive it FROM.
 * This is that service's stated normalizer, written ahead of the service itself; keep it rather than
 * deleting it as dead code (`chat-strings.spec.ts` covers it directly since nothing else does yet).
 */
export function chatChromeLang(language: string | null | undefined): ChatChromeLang {
  return (language ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'he';
}

/** Every string the chat drawer can show. Closed on purpose: a typo'd key does not compile. */
export type ChatStringKey =
  // ── chrome ──
  // `drawerTitle` is the surface's NAME, and it is what the dock's assistant tab is labelled with
  // (see `AppDockComponent.tabLabel`), so the tab and the panel it opens cannot drift apart. The
  // shell strings that used to sit beside it (launcher, close, widen) moved to `dock-strings.ts`
  // with the controls they name.
  | 'drawerTitle'
  | 'groundingNote'
  // ── composer ──
  | 'inputPlaceholder'
  | 'inputLabel'
  | 'send'
  // ── turns ──
  | 'roleUser'
  | 'roleAssistant'
  | 'inFlight'
  // ── citation (a feature, not a footnote: it is how the author learns the guides exist) ──
  | 'citationOne'
  | 'citationMany'
  // ── empty state ──
  | 'emptyTitle'
  | 'emptyBody'
  | 'emptyExamplesTitle'
  // The three example chips are NOT decoration: clicking one sends it verbatim to the server, where
  // `GuideSelector` scores it by whole-token matching against each guide's H1/H2 headings and its
  // frontmatter id/stage, plus (be-c02) a bounded Hebrew single-affix tolerance on the HEADINGS only,
  // which is worth less than an exact match and never applies to a Latin token. So a chip is a
  // retrieval input, and rewording one can silently drop the guide that answers it out of the four the
  // model is given. Each of these six was measured through the real selector against the shipped
  // corpus (c01, re-measured after be-c02); every one ranks its answering guide FIRST. If you reword a
  // chip, re-measure it - do not eyeball it. See `## Investigation findings` in
  // `.cursor/plans/chatbot-phase-a-fixes-2026-08-06.plan.md` for the numbers and the method.
  | 'example1'
  | 'example2'
  | 'example3'
  // ── starting over (A.1, w2): clears the IN-MEMORY transcript. Not history, not persistence ──
  // The confirmation is two strings, not one, because the destructive step must be labelled with what
  // it does rather than with a bare "OK": the author is throwing a conversation away.
  | 'newConversation'
  | 'newConversationBusy'
  | 'newConversationConfirm'
  | 'newConversationConfirmYes'
  | 'newConversationCancel'
  // ── honest failure (isGrounded === false, or a transport fault) ──
  | 'faultTitle'
  | 'faultGuidesUnavailable'
  | 'faultGuidesEmpty'
  | 'faultModelUnavailable'
  | 'faultEmptyAnswer'
  | 'faultNetwork'
  | 'faultUnknown'
  | 'retry';

/**
 * Hebrew chat chrome. DRAFT he - needs native review.
 *
 * Addressed in the plural ("שאלו", "נסו"), matching the register the rest of this app's Hebrew chrome
 * already uses.
 */
export const CHAT_STRINGS_HE: Record<ChatStringKey, string> = {
  drawerTitle:       'עוזר המדריכים',
  groundingNote:     'עונה רק מתוך מדריכי המערכת, ותמיד מציין מאיזה מדריך.',

  inputPlaceholder:  'שאלו על אופן העבודה במערכת',
  inputLabel:        'השאלה שלכם',
  send:              'שליחה',

  roleUser:          'אתם',
  roleAssistant:     'העוזר',
  inFlight:          'מחפש במדריכים...',

  citationOne:       'מתוך המדריך',
  citationMany:      'מתוך המדריכים',

  emptyTitle:        'שאלו אותי איך העבודה מתנהלת',
  emptyBody:         'אני עונה רק ממה שכתוב במדריכים של המערכת. אם המדריכים לא מכסים את השאלה, אומר זאת במקום לנחש.',
  emptyExamplesTitle: 'לדוגמה',
  example1:          'איך מייבאים כתב יד?',
  example2:          'מה נדרש כדי להריץ עריכה התפתחותית על הספר?',
  example3:          'מהם מעברי העריכה על פרק?',

  newConversation:          'שיחה חדשה',
  newConversationBusy:      'אפשר להתחיל שיחה חדשה אחרי שהתשובה תגיע.',
  newConversationConfirm:   'לנקות את השיחה הנוכחית?',
  newConversationConfirmYes: 'כן, לנקות',
  newConversationCancel:    'ביטול',

  faultTitle:        'לא הצלחתי לענות מתוך המדריכים',
  faultGuidesUnavailable: 'לא הצלחתי להגיע למדריכים כרגע, ולכן לא אענה מהזיכרון שלי. נסו שוב בעוד רגע.',
  faultGuidesEmpty:  'המדריכים נטענו אבל אף אחד מהם לא נקרא, ולכן אין לי מקור לענות ממנו.',
  faultModelUnavailable: 'המדריכים נמצאו, אבל העוזר לא הגיב. לא אנחש תשובה במקומו.',
  faultEmptyAnswer:  'המדריכים נמצאו, אבל התשובה שחזרה הייתה ריקה. לא אמלא אותה בעצמי.',
  faultNetwork:      'לא הצלחתי להגיע לשרת. בדקו את החיבור ונסו שוב.',
  faultUnknown:      'לא ניתן היה לבסס תשובה על המדריכים כרגע.',
  retry:             'ניסיון חוזר',
};

export const CHAT_STRINGS_EN: Record<ChatStringKey, string> = {
  drawerTitle:       'Guides assistant',
  groundingNote:     'Answers only from the product guides, and always names which one.',

  inputPlaceholder:  'Ask how the work is done here',
  inputLabel:        'Your question',
  send:              'Send',

  roleUser:          'You',
  roleAssistant:     'Assistant',
  inFlight:          'Looking through the guides...',

  citationOne:       'From the guide',
  citationMany:      'From the guides',

  emptyTitle:        'Ask me how the work flows',
  emptyBody:         'I answer only from what the product guides say. If the guides do not cover your question, I will say so instead of guessing.',
  emptyExamplesTitle: 'For example',
  example1:          'How do I import a manuscript?',
  example2:          'What does the developmental review need first?',
  example3:          'Which editing passes does a chapter have?',

  newConversation:          'New conversation',
  newConversationBusy:      'You can start a new conversation once this answer arrives.',
  newConversationConfirm:   'Clear the current conversation?',
  newConversationConfirmYes: 'Yes, clear it',
  newConversationCancel:    'Cancel',

  faultTitle:        'I could not answer from the guides',
  faultGuidesUnavailable: 'I could not reach the guides right now, so I will not answer from memory. Try again in a moment.',
  faultGuidesEmpty:  'The guides loaded but none of them could be read, so I have no source to answer from.',
  faultModelUnavailable: 'The guides were found, but the assistant did not respond. I will not guess in its place.',
  faultEmptyAnswer:  'The guides were found, but the answer came back empty. I will not fill it in myself.',
  faultNetwork:      'I could not reach the server. Check the connection and try again.',
  faultUnknown:      'The answer could not be grounded in the guides right now.',
  retry:             'Try again',
};

/** Resolve one chat string in the given chrome language. */
export function chatString(lang: ChatChromeLang, key: ChatStringKey): string {
  return (lang === 'he' ? CHAT_STRINGS_HE : CHAT_STRINGS_EN)[key];
}

/** Where each server-documented fault code's sentence lives. Keyed by the closed union, not a switch. */
const FAULT_REASON_KEYS: Record<ProductChatFaultReason, ChatStringKey> = {
  'guides-unavailable': 'faultGuidesUnavailable',
  'guides-empty':       'faultGuidesEmpty',
  'model-unavailable':  'faultModelUnavailable',
  'empty-answer':       'faultEmptyAnswer',
};

/**
 * The user-facing sentence for a server fault code.
 *
 * Every documented code has its OWN sentence, and the difference between them is load-bearing: an
 * unreachable corpus and an unresponsive model are different facts, and only one of them means "try
 * again in a moment". An UNRECOGNIZED code (a server that grew a fifth one) falls back to the generic
 * `faultUnknown` rather than to any of the four, so a new server code can never be mis-explained as
 * one of the old ones. {@link isKnownFaultReason} is the narrowing that makes that fallback real rather
 * than aspirational: an unrecognized wire value fails the guard and falls through to `faultUnknown`
 * instead of silently matching nothing in a switch.
 *
 * `'network'` is handled FIRST and separately, because it is not one of the server's documented codes
 * at all - it is this client's own label for a transport failure (see `ProductChatComponent`), and it
 * is not a member of {@link ProductChatFaultReason}. It must keep its own sentence rather than falling
 * into the unknown-code branch alongside a genuine server surprise.
 *
 * Note what none of these sentences do: none of them offers an answer. A fail-safe is the assistant
 * declining to speak, and the copy has to sound like declining, not like a smaller answer.
 */
export function faultMessage(lang: ChatChromeLang, reason: string | null | undefined): string {
  if (reason === 'network') return chatString(lang, 'faultNetwork');
  if (isKnownFaultReason(reason)) return chatString(lang, FAULT_REASON_KEYS[reason]);
  return chatString(lang, 'faultUnknown');
}

/**
 * Guide id -> the guide's own title, per language.
 *
 * The ids are the server's citation contract and are LANGUAGE-NEUTRAL: an en/he guide pair shares one
 * id, which is exactly why a lookup table is possible at all. The titles are the H1 each guide file
 * actually carries, so the citation names the document the way the author would see it rather than
 * inventing a label for it. ONE EXCEPTION, because the map cannot mirror a file that does not exist:
 * `guides-index` ships only as the English `README.md`, so its HEBREW entry is a client-authored label
 * rather than a guide H1.
 *
 * THIS IS A CROSS-REPO MIRROR AND IT HAS GONE STALE ONCE (f01): e1's copy-edit renamed two guide H1s
 * in the API repo and these entries kept naming the retired stage. The pin in `chat-strings.spec.ts`
 * catches an edit made HERE; what catches a rename THERE is
 * `Pagedraft.Api.Tests/ProductChatCorpusTests.EveryShippedGuidesFirstH1_IsWhatTheClientsCitationTitleMapMirrors`,
 * which fails in the API PR and names this file. Both halves are needed - neither repo can read the
 * other at test time - so a title change is a two-repo edit by construction.
 *
 * A guide id with no entry here is NOT an error and must not be dropped from the citation: an id the
 * client has never heard of is still a real, shipped document, and hiding it would delete the one
 * piece of provenance the author has. {@link guideTitle} falls back to the raw id.
 *
 * Unlike the chrome maps above, the Hebrew side here is allowed Latin characters: one guide's own
 * Hebrew title contains the product name. That is the source document's wording, not chrome copy.
 */
export const GUIDE_TITLES_HE: Record<string, string> = {
  'workflow-overview':           'איך העבודה מתקדמת',
  'import':                      'ייבוא כתב היד',
  'book-setup-and-intelligence': 'מה PageDraft יודע על הספר שלכם',
  'chapter-editing-passes':      'מעברי העריכה על פרק',
  'whole-book-review':           'העריכה ההתפתחותית',
  'export':                      'ייצוא הספר',
  'faq':                         'שאלות שהעבודה מעלה',
  'guides-index':                'מדריכי PageDraft',
};

export const GUIDE_TITLES_EN: Record<string, string> = {
  'workflow-overview':           'How the work flows',
  'import':                      'Importing your manuscript',
  'book-setup-and-intelligence': 'What PageDraft knows about your book',
  'chapter-editing-passes':      'The chapter editing passes',
  'whole-book-review':           'The developmental review',
  'export':                      'Exporting your book',
  'faq':                         'Questions the work raises',
  'guides-index':                'PageDraft guides',
};

/**
 * The display title for a cited guide id, falling back to the id itself.
 *
 * The fallback is the point: the citation must survive a corpus that grew a guide this build has
 * never seen. A raw id ("release-notes") reads a little technical, and that is strictly better than a
 * citation that silently omits the guide the answer actually came from.
 */
export function guideTitle(lang: ChatChromeLang, id: string): string {
  const map = lang === 'he' ? GUIDE_TITLES_HE : GUIDE_TITLES_EN;
  return map[id] ?? id;
}
