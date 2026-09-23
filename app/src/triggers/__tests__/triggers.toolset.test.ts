import { Result } from '@collegium/core/utils';
import { describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import { buildToolTurnScope, executeTool } from '@/testing/factories/tool-turn.factory.ts';

import { TriggersService } from '../triggers.service.ts';
import { TRIGGERS_TOOLSET } from '../triggers.toolset.ts';

const { resolve } = TRIGGERS_TOOLSET.tools;

function buildContext() {
  const triggers = MockFactory.createMock(TriggersService);
  const context = { triggers, turn: buildToolTurnScope() };
  return { context, triggers };
}

describe('TRIGGERS_TOOLSET', () => {
  it('resolves the named trigger for the acting agent in the turn’s channel', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(Result.ok({ triggerId: 'trigger-1' }));
    const result = await executeTool(resolve, { id: 'trigger-1' }, context);
    expect(triggers.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        agentUsername: 'mira',
        channelId: 'channel-1',
        triggerId: 'trigger-1',
        triggeringPostId: 'post-1'
      })
    );
    expect(result.unwrap().text).toBe('trigger trigger-1 resolved');
  });

  it('resolves the trigger that started the turn when no id is named (§4.2)', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(Result.ok({ triggerId: 'trigger-3' }));
    const result = await executeTool(resolve, {}, context);
    expect(triggers.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ triggerId: undefined, triggeringPostId: 'post-1' })
    );
    expect(result.unwrap().text).toBe('trigger trigger-3 resolved');
  });

  it('surfaces a not-resolvable failure so the agent can act on it', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(
      Result.err({ kind: 'not-resolvable', message: 'the source refused', triggerId: 'trigger-1' })
    );
    const result = await executeTool(resolve, { id: 'trigger-1' }, context);
    expect(result.error).toStrictEqual({ kind: 'invalid-arguments', message: 'the source refused' });
  });

  it('refuses an unmatched id by listing what the agent has outstanding here (§4.2)', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(
      Result.err({ kind: 'unmatched', outstandingIds: ['trigger-2', 'trigger-5'], triggerId: 'msg-7' })
    );
    const result = await executeTool(resolve, { id: 'msg-7' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        '"msg-7" is not a trigger id of yours: a trigger\'s id is the one its announcement brackets, never the sender\'s reference. Outstanding for you in this channel: trigger-2, trigger-5.'
    });
  });

  it('says a turn no trigger started must name one, and that nothing is outstanding', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(Result.err({ kind: 'unmatched', outstandingIds: [], triggerId: undefined }));
    const result = await executeTool(resolve, {}, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message:
        'This turn was not started by a trigger of yours, so name one by its id. You have no outstanding trigger in this channel.'
    });
  });
});
