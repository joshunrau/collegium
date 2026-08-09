import { describe, expect, it } from 'vitest';

import { toCompletionBody } from '../openai-compatible.utils.ts';

describe('toCompletionBody', () => {
  it('should omit tool_calls from an assistant message that carries none', () => {
    const body = toCompletionBody({
      messages: [{ content: 'All done', role: 'assistant' }],
      modelName: 'deepseek-v4-flash',
      systemPrompt: 'Be helpful',
      tools: []
    });

    expect(body.messages).toStrictEqual([
      { content: 'Be helpful', role: 'system' },
      { content: 'All done', role: 'assistant' }
    ]);
  });
});
