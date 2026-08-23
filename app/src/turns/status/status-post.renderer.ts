import type { TurnStatus } from '@/prisma/prisma.types.ts';

const DISCLOSURE_BODY_LIMIT_CHARS = 120;

const TRACE_DETAIL_LIMIT_CHARS = 150;

const WORKING_LINE = '⏳ _working…_';

/** §3.2 — deterministic code speaking as the agent: fixed strings and templated facts only */
const OUTCOME_LINES: { readonly [K in Exclude<TurnStatus, 'running'>]: string } = {
  abandoned: '⚪ _abandoned — the process restarted mid-turn_',
  budget_exhausted: '⏸️ _stopped — action budget exhausted_',
  completed: '✅ _done_',
  denied: '🛑 _stopped — a human denied an action_',
  halted: '🛑 _stopped — global halt_',
  killed: '⏹️ _killed_',
  provider_outage: '⚠️ _stopped — the model provider failed_',
  semantic_error: '⚠️ _stopped — internal error_',
  side_effect_ambiguous: '⚠️ _stopped — a call timed out with its effect unconfirmed_',
  stopped: '⏹️ _stopped_'
};

export type StatusPostState = {
  outcome?: Exclude<TurnStatus, 'running'>;
  traceLines: string[];
  transientText?: string;
};

export function renderStatusPost(state: StatusPostState): string {
  const lines = [state.outcome === undefined ? WORKING_LINE : OUTCOME_LINES[state.outcome], ...state.traceLines];
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

/** §5.2 — the 👀 must never silently promise a read that did not happen */
export function renderContextShortfallLine(): string {
  return '⚠️ _context could not reach back to the earliest queued message_';
}

export function renderBudgetExhaustedNotice(limit: number): string {
  return `I used all ${limit} of my action attempts and stopped.`;
}

/** §5.3 — unbounded extensions, but the human in the loop is the control and the control needs the number */
export function renderExtensionPrompt(input: { attemptsSoFar: number; extensionNumber: number }): string {
  return `I have used all my action attempts and would like to keep going. This would be extension ${input.extensionNumber}; ${input.attemptsSoFar} attempts so far. Approving grants another ten.`;
}

/** §7.4 — enforcement is in the framework, not the prompt; the visible line is fixed by the spec */
export function renderDelegationLimitNotice(): string {
  return "I would have asked a colleague but I've reached the delegation limit — someone needs to pick this up.";
}

/** §7.1 — a bare denial ends the turn and the agent asks how to proceed */
export function renderDenialNotice(): string {
  return 'That was denied, so I stopped. How would you like me to proceed?';
}

/** §3.6 — the line may elide a long body; the TurnEvent behind it must not */
export function renderRecordWriteLine(input: { body: string; description: string }): string {
  const body =
    input.body.length > DISCLOSURE_BODY_LIMIT_CHARS
      ? `${input.body.slice(0, DISCLOSURE_BODY_LIMIT_CHARS)}…`
      : input.body;
  return `📝 _recorded: ${input.description} — ${body}_`;
}

/** §3.6 — a superseded record is disclosed beside the write that displaced it */
export function renderSupersededLine(description: string): string {
  return `♻️ _superseded: ${description}_`;
}

export function renderProviderOutageNotice(): string {
  return '⚠️ **Error**: Failed to reach the model provider';
}

/**
 * §3.2 — the provider's own words are not deterministic, so the post names the class of failure and
 * the status code, and the body goes to the logs. A rejected request is our bug, not an outage:
 * saying "could not be reached" would send an operator looking at the network.
 */
export function renderProviderRejectionNotice(status: number | undefined): string {
  const code = status === undefined ? '' : ` (HTTP ${status})`;
  return `⚠️ **Error**: The model provider rejected the request${code}`;
}

export function renderSemanticErrorNotice(detail: string): string {
  return `I hit an internal error and stopped: ${detail}`;
}

export function renderSideEffectAmbiguityNotice(toolName: string): string {
  return `My call to \`${toolName}\` timed out and I cannot confirm whether it took effect. I stopped.`;
}
