import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { ConfigService } from '@/config/config.service.ts';
import { WindowService } from '@/conversations/window/window.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MailRegistry } from '@/mail/mail.registry.ts';
import type { MailboxRuntime } from '@/mail/mail.registry.ts';
import { ShellService } from '@/shell/shell.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { createConfigServiceMock } from '@/testing/factories/config-service.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { PromptRenderer } from '../prompt.renderer.ts';
import { EarlierActionsSection } from '../sections/earlier-actions.section.ts';
import { MemoriesSection } from '../sections/memories.section.ts';
import { OpenWorkSection } from '../sections/open-work.section.ts';
import { PeersSection } from '../sections/peers.section.ts';

const PROFILE = {
  actionBudget: 7,
  contextBudgetTokens: 12_000,
  expertise: 'testing',
  systemPrompt: 'You are Mira.',
  turnContextCeilingTokens: 32_000,
  username: 'mira',
  workspaceDir: '/var/lib/collegium/workspaces/mira'
} as AgentProfile;

describe('PromptRenderer', () => {
  let earlierActionsSection: MockedInstance<EarlierActionsSection>;
  let mailRegistry: MockedInstance<MailRegistry>;
  let memoriesSection: MockedInstance<MemoriesSection>;
  let openWorkSection: MockedInstance<OpenWorkSection>;
  let peersSection: MockedInstance<PeersSection>;
  let promptRenderer: PromptRenderer;
  let rosterService: MockedInstance<RosterService>;
  let shellService: MockedInstance<ShellService>;
  let skillsService: MockedInstance<SkillsService>;
  let toolRegistry: MockedInstance<ToolRegistry>;
  let windowService: MockedInstance<WindowService>;

  beforeEach(async () => {
    earlierActionsSection = MockFactory.createMock(EarlierActionsSection);
    earlierActionsSection.render.mockResolvedValue(undefined);
    mailRegistry = MockFactory.createMock(MailRegistry);
    mailRegistry.mailboxFor.mockReturnValue(undefined);
    memoriesSection = MockFactory.createMock(MemoriesSection);
    memoriesSection.render.mockResolvedValue(undefined);
    openWorkSection = MockFactory.createMock(OpenWorkSection);
    openWorkSection.render.mockResolvedValue(undefined);
    peersSection = MockFactory.createMock(PeersSection);
    peersSection.render.mockResolvedValue(undefined);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.nameOf.mockReturnValue(undefined);
    shellService = MockFactory.createMock(ShellService);
    shellService.listPresentCommands.mockReturnValue(['node', 'git']);
    skillsService = MockFactory.createMock(SkillsService);
    skillsService.renderManifest.mockReturnValue('');
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listBudgetExemptFor.mockReturnValue(['builtins__now', 'skills__load']);
    toolRegistry.listSupersedableFor.mockReturnValue([]);
    toolRegistry.listFor.mockReturnValue([]);
    windowService = MockFactory.createMock(WindowService);
    windowService.reachesBackTo.mockReturnValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PromptRenderer,
        TextFormatter,
        { provide: ConfigService, useValue: createConfigServiceMock() },
        { provide: EarlierActionsSection, useValue: earlierActionsSection },
        { provide: MailRegistry, useValue: mailRegistry },
        { provide: MemoriesSection, useValue: memoriesSection },
        { provide: OpenWorkSection, useValue: openWorkSection },
        { provide: PeersSection, useValue: peersSection },
        { provide: RosterService, useValue: rosterService },
        { provide: ShellService, useValue: shellService },
        { provide: SkillsService, useValue: skillsService },
        { provide: ToolRegistry, useValue: toolRegistry },
        { provide: WindowService, useValue: windowService }
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
  });

  it('should state what the registries and the configuration report of this agent in the preamble (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: true, id: ['shell', 'run'] }]);
    toolRegistry.listSupersedableFor.mockReturnValue(['web__fetch', 'workspace__read']);
    const prompt = await render();
    expect(prompt).toContain('Calls to builtins__now and skills__load spend none.');
    expect(prompt).toContain('results of web__fetch and workspace__read are kept word for word');
    expect(prompt).toContain('these commands are present: node and git.');
    expect(prompt).toContain('you begin the turn again, at most 3 times in one turn');
  });

  it('should name the mailbox’s announcement channel as the roster names it for this agent (§3.13)', async () => {
    mailRegistry.mailboxFor.mockReturnValue({
      announcementChannelId: 'channel-mail',
      provider: { address: 'mira@example.com' }
    } as MailboxRuntime);
    rosterService.nameOf.mockReturnValue('Mail Room');
    expect(await render()).toContain(
      'Your mailbox is mira@example.com, and mail arriving there is announced in Mail Room'
    );
    expect(rosterService.nameOf).toHaveBeenCalledWith('channel-mail', 'mira');
  });

  it('should carry the directories in the stable half and no clock or host state in either (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['workspace', 'read'] }]);
    const { stable, tail = '' } = await renderParts();
    expect(stable).toContain('share one directory');
    expect(tail).not.toContain('share one directory');
    expect(`${stable}\n${tail}`).not.toMatch(/\bgit\b|\bbranch\b|\bcommit\b|\d{4}-\d{2}-\d{2}/u);
  });

  it('should end the stable half on the skills and open the tail with the framework line, in §3.8 order', async () => {
    skillsService.renderManifest.mockReturnValue('- handing-work-to-a-peer: How to hand work over.');
    memoriesSection.render.mockResolvedValue('## Memories');
    peersSection.render.mockResolvedValue('## Peers');
    const prompt = await render();
    expect(prompt.indexOf('## Skills')).toBeGreaterThan(prompt.indexOf('## How this works'));
    expect(prompt.slice(prompt.indexOf('- handing-work-to-a-peer')))
      .toBe(`- handing-work-to-a-peer: How to hand work over.

[the framework's notes as this turn starts; not a post]

## Memories

## Peers`);
  });

  it('should pass each tail section this agent, this channel and where the window reaches back to', async () => {
    await renderParts(new Date(1000));
    const input = { channelId: 'channel-1', profile: PROFILE, windowReachesBackTo: new Date(1000) };
    for (const section of [memoriesSection, earlierActionsSection, peersSection, openWorkSection]) {
      expect(section.render).toHaveBeenCalledWith(input);
    }
  });

  it('should keep the stable half unchanged when every tail section changes between turns (§3.8)', async () => {
    toolRegistry.listFor.mockReturnValue([{ gates: false, id: ['tasks', 'assign'] }]);
    skillsService.renderManifest.mockReturnValue('- triage: Investigate a problem.');
    openWorkSection.render.mockResolvedValue('## Open work\n\nNo work is open in this channel.');
    const initial = await renderParts();
    memoriesSection.render.mockResolvedValue('## Memories');
    earlierActionsSection.render.mockResolvedValue('## Earlier in this channel');
    peersSection.render.mockResolvedValue('## Peers');
    openWorkSection.render.mockResolvedValue(
      '## Open work\n\n- [abcd1234] to @tess · assigned · 1m — a venue shortlist'
    );
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

  it('should place the earlier actions after the memories and before peers, and open work last (§3.8)', async () => {
    memoriesSection.render.mockResolvedValue('## Memories');
    earlierActionsSection.render.mockResolvedValue('## Earlier in this channel');
    peersSection.render.mockResolvedValue('## Peers');
    openWorkSection.render.mockResolvedValue('## Open work');
    const tail = await renderTail(new Date(1000));
    expect(tail.indexOf('## Memories')).toBeLessThan(tail.indexOf('## Earlier in this channel'));
    expect(tail.indexOf('## Earlier in this channel')).toBeLessThan(tail.indexOf('## Peers'));
    expect(tail.indexOf('## Peers')).toBeLessThan(tail.indexOf('## Open work'));
  });
});
