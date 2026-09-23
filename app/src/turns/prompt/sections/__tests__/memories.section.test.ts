import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TextFormatter } from '@/formatting/text/text.formatter.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { MemoriesSection } from '../memories.section.ts';

describe('MemoriesSection', () => {
  let memoriesSection: MemoriesSection;
  let memoryService: MockedInstance<MemoryService>;

  beforeEach(async () => {
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.list.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [MemoriesSection, TextFormatter, { provide: MemoryService, useValue: memoryService }]
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

  it('should list this agent’s memories by reference and description', async () => {
    memoryService.list.mockResolvedValue([{ description: 'casey prefers bullet points', reference: 'memory-1' }]);
    expect(await render()).toBe(`## Memories

Your memories, by description, written by you in earlier turns. memory__read returns one body and spends no attempt; read one whose description matches the work in front of you:

- [memory-1] casey prefers bullet points`);
    expect(memoryService.list).toHaveBeenCalledWith('mira');
  });
});
