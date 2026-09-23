import { DEFAULT_WINDOW_CHARS, MARKDOWN_CAP_CHARS } from '../web.constants.ts';
import { findPhrases, renderFoundPhrases } from './find.utils.ts';

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

export type CappedMarkdown = {
  readonly markdown: string;
  readonly shown?: MarkdownWindow;
};

/** A page past the guard is cut and says how much of the whole it holds — a truncation the model cannot see is one it reasons past. */
export function capMarkdown(markdown: string): CappedMarkdown {
  if (markdown.length <= MARKDOWN_CAP_CHARS) {
    return { markdown };
  }
  return {
    markdown: `${markdown.slice(0, MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} of ${markdown.length} characters`,
    shown: { from: 0, to: MARKDOWN_CAP_CHARS, total: markdown.length }
  };
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
    return { markdown: `${markdown}\n…end of page, ${total} characters in all` };
  }
  if (from >= total) {
    return {
      markdown: `…startChar ${startChar} is past the end of this page, which has ${total} characters`,
      shown: { from: total, to: total, total }
    };
  }
  const to = Math.min(from + width, total);
  const readOn = to < total ? `; read on with startChar=${to}, or startChar=-${TAIL_WINDOW_CHARS} for the end` : '';
  return {
    markdown: `${markdown.slice(from, to)}\n…showing characters ${from}–${to} of ${total}${readOn}`,
    shown: { from, to, total }
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
  return { ...result, markdown: `${leftOut}\n\n${result.markdown}` };
}
