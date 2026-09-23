/** eight base36 characters is ~2×10¹² values; at a few dozen records a collision is ~10⁻⁹, and every character dropped multiplies that by 36 */
export const REFERENCE_LENGTH = 8;

/** §3.6, §3.15 — a record is named to the model by the head of its id, resolved back by the store */
export function renderReference(id: string): string {
  return id.slice(0, REFERENCE_LENGTH);
}
