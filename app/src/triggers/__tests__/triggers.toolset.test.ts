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
  it('resolves a trigger addressed to the acting agent', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(Result.ok());
    const result = await executeTool(resolve, { id: 'trigger-1' }, context);
    expect(triggers.resolve).toHaveBeenCalledWith('trigger-1', 'mira');
    expect(result.unwrap().text).toBe('trigger trigger-1 resolved');
  });

  it('surfaces a not-resolvable failure so the agent can act on it', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(
      Result.err({ kind: 'not-resolvable', message: 'the source refused', triggerId: 'trigger-1' })
    );
    const result = await executeTool(resolve, { id: 'trigger-1' }, context);
    expect(result.error).toStrictEqual({ kind: 'invalid-arguments', message: 'the source refused' });
  });

  it('treats an unknown id as the model’s recoverable mistake', async () => {
    const { context, triggers } = buildContext();
    triggers.resolve.mockResolvedValue(Result.err({ kind: 'not-found', triggerId: 'trigger-9' }));
    const result = await executeTool(resolve, { id: 'trigger-9' }, context);
    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no trigger "trigger-9" is addressed to you'
    });
  });
});
