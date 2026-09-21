import { match } from 'ts-pattern';

import type { InferenceFailure } from '@/inference/inference.types.ts';
import { describeTransportReason } from '@/inference/inference.utils.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';
import type { TraceMark } from '@/tools/tools.types.ts';

import type { ContextExhaustionCause } from '../turns.types.ts';

const TRACE_DETAIL_LIMIT_CHARS = 150;

const WORKING_LINE = '⏳ _working…_';

/** §3.2 — deterministic code speaking as the agent: fixed strings and templated facts only */
const OUTCOME_PHRASES: { readonly [K in Exclude<TurnStatus, 'running'>]: string } = {
  abandoned: '⚪ _abandoned — the process restarted mid-turn_',
  budget_exhausted: '⏸️ _stopped — action budget exhausted_',
  completed: '✅ _done_',
  context_exhausted: '⚠️ _stopped — ran out of context_',
  delivery_failure: '⚠️ _stopped — the chat server refused a post_',
  denied: '🛑 _stopped — a human denied an action_',
  halted: '🛑 _stopped — global halt_',
  killed: '⏹️ _killed_',
  provider_outage: '⚠️ _stopped — the model provider failed_',
  provider_rejected: '⚠️ _stopped — the model provider rejected the request_',
  semantic_error: '⚠️ _stopped — internal error_',
  side_effect_ambiguous: '⚠️ _stopped — a call timed out with its effect unconfirmed_',
  stopped: '⏹️ _stopped_'
};

function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/**
 * §8.1 — the closing line also states how long the turn ran, and who issued the command that ended
 * it (§7.5); every phrase ends in the closing underscore, which the additions go inside.
 */
function renderOutcomeLine(
  outcome: Exclude<TurnStatus, 'running'>,
  elapsedMs: number | undefined,
  abortedBy: string | undefined
): string {
  const by = abortedBy === undefined ? '' : ` by @${abortedBy}`;
  const elapsed = elapsedMs === undefined ? '' : ` (${formatDuration(elapsedMs)})`;
  return `${OUTCOME_PHRASES[outcome].slice(0, -1)}${by}${elapsed}_`;
}

function sanitizeTraceText(text: string): string {
  return text.replaceAll('`', '').replaceAll(/\s+/gu, ' ').trim();
}

/** §8.1 — a call that never ran states its subject and not its effect, however long it would have been */
function renderTraceText(line: TraceLine): string {
  if (line.kind === 'note') {
    return line.text;
  }
  return renderToolCallLine(line.toolName, line.detail, line.mark?.ran === false ? undefined : line.effect);
}

/** consecutive identical lines read as one with a count, so a loop is one line long rather than two hundred (§8.1) */
function groupTraceLines(lines: readonly TraceLine[]): { calls: number; text: string }[] {
  const groups: { calls: number; line: { mark: string | undefined; text: string } }[] = [];
  for (const line of lines) {
    const rendered = { mark: line.mark?.text, text: renderTraceText(line) };
    const last = groups.at(-1);
    if (last?.line.text === rendered.text && last.line.mark === rendered.mark) {
      last.calls += 1;
    } else {
      groups.push({ calls: 1, line: rendered });
    }
  }
  return groups.map(({ calls, line }) => ({
    calls,
    text: `${line.text}${calls > 1 ? ` ×${calls}` : ''}${line.mark === undefined ? '' : ` ${line.mark}`}`
  }));
}

/** §8.1 — what keeps the closing edit within the substrate's limit; the store has every line */
function renderElisionLine(droppedCalls: number): string {
  return `_… ${droppedCalls} earlier call${droppedCalls === 1 ? '' : 's'}; the full trace is in /collegium trace_`;
}

/**
 * §8.1 — what the status post traces: a call the turn made, or a note the framework wrote beside
 * the calls. A call is held as its parts rather than as a rendered line, because whether its effect
 * belongs on the line is known only once the call has been marked.
 */
export type TraceEntry =
  | { readonly detail?: string; readonly effect?: string; readonly kind: 'call'; readonly toolName: string }
  | { readonly kind: 'note'; readonly text: string };

