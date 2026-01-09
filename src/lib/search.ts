export const DEFAULT_SEARCH_MAX_TERMS = 8;

export function normalizeSearchQuery(input: string, maxTerms = DEFAULT_SEARCH_MAX_TERMS): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  return normalized.split(' ').filter(Boolean).slice(0, maxTerms).join(' ');
}

export function buildTsQuery(input: string, maxTerms = DEFAULT_SEARCH_MAX_TERMS): string {
  const normalized = normalizeSearchQuery(input, maxTerms);
  if (!normalized) return '';
  return normalized.split(' ').join(' & ');
}
