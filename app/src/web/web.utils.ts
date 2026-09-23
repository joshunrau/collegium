import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { TranslatorConfigFactory, TranslatorConfigObject } from 'node-html-markdown';
import { match } from 'ts-pattern';

import { findPhrases, renderFoundPhrases } from './fetch/find.utils.ts';
import { DEFAULT_WINDOW_CHARS, FETCH_BODY_CAP_BYTES, MARKDOWN_CAP_CHARS } from './web.constants.ts';

import type { FormElement } from './snapshot/snapshot.types.ts';
import type {
  FetchedPage,
  MarkdownWindow,
  PageRead,
  PageView,
  TlsReason,
  WebFailure,
  WebPage,
  WebSnapshot
} from './web.types.ts';

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

const CLOUDFLARE_CIPHER = /^(?:[0-9a-f]{2}){2,}$/i;

/** what Cloudflare's decoder script looks for in a link's address, and what it rewrites to `mailto:` */
const CLOUDFLARE_LINK_MARKER = '/cdn-cgi/l/email-protection#';

/** the class Cloudflare's decoder script replaces with the address it decodes, whatever the element */
const CLOUDFLARE_CLOAK_CLASS = '__cf_email__';

const PLAUSIBLE_ADDRESS = /^[^\s@]+@[^\s@]+$/u;

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

// not redundant: node-html-markdown reads a doctype with a public identifier as text, and Zoho
// still writes one (HTML 4.01 Transitional)
const DOCTYPE = /^\s*<!DOCTYPE[^>]*>/i;

const BASE_HREF = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i;

/** the tail the read-on footer offers, wide enough to hold a closing section without re-reading the page */
const TAIL_WINDOW_CHARS = 20_000;

/** §3.4 — the statuses that say nothing is at an address, which says nothing about a page at another */
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

const BUILT_URL_CAVEAT =
  "If you built this URL rather than read it off a page, this says nothing about the page you were after; use the site's index or search to find it.";

const SITE_TLS_FAULT = "a fault in the site's TLS configuration, which retrying will not fix";

/** §3.4 — why nothing of a PDF was read, each a dead end the model should not retry */
const UNREADABLE_PDFS: { readonly [Reason in WebFailure.UnreadablePdf['reason']]: string } = {
  encrypted: 'is protected by a password, so its text cannot be read',
  malformed: 'does not parse: it is damaged, or not a PDF despite its content type',
  'too-large': `is larger than the ${FETCH_BODY_CAP_BYTES / 1_000_000} MB web::fetch reads, and a PDF cut short does not parse`
};

