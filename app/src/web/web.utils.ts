import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { TranslatorConfigObject } from 'node-html-markdown';
import { match } from 'ts-pattern';

import { MARKDOWN_CAP_CHARS } from './web.constants.ts';

import type { FormElement } from './snapshot/snapshot.types.ts';
import type { MarkdownWindow, WebFailure, WebPage, WebSnapshot } from './web.types.ts';

const TABLE_SEPARATOR_ROW = /^\|[\s|:-]+\|$/;

const NAMED_REFERENCES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['hellip', '…'],
  ['ldquo', '“'],
  ['lsquo', '‘'],
  ['lt', '<'],
  ['mdash', '—'],
  ['nbsp', '\u00A0'],
  ['ndash', '–'],
  ['quot', '"'],
  ['rdquo', '”'],
  ['rsquo', '’']
]);

const CHARACTER_REFERENCE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/giu;

const MAX_CODE_POINT = 0x10_ff_ff;

// not redundant: node-html-markdown reads a doctype with a public identifier as text, and Zoho
// still writes one (HTML 4.01 Transitional)
const DOCTYPE = /^\s*<!DOCTYPE[^>]*>/i;

const BASE_HREF = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i;

/** the tail the read-on footer offers, wide enough to hold a closing section without re-reading the page */
const TAIL_WINDOW_CHARS = 20_000;

function toCodePoint(body: string): number {
  return body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
}

/** node-html-markdown's own escaping of a link target, so a resolved address renders as an authored one does */
function encodeHref(href: string): string {
  return href.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('_', '%5F').replaceAll('*', '%2A');
}

/** absolute as written, resolved when relative, and as authored when it will not parse at all */
function resolveAgainst(base: undefined | URL, href: string): string {
  if (base === undefined) {
    return href;
  }
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** the page's own address, or the one its `<base>` names instead, since that is what a browser resolves against */
function resolveBase(html: string, pageUrl: string | undefined): undefined | URL {
  if (pageUrl === undefined) {
    return undefined;
  }
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return undefined;
  }
  const declared = BASE_HREF.exec(html)?.[1];
  if (declared === undefined) {
    return page;
  }
  try {
    return new URL(declared, page);
  } catch {
    return page;
  }
}

/**
 * node-html-markdown's link and image translators, re-stated with one addition: an address is
 * resolved against the page it came from, so a relative link the model reads is one it can hand
 * straight to `web::fetch`. The library keeps its defaults private, so they are restated rather
 * than wrapped.
 */
function linkTranslators(base: undefined | URL): TranslatorConfigObject {
  return {
    a: ({ node, options }) => {
      const href = node.getAttribute('href');
      if (!href) {
        return {};
      }
      const target = encodeHref(resolveAgainst(base, href));
      const title = node.getAttribute('title');
      if (node.textContent === href && options.useInlineLinks) {
        return { content: `<${target}>` };
      }
      return {
        postfix: `](${target}${title ? ` "${title}"` : ''})`,
        postprocess: ({ content }) => content.replaceAll(/(?:\r?\n)+/g, ' '),
        prefix: '['
      };
    },
    img: ({ node, options }) => {
      const src = node.getAttribute('src') ?? '';
      if (!src || (!options.keepDataImages && /^data:/i.test(src))) {
        return { ignore: true };
      }
      const alt = node.getAttribute('alt') ?? '';
      const title = node.getAttribute('title') ?? '';
      return { content: `![${alt}](${resolveAgainst(base, src)}${title && ` "${title}"`})`, recurse: false };
    }
  };
}

function renderFormElement(element: FormElement): string {
  const kind = element.kind === 'input' ? `input[type=${element.type}]` : element.kind;
  const label = element.label ? ` "${element.label}"` : '';
  const state = element.value ? ` = "${element.value}"` : '';
  const hidden = element.isHidden ? ' (hidden — reveal it before acting)' : '';
  return `- ⟨${element.ref}⟩ ${kind}${label}${state}${hidden}`;
}

/**
 * node-html-markdown pads table cells so columns line up for a human reader. The reader here is a
 * model, and on a real faculty directory that padding is 44% of the output — so it is collapsed
 * away. Only table rows are touched; indentation elsewhere is meaningful.
 */
function collapseTableRow(line: string): string {
  if (!line.startsWith('|')) {
    return line;
  }
  const collapsed = line.replaceAll(/ {2,}/g, ' ');
  return TABLE_SEPARATOR_ROW.test(collapsed) ? collapsed.replaceAll(/-{2,}/g, '---') : collapsed;
}

/** a tab the page opened is closed unvisited; naming its address hands the choice, and the URL policy, back to the model */
function renderOpenedTab(url: string): string {
  const address = url === 'about:blank' ? 'an address it had not yet loaded' : url;
  return `The page opened a new tab to ${address}; it was closed — open it with web::navigate or web::fetch if it matters.`;
}

