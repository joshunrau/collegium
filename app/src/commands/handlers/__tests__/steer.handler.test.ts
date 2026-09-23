import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TurnControlRegistry } from '@/turns/control/turn-control.registry.ts';

import { SteerHandler } from '../steer.handler.ts';

describe('SteerHandler', () => {
  let steerHandler: SteerHandler;
  let turnControlRegistry: MockedInstance<TurnControlRegistry>;

  const steer = (text: string) => {
    return steerHandler.handle({ channelId: 'channel-1', text, userId: 'user-casey', username: 'casey' });
  };

  beforeEach(async () => {
    turnControlRegistry = MockFactory.createMock(TurnControlRegistry);
    turnControlRegistry.steer.mockReturnValue(Result.ok('mira'));
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.listAgentsIn.mockReturnValue([buildAgentProfile(), buildAgentProfile({ username: 'owen' })]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SteerHandler,
        { provide: RosterService, useValue: rosterService },
        { provide: TurnControlRegistry, useValue: turnControlRegistry }
      ]
    }).compile();
    steerHandler = moduleRef.get(SteerHandler);
  });

  it('should hand unnamed text to the running turn and name the agent it reached to the invoker alone (§7.5)', async () => {
    const response = await steer('  use staging ');
    expect(turnControlRegistry.steer).toHaveBeenCalledWith('channel-1', undefined, {
      byUsername: 'casey',
      text: 'use staging'
    });
    expect(response).toMatchObject({ audience: 'invoker', text: expect.stringContaining('Handed to `mira`:') });
  });

  it('should read a first word naming an agent here as the target, with or without its @ (§7.5)', async () => {
    await steer('@Owen use staging');
    expect(turnControlRegistry.steer).toHaveBeenCalledWith('channel-1', 'owen', {
      byUsername: 'casey',
      text: 'use staging'
    });
    await steer('tess said use staging');
    expect(turnControlRegistry.steer).toHaveBeenLastCalledWith('channel-1', undefined, {
      byUsername: 'casey',
      text: 'tess said use staging'
    });
  });

  it('should refuse an unnamed steer while more than one agent runs here, naming them (§7.5)', async () => {
    turnControlRegistry.steer.mockReturnValue(
      Result.err({ kind: 'ambiguous', runningAgentUsernames: ['mira', 'owen'] })
    );
    expect((await steer('use staging')).text).toBe(
      'More than one agent is running in this channel (`mira`, `owen`), so the steer reached none of them. Name the one it is for: /collegium steer {agent} {text}'
    );
  });

  it('should say nothing was running when no turn took it', async () => {
    turnControlRegistry.steer.mockReturnValue(Result.err({ kind: 'nothing-running' }));
    expect((await steer('use staging')).text).toBe(
      'Nothing is running in this channel, so there was nothing to steer.'
    );
  });

  it('should refuse a steer with no text after its agent with the usage line', async () => {
    expect(await steer(' @mira ')).toStrictEqual({
      audience: 'invoker',
      text: 'Usage: /collegium steer [agent] {text}'
    });
    expect(turnControlRegistry.steer).not.toHaveBeenCalled();
  });
});
