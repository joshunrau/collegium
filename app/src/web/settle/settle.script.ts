/// <reference lib="dom" />

/**
 * Runs inside the page: `page.evaluate` serializes the function source, so everything it needs
 * lives in its own body — no imports, no module-scope references, a JSON-serializable return.
 *
 * Resolves at `minMs` after the last mutation has been quiet for `quietMs`, whichever is later,
 * and at `timeoutMs` regardless. `load` and `networkidle` both say nothing about a view a timer is
 * about to render — an authentication delay, a spinner resolving — and neither does an idle DOM:
 * between the click and the timer firing there is nothing to observe. Hence the floor: a page is
 * given `minMs` to start reacting before its stillness is believed.
 */
export function waitForDomSettled(options: { minMs: number; quietMs: number; timeoutMs: number }): Promise<void> {
  return new Promise<void>((resolve) => {
    const startedAt = performance.now();
    let quietTimer = 0;
    const finish = (): void => {
      window.clearTimeout(quietTimer);
      window.clearTimeout(deadline);
      observer.disconnect();
      resolve();
    };
    const restartQuietTimer = (): void => {
      window.clearTimeout(quietTimer);
      const remainingFloor = options.minMs - (performance.now() - startedAt);
      quietTimer = window.setTimeout(finish, Math.max(options.quietMs, remainingFloor));
    };
    const observer = new MutationObserver(restartQuietTimer);
    // an animating page never goes quiet, so the deadline — not the observer — is what ends the wait there
    const deadline = window.setTimeout(finish, options.timeoutMs);
    observer.observe(document, { attributes: true, characterData: true, childList: true, subtree: true });
    restartQuietTimer();
  });
}
