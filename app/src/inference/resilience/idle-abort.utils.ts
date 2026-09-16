export type IdleAbort = {
  /** cancels the pending abort: the stream has been read to its end, or has already failed */
  readonly clear: () => void;
  readonly signal: AbortSignal;
  /** something arrived; the countdown starts over */
  readonly touch: () => void;
};

/**
 * An abort that fires once nothing has arrived for `idleMs` — not the connection, not the first
 * token, not the next one. A completion that keeps streaming is never cut, however long it thinks;
 * one the provider has stopped serving is, which a total deadline could not tell apart.
 */
export function createIdleAbort(idleMs: number): IdleAbort {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(new DOMException(`nothing arrived from the provider for ${idleMs}ms`, 'TimeoutError'));
    }, idleMs);
  };
  touch();
  return { clear: () => clearTimeout(timer), signal: controller.signal, touch };
}
