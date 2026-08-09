import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { TransportRegistry } from '@/chat/transports/transport.registry.ts';

/**
 * Mattermost expires a typing indicator client-side after
 * ServiceSettings.TimeBetweenUserTypingUpdatesMilliseconds (5000ms by default), so the signal is
 * re-sent just inside that window for as long as it should show.
 */
const TYPING_REFRESH_MS = 4000;

type StartInput = {
  agentUsername: string;
  channelId: string;
};

export type TypingSignalHandle = { stop(): void };

/**
 * §8.1 — the substrate's own "composing" signal, lit only while the model generates. It creates no
 * post and writes nothing to the store, so it says an agent is working without adding machinery to
 * a channel where approval prompts live (A5). Tool execution and approval waits are deliberately
 * dark: the status post and the prompt itself already speak there.
 */
@Injectable()
export class TypingIndicatorService implements OnApplicationShutdown {
  private readonly live = new Set<NodeJS.Timeout>();

  constructor(private readonly transportRegistry: TransportRegistry) {}

  /** an interval outlives the event loop's willingness to exit; a shutdown mid-turn must clear it */
  onApplicationShutdown(): void {
    for (const timer of this.live) {
      clearInterval(timer);
    }
    this.live.clear();
  }

  start(input: StartInput): TypingSignalHandle {
    const transport = this.transportRegistry.get(input.agentUsername);
    transport.signalTyping(input.channelId);
    const timer = setInterval(() => transport.signalTyping(input.channelId), TYPING_REFRESH_MS);
    this.live.add(timer);
    return {
      stop: () => {
        clearInterval(timer);
        this.live.delete(timer);
      }
    };
  }
}
