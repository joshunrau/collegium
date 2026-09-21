import type { ReachableChannel } from '@/channels/channels.types.ts';
import type { AuthorKind, ModelRow, PostKind, TriggerSource } from '@/prisma/prisma.types.ts';

export declare namespace ConversationFailure {
  /** the named post was never recorded, so there is nothing to act on */
  type PostNotFound = {
    kind: 'post-not-found';
    postId: string;
  };
  type Any = PostNotFound;
}

export type ConversationFailure = ConversationFailure.Any;

/** a `/collegium reset`, or the notice a `/collegium clear` cut against (§8.5): the instants context may not reach behind (§3.8) */
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
  /** posts the turn already holds, kept out of the query so one never costs a result slot */
  readonly excludePostIds?: readonly string[];
  readonly from?: Date;
  readonly limit: number;
  readonly query: string;
  readonly until?: Date;
};

/** §3.8 — one post read by its id, under exactly the bounds a search is read under */
export type SearchPostInput = {
  readonly agentUsername: string;
  readonly channels: readonly ReachableChannel[];
  readonly postId: string;
};

/** the trigger a system bot post announced, as the approval line names it (§3.7); the turn learns it from the triggers module */
export type TriggerOrigin = {
  readonly reference: string | undefined;
  readonly source: TriggerSource;
};

/** the person or trigger a chain of colleague requests descends from (§7.4), read off the chain's root post */
export type TurnRequestOrigin =
  | { readonly kind: 'human'; readonly message: string; readonly username: string }
  | { readonly kind: 'system'; readonly trigger?: TriggerOrigin };

/** who asked for a turn's work, read off the triggering post: a person's words, a colleague's name and whose request it relays, or the system bot (§3.7) */
export type TurnRequest =
  | { readonly kind: 'agent'; readonly onBehalfOf: TurnRequestOrigin | undefined; readonly username: string }
  | TurnRequestOrigin;

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
  /** §7.4 — the root the parent turn recorded, absent where the parent predates the column */
  readonly parentRootPostId: string | undefined;
};

/** one slot in the channel window: a post, or one trace event of the reading agent's own turns (§3.8) */
export type WindowEntry =
  | { readonly event: ModelRow<'TurnEvent'>; readonly kind: 'event' }
  | { readonly kind: 'post'; readonly post: ModelRow<'Post'> };

/** §3.8 — the channel window and the instant it reaches back to, where the agent's earlier actions pick up */
export type WindowResult = {
  readonly entries: readonly WindowEntry[];
  readonly oldestAt: Date | undefined;
};

/** one file a post carried, as the window names it (§3.8) — the store's shape, so the two cannot drift */
export type PostAttachment = PrismaJson.PostAttachments['files'][number];

export type ObservedPost = {
  readonly attachments: readonly PostAttachment[];
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
  'attachments' | 'authorKind' | 'authorUsername' | 'channelId' | 'createdAt' | 'id' | 'message'
>;
