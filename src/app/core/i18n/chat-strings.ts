/**
 * Every user-facing string the product-chat drawer can put on screen (chatbot phase A, c2).
 *
 * ── Identity (chatbot phase A.2, f1; f02 dropped the in-pane header) ──────────────────────────────
 * The assistant is named Show / שואו, carried by `drawerTitle` (see its own doc comment) and repeated
 * by `roleAssistant` on every one of its turns and by `inFlight` while it is working, so the name
 * follows the assistant everywhere it speaks rather than sitting only on the tab. Its face (resized
 * from the 1.5 MB source at `.cursor/designs/show.png` into two assets: `show-tab.png` at the dock's
 * assistant tab, `show-header.png` at the closed dock's launcher and at the chat's empty state) never
 * renders twice on one screen. f1 also put a copy at `ProductChatComponent`'s own in-pane header;
 * f02's live-browser pass found that one stacked about 60px below the tab, the same face and the same
 * name rendered twice on the one screen that shows either of them, so the header copy was removed
 * rather than kept. The tab is the one that survives a scroll and reads as the assistant's persistent
 * identity; the empty state (which wears the face itself, f03) and `roleAssistant` still name Show
 * before and after the first turn, so nothing is lost by dropping the header. This is IDENTITY only: no
 * prompt text and no server behavior changed here (see the chatbot-phase-a2-show plan, f1's scope
 * fence).
 *
 * ── Voice (chatbot phase A.2, c2) ──────────────────────────────────────────────────────────────────
 * The chrome speaks in the FIRST PERSON, as Show, everywhere it speaks at all: the grounding note, the
 * empty state, the citation label and every fault sentence. That is a register decision with one
 * substantive reason behind it - a refusal is this assistant's normal, correct behaviour, and copy that
 * describes the surface in the third person ("Answers only from the product guides") makes a refusal
 * read like a malfunction, where "I answer from the product guides only" makes it read like the promise
 * being kept. The empty state is the only place that framing is stated BEFORE the first refusal
 * happens, so it carries the honesty sentence rather than a feature list.
 *
 * WHAT THIS LAYER MAY NOT DO: it may not reword a refusal. The refusal TEXT is the server's, governed
 * by the system prompt and measured by the g1-g5 gate; what lives here is only the framing around it.
 * The example chips are likewise off limits without a re-measurement, for the retrieval reason spelled
 * out on their keys below.
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

import {
  BookChatFaultReason,
  ProductChatFaultReason,
  isKnownBookFaultReason,
  isKnownFaultReason,
} from '../models/product-chat';
import { ChatArtifactRef, chapterDisplayNumber } from '../models/chat-artifact-ref';

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
  // `drawerTitle` is the surface's NAME - "Show" / "שואו" (chatbot phase A.2, f1) - and it is what
  // the dock's assistant tab is labelled with (see `AppDockComponent.tabLabel`), and what the empty
  // state's greeting and `roleAssistant` repeat inside the pane so the name still surfaces without a
  // second header duplicating the tab (f02). The shell strings that used to sit beside it (launcher,
  // close, widen) moved to `dock-strings.ts` with the controls they name.
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
  | 'retry'
  // ── BOOK CONTEXT (phase B) ─────────────────────────────────────────────────────────────────────
  // The compact line under the dock's tab that states WHICH book the assistant is looking at. It is a
  // FACT, not a control: `bookContextLabel` reads as a statement and there is no affordance beside it,
  // because the way to change which book Show sees is to be in a different book.
  // The standing promise at the foot of the pane, RESTATED for a book-scoped turn. Phase A's
  // `groundingNote` says the assistant answers from the product guides ONLY, which stopped being true
  // the moment a bookId could ride on a request: inside a book it also answers from the manuscript's
  // own artifacts. Leaving the phase-A sentence up inside a book would make the one line whose whole
  // job is to say where answers come from the one line that is wrong about it.
  | 'groundingNoteBook'
  // f01 (review finding #5): two more strings whose whole job is naming where an answer comes from
  // shipped un-twinned, the same way `groundingNote` initially did. `emptyBodyBook` replaces the
  // empty-state greeting on every book-scoped first turn where briefs already exist - `showBookEmptyState`
  // only diverts to the tutoring copy (`emptyBookBody`) when briefs are NOT built, so a book with briefs
  // was still greeted with phase A's "guides only" sentence. `inFlightBook` replaces the pending row,
  // shown while a book-scoped request (carrying book artifacts) is in flight. Both are keyed off the same
  // `book` condition the template already reads at the grounding note.
  | 'emptyBodyBook'
  | 'inFlightBook'
  | 'bookContextLabel'
  // The title has not landed yet (or its read failed). The line still states the fact - a book IS open -
  // rather than vanishing and re-appearing, which would read as a flicker rather than as a state.
  | 'bookContextUnnamed'
  | 'bookContextAria'
  // ── THE CHAPTER on the context line (phase B, a2) ──────────────────────────────────────────────
  // Once Show can answer about the chapter in front of the author, the line that says what it is
  // looking at has to say WHICH CHAPTER, or the author cannot tell an answer about this chapter from an
  // answer about the book. Same visual language as the book beside it: a fact, no affordance.
  // `bookContextChapterAria` names the chapter half for a screen reader, since the two values sit in
  // one line with only a separator between them.
  | 'bookContextChapterAria'
  // A chapter with no title of its own still has to be nameable, so it falls back to the number the
  // author counts by ({0} is the 1-based display number, never the 0-based wire order).
  | 'bookContextChapterUnnamed'
  // ── THE CLARIFYING QUESTION's chips (phase B, a2, d2 section (5)) ──────────────────────────────
  // Rendered when the server says the question was about a chapter and none resolved. The label
  // introduces the chips; each chip is one chapter, and clicking it RE-ASKS the same question scoped to
  // that chapter, so answering costs a tap rather than a retyped sentence. Never rendered when a
  // chapter resolved, and never on a book with one chapter (both halves enforce that).
  | 'clarifyLabel'
  // The tag on the author's own turn saying which chapter that turn was scoped to, for a turn re-asked
  // from a chip. Only there: for an ordinary turn the context line above already says it.
  | 'askedAboutChapter'
  // ── The book-switch marker in the transcript (phase B) ─────────────────────────────────────────
  // DECISION: a book switch KEEPS the transcript and inserts a visible marker. See the component doc
  // for the reasoning. These are the two shapes: entering/switching to a named book, and leaving every
  // book for app-level ground.
  | 'bookMarkerNow'
  | 'bookMarkerLeft'
  // ── Book-artifact citations (phase B) ──────────────────────────────────────────────────────────
  // A SEPARATE label from the guide citation, because the two say different things about where an
  // answer came from and collapsing them would blur exactly the distinction the grounding contract is
  // built on: one is the product's documentation, the other is the author's own manuscript.
  // ONE key, not the singular/plural PAIR the guide citation has: the guide label names a count
  // ("in the guide" / "across the guides") and this one names a SOURCE, which does not inflect.
  | 'citationBook'
  // The per-artifact chip names. Chapter-keyed ones are built by `artifactChipLabel`, which fills in
  // the chapter NUMBER the author counts by (see `chat-artifact-ref.ts`'s order decision).
  | 'artifactChapterBrief'
  | 'artifactChapterSummary'
  | 'artifactChapterText'
  | 'artifactFinding'
  | 'artifactRegister'
  | 'artifactBookBrief'
  | 'artifactHistory'
  | 'artifactStatusSummary'
  | 'artifactStatusReview'
  | 'artifactStatusBaseline'
  // ── A book half that came back THIN (phase B) ──────────────────────────────────────────────────
  // Rendered on a GROUNDED answer, because that is what a partial book fault is: the answer stands and
  // one source of it was unreadable. It is a note attached to a real answer, never a failure block.
  | 'bookThinNote'
  // ── Book fail-safe sentences (phase B) ─────────────────────────────────────────────────────────
  | 'faultBookUnavailable'
  | 'faultBookRegister'
  | 'faultBookBriefs'
  | 'faultBookStatus'
  | 'faultBookFindings'
  | 'faultBookEscalation'
  | 'faultBookHistory'
  // ── The tutoring empty state (phase B) ─────────────────────────────────────────────────────────
  // Inside a book with NOTHING built, this replaces the app-level greeting. It is the tutoring surface,
  // so it says what is missing, what Show can do once it exists, and carries the real build action.
  | 'emptyBookTitle'
  | 'emptyBookBody'
  | 'emptyBookBuild'
  | 'emptyBookExamplesTitle'
  | 'bookExample1'
  | 'bookExample2'
  | 'bookExample3';

/**
 * Hebrew chat chrome. DRAFT he - needs native review.
 *
 * Addressed in the plural ("שאלו", "נסו"), matching the register the rest of this app's Hebrew chrome
 * already uses.
 */
