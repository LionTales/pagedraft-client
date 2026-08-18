/**
 * Every user-facing string of the FEEDBACK surfaces (Show C2, c2-client): the shared vote widget, the
 * owner's triage view, and (e2) the entry link that finally makes the triage view reachable by clicking.
 *
 * ── Why its own file ──────────────────────────────────────────────────────────────────────────────
 * The rule `history-strings.ts` and `dock-strings.ts` already follow: STRINGS TRAVEL WITH THE CONTROL
 * THEY NAME. The widget is deliberately not a chat component - it is mounted on Show's answers first and
 * on a proofread suggestion card next - so putting its copy in `chat-strings.ts` would tie the reusable
 * half of this feature to the one surface it happens to have been mounted on first.
 *
 * ── Conventions inherited ─────────────────────────────────────────────────────────────────────────
 * {@link FeedbackStringKey} is a CLOSED union, so a typo'd key is a compile error, and both maps are
 * `Record<FeedbackStringKey, string>`, so a key added to one language fails the build until the other
 * has it too. App-level chrome, so HEBREW-DEFAULT and RTL-first: both surfaces are reachable with no
 * book open, so there is no book language to follow.
 *
 * Hebrew here is DRAFT and needs native-speaker review (recorded in `src/docs/HEBREW_NATIVE_REVIEW.md`,
 * "the Show C2 group"). No em-dash in any user-facing string; both are pinned by
 * `feedback-strings.spec.ts`.
 *
 * ── One vocabulary rule this file enforces by construction ────────────────────────────────────────
 * The STATUS TOKENS on the wire (`New`, `Triaged`, `ConfirmedBug`, `Dismissed`, `Fixed`) are never shown
 * to a reader. {@link feedbackStatusLabel} is the only way a status reaches a template, so the triage
 * view cannot accidentally render a stored token where a Hebrew word belongs. Same for the verdicts.
 */

import { ChatChromeLang } from './chat-strings';
import { FEEDBACK_TEXT_MAX, FeedbackStatus, FeedbackVerdict } from '../models/feedback';

/** Every string the two feedback surfaces can show. Closed on purpose. */
export type FeedbackStringKey =
  // ── the affordance that opens the triage view, wherever it is mounted (e2) ──
  // Here rather than in the dashboard's own label map, on the rule `helpLink` already follows in
  // `guides-strings.ts`: the affordance is named by the SURFACE IT OPENS, so a second mount site cannot
  // end up calling the same page something else.
  | 'entryLink'
  | 'entryLinkAria'
  // ── the widget ──
  // The pair of thumbs. `Aria` variants exist because the buttons are ICON-ONLY: a glyph has no
  // computed name, so unlike the history trigger (whose visible label names it) these genuinely need
  // one, and there is no visible text for an aria-label to discard.
  | 'voteUpAria'
  | 'voteDownAria'
  | 'voteRetractAria'
  // The note. Offered automatically on a down-vote (that is when a reader has something to say) and on
  // demand otherwise, which is why the affordance has its own label as well.
  | 'noteAdd'
  | 'noteEdit'
  | 'noteTitle'
  | 'notePlaceholder'
  | 'noteSave'
  | 'noteCancel'
  | 'noteCounter'
  | 'noteTooLong'
  | 'noteSaving'
  // Outcomes. The thank-you is the only positive confirmation; the failure notice is NON-BLOCKING and
  // says the vote did not land, because the widget has already reverted to the state the server holds.
  | 'voteThanks'
  | 'voteFailed'
  | 'retractFailed'
  // ── the triage view ──
  | 'triageTitle'
  | 'triageIntro'
  | 'triagePrivacy'
  | 'triageLoading'
  | 'triageEmpty'
  | 'triageLoadError'
  | 'triageRetry'
  // filters
  | 'filterTitle'
  | 'filterArea'
  | 'filterStatus'
  | 'filterVerdict'
  | 'filterBook'
  | 'filterAny'
  | 'filterBookPlaceholder'
  | 'filterClear'
  // list
  | 'listCount'
  | 'listOpen'
  | 'listNoNote'
  | 'listTargetDeleted'
  | 'pageLabel'
  | 'pageNewer'
  | 'pageOlder'
  // detail
  | 'detailBack'
  | 'detailLoading'
  | 'detailLoadError'
  | 'detailCreated'
  | 'detailStatusChanged'
  | 'detailNote'
  | 'detailContext'
  | 'detailContextRoute'
  | 'detailContextBook'
  | 'detailContextChapter'
  | 'detailContextLanguage'
  | 'detailContextNone'
  // evidence
  | 'evidenceTitle'
  | 'evidenceQuestion'
  | 'evidenceAnswer'
  | 'evidenceAnswerFailed'
  | 'evidenceConversation'
  | 'evidenceGrounding'
  | 'evidenceGuides'
  | 'evidenceArtifacts'
  | 'evidenceNoGrounding'
  | 'evidenceUnavailable'
  | 'evidenceTargetDeleted'
  | 'evidenceTargetMissing'
  | 'evidenceNotComposable'
  // transitions
  | 'statusTitle'
  | 'statusCurrent'
  | 'statusNone'
  | 'statusSaving'
  | 'statusFailed'
  | 'statusNotAllowed'
  // the vocabularies, rendered
  | 'verdictUp'
  | 'verdictDown'
  | 'statusNew'
  | 'statusTriaged'
  | 'statusConfirmedBug'
  | 'statusDismissed'
  | 'statusFixed';

