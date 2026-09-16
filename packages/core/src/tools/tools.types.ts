import type { Promisable } from 'type-fest';
import type { z } from 'zod';

import type { ApprovalPayloadPresentation } from '../approvals.ts';
import type { Result } from '../utils.ts';

/**
 * A tool's identity: two segments, held structurally everywhere and rendered per audience (§1).
 * Segments are never parsed back out of a rendered form except at the config perimeter — a name
 * arriving from the model is resolved by lookup against rendered wire names, not by splitting.
 */
export type ToolId = readonly [namespace: string, name: string];

/** the four facts of the running turn (§4) — everything else a tool needs, its toolset declares */
export type ToolTurnScope = {
  readonly agentUsername: string;
  readonly channelId: string;
  /** provenance for anything a tool records; null on a turn no post triggered */
  readonly triggeringPostId: null | string;
  readonly turnId: string;
};

/** §6.2 — the full payload the approver reads; presence of the `approval` hook is what gates a tool (§5) */
export type ToolApprovalPayload = {
  body: string;
  presentation: ApprovalPayloadPresentation;
};

/**
 * A durable record's disclosure (§3.6), returned by the tool that created it; the turn writes the
 * event the trace reads back. `reference` names the record for later reads, e.g. a memory id.
 */
export type ToolDisclosure = {
  readonly body: string;
  readonly description: string;
  readonly reference: string;
  readonly supersededDescriptions?: readonly string[];
};

export type ToolOutput = {
  readonly disclosure?: ToolDisclosure;
  /**
   * What later turns replay in place of `text`. The turn that made the call reads the text in
   * full; a document the agent will load again anyway, or a page it has already acted on, need
   * not be paid for on every turn whose window still holds the result.
   */
  readonly replay?: string;
  readonly text: string;
};

export declare namespace ToolFailure {
  /** the tool body threw — a semantic failure that terminates the turn (§7.1, §7.2) */
  type Exception = {
    kind: 'exception';
    message: string;
  };
  /** the arguments were rejected — returned to the model as the tool result; the turn continues */
  type InvalidArguments = {
    kind: 'invalid-arguments';
    message: string;
  };
  /** execution outlived `timeoutMs` — for a mutation the side effect is unconfirmed (§7.1, §7.2) */
  type Timeout = {
    kind: 'timeout';
    timeoutMs: number;
  };
  /**
   * The tool committed something whose outcome cannot be established — a send that may or may not
   * have left. The turn ends stating the ambiguity (§7.1); it is never returned to the model,
   * because a model told "unresolved" will try again, which is precisely what must not happen.
   */
  type Unresolved = {
    kind: 'unresolved';
    message: string;
  };
  /** the model named a tool that does not exist or sits outside its configured set (§6.1, §7.2) */
  type UnknownTool = {
    kind: 'unknown-tool';
    message: string;
  };
  type Any = Exception | InvalidArguments | Timeout | UnknownTool | Unresolved;
}

export type ToolFailure = ToolFailure.Any;

/** the settings a toolset context carries, or `unknown` for a context declaring none */
export type ToolContextSettings<TContext> = TContext extends { readonly settings: infer TSettings }
  ? TSettings
  : unknown;

/** what an execution settles to; `execute` may return it sync or promised */
export type ToolResult = Result<ToolOutput, ToolFailure>;

/**
 * One tool: one action (§3). Methods rather than properties, deliberately — method bivariance is
 * what lets every concrete tool flow into `AnyTool` for the registry and executor.
 */
export type ToolDefinition<TContext, TParams extends z.ZodType> = {
  /** present ⇒ the tool always gates (§5); renders the payload the approver reads and cannot decline */
  approval?(args: z.infer<TParams>): ToolApprovalPayload;
  /** §5.3 — never billed against the action budget; framework toolsets only, rejected at the plugin perimeter (§6) */
  readonly budgetExempt?: boolean;
  /**
   * The call may run alongside the other concurrent calls of the same completion rather than after
   * them. For a read that neither depends on nor disturbs what another call in the batch touches;
   * a browser action is not one, since every action on the turn's one page follows the last.
   */
  readonly concurrent?: boolean;
  readonly description: string;
  execute(args: z.infer<TParams>, context: TContext): Promisable<ToolResult>;
  /**
   * Whether the acting agent's effective settings let this tool work at all. False leaves it out
   * of a namespace grant and refuses an explicit one at boot. Framework toolsets only; rejected at
   * the plugin perimeter (§6).
   */
  isAvailableWith?(settings: ToolContextSettings<TContext>): boolean;
  readonly parameters: TParams;
  /** §7.2 — whether a timed-out call may be reported to the model as a plain failure; false ends the turn as unconfirmable */
  readonly retryable?: boolean;
  /**
   * A later result of any supersedable tool in the same turn makes this one stale: once more than
   * the retained few exist, the model reads its `replay` line in place of the text (§3.8). For a
   * page or document the model acts on once and moves past, never for anything it keeps re-reading.
   */
  readonly supersedable?: boolean;
  readonly timeoutMs?: number;
  /** §8.1 — the one-line summary beside the name in the status post; absent shows the name alone */
  traceDetail?(args: z.infer<TParams>): string;
};
