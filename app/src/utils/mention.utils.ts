import { uniq } from 'es-toolkit';

const MENTION_PATTERN = /@([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)/gi;

export function extractMentionedUsernames(text: string): string[] {
  return uniq(Array.from(text.matchAll(MENTION_PATTERN), (match) => match[1]!.toLowerCase()));
}

/**
 * Removes the `@` from mentions of the named users, reading them with the same grammar
 * `extractMentionedUsernames` reads. Detection and stripping disagreeing is what let a mention
 * activate a peer while surviving the strip (§4.5), so both must come from this one pattern.
 */
export function stripMentionsOf(text: string, usernames: readonly string[]): string {
  const targets = new Set(usernames.map((username) => username.toLowerCase()));
  return text.replaceAll(MENTION_PATTERN, (mention, username: string) =>
    targets.has(username.toLowerCase()) ? username : mention
  );
}
