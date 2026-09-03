import * as path from 'node:path';

import { BUILTIN_CORE_SKILL_NAMES, BUILTIN_SKILL_NAMES, renderQualifiedSkillName } from '@collegium/core/skills';
import type { Skill } from '@collegium/core/skills';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { FRAMEWORK_TOOLSETS } from '@/tools/tools.toolsets.ts';

import { loadPluginSkillLibrary, loadSkillLibrary } from './skills.utils.ts';

@Injectable()
export class SkillsService {
  /** the framework library, every toolset's shipped skills under `ns::skill` names, and the plugins' */
  private readonly skills: ReadonlyMap<string, Skill>;

  constructor(agentRegistry: AgentRegistry, pluginsRegistry: PluginsRegistry) {
    const frameworkSkills = loadSkillLibrary(path.resolve(import.meta.dirname, 'library'), BUILTIN_SKILL_NAMES);
    // a framework namespace equals its module directory (§2), which is what makes this resolvable
    const toolsetSkills = FRAMEWORK_TOOLSETS.flatMap((toolset) => {
      const names = toolset.skills ?? [];
      if (names.length === 0) {
        return [];
      }
      const documents = loadSkillLibrary(path.resolve(import.meta.dirname, '..', toolset.name, 'skills'), names);
      return Object.entries(documents).map(
        ([name, skill]) => [renderQualifiedSkillName(toolset.name, name), skill] as const
      );
    });
    const pluginSkills = pluginsRegistry.skillSources.flatMap((source) => {
      return Object.entries(loadPluginSkillLibrary(source)).map(
        ([name, skill]) => [renderQualifiedSkillName(source.namespace, name), skill] as const
      );
    });
    this.skills = new Map([...Object.entries(frameworkSkills), ...toolsetSkills, ...pluginSkills]);
    this.verifyGrants(agentRegistry.list());
  }

  /** the document under its title, pulled on demand (§3.5); the name is model output, so absence is the model's recoverable mistake */
  getDocument(name: string): Result<string, { message: string }> {
    const skill = this.skills.get(name);
    if (!skill) {
      return Result.err({ message: `no skill named "${name}" exists` });
    }
    return Result.ok(`# ${skill.title}\n\n${skill.body}`);
  }

  /** the manifest injected into the system prompt every turn: core skills always, then the agent's grants (§3.5, §9) */
  renderManifest(profile: AgentProfile): string {
    return [...BUILTIN_CORE_SKILL_NAMES, ...profile.skills]
      .map((name) => `- ${name}: ${this.require(name).description}`)
      .join('\n');
  }

  private require(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`no skill named "${name}" exists in the library`);
    }
    return skill;
  }

  /** §9 — every grant names a skill in the merged library, and never a core one; refused at boot, not mid-turn */
  private verifyGrants(profiles: readonly AgentProfile[]): void {
    const coreNames = new Set<string>(BUILTIN_CORE_SKILL_NAMES);
    for (const profile of profiles) {
      for (const name of profile.skills) {
        if (coreNames.has(name)) {
          throw new Error(
            `agent "${profile.username}" is configured with "${name}", which is a core skill — always assigned and never granted`
          );
        }
        if (!this.skills.has(name)) {
          throw new Error(
            `agent "${profile.username}" is configured with "${name}", which no skill in the library declares`
          );
        }
      }
    }
  }
}
