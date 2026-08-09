import type { Tool } from '@collegium/core/tools';
import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryService } from '@/memory/memory.service.ts';
import type { ModelRow } from '@/prisma/prisma.types.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { ReadMemoryTool } from '../read-memory.tool.ts';

const entry: ModelRow<'Memory'> = {
  agentUsername: 'mira',
  body: 'the whole body',
  createdAt: new Date(),
  description: 'a fact',
  id: 'memory-1',
  originPostId: 'post-1'
};

const turn = { agentUsername: 'mira', turnId: 'turn-1' } as Tool.TurnScope;

describe('ReadMemoryTool', () => {
  let memory: MockedInstance<MemoryService>;
  let tool: ReadMemoryTool;

  beforeEach(async () => {
    memory = MockFactory.createMock(MemoryService);
    const moduleRef = await Test.createTestingModule({
      providers: [ReadMemoryTool, { provide: MemoryService, useValue: memory }]
    }).compile();
    tool = moduleRef.get(ReadMemoryTool);
  });

  it('should read under the agent of the turn, never one named by the model', async () => {
    memory.read.mockResolvedValue(Result.ok(entry));

    const result = await tool.execute({ id: 'memory-1' }, turn);

    expect(memory.read).toHaveBeenCalledWith('mira', 'memory-1');
    expect(result.value).toStrictEqual({ text: 'the whole body' });
  });

  it('should feed an unknown id back as invalid arguments rather than terminate', async () => {
    memory.read.mockResolvedValue(Result.err({ id: 'memory-9', kind: 'not-found' }));

    const result = await tool.execute({ id: 'memory-9' }, turn);

    expect(result.error).toStrictEqual({
      kind: 'invalid-arguments',
      message: 'no memory entry with id "memory-9" exists'
    });
  });
});
