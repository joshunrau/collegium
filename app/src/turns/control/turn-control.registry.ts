import { Injectable } from '@nestjs/common';

import type { AbortKind, Steering } from '../turns.types.ts';

type ControlEntry = {
  channelId: string;
  onKill: (() => void)[];
  requested?: AbortKind;
  /** §7.5 — steering handed to this turn and not yet read; in memory, like every other flag here */
  steering: Steering[];
};

export type TurnControlHandle = {
  aborted(): AbortKind | undefined;
  /** resolves only on /kill — raced against in-flight awaits so a wedged turn returns now (§7.5) */
  killed: Promise<'killed'>;
  /** aborts on /kill — handed to the request in flight, so it stops streaming for a turn that is gone */
  killSignal: AbortSignal;
  release(): void;
  /** the steering handed to this turn since the last call, clearing the buffer (§7.5) */
  takeSteering(): readonly Steering[];
};

/**
 * The live index of running turns, so a channel-scoped command can reach them. In memory on
 * purpose: a restart abandons every running turn, and with them every flag.
 */
@Injectable()
export class TurnControlRegistry {
  private readonly entries = new Map<string, ControlEntry>();

  /** flags every running turn in the channel; a kill overrides an earlier stop, never the reverse */
  abortChannel(channelId: string, kind: AbortKind): number {
    let flagged = 0;
    for (const entry of this.entries.values()) {
      if (entry.channelId !== channelId) {
        continue;
      }
      flagged += 1;
      if (kind === 'killed' || entry.requested === undefined) {
        entry.requested = kind;
      }
      if (kind === 'killed') {
        for (const fire of entry.onKill.splice(0)) {
          fire();
        }
      }
    }
    return flagged;
  }

  register(turnId: string, channelId: string): TurnControlHandle {
    const entry: ControlEntry = { channelId, onKill: [], steering: [] };
    this.entries.set(turnId, entry);
    const killed = new Promise<'killed'>((resolve) => entry.onKill.push(() => resolve('killed')));
    const controller = new AbortController();
    entry.onKill.push(() => controller.abort());
    return {
      aborted: () => entry.requested,
      killed,
      killSignal: controller.signal,
      release: () => this.entries.delete(turnId),
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
}
