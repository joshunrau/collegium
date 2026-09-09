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

  it('should send reasoning content back beside the tool calls it produced', () => {
    const body = toCompletionBody({
      messages: [
        {
          content: '',
          reasoningContent: 'because',
          role: 'assistant',
          toolCalls: [{ arguments: { path: 'a.md' }, id: 'call-1', name: 'write_file' }]
        }
      ],
      modelName: 'deepseek-v4-flash',
      systemPrompt: 'Be helpful',
      tools: []
    });

    expect(body.messages[1]).toStrictEqual({
      content: '',
      reasoning_content: 'because',
      role: 'assistant',
      tool_calls: [{ function: { arguments: '{"path":"a.md"}', name: 'write_file' }, id: 'call-1', type: 'function' }]
    });
  });
});
