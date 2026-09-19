import { Result } from '@collegium/core/utils';
import { match } from 'ts-pattern';

import { renderElapsed } from '@/formatting/durations/duration.utils.ts';
import { renderReference } from '@/utils/reference.utils.ts';

import type { MemoryFailure } from './memory.types.ts';

/** what the model, the trace, and /memory show for an entry: a prefix of its id, which the store resolves back (§3.6) */
export function renderMemoryReference(id: string): string {
  return renderReference(id);
}

/** §3.6 — the body the model reads, with its age above it */
export function renderMemoryBody(memory: { readonly body: string; readonly createdAt: Date }, now: Date): string {
  return `written ${renderElapsed(now.getTime() - memory.createdAt.getTime())} ago\n\n${memory.body}`;
}

export function renderUnresolvedReference(failure: MemoryFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `no memory entry with reference "${failure.reference}" exists`
    : `reference "${failure.reference}" matches more than one memory entry`;
}

/** what the model reads when the store refuses a call; never the body, since a revision costs what the change costs (§3.6) */
export function renderMemoryFailure(failure: MemoryFailure): string {
  return match(failure)
    .with({ kind: 'ambiguous' }, { kind: 'not-found' }, renderUnresolvedReference)
    .with(
      { kind: 'too-long' },
      ({ field, length, limit }) => `the ${field} is ${length} characters, over its cap of ${limit}`
    )
    .with({ kind: 'empty-body' }, () => 'the revision would leave the memory empty; delete it instead')
    .with({ kind: 'passage-unmatched', occurrences: 'none' }, () => 'the passage does not occur in that memory')
    .with({ kind: 'passage-unmatched', occurrences: 'several' }, () => {
      return 'the passage occurs more than once in that memory; include enough of the surrounding text to match it exactly once';
    })
    .exhaustive();
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
