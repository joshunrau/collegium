import type { $ModelRef, $Personality } from '@collegium/config';
import type { BuiltinSkillName } from '@collegium/core/skills';
import type { ToolGrant } from '@collegium/core/toolsets';
import type { LiteralUnion } from 'type-fest';

export type AgentIdentity = {
  username: string;
};

/**
 * What an agent is, with no notion of running (§3.1). The bot token is deliberately absent: it is a
 * credential the chat seam needs, not something the rest of the system should be able to read.
 */
export type AgentProfile = {
  /** the §5.3 budget this agent's turns start with: its own where config states one, else the deployment's */
  readonly actionBudget: number;
  /** §7.1 — how long one model completion may run before it is aborted and the model told so */
  readonly completionTimeLimitMs: number;
  readonly contextBudgetTokens: number;
  /** what prose calls this agent — its posts' author line, its line under Peers, its bot account — never an @ (§3.1) */
  readonly displayName: string;
  readonly expertise: string;
  readonly model: $ModelRef;
  /** a shipped stance rendered after the agent's own prompt, or none (§3.8) */
  readonly personality: $Personality | undefined;
  readonly skills: readonly LiteralUnion<BuiltinSkillName, string>[];
  readonly systemPrompt: string;
  /** grants exactly as config states them: namespaces and `ns::tool` refs, expanded by the registry (§8) */
  readonly tools: readonly LiteralUnion<ToolGrant, string>[];
  /** namespace → effective settings, parsed at boot against each granted toolset's own schema (§8) */
  readonly toolSettings: ReadonlyMap<string, unknown>;
  /** what a turn's own accumulation is bounded by, already capped beneath the model's window; retention is a share of it (§3.8) */
  readonly turnContextCeilingTokens: number;
  readonly username: string;
  /** {workspaceRoot}/{username} — derived, never configurable per agent (§6.1) */
  readonly workspaceDir: string;
};
