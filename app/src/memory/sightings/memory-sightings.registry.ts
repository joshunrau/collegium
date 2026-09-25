import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { renderMemoryReference } from '../memory.utils.ts';

import type { MemoryFailure, MemorySighting } from '../memory.types.ts';

/**
 * §3.6 — per running turn, the newest revision of each memory it has seen. Held in process and
 * forgotten when the turn ends: what one turn has seen says nothing about another.
 */
@Injectable()
export class MemorySightingsRegistry {
  private readonly turns = new Map<string, Map<string, number>>();

  /** §3.6 — whether the turn may discard the entry as stored: only when it has seen that revision */
  confirmSeen(turnId: string, entry: MemorySighting): Result<void, MemoryFailure.UnseenRevision> {
    const seen = this.turns.get(turnId)?.get(entry.id);
    if (seen === entry.revision) {
      return Result.ok();
    }
    return Result.err({
      kind: 'unseen-revision',
      lastSeen: seen === undefined ? 'never' : 'earlier',
      reference: renderMemoryReference(entry.id)
    });
  }

  forgetTurn(turnId: string): void {
    this.turns.delete(turnId);
  }

  /** the turn revised the entry to this revision, which it has seen only if it had seen the one it revised */
  recordRevised(turnId: string, entry: MemorySighting): void {
    if (this.turns.get(turnId)?.get(entry.id) === entry.revision - 1) {
      this.recordSeen(turnId, entry);
    }
  }

  /** the turn read this revision's body, or wrote the entry */
  recordSeen(turnId: string, entry: MemorySighting): void {
    const seen = this.turns.get(turnId) ?? new Map<string, number>();
    // two concurrent reads can settle out of order around a revision; the newer body is the one seen
    seen.set(entry.id, Math.max(seen.get(entry.id) ?? entry.revision, entry.revision));
    this.turns.set(turnId, seen);
  }
}
