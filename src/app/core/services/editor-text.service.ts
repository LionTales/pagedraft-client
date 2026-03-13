import { Injectable } from '@angular/core';
import { DocumentEditorContainerComponent } from '@syncfusion/ej2-angular-documenteditor';
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
   * Extract plain text from SFDT JSON by walking sections/blocks/inlines.
   * Handles both standard keys and Syncfusion v32 optimized keys (sec, b, i, tlp).
   */
  getTextFromSfdt(sfdtString: string): string {
    try {
      const doc = JSON.parse(sfdtString) as Record<string, unknown>;
      const sections = (doc['sections'] ?? doc['sec'] ?? []) as Array<Record<string, unknown>>;
      const parts: string[] = [];
      for (const section of sections) {
        const blocks = (section['blocks'] ?? section['b'] ?? []) as Array<Record<string, unknown>>;
        for (const block of blocks) {
          const inlines = (block['inlines'] ?? block['i'] ?? []) as Array<Record<string, unknown>>;
          for (const inline of inlines) {
            const text = inline['text'] ?? inline['tlp'];
            if (typeof text === 'string') parts.push(text);
          }
        }
      }
      return parts.join('');
    } catch {
      return '';
    }
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

