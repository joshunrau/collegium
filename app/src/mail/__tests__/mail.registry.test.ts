import { beforeEach, describe, expect, it } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { $AgentDefinition, $MailboxDefinition } from '@/config/config.schemas.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { MailRegistry } from '../mail.registry.ts';
import { ExchangeMailProvider } from '../providers/exchange.provider.ts';
import { ImapMailProvider } from '../providers/imap.provider.ts';

const agent = (username: string, mailbox: $MailboxDefinition | undefined): $AgentDefinition => ({
  expertise: 'mail',
  ...(mailbox === undefined ? {} : { mailbox }),
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Tess.',
  tools: [],
  username
});

const agents: $AgentDefinition[] = [
  agent('tess', {
    announcementChannel: 'channel-mail',
    pollIntervalMs: 60_000,
    provider: {
      address: 'tess@example.org',
      clientId: 'client_1',
      clientSecret: 'secret_1',
      kind: 'exchange',
      tenantId: 'tenant_1'
    }
  }),
  agent('amir', {
    announcementChannel: 'channel-mail-2',
    pollIntervalMs: 30_000,
    provider: {
      address: 'amir@example.org',
      imap: { host: 'imap.example.org', port: 993, secure: true },
      kind: 'imap',
      password: 'password_1',
      smtp: { host: 'smtp.example.org', port: 587, secure: false },
      username: 'amir'
    }
  }),
  agent('mira', undefined)
];

describe('MailRegistry', () => {
  let mailRegistry: MailRegistry;

  beforeEach(async () => {
    const chatGateway = MockFactory.createMock(ChatGateway);
    chatGateway.resolveChannelId.mockImplementation((handle: string) => Promise.resolve(`id-${handle}`));
    mailRegistry = await MailRegistry.resolve(chatGateway, agents);
  });

  it('should build one provider per configured mailbox, by kind', () => {
    expect(mailRegistry.providerFor('tess')).toBeInstanceOf(ExchangeMailProvider);
    expect(mailRegistry.providerFor('amir')).toBeInstanceOf(ImapMailProvider);
    expect(mailRegistry.list().map(({ agentUsername }) => agentUsername)).toStrictEqual(['tess', 'amir']);
  });

  it('should resolve each announcement channel handle to its id', () => {
    expect(mailRegistry.list().map(({ announcementChannelId }) => announcementChannelId)).toStrictEqual([
      'id-channel-mail',
      'id-channel-mail-2'
    ]);
  });

  it('should hold no entry for an agent without a mailbox', () => {
    expect(mailRegistry.providerFor('mira')).toBeUndefined();
  });
});
