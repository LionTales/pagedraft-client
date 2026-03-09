import { CanDeactivateFn } from '@angular/router';

/** Implemented by the editor page so the guard can save before leaving (e.g. browser back). */
export interface CanSaveBeforeLeave {
  hasPendingChanges: boolean;
  saveCurrentDocumentPromise(): Promise<void>;
}

export const editorCanDeactivate: CanDeactivateFn<CanSaveBeforeLeave> = (component) => {
  if (!component?.hasPendingChanges) return true;
  return component.saveCurrentDocumentPromise().then(() => true);
};
