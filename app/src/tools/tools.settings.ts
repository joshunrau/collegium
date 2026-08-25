import { renderToolDisplayName } from '@collegium/core/tools';
import type { AnyToolset } from '@collegium/core/toolsets';
import { isPlainObject } from 'es-toolkit';
import { z } from 'zod';

type AgentSettingsInput = {
  /** the agent's grants exactly as config states them: namespaces and `ns::tool` refs */
  readonly tools: readonly string[];
  readonly toolSettings: Readonly<{ [key: string]: unknown }>;
  readonly username: string;
};

function asSettingsRecord(subject: string, value: unknown): { [key: string]: unknown } {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new Error(`${subject} must be an object`);
  }
  return value;
}

export type ResolveToolSettingsInput = {
  readonly agents: readonly AgentSettingsInput[];
  readonly defaults: Readonly<{ [key: string]: unknown }>;
  readonly toolsets: readonly AnyToolset[];
};

/** agentUsername → namespace → parsed settings, holding an entry for every granted toolset that declares a schema */
export type EffectiveToolSettings = ReadonlyMap<string, ReadonlyMap<string, unknown>>;

/** §8 — whether a grant list reaches this toolset at all: its namespace, or any one of its tools by ref */
export function isToolsetGranted(
  toolset: { readonly name: string; readonly tools: AnyToolset['tools'] },
  grants: ReadonlySet<string>
): boolean {
  return (
    grants.has(toolset.name) ||
    Object.keys(toolset.tools).some((tool) => grants.has(renderToolDisplayName([toolset.name, tool])))
  );
}

/**
 * One toolset's effective settings for one agent: `defaults[ns]` shallowly merged under the
 * agent's own `toolSettings[ns]`, parsed against the toolset's schema. Shallow, deliberately — an
 * override like a provider replaces the default whole rather than half-merging a discriminated
 * union. Undefined when the agent is granted none of the toolset's tools, or when the toolset
 * declares no settings; provisioning uses that to find, pre-boot, the agents a capability reaches.
 */
export function resolveGrantedToolsetSettings<TSettings extends z.ZodType>(
  toolset: { readonly name: string; readonly settings?: TSettings; readonly tools: AnyToolset['tools'] },
  input: { agent: AgentSettingsInput; defaults: Readonly<{ [key: string]: unknown }> }
): undefined | z.infer<TSettings> {
  if (!toolset.settings || !isToolsetGranted(toolset, new Set(input.agent.tools))) {
    return undefined;
  }
  const merged = {
    ...asSettingsRecord(`defaultToolSettings.${toolset.name}`, input.defaults[toolset.name]),
    ...asSettingsRecord(
      `agent "${input.agent.username}" toolSettings.${toolset.name}`,
      input.agent.toolSettings[toolset.name]
    )
  };
  const parsed = toolset.settings.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `agent "${input.agent.username}" has invalid settings for "${toolset.name}": ${z.prettifyError(parsed.error)}`
    );
  }
  return parsed.data;
}

/**
 * The one settings mechanism (§8), applied across every agent and toolset at boot. The two
 * generic rules live here — settings for an ungranted toolset is an error, and a granted toolset
 * whose merged settings fail its schema is an error — and no toolset is named anywhere.
 */
export function resolveEffectiveToolSettings(input: ResolveToolSettingsInput): EffectiveToolSettings {
  const toolsetsByName = new Map(input.toolsets.map((toolset) => [toolset.name, toolset]));
  for (const namespace of Object.keys(input.defaults)) {
    const toolset = toolsetsByName.get(namespace);
    if (!toolset) {
      throw new Error(`defaultToolSettings names "${namespace}", which no toolset declares`);
    }
    if (!toolset.settings) {
      throw new Error(`defaultToolSettings supplies settings for "${namespace}", which declares no settings schema`);
    }
  }
  const resolved = new Map<string, ReadonlyMap<string, unknown>>();
  for (const agent of input.agents) {
    const grants = new Set(agent.tools);
    for (const namespace of Object.keys(agent.toolSettings)) {
      const toolset = toolsetsByName.get(namespace);
      if (!toolset) {
        throw new Error(
          `agent "${agent.username}" supplies toolSettings for "${namespace}", which no toolset declares`
        );
      }
      if (!isToolsetGranted(toolset, grants)) {
        throw new Error(
          `agent "${agent.username}" supplies toolSettings for "${namespace}" without being granted any of its tools`
        );
      }
      if (!toolset.settings) {
        throw new Error(
          `agent "${agent.username}" supplies toolSettings for "${namespace}", which declares no settings schema`
        );
      }
    }
    const settingsByNamespace = new Map<string, unknown>();
    for (const toolset of input.toolsets) {
      const settings = resolveGrantedToolsetSettings(toolset, { agent, defaults: input.defaults });
      if (settings !== undefined) {
        settingsByNamespace.set(toolset.name, settings);
      }
    }
    resolved.set(agent.username, settingsByNamespace);
  }
  return resolved;
}
