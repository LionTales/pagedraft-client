export interface LanguageEngineRequest {
  language?: string;
  options?: LanguageEngineOptions;
}

export interface LanguageEngineOptions {
  enableNormalize?: boolean;
  enableDetect?: boolean;
  enableRewrite?: boolean;
  enableAnalyze?: boolean;
  preferredModel?: string;
}

export interface LanguageEngineResult {
  normalizedText: string;
  issues: LanguageIssue[];
  rewrittenText?: string;
  analysis?: LanguageAnalysis;
  metadata?: Record<string, any>;
}

/** Response from GET issues; includes optional message when LanguageTool is unavailable. */
export interface IssuesResponse {
  issues: LanguageIssue[];
  languageToolUnavailable?: boolean | null;
  /**
   * The server's own English sentence. STILL SENT, DELIBERATELY NOT RENDERED: it is English on a
   * Hebrew-default UI, which is what bug 3 was. Kept on the wire (and on this type) UNTIL the fifth
   * ServiceUnavailable path is assigned a code (see the `languageToolCode` doc below) - not for a fixed
   * number of releases. PAGEDRAFT_DESIGN.md's "KNOWN GAP" paragraph for this endpoint states the
   * prerequisite: "a code should be assigned before the message field is removed." Dropping this field
   * first would silently blind that path (it sends a message but no code today).
   */
  languageToolMessage?: string | null;
  /**
   * Stable, localizable reason the checker produced nothing: `hebrew-unsupported`, `disabled`,
   * `unavailable` or `timeout` (LanguageToolEngine's four NAMED `ServiceUnavailableCode` values). These
   * are not the API's whole vocabulary: `LanguageToolEngine.cs` has a FIFTH `ServiceUnavailable = true`
   * path (the `he` auto-retry-SUCCESS branch), and it carries no code AND a non-empty issue list - so
   * "the reason the checker produced nothing" is wrong for it twice over: it has no code, and it did
   * produce issues. See PAGEDRAFT_DESIGN.md's "KNOWN GAP" paragraph (language-engine issues endpoint),
   * which records this path correctly. ABSENT on a legacy API build that predates the code, or on that
   * fifth path - both are exactly the case the client's unknown-code fallback covers.
   */
  languageToolCode?: string | null;
}

export interface LanguageIssue {
  startOffset: number;
  endOffset: number;
  message: string;
  category: 'grammar' | 'spelling' | 'punctuation' | 'style';
  severity: 'error' | 'warning' | 'info';
  confidence: number;
  suggestions: string[];
  ruleId?: string;
}

export interface LanguageAnalysis {
  linguistic?: LinguisticAnalysis;
  literary?: LiteraryAnalysis;
}

export interface LinguisticAnalysis {
  syntaxMetrics?: Record<string, any>;
  morphologyMetrics?: Record<string, any>;
  styleMetrics?: Record<string, any>;
  grammaticalityScore?: number;
  deviations?: { metric: string; sceneValue: number; chapterBaseline: number; note: string }[];
  consistencyIssues?: { type: 'register' | 'tense' | 'pov'; span: string; description: string }[];
}

export interface LiteraryAnalysis {
  themes?: string[];
  tone?: string;
  narrativeVoice?: string;
  rhetoricalDevices?: string[];
}

/**
 * Structured Literary analysis result, mirroring the backend `LiteraryAnalysisResult`
 * (Services/Analysis/StructuredResults.cs). The backend extracts the model output into this shape and
 * stores it re-serialized as JSON in `AnalysisResultDto.resultText`. Keys are camelCase (ASP.NET
 * default). All fields are optional here because the source is model output and may be partial /
 * malformed; the renderer parses defensively and skips empty sections.
 *
 * Note: distinct from the older, simpler `LiteraryAnalysis` above (themes as plain strings) - this is
 * the rich shape actually produced by the LiteraryAnalysis pipeline.
 */
export interface LiteraryAnalysisResult {
  themes?: LiteraryTheme[];
  tone?: string;
  toneDescription?: string;
  narrativeVoice?: string;
  narrativeVoiceDescription?: string;
  rhetoricalDevices?: LiteraryRhetoricalDevice[];
  moodProgression?: string;
  summary?: string;
}

export interface LiteraryTheme {
  name?: string;
  description?: string;
  /** "major" | "minor" (backend default "major"). */
  significance?: string;
}

export interface LiteraryRhetoricalDevice {
  name?: string;
  example?: string;
  effect?: string;
}
