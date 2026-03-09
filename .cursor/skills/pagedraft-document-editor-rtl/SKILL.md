---
name: pagedraft-document-editor-rtl
description: Configures and maintains Syncfusion Document Editor for RTL/Hebrew in PageDraft (pagedraft-client). Covers container props (enableRtl, locale, dir), SFDT bidi handling, text normalization for analysis/proofread, and apply-correction flow. Use when working on the document editor, RTL/Hebrew layout, analysis panel, proofread diff, or Accept suggestion in pagedraft-client.
---

# PageDraft Document Editor — RTL/Hebrew

Guidance for the Syncfusion Document Editor in **pagedraft-client**: correct RTL/Hebrew behavior, SFDT handling, and integration with analysis/proofread and apply-correction.

## 1. Document editor setup

### Container and wrapper

- **Wrapper `dir`**: Wrap the editor in a div with `[attr.dir]="editorDirection"` so the shell (toolbar, status) follows document direction. Example: `<div class="editor-shell" [attr.dir]="editorDirection">`.
- **Syncfusion container**:
  - `[enableRtl]="editorDirection === 'rtl'"` — enables RTL UI and layout.
  - `[locale]="editorCulture"` — Syncfusion culture; use `'he'` for Hebrew, `'en'` for English so punctuation and UI align with the book language.

### Deriving direction and culture

- **editorDirection**: `'rtl'` when book language is `'he'` or `'ar'` (or missing/empty for default Hebrew); otherwise `'ltr'`.
- **editorCulture**: `'he'` for Hebrew/Arabic, `'en'` for others. Keep in sync with `book?.language`.

### Default formats (after editor created)

When `editorDirection === 'rtl'`:

- Set `ed.enableRtl = true`.
- Call `ed.setDefaultParagraphFormat({ bidi: true })` and `ed.setDefaultCharacterFormat({ bidi: true })` so new content is RTL by default.
- Optionally apply bidi to current selection in a deferred callback (e.g. `applyRtlToSelectionDeferred`) so the first paragraph has bidi before user types.

### Optional: post-load section format (pagewise-ui pattern)

If loading DOCX/SFDT and then applying book page settings (margins, size), use `setDefaultSectionFormat(properties)` inside `beginBatchEdit` / `endBatchEdit`, then `clearHistory()`. Suppress treating that programmatic change as user content (e.g. a flag like `isPostLoadSectionFormatInProgress`) so it does not trigger save/sync. See [reference.md](reference.md) for pagewise-ui’s two-editor spread and section-format flow.

---

## 2. SFDT handling

### Empty / minimal SFDT

Use a valid SFDT with one paragraph and empty text so the editor has a selection target. For RTL, set bidi on that paragraph and its inline:

- `paragraphFormat.bidi: true`
- One inline with `characterFormat.bidi: true` and `text: ""` (or the desired string).

Example minimal one-paragraph SFDT (standard keys):

```json
{"sections":[{"blocks":[{"paragraphFormat":{"bidi":true},"inlines":[{"characterFormat":{"bidi":true},"text":""}]}],"headersFooters":{}}]}
```

When building minimal SFDT with content (e.g. after Accept with no existing structure), use the same shape and JSON-escape the text.

### Normalizing loaded SFDT for RTL (ensureSfdtRtl)

When loading SFDT for a Hebrew/RTL book, ensure every block and inline has bidi set so existing content is not treated as LTR:

- Parse SFDT; walk `sections` → `blocks` → `inlines`.
- Support both standard keys (`sections`, `blocks`, `inlines`, `paragraphFormat`, `characterFormat`) and optimized keys (`sec`, `b`, `i`, `pf`, `cf`) if the serializer uses them.
- For each block: set `paragraphFormat.bidi = true` (or `pf.bidi`).
- For each inline: set `characterFormat.bidi = true` (or `cf.bidi`).
- Return `JSON.stringify(doc)`. If parsing fails, return the original string.

Call `ensureSfdtRtl` when loading chapter/scene content (before `open(sfdt)`), and when applying highlights or other SFDT that will be re-opened, so all content stays RTL.

### When to set paragraph/character bidi

- **On load**: Use `ensureSfdtRtl` on any SFDT loaded for an RTL book.
- **On create**: Empty/minimal SFDT and any generated SFDT (e.g. single paragraph for “replace whole document”) must include bidi in paragraph and character format.
- **In editor**: After `created`, set default paragraph and character format with `bidi: true` for RTL; optionally sync selection bidi in a deferred run so the first paragraph is RTL before typing.
- **Toolbar**: If the app has LTR/RTL toggle buttons, set `selection.paragraphFormat.bidi` and `selection.characterFormat.bidi` to `true` or `false` according to the button (and keep `enableRtl` on the container for overall RTL mode).

---

## 3. Sending text to analysis and proofread

### Normalizing plain text (bidi control stripping)

Plain text used for analysis and proofread must be normalized so client and API see the same string and offsets are consistent:

