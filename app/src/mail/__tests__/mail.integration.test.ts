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
import { TriggersService } from '@/triggers/triggers.service.ts';

import { MailInboundService } from '../inbound/inbound.service.ts';
import { MailRegistry } from '../mail.registry.ts';
import { MailOutageService } from '../outage/outage.service.ts';

import type { MailboxRuntime } from '../mail.registry.ts';

const MAX_POST_SIZE = 200;

type CursorRow = { agentUsername: string; cursor: string; id: string; updatedAt: Date };
type TriggerRow = {
  createdAt: Date;
  dedupeKey?: null | string;
  id: string;
  postId?: null | string;
  reference: PrismaJson.TriggerReference;
  source: string;
  status: string;
  targetAgentUsername: string;
  targetChannelId: string;
};

const arrival = (overrides: { body?: string; ref?: string } = {}) => ({
  body: overrides.body ?? 'Please pay invoice 42.',
  receivedAt: new Date('2026-07-31T09:00:00Z'),
  ref: overrides.ref ?? 'msg-1',
  sender: { address: 'billing@acme.com' },
  subject: 'Invoice overdue'
});

/** arrival → announcement → resolution, across the real triggers service and the real renderer */
describe('mail inbound, end to end through triggers', () => {
  let chatGateway: MockedInstance<ChatGateway>;
  let inbound: MailInboundService;
  let mailbox: MailboxRuntime;
  let markRead: ReturnType<typeof vi.fn>;
  let pollNew: ReturnType<typeof vi.fn>;
  let triggerRows: TriggerRow[];
  let triggersService: TriggersService;

  beforeEach(async () => {
    vi.clearAllMocks();
    markRead = vi.fn().mockResolvedValue(Result.ok());
    pollNew = vi.fn();
    mailbox = {
      agentUsername: 'tess',
      announcementChannelId: 'channel-mail',
      pollIntervalMs: 60_000,
      provider: {
        address: 'tess@example.org',
        initializeCursor: vi.fn().mockResolvedValue(Result.ok('cursor-head')),
        markRead,
        pollNew
      } as never
    };
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.has.mockReturnValue(true);
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.maxPostSizeChars.mockResolvedValue(Result.ok(MAX_POST_SIZE));
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'announcement-1' })
    );
    const mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.list.mockReturnValue([mailbox]);
    mailRegistry.providerFor.mockReturnValue(mailbox.provider);
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.isAgentIn.mockReturnValue(true);
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue({
      isDirectMessageChannel: () => Promise.resolve(Result.ok(false))
    } as unknown as ChatTransport);
    const triggers = createModelTable<TriggerRow>({
      defaults: (sequence) => ({ createdAt: new Date(sequence), id: `trigger-${sequence}`, postId: null })
    });
    triggerRows = triggers.rows;
    const cursors = createModelTable<CursorRow>({
      defaults: (sequence) => ({ id: `cursor-${sequence}`, updatedAt: new Date(sequence) })
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailInboundService,
        MailOutageService,
        TriggersService,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ChatGateway, useValue: chatGateway },
        MockFactory.createForService(ConversationsService),
        MockFactory.createForService(LoggingService),
        { provide: MailRegistry, useValue: mailRegistry },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry },
        { provide: getModelToken('MailCursor'), useValue: cursors },
        { provide: getModelToken('Trigger'), useValue: triggers }
      ]
    }).compile();
    inbound = moduleRef.get(MailInboundService);
    triggersService = moduleRef.get(TriggersService);
    inbound.start();
    // first connection: existing mail is old and stays silent (§4.4)
    await inbound.pollOnce(mailbox);
  });

  it('should announce an arrival with sender, subject, and body, then mark it read on resolution', async () => {
    pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [arrival()] }));
    await inbound.pollOnce(mailbox);

    expect(triggerRows).toHaveLength(1);
    const trigger = triggerRows[0]!;
    expect(trigger).toMatchObject({ dedupeKey: 'mail:tess:msg-1', source: 'mail', status: 'pending' });

    expect((await triggersService.post(trigger.id)).success).toBe(true);
    const [channelId, message, files] = chatGateway.postAsSystemIn.mock.calls[0]!;
    expect(channelId).toBe('channel-mail');
    expect(message).toContain('@tess');
    expect(message).toContain('Invoice overdue');
    expect(message).toContain('billing@acme.com');
    expect(message).toContain('Please pay invoice 42.');
    expect(files).toStrictEqual([]);

    expect((await triggersService.resolve(trigger.id, 'tess')).success).toBe(true);
    expect(markRead).toHaveBeenCalledWith('msg-1');
    expect(triggerRows[0]?.status).toBe('resolved');
  });

  it('should attach a body too large to post, and say so in the announcement', async () => {
    const body = 'x'.repeat(MAX_POST_SIZE);
    pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [arrival({ body })] }));
    await inbound.pollOnce(mailbox);

    await triggersService.post(triggerRows[0]!.id);
    const [, message, files] = chatGateway.postAsSystemIn.mock.calls[0]!;
    expect(message).not.toContain(body);
    expect(message).toContain('too large to post');
    expect(files).toStrictEqual([{ content: body, filename: 'message.md' }]);
  });

  it('should announce a re-observed arrival exactly once (§4.1)', async () => {
    pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [arrival()] }));
    await inbound.pollOnce(mailbox);
    await inbound.pollOnce(mailbox);
    expect(triggerRows).toHaveLength(1);
  });

  it('should leave the trigger outstanding when the message cannot be marked read (§4.6)', async () => {
    pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [arrival()] }));
    await inbound.pollOnce(mailbox);
    markRead.mockResolvedValue(Result.err({ kind: 'provider-unavailable', message: 'the mailbox is down' }));

    const resolved = await triggersService.resolve(triggerRows[0]!.id, 'tess');

    expect(resolved.error).toMatchObject({ kind: 'not-resolvable' });
    expect(triggerRows[0]?.status).not.toBe('resolved');
  });
});
