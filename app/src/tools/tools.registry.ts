import { renderToolDisplayName, renderToolWireName } from '@collegium/core/tools';
import type { ToolFailure, ToolId } from '@collegium/core/tools';
import type { AnyTool, AnyToolset, AnyToolsetCollection, AnyToolsetCollectionReader } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ToolSchema } from '@/core/core.types.ts';

import { CORE_TOOLSETS } from './tools.toolsets.ts';
import { toToolSchema } from './tools.utils.ts';

/** one tool bound to everything the executor needs: its identity, its toolset's boot-resolved context parts */
export type ResolvedTool = {
  readonly definition: AnyTool;
  readonly displayName: string;
  readonly id: ToolId;
  readonly schema: ToolSchema;
  readonly toolset: RegisteredToolset;
  readonly wireName: string;
};

/** a toolset with its declared services and storage resolved once at boot (§4) */
export type RegisteredToolset = {
  readonly declaration: AnyToolset;
  readonly services: Readonly<{ [key: string]: unknown }>;
  readonly storage: Readonly<{ [key: string]: AnyToolsetCollection }>;
  /** the read half of each collection above, and all of storage an approval render is handed (§3.4) */
  readonly storageReaders: Readonly<{ [key: string]: AnyToolsetCollectionReader }>;
};

/** §8.4 — what an agent holds, and for each whether acting with it needs a human (§3.4) */
export type GrantedTool = {
  readonly gates: boolean;
  readonly id: ToolId;
};

export type DescribedCall = {
  readonly detail: string | undefined;
  readonly displayName: string;
  /** §8.1 — what the call would come to, kept apart from the subject so a call that never ran can drop it */
  readonly effect: string | undefined;
  readonly id: ToolId;
};

/**
 * The library assembled from every registered toolset, framework and plugin alike, plus each
 * agent's own view of it: expanded grants (§8) with the core tools always present. Everything is
 * resolved at construction, so an impossible configuration is a boot refusal and nothing about a
 * toolset is discovered mid-turn (§6.1).
 */
export class ToolRegistry {
  /**
   * Every spelling one of the agent's tools may arrive in, derived from the set below: the wire
   * name, the `ns::tool` form the framework's own approval posts put in the agent's own window, and
   * the bare tool segment where only one granted tool carries it (§3.4). Every key is rendered from
   * one identity at boot, so resolution stays lookup and nothing parses a name; a name claiming no
   * granted tool is answered with the ones that are (§7.2).
   */
  private readonly agentCallableTools: ReadonlyMap<string, ReadonlyMap<string, ResolvedTool>>;

  /** wireName → tool, per agent — the set the model is offered and the one an operator is shown (§1) */
  private readonly agentTools: ReadonlyMap<string, ReadonlyMap<string, ResolvedTool>>;

  private readonly coreNamespaces: ReadonlySet<string> = new Set(CORE_TOOLSETS.map((toolset) => toolset.name));

  /** every tool every registered toolset declares, granted or not */
  private readonly library: readonly ResolvedTool[];

  constructor(toolsets: readonly RegisteredToolset[], profiles: readonly AgentProfile[]) {
    const byNamespace = new Map<string, RegisteredToolset>();
    for (const toolset of toolsets) {
      if (byNamespace.has(toolset.declaration.name)) {
        throw new Error(`two toolsets claim the namespace "${toolset.declaration.name}"`);
      }
      byNamespace.set(toolset.declaration.name, toolset);
    }
    const byRef = new Map<string, ResolvedTool>();
    for (const toolset of toolsets) {
      for (const [name, definition] of Object.entries(toolset.declaration.tools)) {
        if (definition.approval && definition.ask) {
          throw new Error(`tool "${toolset.declaration.name}::${name}" declares both approval and ask (§3.7a)`);
        }
        const id: ToolId = [toolset.declaration.name, name];
        const wireName = renderToolWireName(id);
        const displayName = renderToolDisplayName(id);
        byRef.set(displayName, {
          definition,
          displayName,
          id,
          schema: toToolSchema(wireName, definition),
          toolset,
          wireName
        });
      }
    }
    this.library = Array.from(byRef.values());
    const grantable = new Map(
      Array.from(byNamespace.entries()).filter(([namespace]) => !this.coreNamespaces.has(namespace))
    );
    this.agentTools = new Map(
      profiles.map((profile) => [profile.username, this.expandGrants(profile, byRef, grantable)])
    );
    this.agentCallableTools = new Map(
      Array.from(this.agentTools, ([username, tools]) => [username, ToolRegistry.toCallableNames(tools)])
    );
  }

