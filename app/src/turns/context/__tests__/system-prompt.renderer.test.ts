import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { SystemPromptRenderer } from '../system-prompt.renderer.ts';

const PROFILE = {
  actionBudget: 7,
  contextBudgetTokens: 12_000,
  contextWindowTokens: 32_000,
  expertise: 'testing',
  systemPrompt: 'You are Mira.',
  username: 'mira',
  workspaceDir: '/var/lib/collegium/workspaces/mira'
} as AgentProfile;

const PEER = { expertise: 'scheduling', username: 'tess' } as AgentProfile;

describe('SystemPromptRenderer', () => {
  let memoryService: MockedInstance<MemoryService>;
  let rosterService: MockedInstance<RosterService>;
  let shellService: MockedInstance<ShellService>;
  let skillsService: MockedInstance<SkillsService>;
  let systemPromptRenderer: SystemPromptRenderer;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let windowService: MockedInstance<WindowService>;
  let agentRegistry: MockedInstance<AgentRegistry>;
  let tasksService: MockedInstance<TasksService>;

  beforeEach(async () => {
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([]);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([]);
    shellService = MockFactory.createMock(ShellService);
    shellService.listPresentCommands.mockReturnValue(['node', 'git']);
    skillsService = MockFactory.createMock(SkillsService);
    skillsService.renderManifest.mockReturnValue('');
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listBudgetExemptFor.mockReturnValue(['builtins__now', 'skills__load']);
    toolRegistry.listSupersedableFor.mockReturnValue([]);
    toolRegistry.listFor.mockReturnValue([]);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue([]);
    windowService = MockFactory.createMock(WindowService);
    windowService.reachesBackTo.mockReturnValue(undefined);
    windowService.readRecentActions.mockResolvedValue([]);
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.settingsFor.mockReturnValue(undefined);
    tasksService = MockFactory.createMock(TasksService);
    tasksService.listOpenFor.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SystemPromptRenderer,
        TextFormatter,
        { provide: MemoryService, useValue: memoryService },
        { provide: RosterService, useValue: rosterService },
        { provide: ShellService, useValue: shellService },
        { provide: SkillsService, useValue: skillsService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService },
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: TasksService, useValue: tasksService }
      ]
    }).compile();
    systemPromptRenderer = moduleRef.get(SystemPromptRenderer);
  });

  const render = () => systemPromptRenderer.render({ channelId: 'channel-1', profile: PROFILE });

  const renderParts = (windowReachesBackTo: Date | undefined = undefined) => {
    return systemPromptRenderer.renderParts({ channelId: 'channel-1', profile: PROFILE, windowReachesBackTo });
  };

  it('should include the behavioral baseline without an optional personality', async () => {
    const prompt = await render();
    expect(prompt.startsWith('You are Mira.\n\n## How you work\n\nBegin once')).toBe(true);
    expect(prompt.indexOf('## How this works')).toBeGreaterThan(prompt.indexOf('## How you work'));
    expect(prompt).not.toContain('## Personality');
    expect(prompt).not.toContain('## Skills');
    expect(prompt).not.toContain('## Memories');
    expect(prompt).not.toContain('## Peers');
  });

  it('should place an optional personality between the behavioral baseline and the preamble', async () => {
    const prompt = await systemPromptRenderer.render({
      channelId: 'channel-1',
      profile: { ...PROFILE, personality: 'candid' }
    });
    expect(prompt.startsWith('You are Mira.\n\n## How you work\n\nBegin once')).toBe(true);
    expect(prompt.indexOf('## Personality')).toBeGreaterThan(prompt.indexOf('## How you work'));
    expect(prompt.indexOf('## Personality')).toBeLessThan(prompt.indexOf('## How this works'));
    expect(prompt).toContain('## Personality\n\nThe stance you take here:\n\n');
    expect(prompt).toContain('Never apologize for disagreeing.');
  });

  it('should state the configured budgets and the calls exempt from them in the preamble', async () => {
    const prompt = await render();
    expect(prompt).toContain('fits the recent posts and records in this channel to about 12000 tokens');
    expect(prompt).toContain('Each turn has 7 attempts.');
    expect(prompt).toContain('Calls to builtins__now and skills__load spend none.');
    expect(prompt).toContain('at most 20 of them, newest first');
  });

  it('should state the retention rule for the calls whose results fold, from the model window (§3.8)', async () => {
    toolRegistry.listSupersedableFor.mockReturnValue(['web__fetch', 'workspace__read']);
    const prompt = await render();
    expect(prompt).toContain(
      'results of web__fetch and workspace__read are kept word for word up to about 10,000 tokens of them and never fewer than the 2 most recent'
    );
    expect(prompt).toContain('Text you write yourself is never replaced.');
    expect(prompt).not.toContain("Each tool result in a turn stays in that turn's context.");
  });

  it('should say every result stays for an agent holding no tool whose results fold (§3.8)', async () => {
    const prompt = await render();
    expect(prompt).toContain("Each tool result in a turn stays in that turn's context.");
  });

  it('should render the memory paragraphs only for an agent that holds memory (§3.8)', async () => {
    const without = await render();
    expect(without).not.toContain('Memory is for what a later turn will need');
    expect(without).not.toContain('Your memories go with you between channels');
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['memory', 'write'] }]);
    const held = await render();
    expect(held).toContain('Memory is for what a later turn will need and cannot look up');
    expect(held).toContain('Your memories go with you between channels');
    expect(held).toContain('The text of a memory is not posted in the channel.');
  });

  it('should say how a post names its author, and that the line is not a mention (§3.8)', async () => {
    const prompt = await render();
    expect(prompt).toContain(
      'as `username (person):`, `username (agent):` or `username (system):`. That line names the author and is not a mention.'
    );
  });

  it('should state the options ask__human may offer only for an agent that holds it (§3.7a)', async () => {
    expect(await render()).not.toContain('ask__human');
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['ask', 'human'] }]);
    expect(await render()).toContain(
      'It may offer two to six short answers as buttons; the person may type something else.'
    );
  });

  it('should name no directory for an agent holding no file tool (§3.8)', async () => {
    const prompt = await render();
    expect(prompt).not.toContain('share one directory');
    expect(prompt).not.toContain('shell__run runs');
    expect(prompt).not.toContain('These commands are present');
  });

  it('should name the workspace directory for an agent holding a workspace tool (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['workspace', 'read'] }]);
    const prompt = await render();
    expect(prompt).toContain(
      'workspace__read and workspace__write share one directory, /var/lib/collegium/workspaces/mira.'
    );
    expect(prompt).not.toContain('shell__run');
  });

  it('should name the shell home alone for an agent holding shell run without a workspace tool (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: true, id: ['shell', 'run'] }]);
    const prompt = await render();
    expect(prompt).toContain(
      'shell__run runs each command as your own OS user, starting in /home/collegium-mira. The shell runs under bash with pipefail. Beside the usual POSIX utilities, these commands are present: node and git. The shell reaches the network under no address policy.'
    );
    expect(prompt).not.toContain('but not write it');
  });

  it('should name both directories, the shell user’s read-only view of the workspace and the output spill for an agent holding both (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([
      { gates: true, id: ['shell', 'run'] },
      { gates: false, id: ['workspace', 'read'] }
    ]);
    expect(await render()).toContain(
      'workspace__read and workspace__write share one directory, /var/lib/collegium/workspaces/mira.\n\nshell__run runs each command as your own OS user, starting in /home/collegium-mira. That user can read /var/lib/collegium/workspaces/mira but not write it, and the workspace tools cannot reach /home/collegium-mira. Where a shell output is too large for a result, the framework, not your shell user, saves it into /var/lib/collegium/workspaces/mira and names the file in the result. The shell runs under bash with pipefail.'
    );
  });

  it('should say nothing about commands when the probe found none (§3.8)', async () => {
    shellService.listPresentCommands.mockReturnValue([]);
    toolRegistry.listFor.mockReturnValue([{ gates: true, id: ['shell', 'run'] }]);
    const prompt = await render();
    expect(prompt).toContain(
      'The shell runs under bash with pipefail. The shell reaches the network under no address policy.'
    );
    expect(prompt).not.toContain('These commands are present');
  });

  it('should carry the directories in the stable half and no clock or host state in either (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['workspace', 'read'] }]);
    const { dynamic, stable } = await renderParts();
    expect(stable).toContain('share one directory');
    expect(dynamic).not.toContain('share one directory');
    expect(`${stable}\n${dynamic}`).not.toMatch(/\bgit\b|\bbranch\b|\bcommit\b|\d{4}-\d{2}-\d{2}/u);
  });

  it('should state what conversations__search reaches only for an agent that holds it (§3.8)', async () => {
    expect(await render()).not.toContain('conversations__search');
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['conversations', 'search'] }]);
    expect(await render()).toContain('conversations__search finds past posts in the channels you are in.');
  });

  it('should append the skills, memories, and peers sections in §3.8 order', async () => {
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullet points', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    skillsService.renderManifest.mockReturnValue('- handing-work-to-a-peer: How to hand work over.');
    const prompt = await render();
    expect(prompt.slice(prompt.indexOf('## Skills'))).toBe(`## Skills

Procedures written for situations you will meet here. Load one with skills__load before acting when the work in front of you is the situation its description names; a load you did not need still costs a round trip:

- handing-work-to-a-peer: How to hand work over.

## Memories

Your memories, by description, written by you in earlier turns. memory__read returns one body and spends no attempt; read one whose description matches the work in front of you:

- [memory-1] casey prefers bullet points

## Peers

Colleagues in this channel and what each is asked about. The toolsets say what each can do, not what should be handed over:

- @tess — scheduling (toolsets: none)`);
  });

  it('should ask the roster for the peers of this agent in this channel', async () => {
    await render();
    expect(rosterService.getPeers).toHaveBeenCalledWith('channel-1', 'mira');
  });

  it('should list the toolsets each peer was granted by namespace (§3.11)', async () => {
    rosterService.getPeers.mockReturnValue([PEER]);
    toolRegistry.listGrantedNamespacesFor.mockReturnValue(['prospects', 'tasks', 'web']);
    expect((await renderParts()).dynamic).toContain('- @tess — scheduling (toolsets: prospects, tasks, web)');
    expect(toolRegistry.listGrantedNamespacesFor).toHaveBeenCalledWith(PEER);
  });

  it('should keep instructions and skills stable when memories and peers change', async () => {
    skillsService.renderManifest.mockReturnValue('- triage: Investigate a problem.');
    const initial = await renderParts();
    memoryService.list.mockResolvedValue([{ description: 'new preference', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    const updated = await renderParts();
    expect(updated.stable).toBe(initial.stable);
    expect(updated.stable).toContain('## Skills');
    expect(initial.memories).toBe('');
    expect(initial.dynamic).toBe('');
    expect(updated.memories).toContain('## Memories');
    expect(updated.dynamic).toContain('## Peers');
    expect(await render()).toBe(`${updated.stable}\n\n${updated.memories}\n\n${updated.dynamic}`);
  });

  it('should omit the earlier actions section when the window reaches the start of the channel (§3.8)', async () => {
    windowService.readRecentActions.mockResolvedValue(['[read notes.md (12 bytes)]']);
    expect((await renderParts()).dynamic).not.toContain('## Earlier in this channel');
    expect(windowService.readRecentActions).not.toHaveBeenCalled();
  });

  it('should omit the earlier actions section when nothing this agent did precedes the window (§3.8)', async () => {
    expect((await renderParts(new Date(1000))).dynamic).not.toContain('## Earlier in this channel');
  });

  it('should ask for twenty of its own actions from before the window (§3.8)', async () => {
    await renderParts(new Date(1000));
    expect(windowService.readRecentActions).toHaveBeenCalledWith({
      agentUsername: 'mira',
      before: new Date(1000),
      channelId: 'channel-1',
      take: 20
    });
  });

  it('should collapse a run of identical earlier action lines (§3.8)', async () => {
    windowService.readRecentActions.mockResolvedValue([
      '[fetched https://x/a]',
      '[fetched https://x/a]',
      '[ran ls (0)]'
    ]);
    expect((await renderParts(new Date(1000))).dynamic).toContain('- [fetched https://x/a] (x2)\n- [ran ls (0)]');
  });

  it('should place the earlier actions after the memories boundary and before peers (§3.8)', async () => {
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullets', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    windowService.readRecentActions.mockResolvedValue(['[read notes.md (12 bytes)]']);
    const { dynamic, memories, stable } = await renderParts(new Date(1000));
    expect(stable).not.toContain('## Earlier in this channel');
    expect(memories).toContain('## Memories');
    expect(memories).not.toContain('## Earlier in this channel');
    expect(dynamic.indexOf('## Earlier in this channel')).toBeLessThan(dynamic.indexOf('## Peers'));
  });

  it('should list open work for an agent holding a tasks tool, oldest first, capped with a remainder (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    agentRegistry.settingsFor.mockReturnValue({ openUnitCap: 20, shownInPrompt: 1 });
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        createdAt: new Date(Date.now() - 2 * 3_600_000),
        creatorUsername: 'mira',
        outcome: 'a schedule for the offsite',
        reference: 'abcd1234',
        state: 'assigned'
      },
      {
        assigneeUsername: 'mira',
        createdAt: new Date(),
        creatorUsername: 'tess',
        outcome: 'a venue shortlist',
        reference: 'efgh5678',
        state: 'review'
      }
    ]);
    const { dynamic } = await renderParts();
    expect(dynamic).toContain(
      '## Open work\n\nWork handed over in this channel and still open, oldest first. A line marked `to @name` is one you assigned and are waiting on; `from @name` is one you owe. Read one in full with tasks__read:\n\n- [abcd1234] to @tess · assigned · 2h 0m — a schedule for the offsite\n\n…and 1 more.'
    );
    expect(tasksService.listOpenFor).toHaveBeenCalledWith({ agentUsername: 'mira', channelId: 'channel-1' });
  });

  it('should omit open work for an agent holding no tasks tool (§3.15)', async () => {
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        createdAt: new Date(),
        creatorUsername: 'mira',
        outcome: 'anything',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    expect((await renderParts()).dynamic).not.toContain('## Open work');
    expect(tasksService.listOpenFor).not.toHaveBeenCalled();
  });
});
