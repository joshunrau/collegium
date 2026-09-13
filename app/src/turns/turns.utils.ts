import type { ReportedTokenCount, TokenUsageTotals } from './turns.types.ts';

function sumReportedTokenCounts(counts: readonly ReportedTokenCount[]): ReportedTokenCount {
  if (counts.every((count) => count.coverage === 'none')) {
    return { coverage: 'none' };
  }
  return {
    coverage: counts.every((count) => count.coverage === 'full') ? 'full' : 'partial',
    total: counts.reduce((sum, count) => sum + (count.coverage === 'none' ? 0 : count.total), 0)
  };
}

export function sumTokenUsageTotals(totals: readonly TokenUsageTotals[]): TokenUsageTotals {
  return {
    cachedPromptTokens: sumReportedTokenCounts(totals.map((each) => each.cachedPromptTokens)),
    completionTokens: totals.reduce((sum, each) => sum + each.completionTokens, 0),
    promptTokens: totals.reduce((sum, each) => sum + each.promptTokens, 0),
    reasoningTokens: sumReportedTokenCounts(totals.map((each) => each.reasoningTokens)),
    turnCount: totals.reduce((sum, each) => sum + each.turnCount, 0)
  };
}

export function toReportedTokenCount(
  total: null | number,
  reportingTurnCount: number,
  turnCount: number
): ReportedTokenCount {
  if (reportingTurnCount === 0) {
    return { coverage: 'none' };
  }
  return { coverage: reportingTurnCount === turnCount ? 'full' : 'partial', total: total ?? 0 };
}
