import type { MemoryFailure } from './memory.types.ts';

/** eight base36 characters is ~2×10¹² values; at the fifty-entry cap a collision is ~6×10⁻¹⁰, and every character dropped multiplies that by 36 */
const MEMORY_REFERENCE_LENGTH = 8;

/** what the model, the trace, and /memory show for an entry: a prefix of its id, which the store resolves back (§3.6) */
export function renderMemoryReference(id: string): string {
  return id.slice(0, MEMORY_REFERENCE_LENGTH);
}

export function renderUnresolvedReference(failure: MemoryFailure.Unresolved): string {
  return failure.kind === 'not-found'
    ? `no memory entry with reference "${failure.reference}" exists`
    : `reference "${failure.reference}" matches more than one memory entry`;
}
