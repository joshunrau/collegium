import { renderTimeLimit } from '@/formatting/durations/duration.utils.ts';

/** the transcript form a model copies back after reading its own history */
const TOOL_CALL_TRANSCRIPT = /^\[called [^\s(]+\([\s\S]*\)\]$/mu;

/** a tag, never an autolink: `<https://…>` and `<someone@example.com>` are a link a person reads (§4.5) */
const MARKUP_TAG = /<(?![a-z][\w+.-]*:\/\/|mailto:|[^\s<>@]+@[^\s<>@]+>)\/?[^<>\s][^<>]*>/giu;

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

/**
 * §3.15 — why a reply that reaches nobody goes back while the unit its turn works is still assigned,
 * with both ways on: the creator named as prose names a colleague, beside the handle a mention takes
 */
export function renderUnreportedUnitRejection(unit: {
  readonly canReport: boolean;
  readonly creatorDisplayName: string;
  readonly creatorUsername: string;
  readonly reference: string;
}): string {
  const { canReport, creatorDisplayName: creator, creatorUsername, reference } = unit;
  const wayOn = canReport
    ? `When the result is ready, or something stops you, report it with tasks__report, which posts the report and starts ${creator}'s turn. For an interim update or a question, mention @${creatorUsername} in the post.`
    : `For the result, something that stops you, an interim update or a question, mention @${creatorUsername} in the post.`;
  return `post rejected: unit ${reference} from ${creator} is still assigned to you, and this reply mentions no colleague here and no person, so nothing starts ${creator}'s turn when yours ends. ${wayOn} The same reply sent again is posted, and the unit stays assigned.`;
}

/** §7.1 — what a completion cut at the agent's time limit is told: nothing of it was kept, and the way on is less deliberation */
export function renderOverranRejection(limitMs: number): string {
  return `output rejected: your last response ran past its ${renderTimeLimit(limitMs)} limit and nothing of it was kept — reach your next call or your reply with less deliberation`;
}
