import type { ToolDisclosure } from '@collegium/core/tools';

import type { TurnStatus } from '@/prisma/prisma.types.ts';

export declare namespace ToolAttempt {
  /** the model receives this as the tool result and the turn continues */
  type Continue = {
    /** a durable record the call created, for the turn to write into the event trail and trace (§3) */
    disclosure?: ToolDisclosure;
    kind: 'continue';
    output: string;
  };
  /**
   * The turn ends with this status: a §7.1 semantic error, an unconfirmed mutation (§7.2), a §5.4
   * bare denial, an undeliverable prompt, or a §7.5 cancellation reaching the parked turn.
   */
  type Terminal = {
    detail: string;
    kind: 'terminal';
    status: Exclude<TurnStatus, 'abandoned' | 'budget_exhausted' | 'completed' | 'running'>;
  };
  type Any = Continue | Terminal;
}

export type ToolAttempt = ToolAttempt.Any;