  private static require(
    tools: ReadonlyMap<string, ResolvedTool> | undefined,
    username: string
  ): ReadonlyMap<string, ResolvedTool> {
    if (!tools) {
      throw new Error(`no agent is registered as "${username}"`);
    }
    return tools;
  }

  /** the one place further spellings are admitted, each rendered from the same identity as the first */
  private static toCallableNames(tools: ReadonlyMap<string, ResolvedTool>): ReadonlyMap<string, ResolvedTool> {
    const callable = new Map(tools);
    const carriersBySegment = new Map<string, number>();
    for (const tool of tools.values()) {
      callable.set(tool.displayName, tool);
      carriersBySegment.set(tool.id[1], (carriersBySegment.get(tool.id[1]) ?? 0) + 1);
    }
    for (const tool of tools.values()) {
      if (carriersBySegment.get(tool.id[1]) === 1) {
        callable.set(tool.id[1], tool);
      }
    }
    return callable;
  }

  /**
   * §8.1 — the line the status post shows beside a call. The line is written before the call runs,
   * so the arguments are still raw model output: a call the executor will reject as unknown has
   * nothing to show, and one with malformed arguments describes itself by name alone.
   */
  describeCall(input: { args: unknown; name: string; profile: AgentProfile }): DescribedCall | undefined {
    const resolved = this.resolveFor(input.profile, input.name);
    if (!resolved.success) {
      return undefined;
    }
    const { definition, displayName, id } = resolved.value;
    const args = definition.parameters.safeParse(input.args);
    const detail = args.success ? definition.traceDetail?.(args.data) : undefined;
    const effect = args.success ? definition.traceEffect?.(args.data) : undefined;
    return { detail, displayName, effect, id };
  }

  /** the definitions an agent may call, in the shape the provider expects — wire names (§1) */
  describeFor(profile: AgentProfile): ToolSchema[] {
    return Array.from(this.toolsFor(profile).values(), (tool) => tool.schema);
  }

  /** §5.3 — whether a call is billed against the action budget; an unknown name always is */
  isBudgetExempt(profile: AgentProfile, name: string): boolean {
    return this.callableToolsFor(profile).get(name)?.definition.budgetExempt === true;
  }

  /** §5.1 — whether a call may run beside the other concurrent calls of its completion; an unknown name never may */
  isConcurrent(profile: AgentProfile, name: string): boolean {
    return this.callableToolsFor(profile).get(name)?.definition.concurrent === true;
  }

  /**
   * §3.4 — the one answer to whether a text may offer a tool as the way on: the agent is granted the
   * tool named by its full `ns::tool` ref, core tools included. Only the full ref resolves, never the
   * bare segment or the wire name a call may arrive under.
   */
  isGranted(profile: AgentProfile, ref: string): boolean {
    return this.callableToolsFor(profile).get(ref)?.displayName === ref;
  }

  /** §3.8 — whether a later result with this call's content costs a line naming it; an unknown name never does */
  isSupersedable(profile: AgentProfile, name: string): boolean {
    return this.callableToolsFor(profile).get(name)?.definition.supersedable === true;
  }

  /** §5.3 — the wire names an agent may call for free, so the prompt states the rule from the flags the budget bills by */
  listBudgetExemptFor(profile: AgentProfile): string[] {
    return Array.from(this.toolsFor(profile).values())
      .filter((tool) => tool.definition.budgetExempt === true)
      .map((tool) => tool.wireName);
  }

  /** every tool an agent may call, core included — what an operator inspecting the agent sees (§8.4) */
  listFor(profile: AgentProfile): readonly GrantedTool[] {
    return Array.from(this.toolsFor(profile).values(), (tool) => ({
      gates: tool.definition.approval !== undefined,
      id: tool.id
    }));
  }

  /** §3.11 — what a peer's roster line names: each namespace the agent holds a tool of, core left out, in a fixed order */
  listGrantedNamespacesFor(profile: AgentProfile): readonly string[] {
    const namespaces = new Set(Array.from(this.toolsFor(profile).values(), (tool) => tool.id[0]));
    return Array.from(namespaces)
      .filter((namespace) => !this.coreNamespaces.has(namespace))
      .toSorted();
  }

