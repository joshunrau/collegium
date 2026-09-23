import { describe, expect, it } from 'vitest';

import { renderColleaguesBaseline } from '../colleagues.baseline.ts';

describe('renderColleaguesBaseline', () => {
  it('should state one naming rule: a person always by @username, a colleague by name unless addressed (§3.8)', () => {
    expect(renderColleaguesBaseline()).toContain(
      'Name a person as @username every time you refer to them, and always when a post needs their decision; name a colleague by the name Peers gives it, and write @ before its handle only in the post that addresses it.'
    );
  });
});
