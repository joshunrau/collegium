import { Injectable } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';

import { ExchangeAuth } from './providers/exchange.auth.ts';
import { ExchangeMailProvider } from './providers/exchange.provider.ts';
import { ImapMailProvider } from './providers/imap.provider.ts';

import type { MailProvider } from './mail.provider.ts';

/** one configured mailbox, bound to the provider instance that serves it */
export type MailboxRuntime = {
  readonly agentUsername: string;
  readonly announcementChannelId: string;
  readonly pollIntervalMs: number;
  readonly provider: MailProvider;
};

/**
 * Providers are built once, from configuration, at construction — which mailbox an agent reaches
 * is decided here and nowhere downstream. An agent without a mailbox simply has no entry.
 */
@Injectable()
export class MailRegistry {
  private readonly mailboxes: ReadonlyMap<string, MailboxRuntime>;

  constructor(configService: ConfigService) {
    this.mailboxes = new Map(
      configService
        .get('agents')
        .flatMap((definition) =>
          definition.mailbox === undefined ? [] : ([[definition.username, definition.mailbox]] as const)
        )
        .map(([agentUsername, mailbox]) => [
          agentUsername,
          {
            agentUsername,
            announcementChannelId: mailbox.announcementChannelId,
            pollIntervalMs: mailbox.pollIntervalMs,
            provider:
              mailbox.provider.kind === 'exchange'
                ? new ExchangeMailProvider(mailbox.provider.address, new ExchangeAuth(mailbox.provider))
                : new ImapMailProvider(mailbox.provider)
          }
        ])
    );
  }

  list(): readonly MailboxRuntime[] {
    return Array.from(this.mailboxes.values());
  }

  providerFor(agentUsername: string): MailProvider | undefined {
    return this.mailboxes.get(agentUsername)?.provider;
  }
}
