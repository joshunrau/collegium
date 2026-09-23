import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ChannelLockService } from '@/channels/locks/channel-lock.service.ts';
import { MultiMentionPolicy } from '@/channels/refusals/multi-mention.policy.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { PrismaService } from '@/prisma/prisma.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { CounterpartStateService } from '../counterparts/counterpart-state.service.ts';
import { PostSightingsRegistry } from '../sightings/post-sightings.registry.ts';
import { TasksService } from '../tasks.service.ts';

import type { PreparedUnit, WorkUnit } from '../tasks.types.ts';

type TurnRow = { depth: number; id: string; rootPostId: null | string };

const OWEN = buildAgentProfile({ tools: ['tasks'], username: 'owen' });
const OMAR = buildAgentProfile({ tools: [], username: 'omar' });
const MIRA = buildAgentProfile({ tools: ['tasks'], username: 'mira' });
const TESS = buildAgentProfile({ tools: ['tasks'], username: 'tess' });

describe('TasksService', () => {
  let channelLockService: MockedInstance<ChannelLockService>;
  let conversationsService: MockedInstance<ConversationsService>;
  let counterpartStateService: MockedInstance<CounterpartStateService>;
  let loggingService: MockedInstance<LoggingService>;
  let postSightingsRegistry: PostSightingsRegistry;
  let tasksService: TasksService;
  let turns: TurnRow[];
  let units: ReturnType<typeof createModelTable<WorkUnit>>;

  beforeEach(async () => {
    turns = [{ depth: 0, id: 'turn-1', rootPostId: 'post-root' }];
    units = createModelTable<WorkUnit>({
      defaults: (sequence) => ({ closedAt: null, createdAt: new Date(sequence), updatedAt: new Date(sequence) })
    });
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username) => {
      return [MIRA, OWEN, OMAR, TESS].find((agent) => agent.username === username);
    });
    agentRegistry.displayNameOf.mockImplementation((username) => {
      return username.replace(/^./u, (first) => first.toUpperCase());
    });
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.listAgentsIn.mockImplementation((channelId) => {
      return channelId === 'channel-1' ? [MIRA, OWEN, OMAR, TESS] : [MIRA];
    });
    channelLockService = MockFactory.createMock(ChannelLockService);
    channelLockService.isBusyWithTurnOpenedAfter.mockReturnValue(false);
    conversationsService = MockFactory.createMock(ConversationsService);
    counterpartStateService = MockFactory.createMock(CounterpartStateService);
    counterpartStateService.readFor.mockResolvedValue({ awaited: 'report', kind: 'no-turn' });
    loggingService = MockFactory.createMock(LoggingService);
    const multiMentionPolicy = MockFactory.createMock(MultiMentionPolicy);
    multiMentionPolicy.stripAgentMentions.mockImplementation((text: string) => text.replaceAll('@omar', 'omar'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChannelLockService, useValue: channelLockService },
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({ turns: { chainLengthLimit: 3, delegationDepthLimit: 2 } })
        },
        { provide: ConversationsService, useValue: conversationsService },
        { provide: CounterpartStateService, useValue: counterpartStateService },
        { provide: LoggingService, useValue: loggingService },
        { provide: MultiMentionPolicy, useValue: multiMentionPolicy },
        PostSightingsRegistry,
        {
          provide: PrismaService,
          useValue: { $transaction: (operations: Promise<unknown>[]) => Promise.all(operations) }
        },
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
    postSightingsRegistry = moduleRef.get(PostSightingsRegistry);
    tasksService = moduleRef.get(TasksService);
  });

  const prepare = (
    overrides: {
      assigneeUsername?: string;
      channelId?: string;
      follows?: string;
      openUnitCap?: number;
      turnId?: string;
    } = {}
  ) => {
    return tasksService.prepareAssign({
      actingAgentUsername: 'mira',
      assigneeUsername: 'owen',
      channelId: 'channel-1',
      context: 'nothing tried yet',
      criteria: 'three venues with prices',
      follows: undefined,
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
      followsId: null,
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

  it('should find the unit whose assignment post started the assignee’s turn, and none for any other turn', async () => {
    const unit = await assign('post-1');
    const served = (agentUsername: string, triggeringPostId: string | undefined) => {
      return tasksService.findServedUnit({ agentUsername, channelId: 'channel-1', triggeringPostId });
    };
    expect((await served('owen', 'post-1'))?.id).toBe(unit.id);
    expect(await served('owen', 'post-9')).toBeUndefined();
    expect(await served('owen', undefined)).toBeUndefined();
    expect(await served('mira', 'post-1')).toBeUndefined();
  });

  describe('the report the framework makes when an assignee runs out of context (§3.15)', () => {
    const exhausted = (triggeringPostId: string) => {
      return tasksService.prepareExhaustionReport({ agentUsername: 'owen', channelId: 'channel-1', triggeringPostId });
    };

    it('should report the assignee’s only assigned unit blocked, to its creator, in fixed words', async () => {
      const unit = await assign('post-1');
      expect(await exhausted('post-9')).toStrictEqual({
        addressee: 'mira',
        prepared: { to: 'blocked', unitId: unit.id },
        text: `@mira — unit \`${unit.id.slice(0, 8)}\` is blocked: context exhausted`
      });
    });

    it('should pick the unit whose assignment started the turn, and guess none among several', async () => {
      await assign('post-1');
      const second = await assign('post-2');
      expect((await exhausted('post-2'))?.prepared.unitId).toBe(second.id);
      expect(await exhausted('post-9')).toBeUndefined();
    });
  });

  it('should let only the assignee report and only the creator close, along the legal transitions', async () => {
    const unit = await assign();
    const reference = unit.id.slice(0, 8);
    const asMira = { actingAgentUsername: 'mira', channelId: 'channel-1', reference, turnId: 'turn-1' };
    const asOwen = { actingAgentUsername: 'owen', channelId: 'channel-1', reference, turnId: 'turn-1' };
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
    postSightingsRegistry.recordSeen('turn-1', ['post-2']);
    expect((await tasksService.prepareReport({ ...asOwen, summary: 'again', to: 'review' })).error).toStrictEqual({
      creatorUsername: 'mira',
      kind: 'awaiting-verdict',
      reference,
      state: 'review'
    });
    const close = (await tasksService.prepareClose({ ...asMira, to: 'done', verdict: 'good' })).unwrap();
    expect(close.text).toBe(`Unit \`${reference}\` closed as done: good`);
    expect(close.leavesNoneOpen).toBe(true);
    await tasksService.commitTransition(close.prepared, 'post-3');
    expect(units.rows[0]).toMatchObject({
      closedByUsername: 'mira',
      lastPostId: 'post-3',
      state: 'done',
      verdict: 'good'
    });
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
        turnId: 'turn-1',
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
      `⛔ Unit \`${unit.id.slice(0, 8)}\` cancelled by @casey — Mira had handed it to Owen: a venue shortlist`
    );
    await tasksService.commitTransition(prepared.prepared, 'post-2');
    expect(units.rows[0]).toMatchObject({ closedByUsername: 'casey', state: 'cancelled' });
  });

  describe('what a close rests on (§3.15)', () => {
    const close = (reference: string, to: 'cancelled' | 'done') => {
      return tasksService.prepareClose({
        actingAgentUsername: 'mira',
        channelId: 'channel-1',
        reference,
        to,
        turnId: 'turn-1',
        verdict: 'x'
      });
    };

    it('should refuse closing an assigned unit while a turn the assignee opened since the assignment runs', async () => {
      const unit = await assign();
      const reference = unit.id.slice(0, 8);
      channelLockService.isBusyWithTurnOpenedAfter.mockReturnValue(true);
      expect((await close(reference, 'cancelled')).error).toStrictEqual({
        assigneeUsername: 'owen',
        kind: 'assignee-working',
        reference
      });
      expect(channelLockService.isBusyWithTurnOpenedAfter).toHaveBeenCalledWith(
        'owen',
        'channel-1',
        units.rows[0]?.createdAt
      );
      channelLockService.isBusyWithTurnOpenedAfter.mockReturnValue(false);
      expect((await close(reference, 'done')).success).toBe(true);
    });

    it('should refuse closing a reported unit until the closing turn has read the report', async () => {
      const unit = await assign();
      const reference = unit.id.slice(0, 8);
      await tasksService.commitTransition({ to: 'review', unitId: unit.id }, 'post-report');
      expect((await close(reference, 'done')).error).toStrictEqual({ kind: 'report-unread', reference });
      postSightingsRegistry.recordSeen('turn-1', ['post-report']);
      expect((await close(reference, 'done')).success).toBe(true);
    });
  });

  it('should refuse a report on a closed unit, naming who closed it, when, and the verdict (§3.15)', async () => {
    const unit = await assign();
    const reference = unit.id.slice(0, 8);
    await tasksService.commitTransition(
      { closedByUsername: 'mira', to: 'cancelled', unitId: unit.id, verdict: 'no longer needed' },
      'post-2'
    );
    const refused = await tasksService.prepareReport({
      actingAgentUsername: 'owen',
      channelId: 'channel-1',
      reference,
      summary: 'x',
      to: 'review'
    });
    expect(refused.error).toStrictEqual({
      closed: {
        closedAt: units.rows[0]?.closedAt,
        closedByUsername: 'mira',
        kind: 'closed',
        reference,
        state: 'cancelled',
        verdict: 'no longer needed'
      },
      creatorUsername: 'mira',
      kind: 'report-closed'
    });
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
    expect(open[0]?.counterpart).toStrictEqual({ awaited: 'report', kind: 'no-turn' });
    expect(counterpartStateService.readFor).toHaveBeenCalledExactlyOnceWith(units.rows[0], 'mira');
    expect((await tasksService.read('mira', 'channel-1', first.id.slice(0, 8))).value?.id).toBe(first.id);
    expect((await tasksService.read('mira', 'channel-1', 'unit-4')).error).toStrictEqual({
      kind: 'not-found',
      openReferences: [first.id.slice(0, 8)],
      reference: 'unit-4'
    });
    expect((await tasksService.read('owen', 'channel-1', 'unit-')).error).toStrictEqual({
      kind: 'ambiguous',
      reference: 'unit-'
    });
  });

  describe('a unit that follows another (§3.15)', () => {
    const reported = async () => {
      const unit = await assign('post-1');
      await tasksService.commitTransition({ to: 'review', unitId: unit.id }, 'post-2');
      return unit.id.slice(0, 8);
    };

    it('should close the unit it follows as done and open the next to the same assignee, in one post', async () => {
      const followed = await reported();
      postSightingsRegistry.recordSeen('turn-1', ['post-2']);
      const next = (await prepare({ follows: followed, openUnitCap: 1 })).unwrap();
      const reference = next.prepared.id.slice(0, 8);
      expect(next.addressee).toBe('owen');
      expect(next.text).toContain(
        `@owen — work unit \`${reference}\` follows unit \`${followed}\`, now closed as done`
      );
      await tasksService.commitAssign(next.prepared, 'post-3');
      expect(units.rows[0]).toMatchObject({
        closedByUsername: 'mira',
        lastPostId: 'post-3',
        state: 'done',
        verdict: `continued as unit ${reference}`
      });
      expect(units.rows[1]).toMatchObject({ followsId: units.rows[0]?.id, originPostId: 'post-3', state: 'assigned' });
      const open = await tasksService.listOpenFor({ agentUsername: 'mira', channelId: 'channel-1' });
      expect(open.map((unit) => [unit.reference, unit.follows])).toStrictEqual([[reference, followed]]);
    });

    it('should refuse to follow a unit not yet reported, one whose report this turn has not read, or to another assignee', async () => {
      const assigned = (await assign('post-1')).id.slice(0, 8);
      expect((await prepare({ follows: assigned })).error).toStrictEqual({
        kind: 'not-continuable',
        reference: assigned,
        state: 'assigned'
      });
      const followed = await reported();
      expect((await prepare({ follows: followed })).error).toStrictEqual({
        kind: 'report-unread',
        reference: followed
      });
      postSightingsRegistry.recordSeen('turn-1', ['post-2']);
      expect((await prepare({ assigneeUsername: 'omar', follows: followed })).error).toMatchObject({
        kind: 'assignee-cannot-report'
      });
      expect((await prepare({ assigneeUsername: 'tess', follows: followed })).error).toStrictEqual({
        assigneeUsername: 'owen',
        kind: 'follows-other-assignee',
        reference: followed
      });
    });

    it('should leave the unit it follows unchanged when it moved before the post landed, and say so', async () => {
      const followed = await reported();
      postSightingsRegistry.recordSeen('turn-1', ['post-2']);
      const next = (await prepare({ follows: followed })).unwrap();
      await tasksService.commitTransition(
        { closedByUsername: 'casey', to: 'cancelled', unitId: units.rows[0]!.id },
        'p-9'
      );
      await tasksService.commitAssign(next.prepared, 'post-3');
      expect(units.rows[0]).toMatchObject({ closedByUsername: 'casey', state: 'cancelled' });
      expect(units.rows[1]).toMatchObject({ state: 'assigned' });
      expect(loggingService.warn).toHaveBeenCalledOnce();
    });
  });

  describe('the view tasks::read shows (§3.15)', () => {
    const view = (reference: string) => {
      return tasksService.readView({ agentUsername: 'mira', channelId: 'channel-1', reference });
    };

    it('should show an assigned unit with where its counterpart stands, and no later post', async () => {
      const unit = await assign();
      const shown = (await view(unit.id.slice(0, 8))).unwrap();
      expect(shown).toMatchObject({ counterpart: { kind: 'no-turn' }, latestChange: { kind: 'none' } });
      expect(conversationsService.findUnforgotten).not.toHaveBeenCalled();
    });

    it('should show the report a unit last moved by, and say so when that post was forgotten (§8.4)', async () => {
      const unit = await assign();
      await tasksService.commitTransition({ to: 'review', unitId: unit.id }, 'post-report');
      const report = { createdAt: new Date(5), id: 'post-report', message: '@mira — unit is ready for review: done' };
      conversationsService.findUnforgotten.mockResolvedValueOnce(report);
      expect((await view(unit.id.slice(0, 8))).value?.latestChange).toStrictEqual({ kind: 'posted', post: report });
      expect(conversationsService.findUnforgotten).toHaveBeenCalledWith('post-report');
      conversationsService.findUnforgotten.mockResolvedValueOnce(undefined);
      expect((await view(unit.id.slice(0, 8))).value?.latestChange).toStrictEqual({ kind: 'unreadable' });
    });

    it('should describe no counterpart for a closed unit', async () => {
      const unit = await assign();
      await tasksService.commitTransition(
        { closedByUsername: 'mira', to: 'done', unitId: unit.id, verdict: 'ok' },
        'p-2'
      );
      conversationsService.findUnforgotten.mockResolvedValue({ createdAt: new Date(5), id: 'p-2', message: 'closed' });
      counterpartStateService.readFor.mockClear();
      expect((await view(unit.id.slice(0, 8))).value?.counterpart).toBeUndefined();
      expect(counterpartStateService.readFor).not.toHaveBeenCalled();
    });
  });
});
