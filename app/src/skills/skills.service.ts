import * as path from 'node:path';

import { BUILTIN_CORE_SKILL_NAMES, BUILTIN_SKILL_NAMES, renderQualifiedSkillName } from '@collegium/core/skills';
import type { Skill } from '@collegium/core/skills';
import { renderToolWireName } from '@collegium/core/tools';
import { SKILLS_TOOLSET_DEF } from '@collegium/core/toolsets';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { FRAMEWORK_TOOLSETS } from '@/tools/tools.toolsets.ts';

import { loadPluginSkillLibrary, loadSkillLibrary } from './skills.utils.ts';

export type SkillListing = {
  readonly description: string;
  /** the name the agent pulls it by: bare for a framework skill, `ns::skill` for a toolset's */
  readonly name: string;
};

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

  /**
   * The document under its title, pulled on demand (§3.5) — the skill and its reference index, or
   * one of those references. Both names are model output, so absence is the model's recoverable
   * mistake rather than a termination.
   */
  getDocument(name: string, referenceName?: string): Result<string, { message: string }> {
    const skill = this.skills.get(name);
    if (!skill) {
      return Result.err({ message: `no skill named "${name}" exists` });
    }
    if (referenceName === undefined) {
      return Result.ok(this.renderSkill(skill));
    }
    const reference = skill.references.get(referenceName);
    if (!reference) {
      return Result.err({ message: this.renderUnknownReference(name, skill, referenceName) });
    }
    return Result.ok(`# ${reference.title}\n\n${reference.body}`);
  }

  /** every skill an agent holds: core skills always, then the agent's grants, each under its qualified name (§3.5) */
  listFor(profile: AgentProfile): readonly SkillListing[] {
    return [...BUILTIN_CORE_SKILL_NAMES, ...profile.skills].map((name) => ({
      description: this.require(name).description,
      name
    }));
  }

  /** the manifest injected into the system prompt every turn */
  renderManifest(profile: AgentProfile): string {
    return this.listFor(profile)
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
  }

  private renderSkill(skill: Skill): string {
    const document = `# ${skill.title}\n\n${skill.body}`;
    if (skill.references.size === 0) {
      return document;
    }
    // the index is generated, so a reference is invisible until the skill is loaded and unavoidable after (§3.5)
    const index = Array.from(skill.references, ([name, reference]) => `- ${name}: ${reference.description}`);
    const wireName = renderToolWireName([SKILLS_TOOLSET_DEF.name, 'load']);
    return [
      document,
      '## References',
      `Load one with ${wireName}, naming this skill and the reference.`,
      index.join('\n')
    ].join('\n\n');
  }

  private renderUnknownReference(name: string, skill: Skill, referenceName: string): string {
    if (skill.references.size === 0) {
      return `skill "${name}" has no references`;
    }
    return `skill "${name}" has no reference "${referenceName}"; it has: ${Array.from(skill.references.keys()).join(', ')}`;
  }

  private require(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`no skill named "${name}" exists in the library`);
    }
    return skill;
  }

  /** §3.5 — every grant names a skill in the merged library, and never a core one; refused at boot, not mid-turn */
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
