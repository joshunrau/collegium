import type { ActivationSource, ObservedPost } from '@/conversations/conversations.types.ts';

/**
 * §5.2 — whether a post may start the turn of the agent it addresses by arriving. An agent's post
 * never does: the turn that wrote it starts the colleague it addressed once it ends or parks, so
 * arrival would be a second activation for the same post.
 */
export const activatesOnArrival = (post: Pick<ObservedPost, 'authorKind'>): boolean => {
  return post.authorKind !== 'agent';
};

/**
 * §7.4 — human-initiated is depth zero; trigger-initiated is one, because a cron is not a human
 * and unattended work is the dangerous kind; agent-initiated is the parent's depth plus one,
 * recovered through the authoring turn of the post that carried the mention — unless the mention
 * is a return: the authoring turn was itself answering a turn of the agent now activated, so the
 * new turn takes that turn's depth. Depth counts nesting, not exchanges.
 */
export const toActivationDepth = (source: ActivationSource | undefined, agentUsername: string): number => {
  if (!source || source.authorKind === 'human') {
    return 0;
  }
  if (source.authorKind === 'system') {
    return 1;
  }
  if (source.delegator?.agentUsername === agentUsername) {
    return source.delegator.depth;
  }
  return (source.parentDepth ?? 0) + 1;
};

/**
 * §7.4 — how many turns one human post has produced: a human's or the system bot's post starts a
 * chain at one, and every agent-authored post, return or hand-off, lengthens it by one.
 */
export const toActivationChainLength = (source: ActivationSource | undefined): number => {
  if (source?.authorKind !== 'agent') {
    return 1;
  }
  return (source.parentChainLength ?? 0) + 1;
};

/**
 * §7.4 — the post one chain descends from. A human's or the system bot's post starts a chain and is
 * its own root; an agent-authored post continues the root its parent recorded, and falls back to the
 * activating post where the parent predates the column, since a chain that spans a restart does not
 * continue (§7.3).
 */
export const toActivationRootPostId = (source: ActivationSource | undefined, triggeringPostId: string): string => {
  if (source?.authorKind !== 'agent') {
    return triggeringPostId;
  }
  return source.parentRootPostId ?? triggeringPostId;
};

/**
 * §4.4 — only a human's own further fragments fold into the turn answering them. A trigger
 * announcement and a peer's mention have no follow-on sentence to wait for, and a turn nobody is
 * still typing at should never discard a completion.
 */
export const toFoldAuthorUsername = (source: ActivationSource | undefined): string | undefined => {
  return source?.authorKind === 'human' ? source.authorUsername : undefined;
};
