import { ChatGateway } from '@/chat/chat.gateway.ts';

import { ExchangeAuth } from './providers/exchange.auth.ts';
import { ExchangeMailProvider } from './providers/exchange.provider.ts';
import { ImapMailProvider } from './providers/imap.provider.ts';

import type { MailProvider } from './mail.provider.ts';
import type { $MailSettings } from './mail.schemas.ts';

/** one configured mailbox, bound to the provider instance that serves it */
export type MailboxRuntime = {
  readonly agentUsername: string;
  readonly announcementChannelId: string;
  readonly pollIntervalMs: number;
  readonly provider: MailProvider;
};

/** one agent's mail settings, as the settings mechanism resolved them at boot (§8) */
export type ResolvedMailbox = {
  readonly agentUsername: string;
  readonly settings: $MailSettings;
};

/**
 * Which mailbox an agent reaches is decided in `resolve` and nowhere downstream. An agent without a
 * mailbox simply has no entry. The constructor is private because the announcement channel is named
 * by handle, and only the substrate can turn one into the id every caller asks by — so an instance
 * holding unresolved handles is not a state this can be in.
 */
export class MailRegistry {
  private constructor(private readonly mailboxes: ReadonlyMap<string, MailboxRuntime>) {}

  static async resolve(
    chatGateway: Pick<ChatGateway, 'resolveChannelId'>,
    mailboxes: readonly ResolvedMailbox[]
  ): Promise<MailRegistry> {
    MailRegistry.assertMailboxBoundaries(mailboxes);
    const resolved = await Promise.all(
      mailboxes.map(async ({ agentUsername, settings }) => {
        return [
          agentUsername,
          {
            agentUsername,
            announcementChannelId: await chatGateway.resolveChannelId(settings.announcementChannel),
            pollIntervalMs: settings.pollIntervalMs,
            provider:
              settings.provider.kind === 'exchange'
                ? new ExchangeMailProvider(settings.provider.address, new ExchangeAuth(settings.provider))
                : new ImapMailProvider(settings.provider)
          }
        ] as const;
      })
    );
    return new MailRegistry(new Map(resolved));
  }

  /**
   * The mailbox boundary is per agent, and the provider is what enforces it — so two agents sharing
   * an address, or an Exchange app registration, would collapse two authorities into one. Refused
   * at boot, in the module that owns the rule (§8).
   */
  private static assertMailboxBoundaries(mailboxes: readonly ResolvedMailbox[]): void {
    const addresses = mailboxes.map(({ settings }) => settings.provider.address);
    if (new Set(addresses).size !== addresses.length) {
      throw new Error('mailbox addresses must be unique across agents');
    }
    const clientIds = mailboxes.flatMap(({ settings }) =>
      settings.provider.kind === 'exchange' ? [settings.provider.clientId] : []
    );
    if (new Set(clientIds).size !== clientIds.length) {
      throw new Error(
        'Exchange client ids must be unique across agents: one app registration per mailbox is what lets the provider enforce the mailbox boundary'
      );
    }
  }

  list(): readonly MailboxRuntime[] {
    return Array.from(this.mailboxes.values());
  }

  providerFor(agentUsername: string): MailProvider | undefined {
    return this.mailboxes.get(agentUsername)?.provider;
  }
}
