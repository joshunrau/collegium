import { match } from 'ts-pattern';

import type { ModelRow } from '@/prisma/prisma.types.ts';

function renderEventLine(payload: PrismaJson.TurnEventPayload): string {
  return match(payload)
    .with(
      { kind: 'approval_decided' },
      (event) =>
        `approval ${event.approvalId} → ${event.decision} by ${event.byUsername}${event.reason === undefined ? '' : `: ${event.reason}`}`
    )
    .with(
      { kind: 'approval_requested' },
      (event) => `approval requested for \`${event.toolName}\`: ${event.payloadText}`
    )
    .with({ kind: 'assistant_message' }, (event) =>
      event.toolCalls.length === 0
        ? `assistant: ${event.content}`
        : event.toolCalls.map((call) => `called \`${call.toolName}\` with ${JSON.stringify(call.args)}`).join('; ')
    )
    .with(
      { kind: 'memory_written' },
      (event) => `memory ${event.memoryId} written: ${event.description} — ${event.body}`
    )
    .with({ kind: 'tool_result' }, (event) => `\`${event.toolName}\` → ${event.output}`)
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
