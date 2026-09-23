import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TurnControlRegistry } from '../turn-control.registry.ts';

const STEERING = { byUsername: 'casey', text: 'use staging' };

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

  it('should hand an unnamed steer to the one turn running in the channel, buffered until it takes it (§7.5)', () => {
    const inChannel = register(registry, 'turn-1', 'channel-1');
    const elsewhere = register(registry, 'turn-2', 'channel-2', 'tess');
    expect(registry.steer('channel-1', undefined, STEERING)).toMatchObject({ success: true, value: 'mira' });
    expect(inChannel.takeSteering()).toStrictEqual([STEERING]);
    expect(inChannel.takeSteering()).toStrictEqual([]);
    expect(elsewhere.takeSteering()).toStrictEqual([]);
  });

  it('should refuse an unnamed steer while two agents run here, and hand a named one to that agent alone (§7.5)', () => {
    const mira = register(registry, 'turn-1', 'channel-1');
    const tess = register(registry, 'turn-2', 'channel-1', 'tess');
    expect(registry.steer('channel-1', undefined, STEERING)).toMatchObject({
      error: { kind: 'ambiguous', runningAgentUsernames: ['mira', 'tess'] },
      success: false
    });
    expect(registry.steer('channel-1', 'tess', STEERING)).toMatchObject({ success: true, value: 'tess' });
    expect(mira.takeSteering()).toStrictEqual([]);
    expect(tess.takeSteering()).toStrictEqual([STEERING]);
  });

  it('should refuse a steer that reaches no running turn, naming the agent it was for', () => {
    register(registry, 'turn-1', 'channel-1');
    expect(registry.steer('channel-1', 'tess', STEERING)).toMatchObject({
      error: { agentUsername: 'tess', kind: 'not-running' },
      success: false
    });
    expect(registry.steer('channel-2', undefined, STEERING)).toMatchObject({
      error: { kind: 'nothing-running' },
      success: false
    });
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