export const CHAT_STRINGS_HE: Record<ChatStringKey, string> = {
  drawerTitle:       'שואו',
  groundingNote:     'אני עונה רק מתוך מדריכי המערכת, ותמיד אומר מאיזה מדריך.',

  inputPlaceholder:  'שאלו אותי איך משהו כאן עובד',
  inputLabel:        'השאלה שלכם',
  send:              'שליחה',

  roleUser:          'אתם',
  roleAssistant:     'שואו',
  inFlight:          'שואו מחפש במדריכים...',

  citationOne:       'מצאתי את זה במדריך',
  citationMany:      'מצאתי את זה במדריכים',

  emptyTitle:        'שלום, אני שואו',
  emptyBody:         'אני מכיר את המערכת מתוך המדריכים שלה, ועונה רק מתוכם. אם הם לא מכסים את השאלה, אומר לכם ולא אנחש.',
  emptyExamplesTitle: 'אפשר להתחיל מאחת מאלה',
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
  faultGuidesEmpty:  'המדריכים כאן, אבל לא הצלחתי לקרוא אף אחד מהם, ולכן אין לי ממה לענות.',
  faultModelUnavailable: 'המדריכים לפניי, אבל המנוע שכותב את התשובות שלי לא הגיב. לא אנחש במקומו.',
  faultEmptyAnswer:  'המדריכים לפניי, אבל התשובה חזרה ריקה. לא אמלא אותה בעצמי.',
  faultNetwork:      'לא הצלחתי להגיע לשרת. בדקו את החיבור ונסו שוב.',
  faultUnknown:      'לא הצלחתי לבסס תשובה על המדריכים כרגע.',
  retry:             'ניסיון חוזר',

  groundingNoteBook:   'כאן אני עונה מתוך מדריכי המערכת ומתוך מה שכבר נבנה על הספר שלכם, ותמיד אומר מאיפה.',
  emptyBodyBook:       'אני מכיר את המערכת מתוך המדריכים שלה, וגם את הספר הזה מתוך מה שכבר נבנה עליו, ועונה מתוך שניהם. אם הם לא מכסים את השאלה, אומר לכם ולא אנחש.',
  inFlightBook:        'שואו מחפש במדריכים ובספר שלכם...',
  bookContextLabel:    'הספר שלפניי',
  bookContextUnnamed:  'הספר הזה',
  bookContextAria:     'הספר שהעוזר רואה כעת',
  bookContextChapterAria:     'הפרק שהעוזר רואה כעת',
  bookContextChapterUnnamed:  'פרק {0}',

  clarifyLabel:        'על איזה פרק שאלתם?',
  askedAboutChapter:   'על {0}',

  bookMarkerNow:       'מכאן והלאה אני מסתכל על {0}.',
  bookMarkerLeft:      'מכאן והלאה אני מחוץ לספר, ואענה רק על המערכת עצמה.',

  citationBook:        'מתוך הספר שלכם',

  artifactChapterBrief:   'תקציר פרק {0}',
  artifactChapterSummary: 'הסיכום שלכם לפרק {0}',
  artifactChapterText:    'הטקסט של פרק {0}',
  artifactFinding:        'ממצא מהסקירה',
  artifactRegister:       'מרשם הדמויות',
  artifactBookBrief:      'תקציר הספר',
  artifactHistory:        'מה כבר הרצתם',
  artifactStatusSummary:  'מצב תקצירי הספר',
  artifactStatusReview:   'מצב העריכה ההתפתחותית',
  artifactStatusBaseline: 'מצב סגנון הכתיבה',

  bookThinNote:        'חלק ממה שאני קורא על הספר לא היה זמין הפעם, ולכן התשובה הזו דקה מהרגיל.',

  faultBookUnavailable: 'לא הצלחתי לראות את הספר שלכם כרגע, ולכן לא אענה עליו מתוך ניחוש. נסו שוב בעוד רגע.',
  faultBookRegister:    'לא הצלחתי לקרוא את מרשם הדמויות של הספר, ולכן לא אענה על הדמויות מהזיכרון שלי.',
  faultBookBriefs:      'לא הצלחתי לקרוא את תקצירי הספר, ולכן אין לי ממה לענות עליו.',
  faultBookStatus:      'לא הצלחתי לקרוא את מצב הבניות של הספר, ולכן לא אומר לכם מה כדאי להריץ עכשיו.',
  faultBookFindings:    'לא הצלחתי לקרוא את ממצאי הסקירה, ולכן לא אתאר מה היא מצאה.',
  faultBookEscalation:  'רציתי לקרוא את הפרק עצמו ולא הצלחתי, ולכן לא אתאר מה כתוב בו.',
  faultBookHistory:     'לא הצלחתי לקרוא מה הורץ על הספר, ולכן לא אומר לכם מה כבר עשיתם.',

  emptyBookTitle:      'עוד לא בניתם תקצירים לספר הזה',
  emptyBookBody:       'אני יכול לראות את הספר שלכם ברגע שהתקצירים ייבנו. עד אז אענה על המערכת עצמה מתוך המדריכים.',
  emptyBookBuild:      'בנו את תקצירי הספר',
  emptyBookExamplesTitle: 'אחר כך אפשר לשאול אותי דברים כאלה',
  bookExample1:        'מה קורה בפרק 3?',
  bookExample2:        'מה הסקירה מצאה על הקצב?',
  bookExample3:        'מה כדאי לי להריץ עכשיו?',
};

