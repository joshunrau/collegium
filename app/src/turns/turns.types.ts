import type { ModelRow, TurnStatus } from '@/prisma/prisma.types.ts';

/** how a §7.5 command ends a running turn — the status it will close with */
export type AbortKind = Extract<TurnStatus, 'killed' | 'stopped'>;

/** §7.5 — a command's request to end a running turn: the status it will close with, and who asked */
export type Abort = {
  readonly byUsername: string;
  readonly kind: AbortKind;
};

/** §7.5 — one human sentence handed to a running turn, read before its next completion */
export type Steering = {
  readonly byUsername: string;
  readonly text: string;
};

export type Turn = ModelRow<'Turn'>;

/** how a turn ran out of room: results it accumulated and could not retire, or a starting context that never fit (§7.1) */
export type ContextExhaustionCause = 'accumulated' | 'initial';

/**
 * §3.15, §8.1 — how a completed turn that handed work on or left a unit open ended: at its ceiling,
 * with no reply, at a second overrun, at the unit post that asked to end it, or with a reply
 */
export type TurnEnding = 'at-ceiling' | 'at-unit-post' | 'no-reply' | 'overran' | 'reply';

/** a status post a restart left mid-trace: which post, in which channel, under whose account (§7.3) */
export type AbandonedStatusPost = {
  readonly agentUsername: string;
  readonly channelId: string;
  readonly postId: string;
};

/** an abandoned turn that had effects, which nothing runs again, and the post that started it where one did (§7.3) */
export type TurnWithEffects = {
  readonly agentUsername: string;
  readonly channelId: string;
  readonly triggeringPostId: string | undefined;
  /** whose stamp marks the queue rows it took (§5.2) */
  readonly turnId: string;
};

/** §7.3 — an abandoned turn that had no effects, which a restart runs again */
export type TurnWithoutEffects = TurnWithEffects & {
  /** whether a completion came back, the one way its calls could have taken the process down */
  readonly madeCompletion: boolean;
};

/** a turn a restart abandoned, whatever it had done (§7.3) */
export type AbandonedTurn = {
  readonly agentUsername: string;
  readonly channelId: string;
  readonly turnId: string;
};

/** what a restart abandoned: every turn, the status posts among them left to close, and those that had effects and had none (§7.3) */
export type AbandonedTurns = {
  /** most recently started first */
  readonly statusPosts: readonly AbandonedStatusPost[];
  readonly turns: readonly AbandonedTurn[];
  readonly withEffects: readonly TurnWithEffects[];
  readonly withoutEffects: readonly TurnWithoutEffects[];
};

/** §5.2 — the colleague a turn's posts addressed, and each of those posts since the turn last stopped acting */
export type DeferredHandoff = {
  readonly addresseeUsername: string;
  readonly postIds: readonly string[];
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

/** §8.3 — the window one context assembly read, as the turn's row records it */
export type AssembledWindowRecord = {
  readonly assembledAt: Date;
  /** what the window's budget charged for it (§3.8) */
  readonly estimatedTokens: number;
  /** undefined for an empty window */
  readonly oldestAt: Date | undefined;
};

/** what activation branches on when a turn ends: consume what it took from the queue, or return it (§5.2, §7.1) */
export type TurnOutcome = {
  readonly status: Exclude<TurnStatus, 'running'>;
  /** whose stamp marks the queue rows the turn took (§5.2) */
  readonly turnId: string;
};

/** the payload union is the source of truth; `appendEvent` derives the `kind` column from it */
export type TurnEventInput = PrismaJson.TurnEventPayload;

/** §8.2 — completions the provider reported nothing of, since the framework cut them short, and what their events estimate */
export type EstimatedSpend = {
  readonly completions: number;
  readonly tokens: number;
};
