import type { ActivationSource } from '@/conversations/conversations.types.ts';

/**
 * §7.4 — human-initiated is depth zero; trigger-initiated is one, because a cron is not a human
 * and unattended work is the dangerous kind; agent-initiated is the parent's depth plus one,
 * recovered through the authoring turn of the post that carried the mention.
 */
export const toActivationDepth = (source: ActivationSource | undefined): number => {
  if (!source || source.authorKind === 'human') {
    return 0;
  }
  if (source.authorKind === 'system') {
    return 1;
  }
  return (source.parentDepth ?? 0) + 1;
};

/**
 * §4.4 — only a human's own further fragments fold into the turn answering them. A trigger
 * announcement and a peer's mention have no follow-on sentence to wait for, and a turn nobody is
 * still typing at should never discard a completion.
 */
export const toFoldAuthorUsername = (source: ActivationSource | undefined): string | undefined => {
  return source?.authorKind === 'human' ? source.authorUsername : undefined;
};
