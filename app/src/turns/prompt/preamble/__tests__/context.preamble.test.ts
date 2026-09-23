import { describe, expect, it } from 'vitest';

import { buildStablePromptInput } from '@/testing/factories/stable-prompt-input.factory.ts';

import { renderContextPreamble } from '../context.preamble.ts';

describe('renderContextPreamble', () => {
  it('should say how a post names its author, an agent by name, and that the line is not a mention (§3.8)', () => {
    expect(renderContextPreamble(buildStablePromptInput())).toContain(
      'as `username (person):`, `Name (agent):` or `username (system):`. That line names the author and is not a mention.'
    );
  });

  it('should say the message after the posts is the framework’s and not a post (§3.8)', () => {
    expect(renderContextPreamble(buildStablePromptInput())).toContain(
      "After the posts and records, one message opens with such a line: it is the framework's, not a post"
    );
  });
});
