import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '@/agents/agents.types.ts';
import { RosterService } from '@/channels/roster/roster.service.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { SkillsService } from '@/skills/skills.service.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { SystemPromptRenderer } from '../system-prompt.renderer.ts';

const PROFILE = {
  actionBudget: 7,
  contextBudgetTokens: 12_000,
  expertise: 'testing',
  systemPrompt: 'You are Mira.',
  username: 'mira'
} as AgentProfile;

const PEER = { expertise: 'scheduling', username: 'tess' } as AgentProfile;

describe('SystemPromptRenderer', () => {
  let memoryService: MockedInstance<MemoryService>;
  let rosterService: MockedInstance<RosterService>;
  let skillsService: MockedInstance<SkillsService>;
  let systemPromptRenderer: SystemPromptRenderer;
  let toolRegistry: MockedInstance<ToolRegistry>;

  beforeEach(async () => {
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([]);
    rosterService = MockFactory.createMock(RosterService);
    rosterService.getPeers.mockReturnValue([]);
    skillsService = MockFactory.createMock(SkillsService);
    skillsService.renderManifest.mockReturnValue('');
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.listBudgetExemptFor.mockReturnValue(['builtins__now', 'skills__load']);
    toolRegistry.listFor.mockReturnValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SystemPromptRenderer,
        TextFormatter,
        { provide: MemoryService, useValue: memoryService },
        { provide: RosterService, useValue: rosterService },
        { provide: SkillsService, useValue: skillsService },
        { provide: ToolRegistry, useValue: toolRegistry }
      ]
    }).compile();
    systemPromptRenderer = moduleRef.get(SystemPromptRenderer);
  });

  const render = () => systemPromptRenderer.render({ channelId: 'channel-1', profile: PROFILE });

  it('should include the behavioral baseline without an optional personality', async () => {
    const prompt = await render();
    expect(prompt.startsWith('You are Mira.\n\n## How you work\n\nBegin work when')).toBe(true);
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
    expect(prompt.startsWith('You are Mira.\n\n## How you work\n\nBegin work when')).toBe(true);
    expect(prompt.indexOf('## Personality')).toBeGreaterThan(prompt.indexOf('## How you work'));
    expect(prompt.indexOf('## Personality')).toBeLessThan(prompt.indexOf('## How this works'));
    expect(prompt).toContain('Never apologize for disagreeing.');
  });

  it('should state the configured budgets and the calls exempt from them in the preamble', async () => {
    const prompt = await render();
    expect(prompt).toContain('fits your context to about 12000 tokens');
    expect(prompt).toContain('Each turn has a budget of 7 tool calls.');
    expect(prompt).toContain('Calls to builtins__now and skills__load do not.');
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

Procedures you can pull into context with skills__load when they apply:

- handing-work-to-a-peer: How to hand work over.

## Memories

Your saved memories; read a full body with memory__read when it matters:

- [memory-1] casey prefers bullet points

## Peers

Colleagues in this channel:

- @tess — scheduling`);
  });

  it('should ask the roster for the peers of this agent in this channel', async () => {
    await render();
    expect(rosterService.getPeers).toHaveBeenCalledWith('channel-1', 'mira');
  });

  it('should keep instructions and skills stable when memories and peers change', async () => {
    skillsService.renderManifest.mockReturnValue('- triage: Investigate a problem.');
    const initial = await systemPromptRenderer.renderParts({ channelId: 'channel-1', profile: PROFILE });
    memoryService.list.mockResolvedValue([{ description: 'new preference', reference: 'memory-1' }]);
    rosterService.getPeers.mockReturnValue([PEER]);
    const updated = await systemPromptRenderer.renderParts({ channelId: 'channel-1', profile: PROFILE });
    expect(updated.stable).toBe(initial.stable);
    expect(updated.stable).toContain('## Skills');
    expect(initial.dynamic).toBe('');
    expect(updated.dynamic).toContain('## Memories');
    expect(updated.dynamic).toContain('## Peers');
    expect(await render()).toBe(`${updated.stable}\n\n${updated.dynamic}`);
  });
});
