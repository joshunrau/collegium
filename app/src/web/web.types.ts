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

/** one page state, in the shape a model reads */
export type WebSnapshot = {
  readonly formElements: readonly FormElement[];
  readonly markdown: string;
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
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
  type Any = Busy | EmptyRender | Navigation | NoSession | StaleRef | Unreachable;
}

export type WebFailure = WebFailure.Any;
