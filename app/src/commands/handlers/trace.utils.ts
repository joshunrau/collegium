import { renderToolDisplayName } from '@collegium/core/tools';
import { match } from 'ts-pattern';

import type { ModelRow } from '@/prisma/prisma.types.ts';

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
      (event) => `approval requested for \`${toDisplayName(event.toolName)}\`: ${event.payloadText}`
    )
    .with({ kind: 'assistant_message' }, (event) =>
      event.toolCalls.length === 0
        ? `assistant: ${event.content}`
        : event.toolCalls
            .map((call) => `called \`${toDisplayName(call.toolName)}\` with ${JSON.stringify(call.args)}`)
            .join('; ')
    )
    .with(
      { kind: 'record_written' },
      (event) => `record ${event.reference} written: ${event.description} — ${event.body}`
    )
    .with({ kind: 'tool_result' }, (event) => `\`${toDisplayName(event.toolName)}\` → ${event.output}`)
    .exhaustive();
}

export function renderTrace(turnId: string, events: ModelRow<'TurnEvent'>[]): string {
  if (events.length === 0) {
    return `Turn ${turnId} recorded no events.`;
  }
  return [
    `Trace for turn ${turnId}:`,
    ...events.map((event, index) => `${index + 1}. ${renderEventLine(event.payload)}`)
  ].join('\n');
}
