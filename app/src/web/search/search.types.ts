export type SearchRequest = {
  readonly count: number;
  readonly query: string;
};

/** one ranked hit — a summary of a page, never the page itself */
export type SearchResult = {
  /** the provider's own rendering of how old the page is, e.g. "3 days ago" */
  readonly age?: string;
  readonly description: string;
  readonly title: string;
  readonly url: string;
};

export declare namespace SearchFailure {
  /** the provider refused the credentials — a deployment misconfiguration, not the model's doing */
  type Auth = {
    kind: 'auth';
    message: string;
  };
  /** the provider throttled this deployment; a later search may succeed */
  type RateLimited = {
    kind: 'rate-limited';
  };
  /** the provider refused the query itself */
  type Rejected = {
    kind: 'rejected';
    message: string;
  };
  /** no usable answer: network failure, timeout, a server error, or a body outside the contract */
  type Unavailable = {
    kind: 'unavailable';
    message: string;
  };
  type Any = Auth | RateLimited | Rejected | Unavailable;
}

export type SearchFailure = SearchFailure.Any;
