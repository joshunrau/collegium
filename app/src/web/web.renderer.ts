import { match } from 'ts-pattern';

import { FETCH_BODY_CAP_BYTES, SELECT_OPTIONS_SHOWN } from './web.constants.ts';

import type { FormElement } from './snapshot/snapshot.types.ts';
import type { FetchedPage, RateLimitRetry, TlsReason, WebFailure, WebPage, WebSnapshot } from './web.types.ts';

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

/** a tab the page opened is closed unvisited; naming its address hands the choice, and the URL policy, back to the model */
function renderOpenedTab(url: string): string {
  const address = url === 'about:blank' ? 'an address it had not yet loaded' : url;
  return `The page opened a new tab to ${address}; it was closed — open it with web::navigate or web::fetch if it matters.`;
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
    .with({ kind: 'no-such-option' }, ({ option, ref }) => {
      return `⟨${ref}⟩ offers no option "${option}", so nothing was chosen — pass an option as the latest snapshot lists it`;
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
    .with({ kind: 'empty-render' }, () => '⚠️ nothing rendered')
    .with({ kind: 'http-error' }, ({ status }) => `⚠️ HTTP ${status}`)
    .with({ kind: 'navigation' }, () => '⚠️ did not load')
    .with({ kind: 'no-session' }, () => '⚠️ no page open')
    .with({ kind: 'no-such-option' }, () => '⚠️ no such option')
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

export function renderWebPage(page: Pick<FetchedPage, 'retry'> & WebPage): string {
  const retried = page.retry === undefined ? '' : `; ${describeRetry(page.retry)}`;
  const header = `${page.title} — ${page.url} (HTTP ${page.status}${retried})`;
  const caveat = GONE_STATUSES.has(page.status) ? `\n${BUILT_URL_CAVEAT}` : '';
  return `${header}${caveat}\n\n${page.markdown}`;
}

export function renderWebSnapshot(snapshot: WebSnapshot): string {
  const controls = snapshot.formElements.map((element) => renderFormElement(element));
  const formBlock = controls.length > 0 ? `\n\nForm controls:\n${controls.join('\n')}` : '';
  const tabsBlock = snapshot.openedUrls.length > 0 ? `\n\n${snapshot.openedUrls.map(renderOpenedTab).join('\n')}` : '';
  return `${renderWebPage(snapshot)}${formBlock}${tabsBlock}`;
}
