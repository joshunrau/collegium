import * as path from 'node:path';

import { Injectable } from '@nestjs/common';

import type { $AgentDefinition, $MemoryCaps, $TriggerMode } from '@/config/config.schemas.ts';
import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import type { ObservedPost } from '@/conversations/conversations.types.ts';

import type { AgentProfile } from './agents.types.ts';

@Injectable()
export class AgentRegistry {
  private readonly profiles: ReadonlyMap<string, AgentProfile>;

  constructor(configService: ConfigService, envService: EnvService) {
    const defaults = {
      contextBudgetTokens: configService.get('app.contextBudgetTokens'),
      memoryCaps: configService.get('app.memoryCaps'),
      workspaceRoot: envService.get('WORKSPACE_ROOT')
    };
    this.profiles = new Map(
      configService.get('agents').map((definition) => [definition.username, this.toProfile(definition, defaults)])
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

  private toProfile(
    definition: $AgentDefinition,
    defaults: { contextBudgetTokens: number; memoryCaps: $MemoryCaps; workspaceRoot: string }
  ): AgentProfile {
    return {
      contextBudgetTokens: definition.contextBudgetTokens ?? defaults.contextBudgetTokens,
      expertise: definition.expertise,
      memoryCaps: { ...defaults.memoryCaps, ...definition.memoryCaps },
      model: definition.model,
      skills: definition.skills,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
      username: definition.username,
      workspaceDir: path.join(defaults.workspaceRoot, definition.username)
    };
  }
}
