import { escapeRegExp } from 'es-toolkit';

/** what node-html-markdown puts a backslash before in running text */
const MARKDOWN_ESCAPABLE = /[\\`*_~[\]]/u;

type PhraseHit = {
  readonly offset: number;
  readonly snippet: string;
};

/**
 * A phrase as it can sit in the markdown: without regard to case, across any run of whitespace, and
 * through the backslash the conversion writes before `_` or `*`, so `first_last` finds `first\_last`.
 */
function toPhrasePattern(phrase: string): RegExp {
  const words = phrase
    .trim()
    .split(/\s+/u)
    .map((word) => {
      return [...word]
        .map((character) => {
          return MARKDOWN_ESCAPABLE.test(character) ? `\\\\?${escapeRegExp(character)}` : escapeRegExp(character);
        })
        .join('');
    });
  return new RegExp(words.join('\\s+'), 'giu');
}

function toSnippet(markdown: string, from: number, to: number): string {
  const text = markdown.slice(from, to).replaceAll(/\s+/gu, ' ').trim();
  return `${from > 0 ? '…' : ''}${text}${to < markdown.length ? '…' : ''}`;
}

function findPhrase(markdown: string, phrase: string): PhraseMatches {
  const hits: PhraseHit[] = [];
  let count = 0;
  let isCut = false;
  let shownTo = 0;
  for (const match of markdown.matchAll(toPhrasePattern(phrase))) {
    count++;
    if (match.index < shownTo) {
      continue;
    }
    if (hits.length === FIND_HITS_PER_PHRASE) {
      isCut = true;
      continue;
    }
    const from = Math.max(0, match.index - FIND_CONTEXT_CHARS);
    shownTo = Math.min(markdown.length, match.index + match[0].length + FIND_CONTEXT_CHARS);
    hits.push({ offset: match.index, snippet: toSnippet(markdown, from, shownTo) });
  }
  return { count, hits, isCut, phrase };
}

/** how much text a hit shows on each side of the match: a label and the field beside it */
export const FIND_CONTEXT_CHARS = 250;

/** how many places a find shows for one phrase; the rest are counted, since a narrower phrase finds them */
export const FIND_HITS_PER_PHRASE = 5;

export type PhraseMatches = {
  readonly count: number;
  readonly hits: readonly PhraseHit[];
  /** some occurrence is neither a hit nor inside one's snippet */
  readonly isCut: boolean;
  readonly phrase: string;
};

/** one phrase's matches: how many, and each place shown with the offset a read starts from */
export function renderPhraseMatches({ count, hits, isCut, phrase }: PhraseMatches): string {
  if (count === 0) {
    return `"${phrase}" — no match`;
  }
  const shown = isCut ? `, the first ${hits.length} places below` : '';
  const head = `"${phrase}" — ${count} match${count === 1 ? '' : 'es'}${shown}`;
  return [head, ...hits.map(({ offset, snippet }) => `at ${offset}: ${snippet}`)].join('\n');
}

/** §3.4, §3.8 — each phrase's places in a text, a bounded window of text around each, at offsets into that text */
export function findPhrases(markdown: string, phrases: readonly string[]): PhraseMatches[] {
  return phrases.map((phrase) => findPhrase(markdown, phrase));
}
