import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { TurnControlRegistry } from '../turn-control.registry.ts';

describe('TurnControlRegistry', () => {
  let registry: TurnControlRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [TurnControlRegistry] }).compile();
    registry = moduleRef.get(TurnControlRegistry);
  });

  it('should flag only the turns running in the issuing channel', () => {
    const inChannel = registry.register('turn-1', 'channel-1');
    const elsewhere = registry.register('turn-2', 'channel-2');
    expect(registry.abortChannel('channel-1', 'stopped')).toBe(1);
    expect(inChannel.aborted()).toBe('stopped');
    expect(elsewhere.aborted()).toBeUndefined();
  });

  it('should let a kill override an earlier stop but never the reverse', () => {
    const control = registry.register('turn-1', 'channel-1');
    registry.abortChannel('channel-1', 'stopped');
    registry.abortChannel('channel-1', 'killed');
    expect(control.aborted()).toBe('killed');
    registry.abortChannel('channel-1', 'stopped');
    expect(control.aborted()).toBe('killed');
  });

  it('should resolve the kill race on kill alone, and not for a released turn', async () => {
    const control = registry.register('turn-1', 'channel-1');
    registry.abortChannel('channel-1', 'stopped');
    registry.abortChannel('channel-1', 'killed');
    await expect(control.killed).resolves.toBe('killed');
    control.release();
    expect(registry.abortChannel('channel-1', 'killed')).toBe(0);
  });
});
