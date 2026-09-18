import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { SteerHandler } from '../steer.handler.ts';

describe('SteerHandler', () => {
  let steerHandler: SteerHandler;
  let turnControlRegistry: MockedInstance<TurnControlRegistry>;

  beforeEach(async () => {
    turnControlRegistry = MockFactory.createMock(TurnControlRegistry);
    turnControlRegistry.steerChannel.mockReturnValue(1);
    const moduleRef = await Test.createTestingModule({
      providers: [SteerHandler, { provide: TurnControlRegistry, useValue: turnControlRegistry }]
    }).compile();
    steerHandler = moduleRef.get(SteerHandler);
  });

  it('should hand the text to the running turns in the channel and answer the invoker alone (§7.5)', async () => {
    const response = await steerHandler.handle({
      channelId: 'channel-1',
      text: '  use staging ',
      userId: 'user-casey',
      username: 'casey'
    });
    expect(turnControlRegistry.steerChannel).toHaveBeenCalledWith('channel-1', {
      byUsername: 'casey',
      text: 'use staging'
    });
    expect(response).toMatchObject({
      audience: 'invoker',
      text: expect.stringContaining('Handed to 1 running turn(s)')
    });
  });

  it('should say nothing was running when no turn took it', async () => {
    turnControlRegistry.steerChannel.mockReturnValue(0);
    const response = await steerHandler.handle({
      channelId: 'channel-1',
      text: 'use staging',
      userId: 'user-casey',
      username: 'casey'
    });
    expect(response.text).toBe('Nothing is running in this channel, so there was nothing to steer.');
  });

  it('should refuse empty text with the usage line', async () => {
    const response = await steerHandler.handle({
      channelId: 'channel-1',
      text: '   ',
      userId: 'user-casey',
      username: 'casey'
    });
    expect(response).toStrictEqual({ audience: 'invoker', text: 'Usage: /collegium steer {text}' });
    expect(turnControlRegistry.steerChannel).not.toHaveBeenCalled();
  });
});
