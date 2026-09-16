import type { ReportedTotal, UsageReport, UsageTotals } from '@/turns/turns.types.ts';

const PARTIAL_MARKER = '*';

const COST_FORMAT = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: 'currency'
});

const TOKEN_COUNT_FORMAT = new Intl.NumberFormat('en-US');

function renderRow(agent: string, model: string, totals: UsageTotals): string {
  const cells = [
    agent,
    model,
    TOKEN_COUNT_FORMAT.format(totals.turnCount),
    TOKEN_COUNT_FORMAT.format(totals.promptTokens),
    renderReportedTotal(totals.cachedPromptTokens, TOKEN_COUNT_FORMAT),
    TOKEN_COUNT_FORMAT.format(totals.completionTokens),
    renderReportedTotal(totals.reasoningTokens, TOKEN_COUNT_FORMAT),
    renderReportedTotal(totals.costUsd, COST_FORMAT)
  ];
  return `| ${cells.join(' | ')} |`;
}

function renderReportedTotal(reported: ReportedTotal, format: Intl.NumberFormat): string {
  if (reported.coverage === 'none') {
    return '—';
  }
  const total = format.format(reported.total);
  return reported.coverage === 'partial' ? `${total}${PARTIAL_MARKER}` : total;
}

export const USAGE_WINDOW_HOURS = 24;

export function renderUsageResponse(report: UsageReport): string {
  const heading = `Usage — turns ended in the last ${USAGE_WINDOW_HOURS} hours`;
  if (report.rows.length === 0) {
    return `${heading}: none recorded.`;
  }
  const isAnyPartial = [...report.rows, report.total].some((totals) => {
    return [totals.cachedPromptTokens, totals.costUsd, totals.reasoningTokens].some(
      (reported) => reported.coverage === 'partial'
    );
  });
  return [
    heading,
    '',
    '| Agent | Model | Turns | Prompt | Cached | Completion | Reasoning | Cost |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.rows.map((row) => renderRow(row.agentUsername, row.modelName, row)),
    renderRow('**Total**', '', report.total),
    ...(isAnyPartial ? ['', `${PARTIAL_MARKER} Not reported by every turn in the row.`] : [])
  ].join('\n');
}
