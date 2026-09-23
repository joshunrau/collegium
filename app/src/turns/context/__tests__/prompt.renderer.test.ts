import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MailRegistry } from '@/mail/mail.registry.ts';
import type { MailboxRuntime } from '@/mail/mail.registry.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { TasksService } from '@/tasks/tasks.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { PromptRenderer } from '../prompt.renderer.ts';

const PROFILE = {
  actionBudget: 7,
  contextBudgetTokens: 12_000,
  expertise: 'testing',
  systemPrompt: 'You are Mira.',
  turnContextCeilingTokens: 32_000,
  username: 'mira',
  workspaceDir: '/var/lib/collegium/workspaces/mira'
} as AgentProfile;

const PEER = { expertise: 'scheduling', username: 'tess' } as AgentProfile;

describe('PromptRenderer', () => {
  let mailRegistry: MockedInstance<MailRegistry>;
  let memoryService: MockedInstance<MemoryService>;
  let rosterService: MockedInstance<RosterService>;
  let shellService: MockedInstance<ShellService>;
  let skillsService: MockedInstance<SkillsService>;
  let promptRenderer: PromptRenderer;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let windowService: MockedInstance<WindowService>;
  let agentRegistry: MockedInstance<AgentRegistry>;
  let tasksService: MockedInstance<TasksService>;

  beforeEach(async () => {
    mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.mailboxFor.mockReturnValue(undefined);
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([]);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([]);
    rosterService.nameOf.mockReturnValue(undefined);
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
        PromptRenderer,
        TextFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: MailRegistry, useValue: mailRegistry },
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
    promptRenderer = moduleRef.get(PromptRenderer);
  });

  const render = () => promptRenderer.render({ channelId: 'channel-1', profile: PROFILE });

  const renderParts = (windowReachesBackTo: Date | undefined = undefined) => {
    return promptRenderer.renderParts({ channelId: 'channel-1', profile: PROFILE, windowReachesBackTo });
  };

  const renderTail = async (windowReachesBackTo: Date | undefined = undefined) => {
    return (await renderParts(windowReachesBackTo)).tail ?? '';
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
    const prompt = await promptRenderer.render({
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
    expect(prompt).toContain('The whole of your context in one turn is kept under about 32,000 tokens.');
    expect(prompt).toContain('Each turn has 7 attempts.');
    expect(prompt).toContain('Calls to builtins__now and skills__load spend none.');
    expect(prompt).toContain('at most 20 of them, newest first');
  });

  it('should state the retention rule for the calls whose results fold, from the turn ceiling (§3.8)', async () => {
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

  it('should say the message after the posts is the framework’s and not a post (§3.8)', async () => {
    expect(await render()).toContain(
      "After the posts and records, one message opens with such a line: it is the framework's, not a post"
    );
  });

  it('should describe ask__human only for an agent that holds it, leaving what its description says to it (§3.7a)', async () => {
    expect(await render()).not.toContain('ask__human');
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['ask', 'human'] }]);
    const prompt = await render();
    expect(prompt).toContain('ask__human waits with no timeout for one person in this channel to answer');
    expect(prompt).not.toContain('two to six short answers');
  });

  it('should open the preamble with the agent’s own handle (§3.8)', async () => {
    expect(await render()).toContain('## How this works\n\nYou are @mira, one of a group of agents.');
  });

  it('should state where a drained post sits and how often a turn may start over for a further post (§4.4, §5.2)', async () => {
    const prompt = await render();
    expect(prompt).toContain('which is before your own last reply and not at the end');
    expect(prompt).toContain('you begin the turn again, at most 3 times in one turn');
  });

  it('should state the mailbox, its announcement channel and what a ref is only for an agent holding a mailbox (§3.13)', async () => {
    expect(await render()).not.toContain('Your mailbox is');
    mailRegistry.mailboxFor.mockReturnValue({
      announcementChannelId: 'channel-mail',
      provider: { address: 'mira@example.com' }
    } as MailboxRuntime);
    rosterService.nameOf.mockReturnValue('Mail Room');
    const prompt = await render();
    expect(prompt).toContain(
      'Your mailbox is mira@example.com, and mail arriving there is announced in Mail Room and nowhere else. A ⟨ref⟩ names one message inside that mailbox'
    );
    expect(rosterService.nameOf).toHaveBeenCalledWith('channel-mail', 'mira');
  });

  it('should describe the Open work section and its absence only for an agent holding a tasks tool (§3.15)', async () => {
    expect(await render()).not.toContain('listed under Open work');
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'read'] }]);
    expect(await render()).toContain(
      'listed under Open work with their references, oldest first, and that section says so when none is open'
    );
  });

  it('should say whose item a system-bot announcement is, and that its body is the whole of it (§4.2)', async () => {
    const prompt = await render();
    expect(prompt).toContain(
      'An item for somebody else is ordinary channel content and its id is not yours to resolve.'
    );
    expect(prompt).toContain('is the whole of that item, inline or in a file the post names');
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
    const { stable, tail = '' } = await renderParts();
    expect(stable).toContain('share one directory');
    expect(tail).not.toContain('share one directory');
    expect(`${stable}\n${tail}`).not.toMatch(/\bgit\b|\bbranch\b|\bcommit\b|\d{4}-\d{2}-\d{2}/u);
  });

  it('should state what conversations__search reaches only for an agent that holds it (§3.8)', async () => {
    expect(await render()).not.toContain('conversations__search');
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['conversations', 'search'] }]);
    expect(await render()).toContain('conversations__search finds past posts in the channels you are in.');
  });

  it('should end the stable half on the skills and open the tail with the framework line, in §3.8 order', async () => {
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullet points', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    skillsService.renderManifest.mockReturnValue('- handing-work-to-a-peer: How to hand work over.');
    const prompt = await render();
    expect(prompt.slice(prompt.indexOf('## Skills'))).toBe(`## Skills

Procedures written for situations you will meet here. Load one with skills__load before acting when the work in front of you is the situation its description names; a load you did not need still costs a round trip:

- handing-work-to-a-peer: How to hand work over.

[the framework's notes as this turn starts; not a post]

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
    expect(await renderTail()).toContain('- @tess — scheduling (toolsets: prospects, tasks, web)');
    expect(toolRegistry.listGrantedNamespacesFor).toHaveBeenCalledWith(PEER);
  });

  it('should keep the stable half unchanged when every tail section changes between turns (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    skillsService.renderManifest.mockReturnValue('- triage: Investigate a problem.');
    const initial = await renderParts();
    memoryService.list.mockResolvedValue([{ description: 'new preference', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    windowService.readRecentActions.mockResolvedValue(['[read notes.md (12 bytes)]']);
    tasksService.listOpenFor.mockResolvedValue([
      {
        assigneeUsername: 'tess',
        createdAt: new Date(Date.now() - 60_000),
        creatorUsername: 'mira',
        outcome: 'a venue shortlist',
        reference: 'abcd1234',
        state: 'assigned'
      }
    ]);
    const updated = await renderParts(new Date(1000));
    expect(updated.stable).toBe(initial.stable);
    expect(updated.tail).not.toBe(initial.tail);
    for (const heading of ['## Memories', '## Earlier in this channel', '## Peers', '## Open work']) {
      expect(updated.stable).not.toContain(heading);
      expect(updated.tail).toContain(heading);
    }
  });

  it('should render no tail when no section has anything to say', async () => {
    expect((await renderParts()).tail).toBeUndefined();
    expect(await render()).toBe((await renderParts()).stable);
  });

  it('should omit the earlier actions section when the window reaches the start of the channel (§3.8)', async () => {
    windowService.readRecentActions.mockResolvedValue(['[read notes.md (12 bytes)]']);
    expect(await renderTail()).not.toContain('## Earlier in this channel');
    expect(windowService.readRecentActions).not.toHaveBeenCalled();
  });

  it('should omit the earlier actions section when nothing this agent did precedes the window (§3.8)', async () => {
    expect(await renderTail(new Date(1000))).not.toContain('## Earlier in this channel');
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
    expect(await renderTail(new Date(1000))).toContain('- [fetched https://x/a] (x2)\n- [ran ls (0)]');
  });

  it('should place the earlier actions after the memories and before peers (§3.8)', async () => {
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullets', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    windowService.readRecentActions.mockResolvedValue(['[read notes.md (12 bytes)]']);
    const tail = await renderTail(new Date(1000));
    expect(tail.indexOf('## Memories')).toBeLessThan(tail.indexOf('## Earlier in this channel'));
    expect(tail.indexOf('## Earlier in this channel')).toBeLessThan(tail.indexOf('## Peers'));
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
    expect(await renderTail()).toContain(
      '## Open work\n\nWork handed over in this channel and still open, oldest first. A line marked `to @name` is one you assigned and are waiting on; `from @name` is one you owe. Read one in full with tasks__read:\n\n- [abcd1234] to @tess · assigned · 2h 0m — a schedule for the offsite\n\n…and 1 more.'
    );
    expect(tasksService.listOpenFor).toHaveBeenCalledWith({ agentUsername: 'mira', channelId: 'channel-1' });
  });

  it('should state that no work is open rather than omit the section, for an agent holding a tasks tool (§3.15)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    expect(await renderTail()).toContain('## Open work\n\nNo work is open in this channel.');
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
    expect(await renderTail()).not.toContain('## Open work');
    expect(tasksService.listOpenFor).not.toHaveBeenCalled();
  });
});
