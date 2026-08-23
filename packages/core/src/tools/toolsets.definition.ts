import type { Promisable } from 'type-fest';
import type { z } from 'zod';

import { SKILL_NAME_PATTERN } from '../skills.ts';
import { MAX_WIRE_NAME_LENGTH, renderToolWireName, TOOL_SEGMENT_PATTERN } from './tools.naming.ts';

import type { ApprovalPayloadPresentation } from '../approvals.ts';
import type { Result } from '../utils.ts';

declare const SERVICE_INSTANCE: unique symbol;

function assertSegment(value: string, subject: string): void {
  if (!TOOL_SEGMENT_PATTERN.test(value)) {
    throw new Error(`${subject} "${value}" is not lowercase snake_case with single underscores`);
  }
}

export const DEFAULT_TOOL_TIMEOUT_MS = 5000;

/**
 * A NestJS-compatible injection token branded with the instance type it resolves to. Declared in a
 * leaf `<module>.tokens.ts` beside `import type` of the service alone, which is what keeps a
 * toolset declaration inert (§2): the config perimeter can import it without pulling the service's
 * runtime module into the boot graph.
 */
export type ServiceToken<TInstance> = { readonly [SERVICE_INSTANCE]?: TInstance } & symbol;

export function createServiceToken<TInstance>(description: string): ServiceToken<TInstance> {
  return Symbol(description);
}

/** `settings`, `storage`, and `turn` are the context's own keys, so a service may not claim them */
export type ServicesDeclaration = { readonly [key: string]: ServiceToken<unknown> } & {
  readonly settings?: never;
  readonly storage?: never;
  readonly turn?: never;
};

export type CollectionsDeclaration = { readonly [key: string]: z.ZodType };

export type ParametersDeclaration = { readonly [key: string]: z.ZodType };

export type EmptyDeclaration = {};

/** a toolset-scoped handle over one declared storage collection; rows are validated on write and parsed on read */
export type ToolsetCollection<TValue> = {
  delete(key: string): Promise<boolean>;
  get(key: string): Promise<null | TValue>;
  list(): Promise<{ key: string; value: TValue }[]>;
  put(key: string, value: TValue): Promise<void>;
};

/** §6.2 — the full payload the approver reads; presence of the `approval` hook is what gates a tool (§5) */
export type ToolApprovalPayload = {
  body: string;
  presentation: ApprovalPayloadPresentation;
};

/**
 * A durable record's disclosure (§3.6), returned by the tool that created it; the turn writes the
 * event and the trace lines. `reference` names the record for later reads, e.g. a memory id.
 */
export type ToolDisclosure = {
  readonly body: string;
  readonly description: string;
  readonly reference: string;
  readonly supersededDescriptions?: readonly string[];
};

