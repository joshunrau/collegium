import { Injectable } from '@nestjs/common';

type FoldEntry = {
  absorbing: boolean;
  authorUsername: string;
  offered: string[];
};

type OfferInput = {
  agentUsername: string;
  authorUsername: string;
  channelId: string;
  postId: string;
};

type RegisterInput = {
  agentUsername: string;
  /** the triggering post's author when a human started this turn; absent means this turn never folds */
  authorUsername: string | undefined;
  channelId: string;
};

/**
 * A turn that folds nothing, so the model loop needs no branch for the turns that cannot: a
 * trigger announcement and a drained pointer have no author with a follow-on fragment to wait for.
 */
const INERT: TurnFoldHandle = {
  release: () => undefined,
  stopAbsorbing: () => undefined,
  takeOffered: () => []
};

export type TurnFoldHandle = {
  release(): void;
  stopAbsorbing(): void;
  /** the post ids offered since the last call, clearing the buffer */
  takeOffered(): readonly string[];
};

/**
 * §4.4 — where a fragment that arrived too late for the pre-turn window goes instead of the queue.
 * The turn answering that human absorbs it, discards the completion that only saw the first
 * sentence, and re-assembles. Nothing here is durable: an absorbed fragment a crash interrupts is
 * lost, the same trade the pre-turn window already makes.
 */
@Injectable()
export class TurnFoldRegistry {
  private readonly entries = new Map<string, FoldEntry>();

  /**
   * Synchronous for the §5.1 reason the channel lock is: with no await between reading `absorbing`
   * and buffering the post, a fragment is either folded or queued, never both and never neither.
   * Scoped to the turn's own author, so unrelated chatter in the channel costs a turn nothing.
   */
  offer(input: OfferInput): boolean {
    const entry = this.entries.get(this.toId(input));
    if (!entry?.absorbing || entry.authorUsername !== input.authorUsername) {
      return false;
    }
    entry.offered.push(input.postId);
    return true;
  }

  register(input: RegisterInput): TurnFoldHandle {
    if (input.authorUsername === undefined) {
      return INERT;
    }
    const id = this.toId(input);
    const entry: FoldEntry = { absorbing: true, authorUsername: input.authorUsername, offered: [] };
    this.entries.set(id, entry);
    return {
      release: () => this.entries.delete(id),
      stopAbsorbing: () => {
        entry.absorbing = false;
      },
      takeOffered: () => entry.offered.splice(0)
    };
  }

  private toId(key: { agentUsername: string; channelId: string }): string {
    return `${key.agentUsername}\n${key.channelId}`;
  }
}