- **Strip Unicode bidi control characters**: LRM, RLM, LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069).
- Use a single normalization function (e.g. `normalizeTextForAnalysis`) everywhere: when building `currentDocumentPlainText`, when diffing original vs result, and ideally on the API when extracting or comparing text.

Implementation pattern (e.g. in `normalize-text-for-analysis.ts`):

- Regex: `[\u200E\u200F\u202A-\u202E\u2066-\u2069]` → replace with `''`.
- Export `normalizeTextForAnalysis(text)` and `normalizedOffsetToRawOffset(rawText, normalizedOffset)` so offsets from normalized text can be mapped back to raw SFDT/inline text when applying suggestions or selecting ranges.

### Matching client and API extraction

- **Client**: Document plain text for the panel = `normalizeTextForAnalysis(getTextFromSfdt(sfdt))`. `getTextFromSfdt` must walk sections → blocks → inlines in a deterministic order and concatenate `text` (or optimized key) only; no normalization inside `getTextFromSfdt` so that “raw” text is available for `normalizedOffsetToRawOffset`.
- **API**: If the API returns proofread/result text or suggestion offsets, it should apply the same normalization (strip bidi controls) so that diffing and offset-based apply work. Offsets in suggestions should be in **normalized** document text; the client converts to raw when calling `plainOffsetToSfdtPosition` or slicing for replace.

### Proofread diff and Accept

- **Diff**: Run diff on `normalizeTextForAnalysis(original)` and `normalizeTextForAnalysis(resultText)`. Offsets in the resulting suggestions are in normalized space.
- **Accept**: When applying a suggestion (replace segment or full text), use the **normalized** document text for slicing (e.g. `currentDocumentPlainText`), then replace in SFDT via `replacePlainTextInSfdt(sfdt, newPlainText)` so block boundaries and formats are preserved. When mapping “Show in document” or selection, use `normalizedOffsetToRawOffset(rawText, normalizedOffset)` then `plainOffsetToSfdtPosition` so the selection lands on the correct character in the editor.

---

## 4. Apply-correction flow (Accept suggestion)

### Preserving bidi when replacing content

- **replacePlainTextInSfdt(sfdt, newPlainText)**:
  - Compute block lengths from **normalized** text (same order as `getTextFromSfdt`) so `newPlainText` can be normalized and split by block length.
  - For each block, replace inlines with a single new inline (or minimal set) containing the segment text. Use the first existing inline as a format template (font, size, etc.).
  - **RTL**: If `editorDirection === 'rtl'`, set `paragraphFormat.bidi = true` (or `pf.bidi`) on the block and `characterFormat.bidi = true` (or `cf.bidi`) on the new inline/template so Accept does not strip RTL.
  - Strip any highlight formatting when building the new inline. Support both standard and optimized keys when reading/writing SFDT.

### Template characterFormat / paragraphFormat

- When creating the replacement inline, copy character format from the template (first inline of the block). If the template has no `characterFormat`/`cf`, create one with at least `bidi: true` for RTL.
- Preserve paragraph format on the block (including bidi) when replacing only the inlines.

### Full-document replace

When the correction has no range (e.g. full replacement), use `buildMinimalSfdt(newText)` that builds one paragraph with `paragraphFormat.bidi: true` and one inline with `characterFormat.bidi: true` and the new text, JSON-escaped.

---

## Quick reference

| Task | Action |
|------|--------|
| Editor direction/culture | `[attr.dir]`, `[enableRtl]`, `[locale]` from book language (he → rtl/he) |
| New content RTL | `setDefaultParagraphFormat({ bidi: true })`, `setDefaultCharacterFormat({ bidi: true })` after created |
| Load SFDT for Hebrew | Run `ensureSfdtRtl(sfdt)` before `open(sfdt)` |
| Empty document | Use minimal SFDT with one paragraph + one inline, both bidi true |
| Text to analysis | `currentDocumentPlainText = normalizeTextForAnalysis(getTextFromSfdt(sfdt))` |
| Proofread diff | Diff normalized original vs normalized result; offsets in normalized space |
| Accept suggestion | Slice normalized text, `replacePlainTextInSfdt(sfdt, newText)` with bidi preserved on block and inline |
| Select in editor | `normalizedOffsetToRawOffset(raw, normOffset)` then `plainOffsetToSfdtPosition` |

---

## Reference

- **PageDraft**: `src/app/features/editor/editor-page.component.ts`, `src/app/core/utils/normalize-text-for-analysis.ts`, `src/app/core/utils/proofread-diff.ts`.
- **pagewise-ui** (optional): Edit-page flow and document-preview use two Syncfusion DocumentEditor instances, `[dir]="bookDirection"` on wrapper, `[enableRtl]="bookDirection === 'rtl'"`, `[locale]="culture"`, and post-load `setDefaultSectionFormat` with batch edit. See [reference.md](reference.md) for details.
