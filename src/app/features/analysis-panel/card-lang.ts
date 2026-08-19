import { AnalysisResultDto } from '../../core/models/analysis';

/**
 * Resolve the display language ('he' | 'en') for a suggestion-card's localized labels (e.g. the
 * consistency category chip). Mirrors how the Run tab already picks language for line-edit category
 * labels: prefer the result's own language, then the book language, defaulting to Hebrew (the product
 * default). Anything starting with 'en' is English; everything else is Hebrew.
 *
 * P3-36: trimmed before lowercasing (previously only lowercased) so a padded tag like ' En-US ' still
 * resolves to 'en' - found when `issue-panel.component.ts` was routed through this shared normalizer
 * instead of its own local re-implementation, which DID trim, and its existing padded-tag spec caught
 * the gap.
 */
export function resolveCardLang(
  result: AnalysisResultDto | null | undefined,
  bookLanguage: string | null | undefined
): 'he' | 'en' {
  const raw = (result?.language || bookLanguage || 'he').trim().toLowerCase();
  return raw.startsWith('en') ? 'en' : 'he';
}
