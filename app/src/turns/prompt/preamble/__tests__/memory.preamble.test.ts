import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderMemoryPreamble } from '../memory.preamble.ts';

const render = () => {
  return renderMemoryPreamble(
    buildStablePromptInput({ memoryCaps: { maxBodyChars: 16_000, maxDescriptionChars: 200, maxEntries: 1500 } })
  );
};

describe('renderMemoryPreamble', () => {
  it('should render only for an agent that holds memory (§3.8)', () => {
    expect(renderMemoryPreamble(buildStablePromptInput())).toBeUndefined();
    expect(render()).toContain('Your memories go with you between channels');
    expect(render()).toContain('The text of a memory is not posted in the channel.');
  });

  it('should state this agent’s caps and what a write beyond the entry cap removes (§3.6)', () => {
    expect(render()).toContain(
      "A memory's description holds at most 200 characters and its body at most 16,000. You keep at most 1,500 memories; a write beyond that removes the one whose body you read longest ago, and its result names it."
    );
  });

  it('should say that memories are private to each agent (§3.6)', () => {
    expect(render()).toMatch(
      /its result names it\. Your memories are yours alone: no colleague can read them, and you cannot read theirs\.$/u
    );
  });
});
