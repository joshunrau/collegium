import type { $MemorySettings } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import { renderElapsed } from '@/formatting/durations/duration.utils.ts';
import { renderReference } from '@/utils/reference.utils.ts';

import type { MemoryEdit, MemoryFailure, MemoryListingWithRevisions } from './memory.types.ts';

const CHARACTER_COUNT_FORMAT = new Intl.NumberFormat('en-US');

function formatCharacters(count: number): string {
  return CHARACTER_COUNT_FORMAT.format(count);
}

/** §3.6 — a body's size against its cap, reported on every write and revision so a memory nearing it is seen before a refusal */
function renderBodySize(bodyLength: number, caps: $MemorySettings): string {
  return `${formatCharacters(bodyLength)} of ${formatCharacters(caps.maxBodyChars)} characters`;
}

function renderPassageUnmatched({ edit, occurrences }: MemoryFailure.PassageUnmatched): string {
  const refusal =
    occurrences === 'none'
      ? 'the passage does not occur in that memory'
      : 'the passage occurs more than once in that memory; include enough of the surrounding text to match it exactly once';
  return edit === undefined ? refusal : `none of the edits was applied: in edit ${edit}, ${refusal}`;
}

/** what the model, the trace, and /memory show for an entry: a prefix of its id, which the store resolves back (§3.6) */
export function renderMemoryReference(id: string): string {
  return renderReference(id);
}

/** §3.6 — the body the model reads, with its age, its written-at date, and the age of its last revision above it */
export function renderMemoryBody(
  memory: { readonly body: string; readonly createdAt: Date; readonly revisedAt: Date | null },
  now: Date,
  formatDate: (date: Date) => string
): string {
  const written = `written ${renderElapsed(now.getTime() - memory.createdAt.getTime())} ago, on ${formatDate(memory.createdAt)}`;
  const revised = memory.revisedAt && `; last revised ${renderElapsed(now.getTime() - memory.revisedAt.getTime())} ago`;
  return `${written}${revised ?? ''}\n\n${memory.body}`;
}

/** §8.4 — one line of the operator's listing: the entry, and how often and how lately it was revised once it has been */
export function renderListingWithRevisions(entry: MemoryListingWithRevisions, now: Date): string {
  const listed = `${entry.reference}: ${entry.description}`;
  if (entry.revisedAt === null) {
    return listed;
  }
  const times = entry.revision === 1 ? 'once' : `${entry.revision} times`;
  return `${listed} (revised ${times}, last ${renderElapsed(now.getTime() - entry.revisedAt.getTime())} ago)`;
}

/** what the model reads for a reference its own store cannot resolve (§3.6) */
export function renderUnresolvedReference(failure: MemoryFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `none of your memories has the reference "${failure.reference}"; memories are private to each agent`
    : `reference "${failure.reference}" matches more than one of your memories`;
}

/** what an operator reads for a reference an agent's store cannot resolve (§8.4) */
export function renderUnresolvedReferenceFor(agentUsername: string, failure: MemoryFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `${agentUsername} has no memory with reference "${failure.reference}".`
    : `Reference "${failure.reference}" matches more than one of ${agentUsername}'s memories.`;
}

/** §3.6 — what the model reads for a write: the body's size against its cap, and whatever the entry cap evicted to make room */
export function renderWriteResult(
  written: { readonly bodyLength: number; readonly evictedDescriptions: readonly string[]; readonly reference: string },
  caps: $MemorySettings
): string {
  const saved = `memory ${written.reference} saved (${renderBodySize(written.bodyLength, caps)})`;
  const evicted = written.evictedDescriptions;
  if (evicted.length === 0) {
    return saved;
  }
  const readLongestAgo = evicted.length === 1 ? 'the one' : `the ${evicted.length}`;
  const descriptions = evicted.map((description) => `"${description}"`).join(', ');
  return `${saved}; at the cap of ${caps.maxEntries} memories, it removed ${readLongestAgo} read longest ago: ${descriptions}`;
}

/** §3.6 — what the model reads for a revision: the body's size against its cap */
export function renderRevisionResult(
  revised: { readonly bodyLength: number; readonly reference: string },
  caps: $MemorySettings
): string {
  return `memory ${revised.reference} revised (${renderBodySize(revised.bodyLength, caps)})`;
}

/** what the model reads when the store refuses a call; never the body, since a revision costs what the change costs (§3.6) */
export function renderMemoryFailure(failure: MemoryFailure): string {
  return (
    match(failure)
      .with({ kind: 'ambiguous' }, { kind: 'not-found' }, renderUnresolvedReference)
      .with(
        { kind: 'too-long' },
        ({ field, length, limit }) =>
          `the ${field} is ${formatCharacters(length)} characters, over its cap of ${formatCharacters(limit)}; shorten it and write again`
      )
      .with(
        { field: 'description', kind: 'revision-too-long' },
        ({ length, limit }) =>
          `the description is ${formatCharacters(length)} characters, over its cap of ${formatCharacters(limit)}; shorten it and try again`
      )
      // §3.6 — the remedy is room made in this entry, never a second entry beside it
      .with(
        { field: 'body', kind: 'revision-too-long' },
        ({ length, limit, reference, storedLength }) =>
          `memory ${reference} holds ${formatCharacters(storedLength)} of ${formatCharacters(limit)} characters, and this change would make it ${formatCharacters(length)}; shorten a passage with memory__replace, or rewrite the memory without what is no longer needed with memory__rewrite, then try again`
      )
      .with({ kind: 'empty-body' }, () => 'the revision would leave the memory empty; delete it instead')
      .with(
        { kind: 'unseen-revision', lastSeen: 'earlier' },
        ({ reference }) => `memory ${reference} was revised since you read it; read it again first`
      )
      .with(
        { kind: 'unseen-revision', lastSeen: 'never' },
        ({ reference }) => `you have not read memory ${reference} in this turn; read it first`
      )
      .with({ kind: 'passage-unmatched' }, renderPassageUnmatched)
      .exhaustive()
  );
}

export function appendToBody(body: string, text: string): string {
  return `${body}\n${text}`;
}

/** §3.6 — a passage found other than exactly once is refused rather than guessed at */
export function replaceSinglePassage(
  body: string,
  passage: string,
  replacement: string
): Result<string, MemoryFailure.PassageUnmatched> {
  const start = body.indexOf(passage);
  if (start === -1) {
    return Result.err({ kind: 'passage-unmatched', occurrences: 'none' });
  }
  if (body.includes(passage, start + 1)) {
    return Result.err({ kind: 'passage-unmatched', occurrences: 'several' });
  }
  // spliced rather than String.replace, which would expand `$&` and `$1` in the replacement text
  return Result.ok(body.slice(0, start) + replacement + body.slice(start + passage.length));
}

/** §3.6 — each edit in order, to the text the one before it left; one found other than exactly once refuses them all */
export function replacePassages(
  body: string,
  edits: readonly MemoryEdit[]
): Result<string, MemoryFailure.PassageUnmatched> {
  let revised = body;
  for (const [index, { passage, replacement }] of edits.entries()) {
    const replaced = replaceSinglePassage(revised, passage, replacement);
    if (!replaced.success) {
      return edits.length === 1 ? replaced : Result.err({ ...replaced.error, edit: index + 1 });
    }
    revised = replaced.value;
  }
  return Result.ok(revised);
}
