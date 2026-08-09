// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForDomSettled } from '../settle.script.ts';

const elapsed = async (settled: Promise<void>): Promise<number> => {
  const started = performance.now();
  await settled;
  return performance.now() - started;
};

describe('waitForDomSettled', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should hold the floor open for a render the page has not started yet', async () => {
    const settled = waitForDomSettled({ minMs: 200, quietMs: 50, timeoutMs: 2000 });
    window.setTimeout(() => document.body.append(document.createElement('p')), 150);
    const duration = elapsed(settled);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await duration).toBe(200);
  });

  it('should extend past the floor when a mutation lands just inside it', async () => {
    const settled = waitForDomSettled({ minMs: 150, quietMs: 100, timeoutMs: 2000 });
    window.setTimeout(() => document.body.append(document.createElement('p')), 120);
    const duration = elapsed(settled);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await duration).toBe(220);
  });

  it('should give up at the deadline when the document never goes quiet', async () => {
    const ticker = window.setInterval(() => document.body.append(document.createElement('p')), 10);
    const duration = elapsed(waitForDomSettled({ minMs: 50, quietMs: 100, timeoutMs: 200 }));
    await vi.advanceTimersByTimeAsync(200);
    window.clearInterval(ticker);
    expect(await duration).toBe(200);
  });
});
