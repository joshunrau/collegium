import type { AuthorKind, ModelRow } from '@/prisma/prisma.types.ts';

export declare namespace ConversationFailure {
  /** the named post was never recorded, so there is nothing to act on */
  type PostNotFound = {
    kind: 'post-not-found';
    postId: string;
  };
  type Any = PostNotFound;
}

export type ConversationFailure = ConversationFailure.Any;

/** what a post's origin implies about the turn it activates: §7.4 depth and §4.4 folding */
export type ActivationSource = {
  readonly authorKind: AuthorKind;
  readonly authorUsername: string;
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

/**
 * Exactly what the store persists about a post — the observation-only fields (addressing,
 * channel kind) exist for activation and never reach a row, so `record` does not accept them.
 */
export type RecordablePost = Pick<
  ObservedPost,
  'authorKind' | 'authorUsername' | 'channelId' | 'createdAt' | 'id' | 'message'
>;
