import { renderToolDisplayName } from '@collegium/core/tools';
import { match } from 'ts-pattern';

import { renderDuration } from '@/formatting/durations/duration.utils.ts';
import type { ActivationKind, ModelRow, ResultPresentation } from '@/prisma/prisma.types.ts';
import type { Turn } from '@/turns/turns.types.ts';

import { renderParkedOn } from './approvals.utils.ts';
import { COST_FORMAT, COUNT_FORMAT } from './usage.utils.ts';

import type { ParkedDecision } from './approvals.utils.ts';

/** §8.3 — what each activation was, beside the name the heading gives it */
const ACTIVATION_DESCRIPTIONS: { readonly [K in ActivationKind]: string } = {
  addressed: 'a post addressing it while it was idle',
  drain: 'its queue, as its previous turn here ended',
  handoff: 'a colleague’s turn that addressed it ending or parking',
  resync: 'posts a reconnect recovered',
  sweep: 'the boot or resume sweep of its queue',
  trigger: 'a trigger the system bot announced'
};

/** the trace is human-facing, so a structural name renders in display form (§1) */
function toDisplayName(name: PrismaJson.RecordedToolName): string {
  return typeof name === 'string' ? name : renderToolDisplayName(name);
}

/**
 * §3.6 — a revision in place names its count and what it replaced; a new record names the record it
 * replaced and whatever writing it removed, such as the memories a write evicted (§8.1)
 */
function renderRecordChange(event: Extract<PrismaJson.TurnEventPayload, { kind: 'record_written' }>): string {
  if (event.revision !== undefined) {
    const { count, replacedDescription, replacedPassages = [] } = event.revision;
    const replaced = [
      ...replacedPassages.map((passage) => `"${passage}"`),
      ...(replacedDescription === undefined ? [] : [`the description "${replacedDescription}"`])
    ];
    return `${event.reference} revised (revision ${count})${replaced.length === 0 ? '' : `, replacing ${replaced.join(', ')}`}`;
  }
  const revising = event.revisionOf === undefined ? '' : `, revising ${event.revisionOf}`;
  const removing = event.supersededDescriptions.map((description) => `"${description}"`).join(', ');
  return `${event.reference} written${revising}${removing === '' ? '' : `, removing ${removing}`}`;
}

/** §3.8 — what the model read of a result it did not read whole; the output above is always the whole of it */
function renderPresentation(presentation: ResultPresentation): string {
  const read =
    presentation.cutToChars === undefined
      ? 'the model read it whole'
      : `the model read its first ${COUNT_FORMAT.format(presentation.cutToChars)} characters`;
  return presentation.collapsed === true ? `${read}, then only its line` : read;
}

function renderResultLine(event: Extract<PrismaJson.TurnEventPayload, { kind: 'tool_result' }>): string {
  const mark = event.traceMark === undefined ? '' : ` ${event.traceMark.text}`;
  const presented = event.presentedAs === undefined ? '' : ` (${renderPresentation(event.presentedAs)})`;
  const sent = event.rawArgumentsPreview === undefined ? '' : ` (arguments as sent: ${event.rawArgumentsPreview})`;
  return `\`${toDisplayName(event.toolName)}\`${mark}${presented} → ${event.output}${sent}`;
}

function renderEventLine(payload: PrismaJson.TurnEventPayload): string {
  return match(payload)
    .with(
      { kind: 'approval_decided' },
      (event) =>
        `approval ${event.approvalId} → ${event.decision} by ${event.byUsername}${event.reason === undefined ? '' : `: ${event.reason}`}`
    )
    .with(
      { kind: 'approval_requested' },
      (event) =>
        `approval requested for \`${toDisplayName(event.toolName)}\`${event.contextText === undefined ? '' : ` (${event.contextText})`}: ${event.payloadText}`
    )
    .with(
      { kind: 'ask_answered' },
      (event) => `ask ${event.askId} answered by ${event.byUsername}: ${event.answerText}`
    )
    .with(
      { kind: 'ask_requested' },
      (event) =>
        `question asked by \`${toDisplayName(event.toolName)}\`${event.options === undefined ? '' : ` (offering ${event.options.join(', ')})`}: ${event.question}`
    )
    .with({ kind: 'assistant_message' }, (event) => {
      return event.toolCalls.length === 0
        ? `assistant: ${event.content}`
        : event.toolCalls
            .map((call) => `called \`${toDisplayName(call.toolName)}\` with ${JSON.stringify(call.args)}`)
            .join('; ');
    })
    .with(
      { kind: 'record_written' },
      (event) => `record ${renderRecordChange(event)}: ${event.description} — ${event.body}`
    )
    .with({ kind: 'output_rejected' }, (event) => `rejected output (${event.reason}): ${event.content}`)
    .with({ kind: 'steering_received' }, (event) => `steered by ${event.byUsername}: ${event.text}`)
    .with({ kind: 'tool_result' }, renderResultLine)
    .exhaustive();
}

