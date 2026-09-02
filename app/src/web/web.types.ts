import type { FormElement } from './snapshot/snapshot.types.ts';

/** what one browser action hands back before conversion — the session's raw view of the page */
export type RenderedCapture = {
  readonly formElements: readonly FormElement[];
  readonly html: string;
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};

/** one page, in the shape a model reads — what a plain fetch yields */
export type WebPage = {
  readonly markdown: string;
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};

/** one rendered page state: a page plus the controls a later action may target */
export type WebSnapshot = WebPage & {
  readonly formElements: readonly FormElement[];
};

export declare namespace WebFailure {
  /** every live-session slot is taken by other turns — try again once one ends */
  type Busy = {
    kind: 'busy';
  };
  /** the page rendered and produced nothing — the assertion this module exists for */
  type EmptyRender = {
    kind: 'empty-render';
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
  /** the HTML fetched without a browser reads as nothing — the page needs client rendering */
  type NoStaticContent = {
    kind: 'no-static-content';
    url: string;
  };
  /** the ref points at nothing in the current page state — the page moved on since that snapshot */
  type StaleRef = {
    kind: 'stale-ref';
    ref: string;
  };
  /** the browser did not answer: unprovisioned or failed to launch, never the page's fault */
  type Unreachable = {
    kind: 'unreachable';
    message: string;
  };
  /** the body is not text — a PDF, an image — and nothing here reads it (§3.4) */
  type UnsupportedContent = {
    contentType: string;
    kind: 'unsupported-content';
    url: string;
  };
  /** the address is outside what this instrument reads — the open web, over http(s) (§3.4) */
  type UrlRefused = {
    kind: 'url-refused';
    reason: 'not-public-host' | 'not-web-scheme';
    url: string;
  };
  type Any =
    | Busy
    | EmptyRender
    | Navigation
    | NoSession
    | NoStaticContent
    | StaleRef
    | Unreachable
    | UnsupportedContent
    | UrlRefused;
}

export type WebFailure = WebFailure.Any;
