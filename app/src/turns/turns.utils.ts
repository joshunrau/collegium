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