export const CHAT_STRINGS_EN: Record<ChatStringKey, string> = {
  drawerTitle:       'Show',
  groundingNote:     'I answer from the product guides only, and I always name the one I used.',

  inputPlaceholder:  'Ask me how something here works',
  inputLabel:        'Your question',
  send:              'Send',

  roleUser:          'You',
  roleAssistant:     'Show',
  inFlight:          'Show is looking through the guides...',

  citationOne:       'I found this in the guide',
  citationMany:      'I found this across the guides',

  emptyTitle:        'Hello, I am Show',
  emptyBody:         'I know this product from its guides, and I answer only from those. If they do not cover your question, I will tell you rather than guess.',
  emptyExamplesTitle: 'You could start with one of these',
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
  faultGuidesEmpty:  'The guides are here, but I could not read any of them, so I have nothing to answer from.',
  faultModelUnavailable: 'I have the guides in front of me, but the model that writes my answers did not respond. I will not guess in its place.',
  faultEmptyAnswer:  'I have the guides in front of me, but the answer came back empty. I will not fill it in myself.',
  faultNetwork:      'I could not reach the server. Check the connection and try again.',
  faultUnknown:      'I could not ground an answer in the guides right now.',
  retry:             'Try again',

  groundingNoteBook:   'Here I answer from the product guides and from what has already been built about your book, and I always name my source.',
  emptyBodyBook:       'I know this product from its guides, and I also know this book from what has already been built about it, and I answer from both. If they do not cover your question, I will tell you rather than guess.',
  inFlightBook:        'Show is looking through the guides and your book...',
  bookContextLabel:    'The book I can see',
  bookContextUnnamed:  'this book',
  bookContextAria:     'The book the assistant can currently see',
  bookContextChapterAria:     'The chapter the assistant can currently see',
  bookContextChapterUnnamed:  'Chapter {0}',

  clarifyLabel:        'Which chapter did you mean?',
  askedAboutChapter:   'About {0}',

  bookMarkerNow:       'From here on I am looking at {0}.',
  bookMarkerLeft:      'From here on I am outside any book, so I can only answer about the product.',

  citationBook:        'From your book',

  artifactChapterBrief:   'Chapter {0} brief',
  artifactChapterSummary: 'Your summary of chapter {0}',
  artifactChapterText:    'Chapter {0} text',
  artifactFinding:        'A review finding',
  artifactRegister:       'Character register',
  artifactBookBrief:      'The book brief',
  artifactHistory:        'What you have run',
  artifactStatusSummary:  'Book briefs status',
  artifactStatusReview:   'Developmental review status',
  artifactStatusBaseline: 'Writing style status',

  bookThinNote:        'Some of what I read about your book was not available this time, so this answer is thinner than usual.',

  faultBookUnavailable: 'I could not see your book right now, so I will not answer about it from guesswork. Try again in a moment.',
  faultBookRegister:    'I could not read your book\'s character register, so I will not answer about its characters from memory.',
  faultBookBriefs:      'I could not read your book briefs, so I have nothing to answer about the book from.',
  faultBookStatus:      'I could not read your book\'s build state, so I will not tell you what to run next.',
  faultBookFindings:    'I could not read the review findings, so I will not describe what the review found.',
  faultBookEscalation:  'I meant to read the chapter itself and could not, so I will not describe what is in it.',
  faultBookHistory:     'I could not read what has been run on your book, so I will not tell you what you have already done.',

  emptyBookTitle:      'This book has no briefs yet',
  emptyBookBody:       'I can see your book once its briefs are built. Until then I answer about the product itself, from the guides.',
  emptyBookBuild:      'Build the book briefs',
  emptyBookExamplesTitle: 'Afterwards you could ask me things like these',
  bookExample1:        'What happens in chapter 3?',
  bookExample2:        'What did the review say about pacing?',
  bookExample3:        'What should I run next?',
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
  // Phase B: the BOOK fail-safe path reports its own code through the SAME `faultReason` field (the
  // server sets both fields there), so these have to be resolved here or a real, documented refusal
  // would read as an unknown surprise. They are checked after the phase-A codes, which cannot collide
  // with them, so nothing about A's rendering moves.
  if (isKnownBookFaultReason(reason)) return chatString(lang, BOOK_FAULT_REASON_KEYS[reason]);
  return chatString(lang, 'faultUnknown');
}

