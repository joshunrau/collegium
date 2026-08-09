import { Injectable } from '@nestjs/common';

import type { ApprovalDecision } from '../approvals.types.ts';

type PendingEntry = {
  readonly approvalId: string;
  readonly channelId: string;
  readonly resolve: (decision: ApprovalDecision) => void;
};

/**
 * Maps approval id → the promise resolver a blocked turn is waiting on, in memory. The DB row is
 * the durable record; a restart loses resolvers, which is correct — `invalidateAll` runs on boot
 * and edits every stale prompt to a dead state (§7.3).
 */
@Injectable()
export class PendingRegistry {
  private readonly entries = new Map<string, PendingEntry>();

  register(entry: PendingEntry): void {
    this.entries.set(entry.approvalId, entry);
  }

  /** removes and returns the resolver — a resolution happens exactly once */
  take(approvalId: string): PendingEntry | undefined {
    const entry = this.entries.get(approvalId);
    this.entries.delete(approvalId);
    return entry;
  }
}
