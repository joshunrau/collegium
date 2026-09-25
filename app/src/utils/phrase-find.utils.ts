import { escapeRegExp } from 'es-toolkit';

/** what node-html-markdown puts a backslash before in running text */
const MARKDOWN_ESCAPABLE = /[\\`*_~[\]]/u;

/** one place a phrase occurs, and the stretch around it a find shows */
type PhraseHit = {
  readonly from: number;
  readonly offset: number;
  readonly to: number;
};

type Stretch = {
  readonly from: number;
  readonly to: number;
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
    hits.push({ from, offset: match.index, to: shownTo });
  }
  return { count, hits, isCut, phrase };
}

/** §3.4 — the stretches every phrase's hits show, each overlapping run merged into one, in the order of the text */
function mergeStretches(found: readonly PhraseMatches[]): Stretch[] {
  const ordered = found.flatMap(({ hits }) => hits).toSorted((left, right) => left.from - right.from);
  const merged: Stretch[] = [];
  for (const { from, to } of ordered) {
    const last = merged.at(-1);
    if (last !== undefined && from <= last.to) {
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, to) };
    } else {
      merged.push({ from, to });
    }
  }
  return merged;
}

/** one phrase's matches: how many, and the offset of each place shown, from which a read starts */
function renderPhraseLine({ count, hits, isCut, phrase }: PhraseMatches): string {
  if (count === 0) {
    return `"${phrase}" — no match`;
  }
  const offsets = hits.map(({ offset }) => offset).join(', ');
  const shown = isCut ? `, the first ${hits.length} at ${offsets}` : ` at ${offsets}`;
  return `"${phrase}" — ${count} match${count === 1 ? '' : 'es'}${shown}`;
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

/**
 * §3.4 — what a find shows: a line per phrase with its count and the offsets of its places, then the
 * text around those places, each stretch once and in the order of the text, labelled with its range,
 * since two phrases found side by side would otherwise show the same text twice.
 */
export function renderPhraseFind(markdown: string, found: readonly PhraseMatches[]): string {
  const stretches = mergeStretches(found).map(({ from, to }) => `[${from}–${to}] ${toSnippet(markdown, from, to)}`);
  return [found.map(renderPhraseLine).join('\n'), ...stretches].join('\n\n');
}

/** §3.4, §3.8 — each phrase's places in a text, a bounded window of text around each, at offsets into that text */
export function findPhrases(markdown: string, phrases: readonly string[]): PhraseMatches[] {
  return phrases.map((phrase) => findPhrase(markdown, phrase));
}
