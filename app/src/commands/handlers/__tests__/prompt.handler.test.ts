import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ContextAssembler } from '@/turns/context/context.assembler.ts';

import { PromptHandler } from '../prompt.handler.ts';

const MIRA = { username: 'mira' } as AgentProfile;

describe('PromptHandler', () => {
  let contextAssembler: MockedInstance<ContextAssembler>;
  let promptHandler: PromptHandler;

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    contextAssembler = MockFactory.createMock(ContextAssembler);
    contextAssembler.renderPromptFor.mockResolvedValue('You are Mira.');
    const moduleRef = await Test.createTestingModule({
      providers: [
        PromptHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ContextAssembler, useValue: contextAssembler }
      ]
    }).compile();
    promptHandler = moduleRef.get(PromptHandler);
  });

  it('should render the prompt the agent would receive in this channel, to the caller alone', async () => {
    const response = await promptHandler.handle({ channelId: 'channel-1', text: ' mira ', username: 'casey' });
    expect(contextAssembler.renderPromptFor).toHaveBeenCalledWith({ channelId: 'channel-1', profile: MIRA });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'System prompt for @mira in this channel:\n```text\nYou are Mira.\n```'
    });
  });

  it('should refuse an unknown agent', async () => {
    const response = await promptHandler.handle({ channelId: 'channel-1', text: 'dana', username: 'casey' });
    expect(response).toStrictEqual({
      audience: 'invoker',
      text: 'No agent "dana". Usage: /prompt {agent}'
    });
  });

  it('should refuse trailing arguments with the usage line', async () => {
    const response = await promptHandler.handle({ channelId: 'channel-1', text: 'mira now', username: 'casey' });
    expect(response).toStrictEqual({ audience: 'invoker', text: 'Usage: /prompt {agent}' });
  });
});
