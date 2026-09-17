import type { HaltReason } from '@/halt/halt.types.ts';
import type { Downtime } from '@/runtime/runtime.types.ts';

export declare namespace SystemEvent {
  /** the §7.4 stop, posted prominently in the main channel; only /resume clears it */
  type Halt = {
    kind: 'halt';
    reason: HaltReason;
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
  /** the one §7.3 boot notice: the downtime window, and that in-flight work was abandoned */
  type Online = {
    abandonedTurns: number;
    agentUsernames: string[];
    downtime: Downtime | undefined;
    kind: 'online';
  };

  type Any = Halt | MultiMentionRefusal | Offline | Online;
}

export type SystemEvent = SystemEvent.Any;
