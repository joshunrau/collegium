import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { TasksService } from '../tasks.service.ts';

import type { PreparedUnit, WorkUnit } from '../tasks.types.ts';

type TurnRow = { depth: number; id: string; rootPostId: null | string };

const OWEN = buildAgentProfile({ tools: ['tasks'], username: 'owen' });
const OMAR = buildAgentProfile({ tools: [], username: 'omar' });
const MIRA = buildAgentProfile({ tools: ['tasks'], username: 'mira' });

describe('TasksService', () => {
  let loggingService: MockedInstance<LoggingService>;
  let tasksService: TasksService;
  let turns: TurnRow[];
  let units: ReturnType<typeof createModelTable<WorkUnit>>;

  beforeEach(async () => {
    turns = [{ depth: 0, id: 'turn-1', rootPostId: 'post-root' }];
    units = createModelTable<WorkUnit>({
      defaults: (sequence) => ({ closedAt: null, createdAt: new Date(sequence), updatedAt: new Date(sequence) })
    });
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username) => [MIRA, OWEN, OMAR].find((agent) => agent.username === username));
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.listAgentsIn.mockImplementation((channelId) => {
      return channelId === 'channel-1' ? [MIRA, OWEN, OMAR] : [MIRA];
    });
    loggingService = MockFactory.createMock(LoggingService);
    const multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.stripAgentMentions.mockImplementation((text: string) => text.replaceAll('@omar', 'omar'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: AgentRegistry, useValue: agentRegistry },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({ turns: { chainLengthLimit: 3, delegationDepthLimit: 2 } })
        },
        { provide: LoggingService, useValue: loggingService },
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        { provide: RosterService, useValue: rosterService },
        {
          provide: getModelToken('Turn'),
          useValue: {
            count: ({ where }: { where: { rootPostId: string } }) => {
              return Promise.resolve(turns.filter((turn) => turn.rootPostId === where.rootPostId).length);
            },
            findUnique: ({ where }: { where: { id: string } }) => {
              return Promise.resolve(turns.find((turn) => turn.id === where.id) ?? null);
            }
          }
        },
        { provide: getModelToken('WorkUnit'), useValue: units }
      ]
    }).compile();
    tasksService = moduleRef.get(TasksService);
  });

  const prepare = (
    overrides: { assigneeUsername?: string; channelId?: string; openUnitCap?: number; turnId?: string } = {}
  ) => {
    return tasksService.prepareAssign({
      actingAgentUsername: 'mira',
      assigneeUsername: 'owen',
      channelId: 'channel-1',
      context: 'nothing tried yet',
      criteria: 'three venues with prices',
      openUnitCap: 20,
      outcome: 'a venue shortlist',
      turnId: 'turn-1',
      ...overrides
    });
  };

  const assign = async (postId = 'post-1'): Promise<PreparedUnit> => {
    const prepared = (await prepare()).unwrap().prepared;
    await tasksService.commitAssign(prepared, postId);
    return prepared;
  };

  it('should prepare an assignment writing nothing, then create the row under its id pointing at the post (§3.15)', async () => {
    const prepared = (await prepare()).unwrap();
    expect(units.rows).toHaveLength(0);
    expect(prepared.text).toContain(`@owen — work unit \`${prepared.prepared.id.slice(0, 8)}\``);
    expect(prepared.text).toContain('**Criteria:** three venues with prices');
    await tasksService.commitAssign(prepared.prepared, 'post-1');
    expect(units.rows[0]).toMatchObject({
      assigneeUsername: 'owen',
      creatorUsername: 'mira',
      id: prepared.prepared.id,
      lastPostId: 'post-1',
      originPostId: 'post-1',
      state: 'assigned'
    });
  });

  it('should refuse handing to oneself, to an absent peer, to one that cannot report, and past the cap', async () => {
    expect((await prepare({ assigneeUsername: 'mira' })).error).toStrictEqual({ kind: 'self-assignment' });
    expect((await prepare({ channelId: 'channel-2' })).error).toMatchObject({ kind: 'assignee-absent' });
    expect((await prepare({ assigneeUsername: 'omar' })).error).toMatchObject({ kind: 'assignee-cannot-report' });
    await assign();
    expect((await prepare({ openUnitCap: 1 })).error).toStrictEqual({ cap: 1, kind: 'cap-reached' });
  });

  it('should refuse an assignment at the delegation depth limit or the chain-length limit (§7.4)', async () => {
    turns.push({ depth: 2, id: 'turn-deep', rootPostId: 'post-root' });
    expect((await prepare({ turnId: 'turn-deep' })).error).toStrictEqual({ kind: 'depth-limit' });
    turns.push({ depth: 0, id: 'turn-2', rootPostId: 'post-root' });
    expect((await prepare({ turnId: 'turn-1' })).error).toStrictEqual({ kind: 'chain-limit' });
  });

  it('should let only the assignee report and only the creator close, along the legal transitions', async () => {
    const unit = await assign();
    const reference = unit.id.slice(0, 8);
    const asMira = { actingAgentUsername: 'mira', channelId: 'channel-1', reference };
    const asOwen = { actingAgentUsername: 'owen', channelId: 'channel-1', reference };
    expect((await tasksService.prepareReport({ ...asMira, summary: 'x', to: 'review' })).error).toMatchObject({
      kind: 'not-the-assignee'
    });
    expect((await tasksService.prepareClose({ ...asOwen, to: 'done', verdict: 'x' })).error).toMatchObject({
      kind: 'not-the-creator'
    });
    const report = (
      await tasksService.prepareReport({ ...asOwen, summary: 'three venues found', to: 'review' })
    ).unwrap();
    expect(report.text).toBe(`@mira — unit \`${reference}\` is ready for review: three venues found`);
    await tasksService.commitTransition(report.prepared, 'post-2');
    expect(units.rows[0]).toMatchObject({ lastPostId: 'post-2', state: 'review' });
    expect((await tasksService.prepareReport({ ...asOwen, summary: 'again', to: 'review' })).error).toStrictEqual({
      from: 'review',
      kind: 'illegal-transition',
      to: 'review'
    });
    const close = (await tasksService.prepareClose({ ...asMira, to: 'done', verdict: 'good' })).unwrap();
    expect(close.text).toBe(`Unit \`${reference}\` closed as done: good`);
    await tasksService.commitTransition(close.prepared, 'post-3');
    expect(units.rows[0]).toMatchObject({ lastPostId: 'post-3', state: 'done' });
    expect(units.rows[0]?.closedAt).toBeInstanceOf(Date);
  });

  it('should leave a row unchanged when its transition became illegal before the commit, and say so', async () => {
    const unit = await assign();
    const reference = unit.id.slice(0, 8);
    const report = (
      await tasksService.prepareReport({
        actingAgentUsername: 'owen',
        channelId: 'channel-1',
        reference,
        summary: 'x',
        to: 'review'
      })
    ).unwrap();
    const close = (
      await tasksService.prepareClose({
        actingAgentUsername: 'mira',
        channelId: 'channel-1',
        reference,
        to: 'cancelled',
        verdict: 'x'
      })
    ).unwrap();
    await tasksService.commitTransition(close.prepared, 'post-2');
    await tasksService.commitTransition(report.prepared, 'post-3');
    expect(units.rows[0]).toMatchObject({ lastPostId: 'post-2', state: 'cancelled' });
    expect(loggingService.warn).toHaveBeenCalledOnce();
  });

  it('should let a person cancel an open unit, naming the parties without a mention (§8.4)', async () => {
    const unit = await assign();
    await tasksService.commitAssign({ ...unit, id: 'unit-x', outcome: 'ask @omar for the venue' }, 'post-x');
    const stripped = (
      await tasksService.prepareCancelOnHumanAuthority({
        agentUsername: 'mira',
        byUsername: 'casey',
        channelId: 'channel-1',
        reference: 'unit-x'
      })
    ).unwrap();
    expect(stripped.text).toContain(': ask omar for the venue');
    const prepared = (
      await tasksService.prepareCancelOnHumanAuthority({
        agentUsername: 'mira',
        byUsername: 'casey',
        channelId: 'channel-1',
        reference: unit.id.slice(0, 8)
      })
    ).unwrap();
    expect(prepared.text).toBe(
      `⛔ Unit \`${unit.id.slice(0, 8)}\` cancelled by @casey — \`mira\` had handed it to \`owen\`: a venue shortlist`
    );
    await tasksService.commitTransition(prepared.prepared, 'post-2');
    expect(units.rows[0]).toMatchObject({ state: 'cancelled' });
  });

  it('should list the open units the agent is party to in the channel, oldest first, and read one by reference', async () => {
    const first = await assign('post-1');
    await tasksService.commitAssign(
      { ...first, assigneeUsername: 'mira', creatorUsername: 'owen', id: 'unit-2' },
      'post-2'
    );
    await tasksService.commitAssign({ ...first, channelId: 'channel-2', id: 'unit-3' }, 'post-3');
    await tasksService.commitAssign(
      { ...first, assigneeUsername: 'omar', creatorUsername: 'owen', id: 'unit-4' },
      'post-4'
    );
    await tasksService.commitTransition({ to: 'cancelled', unitId: 'unit-2' }, 'post-5');
    const open = await tasksService.listOpenFor({ agentUsername: 'mira', channelId: 'channel-1' });
    expect(open.map((unit) => unit.reference)).toStrictEqual([first.id.slice(0, 8)]);
    expect((await tasksService.read('mira', 'channel-1', first.id.slice(0, 8))).value?.id).toBe(first.id);
    expect((await tasksService.read('mira', 'channel-1', 'unit-4')).error).toStrictEqual({
      kind: 'not-found',
      reference: 'unit-4'
    });
    expect((await tasksService.read('owen', 'channel-1', 'unit-')).error).toStrictEqual({
      kind: 'ambiguous',
      reference: 'unit-'
    });
  });
});
