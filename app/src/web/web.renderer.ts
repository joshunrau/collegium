import type { ToolOutput } from '@collegium/core/tools';
import { match } from 'ts-pattern';

import {
  FETCH_BODY_CAP_BYTES,
  FORM_CONTROLS_MAX_CHARS,
  PDF_READ_MEMORY_CAP_BYTES,
  PDF_READ_TIMEOUT_MS,
  PDF_READS_AT_ONCE,
  SELECT_OPTIONS_SHOWN,
  SNAPSHOT_VIEW_CHARS
} from './web.constants.ts';

import type { FormElement } from './snapshot/snapshot.types.ts';
import type { FetchedPage, RateLimitRetry, TlsReason, WebFailure, WebPage, WebSnapshot } from './web.types.ts';

/** §3.4 — the statuses that say nothing is at an address, which says nothing about a page at another */
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/** how many near matches an option refusal names; a common fragment can match most of a long list */
const SIMILAR_OPTIONS_NAMED = 20;

const BUILT_URL_CAVEAT =
  "If you built this URL rather than read it off a page, this says nothing about the page you were after; use the site's index or search to find it.";

const SITE_TLS_FAULT = "a fault in the site's TLS configuration, which retrying will not fix";

const PDF_READ_SECONDS = `${PDF_READ_TIMEOUT_MS / 1000} seconds`;

