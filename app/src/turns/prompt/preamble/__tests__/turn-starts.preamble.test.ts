import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderTurnStartsPreamble } from '../turn-starts.preamble.ts';

describe('renderTurnStartsPreamble', () => {
  it('should state where a drained post sits and how often a turn may start over for a further post (§4.4, §5.2)', () => {
    const paragraph = renderTurnStartsPreamble(buildStablePromptInput({ foldLimit: 3 }));
    expect(paragraph).toContain('which is before your own last reply and not at the end');
    expect(paragraph).toContain('you begin the turn again, at most 3 times in one turn');
  });
});
