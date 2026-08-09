import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryLockService } from '../memory-lock.service.ts';

describe('MemoryLockService', () => {
  let memoryLockService: MemoryLockService;

  const settle = (order: string[], label: string) => () =>
    Promise.resolve().then(() => {
      order.push(label);
    });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [MemoryLockService] }).compile();
    memoryLockService = moduleRef.get(MemoryLockService);
  });

  it('should serialise one agent’s tasks while leaving another agent unblocked', async () => {
    const order: string[] = [];
    await Promise.all([
      memoryLockService.run('mira', settle(order, 'mira-1')),
      memoryLockService.run('owen', settle(order, 'owen-1')),
      memoryLockService.run('mira', settle(order, 'mira-2'))
    ]);
    expect(order.indexOf('mira-1')).toBeLessThan(order.indexOf('mira-2'));
    expect(order).toHaveLength(3);
  });

  it('should run the next task for an agent whose previous task rejected', async () => {
    const failed = memoryLockService.run('mira', () => Promise.reject(new Error('write failed')));
    await expect(failed).rejects.toThrow('write failed');
    await expect(memoryLockService.run('mira', () => Promise.resolve('recorded'))).resolves.toBe('recorded');
  });
});
