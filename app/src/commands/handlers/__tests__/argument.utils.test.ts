import type { AgentDefinition } from '@collegium/config';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { ConfigService } from '@/config/config.service.ts';
import { EnvService } from '@/config/env/env.service.ts';
import { PluginsRegistry } from '@/plugins/plugins.registry.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { createEnvServiceMock } from '@/testing/factories/env-service.factory.ts';

import { requireAgentName, requireAgentProfile, requirePostId } from '../argument.utils.ts';

const MIRA: AgentDefinition = {
  contextBudgetTokens: 8000,
  expertise: 'code review',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: [],
  systemPrompt: 'You are Mira',
  tools: [],
  toolSettings: {},
  username: 'mira'
};

describe('requireAgentName', () => {
  let agentRegistry: AgentRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentRegistry,
        { provide: ConfigService, useValue: createConfigServiceMock({ agents: { mira: MIRA } }) },
        { provide: EnvService, useValue: createEnvServiceMock() },
        { provide: PluginsRegistry, useValue: new PluginsRegistry([]) }
      ]
    }).compile();
    agentRegistry = moduleRef.get(AgentRegistry);
  });

  it('should accept a known agent, trimming the surrounding text', () => {
    const named = requireAgentName(agentRegistry, '  mira  ', 'queue');
    expect(named.value).toBe('mira');
  });

  it('should refuse an unknown agent with the usage line', () => {
    const named = requireAgentName(agentRegistry, 'dana', 'queue');
    expect(named.error).toStrictEqual({
      audience: 'invoker',
      text: 'No agent "dana". Usage: /collegium.queue {agent}'
    });
  });

  it('should resolve the full profile when asked for it', () => {
    expect(requireAgentProfile(agentRegistry, ' mira ', 'prompt').value?.systemPrompt).toBe('You are Mira');
  });
});

describe('requirePostId', () => {
  it('should accept a named post, trimming the surrounding text', () => {
    expect(requirePostId(' post-9 ', 'forget').value).toBe('post-9');
  });

  it('should refuse blank text with the usage line', () => {
    expect(requirePostId('   ', 'forget').error).toStrictEqual({
      audience: 'invoker',
      text: 'Usage: /collegium.forget {post-id}'
    });
  });
});