/** a traced entry with the disposition it ended up with, where that was not plain success (§8.1) */
export type TraceLine = TraceEntry & { mark?: TraceMark };

export type StatusPostState = {
  /** §7.5 — who issued the stop or kill the outcome records */
  abortedBy?: string;
  /** wall-clock time the turn ran, approval waits included; absent where its end was never observed */
  elapsedMs?: number;
  outcome?: Exclude<TurnStatus, 'running'>;
  traceLines: TraceLine[];
  transientText?: string;
};

/**
 * §8.1 — the post as a whole fits the substrate's limit: trace lines go from the front, behind one
 * line that says how many, then the transient text, so an edit is always deliverable however long
 * the turn ran.
 */
export function renderStatusPost(state: StatusPostState, limitChars = Number.POSITIVE_INFINITY): string {
  const head =
    state.outcome === undefined ? WORKING_LINE : renderOutcomeLine(state.outcome, state.elapsedMs, state.abortedBy);
  const groups = groupTraceLines(state.traceLines);
  const transient =
    state.outcome === undefined && state.transientText !== undefined && state.transientText !== ''
      ? [`_${state.transientText}_`]
      : [];
  for (let dropped = 0; dropped <= groups.length; dropped += 1) {
    const droppedCalls = groups.slice(0, dropped).reduce((sum, group) => sum + group.calls, 0);
    const elision = dropped === 0 ? [] : [renderElisionLine(droppedCalls)];
    const text = [head, ...elision, ...groups.slice(dropped).map((group) => group.text), ...transient].join('\n');
    if (text.length <= limitChars) {
      return text;
    }
  }
  const allCalls = groups.reduce((sum, group) => sum + group.calls, 0);
  return [head, ...(allCalls === 0 ? [] : [renderElisionLine(allCalls)])].join('\n');
}

/**
 * §7.3 — the post a dead process left, closed from the next boot: the first line is the working
 * line by construction and the rest is kept as it was.
 */
export function renderAbandonedStatusPost(storedText: string): string {
  const [, ...rest] = storedText.split('\n');
  return [renderOutcomeLine('abandoned', undefined, undefined), ...rest].join('\n');
}

/**
 * The name, the tool's own summary of the call and what the call came to share one code span, so
 * nothing in a model-supplied argument is read as markdown. Backticks would close that span, so they
 * are dropped — the untruncated, unaltered arguments are in `/trace` (§8.1). Only the summary is
 * capped: the effect is the framework's own few words and is never what makes a line long.
 */
export function renderToolCallLine(toolName: string, detail?: string, effect?: string): string {
  const summary = detail === undefined ? '' : sanitizeTraceText(detail);
  const elided = summary.length > TRACE_DETAIL_LIMIT_CHARS ? `${summary.slice(0, TRACE_DETAIL_LIMIT_CHARS)}…` : summary;
  const parts = [toolName, elided, effect === undefined ? '' : sanitizeTraceText(effect)];
  return `→ \`${parts.filter((part) => part !== '').join(' ')}\``;
}

/** §8.1 — a tool reports what a call came to only once its body has run, so such a mark always marks a line that ran */
export function toOutcomeTraceMark(outcome: string | undefined): TraceMark | undefined {
  return outcome === undefined ? undefined : { ran: true, text: outcome };
}

/** §7.5 — the channel learns of a steer from the turn's own status post, since the command's response is ephemeral */
export function renderSteeringLine(byUsername: string): string {
  return `↩ _steered by @${byUsername}_`;
}

/** §4.4 — a discarded completion was paid for; the status post says the turn started over, and the run of lines says how often (§8.1) */
export function renderFoldLine(): string {
  return '↺ _started over to read a further post_';
}

/** §5.2 — the drain is visible even when context is not: how far back the window reached, where the earliest post waiting was older */
export function renderDrainLine(reachesBackTo: string | undefined): string {
  return reachesBackTo === undefined
    ? '↧ _the earliest post waiting is beyond what my context reaches_'
    : `↧ _my context reaches back to ${reachesBackTo}; the earliest post waiting is older_`;
}

