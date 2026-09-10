import { Injectable } from '@nestjs/common';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import type { CompletionRequest } from '@/inference/inference.types.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { toCompletionMessages } from './context.utils.ts';
import { SystemPromptRenderer } from './system-prompt.renderer.ts';

export type AssembledContext = {
  readonly request: CompletionRequest;
  /** which posts the window reached — how a draining turn learns its context fell short (§5.2) */
  readonly windowPostIds: ReadonlySet<string>;
};

/**
 * The six sections of §3.8, from SQLite alone — never the Mattermost API on the turn path. The
 * first four render into the system prompt; tool definitions ride the request's own `tools` field,
 * which is where a provider reads them; the channel window becomes the messages.
 */
@Injectable()
export class ContextAssembler {
  constructor(
    private readonly systemPromptRenderer: SystemPromptRenderer,
    private readonly toolRegistry: ToolRegistry,
    private readonly windowService: WindowService
  ) {}

  async assemble(input: { channelId: string; profile: AgentProfile }): Promise<AssembledContext> {
    const { channelId, profile } = input;
    const [systemPrompt, entries] = await Promise.all([
      this.systemPromptRenderer.render({ channelId, profile }),
      this.windowService.build({
        agentUsername: profile.username,
        budgetTokens: profile.contextBudgetTokens,
        channelId
      })
    ]);
    return {
      request: {
        messages: toCompletionMessages(entries, profile.username),
        modelName: profile.model.name,
        systemPrompt,
        tools: this.toolRegistry.describeFor(profile)
      },
      windowPostIds: new Set(entries.flatMap((entry) => (entry.kind === 'post' ? [entry.post.id] : [])))
    };
  }
}
