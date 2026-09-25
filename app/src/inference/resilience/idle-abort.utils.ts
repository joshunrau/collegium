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

export type DeadlineAbort = {
  /** cancels the pending abort: the completion settled first */
  readonly clear: () => void;
  readonly signal: AbortSignal;
};

/**
 * An abort that fires once `limitMs` has passed since it was made, whatever is still arriving: the
 * bound on how long one completion may hold its lane (§7.1), which a stream kept alive by bytes that
 * are not an answer would otherwise never meet. Built on setTimeout rather than AbortSignal.timeout,
 * so fake timers drive it in tests.
 */
export function createDeadlineAbort(limitMs: number): DeadlineAbort {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`the completion ran past its limit of ${limitMs}ms`, 'TimeoutError'));
  }, limitMs);
  return { clear: () => clearTimeout(timer), signal: controller.signal };
}
