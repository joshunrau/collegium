import type { $ModelRef } from '@collegium/config';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import type { WindowEntry } from '@/conversations/conversations.types.ts';
import { PinsService } from '@/conversations/pins/pins.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { DayFormatter } from '@/formatting/dates/day.formatter.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { toCompletionBody } from '@/inference/adapters/openai-compatible.utils.ts';
import { MailRegistry } from '@/mail/mail.registry.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { PromptRenderer } from '../../prompt/prompt.renderer.ts';
import { DateLineSection } from '../../prompt/sections/date-line.section.ts';
import { EarlierActionsSection } from '../../prompt/sections/earlier-actions.section.ts';
import { MemoriesSection } from '../../prompt/sections/memories.section.ts';
import { OpenWorkSection } from '../../prompt/sections/open-work.section.ts';
import { PeersSection } from '../../prompt/sections/peers.section.ts';
import { PinnedPostsSection } from '../../prompt/sections/pinned-posts.section.ts';
import { ContextAssembler } from '../context.assembler.ts';

const PROFILE: AgentProfile = {
  actionBudget: 25,
  contextBudgetTokens: 1000,
  displayName: 'Mira',
  expertise: 'testing',
  model: { name: 'deepseek-v4-flash', provider: 'deepseek' },
  personality: undefined,
  skills: ['handing-work-to-a-peer'],
  systemPrompt: 'You are Mira.',
  tools: ['load_skill'],
  toolSettings: new Map(),
  turnContextCeilingTokens: 27_200,
  username: 'mira',
  workspaceDir: '/tmp/workspaces/mira'
};

const postRow = (author: string, message: string, at: number): ModelRow<'Post'> => ({
  attachments: null,
  authoringTurnId: null,
  authorKind: author === 'casey' ? 'human' : 'agent',
  authorUsername: author,
  channelId: 'channel-1',
  createdAt: new Date(at),
  id: `post-${at}`,
  isForgotten: false,
  isPinned: false,
  kind: 'message',
  message,
  observedAt: new Date(at)
});

