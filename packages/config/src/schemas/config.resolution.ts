import { MODEL_CONTEXT_WINDOW_TOKENS } from '@collegium/core/common';
import type { z } from 'zod';

import { CONTEXT_BUDGET_CEILING_SHARE, TURN_CONTEXT_WINDOW_SHARE } from '../constants.ts';
import { $ConfigDeclaration } from './config.schemas.ts';

import type { $AgentDeclaration, $ModelRef, $Username } from './config.schemas.ts';

/** config.json as the app reads it: every agent resolved against agentDefaults, its key carried in, and `$schema` dropped */
type ResolvedConfig = Omit<$ConfigDeclaration, '$schema' | 'agents'> & {
  readonly agents: { readonly [username: string]: AgentDefinition };
};

/**
 * The perimeter's cross-references, resolved and checked in one pass so every failure is reported
 * together: each agent's values from agentDefaults, its budget against its turn ceiling, each
 * provider a model names, the system bot against the agent keys, the main channel against its
 * triggering mode.
 */
function resolveConfig(declaration: $ConfigDeclaration, issues: z.core.$ZodRawIssue[]): ResolvedConfig {
  const { $schema: _schema, ...config } = declaration;
  const agents: { [username: string]: AgentDefinition } = {};
  const agentsByMissingProvider = new Map<string, string[]>();
  for (const [username, declared] of Object.entries(config.agents)) {
    for (const [handle, schedule] of Object.entries(declared.schedules)) {
      // membership is held in Mattermost, not here (§3.1); what config can answer is whether the channel exists
      if (!config.mattermost.channels[schedule.channel] && schedule.channel !== config.mattermost.mainChannel) {
        issues.push({
          code: 'custom',
          input: schedule.channel,
          message: `agent "${username}" schedule "${handle}" announces in channel "${schedule.channel}", which mattermost.channels does not declare`,
          path: ['agents', username, 'schedules', handle, 'channel']
        });
      }
    }
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
    const turnContextCeilingTokens = Math.min(
      declared.turnContextCeilingTokens ?? config.agentDefaults.turnContextCeilingTokens,
      Math.floor(MODEL_CONTEXT_WINDOW_TOKENS[model.name] * TURN_CONTEXT_WINDOW_SHARE)
    );
    const contextBudgetTokens =
      declared.contextBudgetTokens ??
      config.agentDefaults.contextBudgetTokens ??
      Math.floor(turnContextCeilingTokens * CONTEXT_BUDGET_CEILING_SHARE);
    // §3.8 — a window the budget allows would end every turn it fills before the model is called
    if (contextBudgetTokens >= turnContextCeilingTokens) {
      issues.push({
        code: 'custom',
        input: contextBudgetTokens,
        message: `agent "${username}" has a context budget of ${contextBudgetTokens} tokens, which is not below its turn ceiling of ${turnContextCeilingTokens}`,
        path:
          declared.contextBudgetTokens === undefined
            ? ['agentDefaults', 'contextBudgetTokens']
            : ['agents', username, 'contextBudgetTokens']
      });
    }
    agents[username] = {
      ...declared,
      completionTimeLimitMs: declared.completionTimeLimitMs ?? config.agentDefaults.completionTimeLimitMs,
      contextBudgetTokens,
      displayName: declared.displayName ?? defaultDisplayNameOf(username),
      model,
      personality: declared.personality ?? config.agentDefaults.personality,
      turnContextCeilingTokens,
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

/** §3.1 — what an agent that declares no display name is called in prose */
export function defaultDisplayNameOf(username: string): string {
  return username.charAt(0).toUpperCase() + username.slice(1);
}

/** an agent entry once agentDefaults are applied and its key is carried in: what the app runs (§3.1) */
export type AgentDefinition = Omit<
  $AgentDeclaration,
  'completionTimeLimitMs' | 'contextBudgetTokens' | 'displayName' | 'model' | 'turnContextCeilingTokens'
> & {
  /** §7.1 — how long one completion may run: the agent's own, else the deployment's default */
  readonly completionTimeLimitMs: number;
  readonly contextBudgetTokens: number;
  readonly displayName: string;
  readonly model: $ModelRef;
  /** the ceiling that applies: the declared one, capped beneath the model's window (§3.8) */
  readonly turnContextCeilingTokens: number;
  readonly username: $Username;
};

export type $Config = z.infer<typeof $Config>;
export const $Config = $ConfigDeclaration.transform((declaration, ctx) => resolveConfig(declaration, ctx.issues));

/** the file an operator (or the e2e harness) writes, as distinct from what the app reads */
export type ConfigInput = z.input<typeof $Config>;
