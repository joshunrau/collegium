import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { $AgentDefinition } from '@/config/config.schemas.ts';

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
 * Which mailbox an agent reaches is decided in `resolve` and nowhere downstream. An agent without a
 * mailbox simply has no entry. The constructor is private because the announcement channel is named
 * by handle, and only the substrate can turn one into the id every caller asks by — so an instance
 * holding unresolved handles is not a state this can be in.
 */
export class MailRegistry {
  private constructor(private readonly mailboxes: ReadonlyMap<string, MailboxRuntime>) {}

  static async resolve(
    chatGateway: Pick<ChatGateway, 'resolveChannelId'>,
    agents: readonly $AgentDefinition[]
  ): Promise<MailRegistry> {
    const declared = agents.flatMap((definition) =>
      definition.mailbox === undefined ? [] : ([[definition.username, definition.mailbox]] as const)
    );
    const resolved = await Promise.all(
      declared.map(async ([agentUsername, mailbox]) => {
        return [
          agentUsername,
          {
            agentUsername,
            announcementChannelId: await chatGateway.resolveChannelId(mailbox.announcementChannel),
            pollIntervalMs: mailbox.pollIntervalMs,
            provider:
              mailbox.provider.kind === 'exchange'
                ? new ExchangeMailProvider(mailbox.provider.address, new ExchangeAuth(mailbox.provider))
                : new ImapMailProvider(mailbox.provider)
          }
        ] as const;
      })
    );
    return new MailRegistry(new Map(resolved));
  }

  list(): readonly MailboxRuntime[] {
    return Array.from(this.mailboxes.values());
  }

  providerFor(agentUsername: string): MailProvider | undefined {
    return this.mailboxes.get(agentUsername)?.provider;
  }
}
