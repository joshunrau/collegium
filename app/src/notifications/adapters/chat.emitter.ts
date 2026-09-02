import { Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import { ChatGateway } from '@/chat/chat.gateway.ts';
import { DateFormatter } from '@/formatting/dates/date.formatter.ts';

import { NotificationsEmitter } from '../notifications.emitter.ts';

import type { SystemEvent } from '../notifications.types.ts';

@Injectable()
export class ChatEmitter extends NotificationsEmitter {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly dateFormatter: DateFormatter
  ) {
    super();
  }

  async notify(event: SystemEvent): Promise<void> {
    const content = this.renderSystemEvent(event);
    const posted =
      event.kind === 'multi-mention-refusal'
        ? await this.chatGateway.postAsSystemIn(event.channelId, content)
        : await this.chatGateway.postAsSystem(content);
    if (!posted.success) {
      throw new Error(`mattermost refused the notice post: ${posted.error.message}`);
    }
  }

  private renderSystemEvent(event: SystemEvent): string {
    return match(event)
      .with({ kind: 'halt' }, ({ reason }) => {
        const cause =
          reason.kind === 'turn-ceiling'
            ? `${reason.ceiling} turns started within one hour, the framework-wide ceiling`
            : `respond-to-all channel ${reason.channelId} now holds ${reason.agentUsernames.length} agents (${reason.agentUsernames.join(', ')})`;
        return `🛑 **Halted** — ${cause}. No agent will act until a human posts /collegium.resume.`;
      })
      .with({ kind: 'multi-mention-refusal' }, () => '⚠️ Address one agent per message.')
      .with({ kind: 'offline' }, (event) => {
        return event.reason === 'crash'
          ? '🔴 **Offline** — the orchestrator crashed. Agents are not responding.'
          : '⚪ **Offline** — the orchestrator shut down. Agents are not responding.';
      })
      .with({ kind: 'online' }, (event) => {
        const roster = event.agentUsernames.map((username) => `\`${username}\``).join(', ');
        const downtime =
          event.downSince === undefined ? '' : ` Offline since ${this.dateFormatter.format(event.downSince)}.`;
        const abandoned =
          event.abandonedTurns === 0 ? '' : ` ${event.abandonedTurns} in-flight turn(s) were abandoned.`;
        return `🟢 **Online** — the orchestrator started with ${event.agentUsernames.length} agent(s): ${roster}.${downtime}${abandoned}`;
      })
      .exhaustive();
  }
}
