import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';
import { SystemPromptRenderer } from '@/turns/context/system-prompt.renderer.ts';

import { InspectHandler } from '../inspect.handler.ts';

const MIRA = buildAgentProfile();

describe('InspectHandler', () => {
  let systemPromptRenderer: MockedInstance<SystemPromptRenderer>;
  let inspectHandler: InspectHandler;

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    systemPromptRenderer = MockFactory.createMock(SystemPromptRenderer);
    systemPromptRenderer.render.mockResolvedValue('You are Mira.');
    const skillsService = MockFactory.createMock(SkillsService);
    skillsService.listFor.mockReturnValue([{ description: 'How to hand work over.', name: 'handing-work-to-a-peer' }]);
    const toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listFor.mockReturnValue([
      ['clock', 'now'],
      ['shell', 'run']
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        InspectHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: SystemPromptRenderer, useValue: systemPromptRenderer },
        { provide: SkillsService, useValue: skillsService },
        { provide: ToolRegistry, useValue: toolRegistry }
      ]
    }).compile();
    inspectHandler = moduleRef.get(InspectHandler);
  });

  it('should report the agent with the prompt it would receive in this channel, to the caller alone', async () => {
    const response = await inspectHandler.handle({ channelId: 'channel-1', text: ' mira ', username: 'casey' });
    expect(systemPromptRenderer.render).toHaveBeenCalledWith({ channelId: 'channel-1', profile: MIRA });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: [
        'Agent @mira',
        '- Model: deepseek-v4-flash (deepseek)',
        '- Context budget: 8000 tokens',
        '- Expertise: end-to-end testing',
        '',
        'Tools:',
        '- clock: now',
        '- shell: run',
        '',
        'Skills:',
        '- framework:',
        '  - handing-work-to-a-peer — How to hand work over.',
        '',
        'System prompt in this channel:',
        '```text',
        'You are Mira.',
        '```'
      ].join('\n')
    });
  });

  it('should refuse an unknown agent', async () => {
    const response = await inspectHandler.handle({ channelId: 'channel-1', text: 'dana', username: 'casey' });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'No agent "dana". Usage: /collegium inspect {agent}'
    });
  });

  it('should refuse trailing arguments with the usage line', async () => {
    const response = await inspectHandler.handle({ channelId: 'channel-1', text: 'mira now', username: 'casey' });
    expect(response).toStrictEqual({ audience: 'invoker', text: 'Usage: /collegium inspect {agent}' });
  });
});
