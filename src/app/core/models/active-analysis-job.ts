/**
 * FE mirror of the backend AnalysisJobSummaryDto (rf-b01), returned by
 * GET api/books/{bookId}/active-analysis-jobs.
 *
 * The endpoint returns ONLY in-flight (non-terminal) chapter/scene analysis jobs (Proofread /
 * LineEdit started via POST .../analysis-jobs). Book-level jobs (style-baseline, summary, review)
 * are NOT in this list; those are surfaced by their own status endpoints' `activeBuildJobId`.
 *
 * JSON casing is the System.Text.Json default (camelCase). The `status`, `analysisType`, and `scope`
 * strings are the .NET enum ToString() values and therefore arrive PascalCase:
 *   status:       Pending | Running | Succeeded | Failed | Canceled  (the endpoint only ever returns
 *                 Pending/Running, since it filters to non-terminal jobs)
 *   analysisType: Proofread | LineEdit | LinguisticAnalysis | LiteraryAnalysis | ...  (AnalysisType enum)
 *   scope:        Book | Chapter | Scene  (AnalysisScope enum)
 * The JobRegistryService normalizes `status` down to its lowercase status vocabulary.
 *
 * Semantics: survives a BROWSER refresh (the API process keeps the in-memory tracker running) but NOT
 * an API restart (in-memory singleton, 30-min TTL) - identical to how book-level builds behave.
 */
export interface ActiveAnalysisJobDto {
  jobId: string;
  /** AnalysisType enum ToString(), PascalCase (e.g. 'Proofread', 'LineEdit'). */
  analysisType: string;
  /** AnalysisScope enum ToString(), PascalCase ('Book' | 'Chapter' | 'Scene'). */
  scope: string;
  /** Null for a book-scoped job; set for chapter/scene jobs. */
  chapterId: string | null;
  /** Null unless the job is scene-scoped. */
  sceneId: string | null;
  /** AnalysisProgressStatus enum ToString(), PascalCase. Endpoint only emits 'Pending' | 'Running'. */
  status: string;
  /**
   * 0-100 progress estimate from the tracker. A value of 0 can mean "not yet chunked" — the
   * rf-b01 DTO has no negative sentinel for "unknown", so a job that was just created or that the
   * client just reattached to may report 0% for one poll cycle before the first chunk completes.
   */
  estimatedCompletionPercent: number;
  message: string;
  /** UTC ISO timestamp of the tracker's last update for this job. */
  lastUpdatedUtc: string;
}
