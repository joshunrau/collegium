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
  let stderrSpy: MockInstance<(...args: any[]) => any>;
  let stdoutSpy: MockInstance<(...args: any[]) => any>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
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

  // the threshold ranks by position in LOG_LEVELS, so a misordering here silences the failure record
  it('should emit an error at a warn threshold', () => {
    new JSONLogger(undefined, 'warn').error('Broke');
    expect(JSON.parse(stderrSpy.mock.lastCall?.[0])).toMatchObject({ level: 'error', message: 'Broke' });
  });

  it('should drop a debug below an info threshold', () => {
    new JSONLogger(undefined, 'info').debug('noise');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
