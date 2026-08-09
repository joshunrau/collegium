import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActivationService } from '@/activation/activation.service.ts';
import { HaltService } from '@/halt/halt.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ResumeHandler } from '../resume.handler.ts';

describe('ResumeHandler', () => {
  let activationService: MockedInstance<ActivationService>;
  let haltService: MockedInstance<HaltService>;
  let resumeHandler: ResumeHandler;

  beforeEach(async () => {
    activationService = MockFactory.createMock(ActivationService);
    activationService.sweep.mockResolvedValue(undefined);
    haltService = MockFactory.createMock(HaltService);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResumeHandler,
        { provide: ActivationService, useValue: activationService },
        { provide: HaltService, useValue: haltService }
      ]
    }).compile();
    resumeHandler = moduleRef.get(ResumeHandler);
  });

  it('should clear the halt and hold the drain-and-flush sweep until the announcement posts', async () => {
    haltService.resume.mockReturnValue(Result.ok());
    const response = await resumeHandler.handle({ channelId: 'channel-1', text: '', username: 'casey' });
    expect(haltService.resume).toHaveBeenCalledWith('casey');
    expect(response.audience).toBe('channel');
    expect(activationService.sweep).not.toHaveBeenCalled();
    await response.afterAnnouncing?.();
    expect(activationService.sweep).toHaveBeenCalledTimes(1);
  });

  it('should report that nothing is halted, sweeping nothing', async () => {
    haltService.resume.mockReturnValue(Result.err({ kind: 'not-halted' }));
    const response = await resumeHandler.handle({ channelId: 'channel-1', text: '', username: 'casey' });
    expect(response).toStrictEqual({ audience: 'channel', text: 'Nothing is halted.' });
    expect(activationService.sweep).not.toHaveBeenCalled();
  });

  it('should post the refusal while the raising condition still holds, sweeping nothing', async () => {
    haltService.resume.mockReturnValue(Result.err({ channelId: 'channel-9', kind: 'violation-standing' }));
    const response = await resumeHandler.handle({ channelId: 'channel-1', text: '', username: 'casey' });
    expect(response.text).toContain('channel-9');
    expect(activationService.sweep).not.toHaveBeenCalled();
  });
});
