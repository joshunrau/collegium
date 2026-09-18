import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { StopHandler } from '../stop.handler.ts';

describe('StopHandler', () => {
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let stopHandler: StopHandler;
  let turnControlRegistry: MockedInstance<TurnControlRegistry>;

  beforeEach(async () => {
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.cancelPendingIn.mockResolvedValue(undefined);
    turnControlRegistry = MockFactory.createMock(TurnControlRegistry);
    turnControlRegistry.abortChannel.mockReturnValue(2);
    const moduleRef = await Test.createTestingModule({
      providers: [
        StopHandler,
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: TurnControlRegistry, useValue: turnControlRegistry }
      ]
    }).compile();
    stopHandler = moduleRef.get(StopHandler);
  });

  it('should flag every running turn and cancel every pending decision in the channel', async () => {
    const response = await stopHandler.handle({
      channelId: 'channel-1',
      text: '',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(turnControlRegistry.abortChannel).toHaveBeenCalledWith('channel-1', 'stopped');
    expect(pendingDecisionsService.cancelPendingIn).toHaveBeenCalledWith('channel-1', 'stop');
    expect(response).toStrictEqual({ audience: 'channel', text: '⏹️ Stopped 2 turn(s) before any further tool call.' });
  });

  it('should say nothing is running when no turn was flagged', async () => {
    turnControlRegistry.abortChannel.mockReturnValue(0);
    const response = await stopHandler.handle({
      channelId: 'channel-1',
      text: '',
      userId: 'casey-id',
      username: 'casey'
    });
    expect(response).toStrictEqual({ audience: 'channel', text: '⏹️ Nothing running here to stop.' });
    expect(pendingDecisionsService.cancelPendingIn).toHaveBeenCalledWith('channel-1', 'stop');
  });
});
