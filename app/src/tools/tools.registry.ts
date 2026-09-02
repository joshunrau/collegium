import { renderToolDisplayName, renderToolWireName } from '@collegium/core/tools';
import type { ToolFailure, ToolId } from '@collegium/core/tools';
import type { AnyTool, AnyToolset, AnyToolsetCollection } from '@collegium/core/toolsets';
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
};

export type DescribedCall = {
  readonly detail: string | undefined;
  readonly displayName: string;
  readonly id: ToolId;
};

/**
 * The library assembled from every registered toolset, framework and plugin alike, plus each
 * agent's own view of it: expanded grants (§8) with the core tools always present. Everything is
 * resolved at construction, so an impossible configuration is a boot refusal and nothing about a
 * toolset is discovered mid-turn (§6.1).
 */
export class ToolRegistry {
  /** wireName → tool, per agent — the model speaks wire names, and resolution is lookup, never parsing (§1) */
  private readonly agentTools: ReadonlyMap<string, ReadonlyMap<string, ResolvedTool>>;

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
    const coreNamespaces = new Set<string>(CORE_TOOLSETS.map((toolset) => toolset.name));
    const grantable = new Map(
      Array.from(byNamespace.entries()).filter(([namespace]) => !coreNamespaces.has(namespace))
    );
    this.agentTools = new Map(
      profiles.map((profile) => [profile.username, this.expandGrants(profile, byRef, grantable, coreNamespaces)])
    );
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
    return { detail, displayName, id };
  }

  /** the definitions an agent may call, in the shape the provider expects — wire names (§1) */
  describeFor(profile: AgentProfile): ToolSchema[] {
    return Array.from(this.toolsFor(profile).values(), (tool) => tool.schema);
  }

  /** §5.3 — whether a call is billed against the action budget; an unknown name always is */
  isBudgetExempt(profile: AgentProfile, name: string): boolean {
    return this.toolsFor(profile).get(name)?.definition.budgetExempt === true;
  }

  /** fails loudly on a name outside the agent's set (§6.1) — never falls back */
  resolveFor(profile: AgentProfile, name: string): Result<ResolvedTool, ToolFailure.UnknownTool> {
    const tool = this.toolsFor(profile).get(name);
    if (!tool) {
      return Result.err({ kind: 'unknown-tool', message: `no tool named "${name}" exists in your tool set` });
    }
    return Result.ok(tool);
  }

  /**
   * §8 — grants expand at boot: a namespace grant covers every tool the namespace holds now, so a
   * plugin update widens an existing grant with no config change; core toolsets join uninvited.
   * Every failure names the agent and the grant, and naming a core capability is its own refusal.
   */
  private expandGrants(
    profile: AgentProfile,
    byRef: ReadonlyMap<string, ResolvedTool>,
    grantable: ReadonlyMap<string, RegisteredToolset>,
    coreNamespaces: ReadonlySet<string>
  ): ReadonlyMap<string, ResolvedTool> {
    const tools = new Map<string, ResolvedTool>();
    const includeNamespace = (declaration: AnyToolset) => {
      for (const name of Object.keys(declaration.tools)) {
        const tool = byRef.get(renderToolDisplayName([declaration.name, name]));
        if (tool) {
          tools.set(tool.wireName, tool);
        }
      }
    };
    for (const toolset of CORE_TOOLSETS) {
      includeNamespace(toolset);
    }
    for (const grant of profile.tools) {
      if (coreNamespaces.has(grant) || coreNamespaces.has(byRef.get(grant)?.id[0] ?? '')) {
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
    const tools = this.agentTools.get(profile.username);
    if (!tools) {
      throw new Error(`no agent is registered as "${profile.username}"`);
    }
    return tools;
  }
}
