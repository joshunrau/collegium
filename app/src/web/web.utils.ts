import { NodeHtmlMarkdown } from 'node-html-markdown';
import { match } from 'ts-pattern';

import { MARKDOWN_CAP_CHARS } from './web.constants.ts';

import type { FormElement } from './snapshot/snapshot.types.ts';
import type { WebFailure, WebPage, WebSnapshot } from './web.types.ts';

const TABLE_SEPARATOR_ROW = /^\|[\s|:-]+\|$/;

// not redundant: node-html-markdown reads a doctype with a public identifier as text, and Zoho
// still writes one (HTML 4.01 Transitional)
const DOCTYPE = /^\s*<!DOCTYPE[^>]*>/i;

/** §3.4 — a filled input says that it is filled, never with what; a select names its own option */
function renderFormElement(element: FormElement): string {
  const kind = element.kind === 'input' ? `input[type=${element.type}]` : element.kind;
  const label = element.label ? ` "${element.label}"` : '';
  const state =
    element.kind === 'input' || element.kind === 'textarea'
      ? element.isFilled
        ? ' (filled)'
        : ''
      : element.value
        ? ` = "${element.value}"`
        : '';
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

/** Cleaned, post-render HTML to the markdown a model reads. Tables survive as tables (§3.4). */
export function toMarkdown(html: string): string {
  return NodeHtmlMarkdown.translate(html.replace(DOCTYPE, '')).split('\n').map(collapseTableRow).join('\n').trim();
}

/** A page past the guard is cut and says so — a truncation the model cannot see is one it reasons past. */
export function capMarkdown(markdown: string): string {
  if (markdown.length <= MARKDOWN_CAP_CHARS) {
    return markdown;
  }
  return `${markdown.slice(0, MARKDOWN_CAP_CHARS)}\n…page truncated at ${MARKDOWN_CAP_CHARS} characters`;
}

/** a recoverable browsing failure as the model hears it; `unreachable` is infrastructure and never rendered */
export function renderWebFailure(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'busy' }, () => 'the browser is at its concurrent-session limit; try again shortly')
    .with({ kind: 'empty-render' }, ({ url }) => `the page at ${url} rendered no readable content`)
    .with({ kind: 'navigation' }, ({ message }) => `the page could not be loaded: ${message}`)
    .with({ kind: 'no-session' }, () => 'no page is open in this turn — navigate to a URL first')
    .with({ kind: 'not-visible' }, ({ ref }) => {
      return `⟨${ref}⟩ is on the page but CSS hides it, so no click or fill can land — reveal it first, e.g. web::hover on the menu or control that opens it`;
    })
    .with({ kind: 'no-static-content' }, ({ url }) => {
      return `the page at ${url} has no readable content without JavaScript — open it with web::navigate instead`;
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

export function renderWebPage(page: WebPage): string {
  return `${page.title} — ${page.url} (HTTP ${page.status})\n\n${page.markdown}`;
}

export function renderWebSnapshot(snapshot: WebSnapshot): string {
  const controls = snapshot.formElements.map((element) => renderFormElement(element));
  const formBlock = controls.length > 0 ? `\n\nForm controls:\n${controls.join('\n')}` : '';
  const tabsBlock = snapshot.openedUrls.length > 0 ? `\n\n${snapshot.openedUrls.map(renderOpenedTab).join('\n')}` : '';
  return `${renderWebPage(snapshot)}${formBlock}${tabsBlock}`;
}
