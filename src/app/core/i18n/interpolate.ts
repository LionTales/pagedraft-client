/** Named placeholder values for {@link interpolate}. */
export type StringParams = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left VERBATIM rather than blanked, so a
 * mismatch between a template and its caller shows up as `{parts}` on screen (and in a test) instead of
 * silently producing a sentence with a hole in it. The one copy for every named-placeholder string module
 * (run-strings, proofread-strings); the positional `{0}` modules (chat, feedback) are a separate convention.
 */
export function interpolate(template: string, params?: StringParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}
