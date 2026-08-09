import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTimeout } from '../timeout.utils.ts';

const never = (): Promise<string> => new Promise<string>(() => undefined);

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve with the operation when it settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1000, () => 'expired')).resolves.toBe('done');
  });

  it('should resolve with the fallback once the deadline passes', async () => {
    const race = withTimeout(never(), 1000, () => 'expired');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(race).resolves.toBe('expired');
  });

  it('should reject with the error onTimeout throws', async () => {
    const rejection = expect(
      withTimeout(never(), 1000, () => {
        throw new Error('deadline exceeded');
      })
    ).rejects.toThrow('deadline exceeded');
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
  });

  it('should wrap a non-error thrown by onTimeout', async () => {
    const thrown: unknown = 'deadline exceeded';
    const rejection = expect(
      withTimeout(never(), 1000, () => {
        throw thrown;
      })
    ).rejects.toThrow(new Error('deadline exceeded'));
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
  });
});
