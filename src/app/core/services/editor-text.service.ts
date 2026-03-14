import { Injectable } from '@angular/core';
import { DocumentEditorContainerComponent } from '@syncfusion/ej2-angular-documenteditor';
import { getTextFromSfdt } from '../utils/sfdt-text';
import { normalizeTextForAnalysis } from '../utils/normalize-text-for-analysis';

@Injectable({
  providedIn: 'root'
})
export class EditorTextService {
  /**
   * Fallback: extract plain text via Syncfusion's selection API (works regardless of SFDT format).
   */
  getPlainTextFromEditor(docEditor?: DocumentEditorContainerComponent): string {
    const editor = docEditor?.documentEditor;
    if (!editor?.selection) return '';
    try {
      const startPos = editor.selection.startOffset;
      const endPos = editor.selection.endOffset;
      editor.selection.selectAll();
      const text = editor.selection.text || '';
      editor.selection.select(startPos, endPos);
      return text;
    } catch {
      return '';
    }
  }

  /**
   * Extract plain text from SFDT JSON (delegates to shared util).
   */
  getTextFromSfdt(sfdtString: string): string {
    return getTextFromSfdt(sfdtString);
  }

  /**
   * Compute current document plain text from the editor content (for analysis panel).
   * Call before run so diff uses latest text. Returns normalized text or an empty string.
   */
  refreshDocumentPlainText(
    docEditor: DocumentEditorContainerComponent | undefined,
    selectedChapterId: string | null
  ): string {
    if (!docEditor?.documentEditor || !selectedChapterId) return '';
    try {
      const sfdt = docEditor.documentEditor.serialize();
      const text = this.getTextFromSfdt(sfdt);
      if (text) {
        return normalizeTextForAnalysis(text);
      }
    } catch {
      // fall through to selection fallback
    }
    const fallback = this.getPlainTextFromEditor(docEditor);
    if (!fallback) return '';
    return normalizeTextForAnalysis(fallback);
  }
}

