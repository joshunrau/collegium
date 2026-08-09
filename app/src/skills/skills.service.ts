import * as path from 'node:path';

import { loadSkillLibrary } from '@collegium/core/skills';
import { Result } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';

import { SKILL_NAMES } from './skills.constants.ts';

import type { Skill } from './skills.types.ts';

@Injectable()
export class SkillsService {
  /** the framework library plus every plugin's contributions under their qualified names */
  private readonly skills: ReadonlyMap<string, Skill>;

  constructor(pluginsRegistry: PluginsRegistry) {
    const frameworkSkills = loadSkillLibrary(path.resolve(import.meta.dirname, 'library'), SKILL_NAMES);
    this.skills = new Map([...Object.entries(frameworkSkills), ...pluginsRegistry.skills]);
  }

  /** the document under its title, pulled on demand (§3.5); the name is model output, so absence is the model's recoverable mistake */
  getDocument(name: string): Result<string, { message: string }> {
    const skill = this.skills.get(name);
    if (!skill) {
      return Result.err({ message: `no skill named "${name}" exists` });
    }
    return Result.ok(`# ${skill.title}\n\n${skill.body}`);
  }

  /** the manifest injected into the system prompt every turn: names plus one-line descriptions (§3.5) */
  renderManifest(names: readonly string[]): string {
    return names.map((name) => `- ${name}: ${this.require(name).description}`).join('\n');
  }

  /** boot-time integrity: every configured grant names a skill in the merged library, so nothing about a plugin is discovered mid-turn */
  verifyGrants(profiles: readonly AgentProfile[]): void {
    for (const profile of profiles) {
      for (const name of profile.skills) {
        if (!this.skills.has(name)) {
          throw new Error(
            `agent "${profile.username}" is configured with "${name}", which no skill in the library declares`
          );
        }
      }
    }
  }

  private require(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`no skill named "${name}" exists in the library`);
    }
    return skill;
  }
}
