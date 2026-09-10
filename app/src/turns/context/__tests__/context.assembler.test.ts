import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { ContextAssembler } from '../context.assembler.ts';
import { SystemPromptRenderer } from '../system-prompt.renderer.ts';

const PROFILE: AgentProfile = {
  contextBudgetTokens: 1000,
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  skills: ['handing-work-to-a-peer'],
  systemPrompt: 'You are Mira.',
  tools: ['load_skill'],
  toolSettings: new Map(),
  username: 'mira',
  workspaceDir: '/tmp/workspaces/mira'
};

const post = (author: string, message: string, at: number): WindowEntry => ({
  kind: 'post',
  post: {
    authoringTurnId: null,
    authorKind: author === 'casey' ? 'human' : 'agent',
    authorUsername: author,
    channelId: 'channel-1',
    createdAt: new Date(at),
    id: `post-${at}`,
    isForgotten: false,
    message,
    observedAt: new Date(at)
  }
});

const event = (payload: PrismaJson.TurnEventPayload, at: number): WindowEntry => ({
  event: {
    createdAt: new Date(at),
    id: `event-${at}`,
    kind: payload.kind,
    payload,
    sequence: 0,
    turnId: 'turn-1'
  },
  kind: 'event'
});

describe('ContextAssembler', () => {
  let contextAssembler: ContextAssembler;
  let windowService: MockedInstance<WindowService>;

  beforeEach(async () => {
    const systemPromptRenderer = MockFactory.createMock(SystemPromptRenderer);
    systemPromptRenderer.render.mockResolvedValue('You are Mira.\n\n## How this works');
    const toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.describeFor.mockReturnValue([{ description: 'Load a skill.', name: 'load_skill', parameters: {} }]);
    windowService = MockFactory.createMock(WindowService);
    windowService.build.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextAssembler,
        { provide: SystemPromptRenderer, useValue: systemPromptRenderer },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService }
      ]
    }).compile();
    contextAssembler = moduleRef.get(ContextAssembler);
  });

  const assemble = () => {
    return contextAssembler.assemble({ channelId: 'channel-1', profile: PROFILE }).then(({ request }) => request);
  };

  it('should put the rendered prompt and the tool definitions on the request', async () => {
    const request = await assemble();
    expect(request.systemPrompt).toBe('You are Mira.\n\n## How this works');
    expect(request.tools.map((tool) => tool.name)).toStrictEqual(['load_skill']);
  });

  it('should render the window with peer posts as attributed user messages and own posts as assistant', async () => {
    windowService.build.mockResolvedValue([
      post('casey', 'hello @mira', 1000),
      post('mira', 'on it', 2000),
      event({ content: 'checking', kind: 'assistant_message', toolCalls: [] }, 3000),
      event({ callId: 'c1', kind: 'tool_result', output: 'the body', toolName: 'read_memory' }, 4000)
    ]);
    const request = await assemble();
    expect(request.messages).toStrictEqual([
      { content: '@casey: hello @mira', role: 'user' },
      { content: 'on it', role: 'assistant' },
      { content: 'checking', role: 'assistant' }
    ]);
  });

  it('should drop a call history cannot answer rather than send a native call a provider would reject', async () => {
    windowService.build.mockResolvedValue([
      event(
        {
          content: '',
          kind: 'assistant_message',
          toolCalls: [{ args: { path: 'notes.md' }, callId: 'c9', toolName: 'write_file' }]
        },
        1000
      ),
      event({ approvalId: 'a1', byUsername: 'casey', decision: 'denied', kind: 'approval_decided' }, 2000)
    ]);
    const request = await assemble();
    expect(request.messages).toStrictEqual([{ content: '[approval denied]', role: 'user' }]);
  });
});
