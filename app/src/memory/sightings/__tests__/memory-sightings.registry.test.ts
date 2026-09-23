import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemorySightingsRegistry } from '../memory-sightings.registry.ts';

const ID = 'memory-0-abcdefghijklmnop';

describe('MemorySightingsRegistry', () => {
  let memorySightingsRegistry: MemorySightingsRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [MemorySightingsRegistry] }).compile();
    memorySightingsRegistry = moduleRef.get(MemorySightingsRegistry);
  });

  it('should confirm the revision a turn read, and only for that turn (§3.6)', () => {
    memorySightingsRegistry.recordSeen('turn-1', { id: ID, revision: 2 });
    expect(memorySightingsRegistry.confirmSeen('turn-1', { id: ID, revision: 2 }).success).toBe(true);
    expect(memorySightingsRegistry.confirmSeen('turn-2', { id: ID, revision: 2 }).error).toStrictEqual({
      kind: 'unseen-revision',
      lastSeen: 'never',
      reference: 'memory-0'
    });
  });

  it('should refuse a revision newer than the one the turn read', () => {
    memorySightingsRegistry.recordSeen('turn-1', { id: ID, revision: 2 });
    expect(memorySightingsRegistry.confirmSeen('turn-1', { id: ID, revision: 3 }).error).toMatchObject({
      lastSeen: 'earlier'
    });
  });

  it('should count the turn’s own revision as seen only when it had seen the one it revised', () => {
    memorySightingsRegistry.recordSeen('turn-1', { id: ID, revision: 2 });
    memorySightingsRegistry.recordRevised('turn-1', { id: ID, revision: 3 });
    memorySightingsRegistry.recordRevised('turn-1', { id: ID, revision: 5 });
    expect(memorySightingsRegistry.confirmSeen('turn-1', { id: ID, revision: 3 }).success).toBe(true);
    expect(memorySightingsRegistry.confirmSeen('turn-1', { id: ID, revision: 5 }).success).toBe(false);
  });

  it('should keep the newer revision when two reads settle out of order', () => {
    memorySightingsRegistry.recordSeen('turn-1', { id: ID, revision: 3 });
    memorySightingsRegistry.recordSeen('turn-1', { id: ID, revision: 2 });
    expect(memorySightingsRegistry.confirmSeen('turn-1', { id: ID, revision: 3 }).success).toBe(true);
  });

  it('should forget everything a turn saw once it ends', () => {
    memorySightingsRegistry.recordSeen('turn-1', { id: ID, revision: 0 });
    memorySightingsRegistry.forgetTurn('turn-1');
    expect(memorySightingsRegistry.confirmSeen('turn-1', { id: ID, revision: 0 }).success).toBe(false);
  });
});
