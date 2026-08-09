import { Injectable } from '@nestjs/common';

import type { AbortKind } from '../turns.types.ts';

type ControlEntry = {
  channelId: string;
  onKill: (() => void)[];
  requested?: AbortKind;
};

export type TurnControlHandle = {
  aborted(): AbortKind | undefined;
  /** resolves only on /kill — raced against in-flight awaits so a wedged turn returns now (§7.5) */
  killed: Promise<'killed'>;
  release(): void;
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
    const entry: ControlEntry = { channelId, onKill: [] };
    this.entries.set(turnId, entry);
    const killed = new Promise<'killed'>((resolve) => entry.onKill.push(() => resolve('killed')));
    return {
      aborted: () => entry.requested,
      killed,
      release: () => this.entries.delete(turnId)
    };
  }
}
