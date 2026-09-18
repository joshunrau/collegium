import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EnvService } from '@/config/env/env.service.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';

import { CallbackTokenGuard } from '../callback-token.guard.ts';

const TOKEN = 'c'.repeat(32);

const requestWith = (authorization?: string): ExecutionContext => {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) } as ExecutionContext;
};

describe('CallbackTokenGuard', () => {
  let guard: CallbackTokenGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CallbackTokenGuard,
        { provide: EnvService, useValue: createEnvServiceMock({ CALLBACK_TOKEN: TOKEN }) }
      ]
    }).compile();
    guard = moduleRef.get(CallbackTokenGuard);
  });

  it('should admit the bearer the plugin presents (§6.4)', () => {
    expect(guard.canActivate(requestWith(`Bearer ${TOKEN}`))).toBe(true);
  });

  it('should refuse a missing or wrong bearer before the route reads its body (§6.4)', () => {
    expect(() => guard.canActivate(requestWith())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(requestWith(`Bearer ${'d'.repeat(32)}`))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(requestWith(TOKEN))).toThrow(UnauthorizedException);
  });
});
