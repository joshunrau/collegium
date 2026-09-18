import { renderToolDisplayName } from '@collegium/core/tools';
import { match } from 'ts-pattern';

import type { ModelRow } from '@/prisma/prisma.types.ts';
import type { Turn } from '@/turns/turns.types.ts';

/** the trace is human-facing, so a structural name renders in display form (§1) */
function toDisplayName(name: PrismaJson.RecordedToolName): string {
  return typeof name === 'string' ? name : renderToolDisplayName(name);
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
      (event) => `record ${event.reference} written: ${event.description} — ${event.body}`
    )
    .with({ kind: 'steering_received' }, (event) => `steered by ${event.byUsername}: ${event.text}`)
    .with({ kind: 'tool_result' }, (event) => {
      const sent = event.rawArgumentsPreview === undefined ? '' : ` (arguments as sent: ${event.rawArgumentsPreview})`;
      return `\`${toDisplayName(event.toolName)}\` → ${event.output}${sent}`;
    })
    .exhaustive();
}

/** the turn's own row leads: a failed or tool-less turn has no events, and its status is the whole story */
export function renderTrace(turn: Turn, events: ModelRow<'TurnEvent'>[]): string {
  const heading = `turn ${turn.id} (${turn.agentUsername} on ${turn.modelName}, ${turn.status}, depth ${turn.depth}, chain ${turn.chainLength})`;
  if (events.length === 0) {
    return `${heading[0]!.toUpperCase()}${heading.slice(1)} recorded no events: no tool call, approval, or record.`;
  }
  return [
    `Trace for ${heading}:`,
    ...events.map((event, index) => `${index + 1}. ${renderEventLine(event.payload)}`)
  ].join('\n');
}
