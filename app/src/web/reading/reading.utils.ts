import { findPhrases, renderPhraseMatches } from '@/utils/phrase-find.utils.ts';
import type { PhraseMatches } from '@/utils/phrase-find.utils.ts';

import { DEFAULT_WINDOW_CHARS, MARKDOWN_CAP_CHARS } from '../web.constants.ts';

import type { FetchedPage, MarkdownWindow, PageRead, PageView } from '../web.types.ts';

/** the tail the read-on footer offers, wide enough to hold a closing section without re-reading the page */
const TAIL_WINDOW_CHARS = 20_000;

function readMarkdown(markdown: string, read: PageRead): Pick<FetchedPage, 'markdown' | 'matches' | 'shown'> {
  if (read.kind === 'window') {
    return windowMarkdown(markdown, read.startChar, read.maxChars);
  }
  const found = findPhrases(markdown, read.phrases);
  return {
    markdown: renderFoundPhrases(found, markdown.length),
    matches: found.reduce((total, { count }) => total + count, 0)
  };
}

/** §3.4 — a page's finds, worded for a page read on with `startChar` */
export function renderFoundPhrases(found: readonly PhraseMatches[], pageChars: number): string {
  const lead = found.some(({ count }) => count > 0)
    ? `Where each phrase occurs in this page's ${pageChars} characters; read around a place with startChar and maxChars:`
    : `None of these phrases occurs in this page's ${pageChars} characters. A phrase matches without regard to case or line breaks; try a shorter or a different one.`;
  return [lead, ...found.map(renderPhraseMatches)].join('\n\n');
}

export type CappedMarkdown = {
  readonly markdown: string;
  readonly shown: MarkdownWindow;
};

/** A page past the guard is cut and says how much of the whole it holds — a truncation the model cannot see is one it reasons past. */
export function capMarkdown(markdown: string): CappedMarkdown {
  const total = markdown.length;
  if (total <= MARKDOWN_CAP_CHARS) {
    return { markdown, shown: { from: 0, markdownIndex: 0, to: total, total } };
  }
  return {
    markdown: `${markdown.slice(0, MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} of ${total} characters`,
    shown: { from: 0, markdownIndex: 0, to: MARKDOWN_CAP_CHARS, total }
  };
}

export function holdsWholePage(shown: MarkdownWindow): boolean {
  return shown.from === 0 && shown.to === shown.total;
}

/** §3.8 — a read headed by a paragraph its offsets do not count, its stretch still located in the markdown */
export function prependParagraph<TRead extends Pick<FetchedPage, 'markdown' | 'shown'>>(
  read: TRead,
  paragraph: string
): TRead {
  const head = `${paragraph}\n\n`;
  const shown = read.shown && { ...read.shown, markdownIndex: read.shown.markdownIndex + head.length };
  return { ...read, markdown: `${head}${read.markdown}`, ...(shown && { shown }) };
}

/**
 * §3.8 — a fetched page read as a window: a result that stops short says where to read on and how to
 * reach the end, so a page larger than one result holds is finished in parts rather than re-read
 * from the top. A page that fits says where it ends, since completeness inferred from a missing
 * marker cannot be told from a marker that was forgotten.
 */
export function windowMarkdown(markdown: string, startChar: number, maxChars?: number): CappedMarkdown {
  const total = markdown.length;
  const width = Math.min(maxChars ?? DEFAULT_WINDOW_CHARS, MARKDOWN_CAP_CHARS);
  const from = startChar < 0 ? Math.max(0, total + startChar) : startChar;
  if (from === 0 && total <= width) {
    return {
      markdown: `${markdown}\n…end of page, ${total} characters in all`,
      shown: { from, markdownIndex: 0, to: total, total }
    };
  }
  if (from >= total) {
    return {
      markdown: `…startChar ${startChar} is past the end of this page, which has ${total} characters`,
      shown: { from: total, markdownIndex: 0, to: total, total }
    };
  }
  const to = Math.min(from + width, total);
  const readOn = to < total ? `; read on with startChar=${to}, or startChar=-${TAIL_WINDOW_CHARS} for the end` : '';
  return {
    markdown: `${markdown.slice(from, to)}\n…showing characters ${from}–${to} of ${total}${readOn}`,
    shown: { from, markdownIndex: 0, to, total }
  };
}

/**
 * §3.4 — a fetched page read as the call asked: a window of it, or the places its phrases occur,
 * headed by what the view left out, since data a page keeps in its footer would otherwise be lost
 * without a word.
 */
export function readPage(view: PageView, read: PageRead): Pick<FetchedPage, 'markdown' | 'matches' | 'shown'> {
  const result = readMarkdown(view.markdown, read);
  if (view.leftOutChars <= 0) {
    return result;
  }
  const leftOut =
    `…${view.leftOutChars} characters outside the page's main content (navigation, header, footer) are left ` +
    'out, and offsets count without them; pass wholePage=true to include them';
  return prependParagraph(result, leftOut);
}
