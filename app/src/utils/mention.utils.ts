import { uniq } from 'es-toolkit';

import { listProseRanges } from './markdown.utils.ts';

/**
 * Mattermost's grammar (§4.5): a handle is a mention only where the client highlights it — outside
 * code, and opening its own word. An `@` mid-word is an address or a literal, never a mention.
 */
const MENTION_PATTERN = /(?<![\p{L}\p{N}@])@([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?![\p{L}\p{N}@])/giu;

type Mention = { readonly end: number; readonly start: number; readonly username: string };

function listMentions(text: string): Mention[] {
  return listProseRanges(text).flatMap((range) => {
    return Array.from(text.slice(range.start, range.end).matchAll(MENTION_PATTERN), (match) => ({
      end: range.start + match.index + match[0].length,
      start: range.start + match.index,
      username: match[1]!.toLowerCase()
    }));
  });
}

export function extractMentionedUsernames(text: string): string[] {
  return uniq(listMentions(text).map((mention) => mention.username));
}

/**
 * Removes the `@` from mentions of the named users, reading them with the same grammar
 * `extractMentionedUsernames` reads. Detection and stripping disagreeing is what let a mention
 * activate a peer while surviving the strip (§4.5), so both must come from this one pattern.
 */
export function stripMentionsOf(text: string, usernames: readonly string[]): string {
  const targets = new Set(usernames.map((username) => username.toLowerCase()));
  let output = '';
  let cursor = 0;
  for (const mention of listMentions(text)) {
    if (!targets.has(mention.username)) {
      continue;
    }
    output += text.slice(cursor, mention.start) + text.slice(mention.start + 1, mention.end);
    cursor = mention.end;
  }
  return output + text.slice(cursor);
}
