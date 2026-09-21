import type { SearchResult } from './search.types.ts';

export function renderSearchResults(query: string, results: readonly SearchResult[]): string {
  if (results.length === 0) {
    return `No results for "${query}".`;
  }
  const entries = results.map((result, index) => {
    const summary = [result.age, result.description].filter((part) => part !== undefined && part !== '').join(' · ');
    const heading = `${index + 1}. ${result.title} — ${result.url}`;
    return summary === '' ? heading : `${heading}\n   ${summary}`;
  });
  return `Results for "${query}" — each is the provider's own excerpt, not the page:\n\n${entries.join('\n\n')}`;
}
