import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { TriggersService } from '@/triggers/triggers.service.ts';

import { ResolveTriggerTool } from '../resolve-trigger.tool.ts';

const turn = { agentUsername: 'mira', turnId: 'turn-1' } as Tool.TurnScope;

describe('ResolveTriggerTool', () => {
  let tool: ResolveTriggerTool;
  let triggers: MockedInstance<TriggersService>;

  beforeEach(async () => {
    triggers = MockFactory.createMock(TriggersService);
    const moduleRef = await Test.createTestingModule({
      providers: [ResolveTriggerTool, { provide: TriggersService, useValue: triggers }]
    }).compile();
    tool = moduleRef.get(ResolveTriggerTool);
  });

  it('should resolve under the agent of the turn, never one named by the model', async () => {
    triggers.resolve.mockResolvedValue(Result.ok());

    const result = await tool.execute({ id: 'trigger-1' }, turn);

    expect(triggers.resolve).toHaveBeenCalledWith('trigger-1', 'mira');
    expect(result.value).toStrictEqual({ text: 'trigger trigger-1 resolved' });
  });

  it('should feed a trigger that is not addressed to the agent back as invalid arguments', async () => {
    triggers.resolve.mockResolvedValue(Result.err({ kind: 'not-found', triggerId: 'trigger-9' }));

    const result = await tool.execute({ id: 'trigger-9' }, turn);

    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no trigger "trigger-9" is addressed to you'
    });
  });
});
