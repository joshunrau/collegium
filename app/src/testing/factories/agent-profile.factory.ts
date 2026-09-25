import { defaultDisplayNameOf } from '@collegium/config';

import type { AgentProfile } from '@/agents/agents.types.ts';

export function buildAgentProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  const username = overrides.username ?? 'mira';
  return {
    actionBudget: 25,
    completionTimeLimitMs: 1_200_000,
    contextBudgetTokens: 8000,
    displayName: defaultDisplayNameOf(username),
    expertise: 'end-to-end testing',
    model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
    personality: undefined,
    skills: [],
    systemPrompt: 'You are Mira.',
    tools: [],
    toolSettings: new Map(),
    turnContextCeilingTokens: 27_200,
    username,
    workspaceDir: '/tmp/workspaces/mira',
    ...overrides
  };
}