/**
 * Hebrew feedback chrome. DRAFT he - needs native review.
 *
 * Addressed in the plural, matching the register the rest of this app's Hebrew chrome uses. The triage
 * half is read by the owner alone and is deliberately plainer than the widget half, which an author
 * reads: v1 of triage is a reading tool, not a product.
 */
export const FEEDBACK_STRINGS_HE: Record<FeedbackStringKey, string> = {
  entryLink:         'משוב',
  entryLinkAria:     'פתיחת רשימת המשוב',

  voteUpAria:        'התשובה עזרה',
  voteDownAria:      'התשובה לא עזרה',
  voteRetractAria:   'ביטול הדירוג',

  noteAdd:           'הוספת הערה',
  noteEdit:          'עריכת ההערה',
  noteTitle:         'מה היה חסר?',
  notePlaceholder:   'אפשר לכתוב כאן מה לא עבד. ההערה נשמרת אצלנו בלבד.',
  noteSave:          'שמירת ההערה',
  noteCancel:        'ביטול',
  noteCounter:       '{0} מתוך {1} תווים',
  noteTooLong:       'ההערה ארוכה מדי. אפשר לקצר ולשמור שוב.',
  noteSaving:        'שומר...',

  voteThanks:        'תודה, נרשם.',
  voteFailed:        'לא הצלחתי לשמור את הדירוג. נסו שוב בעוד רגע.',
  retractFailed:     'לא הצלחתי לבטל את הדירוג. נסו שוב בעוד רגע.',

  triageTitle:       'משוב',
  triageIntro:       'כל הדירוגים שהתקבלו, החדשים ראשונים.',
  triagePrivacy:     'הראיות נקראות כאן בלבד ואינן יוצאות מהמסד.',
  triageLoading:     'טוען את המשוב...',
  triageEmpty:       'אין כאן שורות שמתאימות לסינון הנוכחי.',
  triageLoadError:   'לא הצלחתי לטעון את המשוב. נסו שוב בעוד רגע.',
  triageRetry:       'ניסיון חוזר',

  filterTitle:       'סינון',
  filterArea:        'אזור',
  filterStatus:      'סטטוס',
  filterVerdict:     'דירוג',
  filterBook:        'ספר',
  filterAny:         'הכול',
  filterBookPlaceholder: 'מזהה ספר',
  filterClear:       'ניקוי הסינון',

  listCount:         '{0} שורות',
  listOpen:          'פתיחה',
  listNoNote:        'בלי הערה',
  listTargetDeleted: 'היעד נמחק',
  pageLabel:         'עמוד {0}',
  pageNewer:         'חדשות יותר',
  pageOlder:         'ישנות יותר',

  detailBack:        'חזרה לרשימה',
  detailLoading:     'טוען את השורה...',
  detailLoadError:   'לא הצלחתי לטעון את השורה. נסו שוב בעוד רגע.',
  detailCreated:     'נרשם',
  detailStatusChanged: 'שינוי סטטוס אחרון',
  detailNote:        'ההערה של הקורא',
  detailContext:     'ההקשר בזמן הדירוג',
  detailContextRoute: 'מסך',
  detailContextBook: 'ספר',
  detailContextChapter: 'פרק',
  detailContextLanguage: 'שפת ממשק',
  detailContextNone: 'לא נשמר הקשר.',

  evidenceTitle:     'הראיות',
  evidenceQuestion:  'השאלה',
  evidenceAnswer:    'התשובה',
  evidenceAnswerFailed: 'התשובה הזו נכשלה, והדירוג ניתן על הכישלון עצמו.',
  evidenceConversation: 'השיחה',
  evidenceGrounding: 'העיגון',
  evidenceGuides:    'מדריכים',
  evidenceArtifacts: 'מתוך הספר',
  evidenceNoGrounding: 'לא נשמר עיגון לתשובה הזו.',
  evidenceUnavailable: 'אי אפשר להציג את הראיות.',
  evidenceTargetDeleted: 'השיחה נמחקה, והשורה נשמרה בכוונה כדי שהסיגנל לא ילך לאיבוד.',
  evidenceTargetMissing: 'היעד לא נמצא, ולא סומן כנמחק. שווה בדיקה.',
  evidenceNotComposable: 'לסוג היעד הזה עוד אין הרכבה של ראיות.',

  statusTitle:       'סטטוס',
  statusCurrent:     'עכשיו',
  statusNone:        'אין מכאן מעבר אפשרי.',
  statusSaving:      'מעדכן...',
  statusFailed:      'לא הצלחתי לעדכן את הסטטוס. נסו שוב בעוד רגע.',
  statusNotAllowed:  'המעבר הזה לא מותר.',

  verdictUp:         'עזר',
  verdictDown:       'לא עזר',
  statusNew:         'חדש',
  statusTriaged:     'נקרא',
  statusConfirmedBug: 'באג מאושר',
  statusDismissed:   'נדחה',
  statusFixed:       'תוקן',
};

