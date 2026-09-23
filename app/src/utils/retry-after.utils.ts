const RETRY_AFTER_SECONDS = /^\d+(?:\.\d+)?$/u;

/**
 * How long a `Retry-After` header asks the client to wait, in milliseconds: a number of seconds,
 * or an HTTP date. A header that says neither asks for nothing.
 */
export function parseRetryAfterHeaderMs(value: null | string, now: number): number | undefined {
  const retryAfter = value?.trim();
  if (!retryAfter) {
    return undefined;
  }
  if (RETRY_AFTER_SECONDS.test(retryAfter)) {
    return Math.ceil(Number(retryAfter) * 1000);
  }
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
