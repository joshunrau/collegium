import type { ReportedTokenCount, TokenUsageReport, TokenUsageTotals } from '@/turns/turns.types.ts';

const PARTIAL_MARKER = '*';

const TOKEN_COUNT_FORMAT = new Intl.NumberFormat('en-US');

function renderRow(agent: string, model: string, totals: TokenUsageTotals): string {
  const cells = [
    agent,
    model,
    TOKEN_COUNT_FORMAT.format(totals.turnCount),
    TOKEN_COUNT_FORMAT.format(totals.promptTokens),
    renderReportedTokenCount(totals.cachedPromptTokens),
    TOKEN_COUNT_FORMAT.format(totals.completionTokens),
    renderReportedTokenCount(totals.reasoningTokens)
  ];
  return `| ${cells.join(' | ')} |`;
}

function renderReportedTokenCount(count: ReportedTokenCount): string {
  if (count.coverage === 'none') {
    return '—';
  }
  const total = TOKEN_COUNT_FORMAT.format(count.total);
  return count.coverage === 'partial' ? `${total}${PARTIAL_MARKER}` : total;
}

export const USAGE_WINDOW_HOURS = 24;

export function renderUsageResponse(report: TokenUsageReport): string {
  const heading = `Token usage — turns ended in the last ${USAGE_WINDOW_HOURS} hours`;
  if (report.rows.length === 0) {
    return `${heading}: none recorded.`;
  }
  const isAnyPartial = [...report.rows, report.total].some(
    (totals) => totals.cachedPromptTokens.coverage === 'partial' || totals.reasoningTokens.coverage === 'partial'
  );
  return [
    heading,
    '',
    '| Agent | Model | Turns | Prompt | Cached | Completion | Reasoning |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.rows.map((row) => renderRow(row.agentUsername, row.modelName, row)),
    renderRow('**Total**', '', report.total),
    ...(isAnyPartial ? ['', `${PARTIAL_MARKER} Not reported by every turn in the row.`] : [])
  ].join('\n');
}
