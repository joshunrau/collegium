import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnsService } from '@/turns/turns.service.ts';

import { UsageHandler } from '../usage.handler.ts';

describe('UsageHandler', () => {
  let turnsService: MockedInstance<TurnsService>;
  let usageHandler: UsageHandler;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-09-13T12:00:00Z') });
    turnsService = MockFactory.createMock(TurnsService);
    turnsService.summarizeUsageEndedAfter.mockResolvedValue({
      rows: [],
      total: {
        cachedPromptTokens: { coverage: 'none' },
        completionTokens: 0,
        costUsd: { coverage: 'none' },
        promptTokens: 0,
        reasoningTokens: { coverage: 'none' },
        turnCount: 0
      }
    });
    turnsService.summarizeEstimatesAfter.mockResolvedValue({ completions: 0, tokens: 0 });
    const moduleRef = await Test.createTestingModule({
      providers: [UsageHandler, { provide: TurnsService, useValue: turnsService }]
    }).compile();
    usageHandler = moduleRef.get(UsageHandler);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should summarize the trailing 24 hours for the caller alone', async () => {
    const response = await usageHandler.handle();
    expect(turnsService.summarizeUsageEndedAfter).toHaveBeenCalledWith(new Date('2026-09-12T12:00:00Z'));
    expect(turnsService.summarizeEstimatesAfter).toHaveBeenCalledWith(new Date('2026-09-12T12:00:00Z'));
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'Usage — turns ended in the last 24 hours: none recorded.'
    });
  });
});
