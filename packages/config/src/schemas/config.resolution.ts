import type { z } from 'zod';

import { $ConfigDeclaration } from './config.schemas.ts';

import type { $AgentDeclaration, $ModelRef, $Username } from './config.schemas.ts';

/** config.json as the app reads it: every agent resolved against agentDefaults, its key carried in, and `$schema` dropped */
type ResolvedConfig = Omit<$ConfigDeclaration, '$schema' | 'agents'> & {
  readonly agents: { readonly [username: string]: AgentDefinition };
};

/**
 * The perimeter's cross-references, resolved and checked in one pass so every failure is reported
 * together: each agent's values from agentDefaults, each provider a model names, the system bot
 * against the agent keys, the main channel against its triggering mode.
 */
function resolveConfig(declaration: $ConfigDeclaration, issues: z.core.$ZodRawIssue[]): ResolvedConfig {
  const { $schema: _schema, ...config } = declaration;
  const agents: { [username: string]: AgentDefinition } = {};
  const agentsByMissingProvider = new Map<string, string[]>();
  for (const [username, declared] of Object.entries(config.agents)) {
    const model = declared.model ?? config.agentDefaults.model;
    if (!model) {
      issues.push({
        code: 'custom',
        input: declared,
        message: `agent "${username}" names no model, and agentDefaults.model is absent`,
        path: ['agents', username, 'model']
      });
      continue;
    }
    if (!config.providers[model.provider]) {
      agentsByMissingProvider.set(model.provider, [...(agentsByMissingProvider.get(model.provider) ?? []), username]);
    }
    agents[username] = {
      ...declared,
      contextBudgetTokens: declared.contextBudgetTokens ?? config.agentDefaults.contextBudgetTokens,
      model,
      username
    };
  }
  if (Object.keys(config.agents).length === 0) {
    issues.push({
      code: 'custom',
      input: config.agents,
      message: 'at least one agent must be declared',
      path: ['agents']
    });
  }
  for (const [provider, usernames] of agentsByMissingProvider) {
    issues.push({
      code: 'custom',
      input: config.providers,
      message: `provider "${provider}" is named by ${usernames.map((username) => `"${username}"`).join(', ')} but not configured`,
      path: ['providers', provider]
    });
  }
  // one account cannot be both the mechanical voice (§3.2) and an agent that thinks
  if (config.mattermost.systemBotUsername in config.agents) {
    issues.push({
      code: 'custom',
      input: config.mattermost.systemBotUsername,
      message: 'the system bot username must not be an agent username',
      path: ['mattermost', 'systemBotUsername']
    });
  }
  const { mainChannel } = config.mattermost;
  if (config.mattermost.channels[mainChannel]?.triggeringMode === 'respond-to-all') {
    issues.push({
      code: 'custom',
      input: config.mattermost.channels[mainChannel],
      message: 'the main channel is mention-required by definition',
      path: ['mattermost', 'channels', mainChannel, 'triggeringMode']
    });
  }
  return { ...config, agents };
}

/** an agent entry once agentDefaults are applied and its key is carried in: what the app runs (§3.1) */
export type AgentDefinition = Omit<$AgentDeclaration, 'contextBudgetTokens' | 'model'> & {
  readonly contextBudgetTokens: number;
  readonly model: $ModelRef;
  readonly username: $Username;
};

export type $Config = z.infer<typeof $Config>;
export const $Config = $ConfigDeclaration.transform((declaration, ctx) => resolveConfig(declaration, ctx.issues));

/** the file an operator (or the e2e harness) writes, as distinct from what the app reads */
export type ConfigInput = z.input<typeof $Config>;
