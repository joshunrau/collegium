import type { Readable } from 'node:stream';

/** what one plain fetch hands back before conversion — the transport's raw view of the resource */
export type FetchedResource = {
  readonly body: string;
  /** whether the body converts as HTML or is handed over as the text it already is */
  readonly kind: 'html' | 'text';
  readonly status: number;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};

/** one response over a connection pinned to a vetted address, its body already decoded */
export type PinnedResponse = {
  readonly body: Readable;
  readonly headers: Headers;
  readonly status: number;
};

/** a fetched HTML page beside its conversion — what the verdict on reading it without a browser weighs (§3.4) */
export type ConvertedPage = {
  readonly body: string;
  readonly markdown: string;
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};