const post = (author: string, message: string, at: number): WindowEntry => ({
  kind: 'post',
  post: postRow(author, message, at)
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
  let promptRenderer: MockedInstance<PromptRenderer>;
  let windowService: MockedInstance<WindowService>;

  beforeEach(async () => {
    promptRenderer = MockFactory.createMock(PromptRenderer);
    promptRenderer.renderParts.mockResolvedValue({ stable: 'You are Mira.\n\n## How this works', tail: '[notes]' });
    const toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.describeFor.mockReturnValue([{ description: 'Load a skill.', name: 'load_skill', parameters: {} }]);
    windowService = MockFactory.createMock(WindowService);
    windowService.build.mockResolvedValue({ entries: [], oldestAt: undefined });
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.displayNameOf.mockImplementation((username) => (username === 'tess' ? 'Tess Okafor' : username));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextAssembler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: PromptRenderer, useValue: promptRenderer },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService }
      ]
    }).compile();
    contextAssembler = moduleRef.get(ContextAssembler);
  });

  const assemble = () => {
    return contextAssembler
      .assemble({ channelId: 'channel-1', profile: PROFILE, turnId: 'turn-2' })
      .then(({ request }) => request);
  };

  it('should put the stable prompt and the tool definitions on the request', async () => {
    const request = await assemble();
    expect(request.systemPrompt).toBe('You are Mira.\n\n## How this works');
    expect(request.tools.map((tool) => tool.name)).toStrictEqual(['load_skill']);
  });

  it('should follow the window with the tail as a user message, after the line closing its own turn (§3.8, §5.2)', async () => {
    promptRenderer.renderParts.mockResolvedValue({ stable: 'You are Mira.', tail: '[notes]\n\n## Open work' });
    windowService.build.mockResolvedValue({
      entries: [post('casey', 'hello @mira', 1000), post('mira', 'on it', 2000)],
      oldestAt: new Date(1000)
    });
    expect((await assemble()).messages).toStrictEqual([
      { content: 'casey (person): hello @mira', role: 'user' },
      { content: 'on it', role: 'assistant' },
      { content: expect.stringContaining('your previous turn ended here'), role: 'user' },
      { content: '[notes]\n\n## Open work', role: 'user' }
    ]);
  });

  it('should keep the cache key stable per agent and channel', async () => {
    const initial = await assemble();
    windowService.build.mockResolvedValue({ entries: [post('casey', 'new message', 1000)], oldestAt: new Date(1000) });
    expect((await assemble()).cacheKey).toBe(initial.cacheKey);
    const otherChannel = await contextAssembler.assemble({
      channelId: 'channel-2',
      profile: PROFILE,
      turnId: 'turn-2'
    });
    const otherAgent = await contextAssembler.assemble({
      channelId: 'channel-1',
      profile: { ...PROFILE, username: 'tess' },
      turnId: 'turn-2'
    });
    expect(otherChannel.request.cacheKey).not.toBe(initial.cacheKey);
    expect(otherAgent.request.cacheKey).not.toBe(initial.cacheKey);
  });

  it('should render the window with peer posts as attributed user messages and own posts as assistant', async () => {
    windowService.build.mockResolvedValue({
      entries: [
        post('casey', 'hello @mira', 1000),
        post('mira', 'on it', 2000),
        event({ content: 'checking', kind: 'assistant_message', toolCalls: [] }, 3000),
        event({ callId: 'c1', kind: 'tool_result', output: 'the body', toolName: 'read_memory' }, 4000),
        post('tess', 'thanks', 5000)
      ],
      oldestAt: new Date(1000)
    });
    const request = await assemble();
    expect(request.messages).toStrictEqual([
      { content: 'casey (person): hello @mira', role: 'user' },
      { content: 'on it', role: 'assistant' },
      { content: 'checking', role: 'assistant' },
      { content: 'Tess Okafor (agent): thanks', role: 'user' },
      { content: '[notes]', role: 'user' }
    ]);
  });

  it('should drop a call history cannot answer rather than send a native call a provider would reject', async () => {
    windowService.build.mockResolvedValue({
      entries: [
        event(
          {
            content: '',
            kind: 'assistant_message',
            toolCalls: [{ args: { path: 'notes.md' }, callId: 'c9', toolName: 'write_file' }]
          },
          1000
        ),
        event({ approvalId: 'a1', byUsername: 'casey', decision: 'denied', kind: 'approval_decided' }, 2000)
      ],
      oldestAt: new Date(1000)
    });
    const request = await assemble();
    expect(request.messages).toStrictEqual([
      { content: '[approval denied]', role: 'user' },
      { content: '[notes]', role: 'user' }
    ]);
  });

  it("should pass the window's oldest instant to the prompt renderer", async () => {
    windowService.build.mockResolvedValue({ entries: [], oldestAt: new Date(1000) });
    await assemble();
    expect(promptRenderer.renderParts).toHaveBeenCalledWith({
      channelId: 'channel-1',
      profile: PROFILE,
      windowReachesBackTo: new Date(1000)
    });
  });
});

