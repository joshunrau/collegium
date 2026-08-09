import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { LoggerFactory } from '../logging.factory.ts';

vi.mock('colorette', () => ({
  gray: vi.fn((text: string) => text),
  green: vi.fn((text: string) => text),
  red: vi.fn((text: string) => text),
  yellow: vi.fn((text: string) => text)
}));

describe('LoggerFactory', () => {
  let loggerFactory: LoggerFactory;
  let stdoutSpy: MockInstance<(...args: any[]) => any>;
  let stderrSpy: MockInstance<(...args: any[]) => any>;

  beforeEach(async () => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoggerFactory,
        { provide: ConfigService, useValue: createConfigServiceMock({ app: { logLevel: 'warn' } }) }
      ]
    }).compile();
    loggerFactory = moduleRef.get(LoggerFactory);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should hand out a logger labelled with the given context', () => {
    loggerFactory.createLogger('BootSequence').warn('careful');
    expect(JSON.parse(stderrSpy.mock.lastCall![0] as string)).toMatchObject({
      context: 'BootSequence',
      level: 'warn'
    });
  });

  it('should hand out a logger honouring the configured level', () => {
    loggerFactory.createLogger('BootSequence').log('quiet');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
