import { Result } from '@collegium/core/utils';

import type { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';

import { renderUsage } from '../commands.definitions.ts';

import type { CommandTrigger } from '../commands.definitions.ts';
import type { CommandResponse } from '../commands.types.ts';

/** the shared refusal for a command that names no known agent */
export function requireAgentName(
  agentRegistry: AgentRegistry,
  text: string,
  trigger: CommandTrigger
): Result<string, CommandResponse> {
  const named = requireAgentProfile(agentRegistry, text, trigger);
  return named.success ? Result.ok(named.value.username) : named;
}

/** the same refusal, for a command that needs the profile rather than only the name */
export function requireAgentProfile(
  agentRegistry: AgentRegistry,
  text: string,
  trigger: CommandTrigger
): Result<AgentProfile, CommandResponse> {
  const agentUsername = text.trim();
  const profile = agentRegistry.get(agentUsername);
  if (profile === undefined) {
    return Result.err({ audience: 'invoker', text: `No agent "${agentUsername}". ${renderUsage(trigger)}` });
  }
  return Result.ok(profile);
}

/** the shared refusal for a command that names no post */
export function requirePostId(text: string, trigger: CommandTrigger): Result<string, CommandResponse> {
  const postId = text.trim();
  if (postId === '') {
    return Result.err({ audience: 'invoker', text: renderUsage(trigger) });
  }
  return Result.ok(postId);
}