describe('ContextAssembler across two turns', () => {
  let contextAssembler: ContextAssembler;
  let memoryService: MockedInstance<MemoryService>;
  let pinsService: MockedInstance<PinsService>;
  let rosterService: MockedInstance<RosterService>;
  let tasksService: MockedInstance<TasksService>;
  let windowService: MockedInstance<WindowService>;

  const peer = (username: string) => ({ ...PROFILE, displayName: username, expertise: 'scheduling', username });

  const firstWindow = [
    post('casey', 'hello @mira', 1000),
    post('mira', 'on it', 2000),
    post('casey', 'and @mira', 3000)
  ];

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date('2026-09-21T12:00:00Z'), toFake: ['Date'] });
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.settingsFor.mockReturnValue({ maxBodyChars: 16_000, maxDescriptionChars: 200, maxEntries: 50 });
    const mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.mailboxFor.mockReturnValue(undefined);
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullets', reference: 'memory-1' }]);
    pinsService = MockFactory.createMock(PinsService);
    pinsService.listPinned.mockResolvedValue([]);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([peer('tess')]);
    const shellService = MockFactory.createMock(ShellService);
    shellService.listPresentCommands.mockReturnValue([]);
    const skillsService = MockFactory.createMock(SkillsService);
    skillsService.renderManifest.mockReturnValue('- triage: Investigate a problem.');
    tasksService = MockFactory.createMock(TasksService);
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        createdAt: new Date('2026-09-21T11:55:00Z'),
        creatorUsername: 'mira',
        outcome: 'a venue shortlist',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    const toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.describeFor.mockReturnValue([{ description: 'Assign work.', name: 'tasks__assign', parameters: {} }]);
    toolRegistry.listBudgetExemptFor.mockReturnValue([]);
    toolRegistry.listFor.mockReturnValue([
      { gates: false, id: ['memory', 'write'] },
      { gates: false, id: ['tasks', 'assign'] }
    ]);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue(['tasks']);
    toolRegistry.listSupersedableFor.mockReturnValue([]);
    windowService = MockFactory.createMock(WindowService);
    windowService.build.mockResolvedValue({ entries: firstWindow, oldestAt: new Date(1000) });
    windowService.readRecentActions.mockResolvedValue([]);
    windowService.listRecentPeople.mockResolvedValue(['casey']);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextAssembler,
        DateLineSection,
        DayFormatter,
        EarlierActionsSection,
        MemoriesSection,
        OpenWorkSection,
        PeersSection,
        PinnedPostsSection,
        PromptRenderer,
        TextFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: MailRegistry, useValue: mailRegistry },
        { provide: MemoryService, useValue: memoryService },
        { provide: PinsService, useValue: pinsService },
        { provide: RosterService, useValue: rosterService },
        { provide: ShellService, useValue: shellService },
        { provide: SkillsService, useValue: skillsService },
        { provide: TasksService, useValue: tasksService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService }
      ]
    }).compile();
    contextAssembler = moduleRef.get(ContextAssembler);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<$ModelRef>([
    { name: 'deepseek-v4-flash', provider: 'deepseek' },
    { name: 'z-ai/glm-5.3', provider: 'openrouter' },
    { name: 'anthropic/claude-sonnet-5', provider: 'openrouter' },
    { name: 'openai/gpt-5.6-sol', provider: 'openrouter' }
  ])(
    'should send $name the same bytes through the window when memories, pins, people, peers, ages and the day change (§3.8)',
    async (model) => {
      const wireBody = async () => {
        const { request } = await contextAssembler.assemble({
          channelId: 'channel-1',
          profile: { ...PROFILE, model },
          turnId: 'turn-2'
        });
        return toCompletionBody(request);
      };
      const first = await wireBody();
      vi.setSystemTime(new Date('2026-09-22T13:00:00Z'));
      windowService.build.mockResolvedValue({
        entries: [...firstWindow, post('mira', 'done', 4000), post('casey', 'thanks @mira', 5000)],
        oldestAt: new Date(1000)
      });
      memoryService.list.mockResolvedValue([{ description: 'casey prefers numbered lists', reference: 'memory-2' }]);
      pinsService.listPinned.mockResolvedValue([postRow('casey', 'cite the registry for every lead', 1000)]);
      rosterService.getPeers.mockReturnValue([peer('tess'), peer('owen')]);
      windowService.listRecentPeople.mockResolvedValue(['robin', 'casey']);
      const second = await wireBody();
      const tailIndex = first.messages.length - 1;
      expect(first.messages[tailIndex]).toMatchObject({
        content: expect.stringContaining('## Open work'),
        role: 'user'
      });
      expect(second.messages.slice(0, tailIndex)).toStrictEqual(first.messages.slice(0, tailIndex));
      expect({ ...second, messages: [] }).toStrictEqual({ ...first, messages: [] });
      expect(second.messages.at(-1)).not.toStrictEqual(first.messages.at(-1));
    }
  );
});
