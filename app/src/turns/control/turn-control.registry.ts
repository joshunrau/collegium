import { Injectable } from '@nestjs/common';

import type { Abort, AbortKind, Steering } from '../turns.types.ts';

type ControlEntry = {
  agentUsername: string;
  channelId: string;
  onKill: (() => void)[];
  /** §7.6 — opens the turn's status post where it has none yet, and says whether it did */
  onSurface: () => Promise<boolean>;
  requested?: Abort;
  /** §7.5 — steering handed to this turn and not yet read; in memory, like every other flag here */
  steering: Steering[];
};

type RegisterInput = {
  agentUsername: string;
  channelId: string;
  onSurface: () => Promise<boolean>;
  turnId: string;
};

export type TurnControlHandle = {
  aborted(): Abort | undefined;
  /** resolves only on /kill — raced against in-flight awaits so a wedged turn returns now (§7.5) */
  killed: Promise<'killed'>;
  /** aborts on /kill — handed to the request in flight, so it stops streaming for a turn that is gone */
  killSignal: AbortSignal;
  release(): void;
  /** the steering handed to this turn since the last call, clearing the buffer (§7.5) */
  takeSteering(): readonly Steering[];
};

/**
 * The live index of running turns, so a channel-scoped command or the stall sweep can reach them.
 * In memory on purpose: a restart abandons every running turn, and with them every flag.
 */
@Injectable()
export class TurnControlRegistry {
  private readonly entries = new Map<string, ControlEntry>();

  /**
   * Flags every running turn in the channel and names the agents it reached; a kill overrides an
   * earlier stop, never the reverse. The invoker rides the flag, so the turn can say who ended it (§7.5).
   */
  abortChannel(channelId: string, kind: AbortKind, byUsername: string): string[] {
    const flagged: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.channelId !== channelId) {
        continue;
      }
      flagged.push(entry.agentUsername);
      if (kind === 'killed' || entry.requested === undefined) {
        entry.requested = { byUsername, kind };
      }
      if (kind === 'killed') {
        for (const fire of entry.onKill.splice(0)) {
          fire();
        }
      }
    }
    return flagged;
  }

  register(input: RegisterInput): TurnControlHandle {
    const entry: ControlEntry = {
      agentUsername: input.agentUsername,
      channelId: input.channelId,
      onKill: [],
      onSurface: input.onSurface,
      steering: []
    };
    this.entries.set(input.turnId, entry);
    const killed = new Promise<'killed'>((resolve) => entry.onKill.push(() => resolve('killed')));
    const controller = new AbortController();
    entry.onKill.push(() => controller.abort());
    return {
      aborted: () => entry.requested,
      killed,
      killSignal: controller.signal,
      release: () => this.entries.delete(input.turnId),
      takeSteering: () => entry.steering.splice(0)
    };
  }

  /** §7.5 — hands one instruction to every running turn in the channel; synchronous, so a releasing turn takes it or is gone */
  steerChannel(channelId: string, steering: Steering): number {
    let steered = 0;
    for (const entry of this.entries.values()) {
      if (entry.channelId !== channelId) {
        continue;
      }
      entry.steering.push(steering);
      steered += 1;
    }
    return steered;
  }

  /**
   * §7.6 — gives the agent's running turns in the channel a status post where they have none, and
   * says whether any was opened here: a turn that has traced nothing has shown nothing yet.
   */
  async surfaceStatusPosts(agentUsername: string, channelId: string): Promise<boolean> {
    let opened = false;
    for (const entry of this.entries.values()) {
      if (entry.agentUsername !== agentUsername || entry.channelId !== channelId) {
        continue;
      }
      opened = (await entry.onSurface()) || opened;
    }
    return opened;
  }
}
