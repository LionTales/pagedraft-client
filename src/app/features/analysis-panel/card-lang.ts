import { AnalysisResultDto } from '../../core/models/analysis';

/**
 * Resolve the display language ('he' | 'en') for a suggestion-card's localized labels (e.g. the
 * consistency category chip). Mirrors how the Run tab already picks language for line-edit category
 * labels: prefer the result's own language, then the book language, defaulting to Hebrew (the product
 * default). Anything starting with 'en' is English; everything else is Hebrew.
 */
export function resolveCardLang(
  result: AnalysisResultDto | null | undefined,
  bookLanguage: string | null | undefined
): 'he' | 'en' {
  const raw = (result?.language || bookLanguage || 'he').toLowerCase();
  return raw.startsWith('en') ? 'en' : 'he';
}
