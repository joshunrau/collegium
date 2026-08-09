import type { $QualifiedSkillName, $QualifiedToolName } from '@collegium/core/plugins';

import type { $MemoryCaps, $ModelRef } from '@/config/config.schemas.ts';
import type { SkillName } from '@/skills/skills.types.ts';
import type { ToolName } from '@/tools/tools.types.ts';

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
  readonly memoryCaps: $MemoryCaps;
  readonly model: $ModelRef;
  readonly skills: readonly ($QualifiedSkillName | SkillName)[];
  readonly systemPrompt: string;
  readonly tools: readonly ($QualifiedToolName | ToolName)[];
  readonly username: string;
  /** {workspaceRoot}/{username} — derived, never configurable per agent (§6.1) */
  readonly workspaceDir: string;
};
