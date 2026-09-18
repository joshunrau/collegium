import { match } from 'ts-pattern';

import type { InferenceFailure } from '@/inference/inference.types.ts';
import { describeTransportReason } from '@/inference/inference.utils.ts';
import type { TurnStatus } from '@/prisma/prisma.types.ts';

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

/** §8.1 — the closing line also states how long the turn ran; every phrase ends in the closing underscore */
function renderOutcomeLine(outcome: Exclude<TurnStatus, 'running'>, elapsedMs: number | undefined): string {
  const phrase = OUTCOME_PHRASES[outcome];
  return elapsedMs === undefined ? phrase : `${phrase.slice(0, -1)} (${formatDuration(elapsedMs)})_`;
}

export type StatusPostState = {
  /** wall-clock time the turn ran, approval waits included; absent where its end was never observed */
  elapsedMs?: number;
  outcome?: Exclude<TurnStatus, 'running'>;
  traceLines: string[];
  transientText?: string;
};

export function renderStatusPost(state: StatusPostState): string {
  const lines = [
    state.outcome === undefined ? WORKING_LINE : renderOutcomeLine(state.outcome, state.elapsedMs),
    ...state.traceLines
  ];
  if (state.outcome === undefined && state.transientText !== undefined && state.transientText !== '') {
    lines.push(`_${state.transientText}_`);
  }
  return lines.join('\n');
}

/**
 * The name and the tool's own summary of the call share one code span, so nothing in a model-supplied
 * argument is read as markdown. Backticks would close that span, so they are dropped — the
 * untruncated, unaltered arguments are in `/trace` (§8.1).
 */
export function renderToolCallLine(toolName: string, detail?: string): string {
  const summary = detail === undefined ? '' : detail.replaceAll('`', '').replaceAll(/\s+/gu, ' ').trim();
  if (summary === '') {
    return `→ \`${toolName}\``;
  }
  const elided = summary.length > TRACE_DETAIL_LIMIT_CHARS ? `${summary.slice(0, TRACE_DETAIL_LIMIT_CHARS)}…` : summary;
  return `→ \`${toolName} ${elided}\``;
}

/** §7.5 — the channel learns of a steer from the turn's own status post, since the command's response is ephemeral */
export function renderSteeringLine(byUsername: string): string {
  return `↩ _steered by @${byUsername}_`;
}

/** §5.2 — the 👀 must never silently promise a read that did not happen */
export function renderContextShortfallLine(): string {
  return '⚠️ _context could not reach back to the earliest queued message_';
}

export function renderBudgetExhaustedNotice(limit: number): string {
  return `I used all ${limit} of my action attempts and stopped.`;
}

/** §5.3 — unbounded extensions, but the human in the loop is the control and the control needs the number */
export function renderExtensionPrompt(input: {
  attemptsSoFar: number;
  extensionNumber: number;
  grant: number;
}): string {
  return `I have used all my action attempts and would like to keep going. This would be extension ${input.extensionNumber}; ${input.attemptsSoFar} attempts so far. Approving grants another ${input.grant}.`;
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

/** §7.1 — appended to a failure notice, keyed by the framework's display names and never model text (§3.2) */
export function renderMayHaveTakenEffectLine(callCounts: ReadonlyMap<string, number>): string {
  const calls = Array.from(callCounts, ([displayName, count]) => {
    return count === 1 ? `\`${displayName}\`` : `\`${displayName}\` ×${count}`;
  }).join(', ');
  const total = Array.from(callCounts.values()).reduce((sum, count) => sum + count, 0);
  return total === 1
    ? `Before stopping, this call completed and may have changed something: ${calls}. Check its effect before running this again.`
    : `Before stopping, these calls completed and may have changed something: ${calls}. Check their effects before running this again.`;
}

export function renderSemanticErrorNotice(detail: string): string {
  return `I hit an internal error and stopped: ${detail}`;
}

export function renderSideEffectAmbiguityNotice(toolName: string): string {
  return `My call to \`${toolName}\` timed out and I cannot confirm whether it took effect. I stopped.`;
}
