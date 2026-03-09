# pagewise-ui reference (RTL / document editor)

Optional reference when aligning PageDraft with patterns from **pagewise-ui** (path: `c:\Users\tomer\source\repos\pagewise-ui`).

## Edit-page and document-preview

- **edit-page**: Wraps content in `<div class="edit" [dir]="locale.direction()">`. Renders `app-document-preview` with `[fileId]`, `[bookId]`, etc. Single editor flow is in document-preview.
- **document-preview**: Hosts **two** `ejs-documenteditorcontainer` instances (left/right pages of a spread). Each container gets:
  - `[enableRtl]="bookDirection === 'rtl'"`
  - `[locale]="culture"`
  - Same `documentEditorSettings`, `serviceUrl`, `serverActionSettings`; `enableToolbar="false"`, custom toolbar above.

## Direction and culture

- **bookDirection**: Getter `locale.directionForLanguage(this.settings?.language)` → `'rtl'` for `'he'`, else `'ltr'`. Empty/missing language defaults to `'rtl'`.
- **culture**: Set when settings load: `this.culture = (s.language && (s.language === 'he' || s.language === 'en')) ? s.language : 'he'`.
- **LocaleService.directionForLanguage(lang)**: `lang === 'he' ? 'rtl' : 'ltr'`; empty/missing → `'rtl'`.

## Wrapper dir

- Preview wrapper: `<div class="preview-wrapper" [dir]="bookDirection">` so the whole preview (toolbar, pagination, editors) follows book direction. Pagination arrows swap by direction (e.g. `bookDirection === 'rtl' ? '←' : '→'` for next).

## Post-load section format

After opening DOCX or SFDT and waiting for layout:

1. `waitForLayoutStable(editor, 150)` (and optionally minPageCount for second editor).
2. Build `SectionFormatProperties` from settings (pageWidth, pageHeight, margins in mm → points via `mmToPoint`).
3. Set a flag (e.g. `isPostLoadSectionFormatInProgress = true`) so contentChange does not mark dirty or trigger sync.
4. For each editor: `ed.editor.beginBatchEdit()`, `ed.setDefaultSectionFormat(def)`, `ed.editorHistory.clearHistory()`, `ed.editor.endBatchEdit()`.
5. Clear the flag and finish load (spinner off, etc.).

This applies saved page settings (margins, size) without treating the change as user edits.

## Toolbar: RTL/LTR and bidi

- **setDirection(rtl: boolean)**: `this.activeEditor.selection.paragraphFormat.bidi = toRtl` and same for `characterFormat.bidi`.
- **isRtl()**: `!!this.activeEditor?.selection?.paragraphFormat.bidi`.

## What PageDraft already has vs can adopt

- **PageDraft**: Single editor, `editorDirection`/`editorCulture` from `book?.language`, `ensureSfdtRtl`, default paragraph/character bidi on created, `normalizeTextForAnalysis`, `replacePlainTextInSfdt` with bidi preservation, `proofreadDiff` on normalized text, `normalizedOffsetToRawOffset` for selection.
- **From pagewise-ui**: Wrapper `[dir]="bookDirection"` (PageDraft has `[attr.dir]="editorDirection"`), `setDefaultSectionFormat` after load if PageDraft adds book-level page settings; optional second editor for spread view is a larger UX change.
