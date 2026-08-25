import type { ToolResult, ToolTurnScope } from '@collegium/core/tools';
import type { AnyTool } from '@collegium/core/toolsets';

export function buildToolTurnScope(overrides: Partial<ToolTurnScope> = {}): ToolTurnScope {
  return {
    agentUsername: 'mira',
    channelId: 'channel-1',
    triggeringPostId: 'post-1',
    turnId: 'turn-1',
    ...overrides
  };
}

/**
 * Runs one concrete toolset tool through the loose `AnyTool` surface, exactly as the executor
 * will: parsed args and an assembled context, with mocked services riding beside the turn.
 */
export async function executeTool(
  tool: AnyTool,
  args: unknown,
  context: { readonly [key: string]: unknown; readonly turn: ToolTurnScope }
): Promise<ToolResult> {
  return tool.execute(args, context);
}
