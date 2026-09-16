import { describe, expect, it } from 'vitest';

import { toCompletionBody } from '../openai-compatible.utils.ts';

import type { CompletionRequest } from '../../inference.types.ts';

const request: CompletionRequest = {
  cacheKey: 'mira:channel-1',
  messages: [{ content: 'Hello', role: 'user' }],
  modelName: 'deepseek-v4-flash',
  systemPrompt: { dynamic: 'Current memories and peers', stable: 'Instructions and skills' },
  tools: []
};

describe('toCompletionBody', () => {
  it.each(['anthropic/claude-sonnet-5', '~anthropic/claude-opus-latest'] as const)(
    'should cache the stable prefix, system context, and growing history for %s',
    (modelName) => {
      const body = toCompletionBody({ ...request, modelName });
      expect(body.cache_control).toStrictEqual({ type: 'ephemeral' });
      expect(body.messages[0]).toStrictEqual({
        content: [
          { cache_control: { type: 'ephemeral' }, text: request.systemPrompt.stable, type: 'text' },
          { cache_control: { type: 'ephemeral' }, text: request.systemPrompt.dynamic, type: 'text' }
        ],
        role: 'system'
      });
      expect(body).not.toHaveProperty('prompt_cache_options');
    }
  );

  it.each(['openai/gpt-5.6-sol', 'openai/gpt-6-astra', '~openai/gpt-luna-latest'] as const)(
    'should retain automatic caching alongside explicit system boundaries for %s',
    (modelName) => {
      const body = toCompletionBody({ ...request, modelName });
      expect(body.prompt_cache_options).toStrictEqual({ mode: 'implicit', ttl: '30m' });
      expect(body.prompt_cache_key).toBe(body.session_id);
      expect(body.messages[0]).toStrictEqual({
        content: [
          { prompt_cache_breakpoint: { mode: 'explicit' }, text: request.systemPrompt.stable, type: 'text' },
          { prompt_cache_breakpoint: { mode: 'explicit' }, text: request.systemPrompt.dynamic, type: 'text' }
        ],
        role: 'system'
      });
      expect(body).not.toHaveProperty('cache_control');
    }
  );

  it.each([
    'deepseek-v4-pro',
    'deepseek/deepseek-v4.1-flash',
    '~deepseek/deepseek-pro-latest',
    'z-ai/glm-5.3'
  ] as const)('should preserve automatic caching without unsupported controls for %s', (modelName) => {
    const body = toCompletionBody({ ...request, modelName });
    expect(body.messages[0]).toStrictEqual({
      content: 'Instructions and skills\n\nCurrent memories and peers',
      role: 'system'
    });
    expect(body).not.toHaveProperty('cache_control');
    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(body).not.toHaveProperty('prompt_cache_key');
  });

  it('should keep routing stable across memory changes and window truncation, while separating conversations', () => {
    const routed = { ...request, modelName: 'z-ai/glm-5.3' } as const;
    const original = toCompletionBody(routed);
    const changed = toCompletionBody({
      ...routed,
      messages: [{ content: 'A later window', role: 'user' }],
      systemPrompt: { ...request.systemPrompt, dynamic: 'Updated memories' }
    });
    expect(original.session_id).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.session_id).toBe(original.session_id);
    expect(toCompletionBody({ ...routed, cacheKey: 'mira:channel-2' }).session_id).not.toBe(original.session_id);
    expect(toCompletionBody(request)).not.toHaveProperty('session_id');
  });

  it('should preserve the cacheable instruction block when memories change and omit empty blocks', () => {
    const initial = toCompletionBody({
      ...request,
      modelName: 'anthropic/claude-sonnet-5',
      systemPrompt: { ...request.systemPrompt, dynamic: '' }
    });
    const updated = toCompletionBody({ ...request, modelName: 'anthropic/claude-sonnet-5' });
    expect(initial.messages[0]?.content).toStrictEqual([
      { cache_control: { type: 'ephemeral' }, text: request.systemPrompt.stable, type: 'text' }
    ]);
    expect(updated.messages[0]?.content[0]).toStrictEqual(initial.messages[0]?.content[0]);
  });

  it('should serialize the same tools identically regardless of registration order', () => {
    const tools = [
      { description: 'Write', name: 'write', parameters: {} },
      { description: 'Read', name: 'read', parameters: {} }
    ];
    expect(toCompletionBody({ ...request, tools }).tools).toStrictEqual(
      toCompletionBody({ ...request, tools: tools.toReversed() }).tools
    );
    expect(tools.map((tool) => tool.name)).toStrictEqual(['write', 'read']);
  });

  it('should omit tool_calls from an assistant message that carries none', () => {
    const body = toCompletionBody({
      cacheKey: 'mira:channel-1',
      messages: [{ content: 'All done', role: 'assistant' }],
      modelName: 'deepseek-v4-flash',
      systemPrompt: { dynamic: '', stable: 'Be helpful' },
      tools: []
    });

    expect(body.messages).toStrictEqual([
      { content: 'Be helpful', role: 'system' },
      { content: 'All done', reasoning_content: ' ', role: 'assistant' }
    ]);
  });

  it('should send a single space as the reasoning of a DeepSeek assistant message that has none or an empty one', () => {
    const body = toCompletionBody({
      cacheKey: 'mira:channel-1',
      messages: [
        { content: 'first', role: 'assistant' },
        { content: 'second', reasoningContent: '', role: 'assistant' }
      ],
      modelName: 'deepseek-v4-flash',
      systemPrompt: { dynamic: '', stable: 'Be helpful' },
      tools: []
    });

    expect(body.messages.slice(1)).toStrictEqual([
      { content: 'first', reasoning_content: ' ', role: 'assistant' },
      { content: 'second', reasoning_content: ' ', role: 'assistant' }
    ]);
  });

  it('should send no reasoning at all to a model that does not echo it', () => {
    const body = toCompletionBody({
      cacheKey: 'mira:channel-1',
      messages: [{ content: 'All done', reasoningContent: 'because', role: 'assistant' }],
      modelName: 'anthropic/claude-sonnet-5',
      systemPrompt: { dynamic: '', stable: 'Be helpful' },
      tools: []
    });

    expect(body.messages[1]).toStrictEqual({ content: 'All done', role: 'assistant' });
  });

  it('should send reasoning content back beside the tool calls it produced', () => {
    const body = toCompletionBody({
      cacheKey: 'mira:channel-1',
      messages: [
        {
          content: '',
          reasoningContent: 'because',
          role: 'assistant',
          toolCalls: [{ arguments: { path: 'a.md' }, id: 'call-1', name: 'write_file' }]
        }
      ],
      modelName: 'deepseek-v4-flash',
      systemPrompt: { dynamic: '', stable: 'Be helpful' },
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
