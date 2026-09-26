import type { ToolId } from '@collegium/core/tools';

import type { CompletionUsage } from '@/inference/inference.types.ts';

import type { ReportedTotal, UsageTotals } from './turns.types.ts';

function sumReportedTotals(totals: readonly ReportedTotal[]): ReportedTotal {
  if (totals.every((each) => each.coverage === 'none')) {
    return { coverage: 'none' };
  }
  return {
    coverage: totals.every((each) => each.coverage === 'full') ? 'full' : 'partial',
    total: totals.reduce((sum, each) => sum + (each.coverage === 'none' ? 0 : each.total), 0)
  };
}

export function sumUsageTotals(totals: readonly UsageTotals[]): UsageTotals {
  return {
    cachedPromptTokens: sumReportedTotals(totals.map((each) => each.cachedPromptTokens)),
    completionTokens: totals.reduce((sum, each) => sum + each.completionTokens, 0),
    costUsd: sumReportedTotals(totals.map((each) => each.costUsd)),
    promptTokens: totals.reduce((sum, each) => sum + each.promptTokens, 0),
    reasoningTokens: sumReportedTotals(totals.map((each) => each.reasoningTokens)),
    turnCount: totals.reduce((sum, each) => sum + each.turnCount, 0)
  };
}

export function toReportedTotal(total: null | number, reportingTurnCount: number, turnCount: number): ReportedTotal {
  if (reportingTurnCount === 0) {
    return { coverage: 'none' };
  }
  return { coverage: reportingTurnCount === turnCount ? 'full' : 'partial', total: total ?? 0 };
}

/** §8.2 — the turn row's usage columns for a running or final total; a figure the provider did not report is null, never zero */
export function toUsageColumns(usage: CompletionUsage) {
  return {
    cachedPromptTokens: usage.cachedPromptTokens ?? null,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd ?? null,
    promptTokens: usage.promptTokens,
    reasoningTokens: usage.reasoningTokens ?? null
  };
}

/**
 * §7.3 — what a restart reads off an abandoned turn's events. It had effects if it wrote a final
 * reply, parked on a person, or issued a call that may have run and is not safe to repeat: a call
 * whose result says it never ran does not count, and neither does a name that resolved to no tool.
 * It made a completion if any came back, the one way a call could have taken the process down.
 */
export function readAbandonment(
  events: readonly PrismaJson.TurnEventPayload[],
  isSafeToRepeat: (toolId: ToolId) => boolean
): { readonly hadEffects: boolean; readonly madeCompletion: boolean } {
  const notRun = new Set(
    events.flatMap((event) => (event.kind === 'tool_result' && event.traceMark?.ran === false ? [event.callId] : []))
  );
  const hadEffects = events.some((event) => {
    if (event.kind === 'approval_requested' || event.kind === 'ask_requested') {
      return true;
    }
    if (event.kind !== 'assistant_message') {
      return false;
    }
    return (
      event.toolCalls.length === 0 ||
      event.toolCalls.some(({ callId, toolName }) => {
        return typeof toolName !== 'string' && !notRun.has(callId) && !isSafeToRepeat(toolName);
      })
    );
  });
  const madeCompletion = events.some((event) => event.kind === 'assistant_message' || event.kind === 'output_rejected');
  return { hadEffects, madeCompletion };
}
