import type { ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';

/** how a §7.5 command ends a running turn — the status it will close with */
export type AbortKind = Extract<TurnStatus, 'killed' | 'stopped'>;

export type Turn = ModelRow<'Turn'>;

/** how a turn ran out of room: results it accumulated and could not retire, or a starting context that never fit (§7.1) */
export type ContextExhaustionCause = 'accumulated' | 'initial';

/** a status post a restart left mid-trace: which post, in which channel, under whose account (§7.3) */
export type AbandonedStatusPost = {
  readonly agentUsername: string;
  readonly channelId: string;
  readonly postId: string;
};

/** what a restart abandoned: how many turns, and the status posts among them left to close (§7.3) */
export type AbandonedTurns = {
  readonly count: number;
  /** most recently started first */
  readonly statusPosts: readonly AbandonedStatusPost[];
};

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

export declare namespace TurnOpenFailure {
  /** §7.4 — the chain this turn would join already holds the limit; nothing was inserted */
  type ChainFull = {
    readonly count: number;
    readonly kind: 'chain-full';
    readonly limit: number;
    readonly rootPostId: string;
  };
  type Any = ChainFull;
}

export type TurnOpenFailure = TurnOpenFailure.Any;

/** what activation branches on when a turn ends: drain the queue, or leave it standing (§7.1) */
export type TurnOutcome = {
  readonly status: Exclude<TurnStatus, 'running'>;
  readonly turnId: string;
};

/** the payload union is the source of truth; `appendEvent` derives the `kind` column from it */
export type TurnEventInput = PrismaJson.TurnEventPayload;