/** Where each BOOK fault code's sentence lives (phase B). Keyed by the closed union, not a switch. */
const BOOK_FAULT_REASON_KEYS: Record<BookChatFaultReason, ChatStringKey> = {
  'book-unavailable':      'faultBookUnavailable',
  'register-unreadable':   'faultBookRegister',
  'briefs-unreadable':     'faultBookBriefs',
  'status-unavailable':    'faultBookStatus',
  'findings-unreadable':   'faultBookFindings',
  'escalation-unreadable': 'faultBookEscalation',
  'history-unreadable':    'faultBookHistory',
};

/**
 * The transcript's BOOK-SWITCH MARKER (phase B).
 *
 * `title` null renders "this book" rather than a Guid or an empty gap, matching the context line's own
 * fallback, so a marker written before the title landed still says something true.
 */
export function bookSwitchMarker(lang: ChatChromeLang, title: string | null): string {
  const named = title?.trim() || chatString(lang, 'bookContextUnnamed');
  return chatString(lang, 'bookMarkerNow').replace('{0}', named);
}

/** The marker for LEAVING every book. No title to interpolate: that is the whole content of it. */
export function bookLeftMarker(lang: ChatChromeLang): string {
  return chatString(lang, 'bookMarkerLeft');
}

/**
 * How a chapter is NAMED wherever this surface names one (phase B, a2): on the context line, on a
 * clarify chip and on the "about" tag of a turn re-asked from one.
 *
 * THE TITLE FIRST, and the number only as a fallback, on one substantive ground: the title is what the
 * author sees in the chapter tree and is how they identify the chapter they are looking at, while the
 * number is bookkeeping. Leading with both ("Chapter 1: פרק 28") reads badly on the commonest real
 * shape, where the title IS a chapter number and rarely the same one - the owner's own book is a single
 * chapter at order 0 titled "פרק 28", so a number-first label would put "פרק 1" in front of "פרק 28"
 * and invite the author to wonder which of the two Show meant.
 *
 * An UNTITLED chapter falls back to the number the author counts by. `chapterDisplayNumber` is the one
 * conversion, exactly as it is for citation chips, so a chapter can never be labelled by one numbering
 * here and another there.
 */
