export function analysisItems(text: string): string[] {
  if (!text?.trim()) return [];
  const trimmed = text.trim();
  if (!/\d+\.\s/.test(trimmed)) return [trimmed];
  const parts = trimmed
    .split(/\s*\d+\.\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [trimmed];
}