export type ToolOutput = {
  readonly disclosure?: ToolDisclosure;
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

/** what an execution settles to; `execute` may return it sync or promised */
export type ToolResult = Result<ToolOutput, ToolFailure>;

/** the four facts of the running turn (§4) — everything else a tool needs, its toolset declares */
export type ToolTurnScope = {
  readonly agentUsername: string;
  readonly channelId: string;
  /** provenance for anything a tool records; null on a turn no post triggered */
  readonly triggeringPostId: null | string;
  readonly turnId: string;
};

/**
 * What `execute` receives, assembled from exactly what the toolset declared (§4): each service
 * under its own name, `settings` and `storage` only when declared, and always the turn. Reaching
 * anything undeclared is a compile error.
 */
export type ToolsetContext<
  TServices extends ServicesDeclaration = EmptyDeclaration,
  TSettings extends undefined | z.ZodType = undefined,
  TCollections extends CollectionsDeclaration = EmptyDeclaration
> = { readonly [K in keyof TServices]: TServices[K] extends ServiceToken<infer TInstance> ? TInstance : never } & {
  readonly turn: ToolTurnScope;
} & (keyof TCollections extends never
    ? unknown
    : { readonly storage: { readonly [K in keyof TCollections]: ToolsetCollection<z.infer<TCollections[K]>> } }) &
  (TSettings extends z.ZodType ? { readonly settings: z.infer<TSettings> } : unknown);

/**
 * One tool: one action (§3). Methods rather than properties, deliberately — method bivariance is
 * what lets every concrete tool flow into `AnyTool` for the registry and executor.
 */
export type ToolDefinition<TContext, TParams extends z.ZodType> = {
  /** present ⇒ the tool always gates (§5); renders the payload the approver reads and cannot decline */
  approval?(args: z.infer<TParams>): ToolApprovalPayload;
  /** §5.3 — never billed against the action budget; framework toolsets only, rejected at the plugin perimeter (§6) */
  readonly budgetExempt?: boolean;
  readonly description: string;
  execute(args: z.infer<TParams>, context: TContext): Promisable<ToolResult>;
  readonly parameters: TParams;
  /** §7.2 — whether a timed-out call may be reported to the model as a plain failure; false ends the turn as unconfirmable */
  readonly retryable?: boolean;
  readonly timeoutMs?: number;
  /** §8.1 — the one-line summary beside the name in the status post; absent shows the name alone */
  traceDetail?(args: z.infer<TParams>): string;
};

/** a toolset: a namespace and everything that belongs to it (§2); the tools record's keys are the tool names */
export type ToolsetDeclaration<
  TName extends string,
  TServices extends ServicesDeclaration,
  TSettings extends undefined | z.ZodType,
  TCollections extends CollectionsDeclaration,
  TParamsMap extends ParametersDeclaration
> = {
  readonly name: TName;
  readonly services?: TServices;
  readonly settings?: TSettings;
  /** shipped skill documents by bare dashed name, granted as `<namespace>::<skill>` (§9) */
  readonly skills?: readonly string[];
  readonly storage?: TCollections;
  readonly tools: {
    readonly [K in keyof TParamsMap]: ToolDefinition<ToolsetContext<TServices, TSettings, TCollections>, TParamsMap[K]>;
  };
};

/** the loose shapes the registry and executor consume, reached from any concrete declaration via method bivariance */
export type AnyTool = ToolDefinition<ToolsetContext<EmptyDeclaration, undefined, EmptyDeclaration>, z.ZodType>;

export type AnyToolset = {
  readonly name: string;
  readonly services?: { readonly [key: string]: ServiceToken<unknown> };
  readonly settings?: z.ZodType;
  readonly skills?: readonly string[];
  readonly storage?: CollectionsDeclaration;
  readonly tools: { readonly [key: string]: AnyTool };
};

/** the `'<namespace>::<tool>'` literal union of the given toolsets — how names survive into the type (§2); distributes over a union */
export type ToolRefsOf<TToolset extends AnyToolset> = TToolset extends AnyToolset
  ? `${TToolset['name']}::${Extract<keyof TToolset['tools'], string>}`
  : never;

/** a plugin's toolset: the same declaration, refused `services` and `budgetExempt` (§7) */
export type PluginToolsetDeclaration<
  TName extends string,
  TSettings extends undefined | z.ZodType,
  TCollections extends CollectionsDeclaration,
  TParamsMap extends ParametersDeclaration
> = {
  readonly name: TName;
  readonly settings?: TSettings;
  readonly skills?: readonly string[];
  readonly storage?: TCollections;
  readonly tools: {
    readonly [K in keyof TParamsMap]: Omit<
      ToolDefinition<ToolsetContext<EmptyDeclaration, TSettings, TCollections>, TParamsMap[K]>,
      'budgetExempt'
    >;
  };
};

/** the SDK's narrowed view of `defineToolset` — one runtime function under one name for both audiences (§7) */
export type DefinePluginToolset = <
  const TName extends string,
  TParamsMap extends ParametersDeclaration,
  TSettings extends undefined | z.ZodType = undefined,
  const TCollections extends CollectionsDeclaration = EmptyDeclaration
>(
  declaration: PluginToolsetDeclaration<TName, TSettings, TCollections, TParamsMap>
) => PluginToolsetDeclaration<TName, TSettings, TCollections, TParamsMap>;

/**
 * The single declaration function, framework and plugin alike (§7). Purely a perimeter for the
 * grammar the type system cannot state; the declaration itself is inert data, returned as given.
 */
export function defineToolset<
  const TName extends string,
  TParamsMap extends ParametersDeclaration,
  const TServices extends ServicesDeclaration = EmptyDeclaration,
  TSettings extends undefined | z.ZodType = undefined,
  const TCollections extends CollectionsDeclaration = EmptyDeclaration
>(
  declaration: ToolsetDeclaration<TName, TServices, TSettings, TCollections, TParamsMap>
): ToolsetDeclaration<TName, TServices, TSettings, TCollections, TParamsMap> {
  assertSegment(declaration.name, 'toolset namespace');
  for (const toolName of Object.keys(declaration.tools)) {
    assertSegment(toolName, 'tool name');
    const wireName = renderToolWireName([declaration.name, toolName]);
    if (wireName.length > MAX_WIRE_NAME_LENGTH) {
      throw new Error(`tool name "${wireName}" exceeds the ${MAX_WIRE_NAME_LENGTH}-character provider limit`);
    }
  }
  for (const collectionName of Object.keys(declaration.storage ?? {})) {
    assertSegment(collectionName, 'storage collection name');
  }
  for (const skillName of declaration.skills ?? []) {
    if (!SKILL_NAME_PATTERN.test(skillName)) {
      throw new Error(`skill name "${skillName}" is not in the dashed skill-name grammar`);
    }
  }
  return declaration;
}
