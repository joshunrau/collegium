/** the ratio the framework's estimate assumes everywhere; a real tokeniser would replace this one seam */
export const CHARS_PER_TOKEN = 4;

/** never zero, so whatever is costed always weighs something */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}
