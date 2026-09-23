import { Injectable } from '@nestjs/common';

/**
 * §3.15 — per running turn, the posts it has read, which is what a close may rest on: every post a
 * window it assembled held. Held in process and forgotten when the turn ends: what one turn has
 * read says nothing about another.
 */
@Injectable()
export class PostSightingsRegistry {
  private readonly turns = new Map<string, Set<string>>();

  forgetTurn(turnId: string): void {
    this.turns.delete(turnId);
  }

  hasSeen(turnId: string, postId: string): boolean {
    return this.turns.get(turnId)?.has(postId) ?? false;
  }

  recordSeen(turnId: string, postIds: Iterable<string>): void {
    const seen = this.turns.get(turnId) ?? new Set<string>();
    for (const postId of postIds) {
      seen.add(postId);
    }
    this.turns.set(turnId, seen);
  }
}
