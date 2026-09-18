import { renderReference } from '@/utils/reference.utils.ts';

import type { MemoryFailure } from './memory.types.ts';

/** what the model, the trace, and /memory show for an entry: a prefix of its id, which the store resolves back (§3.6) */
export function renderMemoryReference(id: string): string {
  return renderReference(id);
}

export function renderUnresolvedReference(failure: MemoryFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `no memory entry with reference "${failure.reference}" exists`
    : `reference "${failure.reference}" matches more than one memory entry`;
}
