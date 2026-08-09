import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { $AgentDefinition, $MailboxDefinition } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';

import { MailRegistry } from '../mail.registry.ts';
import { ExchangeMailProvider } from '../providers/exchange.provider.ts';
import { ImapMailProvider } from '../providers/imap.provider.ts';

const agent = (username: string, mailbox: $MailboxDefinition | undefined): $AgentDefinition => ({
  botToken: 'token_1',
  expertise: 'mail',
  ...(mailbox === undefined ? {} : { mailbox }),
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Tess.',
  tools: [],
  username
});

describe('MailRegistry', () => {
  let mailRegistry: MailRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailRegistry,
        {
          provide: ConfigService,
          useValue: createConfigServiceMock({
            agents: [
              agent('tess', {
                announcementChannelId: 'channel-mail',
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
                announcementChannelId: 'channel-mail-2',
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
            ]
          })
        }
      ]
    }).compile();
    mailRegistry = moduleRef.get(MailRegistry);
  });

  it('should build one provider per configured mailbox, by kind', () => {
    expect(mailRegistry.providerFor('tess')).toBeInstanceOf(ExchangeMailProvider);
    expect(mailRegistry.providerFor('amir')).toBeInstanceOf(ImapMailProvider);
    expect(mailRegistry.list().map(({ agentUsername }) => agentUsername)).toStrictEqual(['tess', 'amir']);
  });

  it('should hold no entry for an agent without a mailbox', () => {
    expect(mailRegistry.providerFor('mira')).toBeUndefined();
  });
});
