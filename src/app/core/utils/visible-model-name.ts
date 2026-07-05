/**
 * Model name to show next to a result heading, or null to omit the parenthetical entirely.
 *
 * The chunked proofread/line-edit path stores the internal sentinel "chunked" as the model name
 * (it fans out over many per-chunk model calls, so there is no single model to name); that token is
 * not a user-facing model and must not leak into the (Hebrew) UI as "(chunked)". Blank/whitespace
 * names are omitted too.
 *
 * Mirror note: the sentinel value "chunked" is set by the backend in
 * UnifiedAnalysisService (ModelName = "chunked") for chunked analysis runs. If that
 * sentinel is ever renamed on the backend, this filter must be updated to match.
 */
export function visibleModelName(modelName: string | null | undefined): string | null {
  const m = (modelName ?? '').trim();
  return !m || m === 'chunked' ? null : m;
}
