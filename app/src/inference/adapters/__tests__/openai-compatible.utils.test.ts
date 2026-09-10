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
      { content: 'All done', reasoning_content: ' ', role: 'assistant' }
    ]);
  });

  it('should send a single space as the reasoning of a DeepSeek assistant message that has none or an empty one', () => {
    const body = toCompletionBody({
      messages: [
        { content: 'first', role: 'assistant' },
        { content: 'second', reasoningContent: '', role: 'assistant' }
      ],
      modelName: 'deepseek-v4-flash',
      systemPrompt: 'Be helpful',
      tools: []
    });

    expect(body.messages.slice(1)).toStrictEqual([
      { content: 'first', reasoning_content: ' ', role: 'assistant' },
      { content: 'second', reasoning_content: ' ', role: 'assistant' }
    ]);
  });

  it('should send no reasoning at all to a model that does not echo it', () => {
    const body = toCompletionBody({
      messages: [{ content: 'All done', reasoningContent: 'because', role: 'assistant' }],
      modelName: 'anthropic/claude-sonnet-5',
      systemPrompt: 'Be helpful',
      tools: []
    });

    expect(body.messages[1]).toStrictEqual({ content: 'All done', role: 'assistant' });
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
