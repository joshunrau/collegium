import type { HaltReason } from '@/halt/halt.types.ts';
import type { Downtime } from '@/runtime/runtime.types.ts';

export declare namespace SystemEvent {
  /** §7.4 — a mention that would have opened a turn past the chain limit; no turn was opened */
  type ChainLimitRefusal = {
    agentUsername: string;
    channelId: string;
    kind: 'chain-limit-refusal';
    limit: number;
  };
  /** the §7.4 stop, posted prominently in the main channel; only /resume clears it */
  type Halt = {
    kind: 'halt';
    reason: HaltReason;
  };
  /** §7.6 — how long the turn has gone since it started or last waited on a person */
  type LongTurn = {
    agentUsername: string;
    channelId: string;
    heldMs: number;
    kind: 'long-turn';
  };
  /** the §4.5 correction — a mechanical string in the offending post's own channel */
  type MultiMentionRefusal = {
    channelId: string;
    kind: 'multi-mention-refusal';
  };
  type Offline = {
    kind: 'offline';
    reason: 'crash' | 'shutdown';
  };
  /** the one §7.3 boot notice: the downtime window, that in-flight work was abandoned, and how much was queued again */
  type Online = {
    abandonedTurns: number;
    agentUsernames: string[];
    downtime: Downtime | undefined;
    kind: 'online';
    requeuedTurns: number;
  };
  /** §7.6 — a queue entry with no turn of the agent's own running in its channel */
  type StandingQueue = {
    agentUsername: string;
    channelId: string;
    kind: 'standing-queue';
  };
  /** the §7.6 notices: the system bot's where it is present, the agent's own account in a DM */
  type Stall = LongTurn | StandingQueue;

  type Any = ChainLimitRefusal | Halt | MultiMentionRefusal | Offline | Online | Stall;
}

export type SystemEvent = SystemEvent.Any;
