import { describe, expect, it } from 'vitest';

import { isAudienceWithin, renderChannelName } from '../roster.utils.ts';

import type { ChannelRecord } from '../../channels.types.ts';

const record = (kind: ChannelRecord['kind'], members: string[], displayName = ''): ChannelRecord => ({
  displayName,
  kind,
  memberUsernames: new Set(members)
});

describe('isAudienceWithin', () => {
  it('should hold for an open candidate from anywhere', () => {
    expect(isAudienceWithin(record('private', ['a', 'b']), record('open', ['a']))).toBe(true);
  });

  it('should fail for a closed candidate from an open channel', () => {
    expect(isAudienceWithin(record('open', ['a']), record('private', ['a', 'b']))).toBe(false);
  });

  it('should hold only when the closed candidate holds everyone present', () => {
    expect(isAudienceWithin(record('direct', ['a', 'b']), record('private', ['a', 'b', 'c']))).toBe(true);
    expect(isAudienceWithin(record('private', ['a', 'b', 'c']), record('direct', ['a', 'b']))).toBe(false);
  });
});

describe('renderChannelName', () => {
  it('should prefer the display name the substrate gives', () => {
    expect(renderChannelName(record('open', ['a'], 'Main'), 'a')).toBe('Main');
  });

  it('should name a channel with no display name by the others in it', () => {
    expect(renderChannelName(record('group', ['tess', 'casey', 'jo']), 'tess')).toBe('@casey, @jo');
  });
});
