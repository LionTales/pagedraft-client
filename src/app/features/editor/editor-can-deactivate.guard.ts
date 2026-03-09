import { CanDeactivateFn } from '@angular/router';

/** Implemented by the editor page so the guard can save before leaving (e.g. browser back). */
export interface CanSaveBeforeLeave {
  hasPendingChanges: boolean;
  saveCurrentDocumentPromise(): Promise<void>;
}

export const editorCanDeactivate: CanDeactivateFn<CanSaveBeforeLeave> = (component) => {
  if (!component?.hasPendingChanges) return true;
  return component.saveCurrentDocumentPromise()
    .then(() => true)
    .catch((err) => {
      // Allow navigation even if save fails so the user is not trapped on the page.
      // eslint-disable-next-line no-console
      console.error('Failed to save current document before leaving editor.', err);
      return true;
    });
};
