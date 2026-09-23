import { renderDuration } from '@/formatting/durations/duration.utils.ts';
import type { CompletionUsage } from '@/inference/inference.types.ts';
import type { ActivationKind, TurnStatus } from '@/prisma/prisma.types.ts';

/** what a turn was opened on, as its opening log line names it */
type OpenedTurn = {
  readonly activationKind: ActivationKind;
  readonly agentUsername: string;
  readonly chainLength: number;
  readonly channelId: string;
  readonly depth: number;
  readonly drainedFromPostId?: string;
  readonly triggeringPostId?: string;
  readonly turnId: string;
};

/** how a turn ended, as its closing log line names it */
type ClosedTurn = {
  readonly actionCount: number;
  readonly agentUsername: string;
  readonly channelId: string;
  readonly elapsedMs: number;
  readonly status: Exclude<TurnStatus, 'running'>;
  readonly turnId: string;
  readonly usage: CompletionUsage | undefined;
};

function renderUsage(usage: CompletionUsage | undefined): string {
  if (usage === undefined) {
    return 'no usage reported';
  }
  const cached = usage.cachedPromptTokens === undefined ? '' : ` (${usage.cachedPromptTokens} cached)`;
  return `${usage.promptTokens} prompt tokens${cached}, ${usage.completionTokens} completion`;
}

/** why the turn started, in one log line an operator can follow a drain by */
export function renderTurnOpenedLog(turn: OpenedTurn): string {
  const answering = turn.triggeringPostId === undefined ? '' : `, answering post ${turn.triggeringPostId}`;
  const draining = turn.drainedFromPostId === undefined ? '' : `, draining from post ${turn.drainedFromPostId}`;
  return `opened turn ${turn.turnId} for "${turn.agentUsername}" in ${turn.channelId} by ${turn.activationKind}${answering}${draining} (depth ${turn.depth}, chain ${turn.chainLength})`;
}

export function renderTurnClosedLog(turn: ClosedTurn): string {
  return `closed turn ${turn.turnId} for "${turn.agentUsername}" in ${turn.channelId} as ${turn.status} after ${renderDuration(turn.elapsedMs)}: ${turn.actionCount} actions, ${renderUsage(turn.usage)}`;
}
