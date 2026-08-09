import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TurnFoldRegistry } from '../turn-fold.registry.ts';

const TURN = { agentUsername: 'mira', authorUsername: 'casey', channelId: 'channel-1' };

describe('TurnFoldRegistry', () => {
  let registry: TurnFoldRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [TurnFoldRegistry] }).compile();
    registry = moduleRef.get(TurnFoldRegistry);
  });

  it('should hand a further fragment from the same human to the turn answering them', () => {
    const fold = registry.register(TURN);
    expect(registry.offer({ ...TURN, postId: 'post-2' })).toBe(true);
    expect(fold.takeOffered()).toStrictEqual(['post-2']);
  });

  it('should clear the buffer once taken', () => {
    const fold = registry.register(TURN);
    registry.offer({ ...TURN, postId: 'post-2' });
    fold.takeOffered();
    expect(fold.takeOffered()).toStrictEqual([]);
  });

  it('should refuse another author, so unrelated chatter costs a turn nothing', () => {
    registry.register(TURN);
    expect(registry.offer({ ...TURN, authorUsername: 'owen', postId: 'post-2' })).toBe(false);
  });

  it('should refuse another channel and another agent', () => {
    registry.register(TURN);
    expect(registry.offer({ ...TURN, channelId: 'channel-2', postId: 'post-2' })).toBe(false);
    expect(registry.offer({ ...TURN, agentUsername: 'owen', postId: 'post-2' })).toBe(false);
  });

  it('should refuse everything once the turn has stopped absorbing', () => {
    const fold = registry.register(TURN);
    fold.stopAbsorbing();
    expect(registry.offer({ ...TURN, postId: 'post-2' })).toBe(false);
  });

  it('should refuse everything once the turn is released', () => {
    registry.register(TURN).release();
    expect(registry.offer({ ...TURN, postId: 'post-2' })).toBe(false);
  });

  it('should fold nothing into a turn no human started', () => {
    const fold = registry.register({ ...TURN, authorUsername: undefined });
    expect(registry.offer({ ...TURN, postId: 'post-2' })).toBe(false);
    expect(fold.takeOffered()).toStrictEqual([]);
  });
});
