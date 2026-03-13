/**
 * Extract plain text from SFDT JSON by walking sections/blocks/inlines.
 * Handles both standard keys and Syncfusion v32 optimized keys (sec, b, i, tlp).
 * Shared by EditorTextService and SfdtManipulationService to avoid duplicate logic.
 */
export function getTextFromSfdt(sfdtString: string): string {
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
