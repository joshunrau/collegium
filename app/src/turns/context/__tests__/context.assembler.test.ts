import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { ContextAssembler } from '../context.assembler.ts';

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
    const memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullet points', reference: 'memory-1' }]);
    const rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([{ expertise: 'scheduling', username: 'tess' } as AgentProfile]);
    const skillsService = MockFactory.createMock(SkillsService);
    skillsService.renderManifest.mockReturnValue('- handing-work-to-a-peer: How to hand work over.');
    const toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.describeFor.mockReturnValue([{ description: 'Load a skill.', name: 'load_skill', parameters: {} }]);
    windowService = MockFactory.createMock(WindowService);
    windowService.build.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextAssembler,
        { provide: MemoryService, useValue: memoryService },
        { provide: RosterService, useValue: rosterService },
        { provide: SkillsService, useValue: skillsService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService }
      ]
    }).compile();
    contextAssembler = moduleRef.get(ContextAssembler);
  });

  const assemble = () => {
    return contextAssembler.assemble({ channelId: 'channel-1', profile: PROFILE }).then(({ request }) => request);
  };

  it('should carry every section of §3.8 in order in the system prompt', async () => {
    const request = await assemble();
    const indices = [
      'You are Mira.',
      'handing-work-to-a-peer',
      'casey prefers bullet points',
      '@tess — scheduling'
    ].map((needle) => request.systemPrompt.indexOf(needle));
    expect(indices.every((index) => index >= 0)).toBe(true);
    expect([...indices].sort((a, b) => a - b)).toStrictEqual(indices);
    expect(request.tools.map((tool) => tool.name)).toStrictEqual(['load_skill']);
  });

  it('should render the same prompt standalone as it puts on the turn path', async () => {
    const request = await assemble();
    const standalone = await contextAssembler.renderPromptFor({ channelId: 'channel-1', profile: PROFILE });
    expect(standalone).toBe(request.systemPrompt);
  });

  it('should carry memory descriptions in the system prompt, never bodies', async () => {
    const request = await assemble();
    expect(request.systemPrompt).toContain('[memory-1] casey prefers bullet points');
    expect(request.systemPrompt).not.toContain('read_memory result');
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
      { content: 'checking', role: 'assistant' },
      { content: '[read_memory result] the body', role: 'user' }
    ]);
  });

  it('should render a dangling tool call as text rather than a native call a provider would reject', async () => {
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
    expect(request.messages).toStrictEqual([
      { content: '[called write_file({"path":"notes.md"})]', role: 'assistant' },
      { content: '[approval denied]', role: 'user' }
    ]);
  });
});
