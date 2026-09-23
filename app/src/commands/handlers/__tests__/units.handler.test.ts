import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { PendingDecisionsService } from '@/approvals/decisions/pending-decisions.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { UnitsHandler } from '../units.handler.ts';

const MIRA = buildAgentProfile();

describe('UnitsHandler', () => {
  let pendingDecisionsService: MockedInstance<PendingDecisionsService>;
  let tasksService: MockedInstance<TasksService>;
  let unitsHandler: UnitsHandler;

  const handle = (text: string) => {
    return unitsHandler.handle({ channelId: 'channel-1', text, userId: 'casey-id', username: 'casey' });
  };

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    tasksService = MockFactory.createMock(TasksService);
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'owen',
        createdAt: new Date(Date.now() - 17 * 60_000),
        creatorUsername: 'mira',
        outcome: 'a venue shortlist',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    pendingDecisionsService = MockFactory.createMock(PendingDecisionsService);
    pendingDecisionsService.listPending.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        UnitsHandler,
        DateFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: PendingDecisionsService, useValue: pendingDecisionsService },
        { provide: TasksService, useValue: tasksService }
      ]
    }).compile();
    unitsHandler = moduleRef.get(UnitsHandler);
  });

  it('should list an agent’s open units in this channel to the invoker alone (§8.4)', async () => {
    expect(await handle('mira')).toStrictEqual({
      audience: 'invoker',
      text: 'Open work for mira in this channel:\n- [abcd1234] to @owen · assigned · 17m — a venue shortlist'
    });
    expect(tasksService.listOpenFor).toHaveBeenCalledWith({ agentUsername: 'mira', channelId: 'channel-1' });
  });

  it('should name a party to the work whose turn here waits on a person, and leave out one elsewhere (§8.1)', async () => {
    const decision = {
      actionName: 'workspace::write',
      agentUsername: 'owen',
      channelId: 'channel-1',
      kind: 'approval',
      promptPostId: 'prompt-1',
      requestedAt: new Date('2026-09-22T12:00:00Z'),
      turnId: 'turn-1'
    } as const;
    pendingDecisionsService.listPending.mockResolvedValue([decision, { ...decision, agentUsername: 'tess' }]);
    const { text } = await handle('mira');
    expect(text).toContain(
      'Waiting on a person in this channel:\n- owen · 🔐 `workspace::write` · for '
    );
    expect(text).toContain('since September 22, 2026 at 12:00:00 PM UTC · prompt `prompt-1`');
    expect(text).not.toContain('tess');
    expect(pendingDecisionsService.listPending).toHaveBeenCalledWith({ channelId: 'channel-1' });
  });

  it('should cancel a unit on a human’s authority, announcing first and moving the row once the post landed (§3.15)', async () => {
    tasksService.prepareCancelOnHumanAuthority.mockResolvedValue(
      Result.ok({ prepared: { to: 'cancelled', unitId: 'unit-1' }, text: '⛔ Unit `abcd1234` cancelled by @casey' })
    );
    tasksService.commitTransition.mockResolvedValue(undefined);
    const response = await handle('mira cancel abcd1234');
    expect(response).toMatchObject({ audience: 'channel', text: '⛔ Unit `abcd1234` cancelled by @casey' });
    expect(tasksService.commitTransition).not.toHaveBeenCalled();
    await response.onAnnounced?.('post-7');
    expect(tasksService.commitTransition).toHaveBeenCalledExactlyOnceWith(
      { to: 'cancelled', unitId: 'unit-1' },
      'post-7'
    );
  });

  it('should tell the invoker when the reference resolves to nothing, posting nothing', async () => {
    tasksService.prepareCancelOnHumanAuthority.mockResolvedValue(Result.err({ kind: 'not-found', reference: 'zzzz' }));
    expect(await handle('mira cancel zzzz')).toStrictEqual({
      audience: 'invoker',
      text: 'no work unit with reference "zzzz" exists for you in this channel.'
    });
  });
});
