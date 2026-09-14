import type { SearchHit } from '../conversations.types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function renderSearchHit(hit: SearchHit): string {
  const header = `⟨${hit.id}⟩ in ${hit.channelName} — @${hit.authorUsername} — ${hit.createdAt.toISOString()}`;
  const quoted = hit.message
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${header}\n${quoted}`;
}

/** §3.8 — every hit whole and its source named, so the model can see it is quoting from elsewhere */
export function renderSearchHits(hits: readonly SearchHit[]): string {
  if (hits.length === 0) {
    return 'no posts matched';
  }
  return hits.map(renderSearchHit).join('\n\n');
}

/** a calendar day as the model states it, taken as a whole UTC day; the end is inclusive */
export function startOfUtcDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function endOfUtcDay(date: string): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS - 1);
}
