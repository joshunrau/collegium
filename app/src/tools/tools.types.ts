import type { ToolDisclosure, ToolPost } from '@collegium/core/tools';

import type { TurnStatus } from '@/prisma/prisma.types.ts';

export declare namespace ToolAttempt {
  /** the model receives this as the tool result and the turn continues */
  type Continue = {
    /** a durable record the call created, for the turn to write into the event trail and trace (§3) */
    disclosure?: ToolDisclosure;
    kind: 'continue';
    /** §7.1 — the body of a tool not declared retryable ran to completion, so a failure post names the call */
    mayHaveTakenEffect?: true;
    output: string;
    /** §3.15 — published under the agent's account by the runner, never by the tool (§3.3) */
    post?: ToolPost;
    /** §3.7 — the person's words this attempt came to, which the next approval prompt for the tool names */
    reasonedDenial?: { byUsername: string; reason: string };
    /** the line later turns replay in place of the output, owned by the tool (§3.8) */
    replay?: string;
    /** what the output was, from which the framework renders the in-turn and later-turn lines (§3.8) */
    replaySubject?: string;
    /** §8.1 — the call's disposition for its status-post line, where it was not plain success */
    traceMark?: string;
    /** §8.1 — what the call came to, from the tool, for its status-post line */
    traceOutcome?: string;
  };
  /**
   * The turn ends with this status: a §7.1 semantic error, an unconfirmed mutation (§7.2), a §5.4
   * bare denial, an undeliverable prompt, or a §7.5 cancellation reaching the parked turn.
   */
  type Terminal = {
    detail: string;
    kind: 'terminal';
    status: Exclude<
      TurnStatus,
      | 'abandoned'
      | 'budget_exhausted'
      | 'completed'
      | 'context_exhausted'
      | 'provider_outage'
      | 'provider_rejected'
      | 'running'
    >;
  };
  /** §7.2 — the call named no tool the agent holds and did not run; the model reads what it can call instead */
  type UnknownTool = {
    kind: 'unknown-tool';
    output: string;
  };
  type Any = Continue | Terminal | UnknownTool;
}

export type ToolAttempt = ToolAttempt.Any;
