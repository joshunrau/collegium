import type { AgentProfile } from '@/agents/agents.types.ts';
import type { TextFormatter } from '@/formatting/text/text.formatter.ts';
import type { GrantedTool } from '@/tools/tools.registry.ts';

/** §3.8 — what a turn is told beside its window: the system prompt ahead of it, and the sections that may change between turns after it */
export type TurnPrompt = {
  readonly stable: string;
  /** absent when no section has anything to say, so no empty message follows the window */
  readonly tail: string | undefined;
};

export type TurnPromptInput = {
  readonly channelId: string;
  readonly profile: AgentProfile;
  /** the instant the window reaches back to, where the earlier-action lines pick up; absent for an empty window */
  readonly windowReachesBackTo: Date | undefined;
};

/** §3.8 — what the sections ahead of the window are written from: the agent, and what the registries and configuration report of it */
export type StablePromptInput = {
  readonly budgetExemptCalls: readonly string[];
  /** §4.4 — how often one turn may start over for a further post, stated in the preamble */
  readonly foldLimit: number;
  readonly granted: readonly GrantedTool[];
  readonly mailbox: StablePromptMailbox | undefined;
  readonly presentCommands: readonly string[];
  readonly profile: AgentProfile;
  readonly skillsManifest: string;
  readonly supersedableCalls: readonly string[];
  readonly textFormatter: TextFormatter;
};

export type StablePromptMailbox = {
  readonly address: string;
  readonly announcementChannelName: string | undefined;
};

/** one paragraph of the baseline or the preamble, or nothing where its topic does not apply to this agent */
export type StableParagraph = (input: StablePromptInput) => string | undefined;
