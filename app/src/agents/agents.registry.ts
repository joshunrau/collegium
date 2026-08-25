import * as path from 'node:path';

import type { $AgentDefinition, $TriggerMode } from '@collegium/config';
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { resolveEffectiveToolSettings } from '@/tools/tools.settings.ts';
import { FRAMEWORK_TOOLSETS } from '@/tools/tools.toolsets.ts';

import type { AgentProfile } from './agents.types.ts';

@Injectable()
export class AgentRegistry {
  private readonly profiles: ReadonlyMap<string, AgentProfile>;

  constructor(configService: ConfigService, envService: EnvService, pluginsRegistry: PluginsRegistry) {
    const agents = configService.get('agents');
    /** §8 — the two generic settings rules run here, so a bad grant/settings pairing refuses boot */
    const toolSettings = resolveEffectiveToolSettings({
      agents,
      defaults: configService.get('app.defaultToolSettings'),
      toolsets: [...FRAMEWORK_TOOLSETS, ...pluginsRegistry.toolsets]
    });
    const defaults = {
      contextBudgetTokens: configService.get('app.contextBudgetTokens'),
      workspaceRoot: envService.get('WORKSPACE_ROOT')
    };
    this.profiles = new Map(
      agents.map((definition) => [
        definition.username,
        this.toProfile(definition, toolSettings.get(definition.username) ?? new Map(), defaults)
      ])
    );
  }

  get(username: string): AgentProfile | undefined {
    return this.profiles.get(username);
  }

  has(username: string): boolean {
    return this.profiles.has(username);
  }

  /**
   * The addressing rule of §3.3 and §3.10, asked of this module rather than reimplemented by
   * callers. Respond-to-all means a human-authored post, or a mention from an agent or the system
   * bot — never an unaddressed agent post, or agents reply to their own output and loop.
   */
  isAddressedBy(profile: AgentProfile, post: ObservedPost, mode: $TriggerMode): boolean {
    if (post.mentionedUsernames.includes(profile.username)) {
      return true;
    }
    return mode === 'respond-to-all' && post.authorKind === 'human';
  }

  list(): readonly AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * One toolset's parsed settings for this agent, typed by the schema they were parsed against at
   * construction — undefined when the agent is granted none of the toolset's tools. The assertion
   * is interior and honest: the stored value under a namespace is that toolset's own parse output.
   */
  settingsFor<TSettings extends z.ZodType>(
    toolset: { readonly name: string; readonly settings?: TSettings },
    agentUsername: string
  ): undefined | z.infer<TSettings> {
    const profile = this.profiles.get(agentUsername);
    if (!profile) {
      throw new Error(`no agent is registered as "${agentUsername}"`);
    }
    return profile.toolSettings.get(toolset.name) as undefined | z.infer<TSettings>;
  }

  private toProfile(
    definition: $AgentDefinition,
    toolSettings: ReadonlyMap<string, unknown>,
    defaults: { contextBudgetTokens: number; workspaceRoot: string }
  ): AgentProfile {
    return {
      contextBudgetTokens: definition.contextBudgetTokens ?? defaults.contextBudgetTokens,
      expertise: definition.expertise,
      model: definition.model,
      skills: definition.skills,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
      toolSettings,
      username: definition.username,
      workspaceDir: path.join(defaults.workspaceRoot, definition.username)
    };
  }
}
