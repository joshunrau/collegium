import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { ConversationsService } from '@/conversations/conversations.service.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { getModelToken } from '@/prisma/prisma.utils.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { createModelTable } from '@/testing/factories/model-table.factory.ts';

import { TriggersService } from '../triggers.service.ts';

type TriggerRow = {
  createdAt: Date;
  dedupeKey?: null | string;
  id: string;
  postedAt?: Date | null;
  postId?: string;
  reference: object;
  source: string;
  status: string;
  targetAgentUsername: string;
  targetChannelId: string;
};

describe('TriggersService', () => {
  let chatGateway: MockedInstance<ChatGateway>;
  let loggingService: MockedInstance<LoggingService>;
  let rosterService: MockedInstance<RosterService>;
  let rows: TriggerRow[];
  let transportRegistry: MockedInstance<TransportRegistry>;
  let triggersService: TriggersService;

  beforeEach(async () => {
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.maxPostSizeChars.mockResolvedValue(Result.ok(16_383));
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'announcement-1' })
    );
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.has.mockImplementation((username) => username === 'mira' || username === 'owen');
    loggingService = MockFactory.createMock(LoggingService);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.isAgentIn.mockReturnValue(true);
    transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue({
      isDirectMessageChannel: vi.fn((channelId: string) => Promise.resolve(Result.ok(channelId === 'channel-dm')))
    } as unknown as ChatTransport);
    const table = createModelTable<TriggerRow>({
      defaults: (sequence) => ({
        createdAt: new Date(sequence),
        id: `trigger-${sequence}`,
        reference: {},
        source: 'webhook'
      })
    });
    rows = table.rows;
    const moduleRef = await Test.createTestingModule({
      providers: [
        TriggersService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChatGateway, useValue: chatGateway },
        { provide: RosterService, useValue: rosterService },
        MockFactory.createForService(ConversationsService),
        { provide: LoggingService, useValue: loggingService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: getModelToken('Trigger'), useValue: table }
      ]
    }).compile();
    triggersService = moduleRef.get(TriggersService);
  });

  const record = (targetChannelId = 'channel-1', targetAgentUsername = 'mira') => {
    return triggersService.record({
      reference: { subject: 'invoice overdue' },
      source: 'webhook',
      targetAgentUsername,
      targetChannelId
    });
  };

  it('should refuse intake for an agent the registry does not know (§4.2)', async () => {
    const refused = await record('channel-1', 'ghost');
    expect(refused.error).toStrictEqual({ agentUsername: 'ghost', kind: 'unknown-agent' });
    expect(rows).toHaveLength(0);
  });

  it('should refuse intake rather than guess when the channel type cannot be established (A4)', async () => {
    transportRegistry.get.mockReturnValue({
      isDirectMessageChannel: () => Promise.resolve(Result.err({ kind: 'api', message: 'mattermost is down' }))
    } as unknown as ChatTransport);
    const refused = await record();
    expect(refused.error).toStrictEqual({
      channelId: 'channel-1',
      kind: 'channel-unreachable',
      message: 'mattermost is down'
    });
    expect(rows).toHaveLength(0);
  });

  it('should record a repeated dedupe key once, returning the existing trigger', async () => {
    const listener = vi.fn();
    triggersService.onRecorded(listener);
    const intake = {
      dedupeKey: 'mail:mira:message-1',
      reference: { subject: 'invoice overdue' },
      source: 'mail',
      targetAgentUsername: 'mira',
      targetChannelId: 'channel-1'
    } as const;
    const first = await triggersService.record(intake);
    const second = await triggersService.record(intake);
    expect(second.value?.id).toBe(first.value?.id);
    expect(rows).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should notify the recorded listener of the channel fresh intake landed in', async () => {
    const listener = vi.fn();
    triggersService.onRecorded(listener);
    await record();
    expect(listener).toHaveBeenCalledWith('channel-1');
  });

  it('should refuse a DM-targeted trigger loudly at intake (§4.2)', async () => {
    const refused = await record('channel-dm');
    expect(refused.error).toStrictEqual({ channelId: 'channel-dm', kind: 'dm-target' });
    expect(rows).toHaveLength(0);
  });

  it('should refuse intake for a channel the target agent is not in (§4.2)', async () => {
    rosterService.isAgentIn.mockReturnValue(false);
    const refused = await record();
    expect(refused.error).toStrictEqual({ agentUsername: 'mira', channelId: 'channel-1', kind: 'agent-absent' });
    expect(rows).toHaveLength(0);
  });

  it('should claim atomically and announce the oldest pending trigger, mentioning the agent', async () => {
    const first = await record();
    await record();
    const next = await triggersService.peekPending('channel-1');
    expect(next?.id).toBe(first.value?.id);
    expect((await triggersService.post(next!.id)).success).toBe(true);
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledTimes(1);
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith('channel-1', expect.stringContaining('@mira'), []);
    expect(rows[0]).toMatchObject({ postId: 'announcement-1', status: 'posted' });
    expect(rows[1]?.status).toBe('pending');
    expect((await triggersService.post(next!.id)).error).toMatchObject({ kind: 'not-pending' });
  });

  it('should report a trigger id that names no row as not-found', async () => {
    expect((await triggersService.post('trigger-missing')).error).toStrictEqual({
      kind: 'not-found',
      triggerId: 'trigger-missing'
    });
  });

  it('should release the claim and log when the announcement cannot be delivered', async () => {
    const recorded = await record();
    chatGateway.postAsSystemIn.mockResolvedValue(Result.err({ kind: 'api', message: 'the channel is gone' }));

    const posted = await triggersService.post(recorded.value!.id);

    expect(posted.error).toStrictEqual({
      channelId: 'channel-1',
      kind: 'channel-unreachable',
      message: 'the channel is gone'
    });
    expect(rows[0]).toMatchObject({ postedAt: null, status: 'pending' });
    expect(loggingService.error).toHaveBeenCalled();
  });

  it('should recognize the post that announced a trigger and no other', async () => {
    const recorded = await record();
    await triggersService.post(recorded.value!.id);
    expect(await triggersService.wasAnnouncedBy('announcement-1')).toBe(true);
    expect(await triggersService.wasAnnouncedBy('some-human-post')).toBe(false);
  });

  it('should name every channel holding an unannounced trigger exactly once', async () => {
    await record();
    await record();
    await record('channel-2');
    expect(await triggersService.listPendingChannelIds()).toStrictEqual(['channel-1', 'channel-2']);
  });

  it('should list only the addressed agent’s unresolved triggers, oldest first', async () => {
    const first = await record();
    await record('channel-2');
    await record('channel-1', 'owen');
    await triggersService.resolve(first.value!.id, 'mira');
    const outstanding = await triggersService.listOutstanding('mira');
    expect(outstanding.map(({ targetChannelId }) => targetChannelId)).toStrictEqual(['channel-2']);
  });

  it("should run the source's own handling before marking a trigger resolved (§4.6)", async () => {
    const hook = vi.fn().mockResolvedValue(Result.ok());
    triggersService.onResolving('webhook', hook);
    const recorded = await record();
    expect((await triggersService.resolve(recorded.value!.id, 'mira')).success).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(rows[0]?.status).toBe('resolved');
  });

  it('should leave the trigger outstanding when the source cannot finish its handling', async () => {
    triggersService.onResolving('webhook', () => Promise.resolve(Result.err({ message: 'the mailbox is down' })));
    const recorded = await record();
    const resolved = await triggersService.resolve(recorded.value!.id, 'mira');
    expect(resolved.error).toMatchObject({ kind: 'not-resolvable', message: 'the mailbox is down' });
    expect(rows[0]?.status).not.toBe('resolved');
  });

  it('should resolve idempotently and only for the addressed agent', async () => {
    const recorded = await record();
    const triggerId = recorded.value!.id;
    expect((await triggersService.resolve(triggerId, 'owen')).error).toMatchObject({ kind: 'not-found' });
    expect((await triggersService.resolve(triggerId, 'mira')).success).toBe(true);
    expect((await triggersService.resolve(triggerId, 'mira')).success).toBe(true);
    expect(rows[0]?.status).toBe('resolved');
  });
});
