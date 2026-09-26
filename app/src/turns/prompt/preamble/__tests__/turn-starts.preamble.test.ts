import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderTurnStartsPreamble } from '../turn-starts.preamble.ts';

describe('renderTurnStartsPreamble', () => {
  it('should point a drained post to the list of what a turn answers, and say how often a turn may start over (§4.4, §5.2)', () => {
    const paragraph = renderTurnStartsPreamble(buildStablePromptInput({ foldLimit: 3 }));
    expect(paragraph).toContain("that turn's list of the posts it answers names it");
    expect(paragraph).toContain('whether it addresses nobody or names you again');
    expect(paragraph).toContain('you begin the turn again, at most 3 times in one turn');
  });

  it('should leave what starts the next turn to Open work for an agent holding a tasks tool (§3.15)', () => {
    const nextTurn = 'the next turn here begins when a person posts, a colleague mentions you, or a trigger fires';
    expect(renderTurnStartsPreamble(buildStablePromptInput())).toContain(nextTurn);
    const holdingTasks = buildStablePromptInput({ granted: [{ gates: false, id: ['tasks', 'read'] }] });
    expect(renderTurnStartsPreamble(holdingTasks)).not.toContain(nextTurn);
  });
});
