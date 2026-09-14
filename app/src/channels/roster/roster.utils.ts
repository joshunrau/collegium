import type { ChannelRecord } from '../channels.types.ts';

/**
 * Whether everyone who can read `current` can read `candidate` (§3.8). An open channel is read
 * by the whole team, so only another open channel contains its audience; a closed channel's
 * audience is its members, contained by any open channel or a closed one holding them all.
 */
export function isAudienceWithin(current: ChannelRecord, candidate: ChannelRecord): boolean {
  if (candidate.kind === 'open') {
    return true;
  }
  if (current.kind === 'open') {
    return false;
  }
  return current.memberUsernames.isSubsetOf(candidate.memberUsernames);
}

/** the substrate's name where it gives one; a direct channel is named by whoever else is in it */
export function renderChannelName(record: ChannelRecord, selfUsername: string): string {
  if (record.displayName !== '') {
    return record.displayName;
  }
  const others = [...record.memberUsernames].filter((username) => username !== selfUsername).toSorted();
  return others.map((username) => `@${username}`).join(', ');
}
