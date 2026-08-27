import type { $LogLevel } from '@collegium/core/common';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { LoggingService } from '../logging.service.ts';

vi.mock('colorette', () => ({
  gray: vi.fn((text: string) => text),
  green: vi.fn((text: string) => text),
  red: vi.fn((text: string) => text),
  yellow: vi.fn((text: string) => text)
}));

@Injectable()
class SomeConsumer {
  constructor(readonly logger: LoggingService) {}
}

async function createTestingModule(logLevel: $LogLevel): Promise<TestingModule> {
  const configService = createConfigServiceMock({ logging: { level: logLevel } });
  return Test.createTestingModule({
    providers: [{ provide: ConfigService, useValue: configService }, LoggingService, SomeConsumer]
  }).compile();
}

async function createLoggingService(logLevel: $LogLevel = 'debug'): Promise<LoggingService> {
  const moduleRef = await createTestingModule(logLevel);
  const consumer = await moduleRef.resolve(SomeConsumer);
  return consumer.logger;
}

function lastEntry(spy: MockInstance<(...args: any[]) => any>): { [key: string]: unknown } {
  return JSON.parse(spy.mock.lastCall![0] as string) as { [key: string]: unknown };
}

describe('LoggingService', () => {
  let stdoutSpy: MockInstance<(...args: any[]) => any>;
  let stderrSpy: MockInstance<(...args: any[]) => any>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logging methods', () => {
    let loggingService: LoggingService;

    beforeEach(async () => {
      loggingService = await createLoggingService('debug');
    });

    it('should write a debug message to stdout', () => {
      loggingService.debug('Debug');
      expect(lastEntry(stdoutSpy)).toStrictEqual({
        context: 'SomeConsumer',
        level: 'debug',
        message: 'Debug',
        timestamp: expect.any(String)
      });
    });

    it('should write a log message to stdout at info', () => {
      loggingService.log('Log');
      expect(lastEntry(stdoutSpy)).toStrictEqual({
        context: 'SomeConsumer',
        level: 'info',
        message: 'Log',
        timestamp: expect.any(String)
      });
    });

    it('should write a verbose message to stdout at debug', () => {
      loggingService.verbose('Verbose');
      expect(lastEntry(stdoutSpy)).toMatchObject({ level: 'debug', message: 'Verbose' });
    });

    it('should write a warning to stderr', () => {
      loggingService.warn('Warning');
      expect(lastEntry(stderrSpy)).toMatchObject({ level: 'warn', message: 'Warning' });
    });

    it('should write an error message to stderr', () => {
      loggingService.error('Error');
      expect(lastEntry(stderrSpy)).toMatchObject({ level: 'error', message: 'Error' });
    });

    it('should write a fatal message to stderr at error', () => {
      loggingService.fatal('Fatal');
      expect(lastEntry(stderrSpy)).toMatchObject({ level: 'error', message: 'Fatal' });
    });

    it('should serialize an error-like message into the entry', () => {
      loggingService.error(new Error('Something went wrong'));
      expect(lastEntry(stderrSpy)).toMatchObject({
        error: {
          message: 'Something went wrong',
          name: 'Error',
          stack: expect.any(Array)
        },
        level: 'error'
      });
    });

    it('should serialize an error cause chain into the entry', () => {
      const cause = new Error('Root cause');
      loggingService.error(new Error('Something went wrong', { cause }));
      expect(lastEntry(stderrSpy)).toMatchObject({
        error: {
          cause: {
            message: 'Root cause',
            name: 'Error',
            stack: expect.any(Array)
          },
          message: 'Something went wrong',
          name: 'Error'
        },
        level: 'error'
      });
    });
  });

  describe('level threshold', () => {
    it('should suppress messages below the configured threshold', async () => {
      const loggingService = await createLoggingService('warn');
      loggingService.debug('hidden');
      loggingService.log('hidden');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should still write messages at or above the configured threshold', async () => {
      const loggingService = await createLoggingService('warn');
      loggingService.warn('shown');
      expect(stderrSpy).toHaveBeenCalledOnce();
    });
  });

  describe('context', () => {
    it("should derive the context from the injecting class' name", async () => {
      const loggingService = await createLoggingService();
      loggingService.log('Test message');
      expect(lastEntry(stdoutSpy)).toMatchObject({ context: 'SomeConsumer' });
    });

    it('should override the derived context with a trailing string argument', async () => {
      const loggingService = await createLoggingService();
      loggingService.log('Test message', 'OverrideContext');
      expect(lastEntry(stdoutSpy)).toMatchObject({ context: 'OverrideContext' });
    });

    it('should fall back to its own name when resolved without an injecting class', async () => {
      const moduleRef = await createTestingModule('debug');
      const loggingService = await moduleRef.resolve(LoggingService);
      loggingService.log('Test message');
      expect(lastEntry(stdoutSpy)).toMatchObject({ context: 'LoggingService' });
    });
  });
});