export function ambientChapterName(
  lang: ChatChromeLang,
  chapter: { order: number; title: string }
): string {
  const title = chapter.title?.trim();
  if (title) return title;
  return chatString(lang, 'bookContextChapterUnnamed')
    .replace('{0}', String(chapterDisplayNumber(chapter.order)));
}

/** Which string names each keyless artifact kind. Chapter-keyed kinds are handled by the label below. */
const ARTIFACT_KEYS: Record<string, ChatStringKey> = {
  'chapter-brief':   'artifactChapterBrief',
  'chapter-summary': 'artifactChapterSummary',
  'chapter-text':    'artifactChapterText',
  'finding':         'artifactFinding',
  'register':        'artifactRegister',
  'book-brief':      'artifactBookBrief',
  'history':         'artifactHistory',
};

const STATUS_KEYS: Record<string, ChatStringKey> = {
  'summary':        'artifactStatusSummary',
  'review':         'artifactStatusReview',
  'style-baseline': 'artifactStatusBaseline',
};

/**
 * The visible name of a book-artifact chip.
 *
 * THE FALLBACK IS THE RAW REF, on exactly the rule {@link guideTitle} follows: an artifact type this
 * build has never heard of is still a real thing the answer was grounded in, and showing its slug is
 * strictly better than deleting the author's only trace of where that part of the answer came from.
 *
 * Chapter numbers are the AUTHOR'S numbering, not the wire's. The refs carry `Chapter.Order`, which is
 * 0-based; `chapterDisplayNumber` is the single conversion, so the label and the destination can never
 * disagree about which chapter is meant.
 */
export function artifactChipLabel(lang: ChatChromeLang, ref: ChatArtifactRef): string {
  if (!ref.kind) return ref.raw;

  if (ref.kind === 'status') {
    const key = ref.statusKind ? STATUS_KEYS[ref.statusKind] : undefined;
    return key ? chatString(lang, key) : ref.raw;
  }

  const key = ARTIFACT_KEYS[ref.kind];
  if (!key) return ref.raw;

  const label = chatString(lang, key);
  return ref.chapterOrder === null
    ? label
    : label.replace('{0}', String(chapterDisplayNumber(ref.chapterOrder)));
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
