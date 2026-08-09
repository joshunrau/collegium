import { toQualifiedName } from '@collegium/core/plugins';
import type { PluginContext, PluginContract, PluginToolConstructor } from '@collegium/core/plugins';
import { BaseTool } from '@collegium/core/tools';
import type { Tool } from '@collegium/core/tools';
import type { z } from 'zod';

const DEFAULT_TIMEOUT_MS = 5000;

type PluginCapabilities = {
  /** each backed by `skills/<name>.md` beside the entry module, read and validated by the framework at boot */
  readonly skills?: readonly string[];
  readonly tools?: readonly PluginToolConstructor[];
};

/** everything a tool body may reach: the plugin's context plus the running turn */
type PluginToolHelpers<TContract extends PluginContract> = PluginContext<TContract> & {
  readonly turn: Tool.TurnScope;
};

type PluginToolDefinition<TContract extends PluginContract, TParams extends z.ZodType> = {
  /**
   * Present means the gate is resolved per call: return the payload the approver reads (§6.2), or
   * null for a call that needs no approval. Absent means the tool never gates.
   */
  readonly approval?: (args: z.infer<TParams>) => null | Tool.GatedApprovalPayload;
  readonly description: string;
  readonly execute: (
    args: z.infer<TParams>,
    helpers: PluginToolHelpers<TContract>
  ) => Promise<Tool.Result> | Tool.Result;
  readonly name: string;
  readonly parameters: TParams;
  /**
   * §7.2 — whether a timed-out call may be reported to the model as a plain failure. Defaults to
   * false, the safe direction: an unconfirmed mutation ends the turn rather than inviting a retry.
   */
  readonly retryable?: ((args: z.infer<TParams>) => boolean) | boolean;
  readonly timeoutMs?: number;
  /** the one-line summary beside the tool's name in the status post (§8.1); absent shows the name alone */
  readonly traceDetail?: (args: z.infer<TParams>) => string;
};

/**
 * The two-phase authoring surface: the contract is declared once, and both the tool helpers' types
 * and the manifest derive from it, so a tool cannot disagree with the contract. Tools are plain
 * definition objects — contextually typed, so `args` and the helpers never need annotating.
 */
export function declarePlugin<const TContract extends PluginContract>(contract: TContract) {
  function tool<TParams extends z.ZodType>(
    definition: PluginToolDefinition<TContract, TParams>
  ): PluginToolConstructor {
    const qualifiedName = toQualifiedName(contract.name, definition.name);
    return class extends BaseTool<string, TParams, Tool.Variant> {
      private readonly context: PluginContext<TContract>;

      constructor(context: PluginContext) {
        super();
        this.context = context as unknown as PluginContext<TContract>;
      }

      get description(): string {
        return definition.description;
      }

      get name(): string {
        return qualifiedName;
      }

      get parameters(): TParams {
        return definition.parameters;
      }

      get timeoutMs(): number {
        return definition.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      }

      /** never 'gated' statically: with the gate a function, per-call resolution is the honest description */
      get variant(): Tool.Variant {
        return definition.approval ? 'dynamic' : 'ungated';
      }

      execute(args: z.infer<TParams>, turn: Tool.TurnScope): Promise<Tool.Result> | Tool.Result {
        return definition.execute(args, { ...this.context, turn });
      }

      getApprovalRequirements(args: z.infer<TParams>): Tool.ApprovalRequirements<Tool.Variant> {
        const payload = definition.approval?.(args) ?? null;
        return payload === null ? { kind: 'ungated' } : { kind: 'gated', payload };
      }

      isRetryable(args: z.infer<TParams>): boolean {
        const { retryable = false } = definition;
        return typeof retryable === 'function' ? retryable(args) : retryable;
      }

      renderTraceDetail(args: z.infer<TParams>): string {
        return definition.traceDetail?.(args) ?? '';
      }
    };
  }

  return {
    /** the manifest the plugin's entry module default-exports, in the shape `$Plugin` validates */
    create: (capabilities: PluginCapabilities) => ({
      collections: contract.collections,
      name: contract.name,
      settings: contract.settings,
      skills: capabilities.skills ?? [],
      tools: capabilities.tools ?? []
    }),
    tool
  };
}
