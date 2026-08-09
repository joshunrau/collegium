import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApprovalsService } from '@/approvals/approvals.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { StopHandler } from '../stop.handler.ts';

describe('StopHandler', () => {
  let approvalsService: MockedInstance<ApprovalsService>;
  let stopHandler: StopHandler;
  let turnControlRegistry: MockedInstance<TurnControlRegistry>;

  beforeEach(async () => {
    approvalsService = MockFactory.createMock(ApprovalsService);
    approvalsService.cancelPendingIn.mockResolvedValue(1);
    turnControlRegistry = MockFactory.createMock(TurnControlRegistry);
    turnControlRegistry.abortChannel.mockReturnValue(2);
    const moduleRef = await Test.createTestingModule({
      providers: [
        StopHandler,
        { provide: ApprovalsService, useValue: approvalsService },
        { provide: TurnControlRegistry, useValue: turnControlRegistry }
      ]
    }).compile();
    stopHandler = moduleRef.get(StopHandler);
  });

  it('should flag every running turn and cancel pending approvals in the channel', async () => {
    const response = await stopHandler.handle({ channelId: 'channel-1', text: '', username: 'casey' });
    expect(turnControlRegistry.abortChannel).toHaveBeenCalledWith('channel-1', 'stopped');
    expect(approvalsService.cancelPendingIn).toHaveBeenCalledWith('channel-1', 'stop');
    expect(response).toStrictEqual({ audience: 'channel', text: '⏹️ Stopping 2 turn(s) — no further actions.' });
  });

  it('should say nothing is running when no turn was flagged', async () => {
    turnControlRegistry.abortChannel.mockReturnValue(0);
    const response = await stopHandler.handle({ channelId: 'channel-1', text: '', username: 'casey' });
    expect(response).toStrictEqual({ audience: 'channel', text: '⏹️ Nothing running here to stop.' });
    expect(approvalsService.cancelPendingIn).toHaveBeenCalledWith('channel-1', 'stop');
  });
});
