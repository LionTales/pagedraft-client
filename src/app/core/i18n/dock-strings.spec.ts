/**
 * dock-strings invariants (chatbot phase A.1, w1).
 *
 * Map-level assertions only. The rendered-DOM counterpart (which tab is named what, and that the
 * count really reaches the launcher) lives in `shared/app-dock/app-dock.component.spec.ts`.
 */
import {
  DOCK_STRINGS_EN,
  DOCK_STRINGS_HE,
  DockStringKey,
  dockString,
  launcherAriaLabel,
} from './dock-strings';

describe('dock-strings (chatbot phase A.1)', () => {
  describe('he/en parity', () => {
    it('both maps carry the SAME key set', () => {
      expect(Object.keys(DOCK_STRINGS_HE).sort()).toEqual(Object.keys(DOCK_STRINGS_EN).sort());
    });

    it('no value is empty in either language', () => {
      const blank = [...Object.entries(DOCK_STRINGS_HE), ...Object.entries(DOCK_STRINGS_EN)]
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it('no user-facing string contains an em-dash', () => {
      const offenders = [...Object.entries(DOCK_STRINGS_HE), ...Object.entries(DOCK_STRINGS_EN)]
        .filter(([, v]) => v.includes('—'))
        .map(([k]) => k);
      expect(offenders)
        .withContext('the page conventions forbid the em-dash in user-facing text')
        .toEqual([]);
    });

    it('the Hebrew strings really ARE Hebrew (no untranslated English left in the map)', () => {
      const untranslated = (Object.keys(DOCK_STRINGS_HE) as DockStringKey[])
        .filter(k => /[A-Za-z]/.test(DOCK_STRINGS_HE[k]));
      expect(untranslated).toEqual([]);
    });
  });

  describe('dockString', () => {
    it('resolves from the requested language map', () => {
      expect(dockString('he', 'close')).toBe(DOCK_STRINGS_HE['close']);
      expect(dockString('en', 'close')).toBe('Close');
    });
  });

  describe('launcherAriaLabel', () => {
    it('names the surface when nothing is running', () => {
      expect(launcherAriaLabel('he', 0)).toBe(DOCK_STRINGS_HE['launcher']);
      expect(launcherAriaLabel('en', 0)).toBe(DOCK_STRINGS_EN['launcher']);
    });

    it('uses the SINGULAR form for exactly one active job, composed with the launcher name, in both languages', () => {
      expect(launcherAriaLabel('he', 1)).toBe(`${DOCK_STRINGS_HE['launcher']}, 1 משימה פעילה`);
      expect(launcherAriaLabel('he', 1)).not.toContain('משימות');
      expect(launcherAriaLabel('en', 1)).toBe(`${DOCK_STRINGS_EN['launcher']}, 1 active task`);
    });

    it('uses the plural form for more than one, composed with the launcher name', () => {
      expect(launcherAriaLabel('he', 3)).toBe(`${DOCK_STRINGS_HE['launcher']}, 3 משימות פעילות`);
      expect(launcherAriaLabel('en', 3)).toBe(`${DOCK_STRINGS_EN['launcher']}, 3 active tasks`);
    });

    it('keeps the affordance name present so the launcher is never announced as ONLY a count', () => {
      expect(launcherAriaLabel('he', 1)).toContain(DOCK_STRINGS_HE['launcher']);
      expect(launcherAriaLabel('he', 3)).toContain(DOCK_STRINGS_HE['launcher']);
      expect(launcherAriaLabel('en', 1)).toContain(DOCK_STRINGS_EN['launcher']);
      expect(launcherAriaLabel('en', 3)).toContain(DOCK_STRINGS_EN['launcher']);
    });
  });
});
