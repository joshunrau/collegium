/* eslint-disable no-console -- exercising the patched console is the point of these tests */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { ConsoleBridge } from '../console.bridge.ts';

const logger = MockFactory.createMock(LoggingService);

describe('ConsoleBridge', () => {
  let consoleBridge: ConsoleBridge;
  let originalLog: typeof console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    originalLog = console.log;
    consoleBridge = new ConsoleBridge(logger as any);
    consoleBridge.onModuleInit();
  });

  afterEach(() => {
    consoleBridge.onApplicationShutdown();
  });

  it('should forward console.log to the logger at DEBUG, fully formatted', () => {
    console.log('websocket connecting to %s', 'wss://example.com');
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('websocket connecting to wss://example.com');
  });

  it('should format multiple arguments into a single entry', () => {
    console.log('got connection id ', 'abc-123');
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('got connection id  abc-123');
  });

  it('should keep the severity of warn and error', () => {
    console.warn('websocket closed');
    console.error('websocket error');
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('websocket closed');
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('websocket error');
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should inspect objects like the native console', () => {
    console.log({ connectFailCount: 2 });
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('{ connectFailCount: 2 }');
  });

  it('should not forward a blank line to the logger', () => {
    console.log();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should restore the original methods on shutdown', () => {
    consoleBridge.onApplicationShutdown();
    expect(console.log).toBe(originalLog);
    console.log = originalLog;
  });
});
