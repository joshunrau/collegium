import { describe, expect, it } from 'vitest';

import { endOfUtcDay, renderMatchCount, renderSearchHits, renderSearchPost, startOfUtcDay } from '../search.utils.ts';

import type { SearchHit } from '../../conversations.types.ts';

const hit = (message: string): SearchHit => ({
  authorUsername: 'casey',
  channelName: 'Main',
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  id: 'post-1',
  message
});

describe('renderSearchHits', () => {
  it('should name the query and the substring rule when nothing matched', () => {
    expect(renderSearchHits([], 'python.org/doc')).toContain('no posts matched "python.org/doc"');
    expect(renderSearchHits([], 'python.org/doc')).toContain('one literal substring');
  });

  it("should return a hit's text unaltered inside delimiters (§3.8)", () => {
    expect(renderSearchHits([hit('first line\nsecond line')], 'first')).toBe(
      '⟨post-1⟩ in Main — @casey — 2026-09-01T10:00:00.000Z\n<<<post post-1\nfirst line\nsecond line\n>>>'
    );
  });

  it('should cut a long hit around the match and say how much it dropped (§3.8)', () => {
    const message = `${'a'.repeat(2000)}NEEDLE${'b'.repeat(2000)}`;
    const rendered = renderSearchHits([hit(message)], 'needle');
    expect(rendered).toContain('NEEDLE');
    expect(rendered).toContain('…4006 characters in all; read the whole post with conversations::search postId=post-1');
    expect(rendered.length).toBeLessThan(1200);
  });
});

describe('renderSearchPost', () => {
  it('should render the whole post uncut', () => {
    const message = 'c'.repeat(4000);
    expect(renderSearchPost(hit(message), 'post-1')).toContain(message);
  });

  it('should read a post out of reach exactly as one that does not exist (§3.8)', () => {
    expect(renderSearchPost(undefined, 'post-9')).toBe(
      'no post matched id post-9 — a post is read here only while it sits in a channel this search reaches, ' +
        "after that channel's most recent episode boundary, and has not been forgotten"
    );
  });
});

describe('renderMatchCount', () => {
  it('should mark a read that found nothing (§8.1)', () => {
    expect(renderMatchCount(0)).toBe('⚠️ no matches');
    expect(renderMatchCount(1)).toBe('1 match');
    expect(renderMatchCount(3)).toBe('3 matches');
  });
});

describe('day bounds', () => {
  it('should take a day as a whole UTC day with an inclusive end', () => {
    expect(startOfUtcDay('2026-09-01').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(endOfUtcDay('2026-09-01').toISOString()).toBe('2026-09-01T23:59:59.999Z');
  });
});
