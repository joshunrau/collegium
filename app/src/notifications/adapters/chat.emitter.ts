import type { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import { RosterService } from '@/channels/roster/roster.service.ts';
import { ChatGateway } from '@/chat/chat.gateway.ts';
import type { ChatFailure } from '@/chat/chat.types.ts';
import { TransportRegistry } from '@/chat/transports/transport.registry.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';
import { renderElapsed } from '@/formatting/durations/duration.utils.ts';

import { NotificationsEmitter } from '../notifications.emitter.ts';

import type { SystemEvent } from '../notifications.types.ts';

@Injectable()
export class ChatEmitter extends NotificationsEmitter {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly dateFormatter: DateFormatter,
    private readonly rosterService: RosterService,
    private readonly transportRegistry: TransportRegistry
  ) {
    super();
  }

  async notify(event: SystemEvent): Promise<void> {
    const content = this.renderSystemEvent(event);
    // a notice about one channel belongs in it; everything else is framework-wide news for the main channel
    const posted =
      'channelId' in event ? await this.postIn(event, content) : await this.chatGateway.postAsSystem(content);
    if (!posted.success) {
      throw new Error(`mattermost refused the notice post: ${posted.error.message}`);
    }
  }

  /**
   * §7.6 — a stall notice goes under the agent's own account in a DM, which the roster knows the
   * channel to be (§3.11), and under it again where the system bot is refused elsewhere, as
   * `/collegium` announcements do (§7.5): the answer that matters is whether the notice landed.
   */
  private async postIn(
    event: Extract<SystemEvent, { channelId: string }>,
    content: string
  ): Promise<Result<{ postId: string }, ChatFailure>> {
    if (event.kind !== 'long-turn' && event.kind !== 'standing-queue') {
      return this.chatGateway.postAsSystemIn(event.channelId, content);
    }
    const asAgent = () => {
      return this.transportRegistry.get(event.agentUsername).send({ channelId: event.channelId, text: content });
    };
    if (this.rosterService.isDirectMessage(event.channelId)) {
      return asAgent();
    }
    const posted = await this.chatGateway.postAsSystemIn(event.channelId, content);
    return posted.success ? posted : asAgent();
  }

  private renderSystemEvent(event: SystemEvent): string {
    return (
      match(event)
        // an agent is named without its @ throughout: a mention from the system bot activates the agent it names (§7.6)
        .with(
          { kind: 'chain-limit-refusal' },
          ({ agentUsername, limit }) =>
            `⛔ \`${agentUsername}\` was not activated: this chain has reached its limit of ${limit} turns. A fresh post from a person starts a fresh chain.`
        )
        .with({ kind: 'halt' }, ({ reason }) => {
          const cause =
            reason.kind === 'turn-ceiling'
              ? `${reason.ceiling} turns started within one hour, the framework-wide ceiling`
              : `respond-to-all channel ${reason.channelId} now holds ${reason.agentUsernames.length} agents (${reason.agentUsernames.join(', ')})`;
          return `🛑 **Halted** — ${cause}. No agent will act until a human posts /collegium resume.`;
        })
        .with({ kind: 'long-turn' }, ({ agentUsername, heldMs, postsWaiting, tracedNothing }) => {
          const held = `⏳ \`${agentUsername}\` has been in one turn here for ${renderElapsed(heldMs)} without waiting on anyone`;
          const shown = tracedNothing
            ? ', and has called no tool yet: its status post was opened just now and will show what it does next. /collegium kill ends the turn; a turn still thinking needs nothing.'
            : '. If its status post shows no progress, /collegium kill ends the turn; a turn still working needs nothing.';
          const waiting = postsWaiting ? ` A post addressing \`${agentUsername}\` is waiting behind this turn.` : '';
          return `${held}${shown}${waiting}`;
        })
        // §4.5 — the refusal carries its remedy: a handle inside code is no mention in Mattermost's grammar
        .with({ kind: 'multi-mention-refusal' }, () => {
          return '⚠️ Address one agent per message. To name an agent without addressing it, put its handle in backticks: `@username`.';
        })
        .with({ kind: 'offline' }, (event) => {
          return event.reason === 'crash'
            ? '🔴 **Offline** — the orchestrator crashed. Agents are not responding.'
            : '⚪ **Offline** — the orchestrator shut down. Agents are not responding.';
        })
        .with({ kind: 'online' }, (event) => {
          const roster = event.agentUsernames.map((username) => `\`${username}\``).join(', ');
          const downtime = match(event.downtime)
            .with(undefined, () => '')
            .with(
              { kind: 'clean' },
              ({ startedAt, stoppedAt }) =>
                ` Offline from ${this.dateFormatter.format(stoppedAt)} to ${this.dateFormatter.format(startedAt)}.`
            )
            .with(
              { kind: 'since-last-alive' },
              ({ lastAliveAt }) => ` Offline since last known alive at ${this.dateFormatter.format(lastAliveAt)}.`
            )
            .exhaustive();
          const abandoned =
            event.abandonedTurns === 0 ? '' : ` ${event.abandonedTurns} in-flight turn(s) were abandoned.`;
          const requeued =
            event.requeuedTurns === 0 ? '' : ` ${event.requeuedTurns} that had not yet acted went back into the queue.`;
          return `🟢 **Online** — the orchestrator started with ${event.agentUsernames.length} agent(s): ${roster}.${downtime}${abandoned}${requeued}`;
        })
        .with(
          { kind: 'standing-queue' },
          ({ agentUsername }) =>
            `⏸️ \`${agentUsername}\` has work waiting here and no turn running. A post addressing \`${agentUsername}\` starts the turn that reads it; /collegium queue ${agentUsername} shows what waits.`
        )
        .exhaustive()
    );
  }
}
