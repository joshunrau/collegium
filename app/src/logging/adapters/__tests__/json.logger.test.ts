import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { JSONLogger } from '../json.logger.ts';

vi.mock('colorette', () => ({
  gray: vi.fn((text: string) => text),
  green: vi.fn((text: string) => text),
  red: vi.fn((text: string) => text),
  yellow: vi.fn((text: string) => text)
}));

describe('JSONLogger', () => {
  let stdoutSpy: MockInstance<(...args: any[]) => any>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should omit context when none is configured', () => {
    new JSONLogger().log('Test message');
    expect(JSON.parse(stdoutSpy.mock.lastCall?.[0])).toStrictEqual({
      level: 'info',
      message: 'Test message',
      timestamp: expect.any(String)
    });
  });
});
