import { describe, expect, it } from 'vitest';

import { renderPinnedPostsPreamble } from '../pinned-posts.preamble.ts';

describe('renderPinnedPostsPreamble', () => {
  it('should say that people alone pin, and that a pin outranks a colleague’s paraphrase of it (§3.8)', () => {
    const paragraph = renderPinnedPostsPreamble();
    expect(paragraph).toContain('you cannot pin or unpin one');
    expect(paragraph).toContain("it outranks a colleague's paraphrase of it");
    expect(paragraph).toContain('gives only the ids of the older ones');
  });
});
