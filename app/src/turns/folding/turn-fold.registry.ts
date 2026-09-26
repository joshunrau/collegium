import { Injectable } from '@nestjs/common';

type FoldEntry = {
  absorbing: boolean;
  authorUsername: string;
  offered: string[];
  readonly onOffered: () => void;
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
  /** §4.4 — called as a post is accepted, so the completion in flight, which the fold discards anyway, is aborted now */
  onOffered: () => void;
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
 * §4.4 — where a post that arrived too late for the pre-turn window goes as well as, or instead of,
 * the queue. The turn answering that human absorbs it, discards the completion that only saw the
 * first sentence, and re-assembles. Nothing here is durable: a post naming the agent was queued
 * before it was offered, so the reassembly takes its row and a failure returns it (§5.2); a
 * fragment naming nobody a crash interrupts is lost, the same trade the pre-turn window makes.
 */
@Injectable()
export class TurnFoldRegistry {
  private readonly entries = new Map<string, FoldEntry>();

  /**
   * Synchronous for the §5.1 reason the channel lock is: with no await between reading `absorbing`
   * and buffering the post, a post is either folded or left to the queue and its 👀, never neither.
   * Scoped to the turn's own author, so unrelated chatter in the channel costs a turn nothing.
   */
  offer(input: OfferInput): boolean {
    const entry = this.entries.get(this.toId(input));
    if (!entry?.absorbing || entry.authorUsername !== input.authorUsername) {
      return false;
    }
    entry.offered.push(input.postId);
    entry.onOffered();
    return true;
  }

  register(input: RegisterInput): TurnFoldHandle {
    if (input.authorUsername === undefined) {
      return INERT;
    }
    const id = this.toId(input);
    const entry: FoldEntry = {
      absorbing: true,
      authorUsername: input.authorUsername,
      offered: [],
      onOffered: input.onOffered
    };
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
