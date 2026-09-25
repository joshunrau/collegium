import type { EstimatedSpend, ReportedTotal, UsageReport, UsageTotals } from '@/turns/turns.types.ts';

const PARTIAL_MARKER = '*';

const COST_FORMAT = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: 'currency'
});

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

function renderRow(agent: string, model: string, totals: UsageTotals): string {
  const cells = [
    agent,
    model,
    COUNT_FORMAT.format(totals.turnCount),
    COUNT_FORMAT.format(totals.promptTokens),
    renderReportedTotal(totals.cachedPromptTokens, COUNT_FORMAT),
    COUNT_FORMAT.format(totals.completionTokens),
    renderReportedTotal(totals.reasoningTokens, COUNT_FORMAT),
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

/** §8.2 — the spend the provider reported nothing of, said apart from the table so no total counts it */
function renderEstimates({ completions, tokens }: EstimatedSpend): string[] {
  if (completions === 0) {
    return [];
  }
  const cut = `${COUNT_FORMAT.format(completions)} completion${completions === 1 ? '' : 's'} cut at the time limit or by a steer`;
  return ['', `${cut}, about ${COUNT_FORMAT.format(tokens)} tokens not reported by the provider.`];
}

export const USAGE_WINDOW_HOURS = 24;

export function renderUsageResponse(report: UsageReport, estimates: EstimatedSpend): string {
  const heading = `Usage — turns ended in the last ${USAGE_WINDOW_HOURS} hours`;
  if (report.rows.length === 0) {
    return [`${heading}: none recorded.`, ...renderEstimates(estimates)].join('\n');
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
    ...(isAnyPartial ? ['', `${PARTIAL_MARKER} Not reported by every turn in the row.`] : []),
    ...renderEstimates(estimates)
  ].join('\n');
}

export { COST_FORMAT, COUNT_FORMAT };
