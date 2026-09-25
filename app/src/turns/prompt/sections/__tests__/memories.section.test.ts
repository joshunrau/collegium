import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';
import { ToolRegistry } from '@/tools/tools.registry.ts';

import { MemoriesSection } from '../memories.section.ts';

describe('MemoriesSection', () => {
  let agentRegistry: MockedInstance<AgentRegistry>;
  let memoriesSection: MemoriesSection;
  let memoryService: MockedInstance<MemoryService>;
  let toolRegistry: MockedInstance<ToolRegistry>;

  beforeEach(async () => {
    agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.settingsFor.mockReturnValue({ maxBodyChars: 16_000, maxDescriptionChars: 200, maxEntries: 50 });
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([]);
    toolRegistry = MockFactory.createMock(ToolRegistry);
    toolRegistry.isGranted.mockReturnValue(true);
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoriesSection,
        TextFormatter,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: MemoryService, useValue: memoryService },
        { provide: ToolRegistry, useValue: toolRegistry }
      ]
    }).compile();
    memoriesSection = moduleRef.get(MemoriesSection);
  });

  const render = () => {
    return memoriesSection.render({
      channelId: 'channel-1',
      profile: buildAgentProfile(),
      windowReachesBackTo: undefined
    });
  };

  it('should render nothing for an agent holding no memory', async () => {
    expect(await render()).toBeUndefined();
  });

  it('should render nothing for an agent not granted memory, whatever it once wrote (§3.8)', async () => {
    agentRegistry.settingsFor.mockReturnValue(undefined);
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullet points', reference: 'memory-1' }]);
    expect(await render()).toBeUndefined();
  });

  it('should name memory__read only to an agent granted it (§3.4)', async () => {
    toolRegistry.isGranted.mockImplementation((_profile, ref) => ref !== 'memory::read');
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullet points', reference: 'memory-1' }]);
    const rendered = await render();
    expect(rendered).not.toContain('memory__read');
    expect(rendered).toContain('written by you in earlier turns:');
  });

  it('should list this agent’s memories by reference and description, counted against its cap (§3.6)', async () => {
    memoryService.list.mockResolvedValue([
      { description: 'casey prefers bullet points', reference: 'memory-1' },
      { description: 'the venue shortlist is final', reference: 'memory-2' }
    ]);
    expect(await render()).toBe(`## Memories

Your memories (2 of at most 50), by description, written by you in earlier turns. memory__read returns one body and spends no attempt; read one whose description matches the work in front of you:

- [memory-1] casey prefers bullet points
- [memory-2] the venue shortlist is final`);
    expect(memoryService.list).toHaveBeenCalledWith('mira');
  });
});
