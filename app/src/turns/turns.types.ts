import type { ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';

/** how a §7.5 command ends a running turn — the status it will close with */
export type AbortKind = Extract<TurnStatus, 'killed' | 'stopped'>;

export type Turn = ModelRow<'Turn'>;

/** a breakdown some providers leave out, summed over the turns that reported it */
export type ReportedTokenCount = { coverage: 'full' | 'partial'; total: number } | { coverage: 'none' };

export type TokenUsageTotals = {
  readonly cachedPromptTokens: ReportedTokenCount;
  readonly completionTokens: number;
  readonly promptTokens: number;
  readonly reasoningTokens: ReportedTokenCount;
  readonly turnCount: number;
};

/** one agent's spend on one model, over the turns that recorded usage */
export type TokenUsageSummary = TokenUsageTotals & {
  readonly agentUsername: string;
  readonly modelName: string;
};

export type TokenUsageReport = {
  readonly rows: readonly TokenUsageSummary[];
  readonly total: TokenUsageTotals;
};

/** what activation branches on when a turn ends: drain the queue, or leave it standing (§7.1) */
export type TurnOutcome = {
  readonly status: Exclude<TurnStatus, 'running'>;
  readonly turnId: string;
};

/** the payload union is the source of truth; `appendEvent` derives the `kind` column from it */
export type TurnEventInput = PrismaJson.TurnEventPayload;
