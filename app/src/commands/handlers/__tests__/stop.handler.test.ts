import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { KillHandler } from '../kill.handler.ts';
import { StopHandler } from '../stop.handler.ts';

describe('StopHandler', () => {
  let killHandler: KillHandler;
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let stopHandler: StopHandler;
  let turnControlRegistry: MockedInstance<TurnControlRegistry>;

  beforeEach(async () => {
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.cancelPendingIn.mockResolvedValue(undefined);
    turnControlRegistry = MockFactory.createMock(TurnControlRegistry);
    turnControlRegistry.abortChannel.mockReturnValue(['mira', 'tess']);
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.displayNameOf.mockImplementation((username) => username.replace(/^./u, (first) => first.toUpperCase()));
    const moduleRef = await Test.createTestingModule({
      providers: [
        KillHandler,
        StopHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: TurnControlRegistry, useValue: turnControlRegistry }
      ]
    }).compile();
    killHandler = moduleRef.get(KillHandler);
    stopHandler = moduleRef.get(StopHandler);
  });

  const input = { channelId: 'channel-1', text: '', userId: 'casey-id', username: 'casey' };

  it('should flag every running turn under the invoker’s name, cancel every pending decision, and name the agents reached by name (§7.5)', async () => {
    const response = await stopHandler.handle(input);
    expect(turnControlRegistry.abortChannel).toHaveBeenCalledWith('channel-1', 'stopped', 'casey');
    expect(pendingDecisionsService.cancelPendingIn).toHaveBeenCalledWith('channel-1', 'stop');
    expect(response).toStrictEqual({
      audience: 'channel',
      text: '⏹️ Stopped Mira, Tess before any further tool call.'
    });
  });

  it('should name the agents a kill reached (§7.5)', async () => {
    const response = await killHandler.handle(input);
    expect(turnControlRegistry.abortChannel).toHaveBeenCalledWith('channel-1', 'killed', 'casey');
    expect(response).toStrictEqual({ audience: 'channel', text: '⏹️ Killed Mira, Tess.' });
  });

  it('should say nothing is running when no turn was flagged', async () => {
    turnControlRegistry.abortChannel.mockReturnValue([]);
    const response = await stopHandler.handle(input);
    expect(response).toStrictEqual({ audience: 'channel', text: '⏹️ Nothing running here to stop.' });
    expect(pendingDecisionsService.cancelPendingIn).toHaveBeenCalledWith('channel-1', 'stop');
  });
});
