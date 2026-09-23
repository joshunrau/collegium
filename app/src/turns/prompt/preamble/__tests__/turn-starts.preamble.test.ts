import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderTurnStartsPreamble } from '../turn-starts.preamble.ts';

describe('renderTurnStartsPreamble', () => {
  it('should state where a drained post sits and how often a turn may start over for a further post (§4.4, §5.2)', () => {
    const paragraph = renderTurnStartsPreamble(buildStablePromptInput({ foldLimit: 3 }));
    expect(paragraph).toContain('which is before your own last reply and not at the end');
    expect(paragraph).toContain('you begin the turn again, at most 3 times in one turn');
  });

  it('should leave what starts the next turn to Open work for an agent holding a tasks tool (§3.15)', () => {
    const nextTurn = 'the next turn here begins when a person posts, a colleague mentions you, or a trigger fires';
    expect(renderTurnStartsPreamble(buildStablePromptInput())).toContain(nextTurn);
    const holdingTasks = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'read'] }] });
    expect(renderTurnStartsPreamble(holdingTasks)).not.toContain(nextTurn);
  });
});