/** §3.4 — why nothing of a PDF was read; only a busy reader is worth asking again */
const UNREADABLE_PDFS: { readonly [Reason in WebFailure.UnreadablePdf['reason']]: string } = {
  busy:
    `was not read: the ${PDF_READS_AT_ONCE} PDFs this deployment reads at once were all being read for the ` +
    `${PDF_READ_SECONDS} one read may take, waiting included. Asking again once they are done may read it`,
  deadline: `did not yield even its first page in the ${PDF_READ_SECONDS} one read may take, so its read was stopped`,
  encrypted: 'is protected by a password, so its text cannot be read',
  malformed: 'does not parse: it is damaged, or not a PDF despite its content type',
  'memory-limit':
    `took more than the ${PDF_READ_MEMORY_CAP_BYTES / 1_000_000} MB of memory one read may use before its first ` +
    'page was read, so its read was stopped',
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

/** §3.4 — said wherever the answer it came to is, so the model knows asking again at once is the site's to refuse */
function describeRetry({ status, waitedMs }: RateLimitRetry): string {
  return `retried once, ${Math.round(waitedMs / 100) / 10} s after an HTTP ${status}`;
}

function describeAnswer(status: number, retry: RateLimitRetry | undefined): string {
  return retry === undefined ? `HTTP ${status}` : `HTTP ${status} (${describeRetry(retry)})`;
}

/** §3.4 — what a select offers, since web::select takes one of them back by its label */
function renderSelectOptions(options: readonly string[]): string {
  const listed = options
    .slice(0, SELECT_OPTIONS_SHOWN)
    .map((option) => `"${option}"`)
    .join(', ');
  const more = options.length > SELECT_OPTIONS_SHOWN ? `, and ${options.length - SELECT_OPTIONS_SHOWN} more` : '';
  return `; options: ${listed}${more}`;
}

function renderFormElement(element: FormElement): string {
  const kind = element.kind === 'input' ? `input[type=${element.type}]` : element.kind;
  const label = element.label ? ` "${element.label}"` : '';
  const state = element.value ? ` = "${element.value}"` : '';
  const hidden = element.isHidden ? ' (hidden — reveal it before acting)' : '';
  const options = element.kind === 'select' ? renderSelectOptions(element.options) : '';
  return `- ⟨${element.ref}⟩ ${kind}${label}${state}${hidden}${options}`;
}

/**
 * §3.4 — the controls in page order up to their bound, then a count of the rest, which follow the
 * page in the record rather than pushing it past the view.
 */
function renderFormControls(elements: readonly FormElement[]): { readonly rest: string; readonly shown: string } {
  if (elements.length === 0) {
    return { rest: '', shown: '' };
  }
  const lines = elements.map(renderFormElement);
  let shownCount = 0;
  let shownChars = 0;
  for (const line of lines) {
    if (shownCount > 0 && shownChars + line.length + 1 > FORM_CONTROLS_MAX_CHARS) {
      break;
    }
    shownChars += line.length + 1;
    shownCount++;
  }
  const rest = lines.slice(shownCount);
  const more =
    rest.length === 0
      ? ''
      : `\n${rest.length} more control${rest.length === 1 ? '' : 's'}, listed after the page; the rest by reference: results__read find`;
  return {
    rest: rest.length === 0 ? '' : `\n\nForm controls, continued:\n${rest.join('\n')}`,
    shown: `Form controls:\n${lines.slice(0, shownCount).join('\n')}${more}\n\n`
  };
}

/**
 * §3.4 — where a page that grows with each action first differs from the snapshot before, as an
 * offset into this result. The line holding the offset comes before it, so the offset counts the
 * line's own length: `leadLength` measures the lead holding a candidate line until the two agree.
 */
function renderUnchangedLine(prefixChars: number | undefined, leadLength: (line: string) => number): string {
  if (prefixChars === undefined) {
    return '';
  }
  const lineAt = (offset: number) =>
    `unchanged from your previous snapshot up to character ${offset} of this result; results__read at that offset reads what changed\n\n`;
  let offset = leadLength('') + prefixChars;
  while (leadLength(lineAt(offset)) + prefixChars !== offset) {
    offset = leadLength(lineAt(offset)) + prefixChars;
  }
  return lineAt(offset);
}

/** a tab the page opened is closed unvisited; naming its address hands the choice, and the URL policy, back to the model */
function renderOpenedTab(url: string): string {
  const address = url === 'about:blank' ? 'an address it had not yet loaded' : url;
  return `The page opened a new tab to ${address}; it was closed — open it with web::navigate or web::fetch if it matters.`;
}

/** what a page's markdown follows: the header line, and the caveat a missing page carries */
function renderWebPageHead(page: Pick<FetchedPage, 'retry'> & WebPage): string {
  const retried = page.retry === undefined ? '' : `; ${describeRetry(page.retry)}`;
  const header = `${page.title} — ${page.url} (HTTP ${page.status}${retried})`;
  const caveat = GONE_STATUSES.has(page.status) ? `\n${BUILT_URL_CAVEAT}` : '';
  return `${header}${caveat}\n\n`;
}

/** a recoverable browsing failure as the model hears it; `unreachable` is infrastructure and never rendered */
export function renderWebFailure(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'action-failed' }, ({ message, ref }) => {
      return (
        `⟨${ref}⟩ is on the page, but the action on it failed: ${message}. The page itself loaded; check what ` +
        'the element is in the latest snapshot — a select takes web::select, not web::fill'
      );
    })
    .with({ kind: 'blocked' }, ({ retry, status, url }) => {
      return (
        `${url} answered ${describeAnswer(status, retry)} with a refusal or a bot check instead of the page: the site turned away a ` +
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
    .with({ kind: 'empty-body' }, ({ status, url }) => {
      return `${url} answered HTTP ${status} with an empty body: there is nothing to read at this address. ${BUILT_URL_CAVEAT}`;
    })
    .with({ kind: 'empty-render' }, ({ status, url }) => {
      const rendered = `the page at ${url} answered HTTP ${status} and rendered no readable content`;
      return GONE_STATUSES.has(status) ? `${rendered}. ${BUILT_URL_CAVEAT}` : rendered;
    })
    .with({ kind: 'http-error' }, ({ bodyChars, retry, status, url }) => {
      const answered = `${url} answered ${describeAnswer(status, retry)} with ${bodyChars} characters of body and nothing readable in it`;
      return GONE_STATUSES.has(status)
        ? `${answered}; there is no page at this address, and a browser will not find one. ${BUILT_URL_CAVEAT}`
        : answered;
    })
    .with({ kind: 'navigation' }, ({ message }) => `the page could not be loaded: ${message}`)
    .with({ kind: 'no-session' }, () => 'no page is open in this turn — navigate to a URL first')
    .with({ kind: 'no-such-option' }, ({ option, ref, similar }) => {
      const refused = `⟨${ref}⟩ offers no option "${option}", so nothing was chosen`;
      if (similar.length === 0) {
        return `${refused}, and no option's label contains it — pass an option as the latest snapshot lists it`;
      }
      const named = similar
        .slice(0, SIMILAR_OPTIONS_NAMED)
        .map((label) => `"${label}"`)
        .join(', ');
      const more = similar.length > SIMILAR_OPTIONS_NAMED ? `, and ${similar.length - SIMILAR_OPTIONS_NAMED} more` : '';
      return `${refused}; the options whose labels contain it are ${named}${more} — pass one of them as it is written`;
    })
    .with({ kind: 'no-text' }, ({ pageCount, url }) => {
      return `the PDF at ${url} has no text layer on any of its ${pageCount} pages: it is most likely scanned, and nothing here reads text from an image`;
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
    .with({ kind: 'tls' }, ({ code, reason }) => {
      return `the page could not be loaded securely: ${TLS_FAILURES[reason]} (${code})`;
    })
    .with({ kind: 'unreadable-pdf' }, ({ reason, url }) => `the PDF at ${url} ${UNREADABLE_PDFS[reason]}`)
    .with({ kind: 'unsupported-content' }, ({ contentType, url }) => {
      return `${url} is ${contentType}, which no web tool reads: web::fetch reads web pages, PDFs and text`;
    })
    .with({ kind: 'url-refused', reason: 'not-web-scheme' }, ({ url }) => `${url} is not an http or https page`)
    .with({ kind: 'url-refused', reason: 'not-public-host' }, ({ url }) => `${url} is not on the public web`)
    .with({ kind: 'url-refused', reason: 'denied-host' }, ({ url }) => {
      return `${url} is on a host this deployment has closed to its agents, so no web tool reads it`;
    })
    .exhaustive();
}

/** §8.1 — the same failure as the status post's mark: a phrase short enough for a trace line, since a call that bought nothing must not read like one that worked */
export function describeWebFailureOutcome(failure: Exclude<WebFailure, WebFailure.Unreachable>): string {
  return match(failure)
    .with({ kind: 'action-failed' }, () => '⚠️ action failed')
    .with({ kind: 'blocked' }, ({ status }) => `⚠️ blocked (HTTP ${status})`)
    .with({ kind: 'busy' }, () => '⚠️ browser busy')
    .with({ kind: 'empty-body' }, () => '⚠️ empty body')
    .with({ kind: 'empty-render' }, () => '⚠️ nothing rendered')
    .with({ kind: 'http-error' }, ({ status }) => `⚠️ HTTP ${status}`)
    .with({ kind: 'navigation' }, () => '⚠️ did not load')
    .with({ kind: 'no-session' }, () => '⚠️ no page open')
    .with({ kind: 'no-such-option' }, () => '⚠️ no such option')
    .with({ kind: 'no-text' }, () => '⚠️ no text layer')
    .with({ kind: 'not-html' }, () => '⚠️ not HTML')
    .with({ kind: 'not-visible' }, () => '⚠️ hidden ref')
    .with({ kind: 'no-static-content' }, () => '⚠️ no static content')
    .with({ kind: 'tls' }, () => '⚠️ TLS failed')
    .with({ kind: 'unreadable-pdf', reason: 'busy' }, () => '⚠️ PDF reader busy')
    .with({ kind: 'unreadable-pdf' }, () => '⚠️ unreadable PDF')
    .with({ kind: 'unsupported-content' }, () => '⚠️ not text')
    .with({ kind: 'url-refused' }, () => '⚠️ refused')
    .exhaustive();
}

export function renderWebPage(page: Pick<FetchedPage, 'retry'> & WebPage): string {
  return `${renderWebPageHead(page)}${page.markdown}`;
}

/**
 * §3.4 — a snapshot as the model reads it: what it did, the page head, its form controls and the
 * tabs it opened, then the page, whose view ends a fixed width in; the rest is read on by reference
 * (§3.8). Controls past their bound follow the page, where a find reaches them.
 */
export function renderWebSnapshot(snapshot: WebSnapshot): Pick<ToolOutput, 'text' | 'viewChars'> {
  const stale =
    snapshot.staleRef === undefined
      ? ''
      : `⟨${snapshot.staleRef}⟩ is no longer on the page, so nothing was done; the page as it is now follows\n\n`;
  const controls = renderFormControls(snapshot.formElements);
  const tabs = snapshot.openedUrls.length > 0 ? `${snapshot.openedUrls.map(renderOpenedTab).join('\n')}\n\n` : '';
  const leadWith = (unchanged: string) => `${stale}${renderWebPageHead(snapshot)}${unchanged}${controls.shown}${tabs}`;
  const lead = leadWith(renderUnchangedLine(snapshot.unchangedPrefixChars, (line) => leadWith(line).length));
  return { text: `${lead}${snapshot.markdown}${controls.rest}`, viewChars: lead.length + SNAPSHOT_VIEW_CHARS };
}
