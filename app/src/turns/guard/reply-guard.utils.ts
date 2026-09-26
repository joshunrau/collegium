import { match } from 'ts-pattern';

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

/** §3.15 — the rest of the units a reminder counts beside the one it names */
function renderOthers(others: number, verb: string): string {
  return others === 0
    ? ''
    : `, as ${others === 1 ? 'is' : 'are'} ${others} more ${others === 1 ? 'unit' : 'units'} ${verb}`;
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
  /** the turn's other units still assigned to it, which the reminder counts */
  readonly others: number;
  readonly reference: string;
}): string {
  const { canReport, creatorDisplayName: creator, creatorUsername, reference } = unit;
  const wayOn = canReport
    ? `When the result is ready, or something stops you, report it with tasks__report, which posts the report and starts ${creator}'s turn. For an interim update or a question, mention @${creatorUsername} in the post.`
    : `For the result, something that stops you, an interim update or a question, mention @${creatorUsername} in the post.`;
  return `post rejected: unit ${reference} from ${creator} is still assigned to you${renderOthers(unit.others, 'here')}, and this reply mentions no colleague here and no person, so nothing starts ${creator}'s turn when yours ends. ${wayOn} The same reply sent again is posted, and the unit stays assigned.`;
}

/**
 * §3.15 — why a creator's reply that reaches nobody goes back while a report it answers awaits its
 * verdict, naming only the ways on that would pass: a continuation and a mention of the assignee
 * only where that assignee is the colleague this turn already addressed, or none is (§4.5)
 */
export function renderVerdictOwedRejection(unit: {
  readonly assigneeDisplayName: string;
  readonly assigneeUsername: string;
  readonly canContinue: boolean;
  readonly canMention: boolean;
  readonly others: number;
  readonly reference: string;
}): string {
  const { assigneeDisplayName: assignee, reference } = unit;
  const ways = [
    'close it with tasks__close',
    ...(unit.canContinue ? ['continue its work with tasks__assign naming it in follows'] : []),
    ...(unit.canMention ? [`ask ${assignee} what you need in a post mentioning @${unit.assigneeUsername}`] : [])
  ];
  return `post rejected: the report on unit ${reference} from ${assignee} awaits your verdict${renderOthers(unit.others, 'awaiting yours')}, and this reply mentions no colleague here and no person, so the unit waits when your turn ends. ${ways.join('; or ')}. The same reply sent again is posted, and the unit waits.`;
}

/** §3.15, RC1 — who an empty ending after a hand-off still owes a reply to, from the posts the turn answers or a steer */
export type OwedReply =
  | { readonly addressedUsername: string; readonly displayName: string; readonly kind: 'colleague' }
  | { readonly kind: 'person' | 'steered' | 'trigger' };

/**
 * §3.15 — an empty ending sent back once where the turn owes a reply, saying why and how to answer:
 * a colleague other than the one addressed is answered in text without an @, since a mention of
 * them would be refused as a second addressee (§4.5)
 */
export function renderOwedReplyRejection(owed: OwedReply): string {
  const why = match(owed)
    .with({ kind: 'steered' }, () => 'a person steered it; answer them')
    .with({ kind: 'person' }, () => "a person's post is among those it answers; answer them")
    .with({ kind: 'trigger' }, () => "a trigger's announcement is among those it answers; say here what it needs")
    .with(
      { kind: 'colleague' },
      ({ addressedUsername, displayName }) =>
        `a post of ${displayName}'s is among those it answers; answer it here in text and without an @, since this turn has already addressed @${addressedUsername} and a mention of ${displayName} would be refused. Your answer stays in the channel; it does not start their turn.`
    )
    .exhaustive();
  return `output rejected: an empty reply, but this turn owes one — ${why}`;
}

/**
 * §3.15 — what a unit post's result says where the turn owes no reply and no unit: it may end with
 * no text. The runner appends it, since only the runner knows what the turn answers and whether a
 * person has steered it; it is never a tool's to say.
 */
export const QUIET_ENDING_CLAUSE =
  'If nothing remains to say to anyone here, end the turn with no text; if a person steers this turn first, answer them.';

/**
 * §7.1 — what a completion cut at the agent's time limit is told: nothing of it was kept, and the way
 * on is less deliberation, or no text where a hand-off leaves the turn owing nothing (§3.15)
 */
export function renderOverranRejection(limitMs: number, mayEndQuietly = false): string {
  return `output rejected: your last response ran past its ${renderTimeLimit(limitMs)} limit and nothing of it was kept — reach your next call or your reply with less deliberation${mayEndQuietly ? ', or end the turn with no text' : ''}`;
}