  /** §3.14 — the tools of the named toolsets that no agent's expanded grants include, which no turn can ever call */
  listUngrantedIn(namespaces: ReadonlySet<string>): ToolId[] {
    const granted = new Set(Array.from(this.agentTools.values()).flatMap((tools) => Array.from(tools.keys())));
    return this.library
      .filter((tool) => namespaces.has(tool.id[0]) && !granted.has(tool.wireName))
      .map((tool) => tool.id);
  }

  /** §5.1, §3.8 — whether a call waits on a person, which is never started while a turn's context is over its ceiling; an unknown name never does */
  parksOnPerson(profile: AgentProfile, name: string): boolean {
    const definition = this.callableToolsFor(profile).get(name)?.definition;
    return definition?.approval !== undefined || definition?.ask !== undefined;
  }

  /** §7.2 — what a call naming no granted tool reads: the name it used, and the tools it can call by the names it calls them */
  renderUnknownToolResult(profile: AgentProfile, name: string): string {
    const callable = Array.from(this.toolsFor(profile).keys()).join(', ');
    return `no tool named "${name}" exists in your tool set; the tools you can call are: ${callable}`;
  }

  /** never falls back to a nearby name (§6.1): a name outside the agent's set resolves to nothing */
  resolveFor(profile: AgentProfile, name: string): Result<ResolvedTool, ToolFailure.UnknownTool> {
    const tool = this.callableToolsFor(profile).get(name);
    if (!tool) {
      return Result.err({ kind: 'unknown-tool', message: this.renderUnknownToolResult(profile, name) });
    }
    return Result.ok(tool);
  }

  private callableToolsFor(profile: AgentProfile): ReadonlyMap<string, ResolvedTool> {
    return ToolRegistry.require(this.agentCallableTools.get(profile.username), profile.username);
  }

  /**
   * §8 — grants expand at boot: a namespace grant covers every tool the namespace holds now, so a
   * plugin update widens an existing grant with no config change; core toolsets join uninvited.
   * A tool the agent's settings leave unable to work is skipped by a namespace grant and refused
   * when granted by name. Every failure names the agent and the grant, and naming a core capability
   * is its own refusal.
   */
  private expandGrants(
    profile: AgentProfile,
    byRef: ReadonlyMap<string, ResolvedTool>,
    grantable: ReadonlyMap<string, RegisteredToolset>
  ): ReadonlyMap<string, ResolvedTool> {
    const tools = new Map<string, ResolvedTool>();
    const isAvailable = (tool: ResolvedTool) => {
      return tool.definition.isAvailableWith?.(profile.toolSettings.get(tool.id[0])) ?? true;
    };
    const includeNamespace = (declaration: AnyToolset) => {
      for (const name of Object.keys(declaration.tools)) {
        const tool = byRef.get(renderToolDisplayName([declaration.name, name]));
        if (tool && isAvailable(tool)) {
          tools.set(tool.wireName, tool);
        }
      }
    };
    for (const toolset of CORE_TOOLSETS) {
      includeNamespace(toolset);
    }
    for (const grant of profile.tools) {
      if (this.coreNamespaces.has(grant) || this.coreNamespaces.has(byRef.get(grant)?.id[0] ?? '')) {
        throw new Error(
          `agent "${profile.username}" is configured with "${grant}", which is core — always enabled and never granted`
        );
      }
      const namespaceToolset = grantable.get(grant);
      if (namespaceToolset) {
        includeNamespace(namespaceToolset.declaration);
        continue;
      }
      const single = byRef.get(grant);
      if (single) {
        if (!isAvailable(single)) {
          throw new Error(
            `agent "${profile.username}" is configured with "${grant}", which its settings for "${single.id[0]}" do not enable`
          );
        }
        tools.set(single.wireName, single);
        continue;
      }
      throw new Error(
        `agent "${profile.username}" is configured with "${grant}", which no toolset in the library declares`
      );
    }
    return tools;
  }

  private toolsFor(profile: AgentProfile): ReadonlyMap<string, ResolvedTool> {
    return ToolRegistry.require(this.agentTools.get(profile.username), profile.username);
  }
}
