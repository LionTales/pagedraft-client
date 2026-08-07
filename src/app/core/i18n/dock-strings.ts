/**
 * The chrome of the app dock: the single launcher, the drawer shell, and the tab strip that replaced
 * the two separate overlays (chatbot phase A.1, w1).
 *
 * ── What lives here and what deliberately does not ─────────────────────────────────────────────────
 * Only the strings the DOCK itself owns. The two tab LABELS are not here: a tab is named by the
 * surface it opens, so the assistant tab reads its name from `chat-strings` and the activity tab from
 * `ActivityCenterComponent`'s own label map. Copying those names into a third map would let the tab
 * and the surface it names drift apart, which is the one drift a reader would actually notice.
 *
 * Same conventions as `chat-strings.ts`: {@link DockStringKey} is a CLOSED union so a typo'd key is a
 * compile error, and both maps are `Record<DockStringKey, string>` so a key added to one language
 * fails the build until the other has it. The dock is APP-LEVEL chrome, so it is HEBREW-DEFAULT.
 *
 * Hebrew here is DRAFT and needs native-speaker review. No em-dash in any user-facing string; both are
 * pinned by `dock-strings.spec.ts`.
 */

import type { ChatChromeLang } from './chat-strings';

/** The dock renders in the same two chrome languages as the rest of the app-level chrome. */
export type DockChromeLang = ChatChromeLang;

/** Every string the dock shell can show. Closed on purpose: a typo'd key does not compile. */
export type DockStringKey =
  // ── launcher ──
  | 'launcher'
  | 'activeCount'
  | 'activeCountSingular'
  // ── drawer shell ──
  | 'dockTitle'
  | 'tabsLabel'
  | 'close'
  | 'expand'
  | 'collapse';

/** Hebrew dock chrome. DRAFT he - needs native review. */
export const DOCK_STRINGS_HE: Record<DockStringKey, string> = {
  launcher:            'פתיחת העוזר ומרכז הפעילות',   // DRAFT he - needs native review
  activeCount:         'משימות פעילות',                // DRAFT he - needs native review (plural)
  activeCountSingular: 'משימה פעילה',                  // DRAFT he - needs native review (singular)

  dockTitle:           'עוזר ופעילות',                 // DRAFT he - needs native review
  tabsLabel:           'לשוניות החלונית',              // DRAFT he - needs native review
  close:               'סגירה',                        // DRAFT he - needs native review
  expand:              'הרחבת החלונית',                // DRAFT he - needs native review
  collapse:            'צמצום החלונית',                // DRAFT he - needs native review
};

export const DOCK_STRINGS_EN: Record<DockStringKey, string> = {
  launcher:            'Open the assistant and activity',
  activeCount:         'active tasks',
  activeCountSingular: 'active task',

  dockTitle:           'Assistant and activity',
  tabsLabel:           'Panel tabs',
  close:               'Close',
  expand:              'Widen the panel',
  collapse:            'Narrow the panel',
};

/** Resolve one dock string in the given chrome language. */
export function dockString(lang: DockChromeLang, key: DockStringKey): string {
  return (lang === 'he' ? DOCK_STRINGS_HE : DOCK_STRINGS_EN)[key];
}

/**
 * The launcher's accessible name, composing the affordance name with the live job count when there
 * is one.
 *
 * The count is the reason the old Activity Center bell existed, but this launcher is not that bell:
 * it also opens the assistant, which is the tab it opens onto by default. So the count is APPENDED
 * to the launcher's name rather than replacing it - a screen reader must still hear what the control
 * does, not just how many jobs are running behind it. Singular and plural are separate strings: "1
 * משימות פעילות" would be wrong Hebrew and wrong English alike.
 */
export function launcherAriaLabel(lang: DockChromeLang, activeCount: number): string {
  const name = dockString(lang, 'launcher');
  if (activeCount === 1) return `${name}, 1 ${dockString(lang, 'activeCountSingular')}`;
  if (activeCount > 1) return `${name}, ${activeCount} ${dockString(lang, 'activeCount')}`;
  return name;
}
