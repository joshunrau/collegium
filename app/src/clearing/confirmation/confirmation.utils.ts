import type { ClearingState } from '../clearing.types.ts';

/** §6.4 — what the dialog's signature covers: every field the submission is acted on, and nothing it is not */
export function toSignedParts(state: ClearingState): readonly string[] {
  return ['clear', state.channelId, state.byUsername, state.issuedAt, state.memories ? 'memories' : 'posts'];
}
