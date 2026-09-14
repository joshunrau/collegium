import { beforeEach, describe, expect, it } from 'vitest';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { ResourcesService } from '@/resources/resources.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';

import { MailRegistry } from '../mail.registry.ts';
import { ExchangeMailProvider } from '../providers/exchange.provider.ts';
import { ImapMailProvider } from '../providers/imap.provider.ts';

import type { ResolvedMailbox } from '../mail.registry.ts';

const exchangeMailbox = (agentUsername: string, address: string, clientId: string): ResolvedMailbox => ({
  agentUsername,
  settings: {
    announcementChannel: 'channel-mail',
    pollIntervalMs: 60_000,
    provider: { address, clientId, clientSecret: 'secret_1', kind: 'exchange', tenantId: 'tenant_1' }
  }
});

const MAILBOXES: ResolvedMailbox[] = [
  exchangeMailbox('tess', 'tess@example.org', 'client_1'),
  {
    agentUsername: 'amir',
    settings: {
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
    }
  }
];

function buildChatGateway() {
  const chatGateway = MockFactory.createMock(ChatGateway);
  chatGateway.resolveChannelId.mockImplementation((handle: string) => Promise.resolve(`id-${handle}`));
  return chatGateway;
}

function buildResourcesService(template = '<body>{BODY}</body>') {
  const resourcesService = MockFactory.createMock(ResourcesService);
  resourcesService.readText.mockReturnValue(template);
  return resourcesService;
}

const templated = (): ResolvedMailbox[] => {
  const mailbox = exchangeMailbox('tess', 'tess@example.org', 'client_1');
  return [{ ...mailbox, settings: { ...mailbox.settings, template: 'mail/signature.html' } }];
};

describe('MailRegistry', () => {
  let mailRegistry: MailRegistry;

  beforeEach(async () => {
    mailRegistry = await MailRegistry.resolve(buildChatGateway(), buildResourcesService(), MAILBOXES);
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

  it('should refuse two agents sharing a mailbox address (§8)', async () => {
    const shared = [
      exchangeMailbox('tess', 'tess@example.org', 'client_1'),
      exchangeMailbox('amir', 'tess@example.org', 'client_2')
    ];
    await expect(MailRegistry.resolve(buildChatGateway(), buildResourcesService(), shared)).rejects.toThrow(
      'mailbox addresses must be unique across agents'
    );
  });

  it('should refuse two agents sharing an Exchange app registration (§8)', async () => {
    const shared = [
      exchangeMailbox('tess', 'tess@example.org', 'client_1'),
      exchangeMailbox('amir', 'amir@example.org', 'client_1')
    ];
    await expect(MailRegistry.resolve(buildChatGateway(), buildResourcesService(), shared)).rejects.toThrow(
      'Exchange client ids must be unique across agents'
    );
  });

  it('should read a mailbox template beneath the resources root', async () => {
    const resourcesService = buildResourcesService();
    const registry = await MailRegistry.resolve(buildChatGateway(), resourcesService, templated());
    expect(resourcesService.readText).toHaveBeenCalledWith('mail/signature.html');
    expect(registry.mailboxFor('tess')?.template).toBe('<body>{BODY}</body>');
  });

  it('should refuse a template without exactly one body placeholder', async () => {
    const resolving = MailRegistry.resolve(buildChatGateway(), buildResourcesService('<body></body>'), templated());
    await expect(resolving).rejects.toThrow(
      'agent "tess" mail template "mail/signature.html": must hold {BODY} exactly once'
    );
  });
});
