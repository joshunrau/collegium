import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import type { CompletionRequest } from '@/inference/inference.types.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { PromptRenderer } from '../prompt/prompt.renderer.ts';
import { estimateWindowTokens, toCompletionMessages } from './context.utils.ts';

type AssembleInput = {
  readonly channelId: string;
  readonly profile: AgentProfile;
  /** the turn in progress: its own rounds are the only ones handed back with their reasoning (§3.12) */
  readonly turnId: string;
};

export type AssembledContext = {
  /** §5.2 — taken before the store is read, so every post recorded earlier was there to be read */
  readonly assembledAt: Date;
  /** §5.2 — how far back the window reached, for the line a draining turn owes when that fell short; absent for an empty window */
  readonly reachesBackTo: Date | undefined;
  readonly request: CompletionRequest;
  /** which posts the window reached — how a draining turn learns its context fell short (§5.2) */
  readonly windowPostIds: ReadonlySet<string>;
};

/**
 * The sections of §3.8, from SQLite alone — never the Mattermost API on the turn path. The system
 * prompt leads; tool definitions ride the request's own `tools` field, which is where a provider
 * reads them; the channel window becomes the messages, and the sections that change between turns
 * follow it as one message of their own. The window is built first because the earlier-action
 * lines begin where it reaches back to.
 */
@Injectable()
export class ContextAssembler {
  constructor(
    private readonly promptRenderer: PromptRenderer,
    private readonly toolRegistry: ToolRegistry,
    private readonly windowService: WindowService
  ) {}

  async assemble(input: AssembleInput): Promise<AssembledContext> {
    const { channelId, profile, turnId } = input;
    const assembledAt = new Date();
    const { entries, oldestAt } = await this.windowService.build({
      agentUsername: profile.username,
      budgetTokens: profile.contextBudgetTokens,
      channelId,
      costOf: (candidates) => estimateWindowTokens(candidates, profile.username)
    });
    const { stable, tail } = await this.promptRenderer.renderParts({
      channelId,
      profile,
      windowReachesBackTo: oldestAt
    });
    return {
      assembledAt,
      reachesBackTo: oldestAt,
      request: {
        cacheKey: JSON.stringify([profile.username, channelId]),
        // §3.8 — a user-role message, since a provider may hoist a system message ahead of the window
        messages: [
          ...toCompletionMessages(entries, profile.username, turnId),
          ...(tail === undefined ? [] : [{ content: tail, role: 'user' as const }])
        ],
        model: profile.model,
        systemPrompt: stable,
        tools: this.toolRegistry.describeFor(profile)
      },
      windowPostIds: new Set(entries.flatMap((entry) => (entry.kind === 'post' ? [entry.post.id] : [])))
    };
  }
}