export function renderBudgetExhaustedNotice(limit: number): string {
  return `I used all ${limit} of my action attempts and stopped.`;
}

/**
 * §5.3 — unbounded extensions, but the human in the loop is the control, and the control needs the
 * number, the calls repeated most, and the agent's own last words: a count alone was approved four
 * times into loops that had already fetched the same three pages a hundred times each.
 */
export function renderExtensionPrompt(input: {
  attemptsSoFar: number;
  extensionNumber: number;
  grant: number;
  lastWords: string | undefined;
  topCalls: readonly { count: number; line: string }[];
}): string {
  const repeated =
    input.topCalls.length === 0
      ? []
      : [`Most repeated so far: ${input.topCalls.map(({ count, line }) => `${line} ×${count}`).join('; ')}`];
  const words =
    input.lastWords === undefined
      ? 'I have written nothing since I started.'
      : `What I still need: "${input.lastWords}"`;
  return [
    `I have used all my action attempts and would like to keep going. This would be extension ${input.extensionNumber}; ${input.attemptsSoFar} attempts so far. Approving grants another ${input.grant}.`,
    ...repeated,
    words
  ].join('\n');
}

/** §7.4 — the bound on total unattended work one human post may set in motion; a fresh human post starts a fresh chain */
export function renderChainLengthLimitNotice(): string {
  return 'I would have continued with a colleague but this chain has reached its limit — someone needs to say whether to go on.';
}

/** §7.4 — enforcement is in the framework, not the prompt; the visible line is fixed by the spec */
export function renderDelegationLimitNotice(): string {
  return "I would have asked a colleague but I've reached the delegation limit — someone needs to pick this up.";
}

/** §4.5 — the turn could not produce output the framework would accept; the reason is in the trace */
export function renderOutputRefusedNotice(): string {
  return 'I could not produce a reply the framework would accept and stopped. The reason is in the trace.';
}

/** §7.1 — the turn ran out of room, not the provider; each cause names where the human should look */
export function renderContextExhaustedNotice(cause: ContextExhaustionCause): string {
  return match(cause)
    .with(
      'accumulated',
      () => 'I ran out of room in my context part-way through this turn and stopped. What I did so far is in the trace.'
    )
    .with('initial', () => {
      return "My starting context does not fit my model's window. This is a configuration problem — the context budget against the model — not something I can work around.";
    })
    .exhaustive();
}

/** §7.1 — a bare denial ends the turn and the agent asks how to proceed */
export function renderDenialNotice(): string {
  return 'That was denied, so I stopped. How would you like me to proceed?';
}

export function renderProviderOutageNotice(failure: InferenceFailure.Transport): string {
  const reason = describeTransportReason(failure);
  return `⚠️ **Error**: Failed to reach the model provider${reason === undefined ? '' : ` — ${reason}`}`;
}

/** §7.1 — the chat substrate, not the model provider, refused a post the turn had to make */
export function renderDeliveryFailureNotice(): string {
  return '⚠️ **Error**: The chat server refused a post I had to make';
}

/**
 * §3.2 — the provider's own words are not deterministic, so the post names the class of failure and
 * the status code, and the body goes to the logs. A rejected request is our bug, not an outage:
 * saying "could not be reached" would send an operator looking at the network.
 */
export function renderProviderRejectionNotice(status: number | undefined): string {
  const reason = match(status)
    .with(401, () => ' — the API key was refused')
    .with(402, () => " — the account's balance is exhausted")
    .with(403, () => ' — forbidden by a permission or moderation rule')
    .otherwise(() => '');
  const code = status === undefined ? '' : ` (HTTP ${status})`;
  return `⚠️ **Error**: The model provider rejected the request${reason}${code}`;
}

export function renderSemanticErrorNotice(detail: string): string {
  return `I hit an internal error and stopped: ${detail}`;
}

export function renderSideEffectAmbiguityNotice(toolName: string): string {
  return `My call to \`${toolName}\` timed out and I cannot confirm whether it took effect. I stopped.`;
}