export const FEEDBACK_STRINGS_EN: Record<FeedbackStringKey, string> = {
  entryLink:         'Feedback',
  entryLinkAria:     'Open the feedback list',

  voteUpAria:        'This answer helped',
  voteDownAria:      'This answer did not help',
  voteRetractAria:   'Undo this rating',

  noteAdd:           'Add a note',
  noteEdit:          'Edit your note',
  noteTitle:         'What was missing?',
  notePlaceholder:   'Tell us what did not work. The note is kept here only.',
  noteSave:          'Save the note',
  noteCancel:        'Cancel',
  noteCounter:       '{0} of {1} characters',
  noteTooLong:       'That note is too long. Shorten it and save again.',
  noteSaving:        'Saving...',

  voteThanks:        'Thanks, that is recorded.',
  voteFailed:        'I could not save your rating. Try again in a moment.',
  retractFailed:     'I could not undo your rating. Try again in a moment.',

  triageTitle:       'Feedback',
  triageIntro:       'Every rating received, newest first.',
  triagePrivacy:     'Evidence is read here and never leaves the database.',
  triageLoading:     'Loading feedback...',
  triageEmpty:       'No rows match the current filter.',
  triageLoadError:   'I could not load the feedback. Try again in a moment.',
  triageRetry:       'Try again',

  filterTitle:       'Filter',
  filterArea:        'Area',
  filterStatus:      'Status',
  filterVerdict:     'Verdict',
  filterBook:        'Book',
  filterAny:         'Any',
  filterBookPlaceholder: 'Book id',
  filterClear:       'Clear the filter',

  listCount:         '{0} rows',
  listOpen:          'Open',
  listNoNote:        'No note',
  listTargetDeleted: 'Target deleted',
  pageLabel:         'Page {0}',
  pageNewer:         'Newer',
  pageOlder:         'Older',

  detailBack:        'Back to the list',
  detailLoading:     'Loading the row...',
  detailLoadError:   'I could not load that row. Try again in a moment.',
  detailCreated:     'Recorded',
  detailStatusChanged: 'Status last changed',
  detailNote:        "The reader's note",
  detailContext:     'Context at vote time',
  detailContextRoute: 'Screen',
  detailContextBook: 'Book',
  detailContextChapter: 'Chapter',
  detailContextLanguage: 'UI language',
  detailContextNone: 'No context was stored.',

  evidenceTitle:     'Evidence',
  evidenceQuestion:  'The question',
  evidenceAnswer:    'The answer',
  evidenceAnswerFailed: 'This answer failed, and the rating is about the failure itself.',
  evidenceConversation: 'Conversation',
  evidenceGrounding: 'Grounding',
  evidenceGuides:    'Guides',
  evidenceArtifacts: 'From the book',
  evidenceNoGrounding: 'No grounding was stored for this answer.',
  evidenceUnavailable: 'The evidence cannot be shown.',
  evidenceTargetDeleted: 'The conversation was deleted. This row was kept on purpose so the signal is not lost.',
  evidenceTargetMissing: 'The target is gone and was never tombstoned. Worth a look.',
  evidenceNotComposable: 'This target type has no evidence composer yet.',

  statusTitle:       'Status',
  statusCurrent:     'Now',
  statusNone:        'There is no legal move from here.',
  statusSaving:      'Updating...',
  statusFailed:      'I could not update the status. Try again in a moment.',
  statusNotAllowed:  'That move is not allowed.',

  verdictUp:         'Helped',
  verdictDown:       'Did not help',
  statusNew:         'New',
  statusTriaged:     'Triaged',
  statusConfirmedBug: 'Confirmed bug',
  statusDismissed:   'Dismissed',
  statusFixed:       'Fixed',
};

