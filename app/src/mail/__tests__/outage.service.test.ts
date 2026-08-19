import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { LoggingService } from '@/logging/logging.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { MailOutageService } from '../outage/outage.service.ts';

import type { MailboxRuntime } from '../mail.registry.ts';

const MAILBOX: MailboxRuntime = {
  agentUsername: 'tess',
  announcementChannelId: 'channel-mail',
  pollIntervalMs: 60_000,
  provider: { address: 'tess@example.org' } as never
};

describe('MailOutageService', () => {
  let chatGateway: MockedInstance<ChatGateway>;
  let service: MailOutageService;

  beforeEach(async () => {
    vi.clearAllMocks();
    chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.postAsSystemIn.mockResolvedValue(
      Result.ok({ authorUsername: 'collegium', createdAt: new Date(0), postId: 'post-1' })
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailOutageService,
        { provide: ChatGateway, useValue: chatGateway },
        MockFactory.createForService(LoggingService)
      ]
    }).compile();
    service = moduleRef.get(MailOutageService);
  });

  it('should announce a mailbox unreachable at boot on the first failure', async () => {
    await service.announceUnreachable(MAILBOX, 'the TLS connection was refused');
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledWith(
      'channel-mail',
      expect.stringContaining('cannot be read: the TLS connection was refused')
    );
  });

  it('should stay quiet until a polling failure repeats, then announce once per episode', async () => {
    await service.recordFailedRead(MAILBOX, 'Exchange is down');
    await service.recordFailedRead(MAILBOX, 'Exchange is down');
    expect(chatGateway.postAsSystemIn).not.toHaveBeenCalled();
    await service.recordFailedRead(MAILBOX, 'Exchange is down');
    await service.recordFailedRead(MAILBOX, 'Exchange is down');
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledTimes(1);
  });

  it('should post the all-clear only when an outage was announced', async () => {
    await service.recordSuccessfulRead(MAILBOX);
    expect(chatGateway.postAsSystemIn).not.toHaveBeenCalled();
    await service.announceUnreachable(MAILBOX, 'Exchange is down');
    await service.recordSuccessfulRead(MAILBOX);
    expect(chatGateway.postAsSystemIn).toHaveBeenLastCalledWith(
      'channel-mail',
      expect.stringContaining('can be read again')
    );
  });

  it('should leave the notice owed to the next failure when the post is refused', async () => {
    chatGateway.postAsSystemIn.mockResolvedValueOnce(Result.err({ kind: 'api', message: 'rate limited' }));
    await service.announceUnreachable(MAILBOX, 'Exchange is down');
    await service.recordFailedRead(MAILBOX, 'Exchange is down');
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledTimes(1);
    await service.recordFailedRead(MAILBOX, 'Exchange is down');
    expect(chatGateway.postAsSystemIn).toHaveBeenCalledTimes(2);
  });
});
