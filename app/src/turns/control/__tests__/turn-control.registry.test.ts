import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TurnControlRegistry } from '../turn-control.registry.ts';

const register = (registry: TurnControlRegistry, turnId: string, channelId: string, agentUsername = 'mira') => {
  return registry.register({ agentUsername, channelId, onSurface: () => Promise.resolve(false), turnId });
};

describe('TurnControlRegistry', () => {
  let registry: TurnControlRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [TurnControlRegistry] }).compile();
    registry = moduleRef.get(TurnControlRegistry);
  });

  it('should flag only the turns running in the issuing channel, naming their agents and the invoker (§7.5)', () => {
    const inChannel = register(registry, 'turn-1', 'channel-1');
    const elsewhere = register(registry, 'turn-2', 'channel-2', 'tess');
    expect(registry.abortChannel('channel-1', 'stopped', 'casey')).toStrictEqual(['mira']);
    expect(inChannel.aborted()).toStrictEqual({ byUsername: 'casey', kind: 'stopped' });
    expect(elsewhere.aborted()).toBeUndefined();
  });

  it('should let a kill override an earlier stop but never the reverse', () => {
    const control = register(registry, 'turn-1', 'channel-1');
    registry.abortChannel('channel-1', 'stopped', 'casey');
    registry.abortChannel('channel-1', 'killed', 'owen');
    expect(control.aborted()).toStrictEqual({ byUsername: 'owen', kind: 'killed' });
    registry.abortChannel('channel-1', 'stopped', 'casey');
    expect(control.aborted()).toStrictEqual({ byUsername: 'owen', kind: 'killed' });
  });

  it('should buffer steering for the turns in the channel alone, until each takes it (§7.5)', () => {
    const inChannel = register(registry, 'turn-1', 'channel-1');
    const elsewhere = register(registry, 'turn-2', 'channel-2');
    expect(registry.steerChannel('channel-1', { byUsername: 'casey', text: 'use staging' })).toBe(1);
    expect(inChannel.takeSteering()).toStrictEqual([{ byUsername: 'casey', text: 'use staging' }]);
    expect(inChannel.takeSteering()).toStrictEqual([]);
    expect(elsewhere.takeSteering()).toStrictEqual([]);
  });

  it('should resolve the kill race on kill alone, and not for a released turn', async () => {
    const control = register(registry, 'turn-1', 'channel-1');
    registry.abortChannel('channel-1', 'stopped', 'casey');
    registry.abortChannel('channel-1', 'killed', 'casey');
    await expect(control.killed).resolves.toBe('killed');
    control.release();
    expect(registry.abortChannel('channel-1', 'killed', 'casey')).toStrictEqual([]);
  });

  it("should surface the status posts of one agent's turns in one channel, saying whether any was opened (§7.6)", async () => {
    const onSurface = vi.fn().mockResolvedValue(true);
    const elsewhere = vi.fn().mockResolvedValue(true);
    registry.register({ agentUsername: 'mira', channelId: 'channel-1', onSurface, turnId: 'turn-1' });
    registry.register({ agentUsername: 'tess', channelId: 'channel-1', onSurface: elsewhere, turnId: 'turn-2' });
    expect(await registry.surfaceStatusPosts('mira', 'channel-1')).toBe(true);
    expect(onSurface).toHaveBeenCalledOnce();
    expect(elsewhere).not.toHaveBeenCalled();
    expect(await registry.surfaceStatusPosts('mira', 'channel-9')).toBe(false);
  });
});
