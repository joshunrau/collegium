import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { TriggerTokenGuard } from '../trigger-token.guard.ts';

const CALLBACK_TOKEN = 'c'.repeat(32);

const TRIGGER_TOKEN = 't'.repeat(32);

const requestWith = (authorization?: string): ExecutionContext => {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) } as ExecutionContext;
};

const build = async (triggerToken: string | undefined) => {
  const loggingService = MockFactory.createMock(LoggingService);
  const moduleRef = await Test.createTestingModule({
    providers: [
      TriggerTokenGuard,
      { provide: EnvService, useValue: createEnvServiceMock({ CALLBACK_TOKEN, TRIGGER_TOKEN: triggerToken }) },
      { provide: LoggingService, useValue: loggingService }
    ]
  }).compile();
  return { guard: moduleRef.get(TriggerTokenGuard), loggingService };
};

describe('TriggerTokenGuard', () => {
  it('should admit the trigger token and refuse the callback token, which authorises more than announcing work (§6.4)', async () => {
    const { guard } = await build(TRIGGER_TOKEN);
    expect(guard.canActivate(requestWith(`Bearer ${TRIGGER_TOKEN}`))).toBe(true);
    expect(() => guard.canActivate(requestWith(`Bearer ${CALLBACK_TOKEN}`))).toThrow(UnauthorizedException);
  });

  it('should refuse every request and say so once at boot when no trigger token is set (§6.4)', async () => {
    const { guard, loggingService } = await build(undefined);
    expect(loggingService.warn).toHaveBeenCalledExactlyOnceWith(
      'HTTP trigger intake is disabled: TRIGGER_TOKEN is not set'
    );
    expect(() => guard.canActivate(requestWith(`Bearer ${TRIGGER_TOKEN}`))).toThrow(UnauthorizedException);
  });
});
