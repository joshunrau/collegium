import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PostSightingsRegistry } from '../post-sightings.registry.ts';

describe('PostSightingsRegistry', () => {
  let postSightingsRegistry: PostSightingsRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [PostSightingsRegistry] }).compile();
    postSightingsRegistry = moduleRef.get(PostSightingsRegistry);
  });

  it('should count a post as seen by the turn that read it, and only by that turn (§3.15)', () => {
    postSightingsRegistry.recordSeen('turn-1', ['post-1']);
    postSightingsRegistry.recordSeen('turn-1', ['post-2']);
    expect(postSightingsRegistry.hasSeen('turn-1', 'post-1')).toBe(true);
    expect(postSightingsRegistry.hasSeen('turn-1', 'post-2')).toBe(true);
    expect(postSightingsRegistry.hasSeen('turn-2', 'post-1')).toBe(false);
  });

  it('should forget what a turn read once it ends', () => {
    postSightingsRegistry.recordSeen('turn-1', ['post-1']);
    postSightingsRegistry.forgetTurn('turn-1');
    expect(postSightingsRegistry.hasSeen('turn-1', 'post-1')).toBe(false);
  });
});
