import type { ReachableChannel } from '@/channels/channels.types.ts';
import type { AuthorKind, ModelRow, PostKind } from '@/prisma/prisma.types.ts';

export declare namespace ConversationFailure {
  /** the named post was never recorded, so there is nothing to act on */
  type PostNotFound = {
    kind: 'post-not-found';
    postId: string;
  };
  type Any = PostNotFound;
}

export type ConversationFailure = ConversationFailure.Any;

/** the most recent `/collegium reset` in a channel, as the instants context may not reach behind (§3.8) */
export type EpisodeBoundary = {
  readonly eventsAfter: Date;
  readonly postsAfter: Date;
};

/** one post a search found, with its channel named as the model should see it (§3.8) */
export type SearchHit = {
  readonly authorUsername: string;
  readonly channelName: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly message: string;
};

export type SearchInput = {
  readonly agentUsername: string;
  readonly authorUsername?: string;
  /** the channels the roster allows from where the search is made (§3.8); nothing outside them is read */
  readonly channels: readonly ReachableChannel[];
  readonly from?: Date;
  readonly limit: number;
  readonly query: string;
  readonly until?: Date;
};

/** the turn whose post activated the turn that authored a post — who a mention would be returning to (§7.4) */
export type DelegatingTurn = {
  readonly agentUsername: string;
  readonly depth: number;
};

/** what a post's origin implies about the turn it activates: §7.4 depth and chain length, §4.4 folding */
export type ActivationSource = {
  readonly authorKind: AuthorKind;
  readonly authorUsername: string;
  readonly delegator: DelegatingTurn | undefined;
  readonly parentChainLength: number | undefined;
  readonly parentDepth: number | undefined;
};

/** one slot in the channel window: a post, or one trace event of the reading agent's own turns (§3.8) */
export type WindowEntry =
  | { readonly event: ModelRow<'TurnEvent'>; readonly kind: 'event' }
  | { readonly kind: 'post'; readonly post: ModelRow<'Post'> };

export type ObservedPost = {
  readonly authorKind: AuthorKind;
  readonly authorUsername: string;
  readonly channelId: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly isDirectMessage: boolean;
  readonly mentionedUsernames: readonly string[];
  readonly message: string;
};

/** what a turn of this process says about a post it authored: which turn, and what kind of post it is */
export type PostAuthorship = {
  readonly kind: Exclude<PostKind, 'message'>;
  readonly turnId: string;
};

/**
 * Exactly what the store persists about a post — the observation-only fields (addressing,
 * channel kind) exist for activation and never reach a row, so `record` does not accept them.
 */
export type RecordablePost = Pick<
  ObservedPost,
  'authorKind' | 'authorUsername' | 'channelId' | 'createdAt' | 'id' | 'message'
>;
