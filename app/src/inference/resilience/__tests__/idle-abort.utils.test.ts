import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeadlineAbort } from '../idle-abort.utils.ts';

describe('createDeadlineAbort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should abort with a TimeoutError once the limit has passed (§7.1)', () => {
    const deadline = createDeadlineAbort(60_000);
    vi.advanceTimersByTime(59_999);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toMatchObject({ name: 'TimeoutError' });
  });

  it('should never abort once cleared', () => {
    const deadline = createDeadlineAbort(60_000);
    deadline.clear();
    vi.advanceTimersByTime(120_000);
    expect(deadline.signal.aborted).toBe(false);
  });
});