/** §8.3 — when a moment fell, from the turn's own start */
function renderOffset(turn: Turn, moment: Date): string {
  return `+${renderDuration(moment.getTime() - turn.startedAt.getTime())}`;
}

function renderStartedLine({ formatDate, turn }: TraceInput): string {
  const activation =
    turn.activationKind === null ? '' : `, by ${turn.activationKind} (${ACTIVATION_DESCRIPTIONS[turn.activationKind]})`;
  const answering = turn.triggeringPostId === null ? '' : `, answering post \`${turn.triggeringPostId}\``;
  const drained = turn.drainedFromPostId === null ? '' : `, drained from post \`${turn.drainedFromPostId}\``;
  return `Started: ${formatDate(turn.startedAt)}${activation}${answering}${drained}.`;
}

/** a running turn's count is written only when it closes, and a restart closes a turn without one (§7.3) */
function renderRanLine({ now, turn }: TraceInput): string {
  if (turn.endedAt === null) {
    return `Running: ${renderDuration(now.getTime() - turn.startedAt.getTime())} so far.`;
  }
  const ran = renderDuration(turn.endedAt.getTime() - turn.startedAt.getTime());
  if (turn.status === 'abandoned') {
    return `Ran: ${ran}, until the process restarted.`;
  }
  return `Ran: ${ran}, ${COUNT_FORMAT.format(turn.actionCount)} action${turn.actionCount === 1 ? '' : 's'}.`;
}

function renderContextLine({ formatDate, turn }: TraceInput): string[] {
  if (turn.contextAssembledAt === null) {
    return [];
  }
  const size =
    turn.windowEstimatedTokens === null ? '' : ` of about ${COUNT_FORMAT.format(turn.windowEstimatedTokens)} tokens`;
  const reach =
    turn.windowOldestAt === null
      ? 'an empty window'
      : `a window${size} reaching back to ${formatDate(turn.windowOldestAt)}`;
  return [`Context: assembled at ${renderOffset(turn, turn.contextAssembledAt)}, ${reach}.`];
}

/** what the provider reported; the cached share is how much of the prompt its cache served (§3.8) */
function renderUsageLine(turn: Turn): string {
  if (turn.promptTokens === null || turn.completionTokens === null) {
    return 'Usage: none reported.';
  }
  const cached = turn.cachedPromptTokens === null ? '' : ` (${COUNT_FORMAT.format(turn.cachedPromptTokens)} cached)`;
  const reasoning = turn.reasoningTokens === null ? '' : ` (${COUNT_FORMAT.format(turn.reasoningTokens)} reasoning)`;
  const cost = turn.costUsd === null ? '' : `; cost ${COST_FORMAT.format(turn.costUsd)}`;
  return `Usage: ${COUNT_FORMAT.format(turn.promptTokens)} prompt tokens${cached}, ${COUNT_FORMAT.format(turn.completionTokens)} completion${reasoning}${cost}.`;
}

/** §8.3 — the turn's own record, which never enters the window: what started it, how long it ran, what it read and spent */
function renderTurnRecord(trace: TraceInput): string[] {
  return [renderStartedLine(trace), renderRanLine(trace), ...renderContextLine(trace), renderUsageLine(trace.turn)];
}

/** everything the trace is rendered from: the turn's row and events, and the reader's clock and timezone */
export type TraceInput = {
  readonly events: readonly ModelRow<'TurnEvent'>[];
  /** in the operator timezone (§3.2) */
  readonly formatDate: (date: Date) => string;
  readonly now: Date;
  readonly parked: readonly ParkedDecision[];
  readonly turn: Turn;
};

/**
 * The turn's own row leads (§8.3): a turn the provider refused at once has no events, and its row
 * is the whole story. A running turn parked on a person says so beneath it (§8.1), since its last
 * event alone cannot tell a wait from a call still in flight. Each event states when it fell.
 */
export function renderTrace(trace: TraceInput): string {
  const { events, now, parked, turn } = trace;
  const heading = `turn ${turn.id} (${turn.agentUsername} on ${turn.modelName}, ${turn.status}, depth ${turn.depth}, chain ${turn.chainLength})`;
  if (events.length === 0) {
    return [
      `${heading[0]!.toUpperCase()}${heading.slice(1)} recorded no events: no tool call, approval, or record.`,
      ...renderTurnRecord(trace)
    ].join('\n');
  }
  return [
    `Trace for ${heading}:`,
    ...renderTurnRecord(trace),
    ...parked.map((parkedOn) => `Waiting on a person: ${renderParkedOn(parkedOn, now)}`),
    ...events.map((event, index) => {
      return `${index + 1}. [${renderOffset(turn, event.createdAt)}] ${renderEventLine(event.payload)}`;
    })
  ].join('\n');
}
