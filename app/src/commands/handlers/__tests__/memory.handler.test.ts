import { Result } from '@collegium/core/utils';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from '@/agents/agents.registry.ts';
import { MemoryService } from '@/memory/memory.service.ts';
import { buildAgentProfile } from '@/testing/factories/agent-profile.factory.ts';
import { MockFactory } from '@/testing/factories/mock.factory.ts';
import type { MockedInstance } from '@/testing/factories/mock.factory.ts';

import { MemoryHandler } from '../memory.handler.ts';

const MIRA = buildAgentProfile();

describe('MemoryHandler', () => {
  let memoryHandler: MemoryHandler;
  let memoryService: MockedInstance<MemoryService>;

  const handle = (text: string) => {
    return memoryHandler.handle({ channelId: 'channel-1', text, userId: 'casey-id', username: 'casey' });
  };

  beforeEach(async () => {
    const agentRegistry = MockFactory.createMock(AgentRegistry);
    agentRegistry.get.mockImplementation((username: string) => (username === 'mira' ? MIRA : undefined));
    memoryService = MockFactory.createMock(MemoryService);
    memoryService.listWithRevisions.mockResolvedValue([
      { description: 'casey prefers bullets', reference: 'm1', revisedAt: null, revision: 0 },
      { description: 'release cadence', reference: 'm2', revisedAt: new Date(Date.now() - 2 * 3_600_000), revision: 3 }
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryHandler,
        { provide: AgentRegistry, useValue: agentRegistry },
        { provide: MemoryService, useValue: memoryService }
      ]
    }).compile();
    memoryHandler = moduleRef.get(MemoryHandler);
  });

  it('should list references and descriptions with how each was revised, never bodies (§8.4)', async () => {
    expect(await handle('mira')).toStrictEqual({
      audience: 'invoker',
      text: 'Memories for mira:\n- m1: casey prefers bullets\n- m2: release cadence (revised 3 times, last 2h 0m ago)'
    });
  });

  it('should show the body of one memory to the caller alone, and count that as use (§3.6)', async () => {
    memoryService.read.mockResolvedValue(
      Result.ok({ body: 'Bullets, never prose.', description: 'casey prefers bullets', id: 'm1-full-id' } as never)
    );
    expect(await handle('mira show m1')).toStrictEqual({
      audience: 'invoker',
      text: 'Memory m1 — casey prefers bullets:\n\nBullets, never prose.'
    });
    expect(memoryService.read).toHaveBeenCalledWith('mira', 'm1');
    expect(memoryService.markUsed).toHaveBeenCalledWith('m1-full-id');
  });

  it('should not count a prune as use', async () => {
    memoryService.delete.mockResolvedValue(Result.ok({ description: 'a stale fact' } as never));
    await handle('mira prune m1');
    expect(memoryService.markUsed).not.toHaveBeenCalled();
  });

  it('should say when the reference resolves to no memory', async () => {
    memoryService.read.mockResolvedValue(Result.err({ kind: 'not-found', reference: 'zz' }));
    expect((await handle('mira show zz')).text).toBe('mira has no memory with reference "zz".');
  });

  it('should answer an unknown verb with the usage line', async () => {
    expect((await handle('mira reveal m1')).text).toContain('Usage: /collegium memory');
  });
});
