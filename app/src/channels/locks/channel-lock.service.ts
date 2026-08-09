import { Injectable } from '@nestjs/common';

import type { LockHandle } from '../channels.types.ts';

/**
 * The concurrency unit of §5.1: one turn at a time per (agent, channel). In-memory only — §7.3
 * abandons everything on restart, so a durable lock would only ever be a stale lock.
 */
@Injectable()
export class ChannelLockService {
  private readonly holders = new Map<string, Map<string, LockHandle>>();

  /** synchronous by construction — no await between observing a free channel and claiming it (§5.1) */
  acquire(agentUsername: string, channelId: string): LockHandle | undefined {
    const channelHolders = this.holders.get(channelId) ?? new Map<string, LockHandle>();
    if (channelHolders.has(agentUsername)) {
      return undefined;
    }
    const handle: LockHandle = {
      release: () => {
        const current = this.holders.get(channelId);
        if (current?.get(agentUsername) !== handle) {
          return;
        }
        current.delete(agentUsername);
        if (current.size === 0) {
          this.holders.delete(channelId);
        }
      }
    };
    channelHolders.set(agentUsername, handle);
    this.holders.set(channelId, channelHolders);
    return handle;
  }

  isBusy(agentUsername: string, channelId: string): boolean {
    return this.holders.get(channelId)?.has(agentUsername) ?? false;
  }

  /** one input to §4.2 idle-gating — activation composes it with pending approvals and debounce */
  isChannelIdle(channelId: string): boolean {
    return (this.holders.get(channelId)?.size ?? 0) === 0;
  }
}
