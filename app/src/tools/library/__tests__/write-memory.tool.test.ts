import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryService } from '@/memory/memory.service.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { WriteMemoryTool } from '../write-memory.tool.ts';

const entry: ModelRow<'Memory'> = {
  agentUsername: 'mira',
  body: 'prefers the phone',
  createdAt: new Date(),
  description: 'contacting the client',
  id: 'memory-1',
  originPostId: 'post-7'
};

describe('WriteMemoryTool', () => {
  let disclosures: Tool.MemoryWriteDisclosure[];
  let memory: MockedInstance<MemoryService>;
  let tool: WriteMemoryTool;
  let turn: Tool.TurnScope;

  beforeEach(async () => {
    disclosures = [];
    memory = MockFactory.createMock(MemoryService);
    turn = {
      agentUsername: 'mira',
      channelId: 'channel-1',
      discloseMemoryWrite: (disclosure) => {
        disclosures.push(disclosure);
        return Promise.resolve();
      },
      triggeringPostId: 'post-7',
      turnId: 'turn-1',
      workspaceDir: '/tmp/workspaces/mira'
    };
    const moduleRef = await Test.createTestingModule({
      providers: [WriteMemoryTool, { provide: MemoryService, useValue: memory }]
    }).compile();
    tool = moduleRef.get(WriteMemoryTool);
  });

  it('should fix the writing agent and provenance from the turn, never from model arguments', async () => {
    memory.write.mockResolvedValue(Result.ok({ entry, evictedDescriptions: [] }));

    const result = await tool.execute({ body: 'prefers the phone', description: 'contacting the client' }, turn);

    expect(memory.write).toHaveBeenCalledWith({
      agentUsername: 'mira',
      body: 'prefers the phone',
      description: 'contacting the client',
      originPostId: 'post-7'
    });
    expect(result.value).toStrictEqual({ text: 'memory memory-1 saved' });
  });

  it('should disclose the write in full, naming any entry the write displaced (§3.6)', async () => {
    memory.write.mockResolvedValue(Result.ok({ entry, evictedDescriptions: ['an old preference'] }));

    await tool.execute({ body: 'prefers the phone', description: 'contacting the client' }, turn);

    expect(disclosures).toStrictEqual([
      {
        body: 'prefers the phone',
        description: 'contacting the client',
        evictedDescriptions: ['an old preference'],
        memoryId: 'memory-1'
      }
    ]);
  });

  it('should feed an over-cap write back as invalid arguments rather than terminate', async () => {
    memory.write.mockResolvedValue(Result.err({ field: 'description', kind: 'too-long', length: 220, limit: 200 }));

    const result = await tool.execute({ body: 'b', description: 'x'.repeat(220) }, turn);

    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'the description is 220 characters, over its cap of 200'
    });
  });
});