/** §3.4 — each reason in the app's words; only a fault the error itself establishes is laid on the site */
const TLS_FAILURES: { readonly [Reason in TlsReason]: string } = {
  expired: `the site's certificate has expired — ${SITE_TLS_FAULT}`,
  'incomplete-chain': `the site sends its certificate without the intermediates that link it to a trusted authority — ${SITE_TLS_FAULT}`,
  'name-mismatch': `the site's certificate is for a different host name — ${SITE_TLS_FAULT}`,
  'self-signed': `the site's certificate is self-signed, so no authority vouches for it — ${SITE_TLS_FAULT}`,
  unclassified: 'the TLS handshake with the site failed',
  'untrusted-issuer':
    "the site's certificate was issued by an authority this deployment does not trust; the site's configuration or " +
    "this deployment's trust store may be at fault, and retrying will not fix it"
};

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
function resolveBase(html: string, pageUrl: string): undefined | URL {
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

type TranslatedElement = Parameters<TranslatorConfigFactory>[0]['node'];

/** an element Cloudflare cloaked, read as the address its script would have written in its place */
function decodeCloakedElement(node: TranslatedElement): string | undefined {
  if (!node.classList.contains(CLOUDFLARE_CLOAK_CLASS)) {
    return undefined;
  }
  return decodeCloudflareEmail(node.getAttribute('data-cfemail') ?? '');
}

/** a link Cloudflare cloaked, read as the `mailto:` its script would have rewritten it to */
function decodeProtectedLink(href: string): string | undefined {
  const marker = href.indexOf(CLOUDFLARE_LINK_MARKER);
  return marker === -1 ? undefined : decodeCloudflareEmail(href.slice(marker + CLOUDFLARE_LINK_MARKER.length));
}

/**
 * node-html-markdown's link translator, re-stated with two additions: an address is resolved
 * against the page it came from, so a relative link the model reads is one it can hand straight to
 * `web::fetch`; and an address Cloudflare cloaked reads as its decoder script would have left it
 * (§3.4). The library keeps its defaults private, so they are restated rather than wrapped.
 */
function linkTranslators(base: undefined | URL): TranslatorConfigObject {
  return {
    a: ({ node, options }) => {
      const cloaked = decodeCloakedElement(node);
      if (cloaked !== undefined) {
        return { content: cloaked, recurse: false };
      }
      const href = node.getAttribute('href');
      if (!href) {
        return {};
      }
      const protectedAddress = decodeProtectedLink(href);
      const target = encodeHref(
        protectedAddress === undefined ? resolveAgainst(base, href) : `mailto:${protectedAddress}`
      );
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
    span: ({ node }) => {
      const cloaked = decodeCloakedElement(node);
      return cloaked === undefined ? {} : { content: cloaked, recurse: false };
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

/**
 * An image as its author described it, since its address is a read the model cannot make (§3.4).
 * One described as nothing is decoration by HTML's own convention, and is left out.
 */
const imageAsDescribed: TranslatorConfigFactory = ({ node }) => {
  const alt = (node.getAttribute('alt') ?? '').replaceAll(/\s+/g, ' ').trim();
  return alt === '' ? { ignore: true } : { content: `[image: ${alt}]`, recurse: false };
};

/**
 * Cleaned HTML to markdown by the given translators. Tables survive as tables (§3.4). The library
 * builds its table-cell translators from a private list that custom ones do not reach, so each
 * translator is set on that collection by hand — or a directory's email links would stay relative.
 */
function convertToMarkdown(html: string, translators: TranslatorConfigObject): string {
  const converter = new NodeHtmlMarkdown({}, translators);
  for (const [tags, translator] of Object.entries(translators)) {
    converter.tableCellTranslators.set(tags, translator, true);
  }
  return converter.translate(html.replace(DOCTYPE, '')).split('\n').map(collapseTableRow).join('\n').trim();
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
 * Cloudflare's email cloak undone as its decoder script undoes it, so a fetch without script reads
 * the address a browser would (§3.4): the first byte is a key XORed into each byte after it, and
 * what that spells is UTF-8. Anything that does not come out as an address is refused rather than
 * guessed at — a wrong address copied into a record is the harm this exists to prevent.
 */
export function decodeCloudflareEmail(hex: string): string | undefined {
  if (!CLOUDFLARE_CIPHER.test(hex)) {
    return undefined;
  }
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => {
    return Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  });
  const key = bytes[0]!;
  let decoded: string;
  try {
    decoded = STRICT_UTF8.decode(bytes.subarray(1).map((byte) => byte ^ key));
  } catch {
    return undefined;
  }
  return PLAUSIBLE_ADDRESS.test(decoded) ? decoded : undefined;
}

/** HTML with no page behind it — a mail body — to markdown, every address and image as authored */
export function toMarkdown(html: string): string {
  return convertToMarkdown(html, linkTranslators(undefined));
}

/**
 * A web page, fetched or rendered, to the markdown a model reads (§3.4): every link address
 * absolute against the page, and every image its alt text alone.
 */
export function pageToMarkdown(html: string, pageUrl: string): string {
  return convertToMarkdown(html, { ...linkTranslators(resolveBase(html, pageUrl)), img: imageAsDescribed });
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

/** a recoverable browsing failure as the model hears it; `unreachable` is infrastructure and never rendered */
export function renderWebFailure(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'blocked' }, ({ status, url }) => {
      return (
        `${url} answered HTTP ${status} with a refusal or a bot check instead of the page: the site turned away a ` +
        'read without a browser. web::navigate may get through, though some sites refuse a browser too'
      );
    })
    .with({ kind: 'busy' }, ({ sessions }) => {
      const held =
        sessions === 1
          ? 'the one browser session this deployment allows is held by another turn, and it frees only when that turn ends'
          : `all ${sessions} browser sessions this deployment allows are held by other turns, and one frees only when the turn holding it ends`;
      return `${held}. web::fetch needs no session and still works`;
    })
    .with({ kind: 'empty-render' }, ({ status, url }) => {
      const rendered = `the page at ${url} answered HTTP ${status} and rendered no readable content`;
      return GONE_STATUSES.has(status) ? `${rendered}. ${BUILT_URL_CAVEAT}` : rendered;
    })
    .with({ kind: 'http-error' }, ({ bodyChars, status, url }) => {
      const answered = `${url} answered HTTP ${status} with ${bodyChars} characters of body and nothing readable in it`;
      return GONE_STATUSES.has(status)
        ? `${answered}; there is no page at this address, and a browser will not find one. ${BUILT_URL_CAVEAT}`
        : answered;
    })
    .with({ kind: 'navigation' }, ({ message }) => `the page could not be loaded: ${message}`)
    .with({ kind: 'no-session' }, () => 'no page is open in this turn — navigate to a URL first')
    .with({ kind: 'no-text' }, ({ pageCount, pagesRead, url }) => {
      const read =
        pagesRead === pageCount ? `any of its ${pageCount} pages` : `the first ${pagesRead} of its ${pageCount} pages`;
      return `the PDF at ${url} has no text layer on ${read}: it is most likely scanned, and nothing here reads text from an image`;
    })
    .with({ kind: 'not-html' }, ({ contentType, url }) => {
      return `${url} is ${contentType}, not a web page, so the browser does not open it — read it with web::fetch, which reads PDFs and text`;
    })
    .with({ kind: 'not-visible' }, ({ ref }) => {
      return `⟨${ref}⟩ is on the page but CSS hides it, so no click or fill can land — reveal it first, e.g. web::hover on the menu or control that opens it`;
    })
    .with({ kind: 'no-static-content' }, ({ status, url }) => {
      return `the page at ${url} answered HTTP ${status} and has no readable content without JavaScript — open it with web::navigate instead`;
    })
    .with({ kind: 'stale-ref' }, ({ ref }) => {
      return `⟨${ref}⟩ is not on the current page; the page has changed since that snapshot — use refs from the latest one`;
    })
    .with({ kind: 'tls' }, ({ code, reason }) => {
      return `the page could not be loaded securely: ${TLS_FAILURES[reason]} (${code})`;
    })
    .with({ kind: 'unreadable-pdf' }, ({ reason, url }) => `the PDF at ${url} ${UNREADABLE_PDFS[reason]}`)
    .with({ kind: 'unsupported-content' }, ({ contentType, url }) => {
      return `${url} is ${contentType}, which no web tool reads: web::fetch reads web pages, PDFs and text`;
    })
    .with({ kind: 'url-refused', reason: 'not-web-scheme' }, ({ url }) => `${url} is not an http or https page`)
    .with({ kind: 'url-refused', reason: 'not-public-host' }, ({ url }) => `${url} is not on the public web`)
    .exhaustive();
}

/** §8.1 — the same failure as the status post's mark: a phrase short enough for a trace line, since a call that bought nothing must not read like one that worked */
export function describeWebFailureOutcome(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'blocked' }, ({ status }) => `⚠️ blocked (HTTP ${status})`)
    .with({ kind: 'busy' }, () => '⚠️ browser busy')
    .with({ kind: 'empty-render' }, () => '⚠️ nothing rendered')
    .with({ kind: 'http-error' }, ({ status }) => `⚠️ HTTP ${status}`)
    .with({ kind: 'navigation' }, () => '⚠️ did not load')
    .with({ kind: 'no-session' }, () => '⚠️ no page open')
    .with({ kind: 'no-text' }, () => '⚠️ no text layer')
    .with({ kind: 'not-html' }, () => '⚠️ not HTML')
    .with({ kind: 'not-visible' }, () => '⚠️ hidden ref')
    .with({ kind: 'no-static-content' }, () => '⚠️ no static content')
    .with({ kind: 'stale-ref' }, () => '⚠️ stale ref')
    .with({ kind: 'tls' }, () => '⚠️ TLS failed')
    .with({ kind: 'unreadable-pdf' }, () => '⚠️ unreadable PDF')
    .with({ kind: 'unsupported-content' }, () => '⚠️ not text')
    .with({ kind: 'url-refused' }, () => '⚠️ refused')
    .exhaustive();
}

export function renderWebPage(page: WebPage): string {
  const header = `${page.title} — ${page.url} (HTTP ${page.status})`;
  const caveat = GONE_STATUSES.has(page.status) ? `\n${BUILT_URL_CAVEAT}` : '';
  return `${header}${caveat}\n\n${page.markdown}`;
}

export function renderWebSnapshot(snapshot: WebSnapshot): string {
  const controls = snapshot.formElements.map((element) => renderFormElement(element));
  const formBlock = controls.length > 0 ? `\n\nForm controls:\n${controls.join('\n')}` : '';
  const tabsBlock = snapshot.openedUrls.length > 0 ? `\n\n${snapshot.openedUrls.map(renderOpenedTab).join('\n')}` : '';
  return `${renderWebPage(snapshot)}${formBlock}${tabsBlock}`;
}
