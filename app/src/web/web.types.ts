import type { Result } from '@collegium/core/utils';

import type { PdfUnreadableReason } from './pdf/pdf.types.ts';
import type { FormElement } from './snapshot/snapshot.types.ts';

/** what one browser action hands back before conversion — the session's raw view of the page */
export type RenderedCapture = {
  readonly formElements: readonly FormElement[];
  readonly html: string;
  /** addresses of tabs the page opened during the action, closed unvisited and left for the model to open itself */
  readonly openedUrls: readonly string[];
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};

/** the address a name resolved to and was judged at — what a pinned connection targets (§3.4) */
export type VettedAddress = {
  readonly address: string;
  readonly family: 4 | 6;
};

/**
 * The §3.4 address policy, one per process: what may be asked for, what a name may resolve to, and
 * the two together as the browser's proxy applies them per request. Injectable so the deployment's
 * own declaration shapes it, and so the real-browser suite can admit its loopback server.
 */
export type AddressPolicy = {
  readonly refuse: (url: string) => undefined | WebFailure.UrlRefused;
  readonly resolve: (url: URL) => Promise<Result<VettedAddress, WebFailure.Navigation | WebFailure.UrlRefused>>;
  readonly vet: (url: URL) => Promise<undefined | VettedAddress>;
};

/** §3.8 — the part of a page a result holds when the whole did not fit, in characters of its markdown */
export type MarkdownWindow = {
  readonly from: number;
  readonly to: number;
  readonly total: number;
};

/** one page, in the shape a model reads — what a plain fetch yields */
export type WebPage = {
  readonly markdown: string;
  /** absent when the result holds the whole page */
  readonly shown?: MarkdownWindow;
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};

/** §3.4 — what one fetch reads of a page: a window of it, or where phrases occur in it */
export type PageRead = {
  /** the page as served, navigation and all, rather than its main content */
  readonly wholePage: boolean;
} & (
  | { readonly kind: 'find'; readonly phrases: readonly string[] }
  | { readonly kind: 'window'; readonly maxChars?: number; readonly startChar: number }
);

/** §3.4 — the markdown a fetch reads from, and how much of the whole page it leaves out */
export type PageView = {
  readonly leftOutChars: number;
  readonly markdown: string;
};

/** §3.4 — the rate limit a fetch waited out before the answer it reports: the status that asked, and the wait */
export type RateLimitRetry = {
  readonly status: number;
  readonly waitedMs: number;
};

/** one fetched page as read */
export type FetchedPage = WebPage & {
  /** how many times the phrases occur; present when the read was a find */
  readonly matches?: number;
  readonly retry?: RateLimitRetry;
};

/** one rendered page state: a page plus the controls a later action may target */
export type WebSnapshot = WebPage & {
  readonly formElements: readonly FormElement[];
  readonly openedUrls: readonly string[];
};

/**
 * §3.4 — why a certificate did not verify, as far as the error establishes it. Only an incomplete
 * chain, an expiry, a name mismatch and a self-signed leaf are the site's fault on their face; an
 * issuer nobody here trusts is as likely a gap in this deployment's own trust store.
 */
export type TlsReason =
  'expired' | 'incomplete-chain' | 'name-mismatch' | 'self-signed' | 'unclassified' | 'untrusted-issuer';

export declare namespace WebFailure {
  /** the ref is on the page and visible, and the action on it failed — about the element, not the page's load (§3.4) */
  type ActionFailed = {
    kind: 'action-failed';
    message: string;
    ref: string;
  };
  /** the site answered a read without a browser with a refusal or a bot check instead of the page (§3.4) */
  type Blocked = {
    kind: 'blocked';
    retry?: RateLimitRetry;
    status: number;
    url: string;
  };
  /** every live-session slot is held by another turn, and none frees until the turn holding it ends (§3.4) */
  type Busy = {
    kind: 'busy';
    sessions: number;
  };
  /** the page rendered and produced nothing — the assertion this module exists for */
  type EmptyRender = {
    kind: 'empty-render';
    status: number;
    url: string;
  };
  /** the server answered with an error status and nothing readable — an error, not a page left unrendered */
  type HttpError = {
    bodyChars: number;
    kind: 'http-error';
    retry?: RateLimitRetry;
    status: number;
    url: string;
  };
  /** DNS, connection refused, navigation timeout — the page's fault, not the browser's */
  type Navigation = {
    kind: 'navigation';
    message: string;
  };
  /** click or fill before any navigate in this turn — there is no page to act on */
  type NoSession = {
    kind: 'no-session';
  };
  /** the address serves a PDF or text, which the browser does not open and web::fetch reads (§3.4) */
  type NotHtml = {
    contentType: string;
    kind: 'not-html';
    url: string;
  };
  /** the select offers no option with that label or value, so nothing was chosen */
  type NoSuchOption = {
    kind: 'no-such-option';
    option: string;
    ref: string;
  };
  /** every page of the PDF was read and none carries a text layer — a scan, most likely, and nothing here reads an image (§3.4) */
  type NoText = {
    kind: 'no-text';
    pageCount: number;
    url: string;
  };
  /** the ref is on the page but CSS hides it, so no click or fill can land until it is revealed */
  type NotVisible = {
    kind: 'not-visible';
    ref: string;
  };
  /** the HTML fetched without a browser reads as nothing — the page needs client rendering */
  type NoStaticContent = {
    kind: 'no-static-content';
    status: number;
    url: string;
  };
  /** the ref points at nothing in the current page state — the page moved on since that snapshot */
  type StaleRef = {
    kind: 'stale-ref';
    ref: string;
  };
  /** the connection was refused at its TLS handshake, so nothing was read; `code` is the runtime's own name for it */
  type Tls = {
    code: string;
    kind: 'tls';
    reason: TlsReason;
  };
  /** the browser did not answer: unprovisioned or failed to launch, never the page's fault */
  type Unreachable = {
    kind: 'unreachable';
    message: string;
  };
  /** served as a PDF, and nothing of it could be read; one past the body cap is not parsed, since a cut PDF does not */
  type UnreadablePdf = {
    kind: 'unreadable-pdf';
    reason: 'too-large' | PdfUnreadableReason;
    url: string;
  };
  /** the body is none of a page, a PDF or text — an image, an archive — and nothing here reads it (§3.4) */
  type UnsupportedContent = {
    contentType: string;
    kind: 'unsupported-content';
    url: string;
  };
  /** the address is outside what this instrument reads — the open web, over http(s), less what the operator denied (§3.4) */
  type UrlRefused = {
    kind: 'url-refused';
    reason: 'denied-host' | 'not-public-host' | 'not-web-scheme';
    url: string;
  };
  type Any =
    | ActionFailed
    | Blocked
    | Busy
    | EmptyRender
    | HttpError
    | Navigation
    | NoSession
    | NoStaticContent
    | NoSuchOption
    | NoText
    | NotHtml
    | NotVisible
    | StaleRef
    | Tls
    | Unreachable
    | UnreadablePdf
    | UnsupportedContent
    | UrlRefused;
}

export type WebFailure = WebFailure.Any;
