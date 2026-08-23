import type { LiteralUnion } from 'type-fest';

import type { $ModelRef } from '@/config/config.schemas.ts';
import type { SkillName } from '@/skills/skills.types.ts';
import type { ToolGrant } from '@/tools/tools.types.ts';

export type AgentIdentity = {
  username: string;
};

/**
 * What an agent is, with no notion of running (§3.1). The bot token is deliberately absent: it is a
 * credential the chat seam needs, not something the rest of the system should be able to read.
 */
export type AgentProfile = {
  readonly contextBudgetTokens: number;
  readonly expertise: string;
  readonly model: $ModelRef;
  readonly skills: readonly LiteralUnion<SkillName, string>[];
  readonly systemPrompt: string;
  /** grants exactly as config states them: namespaces and `ns::tool` refs, expanded by the registry (§8) */
  readonly tools: readonly LiteralUnion<ToolGrant, string>[];
  /** namespace → effective settings, parsed at boot against each granted toolset's own schema (§8) */
  readonly toolSettings: ReadonlyMap<string, unknown>;
  readonly username: string;
  /** {workspaceRoot}/{username} — derived, never configurable per agent (§6.1) */
  readonly workspaceDir: string;
};
