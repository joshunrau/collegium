import type { ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';

/** how a §7.5 command ends a running turn — the status it will close with */
export type AbortKind = Extract<TurnStatus, 'killed' | 'stopped'>;

export type Turn = ModelRow<'Turn'>;

/** an amount some providers leave out, summed over the turns that reported it */
export type ReportedTotal = { coverage: 'full' | 'partial'; total: number } | { coverage: 'none' };

export type UsageTotals = {
  readonly cachedPromptTokens: ReportedTotal;
  readonly completionTokens: number;
  /** USD, not tokens */
  readonly costUsd: ReportedTotal;
  readonly promptTokens: number;
  readonly reasoningTokens: ReportedTotal;
  readonly turnCount: number;
};

/** one agent's spend on one model, over the turns that recorded usage */
export type UsageSummary = UsageTotals & {
  readonly agentUsername: string;
  readonly modelName: string;
};

export type UsageReport = {
  readonly rows: readonly UsageSummary[];
  readonly total: UsageTotals;
};

/** what activation branches on when a turn ends: drain the queue, or leave it standing (§7.1) */
export type TurnOutcome = {
  readonly status: Exclude<TurnStatus, 'running'>;
  readonly turnId: string;
};

/** the payload union is the source of truth; `appendEvent` derives the `kind` column from it */
export type TurnEventInput = PrismaJson.TurnEventPayload;
