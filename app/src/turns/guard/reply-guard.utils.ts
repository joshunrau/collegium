/** the transcript form a model copies back after reading its own history */
const TOOL_CALL_TRANSCRIPT = /^\[called [^\s(]+\([\s\S]*\)\]$/mu;

const MARKUP_TAG = /<\/?[^<>\s][^<>]*>/gu;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** §4.5 — how often one line recurs, making up most of a reply, before the reply is that line and nothing else */
const DEGENERATE_REPEAT_COUNT = 5;

/** how often the commonest non-blank line recurs, and how many non-blank lines there are */
function measureCommonestLine(text: string): { lines: number; repeats: number } {
  const counts = new Map<string, number>();
  let lines = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      lines += 1;
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  return { lines, repeats: Math.max(0, ...counts.values()) };
}

/**
 * Whether output is a tool call written as the transcript line a model reads back from its own
 * history. Posted, it runs nothing and reads as a completed action. The provider's own call markup
 * is recognised behind the inference seam instead (§4.5).
 */
export function containsToolCallTranscript(text: string): boolean {
  return TOOL_CALL_TRANSCRIPT.test(text);
}

/**
 * §4.5 — whether a reply holds no prose: no letter or digit in any script outside markup tags, or
 * one line repeated over and over that makes up most of it. Neither is a message anyone meant to
 * send, whichever provider produced it.
 */
export function lacksProse(text: string): boolean {
  if (!LETTER_OR_DIGIT.test(text.replace(MARKUP_TAG, ''))) {
    return true;
  }
  const { lines, repeats } = measureCommonestLine(text);
  return repeats >= DEGENERATE_REPEAT_COUNT && repeats * 2 > lines;
}
