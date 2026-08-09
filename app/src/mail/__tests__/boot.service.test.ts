import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RosterService } from '@/channels/roster/roster.service.ts';
import type { ChatTransport } from '@/chat/chat.transport.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { MailBootService } from '../boot/boot.service.ts';
import { MailRegistry } from '../mail.registry.ts';

describe('MailBootService', () => {
  let isDirectMessageChannel: ReturnType<typeof vi.fn>;
  let mailBootService: MailBootService;
  let probe: ReturnType<typeof vi.fn>;
  let rosterService: MockedInstance<RosterService>;

  beforeEach(async () => {
    isDirectMessageChannel = vi.fn().mockResolvedValue(Result.ok(false));
    probe = vi.fn().mockResolvedValue(Result.ok());
    const mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.list.mockReturnValue([
      {
        agentUsername: 'tess',
        announcementChannelId: 'channel-mail',
        pollIntervalMs: 60_000,
        provider: { address: 'tess@example.org', probe } as never
      }
    ]);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.isAgentIn.mockReturnValue(true);
    const transportRegistry = MockFactory.createMock(TransportRegistry);
    transportRegistry.get.mockReturnValue({ isDirectMessageChannel } as unknown as ChatTransport);
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailBootService,
        { provide: MailRegistry, useValue: mailRegistry },
        { provide: RosterService, useValue: rosterService },
        { provide: TransportRegistry, useValue: transportRegistry }
      ]
    }).compile();
    mailBootService = moduleRef.get(MailBootService);
  });

  it('should pass a mailbox whose channel, membership, and credentials all hold', async () => {
    await expect(mailBootService.assertReady()).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('should refuse a DM announcement channel by name', async () => {
    isDirectMessageChannel.mockResolvedValue(Result.ok(true));
    await expect(mailBootService.assertReady()).rejects.toThrow('direct message');
  });

  it('should refuse a channel the agent is not a member of', async () => {
    rosterService.isAgentIn.mockReturnValue(false);
    await expect(mailBootService.assertReady()).rejects.toThrow('not a member');
  });

  it('should refuse a mailbox whose probe fails, naming the failure', async () => {
    probe.mockResolvedValue(Result.err({ kind: 'auth', message: 'the secret expired' }));
    await expect(mailBootService.assertReady()).rejects.toThrow('the secret expired');
  });
});
