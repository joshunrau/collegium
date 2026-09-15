import type { ActivationSource } from '@/conversations/conversations.types.ts';

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
 * §4.4 — only a human's own further fragments fold into the turn answering them. A trigger
 * announcement and a peer's mention have no follow-on sentence to wait for, and a turn nobody is
 * still typing at should never discard a completion.
 */
export const toFoldAuthorUsername = (source: ActivationSource | undefined): string | undefined => {
  return source?.authorKind === 'human' ? source.authorUsername : undefined;
};
