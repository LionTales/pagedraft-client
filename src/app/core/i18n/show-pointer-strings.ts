/**
 * The strings of the "ask Show about your book" pointer (Wave 3 / w7, Q5).
 *
 * ── What this is, and why it exists at all ─────────────────────────────────────────────────────────
 * w7 removed the two free-form ask surfaces the product had: the book dashboard's "ask about the book"
 * card, and the per-chapter Custom prompt box in the analysis panel. Show, the assistant in the app
 * dock, is the ask surface now. A capability that moves without leaving a trace at its old address
 * reads to the author as a capability that was DELETED, so both slots keep a light pointer for one
 * release: a sentence saying where the thing went, and a button that opens Show.
 *
 * TODO(2026-08-14, wave 4): delete this file and both call sites once wave 4 ships -
 * `book-dashboard.component.ts`'s `.show-pointer-card` section and `analysis-panel.component.html`'s
 * `.show-pointer-section`, plus each component's `showPointerLabel`/`openShow` members. "One release"
 * had nothing encoding it until this comment (finding C12); this is that encoding, and it is the
 * whole mechanism - no flag, because a pointer that outlives its grace period is a one-line deletion,
 * not a runtime branch worth carrying.
 *
 * IT IS A POINTER, NOT A REPLACEMENT. It is not a modal, it does not block, it does not gate anything,
 * and neither slot renders a second input box. The button opens the dock on the assistant tab
 * (`AppOverlayService.openTab('assistant')`) rather than only naming it, so the affordance is real.
 *
 * ── Language ───────────────────────────────────────────────────────────────────────────────────────
 * Both maps are `Record<ShowPointerStringKey, string>` over a CLOSED key union, so he/en parity is
 * enforced BY THE COMPILER: a key added to one language and forgotten in the other does not build.
 * That is deliberate here rather than the analysis panel's loose `Record<string, string>` idiom, whose
 * own doc comment records that nothing catches a forgotten key in it.
 *
 * WHICH LANGUAGE A SLOT PICKS is the slot's business, not this file's, and the two slots agree: the
 * book dashboard and the analysis panel are both BOOK-SCOPED chrome, so they render this pointer in
 * the book's language. Show itself is APP-LEVEL chrome and is Hebrew-default, so an English book's
 * pointer can open a Hebrew assistant. That is the app's standing language rule rather than a defect
 * of this pointer, and it is the same seam the dock's guides link already sits on; the day a global
 * language service exists, the assistant follows it and this pointer needs no change.
 *
 * Hebrew is DRAFT and needs native-speaker review, like every other Hebrew string this wave added.
 * No em-dash and no en-dash in any string here; `show-pointer-strings.spec.ts` pins both.
 *
 * ── RTL ────────────────────────────────────────────────────────────────────────────────────────────
 * Nothing in these strings encodes a direction. The two slots render inside containers that already
 * carry the book's `dir`, and their layout uses logical properties throughout, so the pointer mirrors
 * with its host rather than being positioned physically. See the styles at each slot for the
 * per-element mirror calls.
 */

import type { ChatChromeLang } from './chat-strings';

/** The pointer renders in the two chrome languages the rest of the app uses. */
export type ShowPointerLang = ChatChromeLang;

/** Every string the Show pointer can put on screen. Closed on purpose: a typo'd key does not compile. */
export type ShowPointerStringKey =
  // The heading, shared by both slots: it names the assistant, because the name is the thing the
  // author has to learn in order to find this capability again tomorrow.
  | 'title'
  // The body differs per slot because the two slots replace different things and sit in different
  // widths. The dashboard's says what an author can ask ABOUT THE BOOK; the panel's is one line, sized
  // for a 300px side panel, and says the same for the open chapter.
  | 'dashboardBody'
  | 'panelBody'
  // The button, and the accessible name that says what opening it gets you. Both slots share them.
  | 'open'
  | 'openAria';

/** Hebrew pointer chrome. DRAFT he - needs native review. */
export const SHOW_POINTER_STRINGS_HE: Record<ShowPointerStringKey, string> = {
  title:         'שאלו את שואו על הספר',                                          // DRAFT he
  dashboardBody: 'שואו עונה על שאלות לגבי הספר שלכם, קורא את התקצירים, את הממצאים ואת הפרקים עצמם, ואומר על מה הוא מסתמך.',  // DRAFT he
  panelBody:     'שאלות חופשיות על הפרק הזה עברו לשואו, והוא קורא את הפרק שפתוח לפניכם.',  // DRAFT he
  open:          'פתיחת שואו',                                                     // DRAFT he
  openAria:      'פתיחת שואו, העוזר של PageDraft',                                 // DRAFT he
};

export const SHOW_POINTER_STRINGS_EN: Record<ShowPointerStringKey, string> = {
  title:         'Ask Show about your book',
  dashboardBody: 'Show answers questions about your book. It reads your briefs, your review findings and the chapters themselves, and it says what it read.',
  panelBody:     'Free-form questions about this chapter moved to Show, which reads the chapter you have open.',
  open:          'Open Show',
  openAria:      'Open Show, the PageDraft assistant',
};

/** Resolve one pointer string in the given chrome language. */
export function showPointerString(lang: ShowPointerLang, key: ShowPointerStringKey): string {
  return (lang === 'he' ? SHOW_POINTER_STRINGS_HE : SHOW_POINTER_STRINGS_EN)[key];
}
