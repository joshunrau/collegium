import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChannelLockService } from '../channel-lock.service.ts';

describe('ChannelLockService', () => {
  let channelLockService: ChannelLockService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [ChannelLockService] }).compile();
    channelLockService = moduleRef.get(ChannelLockService);
  });

  it('should claim an idle channel without awaiting between the check and the claim', () => {
    const handle = channelLockService.acquire('mira', 'channel-1');
    expect(handle).toBeDefined();
    expect(handle).not.toHaveProperty('then');
    expect(channelLockService.isBusy('mira', 'channel-1')).toBe(true);
  });

  it('should grant the lock to exactly one of two claims maturing in the same tick', () => {
    const first = channelLockService.acquire('mira', 'channel-1');
    const second = channelLockService.acquire('mira', 'channel-1');
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
  });

  it('should leave the same agent free to take the lock in another channel', () => {
    expect(channelLockService.acquire('mira', 'channel-1')).toBeDefined();
    expect(channelLockService.acquire('mira', 'channel-2')).toBeDefined();
  });

  it('should free the channel on release, however the turn ended', () => {
    const handle = channelLockService.acquire('mira', 'channel-1')!;
    expect(channelLockService.isChannelIdle('channel-1')).toBe(false);
    handle.release();
    expect(channelLockService.isChannelIdle('channel-1')).toBe(true);
    expect(channelLockService.acquire('mira', 'channel-1')).toBeDefined();
  });

  it('should not let a stale handle release a newer holder', () => {
    const stale = channelLockService.acquire('mira', 'channel-1')!;
    stale.release();
    channelLockService.acquire('mira', 'channel-1');
    stale.release();
    expect(channelLockService.isBusy('mira', 'channel-1')).toBe(true);
  });

  it('should report an agent free in a channel no one has ever locked', () => {
    expect(channelLockService.isBusy('mira', 'channel-unknown')).toBe(false);
  });

  it('should list each held lock with when it was taken, and forget it once released', () => {
    const handle = channelLockService.acquire('mira', 'channel-1')!;
    expect(channelLockService.listHeld()).toStrictEqual([
      { acquiredAt: expect.any(Date), agentUsername: 'mira', channelId: 'channel-1' }
    ]);
    handle.release();
    expect(channelLockService.listHeld()).toStrictEqual([]);
  });

  it('should say since when a lane is held, and nothing once it is released', () => {
    const handle = channelLockService.acquire('mira', 'channel-1')!;
    expect(channelLockService.heldSince('mira', 'channel-1')).toStrictEqual(channelLockService.listHeld()[0]?.acquiredAt);
    handle.release();
    expect(channelLockService.heldSince('mira', 'channel-1')).toBeUndefined();
  });

  it('should report a channel idle only when no agent holds its lock', () => {
    const handle = channelLockService.acquire('mira', 'channel-1')!;
    channelLockService.acquire('tess', 'channel-1');
    handle.release();
    expect(channelLockService.isChannelIdle('channel-1')).toBe(false);
  });
});
