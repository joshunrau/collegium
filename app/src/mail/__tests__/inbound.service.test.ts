import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
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

type CursorRow = { agentUsername: string; cursor: string; id: string; updatedAt: Date };

const ARRIVAL = {
  body: 'Please pay invoice 42.',
  receivedAt: new Date('2026-07-31T09:00:00Z'),
  ref: 'msg-1',
  sender: { address: 'billing@acme.com' },
  subject: 'Invoice overdue'
};

describe('MailInboundService', () => {
  let cursorRows: CursorRow[];
  let mailbox: MailboxRuntime;
  let mailOutageService: MockedInstance<MailOutageService>;
  let provider: {
    initializeCursor: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
    pollNew: ReturnType<typeof vi.fn>;
  };
  let service: MailInboundService;
  let triggersService: MockedInstance<TriggersService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = { initializeCursor: vi.fn(), markRead: vi.fn(), pollNew: vi.fn() };
    mailbox = {
      agentUsername: 'tess',
      announcementChannelId: 'channel-mail',
      pollIntervalMs: 60_000,
      provider: { address: 'tess@example.org', ...provider } as never
    };
    const mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.list.mockReturnValue([mailbox]);
    mailRegistry.providerFor.mockImplementation((agentUsername) =>
      agentUsername === 'tess' ? mailbox.provider : undefined
    );
    mailOutageService = MockFactory.createMock(MailOutageService);
    triggersService = MockFactory.createMock(TriggersService);
    triggersService.record.mockResolvedValue(Result.ok({ id: 'trigger-1' } as never));
    const table = createModelTable<CursorRow>({
      defaults: (sequence) => ({ id: `cursor-${sequence}`, updatedAt: new Date(sequence) })
    });
    cursorRows = table.rows;
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailInboundService,
        MockFactory.createForService(LoggingService),
        { provide: DateFormatter, useValue: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }) },
        { provide: MailOutageService, useValue: mailOutageService },
        { provide: MailRegistry, useValue: mailRegistry },
        { provide: TriggersService, useValue: triggersService },
        { provide: getModelToken('MailCursor'), useValue: table }
      ]
    }).compile();
    service = moduleRef.get(MailInboundService);
  });

  it('should initialize at the head on first connection, announcing nothing', async () => {
    provider.initializeCursor.mockResolvedValue(Result.ok('cursor-head'));
    await service.pollOnce(mailbox);
    expect(triggersService.record).not.toHaveBeenCalled();
    expect(cursorRows[0]).toMatchObject({ agentUsername: 'tess', cursor: 'cursor-head' });
    expect(provider.pollNew).not.toHaveBeenCalled();
  });

  it('should record one trigger per arrival, with the rendered thread and a stable dedupe key', async () => {
    cursorRows.push({ agentUsername: 'tess', cursor: 'cursor-1', id: 'row-1', updatedAt: new Date(0) });
    provider.pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [ARRIVAL] }));
    await service.pollOnce(mailbox);
    expect(triggersService.record).toHaveBeenCalledWith({
      dedupeKey: 'mail:tess:msg-1',
      reference: {
        body: '> **From:** billing@acme.com\n> **Date:** July 31, 2026\n> **Subject:** Invoice overdue\n>\n> Please pay invoice 42.',
        id: 'msg-1',
        sender: 'billing@acme.com',
        subject: 'Invoice overdue'
      },
      source: 'mail',
      targetAgentUsername: 'tess',
      targetChannelId: 'channel-mail'
    });
    expect(cursorRows[0]?.cursor).toBe('cursor-2');
  });

  it('should leave the cursor untouched when recording an arrival fails, so nothing is lost', async () => {
    cursorRows.push({ agentUsername: 'tess', cursor: 'cursor-1', id: 'row-1', updatedAt: new Date(0) });
    provider.pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [ARRIVAL] }));
    triggersService.record.mockResolvedValue(Result.err({ kind: 'agent-absent' } as never));
    await service.pollOnce(mailbox);
    expect(cursorRows[0]?.cursor).toBe('cursor-1');
  });

  it('should re-initialize without announcing when the provider invalidates the cursor', async () => {
    cursorRows.push({ agentUsername: 'tess', cursor: 'cursor-1', id: 'row-1', updatedAt: new Date(0) });
    provider.pollNew.mockResolvedValue(Result.err({ kind: 'cursor-reset', message: 'UIDVALIDITY changed' }));
    provider.initializeCursor.mockResolvedValue(Result.ok('cursor-fresh'));
    await service.pollOnce(mailbox);
    expect(triggersService.record).not.toHaveBeenCalled();
    expect(cursorRows[0]?.cursor).toBe('cursor-fresh');
  });

  it('should mark the message read when its trigger is resolved (§4.6)', async () => {
    provider.markRead.mockResolvedValue(Result.ok());
    const handled = await service.markHandled({ reference: { id: 'msg-1' }, targetAgentUsername: 'tess' } as never);
    expect(handled.success).toBe(true);
    expect(provider.markRead).toHaveBeenCalledWith('msg-1');
  });

  it('should leave a trigger outstanding when the message cannot be marked read', async () => {
    provider.markRead.mockResolvedValue(Result.err({ kind: 'provider-unavailable', message: 'down' }));
    const handled = await service.markHandled({ reference: { id: 'msg-1' }, targetAgentUsername: 'tess' } as never);
    expect(handled.error?.message).toContain('could not be marked read');
  });

  it('should report a failed read to the outage service, and keep polling', async () => {
    cursorRows.push({ agentUsername: 'tess', cursor: 'cursor-1', id: 'row-1', updatedAt: new Date(0) });
    provider.pollNew.mockResolvedValue(Result.err({ kind: 'provider-unavailable', message: 'Exchange is down' }));
    await service.pollOnce(mailbox);
    expect(mailOutageService.recordFailedRead).toHaveBeenCalledWith(mailbox, 'Exchange is down');
    expect(mailOutageService.recordSuccessfulRead).not.toHaveBeenCalled();
  });

  it('should report a successful read to the outage service, ending any episode', async () => {
    cursorRows.push({ agentUsername: 'tess', cursor: 'cursor-1', id: 'row-1', updatedAt: new Date(0) });
    provider.pollNew.mockResolvedValue(Result.ok({ cursor: 'cursor-2', messages: [] }));
    await service.pollOnce(mailbox);
    expect(mailOutageService.recordSuccessfulRead).toHaveBeenCalledWith(mailbox);
  });
});