/**
 * Text lifted out of HTML without a parser — a document's title, a search provider's snippet —
 * still carries its character references, so `&#x27;` would reach the model where an apostrophe
 * belongs. A reference this does not know is left as it arrived rather than guessed at.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replaceAll(CHARACTER_REFERENCE, (reference: string, body: string) => {
    if (!body.startsWith('#')) {
      return NAMED_REFERENCES.get(body.toLowerCase()) ?? reference;
    }
    const codePoint = toCodePoint(body);
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= MAX_CODE_POINT
      ? String.fromCodePoint(codePoint)
      : reference;
  });
}

/**
 * Cleaned, post-render HTML to the markdown a model reads. Tables survive as tables (§3.4), and
 * with the page's URL given, every link and image address is absolute. The library builds its
 * table-cell translators from a private list that custom ones do not reach, so the link
 * translator is set on that collection by hand — or a directory's email links would stay relative.
 */
export function toMarkdown(html: string, pageUrl?: string): string {
  const translators = linkTranslators(resolveBase(html, pageUrl));
  const converter = new NodeHtmlMarkdown({}, translators);
  converter.tableCellTranslators.set('a', translators.a!, true);
  converter.tableCellTranslators.set('img', translators.img!, true);
  return converter.translate(html.replace(DOCTYPE, '')).split('\n').map(collapseTableRow).join('\n').trim();
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
 * §3.8 — a fetched page read as a window: what is past the guard says where to read on and how to
 * reach the end, so a page larger than one result holds is finished in parts rather than re-read
 * from the top. A page that fits says where it ends, since completeness inferred from a missing
 * marker cannot be told from a marker that was forgotten.
 */
export function windowMarkdown(markdown: string, startChar: number, maxChars?: number): CappedMarkdown {
  const total = markdown.length;
  const width = Math.min(maxChars ?? MARKDOWN_CAP_CHARS, MARKDOWN_CAP_CHARS);
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

/** a recoverable browsing failure as the model hears it; `unreachable` is infrastructure and never rendered */
export function renderWebFailure(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'busy' }, () => 'the browser is at its concurrent-session limit; try again shortly')
    .with({ kind: 'empty-render' }, ({ status, url }) => {
      return `the page at ${url} answered HTTP ${status} and rendered no readable content`;
    })
    .with({ kind: 'http-error' }, ({ bodyChars, status, url }) => {
      return `${url} answered HTTP ${status} with ${bodyChars} characters of body and nothing readable in it; there is no page there, and a browser will not find one`;
    })
    .with({ kind: 'navigation' }, ({ message }) => `the page could not be loaded: ${message}`)
    .with({ kind: 'no-session' }, () => 'no page is open in this turn — navigate to a URL first')
    .with({ kind: 'not-visible' }, ({ ref }) => {
      return `⟨${ref}⟩ is on the page but CSS hides it, so no click or fill can land — reveal it first, e.g. web::hover on the menu or control that opens it`;
    })
    .with({ kind: 'no-static-content' }, ({ status, url }) => {
      return `the page at ${url} answered HTTP ${status} and has no readable content without JavaScript — open it with web::navigate instead`;
    })
    .with({ kind: 'stale-ref' }, ({ ref }) => {
      return `⟨${ref}⟩ is not on the current page; the page has changed since that snapshot — use refs from the latest one`;
    })
    .with({ kind: 'unsupported-content' }, ({ contentType, url }) => {
      return `${url} is ${contentType}, which this tool cannot read as text`;
    })
    .with({ kind: 'url-refused', reason: 'not-web-scheme' }, ({ url }) => `${url} is not an http or https page`)
    .with({ kind: 'url-refused', reason: 'not-public-host' }, ({ url }) => `${url} is not on the public web`)
    .exhaustive();
}

/** §8.1 — the same failure as the status post's mark: a phrase short enough for a trace line, since a call that bought nothing must not read like one that worked */
export function describeWebFailureOutcome(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'busy' }, () => '⚠️ browser busy')
    .with({ kind: 'empty-render' }, () => '⚠️ nothing rendered')
    .with({ kind: 'http-error' }, ({ status }) => `⚠️ HTTP ${status}`)
    .with({ kind: 'navigation' }, () => '⚠️ did not load')
    .with({ kind: 'no-session' }, () => '⚠️ no page open')
    .with({ kind: 'not-visible' }, () => '⚠️ hidden ref')
    .with({ kind: 'no-static-content' }, () => '⚠️ no static content')
    .with({ kind: 'stale-ref' }, () => '⚠️ stale ref')
    .with({ kind: 'unsupported-content' }, () => '⚠️ not text')
    .with({ kind: 'url-refused' }, () => '⚠️ refused')
    .exhaustive();
}

export function renderWebPage(page: WebPage): string {
  return `${page.title} — ${page.url} (HTTP ${page.status})\n\n${page.markdown}`;
}

export function renderWebSnapshot(snapshot: WebSnapshot): string {
  const controls = snapshot.formElements.map((element) => renderFormElement(element));
  const formBlock = controls.length > 0 ? `\n\nForm controls:\n${controls.join('\n')}` : '';
  const tabsBlock = snapshot.openedUrls.length > 0 ? `\n\n${snapshot.openedUrls.map(renderOpenedTab).join('\n')}` : '';
  return `${renderWebPage(snapshot)}${formBlock}${tabsBlock}`;
}
