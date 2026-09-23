import type { Readable } from 'node:stream';

import type { RateLimitRetry } from '../web.types.ts';

type FetchedResponse = {
  readonly retry?: RateLimitRetry;
  readonly status: number;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};

/** what one plain fetch hands back before conversion — the transport's raw view of the resource */
export type FetchedResource = FetchedDocument | FetchedPdf;

/** a body read as text, cut at the byte cap with a marker saying so */
export type FetchedDocument = FetchedResponse & {
  readonly body: string;
  /** whether the body converts as HTML or is handed over as the text it already is */
  readonly kind: 'html' | 'text';
};

/** a PDF's bytes as served; one past the byte cap holds its first part alone */
export type FetchedPdf = FetchedResponse & {
  readonly bytes: Uint8Array;
  readonly isTruncated: boolean;
  readonly kind: 'pdf';
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
  readonly retry?: RateLimitRetry;
  readonly status: number;
  readonly title: string;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};
