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
  languageToolMessage?: string | null;
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
