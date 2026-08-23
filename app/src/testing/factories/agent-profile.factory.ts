import type { AgentProfile } from '@/agents/agents.types.ts';

export function buildAgentProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    contextBudgetTokens: 8000,
    expertise: 'end-to-end testing',
    model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
    skills: [],
    systemPrompt: 'You are Mira.',
    tools: [],
    toolSettings: new Map(),
    username: 'mira',
    workspaceDir: '/tmp/workspaces/mira',
    ...overrides
  };
}
