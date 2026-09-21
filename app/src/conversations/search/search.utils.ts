import type { SearchHit } from '../conversations.types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** §3.8 — what one hit may spend of the turn's context before its text is windowed around the match */
const HIT_CAP_CHARS = 1000;

function renderHeader(hit: SearchHit): string {
  return `⟨${hit.id}⟩ in ${hit.channelName} — @${hit.authorUsername} — ${hit.createdAt.toISOString()}`;
}

/** §3.8 — delimited rather than requoted, so the text is the author's bytes and a quote of it copies a block */
function renderBody(hit: SearchHit, text: string): string {
  return `<<<post ${hit.id}\n${text}\n>>>`;
}

function windowAroundMatch(message: string, query: string): string {
  const match = message.toLowerCase().indexOf(query.toLowerCase());
  const centre = match === -1 ? 0 : match + Math.floor(query.length / 2);
  const from = Math.min(Math.max(centre - Math.floor(HIT_CAP_CHARS / 2), 0), message.length - HIT_CAP_CHARS);
  const to = from + HIT_CAP_CHARS;
  return `${from === 0 ? '' : '…'}${message.slice(from, to)}${to === message.length ? '' : '…'}`;
}

function renderSearchHit(hit: SearchHit, query: string): string {
  if (hit.message.length <= HIT_CAP_CHARS) {
    return `${renderHeader(hit)}\n${renderBody(hit, hit.message)}`;
  }
  const cut = `…${hit.message.length} characters in all; read the whole post with conversations::search postId=${hit.id}`;
  return `${renderHeader(hit)}\n${renderBody(hit, windowAroundMatch(hit.message, query))}\n${cut}`;
}

/** §3.8 — the bound the description states, said again where a search came back empty, since that is where it decided the result */
const UNSEARCHABLE_KINDS_NOTE =
  'posts the framework made under an agent’s name, work-unit assignments, reports and closes, approval prompts, ' +
  'notices and status posts, are never matched';

/** §3.8 — each hit's source named and its text bounded, with the whole post one call away */
export function renderSearchHits(hits: readonly SearchHit[], query: string): string {
  if (hits.length === 0) {
    return (
      `no posts matched "${query}" — the query is matched as one literal substring, without regard to case ` +
      `and with no stemming; try a shorter distinctive phrase. Also, ${UNSEARCHABLE_KINDS_NOTE}`
    );
  }
  return hits.map((hit) => renderSearchHit(hit, query)).join('\n\n');
}

/**
 * §3.8 — one post read by id, whole. A post the search itself could not have returned reads exactly
 * as one that was never written, so the id says nothing about what is out of reach.
 */
export function renderSearchPost(hit: SearchHit | undefined, postId: string): string {
  if (hit === undefined) {
    return (
      `no post matched id ${postId} — a post is read here only while it sits in a channel this search ` +
      `reaches, after that channel's most recent episode boundary, and has not been forgotten; ${UNSEARCHABLE_KINDS_NOTE}`
    );
  }
  return `${renderHeader(hit)}\n${renderBody(hit, hit.message)}`;
}

/** §8.1 — what the call came to, so a read that found nothing does not trace like a productive one */
export function renderMatchCount(matches: number): string {
  return matches === 0 ? '⚠️ no matches' : `${matches} match${matches === 1 ? '' : 'es'}`;
}

/** a calendar day as the model states it, taken as a whole UTC day; the end is inclusive */
export function startOfUtcDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function endOfUtcDay(date: string): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS - 1);
}
