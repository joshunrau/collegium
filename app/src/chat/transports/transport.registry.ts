import { Injectable } from '@nestjs/common';

import type { ChatTransport } from '../chat.transport.ts';

/**
 * The connected transport per agent username, so `turns`, `approvals`, and `triggers` can post as
 * the right identity without depending on `runtime`.
 */
@Injectable()
export class TransportRegistry {
  private readonly transports = new Map<string, ChatTransport>();

  get(agentUsername: string): ChatTransport {
    const transport = this.transports.get(agentUsername);
    if (!transport) {
      throw new Error(`no transport is registered for agent "${agentUsername}"`);
    }
    return transport;
  }

  register(agentUsername: string, transport: ChatTransport): void {
    this.transports.set(agentUsername, transport);
  }
}