/** Resolve one feedback string in the given chrome language. */
export function feedbackString(lang: ChatChromeLang, key: FeedbackStringKey): string {
  return (lang === 'he' ? FEEDBACK_STRINGS_HE : FEEDBACK_STRINGS_EN)[key];
}

/** The note counter, already filled in. One function so the two surfaces cannot count differently. */
export function noteCounterLabel(lang: ChatChromeLang, used: number): string {
  return feedbackString(lang, 'noteCounter')
    .replace('{0}', String(used))
    .replace('{1}', String(FEEDBACK_TEXT_MAX));
}

/**
 * A verdict, in words.
 *
 * FALLS BACK TO THE RAW TOKEN for a verdict this client does not know, on the same rule the citation
 * chips follow for an unknown guide: a server that grows a third verdict should degrade to showing what
 * it said, never to a blank cell that hides a row's whole point.
 */
export function feedbackVerdictLabel(lang: ChatChromeLang, verdict: string | null | undefined): string {
  if (verdict === 'up') return feedbackString(lang, 'verdictUp');
  if (verdict === 'down') return feedbackString(lang, 'verdictDown');
  return verdict ?? '';
}

const STATUS_KEYS: Readonly<Record<FeedbackStatus, FeedbackStringKey>> = {
  New: 'statusNew',
  Triaged: 'statusTriaged',
  ConfirmedBug: 'statusConfirmedBug',
  Dismissed: 'statusDismissed',
  Fixed: 'statusFixed',
};

/** A status, in words. Same unknown-token fallback as {@link feedbackVerdictLabel}. */
export function feedbackStatusLabel(lang: ChatChromeLang, status: string | null | undefined): string {
  const key = status ? STATUS_KEYS[status as FeedbackStatus] : undefined;
  return key ? feedbackString(lang, key) : (status ?? '');
}

/**
 * Why the evidence join came back empty, in words.
 *
 * The three reasons are NOT interchangeable and are deliberately worded apart: `targetDeleted` is the
 * system working as d1 designed it (the row was kept on purpose), `targetMissing` is a row that vanished
 * without going through a delete path and is worth investigating, and `targetTypeNotComposable` is a
 * mount whose evidence composer has not been written yet. Collapsing them into one sentence would hide
 * the only one of the three that is a defect.
 */
export function evidenceUnavailableLabel(
  lang: ChatChromeLang,
  reason: string | null | undefined
): string {
  switch (reason) {
    case 'targetDeleted':
      return feedbackString(lang, 'evidenceTargetDeleted');
    case 'targetMissing':
      return feedbackString(lang, 'evidenceTargetMissing');
    case 'targetTypeNotComposable':
      return feedbackString(lang, 'evidenceNotComposable');
    default:
      return feedbackString(lang, 'evidenceUnavailable');
  }
}
