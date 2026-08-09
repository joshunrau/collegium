import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Inject, Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { ToolSchema } from '@/core/core.types.ts';

import { toToolSchema } from './tools.utils.ts';

export const TOOL_LIBRARY_PROVIDER = Symbol('TOOL_LIBRARY');

@Injectable()
export class ToolRegistry {
  private readonly definitions: ReadonlyMap<string, Tool.Any>;

  constructor(@Inject(TOOL_LIBRARY_PROVIDER) library: readonly Tool.Any[]) {
    this.definitions = new Map(library.map((definition) => [definition.name, definition]));
    if (this.definitions.size !== library.length) {
      throw new Error('two tools in the library share a name');
    }
  }

  /**
   * §8.1 — the one-line detail the status post shows beside a call's name. The line is written
   * before the call runs, so the arguments are still raw model output: a call the executor will
   * reject as unknown or malformed has no detail to show and describes itself by name alone.
   */
  describeCall(input: { args: unknown; name: string; profile: AgentProfile }): string | undefined {
    const resolved = this.resolveFor(input.profile, input.name);
    if (!resolved.success) {
      return undefined;
    }
    const args = resolved.value.parameters.safeParse(input.args);
    return args.success ? resolved.value.renderTraceDetail(args.data) : undefined;
  }

  /** the definitions an agent may call, in the shape the provider expects */
  describeFor(profile: AgentProfile): ToolSchema[] {
    return profile.tools.map((name) => {
      const definition = this.definitions.get(name);
      if (!definition) {
        throw new Error(
          `agent "${profile.username}" is configured with "${name}", which no tool in the library declares`
        );
      }
      return toToolSchema(definition);
    });
  }

  /** fails loudly on a name outside the agent's configured set (§6.1) — never falls back */
  resolveFor(profile: AgentProfile, name: string): Result<Tool.Any, Tool.Failure.UnknownTool> {
    const definition = this.definitions.get(name);
    if (!definition) {
      return Result.err({ kind: 'unknown-tool', message: `no tool named "${name}" exists` });
    }
    if (!profile.tools.some((toolName) => toolName === name)) {
      return Result.err({
        kind: 'unknown-tool',
        message: `agent "${profile.username}" is not configured with the tool "${name}"`
      });
    }
    return Result.ok(definition);
  }

  /** boot-time integrity (§6.1): every configured grant names a tool in the merged library, so nothing about a plugin is discovered mid-turn */
  verifyGrants(profiles: readonly AgentProfile[]): void {
    for (const profile of profiles) {
      for (const name of profile.tools) {
        if (!this.definitions.has(name)) {
          throw new Error(
            `agent "${profile.username}" is configured with "${name}", which no tool in the library declares`
          );
        }
      }
    }
  }
}
