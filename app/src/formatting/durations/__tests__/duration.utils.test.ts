import { describe, expect, it } from 'vitest';

import { renderElapsed } from '../duration.utils.ts';

describe('renderElapsed', () => {
  it('should render days and hours, hours and minutes, minutes, and under a minute', () => {
    expect(renderElapsed(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
    expect(renderElapsed(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(renderElapsed(17 * 60_000)).toBe('17m');
    expect(renderElapsed(10_000)).toBe('under a minute');
  });
});
