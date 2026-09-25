import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { TranslatorConfigFactory, TranslatorConfigObject } from 'node-html-markdown';

import { decodeCloakedElement, decodeProtectedLink } from './cloudflare.utils.ts';

const TABLE_SEPARATOR_ROW = /^\|[\s|:-]+\|$/;

// not redundant: node-html-markdown reads a doctype with a public identifier as text, and Zoho
// still writes one (HTML 4.01 Transitional)
const DOCTYPE = /^\s*<!DOCTYPE[^>]*>/i;

const BASE_HREF = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i;

const MAILTO = /^mailto:/i;

/**
 * node-html-markdown's own escaping of a link target, so a resolved address renders as an authored
 * one does. An email address is left as its owner writes it, since `first%5Flast@` is what a model
 * would copy into a record (§3.4): only the parentheses that would end the link are escaped.
 */
function encodeHref(href: string): string {
  const parenthesesEscaped = href.replaceAll('(', '%28').replaceAll(')', '%29');
  return MAILTO.test(parenthesesEscaped)
    ? parenthesesEscaped
    : parenthesesEscaped.replaceAll('_', '%5F').replaceAll('*', '%2A');
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

/**
 * An image as its author described it, since its address is a read the model cannot make (§3.4).
 * One described as nothing is decoration by HTML's own convention, and is left out.
 */
const imageAsDescribed: TranslatorConfigFactory = ({ node }) => {
  const alt = (node.getAttribute('alt') ?? '').replaceAll(/\s+/g, ' ').trim();
  return alt === '' ? { ignore: true } : { content: `[image: ${alt}]`, recurse: false };
};

/**
 * §3.4 — a drop-down's options once, bounded. A snapshot lists them beside the select's ref, so its
 * page text only counts them; a fetched page has no such listing, so it names the first labels. A
 * datalist only suggests what an input may hold, and is left out.
 */
function dropDownTranslators(rendering: DropDownRendering): TranslatorConfigObject {
  return {
    datalist: { ignore: true },
    select: ({ node }) => {
      const labels = [...node.querySelectorAll('option')].map((option) => {
        return (option.getAttribute('label') ?? option.textContent).replaceAll(/\s+/g, ' ').trim();
      });
      const count = `${labels.length} option${labels.length === 1 ? '' : 's'}`;
      if (rendering === 'counted') {
        return { content: `[drop-down: ${count}]`, recurse: false };
      }
      const listed = labels.slice(0, DROP_DOWN_LABELS_LISTED).join(' · ');
      const more =
        labels.length > DROP_DOWN_LABELS_LISTED ? ` · and ${labels.length - DROP_DOWN_LABELS_LISTED} more` : '';
      return { content: `[drop-down: ${count}: ${listed}${more}]`, recurse: false };
    }
  };
}

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

/** HTML with no page behind it — a mail body — to markdown, every address and image as authored */
export function toMarkdown(html: string): string {
  return convertToMarkdown(html, linkTranslators(undefined));
}

/** how many of a drop-down's labels a fetched page names inline */
export const DROP_DOWN_LABELS_LISTED = 100;

/** §3.4 — a snapshot counts a drop-down's options, since its form controls list them; a fetched page names them */
export type DropDownRendering = 'counted' | 'labelled';

/**
 * A web page, fetched or rendered, to the markdown a model reads (§3.4): every link address
 * absolute against the page, every image its alt text alone, and every drop-down's options once.
 */
export function pageToMarkdown(html: string, pageUrl: string, dropDowns: DropDownRendering): string {
  return convertToMarkdown(html, {
    ...linkTranslators(resolveBase(html, pageUrl)),
    ...dropDownTranslators(dropDowns),
    img: imageAsDescribed
  });
}
