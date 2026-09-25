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
