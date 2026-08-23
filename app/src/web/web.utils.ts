import { NodeHtmlMarkdown } from 'node-html-markdown';
import { match } from 'ts-pattern';

import { MARKDOWN_CAP_CHARS } from './web.constants.ts';

import type { FormElement } from './snapshot/snapshot.types.ts';
import type { WebFailure, WebSnapshot } from './web.types.ts';

const TABLE_SEPARATOR_ROW = /^\|[\s|:-]+\|$/;

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
  return `- ⟨${element.ref}⟩ ${kind}${label}${state}`;
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

/** Cleaned, post-render HTML to the markdown a model reads. Tables survive as tables (§3.4). */
export function toMarkdown(html: string): string {
  return NodeHtmlMarkdown.translate(html).split('\n').map(collapseTableRow).join('\n').trim();
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
    .with(
      { kind: 'stale-ref' },
      ({ ref }) =>
        `⟨${ref}⟩ is not on the current page; the page has changed since that snapshot — use refs from the latest one`
    )
    .with({ kind: 'url-refused', reason: 'not-web-scheme' }, ({ url }) => `${url} is not an http or https page`)
    .with({ kind: 'url-refused', reason: 'not-public-host' }, ({ url }) => `${url} is not on the public web`)
    .exhaustive();
}

export function renderWebSnapshot(snapshot: WebSnapshot): string {
  const header = `${snapshot.title} — ${snapshot.url} (HTTP ${snapshot.status})`;
  const controls = snapshot.formElements.map((element) => renderFormElement(element));
  const formBlock = controls.length > 0 ? `\n\nForm controls:\n${controls.join('\n')}` : '';
  return `${header}\n\n${snapshot.markdown}${formBlock}`;
}
