import type { Promisable } from 'type-fest';
import type { z } from 'zod';

import type { ApprovalPayloadPresentation } from '../approvals.ts';
import type { Result as ResultType } from '../utils.ts';

export const TOOL_CONSTRUCTOR_SYMBOL = Symbol.for('collegium.tool.constructor');

export abstract class BaseTool<TName extends string, TParams extends z.ZodType, TVariant extends Tool.Variant> {
  static readonly [TOOL_CONSTRUCTOR_SYMBOL] = true;

  abstract readonly description: string;

  abstract readonly name: TName;
  abstract readonly parameters: TParams;
  abstract readonly timeoutMs: number;
  /** the declared gate: 'gated' and 'ungated' are enforced on `getApprovalRequirements`'s return type; 'dynamic' names per-call gating out loud */
  abstract readonly variant: Tool.Variant;

  /** overrides are never contextually typed (TS#23911) — implementations restate the `$Args` alias and `Tool.Result` (or `Promise<Tool.Result>` when async) */
  abstract execute(args: z.infer<TParams>, turn: Tool.TurnScope): Promisable<Tool.Result>;

  /** a gated result carries the full payload the approver reads — the §6.2 obligation, inseparable from the gate */
  abstract getApprovalRequirements(args: z.infer<TParams>): Tool.ApprovalRequirements<TVariant>;

  /**
   * §7.2 — reads yes, mutations no. Whether a timed-out call is a plain failure the model hears
   * (true) or an unconfirmable side effect that ends the turn (false), decided per call for a
   * tool whose actions differ.
   */
  abstract isRetryable(args: z.infer<TParams>): boolean;

  /**
   * §8.1 — what this call is doing, in one line beside the tool's name in the status post. The tool
   * decides which arguments are worth a supervisor's attention; the untruncated arguments are always
   * in `/trace`, so a summary here never withholds anything.
   */
  abstract renderTraceDetail(args: z.infer<TParams>): string;
}

export declare namespace Tool {
  /** what the registry and executor consume; the gate is resolved per call via `getApprovalRequirements` */
  type Any = BaseTool<string, z.ZodType, Variant>;

  namespace ApprovalRequirements {
    type Gated = {
      kind: 'gated';
      payload: GatedApprovalPayload;
    };
    type Ungated = {
      kind: 'ungated';
    };
  }

  type ApprovalRequirements<TVariant extends Variant = any> = TVariant extends 'gated'
    ? ApprovalRequirements.Gated
    : TVariant extends 'ungated'
      ? ApprovalRequirements.Ungated
      : TVariant extends 'dynamic'
        ? ApprovalRequirements.Gated | ApprovalRequirements.Ungated
        : never;

  type Config<TName extends string, TParams extends z.ZodType, TVariant extends Variant> = {
    readonly description: string;
    readonly name: TName;
    readonly parameters: TParams;
    /** how long execution may run before it is abandoned as `ToolFailure.Timeout` */
    readonly timeoutMs: number;
    readonly variant: TVariant;
  };

  namespace Failure {
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

  type Failure = Failure.Any;

  type GatedApprovalPayload = {
    body: string;
    presentation: ApprovalPayloadPresentation;
  };

  type MemoryWriteDisclosure = {
    readonly body: string;
    readonly description: string;
    readonly evictedDescriptions: readonly string[];
    readonly memoryId: string;
  };

  type Output = {
    readonly text: string;
  };

  /** what an execution settles to; the abstract signature accepts it sync or promised, so async implementations annotate `Promise<Tool.Result>` */
  type Result = ResultType<Output, Failure>;

  type TurnScope = {
    readonly agentUsername: string;
    readonly channelId: string;
    /** supplied by the turn, which owns the status post and the trace the disclosure lands in (§8.1) */
    readonly discloseMemoryWrite: (disclosure: MemoryWriteDisclosure) => Promise<void>;
    /** provenance for anything a tool records, e.g. `Memory.originPostId` (§3.6) */
    readonly triggeringPostId: string;
    readonly turnId: string;
    /** where `write_file` is rooted (§6.1) — framework-derived, never model-supplied */
    readonly workspaceDir: string;
  };

  type Variant = 'dynamic' | 'gated' | 'ungated';
}

export function Tool<TName extends string, TParams extends z.ZodType, TVariant extends Tool.Variant>(
  config: Tool.Config<TName, TParams, TVariant>
) {
  abstract class Bound extends BaseTool<TName, TParams, TVariant> {
    get description(): string {
      return config.description;
    }

    get name(): TName {
      return config.name;
    }

    get parameters(): TParams {
      return config.parameters;
    }

    get timeoutMs(): number {
      return config.timeoutMs;
    }

    get variant(): TVariant {
      return config.variant;
    }
  }
  return Bound;
}
