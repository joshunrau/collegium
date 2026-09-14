import { describe, expect, it } from 'vitest';

import { endOfUtcDay, renderSearchHits, startOfUtcDay } from '../search.utils.ts';

describe('renderSearchHits', () => {
  it('should say so when nothing matched', () => {
    expect(renderSearchHits([])).toBe('no posts matched');
  });

  it('should render each hit whole under a header naming its source', () => {
    const rendered = renderSearchHits([
      {
        authorUsername: 'casey',
        channelName: 'Main',
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        id: 'post-1',
        message: 'first line\nsecond line'
      }
    ]);
    expect(rendered).toBe('⟨post-1⟩ in Main — @casey — 2026-09-01T10:00:00.000Z\n> first line\n> second line');
  });
});

describe('day bounds', () => {
  it('should take a day as a whole UTC day with an inclusive end', () => {
    expect(startOfUtcDay('2026-09-01').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(endOfUtcDay('2026-09-01').toISOString()).toBe('2026-09-01T23:59:59.999Z');
  });
});
