/** what one plain fetch hands back before conversion — the transport's raw view of the resource */
export type FetchedResource = {
  readonly body: string;
  /** whether the body converts as HTML or is handed over as the text it already is */
  readonly kind: 'html' | 'text';
  readonly status: number;
  /** after redirects — not necessarily what was asked for */
  readonly url: string;
};
