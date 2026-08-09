import type { WindowEntry } from '../conversations.types.ts';

const CHARS_PER_TOKEN = 4;

/** the seam a real tokenizer could replace later. Never zero, so a window entry always has a cost */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** what an entry costs against the window budget */
export function entryText(entry: WindowEntry): string {
  return entry.kind === 'post' ? entry.post.message : JSON.stringify(entry.event.payload);
}
